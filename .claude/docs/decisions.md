# 아키텍처 의사결정 기록 (ADR)

> 되돌리기 어렵거나 시스템 전반에 영향을 주는 **결정**을 기록한다. "무엇을"보다 **"왜, 무엇을 포기하고"**가 핵심이다.
> 형식: [Michael Nygard ADR](https://github.com/joelparkerhenderson/architecture-decision-record).

마지막 업데이트: 2026-06-04

**📌 업데이트 규칙**
- 새 결정은 **기존 ADR을 수정하지 말고 새 번호로 추가**한다(ADR-00N). 결정의 역사는 남긴다.
- 결정이 바뀌면 옛 ADR의 Status를 `Superseded by ADR-00M`으로 바꾸고, 새 ADR에 배경을 적는다.
- Status 값: `Proposed` / `Accepted` / `Deprecated` / `Superseded by ADR-00N`.
- 각 ADR은 **Context → Decision → Consequences(좋음/나쁨/중립) → Alternatives**를 모두 채운다.

---

## ADR-001: 단일 파일 정적 웹앱 (빌드/프레임워크 없음)

- **Status**: Accepted
- **Date**: 2026-06-04

### Context
90분 Vibe 코딩 실습으로 만든 개인용 할 일·회고 앱이다. 빠른 시작, 군더더기 없는 공유·실행, 비개발자도 더블클릭으로 여는 경험이 목표였다. 셋업 단계(설치·빌드·서버)가 진입 장벽이자 실패 지점이 된다.

### Decision
HTML·CSS·JS를 **단일 `index.html`**에 모은다. 바닐라 JS만 사용하고 빌드 도구·번들러·패키지 매니저·프레임워크·외부 CDN을 도입하지 않는다. JS는 전역 `const` 객체(모듈 패턴)로 구성한다.

### Consequences
- 👍 `index.html` 더블클릭만으로 실행. 공유·백업·복제가 파일 하나.
- 👍 의존성 0 → 공급망 리스크·버전 관리 부담 없음.
- 👎 모듈 시스템·트리셰이킹·타입체크·자동 테스트가 없다.
- 👎 파일이 커지면 탐색 비용 증가. `// ===== 모듈 =====` 주석 경계로 완화.
- 🔁 도구가 정말 필요해지면 ADR로 재논의(이 결정 supersede).

### Alternatives considered
- **Vite + 프레임워크(React 등)**: DX·테스트는 좋아지나 셋업·빌드 단계가 생겨 "제로 셋업" 목표와 충돌. 실습 범위 초과로 기각.
- **여러 파일로 분리(`app.js`, `style.css`)**: `file://`에서 모듈 import·CORS 이슈가 생길 수 있고 단일 파일 공유 이점이 사라져 기각.

---

## ADR-002: 영속 계층은 브라우저 localStorage (백엔드/DB 없음)

- **Status**: Accepted
- **Date**: 2026-06-04

### Context
개인 로컬 도구이고 서버를 운영할 의도가 없다. 그러나 날짜별 보드·회고는 새로고침/재방문 후에도 유지돼야 한다.

### Decision
모든 영속 데이터를 **`localStorage`**에 둔다. 접근은 **`Store` 객체 단일 창구**로만 한다(직접 `localStorage` 호출 금지). 데이터는 날짜 키(`kanban:YYYY-MM-DD`, `journal:YYYY-MM-DD` 등)로 구성한다. 백업/이동은 `Backup`의 JSON 내보내기·가져오기로 해결한다.

### Consequences
- 👍 서버·DB·인증 없이 즉시 영속. 인프라 0.
- 👍 접근 창구가 하나라 키 규칙·마이그레이션을 한 곳에서 관리(`Carry`의 구버전 이전).
- 👎 데이터가 브라우저·기기에 종속. 동기화 없음. 브라우저 데이터 삭제 시 소실 → JSON 백업으로 대비.
- 👎 용량 한계(수 MB)와 문자열 직렬화 비용. 현재 데이터 규모에선 무해.

### Alternatives considered
- **IndexedDB**: 용량·쿼리에 유리하나 API가 무거워 단일 파일·소규모 데이터에는 과함. 기각.
- **백엔드 + DB**: 동기화·다기기에 필요하지만 ADR-001/범위와 충돌. 공개·다기기 요구가 생기면 재논의.

---

## ADR-003: Claude API를 브라우저에서 직접 호출 (로컬 전용 제약)

- **Status**: Accepted
- **Date**: 2026-06-04

### Context
회고 초안·주간 인사이트·우선순위 추천에 LLM이 필요하다. 그러나 ADR-002대로 백엔드가 없어 API 키를 안전히 숨길 서버가 없다.

### Decision
브라우저에서 `api.anthropic.com/v1/messages`를 **직접 호출**한다. `anthropic-dangerous-direct-browser-access: true` 헤더를 쓰고, 키는 `settings:anthropicKey`로 localStorage에 저장한다. 그 대가로 **"개인 로컬 사용 전용, 공개 배포 금지"**를 제품 제약으로 못박는다(설정 화면과 CLAUDE.md 절대 규칙에 명시).

### Consequences
- 👍 백엔드 없이 AI 기능 동작. 사용자가 자기 키를 넣어 즉시 사용.
- 👎 페이지를 공개 배포하면 **키가 노출**된다 → 배포 불가 제약을 항상 동반.
- 👎 `file://`에서 CORS로 막힐 수 있어 로컬 서버 실행을 안내(`python -m http.server`).
- 🔁 공개가 필요해지면 **백엔드 프록시 도입**으로 이 결정을 supersede(키를 서버로 이전).

### Alternatives considered
- **백엔드 프록시로 키 숨김**: 가장 안전하나 서버 운영이 필요해 현재 범위 밖. 공개 시 채택 예정.
- **AI 기능 제거**: 핵심 가치(코칭·자동 초안)를 잃어 기각.

---

## ADR-004: 날짜 키는 로컬 자정 기준 `YYYY-MM-DD` (UTC/ISO 금지)

- **Status**: Accepted
- **Date**: 2026-06-04

### Context
이 앱의 모든 데이터는 "하루" 단위로 묶인다. `Date.toISOString()`은 UTC라 자정 근처에서 사용자의 실제 날짜와 하루가 어긋날 수 있다(예: 밤 11시 한국 시간이 UTC로는 전날/다음날).

### Decision
날짜 키는 **`DateUtil.toKey()`로만** 생성한다 — 로컬 연/월/일을 직접 조합(`YYYY-MM-DD`). 자정 경계 비교는 `DateUtil.startOfDay()`로 한다. 코드 어디서도 `toISOString()`을 날짜 키 용도로 쓰지 않는다.

### Consequences
- 👍 사용자가 체감하는 "오늘"과 저장 키가 일치. 일일 플래너로서 올바른 동작.
- 👎 키가 기기의 로컬 타임존에 의존 → 다른 타임존 기기로 데이터를 옮기면 날짜가 어긋날 수 있다(현재 단일 기기 가정이라 수용).
- 🧭 새 날짜 로직은 반드시 `DateUtil`을 거치게 해 규칙을 한 곳에 유지.

### Alternatives considered
- **UTC ISO 문자열 저장**: 다기기 이식엔 유리하나 로컬 자정 어긋남 버그를 부른다. 일일 플래너 특성상 기각.
- **타임존 라이브러리 도입**: ADR-001(의존성 0)과 충돌하고 현재 규모에 과함. 기각.

---

## ADR-005: 커밋 후 검증 루프 — Node 내장 가드레일 테스트 + Claude Code 훅

- **Status**: Accepted
- **Date**: 2026-06-04

### Context
ADR-001로 자동 테스트가 없어(👎) 회귀 검증이 수동이었다. `index.html`을 수정하다 절대 규칙(localStorage 직접 호출 금지·외부 CDN 금지·`toISOString` 금지·단일 파일 유지)이나 JS 문법을 깨도 즉시 드러나지 않는다. 외부 공개 전 점검 단계에서 가벼운 안전망이 필요했다. 단, 어떤 검증도 ADR-001의 "의존성 0·빌드 없음"을 깨선 안 된다는 제약이 있었다.

### Decision
두 조각을 둔다.
1. **가드레일 테스트** `tests/guardrails.test.js` — **Node 내장 러너(`node:test` / `node --test`)만** 쓴다(npm·`package.json`·CDN 없음). 절대 규칙을 실행 가능한 검사로 인코딩한다(문법 · localStorage 창구 · 외부 리소스 · toISOString · 필수 모듈).
2. **커밋 후 훅** `.claude/settings.json`의 `PostToolUse(Bash)` 훅이 `git commit`을 감지해 `.claude/hooks/post-commit-validate.mjs`로 `node --test`를 돌린다. 실패 시 **exit 2 + 실패 출력**을 내보내 Claude 컨텍스트로 되돌리고, Claude가 자기수정 후 재커밋하게 한다.

이 결정은 **ADR-001을 supersede하지 않는다** — 앱 자체는 여전히 단일 `index.html`·의존성 0이고, 테스트도 Node 내장만 쓴다.

### Consequences
- 👍 절대 규칙 위반·문법 오류가 커밋 즉시 드러나고, 출력이 컨텍스트로 돌아와 자기수정 루프가 된다.
- 👍 의존성 0 유지 — 설치·빌드·공급망 리스크 없음. ADR-001과 공존.
- 👎 정적·텍스트 기반 검사라 **런타임/DOM 동작 회귀는 못 잡는다**(깊은 검증은 여전히 수동 `run`/`verify`).
- 👎 가드레일이 코드 구조(모듈 선언·`<script>` 형태)를 가정 → 큰 리팩터 시 테스트도 함께 갱신해야 한다.
- 🧭 세션 시작 때 `.claude/settings.json`이 없었으면 훅이 바로 인식되지 않을 수 있어 `/hooks` 재로드 또는 재시작이 필요하다.

### Alternatives considered
- **Jest / Vitest 등 테스트 프레임워크**: DX는 좋지만 npm 의존성·`package.json`이 필요해 ADR-001 위반. 기각.
- **git `post-commit` 훅**: 커밋 후 테스트는 돌지만 출력이 **Claude 컨텍스트로 돌아오지 않아** 자기수정 루프가 불가능. 기각(사람이 직접 보는 보완재로는 가능).
- **DOM 스텁 단위 테스트**: 순수 함수까지 검증 가능하나 IIFE에서 함수 추출이 필요해 깨지기 쉽고 유지보수 비용이 크다. 현 단계엔 과함. 기각.
