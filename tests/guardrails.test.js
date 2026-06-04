// =============================================================================
// 가드레일 테스트 — CLAUDE.md 절대 규칙을 "실행 가능한 검사"로 바꾼다.
//
// Node 내장 러너(node --test)로만 동작한다. npm 의존성·package.json·CDN 없음.
// (단일 index.html 정책을 지키기 위해, 테스트도 외부 도구 없이 Node 내장만 쓴다.)
//
// 검사 항목:
//   1) 인라인 <script>가 문법 오류 없이 파싱된다 (node --check).
//   2) localStorage 직접 호출은 Store 객체 안에서만 한다.
//   3) 외부 CDN/스크립트 src·빌드도구가 없다 (단일 파일 유지).
//   4) .toISOString() 호출이 없다 (ADR-004: 로컬 자정 키만 사용).
//   5) 필수 모듈/렌더 경로가 정의돼 있다.
//
// 실패하면 post-commit 훅이 이 출력을 Claude 컨텍스트로 되돌려 자기수정을 유도한다.
// =============================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");

// 인라인 앱 스크립트(src 없는 단일 <script> 블록)를 뽑아낸다.
function extractInlineScript(src) {
  const m = src.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, "인라인 <script> 블록을 찾지 못했습니다.");
  return m[1];
}

// Store 모듈 본문 범위를 구한다. 경계 = Store 선언 ~ 그 다음 모듈(const Xxx = {) 직전.
// (브레이스 매칭 대신 모듈 선언 경계를 쓰는 이유: 코드의 모듈 패턴이 안정적이라 더 단순·견고하다.)
function storeRange(script) {
  const start = script.search(/const\s+Store\s*=\s*\{/);
  assert.ok(start !== -1, "Store 모듈 정의를 찾지 못했습니다.");
  const after = script.slice(start + 1);
  const nextRel = after.search(/\n\s*const\s+[A-Z]\w*\s*=\s*\{/);
  const end = nextRel === -1 ? script.length : start + 1 + nextRel;
  return { start, end };
}

function lineOf(script, index) {
  return script.slice(0, index).split("\n").length;
}

test("인라인 스크립트에 문법 오류가 없다 (node --check)", () => {
  const script = extractInlineScript(html);
  const tmp = join(tmpdir(), `guardrail-syntax-${process.pid}.js`);
  writeFileSync(tmp, script, "utf8");
  try {
    execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
  } catch (err) {
    const detail = (err.stderr || err.stdout || err.message || "").toString();
    assert.fail(`인라인 <script>에 문법 오류가 있습니다:\n${detail}`);
  } finally {
    if (existsSync(tmp)) rmSync(tmp);
  }
});

test("localStorage 직접 호출은 Store 객체 안에서만 한다", () => {
  const script = extractInlineScript(html);
  const { start, end } = storeRange(script);
  const re = /localStorage\s*\./g;
  const offenders = [];
  let m;
  while ((m = re.exec(script)) !== null) {
    if (m.index < start || m.index >= end) {
      offenders.push(`script 기준 ${lineOf(script, m.index)}번째 줄`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Store 밖에서 localStorage를 직접 호출했습니다(${offenders.join(", ")}). ` +
      `모든 입출력은 Store.load/save/getStr/setStr를 거쳐야 합니다.`,
  );
});

test("외부 CDN/스크립트 src·빌드도구가 없다 (단일 파일 유지)", () => {
  // 사용자용 <a href="http..."> 링크는 허용. '리소스 로딩'만 금지한다.
  assert.ok(!/<script[^>]*\bsrc\s*=/i.test(html), "외부 <script src>가 추가됐습니다.");
  assert.ok(
    !/<link[^>]+href\s*=\s*["']https?:/i.test(html),
    "외부 <link>(CDN 스타일시트/폰트)가 추가됐습니다.",
  );
  assert.ok(
    !/@import\s+(?:url\()?\s*["']?https?:/i.test(html),
    "CSS @import로 외부 리소스를 불러옵니다.",
  );
  // package.json이 생기면 npm 의존성·빌드도구 도입 신호 → 절대 규칙 위반.
  assert.ok(
    !existsSync(join(ROOT, "package.json")),
    "package.json이 생겼습니다(빌드도구/npm 의존성 금지).",
  );
});

test(".toISOString() 호출이 없다 (ADR-004: 로컬 자정 키만 사용)", () => {
  const script = extractInlineScript(html);
  assert.ok(
    !/\.toISOString\s*\(/.test(script),
    "toISOString()은 UTC라 자정 근처에 하루가 어긋납니다. DateUtil.toKey()를 쓰세요.",
  );
});

test("필수 모듈/렌더 경로가 정의돼 있다", () => {
  const script = extractInlineScript(html);
  const modules = [
    "Store", "DateUtil", "App", "Toast", "Theme", "Header", "Carry",
    "Board", "Modal", "Journal", "Calendar", "Stats", "Backup", "AI", "Settings",
  ];
  const missingModules = modules.filter(
    (name) => !new RegExp(`const\\s+${name}\\s*=`).test(script),
  );
  assert.deepEqual(missingModules, [], `누락된 모듈: ${missingModules.join(", ")}`);

  const fns = ["renderAll", "refreshDerived", "init"];
  const missingFns = fns.filter(
    (fn) => !new RegExp(`(?:function\\s+${fn}\\b|const\\s+${fn}\\s*=)`).test(script),
  );
  assert.deepEqual(missingFns, [], `누락된 함수: ${missingFns.join(", ")}`);
});
