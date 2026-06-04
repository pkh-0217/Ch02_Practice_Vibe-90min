# 아키텍처 Deep Dive — 오늘의 목표 & 회고

> 이 문서는 `CLAUDE.md`의 "3. 아키텍처 한눈에"를 확장한 상세 설계 문서다.
> Claude는 필요할 때만 이 파일을 읽는다(`@` lazy load). CLAUDE.md를 짧게 유지하기 위해 분리했다.

마지막 업데이트: 2026-06-04

**📌 업데이트 규칙**: 구조·렌더 경로·데이터 모델·모듈 책임이 바뀌면 **같은 PR/커밋에서** 이 문서를 갱신한다.
- 라인 번호는 적지 않는다(드리프트). 모듈/객체 이름과 "왜"를 적는다.
- 코드만 읽으면 알 수 있는 시그니처는 옮겨 적지 않는다. 흐름·계약·제약을 적는다.
- 되돌릴 수 없는 큰 선택을 했다면 `decisions.md`에 ADR을 추가하고 여기서 한 줄로 링크한다.

---

## 1. 설계 철학

- **제로 셋업.** `index.html` 더블클릭으로 실행. 빌드·번들러·패키지 매니저 없음.
- **단일 파일.** HTML/CSS/JS가 한 파일 안에 산다. 공유·백업·복제가 파일 하나로 끝난다.
- **로컬 우선.** 서버·DB 없이 브라우저 `localStorage`가 유일한 영속 계층.
- **하루 단위 모델.** 모든 데이터는 날짜(`YYYY-MM-DD`) 키에 묶인다. 보드·회고·통계가 같은 날짜 축을 공유한다.

배경과 트레이드오프는 `decisions.md`(ADR-001~004) 참조.

---

## 2. 런타임 모델

빌드도 모듈 시스템도 없다. `<script>` 안에서 **전역 `const` 객체**들이 서로를 직접 참조한다.

부팅 순서 (`init()`):
1. `cacheElements()` — DOM 요소를 `App.el`에 캐시.
2. `Theme.init()` — 저장된 테마 또는 OS 선호(`prefers-color-scheme`) 적용.
3. `bindEvents()` — 모든 이벤트 리스너 연결(클릭/입력/드래그/키보드/언로드).
4. `Carry.migrateTodosToBoard()` — 구버전 `todos:*`를 보드 카드로 1회 이전.
5. `Carry.carryOverIncomplete()` — 전날 미완료 카드를 오늘로 자동 이월.
6. `loadDay()` — 오늘 데이터를 읽어 첫 렌더.

---

## 3. 상태와 렌더 파이프라인

### 중앙 상태 — `App.state`
보고 있는 날짜(`viewDate`), 그 날짜의 보드(`kanban`)·회고(`journal`), 현재 키 문자열, 달력에 표시 중인 달(`calMonth`), 파생 캐시(`recorded` = 기록 있는 날짜 집합), 이월 카운트, 드래그 중 카드 id를 담는다.

### 단일 렌더 경로 (중요)
상태를 바꾼 뒤에는 **직접 DOM을 만지지 않고** 아래 둘 중 하나만 호출한다.

- `renderAll()` — `recorded`를 재계산하고 **모든 영역**(Header / 이월 알림 / Board / Journal / Calendar / Stats)을 다시 그린다. 날짜 전환·초기 로드처럼 전부 새로 그릴 때.
- `refreshDerived()` — `recorded`를 재계산하고 **데이터 의존 뷰**(Board / Calendar / Stats)만 다시 그린다. 카드 추가·이동·삭제, 회고 저장처럼 헤더/회고 입력칸을 건드릴 필요 없을 때.

`recorded`(기록 있는 날짜)는 렌더당 한 번만 `computeRecordedDays()`로 계산해 캐시한다. Calendar·Stats는 이 캐시만 읽고 localStorage를 재스캔하지 않는다(과거의 이중 스캔 제거).

### 날짜 전환 공통 경로
`navigateTo(date)` → `Journal.flush()`(미저장 회고 손실 방지) → `viewDate` 변경 → `loadDay()`(키 재설정 + `renderAll`). Header의 이전/다음/오늘 버튼, 달력 클릭이 모두 이 경로를 탄다. **미래 날짜로는 이동 불가**(`todayStart` 기준 차단).

---

## 4. 모듈 책임

| 모듈 | 책임 |
|------|------|
| `Store` | localStorage 입출력 **단일 창구**. JSON load/save, 문자열 get/set, 키 순회(`eachKey`), id 생성(`newId`). 다른 곳에서 localStorage 직접 호출 금지. |
| `DateUtil` | 로컬 자정 기준 `YYYY-MM-DD` 키 생성, 월 시작, 현재 `HH:MM`. `toISOString`(UTC) 사용 금지 — ADR-004. |
| `Theme` | `<html data-theme>` 토글, `settings:theme` 저장, OS 선호 반영. |
| `Header` | 보고 있는 날짜 표시·상대 라벨(오늘/어제/N일 전), 날짜 이동, 미래 차단. |
| `Carry` | 구버전 마이그레이션 + 전날 미완료 자동 이월(`carried:YYYY-MM-DD` 플래그로 하루 1회 보장). 이월 카드는 `carried:true` 표시. |
| `Board` | 칸반(할 일/진행 중/완료 × work/study/general). 카드 추가·상태 변경·드래그&드롭·삭제·저장, 이월 알림 노트. |
| `Modal` | 카드 상세(메모·마감 시간 편집). 포커스 트랩 적용. |
| `Journal` | 회고(잘한 것/아쉬운 것/내일 할 것). **디바운스 자동 저장**, `flush()`로 강제 저장. |
| `Calendar` | 기록 달력. `App.state.recorded`만 읽어 기록 있는 날을 표시, 클릭 시 해당 날짜로 이동. |
| `Stats` | 통계(완료율·기록일수 등). `App.state.recorded` 사용. |
| `Backup` | 전체 데이터 JSON 내보내기 / 가져오기(복원). |
| `AI` | Claude API 직접 호출. 회고 초안·주간 인사이트·우선순위 추천. (5절 참조) |
| `Settings` | API 키·모델 입력/저장(모달). 테마는 헤더 버튼에서 처리. |
| `Toast` | 가벼운 알림 토스트. |

---

## 5. 데이터 모델 (localStorage 키 규칙)

> 스키마의 정본(canonical) 주석은 `index.html` `<script>` 상단에 있다. 여기서는 계약과 의미를 요약한다.

| 키 | 값 | 비고 |
|----|----|----|
| `kanban:YYYY-MM-DD` | `Card[]` | 카드 = `{id, text, cat, status(0/1/2), memo, due('HH:MM'\|''), carried}`. `cat ∈ work\|study\|general`. |
| `journal:YYYY-MM-DD` | `{good, bad, tomorrow}` | 회고 텍스트 3필드. |
| `carried:YYYY-MM-DD` | `'1'` | 그날 자동 이월을 이미 수행했다는 플래그(중복 이월 방지). |
| `settings:theme` | `'light'\|'dark'` | |
| `settings:anthropicKey` | 문자열 | API 키. **브라우저에만 저장**(ADR-003). |
| `settings:model` | 모델 ID | 기본 `claude-haiku-4-5-20251001`. |
| `todos:YYYY-MM-DD` | (구버전) | 가져오기/부팅 시 보드 카드로 1회 마이그레이션. |

- 날짜 키는 항상 `DateUtil.toKey()`로 생성한다(로컬 자정).
- "기록 있는 날" = 보드 카드 1장 이상 **또는** 회고 필드에 내용 있음.

---

## 6. AI 통합

- **엔드포인트**: `POST https://api.anthropic.com/v1/messages` — 백엔드 없이 브라우저에서 직접 호출.
- **헤더**: `x-api-key`(localStorage 키), `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`. → 공개 배포 시 키 노출(ADR-003, CLAUDE.md 절대 규칙).
- **공통 처리** `AI.run()`: 키 없으면 설정 모달 유도 → 로딩 표시 → 실행 → 출력 박스에 결과/친절한 한국어 에러(키 누락·`file://` 차단 안내 포함).
- **느슨한 JSON 파싱** `AI.parseJson()`: 코드펜스(```json)와 앞뒤 잡텍스트를 벗기고 `{...}`만 파싱.

세 가지 기능:
1. **회고 초안(`draftRetro`)** — 오늘 보드 요약 + 기존 회고를 입력으로 `{good,bad,tomorrow}` JSON을 받아 입력칸을 채운다.
2. **주간 인사이트(`weeklyInsight`)** — 최근 7일 보드/회고를 모아 일반 텍스트 코칭 요약을 받는다.
3. **우선순위 추천(`prioritize`)** — '할 일'(status 0) 카드 순서를 `{order, notes}` JSON으로 받아 보드를 재정렬한다. 인덱스 검증 후 status 0 카드만 재배치(나머지 상태 유지).

---

## 7. 알려진 제약 / 리스크

- 데이터는 **브라우저·기기에 종속**된다. 동기화 없음. 브라우저 데이터 삭제 시 소실 → `Backup` JSON으로 대비.
- 날짜 키가 로컬 자정 기준이라 **다른 타임존 기기 간 이동에 취약**(ADR-004).
- 회귀의 1차 안전망으로 **가드레일 테스트**(`tests/guardrails.test.js`)가 있다 — 절대 규칙·JS 문법을 커밋 직후 자동 검사(ADR-005, 8절). 단 런타임/DOM 동작까지 보는 통합 테스트는 아니라 **깊은 회귀 검증은 여전히 수동**(`run`/`verify`).
- `index.html`이 커질수록 탐색 비용 증가 — 모듈 경계(`// ===== 모듈명 =====` 주석)를 깨지 말 것.

---

## 8. 검증 루프 (가드레일 + 커밋 훅) — ADR-005

> 코드를 읽으면 알 수 있는 시그니처 대신 **흐름·계약·제약**만 적는다.

- **무엇을 검증하나** — `tests/guardrails.test.js`(Node 내장 `node:test`)가 CLAUDE.md 절대 규칙을 실행 가능한 검사로 인코딩한다: ① 인라인 `<script>` 문법(`node --check`) ② `localStorage` 직접 호출은 `Store` 안에서만 ③ 외부 CDN/스크립트 src·`package.json` 없음(단일 파일 유지) ④ `.toISOString()` 미사용(ADR-004) ⑤ 필수 모듈/렌더 경로 존재.
- **언제 도나** — Claude Code `PostToolUse(Bash)` 훅(`.claude/settings.json`)이 `git commit`을 감지하면 `.claude/hooks/post-commit-validate.mjs`가 `node --test`를 실행한다. `if: "Bash(git *)"`로 git 명령에만 훅을 띄우고, 정확한 commit 판별은 스크립트가 한다(`git ... commit`).
- **실패하면** — 훅이 exit 2 + 실패 출력을 stderr로 내보낸다. PostToolUse의 exit 2는 그 출력을 **Claude 컨텍스트로 되돌려**, Claude가 스스로 고친 뒤 다시 커밋하게 만든다(자기수정 루프).
- **제약** — 의존성 0(Node 내장만)이라 ADR-001을 supersede하지 않는다. 정적·텍스트 기반 검사라 런타임/DOM 회귀는 못 잡는다. 가드레일이 모듈 선언·`<script>` 형태를 가정하므로 큰 리팩터 시 테스트도 함께 갱신한다.
- **활성화** — 세션 시작 시 `.claude/settings.json`이 없었다면 훅 watcher가 즉시 인식하지 못할 수 있다. `/hooks`를 한 번 열거나 Claude Code를 재시작하면 활성화된다.

## 9. 관련 문서

- 절대 규칙·치트시트·컨벤션: `../../CLAUDE.md`
- 아키텍처 의사결정 기록(ADR): `./decisions.md`
- 실습 회고: `../../vibe-notes.md`
