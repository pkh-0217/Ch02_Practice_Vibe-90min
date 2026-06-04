#!/usr/bin/env node
// =============================================================================
// PreToolUse 훅 — git commit "직전"에 Claude가 staged diff를 자동 리뷰하게 만든다.
//
// 왜 이렇게 동작하나(핵심 트릭):
//   훅은 셸 스크립트라 스스로 LLM 리뷰를 할 수 없다. 대신 PreToolUse에서 exit 2로
//   커밋을 한 번 "막고", 그 stderr를 Claude 컨텍스트로 되돌려 "아래 diff를 리뷰하라"고
//   지시한다. Claude가 리뷰를 사용자에게 보고한 뒤 동일한 git commit을 다시 실행하면,
//   이번엔 마커가 일치해 통과한다. → 모든 커밋이 자동 코드 리뷰를 한 번 거치는 friction.
//
// 무한 루프 방지(마커):
//   diff의 sha1 해시를 임시 마커 파일에 적는다.
//   - 마커 없음/불일치        → 마커 기록 + exit 2 (리뷰 요청, 커밋 차단).
//   - 마커가 현재 diff와 일치  → 직전에 이미 리뷰함 → 마커 삭제 + exit 0 (커밋 허용).
//   diff가 바뀌면(리뷰 후 수정) 해시가 달라져 다시 리뷰한다(의도된 자기수정). 30분 만료.
//
// fail-open:
//   훅 자신의 오류로 사용자의 커밋을 막지 않는다. 예외/불확실 시 조용히 통과(exit 0).
//   이건 게이트키퍼가 아니라 friction이다 — 자신이 장애점이 되어선 안 된다.
//
// 의존성 0 (Node 내장 모듈만). ADR-001(빌드도구/npm 금지)·ADR-006 준수.
// 짝이 되는 사후 검증: post-commit-validate.mjs (ADR-005). 둘이 commit을 사이에 두고
// "사전 리뷰 → commit → 사후 가드레일"로 짝을 이룬다.
// =============================================================================
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, statSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MARKER_TTL_MS = 30 * 60 * 1000; // 리뷰 후 미커밋으로 남은 마커는 30분 뒤 무효
const DIFF_LIMIT = 16000; // 컨텍스트 보호용 diff 표시 상한(자)

// fail-open 래퍼: 어떤 예외도 커밋을 막지 않는다.
try {
  main();
} catch {
  process.exit(0);
}

function main() {
  // 1) 훅 입력(JSON)을 stdin(fd 0)에서 읽는다.
  let payload = {};
  try {
    payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    payload = {};
  }

  const toolName = payload.tool_name || "";
  const command = (payload.tool_input && payload.tool_input.command) || "";

  // 2) git commit 명령일 때만 개입한다.
  //    compound 명령(`git add -A && git commit ...`)·`--amend`도 포함하도록
  //    post-commit 훅과 동일하게 git·commit 토큰 동시 존재로 판별한다.
  const isGitCommit =
    toolName === "Bash" && /\bgit\b[^\n]*\bcommit\b/.test(command);
  if (!isGitCommit) process.exit(0);

  const projectDir = payload.cwd || process.cwd();

  // 3) 리뷰 대상 diff를 구한다. 기본은 staged diff.
  //    `git commit -a/-am/--all`은 커밋 시점에 추적 파일을 스테이징하므로,
  //    staged가 비면 추적 변경(diff HEAD)으로 보완한다.
  let diff = gitDiff(projectDir, ["diff", "--cached"]);
  if (!diff.trim() && wantsAll(command)) {
    diff = gitDiff(projectDir, ["diff", "HEAD"]);
  }

  // 리뷰할 변경이 없으면(빈 diff·merge 등) git에 맡기고 통과한다.
  if (!diff.trim()) process.exit(0);

  // 4) 마커로 "이미 리뷰했나?"를 판단한다.
  const hash = createHash("sha1").update(diff).digest("hex");
  const marker = join(
    tmpdir(),
    `claude-precommit-review-${shortId(projectDir)}.txt`,
  );

  if (markerMatches(marker, hash)) {
    // 직전에 이 diff를 리뷰했다 → 통과시키고 마커를 정리한다.
    try {
      rmSync(marker);
    } catch {}
    process.exit(0);
  }

  // 5) 아직 리뷰 안 됨 → 마커를 남기고 커밋을 막은 뒤, diff를 Claude에게 넘겨 리뷰를 요청한다.
  try {
    writeFileSync(marker, `${hash}\t${Date.now()}`, "utf8");
  } catch {}

  const shown = diff.length > DIFF_LIMIT ? diff.slice(0, DIFF_LIMIT) : diff;
  process.stderr.write(buildReviewPrompt(command, shown, shown !== diff));
  process.exit(2);
}

// ----- 헬퍼 -----------------------------------------------------------------

// git을 돌려 diff 문자열을 얻는다. 실패(ENOENT 등)하면 ""(→ fail-open으로 통과).
function gitDiff(cwd, args) {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (!r || r.status !== 0) return "";
  return r.stdout || "";
}

// 커밋 명령이 -a / --all / -am 처럼 추적 파일 일괄 스테이징을 요구하는가.
function wantsAll(command) {
  return /\b--all\b/.test(command) || /\s-[A-Za-z]*a[A-Za-z]*\b/.test(command);
}

// 프로젝트 경로별로 마커 파일을 구분하기 위한 짧은 id.
function shortId(s) {
  return createHash("sha1").update(s).digest("hex").slice(0, 8);
}

// 마커가 존재하고, 30분 내이며, 현재 diff 해시와 일치하는가.
function markerMatches(path, hash) {
  try {
    if (!existsSync(path)) return false;
    if (Date.now() - statSync(path).mtimeMs > MARKER_TTL_MS) return false;
    const saved = (readFileSync(path, "utf8").split("\t")[0] || "").trim();
    return saved === hash;
  } catch {
    return false;
  }
}

// Claude 컨텍스트로 되돌려 보낼 리뷰 지시문 + diff.
function buildReviewPrompt(command, diff, truncated) {
  return [
    "🛑 커밋 전 자동 코드 리뷰(friction 훅, ADR-006) — 이 커밋을 한 번 보류했습니다.",
    "",
    "아래 **staged diff**를 리뷰하고 사용자에게 한국어로 간단히 보고하세요. 점검 항목:",
    "  1) CLAUDE.md 절대 규칙 위반",
    "     - 단일 index.html 유지(빌드도구/npm/외부 CDN 금지)",
    "     - localStorage 직접 호출 금지(반드시 Store 경유)",
    "     - 날짜 키에 toISOString() 금지(DateUtil.toKey)",
    "     - .env/실제 API 키 커밋·하드코딩 금지",
    "  2) 명백한 버그·논리 오류, 단일 렌더 경로 누락(상태 변경 후 renderAll/refreshDerived)",
    "  3) 시크릿/토큰 노출, 디버그 잔재(console.log 등)",
    "",
    "보고 형식: 결론을 ✅ 통과 / ⚠️ 주의 / ❌ 차단 중 하나로 + 발견 항목 불릿.",
    "",
    "그 다음:",
    "  • 문제 없거나 경미하면 → 사용자에게 보고 후 **동일한 git commit 명령을 다시 실행**하세요.",
    "    (방금 리뷰한 diff와 같으면 이번엔 훅이 통과시킵니다.)",
    "  • 차단할 문제가 있으면 → 커밋하지 말고 index.html을 고친 뒤 다시 시도하세요",
    "    (수정하면 diff가 바뀌어 자동으로 재리뷰됩니다).",
    "",
    `재실행할 명령: ${command}`,
    truncated
      ? "(diff가 길어 앞부분 16000자만 표시합니다. 전체는 `git diff --cached`로 확인.)"
      : "",
    "",
    "────────────────────── staged diff ──────────────────────",
    diff,
    "──────────────────────────────────────────────────────────",
    "",
  ].join("\n");
}
