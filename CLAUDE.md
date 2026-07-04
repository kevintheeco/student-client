# 프로젝트: 니가 교수 (YouareProfessor)

## 서비스 핵심
학생이 스스로 설명하게 만들고, 그 과정을 분석해 약점을 채우는 자기주도 학습 플랫폼.
"설명할 수 있어야 진짜 아는 것이다" — 지식 소비가 아닌 설명 능력을 기른다.

## 기술 스택 (2026-07 결정: React SPA 유지, Next.js 전환 안 함 — docs/ADR.md 참고)
- Vite 6 + React 18 (JavaScript/JSX — TypeScript는 점진 전환 예정)
- 배포: GitHub Pages (`.github/workflows/deploy.yml`, https://youareprofessor.github.io)
- AI 백엔드: Cloudflare Worker 프록시 (`proxy/worker.js`, `/claude` 엔드포인트, 학원코드→키 매핑은 `ACADEMY_KEYS` 시크릿)
- 데이터/인증: Firebase (Auth + Firestore, CDN 스크립트 로드 — `src/core/platform.js`, 규칙은 `firestore.rules`)
- 프론트 구조: `src/core/`(ai.js·platform.js·srs.js), `src/ui/`(공용 컴포넌트), `src/views/`(화면)

## 아키텍처 규칙
- CRITICAL: AI 호출은 반드시 Cloudflare Worker 프록시(`proxy/worker.js`)를 경유한다. 클라이언트에서 AI API 키를 직접 사용하지 않는다.
- CRITICAL: 모든 AI 파이프라인은 docs/ARCHITECTURE.md 의 파이프라인 설계를 따른다.
- CRITICAL: OCR, 채점, 문제 생성, 튜터는 Worker 안에서 각각 독립된 엔드포인트로 분리한다 (현재 `/claude` 단일 — 신규 파이프라인 추가 시 분리).
- CRITICAL: 채점 결과는 반드시 tool_use로 JSON 스키마를 강제한다. 자유 텍스트 파싱 금지.
- CRITICAL: 손글씨 이미지는 OCR 완료 즉시 폐기한다. DB/스토리지에 저장 금지.
- CRITICAL: 토큰/키는 코드에 리터럴로 쓰지 않는다. 환경변수 이름으로만 접근하고(`process.env.X`, `os.environ["X"]`, worker `env.X`), 값은 gitignore된 `.env`·`.dev.vars` 또는 시크릿 매니저(wrangler secret)에만 둔다. PreToolUse 훅이 위반을 차단한다.

## 문서 맵 — 필요할 때만 읽는다
- `docs/PRD.md` — 기획·기능 요구사항
- `docs/ARCHITECTURE.md` — 파이프라인·디렉토리 구조 (AI 파이프라인 작업 전 필독)
- `docs/ADR.md` — 기술 선택 근거
- `docs/UI_GUIDE.md` — 화면·디자인
- `docs/PROMPT_GUIDE.md` — AI 프롬프트 작성 규칙 (AI 호출 코드 작성·수정 전 필독)
- `.claude/skills/harness/SKILL.md` — 작업 워크플로우 (harness 스킬)

## 업무 방식
- 할 일은 두 곳에서 온다: (1) 기획자가 별도 브랜치에서 바이브코딩한 작업물 — 개발자가 인수해 리뷰·수정한다, (2) 이슈 — 루트 `ISSUES.md`와 GitHub 이슈.
- 작업 시작 시 `git fetch` 후 새 브랜치의 변경 사항(main 대비 diff)과 이슈 내용을 먼저 읽는다. 상세 워크플로우는 harness 스킬 참고.
- 기획자 브랜치의 코드는 검증 전까지 신뢰하지 않는다. CRITICAL 규칙·아키텍처 위반, 보안 문제를 리뷰한 뒤 수정한다. 단, 기획자가 구현한 기능 동작(스펙)은 임의로 바꾸지 않는다.

## 개발 프로세스
- CRITICAL: 새 기능 구현 시 테스트를 먼저 작성하고 통과하는 구현을 작성한다 (TDD). 단, 테스트 러너(Vitest)는 아직 미도입 — 도입 전까지는 `npm run lint` + 수동 스모크로 검증하고, Vitest 도입이 선행 과제다.
- 커밋 메시지는 conventional commits 형식 (feat:, fix:, docs:, refactor:) — PreToolUse 훅(`scripts/hooks/guard.py`)이 형식과 시크릿 포함 여부를 자동 검증한다.

## 명령어
```
npm run dev        # 개발 서버 (Vite)
npm run build      # 프로덕션 빌드
npm run preview    # 빌드 결과 로컬 확인
npm run lint       # ESLint (src)
python3 scripts/execute.py <phase-dir>         # Harness 실행
python3 scripts/execute.py <phase-dir> --push  # 실행 후 push
```
