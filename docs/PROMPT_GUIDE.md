# AI 프롬프트 엔지니어링 가이드

AI 호출 코드(채점, 튜터, 문제 생성, OCR 정제, 개념 추출)를 작성·수정할 때 읽는다.

## 공통 규칙

- 모든 프롬프트에 한/영 출력 언어를 명시한다 (deck.lang 기준).
- JSON 파싱 실패 시 에러 메시지를 포함해 최대 2회 재호출한다.
- 채점 결과는 반드시 tool_use로 JSON 스키마를 강제한다. 자유 텍스트 파싱 금지 (CLAUDE.md CRITICAL).

## 역할별 프롬프트

- **채점 프롬프트**: system 롤에 역할("채점관"), 규칙("정답이어도 구멍을 찾는다"), 출력 포맷(JSON schema)을 명시한다.
- **튜터 프롬프트**: system 롤에 "답을 직접 말하지 않는다. 질문으로 돌려보낸다"를 명시한다.

## RAG 컨텍스트 주입

- 채점·튜터 호출 시 Upstage embedding-query로 top-3 청크를 검색해 프롬프트에 주입한다.
- 주입 형식: `## 참고 자료\n출처: {source} p.{page}\n{content}` — 시스템 프롬프트 앞에 붙인다.
- 인덱싱: Upstage embedding-passage, 검색: Upstage embedding-query. 두 모델을 혼용하지 않는다.

## 스트리밍

- 스트리밍 응답(튜터, 채점 피드백)은 SSE 또는 Vercel AI SDK 스트리밍을 사용한다.

파이프라인 전체 구조(OCR 2단계, 엔드포인트 분리 등)는 `docs/ARCHITECTURE.md`를 참고한다.
