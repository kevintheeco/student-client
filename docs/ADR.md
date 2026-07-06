# Architecture Decision Records: 니가 교수

## 철학
학생이 '설명'하게 만드는 서비스. AI는 떠먹여주는 역할이 아니라 질문하고 분석하는 역할.
AI 품질이 곧 학습 효과. 채점과 튜터에서 최고 품질 모델을 쓴다.

---

### ADR-001: Claude를 채점/튜터 기본 모델로 선택
**결정**: 채점(Grading), 튜터(Tutor), 개념 추출은 Claude Sonnet을 기본으로 사용한다.
**이유**: "정답이어도 풀이 과정의 구멍을 찾는" 채점 품질은 Claude가 가장 뛰어나다. 한국어 교육 콘텐츠 이해, 소크라테스식 대화 유도에서도 우위. 학습 효과가 AI 품질에 직결되므로 핵심 태스크에서 타협하지 않는다.
**트레이드오프**: Gemini/Haiku 대비 비용 높음. 빠른 응답이 필요한 단순 태스크(일반 문제 생성, OCR 정제)는 Claude Haiku로 격하.

---

### ADR-002: Upstage Document AI를 OCR 1순위로 선택
**결정**: 손글씨/PDF OCR은 Upstage Document AI를 1순위로 사용한다. 실패 시 Claude Vision → Gemini Vision 순으로 폴백.
**이유**: ref 코드(OCR 실험)에서 검증된 스택. document-ai API는 일반 Vision LLM보다 빠르고 저렴하며 한글 문서에 특화됨. 이미지 전처리(그레이스케일 + quality 50%)로 비용 추가 절감 가능.
**트레이드오프**: Upstage API 의존성 추가. 계정/키 관리 필요. 서비스 장애 시 Vision LLM 폴백으로 대응.

---

### ADR-003: OCR → LLM 정제 2단계 파이프라인
**결정**: OCR raw 결과를 LLM으로 정제(spacing 교정)한 cleaned_text를 채점에 사용한다.
**이유**: ref OCR 실험에서 "base+LLM" 방식이 raw OCR 대비 정확도가 가장 높았음. 손글씨 OCR은 띄어쓰기 오류가 많아 그대로 채점에 쓰면 오채점 위험.
**트레이드오프**: LLM 정제 단계로 레이턴시 증가. Claude Haiku로 비용 최소화.

---

### ADR-004: AI 호출은 서버 사이드에서만
**결정**: 모든 AI API 호출은 서버(API Route / Edge Function)에서만 실행한다. 클라이언트에 AI 키를 노출하지 않는다.
**이유**: B2B 학원 모드에서 계약 API 키가 노출되면 키 도용 위험. 개인 모드도 키 관리 일관성을 위해 동일 원칙 적용.
**트레이드오프**: 클라이언트-서버 왕복 레이턴시 추가. 스트리밍(SSE)으로 체감 지연 최소화.

---

### ADR-005: RAG 청킹 전략 — 상황별 분리
**결정**: 일반 자료는 RecursiveCharacterTextSplitter(size=500, overlap=100), 교재/긴 문서는 SemanticChunker(percentile=95)를 사용한다.
**이유**: ref RAG 서비스에서 두 전략의 장단점이 검증됨. 짧은 자료는 고정 청크로 빠르게 처리. 교재는 의미 단위 경계를 보존하는 SemanticChunker가 개념 완결성을 유지.
**트레이드오프**: SemanticChunker는 임베딩 모델 호출이 추가로 필요해 느림. 짧은 자료에는 오버엔지니어링.

---

### ADR-006: Upstage 임베딩 (passage/query 분리)
**결정**: 인덱싱에는 embedding-passage, 검색 쿼리에는 embedding-query 모델을 사용한다. 유사도는 dotproduct.
**이유**: ref RAG 서비스에서 검증된 패턴. passage와 query는 최적화 방향이 다르므로 모델을 분리하면 검색 정확도가 높아진다. dimension=4096으로 세밀한 의미 구분 가능.
**트레이드오프**: 두 모델 관리. OpenAI text-embedding-3-small보다 비용이 높을 수 있음. 성능이 검증돼 있으므로 우선 채택.

---

### ADR-007: Pinecone을 Vector DB 1순위로
**결정**: Vector DB는 Pinecone Serverless(AWS, us-east-1)를 1순위로 사용한다.
**이유**: ref 코드에서 실제 운영 검증된 스택. 관리형 서비스라 인프라 부담 없음. 메타데이터 필터링(subject, source)으로 덱별 검색 격리 가능.
**트레이드오프**: 별도 계정/비용. MVP 초기에는 pgvector on Supabase로 시작하고 트래픽 증가 시 Pinecone으로 마이그레이션하는 것도 유효.

---

### ADR-008: 채점 결과는 구조화 JSON (tool_use 강제)
**결정**: 채점 LLM 출력을 Anthropic tool_use(function calling)로 강제해 JSON 스키마를 보장한다.
```json
{
  "verdict":      "correct | partial | incorrect",
  "essence":      "핵심 개념 평가",
  "missing":      "빠진 부분 (없으면 null)",
  "gap":          "개념 구멍 (없으면 null)",
  "next":         "다음 보강 포인트",
  "model_answer": "모범 답안"
}
```
**이유**: 자유 텍스트 출력보다 tool_use가 JSON 구조를 더 안정적으로 보장. ref의 XML 구조화 피드백 패턴을 JSON으로 변환한 것.
**트레이드오프**: tool_use는 일반 completion보다 약간 느림. 파싱 실패 가능성을 최소화하므로 trade-off 수용.

---

### ADR-009: 손글씨 이미지는 저장하지 않는다
**결정**: 손글씨 답안 이미지는 OCR 후 즉시 폐기한다. DB나 스토리지에 저장하지 않는다.
**이유**: 저장 비용 절감. 개인정보(학생 필기) 최소 수집 원칙. cleaned_text만 채점에 사용하므로 이미지 보존 불필요.
**트레이드오프**: OCR 오류 재처리 불가. 사용자가 force 제출한 경우 OCR 품질이 낮아도 이미지 참고 불가. 사용자가 re-submit 기능으로 보완.

---

### ADR-010: SRS 인터벌 시험용 단축 (최대 7일)
**결정**: INTERVALS = [0, 0, 1, 2, 4, 7] (box 0~5, 단위: 일). 최대 7일.
**이유**: 대학 시험 주기(2~4주)에 맞게 최대 간격을 7일로 제한. 16일 간격은 시험 준비에 부적합.
**트레이드오프**: 장기 기억 강화보다 단기 시험 대비 최적화. partial은 box 유지(당일 재복습), incorrect는 box-1(더 자주 나옴).

---

### ADR-011: React SPA(Vite) 유지 — Next.js 전환 안 함 (2026-07-04) — **폐기: ADR-012로 대체**
**결정**: 프론트엔드는 Vite + React 18 SPA를 유지한다. Next.js로 전환하지 않는다. AI 백엔드는 Cloudflare Worker 프록시(`proxy/worker.js`)가 담당한다.
**이유**: "AI 호출은 서버 사이드에서만" 규칙은 Worker 프록시가 이미 충족한다. 서비스가 로그인 뒤에서 쓰는 도구형 앱이라 SSR/SEO 가치가 낮고, 파이프라인(OCR·채점·RAG)은 어차피 백엔드 소관이라 프론트 프레임워크와 독립적이다. GitHub Pages(무료) + Worker 배포·CORS·CI가 이미 구축되어 있어 전환은 비용 확정·이득 가설이다. Worker는 CPU 제한이 있으나 AI 프록시는 I/O 대기가 대부분이라 해당 없음.
**트레이드오프**: 인증·레이트리밋·업로드 처리를 Worker에서 직접 구현해야 한다. 프론트/백이 리포 내 별도 조각(src/ vs proxy/)으로 유지된다.
**재검토 트리거**: (1) 검색 유입이 필요한 공개 콘텐츠 페이지가 로드맵에 오를 때, (2) Worker 엔드포인트가 5~6개 이상으로 커져 단일 리포·단일 배포의 이득이 실제로 생길 때.
**후속 조건**: TypeScript + Vitest 점진 도입, worker.js 엔드포인트별 분리 — 이 조건들이 이 결정의 전제다.

---

### ADR-012: Next.js 전환 (2026-07-07) — ADR-011 폐기
**결정**: 프론트엔드를 Next.js(App Router)로 전환한다. ADR-011(React SPA 유지)을 대체한다.
**이유**: 학생별 학습 데이터 분석 결과 제공, 과거 학습 기록 조회 등 서버에서 데이터를 조합·렌더링해야 유리한 화면이 로드맵의 중심이 될 것으로 판단. 서버 컴포넌트/SSR로 처리하면 클라이언트에서 Firestore를 직접 여러 번 조회·조합하는 것보다 초기 로드와 데이터 접근 통제에 유리하다.
**트레이드오프**: GitHub Pages는 정적 호스팅 전용이라 SSR 불가 — 배포처를 Vercel(1순위) 또는 Cloudflare(OpenNext)로 이전해야 한다. 기존 Vite SPA 코드(`src/`) 마이그레이션 비용. Firebase CDN 스크립트 로드 방식(`src/core/platform.js`)은 npm 모듈 방식으로 재작업 필요. ADR-011이 지적한 "로그인 뒤 도구형 앱이라 SSR 가치가 낮다"는 반론은 여전히 유효하나, 분석·기록 화면의 서버 렌더링 수요를 우선했다.
**미결정 (전환 설계 시 확정)**: Cloudflare Worker 프록시(`proxy/worker.js`)를 Next.js API Route/Route Handler로 흡수할지 별도 유지할지. 흡수 시에도 "AI 키는 서버에서만"(ADR-004) 원칙은 동일하게 적용된다.
**전환 완료 전까지**: 현재 코드는 Vite 6 + React 18 SPA 그대로이며, 마이그레이션 전 신규 기능은 기존 구조를 따른다.
