#!/usr/bin/env node
// =============================================================================
// PostToolUse 훅 — git commit 직후 가드레일 테스트를 자동 실행한다.
//
// 흐름:
//   1) stdin으로 들어오는 훅 입력(JSON)에서 실행된 Bash 명령을 읽는다.
//   2) 그 명령이 git commit이 아니면 조용히 통과한다(exit 0).
//   3) git commit이면 `node --test`로 tests/ 가드레일을 실행한다.
//   4) 통과 → exit 0 (사용자 transcript에만 짧게 표시).
//      실패 → 실패 출력을 stderr로 내보내고 exit 2.
//              PostToolUse에서 exit 2는 stderr를 그대로 Claude 컨텍스트로 돌려보내므로,
//              Claude가 그 출력을 보고 스스로 고친 뒤 다시 커밋하는 자기수정 루프가 된다.
//
// 의존성 0 (Node 내장 모듈만). CLAUDE.md 절대 규칙(빌드도구/npm 금지)을 지킨다.
// =============================================================================
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

// 1) 훅 입력(JSON)을 stdin(fd 0)에서 읽는다.
let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  payload = {};
}

const toolName = payload.tool_name || "";
const command = (payload.tool_input && payload.tool_input.command) || "";

// 2) git commit 명령일 때만 검증한다.
//    compound 명령(`git add -A && git commit ...`)·`git commit --amend`도 포함하도록
//    git 과 commit 토큰이 한 명령 안에 같이 있는지로 판단한다.
const isGitCommit =
  toolName === "Bash" && /\bgit\b[^\n]*\bcommit\b/.test(command);
if (!isGitCommit) process.exit(0);

// 3) 프로젝트 루트에서 가드레일 테스트를 돌린다(자동 탐색: tests/*.test.js).
const projectDir = payload.cwd || process.cwd();
const result = spawnSync(process.execPath, ["--test"], {
  cwd: projectDir,
  encoding: "utf8",
});

const output = `${result.stdout || ""}${result.stderr || ""}`.trim();

// 4) 결과 보고.
if (result.status === 0) {
  process.stdout.write("✅ 커밋 후 가드레일 테스트 통과\n");
  process.exit(0);
}

process.stderr.write(
  "❌ 커밋 후 가드레일 테스트 실패 — index.html이 CLAUDE.md 절대 규칙 또는 JS 문법을 위반했습니다.\n" +
    "아래 출력을 보고 원인을 고친 뒤 다시 커밋하세요.\n\n" +
    output +
    "\n",
);
process.exit(2);
