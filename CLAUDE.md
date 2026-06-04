# CLAUDE.md — 오늘의 목표 & 회고 (Smart To-do, Ch02 Vibe 실습)

> 이 문서는 매 Claude 세션 시작 시 자동으로 로드됩니다.
> 한 줄 소개: 칸반형 To-do + 일일 회고를 한 화면에서 관리하는 **단일 파일 정적 웹앱**.
> Claude API로 회고 초안·주간 인사이트·우선순위 추천을 제공한다.

마지막 업데이트: 2026-06-04

---

## 1. 절대 규칙 (3~5개)

- **절대 빌드 도구·프레임워크·npm 의존성·외부 CDN을 추가하지 마라** — 이 앱은 의도적으로 단일 `index.html`(바닐라 HTML/CSS/JS)이다. `index.html` 더블클릭만으로 동작해야 한다.
- **절대 이 페이지를 인터넷에 공개 배포하지 마라.** API 키가 `localStorage`에 저장되고 브라우저에서 직접 호출되므로 키가 노출된다. 개인 로컬 사용 전용. 공개하려면 백엔드 프록시가 먼저 필요하다.
- **절대 `localStorage`를 직접 호출하지 마라** — 모든 입출력은 `Store` 객체를 통해서만 (`Store.load/save/getStr/setStr`).
- **절대 날짜 키를 `toISOString()`으로 만들지 마라** — UTC라 자정 근처에 하루가 어긋난다. 반드시 `DateUtil.toKey()`(로컬 자정 기준 `YYYY-MM-DD`).
- **절대 `.env`·실제 API 키를 커밋하지 마라** — `.gitignore`에 이미 제외되어 있다. 키는 코드에 하드코딩하지 말고 ⚙️ 설정 화면에서 입력받는다.

---

## 2. 명령어 치트시트

```bash
# 실행 — 빌드 단계 없음. 둘 중 하나로 연다:
#  1) index.html 더블클릭          → 가장 간단
#  2) 로컬 서버로 열기              → AI 호출이 file:// 에서 막힐 때 권장
python -m http.server 8000        # → http://localhost:8000

# 검증 — 커밋 후 자동 실행되는 가드레일 테스트 (Node 내장 러너, 의존성 0)
node --test                       # tests/*.test.js 실행 — 절대 규칙·JS 문법 검사
```

> 빌드 / lint / typecheck 단계는 **없다(의도적)**. `package.json`도 없다 — npm·번들러·프레임워크 추가는 절대 규칙 위반.
> 단 **검증용 가드레일 테스트는 Node 내장(`node --test`)만** 쓴다(의존성 0이라 절대 규칙과 충돌하지 않음). 커밋하면 `.claude/hooks/post-commit-validate.mjs` 훅이 자동 실행되고, 실패 출력이 컨텍스트로 돌아와 자기수정 루프가 된다 (ADR-005 · `@.claude/docs/architecture.md` 8.1절).
> 그리고 커밋 **직전**엔 `.claude/hooks/pre-commit-review.mjs`(PreToolUse) 훅이 staged diff를 Claude에게 자동 코드 리뷰시킨다 (ADR-006 · 8.2절). 커밋이 한 번 보류되며 — 리뷰를 보고한 뒤 **같은 git commit을 다시 실행**하면 통과한다. 차단할 문제가 있으면 고치고 재시도(수정하면 자동 재리뷰).

---

## 3. 아키텍처 한눈에

```
index.html  ← 전부 여기 한 파일 (<style> + <body> + <script>)
  <style>   CSS 변수 팔레트(:root) — 다크모드는 :root[data-theme="dark"] 한 곳에서
  <body>    2열 대시보드(보드/회고/달력/통계) + 모달 2개(카드 상세 · 설정)
  <script>  전역 모듈 객체들 (모듈 시스템·import 없음)
vibe-notes.md   실습 회고 노트
.env.example    환경변수 템플릿 (현재는 자리표시자 — 백엔드 도입 시 사용)
tests/guardrails.test.js                  가드레일 테스트(절대 규칙·문법) — Node 내장 러너, 의존성 0
.claude/hooks/pre-commit-review.mjs       커밋 전 Claude 자동 코드 리뷰 훅 (ADR-006)
.claude/hooks/post-commit-validate.mjs    커밋 후 가드레일 자동 실행 훅 (ADR-005)
.claude/settings.json                     Pre/PostToolUse 훅 설정 (공유 설정 — 커밋됨)
```

**핵심 모듈** (모두 `<script>` 안의 전역 객체):
- `Store` — localStorage 입출력 단일 창구. 다른 곳에서 localStorage 직접 호출 금지.
- `DateUtil` — 로컬 자정 기준 `YYYY-MM-DD` 키 생성.
- `App.state` — 중앙 상태(보고 있는 날짜, 현재 보드/회고, 파생 캐시).
- `renderAll()` / `refreshDerived()` — **단일 렌더 경로**. 데이터가 바뀌면 이 둘 중 하나로만 다시 그린다.
- `Board` / `Journal` / `Calendar` / `Stats` — 칸반 · 회고 · 기록 달력 · 통계 뷰.
- `Carry` — 구버전 `todos:*` 마이그레이션 + 전날 미완료 카드 자동 이월.
- `AI` — Claude API 직접 호출(회고 초안 / 주간 인사이트 / 우선순위 추천).
- `Backup` — 전체 데이터 JSON 내보내기·가져오기.

**데이터 모델 (localStorage 키)**: `kanban:YYYY-MM-DD`, `journal:YYYY-MM-DD`, `carried:YYYY-MM-DD`, `settings:theme|anthropicKey|model`. 카드/회고 스키마 상세는 `<script>` 상단 주석 참조.

---

## 4. 컨벤션

### 언어 / 스타일
- UI 텍스트·toast·주석은 모두 **한국어**.
- 외부 CSS 없음. 모든 색은 `:root` CSS 변수로 정의 → 새 색도 변수로 추가하고 다크 팔레트(`:root[data-theme="dark"]`)에도 같이 넣는다.

### JS
- 전역 모듈 객체 패턴(`const X = { ... }`)을 따른다. 새 기능도 같은 형태로 한 모듈에 모은다.
- 상태를 바꾼 뒤에는 반드시 `renderAll()` 또는 `refreshDerived()`로 다시 그린다 — DOM 직접 조작을 여기저기 흩지 않는다.
- 회고 입력은 디바운스 자동 저장이다. 날짜 이동·페이지 언로드 전에 `Journal.flush()`로 미저장 손실을 막는다.

### 알림 / 에러
- 사용자 알림은 `Toast.show()`. AI·회고 결과는 각 전용 출력 박스에 표시한다.
- AI 호출 실패 메시지는 사용자에게 친절한 한국어로(키 누락·`file://` 차단 안내 포함).

---

## 5. 지금 진행 중 (TODO)

> 90분 Vibe 실습으로 기능은 완성됨. 아래는 외부 공개 전 보완 항목 (`vibe-notes.md` 참조).

- [x] 커밋 후 검증 루프 도입 — 가드레일 테스트 + `PostToolUse` 훅 (ADR-005). **활성화**: `/hooks`를 한 번 열거나 Claude Code 재시작(세션 시작 시 `settings.json`이 없었기 때문).
- [x] 커밋 **전** 자동 코드 리뷰 friction 도입 — `PreToolUse(Bash git commit)` 훅이 staged diff를 Claude에게 리뷰시킨다 (ADR-006). **활성화**: `/hooks` 한 번 열기 또는 재시작.
- [ ] 코드 리뷰 / 리팩터 미실시 — 외부 사용자 공개 전 점검 필요(위 훅은 *신규 커밋분*만 리뷰 — 기존 코드 전체 1회 점검은 별개)
- [ ] UI/UX 다듬기 미실시
- [ ] 공개 배포하려면 API 키를 브라우저에서 분리하고 백엔드 프록시 도입

---

## 6. 참고 자료 (선택)

> `@` 참조는 Claude가 필요할 때만 로드한다(lazy load). 이것이 CLAUDE.md를 짧게 유지하는 비결.

- 아키텍처 deep dive(모듈·렌더 파이프라인·데이터 모델): `@.claude/docs/architecture.md`
- 아키텍처 의사결정 기록(ADR): `@.claude/docs/decisions.md`
- 실습 회고 노트: `@vibe-notes.md`
- 환경변수 템플릿: `@.env.example`
- Claude API 문서: https://docs.anthropic.com (모델 ID는 ⚙️ 설정의 드롭다운 참고)

---

## 7. 문서 유지보수 규칙 (agentic engineering)

이 문서들은 **코드와 함께 살아 있어야** 한다. 변경 작업을 끝낼 때 같은 커밋에서 갱신한다.

- **구조·모듈·렌더 경로·데이터 모델**을 바꾸면 → `.claude/docs/architecture.md` 갱신.
- **되돌리기 어려운 큰 선택**을 하면 → `.claude/docs/decisions.md`에 새 ADR 추가(기존 ADR은 수정하지 말고 번호 추가, 뒤집힌 결정은 `Superseded by`로 표시).
- **절대 규칙·치트시트·컨벤션**이 바뀌면 → 이 파일(CLAUDE.md) 갱신.
- 문서를 고치면 해당 파일 상단의 **"마지막 업데이트"** 날짜도 함께 바꾼다.
- 원칙: 코드를 읽으면 알 수 있는 것(시그니처 등)은 적지 않는다. **"왜"와 제약**을 적는다.
