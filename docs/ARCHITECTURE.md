# 아키텍처: 니가 교수

## 전체 구조

```
클라이언트 (브라우저)
  └── API 레이어 (서버)
        ├── Ingestion Pipeline    — 자료 업로드 → 개념 추출
        ├── OCR Pipeline          — 손글씨 → 텍스트
        ├── Generation Pipeline   — 개념 → 문제 생성
        ├── Grading Pipeline      — 답안 → 채점 + 피드백
        ├── Tutor Pipeline        — 소크라테스식 대화 (스트리밍)
        └── RAG Layer             — 벡터 검색 → 컨텍스트 주입
              └── Vector DB (pgvector / Pinecone)
```

---

## 1. Ingestion Pipeline (자료 → 개념 추출)

학습 자료를 업로드해서 AI가 핵심 개념 목록을 추출하는 파이프라인.

```
업로드 (PDF / 이미지 / 손글씨)
  │
  ├─ PDF → 이미지 전처리 (그레이스케일 + quality 50%) → Upstage Document AI OCR
  │         → LLM 정제 (spacing 교정) → 페이지별 텍스트
  │
  └─ 이미지 → 이미지 전처리 → Upstage Document AI OCR → LLM 정제 → 텍스트
  │
  ↓
정제된 텍스트
  → RecursiveCharacterTextSplitter (chunk_size=500, overlap=100)
  → LLM (개념 추출 프롬프트): "이 자료에서 핵심 개념 N개를 추출하라"
  → 구조화된 개념 목록 (개념명 + 한줄 설명)
  → 임베딩 생성 (embedding-passage 모델)
  → Vector DB 저장 (RAG용, 메타데이터: source, page, subject)
  → 개념 스토어 저장 (학습 루프용)
  
중복 방지:
  업로드 시 기존 메타데이터(source)와 비교 → 신규 파일만 처리
```

**교재 모드 (긴 PDF):**
```
긴 PDF → 이미지 전처리 → OCR → 전체 텍스트
  → SemanticChunker (breakpoint_threshold_type="percentile", amount=95)
     (의미 단위로 자름 — 고정 길이보다 개념 경계를 잘 보존)
  → 각 청크: LLM → 대/중/소단원 트리 추출
  → 트리 병합 → 전체 개념 계층 구조 생성
  → 각 개념에 원문 위치(chunkId) 연결
```

**모델 선택:**
- OCR: Upstage Document AI (1순위 — 빠르고 저렴, 한글 손글씨 특화)
- OCR 정제: solar-pro or Claude Haiku (spacing 교정, 짧은 태스크)
- 개념 추출: Claude Sonnet (긴 문서 이해)

---

## 2. OCR Pipeline (손글씨 → 텍스트)

학생이 쓴 손글씨 답안을 텍스트로 변환하는 2단계 파이프라인.

```
손글씨 입력 (canvas → base64 PNG)

[Step 1 — 이미지 전처리]
  이미지 → 그레이스케일 변환 + quality 50% 압축
  (전처리가 OCR 정확도 향상 + API 비용 절감)

[Step 2 — OCR]
  전처리된 이미지 → Upstage Document AI OCR
    → raw_text (spacing이 불규칙할 수 있음)
  폴백: Claude Vision (Upstage 실패 시)

[Step 3 — LLM 정제]
  raw_text → LLM
    프롬프트: "OCR 결과의 본문 내용은 수정하지 않고,
               이상한 띄어쓰기만 교정하라. 본문만 출력하라."
    → cleaned_text (채점 파이프라인으로 전달)

[Step 4 — 불명확 처리]
  정제 결과에 [?] 마커가 있으면 → UI에 재입력 요청
  force 제출 가능 (사용자가 강제 확정)
```

**OCR 공급자 비교:**
| 공급자 | 속도 | 비용 | 한글 손글씨 | 비고 |
|--------|------|------|------------|------|
| Upstage Document AI | 빠름 | 낮음 | 우수 | 1순위, document-ai 특화 |
| Claude Vision | 보통 | 높음 | 우수 | Upstage 실패 시 폴백 |
| Gemini Vision | 빠름 | 낮음 | 양호 | 비용 최적화 폴백 |

**주의사항:**
- 손글씨 이미지 원본은 OCR 완료 후 즉시 폐기. DB/스토리지 저장 금지.
- cleaned_text만 채점 파이프라인으로 전달.

---

## 3. Generation Pipeline (개념 → 문제 생성)

개념과 box 레벨(난이도)에 맞는 문제를 생성하는 파이프라인.

```
입력: 개념명 + 개념 원문(RAG 검색) + box 레벨 + 문제 유형
  → LLM (문제 생성 프롬프트)
  → 출력 (JSON):
      {
        "question": string,
        "questionType": "concept" | "apply" | "derive" | "exam" | "variant",
        "depth": "기초" | "중급" | "심화"
      }

문제 유형:
  - concept  : 개념 설명 (box 0~2) — "~을 설명하라"
  - apply    : 적용/계산 (box 2~4) — "~을 적용하면?"
  - derive   : 유도/증명 (box 4~5) — "~를 유도하라"
  - exam     : 기출 원본 (기출 모드) — 실제 시험 문제
  - variant  : 변형 문제 (재도전) — 숫자/상황/표현만 변경

RAG 컨텍스트 주입:
  개념명으로 벡터 검색 (embedding-query) → top-3 청크
  → 프롬프트 앞에 주입: "## 참고 자료\n{chunk1}\n{chunk2}..."
```

**모델 선택:**
- Claude Haiku: 일반 문제 생성 (빠름, 비용 낮음)
- Claude Sonnet: variant 문제, derive 타입 (추론 필요)

---

## 4. Grading Pipeline (답안 → 채점 + 피드백)

학생 답안을 채점하고 구체적인 피드백을 생성하는 파이프라인.

```
입력: 문제 + 개념 원문(RAG top-3) + cleaned_text(OCR 결과)

→ Claude Sonnet (채점 프롬프트)
    system: "너는 채점관이다. 아래 규칙으로 채점하라:
             1. JSON 포맷만 출력한다.
             2. verdict는 반드시 correct/partial/incorrect 중 하나.
             3. 정답이어도 풀이 과정의 구멍을 찾는다."
    
→ 출력 (구조화 JSON, tool_use 또는 json_mode로 강제):
    {
      "verdict":      "correct" | "partial" | "incorrect",
      "essence":      "핵심 개념 평가 (한 줄)",
      "missing":      "빠진 부분 (없으면 null)",
      "gap":          "개념 구멍 (없으면 null)",
      "next":         "다음 보강 포인트",
      "model_answer": "모범 답안"
    }

→ SRS 업데이트:
    correct   → box = min(5, box+1), dueAt = now + INTERVALS[box+1]
    partial   → box 유지, dueAt = now
    incorrect → box = max(0, box-1), dueAt = now

INTERVALS = [0, 0, 1, 2, 4, 7] (일 단위, box 0~5)
```

**JSON 파싱 실패 시 재시도:**
```
파싱 실패 → 에러 메시지 포함 재호출 (최대 2회)
  프롬프트: "이전 응답이 JSON 파싱 실패했다: {error}. JSON만 출력하라."
2회 모두 실패 → 기본값 반환 (verdict: "partial", 피드백 없음)
```

**보충질문 (Follow-up):**
```
partial/incorrect 시 자동 생성:
  입력: 원래 문제 + cleaned_text + 채점 결과(gap 필드 중심)
  → LLM: 학생 답안의 구체적 빈틈을 찌르는 후속 질문
  → 학생 재답변 → 재채점
  → 보충 correct → finalVerdict = "partial" (box는 유지)
```

**변형 문제 (Variant):**
```
틀렸을 때 선택적으로:
  입력: 원래 문제 + 개념 원문
  → Claude Sonnet: 숫자/상황/표현만 바꾼 동형 문제
  → 학생이 처음부터 다시 풀기 (variant 배지 표시)
```

---

## 5. Tutor Pipeline (소크라테스식 대화)

학생이 개념을 스스로 탐구하도록 유도하는 대화 파이프라인.

```
입력: 개념 + 대화 히스토리 (최근 10턴) + 학생 발화
  + RAG 컨텍스트 (개념 원문 top-3, 매 턴 시스템 프롬프트에 주입)

→ Claude Sonnet (SSE 스트리밍)
    system: "답을 직접 말하지 않는다. 질문으로 돌려보낸다.
             학생이 스스로 발견하도록 유도한다."

→ SSE 스트리밍 응답 → 클라이언트 실시간 렌더링

히스토리 관리:
  - 최근 10턴만 유지 (token 절약)
  - 개념 원문은 히스토리에 포함하지 않고 매 턴 새로 주입
```

---

## 6. RAG Layer (벡터 검색 → 컨텍스트 주입)

AI 호출 시 관련 개념 원문을 벡터 검색으로 가져와 주입하는 레이어.

```
[Ingestion 시 — 인덱싱]
  텍스트 청크 → Upstage embedding-passage → 벡터 → Vector DB
  메타데이터: { deckId, chunkIndex, pageNum, subject, source }
  중복 방지: source 메타데이터로 기존 문서 확인 후 신규만 추가

[AI 호출 시 — 검색]
  쿼리 (개념명 or 문제) → Upstage embedding-query
  → Vector DB 유사도 검색 (dotproduct, top-k=3)
  → 청크 반환 → 프롬프트에 주입

  형식: "## 참고 자료\n출처: {source} p.{page}\n{content}\n---"
```

**청킹 전략:**
| 상황 | 전략 | 설정 |
|------|------|------|
| 일반 PDF/이미지 자료 | RecursiveCharacterTextSplitter | chunk_size=500, overlap=100 |
| 긴 교재 (50페이지+) | SemanticChunker | percentile=95 |
| OCR 손글씨 입력 | SemanticChunker | percentile=95 (의미 단위 보존) |

**임베딩 모델:**
- 인덱싱: Upstage embedding-passage (dimension=4096)
- 검색: Upstage embedding-query (쿼리 최적화)
- 유사도: dotproduct

**Vector DB 선택:**
- Pinecone Serverless (1순위 — 관리형, 스케일 자유)
- pgvector on Supabase (소규모 MVP 대안 — 별도 인프라 없음)

---

## 7. 데이터 모델

```
User          id, email, settings(lang, model), createdAt
Subject       id, userId, name, color
Deck          id, userId, subjectId, name, lang, isExam, createdAt
Concept       id, deckId, name, description, chunkIds[]
ConceptState  id, userId, conceptId, box(0-5), dueAt, lastAnsweredAt
StudySession  id, userId, conceptId, verdict, question, answer, createdAt
Chunk         id, deckId, text, pageNum, chunkIndex, source
              (임베딩 벡터는 Vector DB에 별도 저장, chunkId로 연결)
Note          id, userId, deckId, rawText, cleanedText, filePath, ocrDone
Analysis      id, noteId, chunkNum, ragId, feedback
```

---

## 8. API 엔드포인트

```
POST /api/ingest              — 파일 업로드 → OCR → 개념 추출 (SSE 진행률)
POST /api/ocr                 — 손글씨 이미지 → cleaned_text
POST /api/generate            — 개념 + 레벨 → 문제 생성
POST /api/grade               — 문제 + 답안 → 채점 JSON
POST /api/grade/followup      — 보충질문 생성
POST /api/grade/variant       — 변형 문제 생성
POST /api/tutor               — 소크라테스 대화 (SSE 스트리밍)
GET  /api/study/next          — 오늘 복습할 개념 목록 (SRS 계산)
POST /api/study/result        — 학습 결과 저장 (box 업데이트)
POST /api/rag/vectorstore     — Pinecone 인덱스 초기화
POST /api/rag/document        — PDF → 벡터 DB 추가
GET  /api/rag/status          — 벡터 DB 상태 확인
```

---

## 9. 학습 세션 상태 머신

```
[개념 선택]
     ↓
  PENDING — 오늘 복습할 개념 대기 중
     ↓ 개념 선택 + 문제 생성
  QUESTIONING — 문제 표시, 학생 답변 대기
     ↓ 손글씨 제출
  OCR_PROCESSING — Upstage OCR + LLM 정제 중
     ↓ cleaned_text 확정
  GRADING — Claude Sonnet 채점 중
     ↓ 채점 결과
     ├─ correct   → RESULT(correct) → SRS 업데이트 → 다음 개념
     ├─ partial   → RESULT(partial)
     │                  ├─ 보충질문 선택 → FOLLOWUP_QUESTIONING
     │                  │     ↓ 재답변 → FOLLOWUP_GRADING → RESULT
     │                  └─ 넘어가기 → SRS 업데이트 → 다음 개념
     └─ incorrect → RESULT(incorrect)
                        ├─ 변형 문제 선택 → QUESTIONING (variant)
                        └─ 넘어가기 → SRS 업데이트 → 다음 개념

  TUTOR — 독립적 대화 루프 (학습 루프와 병렬)
     학생 발화 → LLM 스트리밍 → 다음 발화 → ...
     종료 → 학습 루프로 복귀
```

---

## 10. API 요청/응답 스키마

### POST /api/ocr
```json
Request:  { "image": "base64 PNG" }
Response: { "cleanedText": string, "rawText": string, "unclear": boolean }
```

### POST /api/generate
```json
Request:  {
  "conceptId": string,
  "boxLevel": 0-5,
  "questionType": "concept" | "apply" | "derive" | "exam" | "variant",
  "prevQuestion": string | null
}
Response: { "question": string, "questionType": string, "depth": string }
```

### POST /api/grade
```json
Request:  { "conceptId": string, "question": string, "answer": string }
Response: {
  "verdict": "correct" | "partial" | "incorrect",
  "essence": string,
  "missing": string | null,
  "gap": string | null,
  "next": string,
  "modelAnswer": string
}
```

### POST /api/grade/followup
```json
Request:  { "conceptId": string, "question": string, "answer": string, "gradeResult": GradeResult }
Response: { "followupQuestion": string }
```

### POST /api/tutor  (SSE 스트리밍)
```json
Request:  { "conceptId": string, "history": Message[], "userMessage": string }
Response: SSE stream → { "delta": string } | { "done": true }
```

### POST /api/study/result
```json
Request:  { "conceptId": string, "verdict": string, "sessionId": string }
Response: { "newBox": number, "nextDueAt": string }
```

### POST /api/ingest  (SSE 진행률)
```json
Request:  multipart/form-data (file + deckId + lang)
Response: SSE stream → { "progress": 0-100, "status": string }
           → { "done": true, "conceptCount": number }
```

---

## 11. 에러 핸들링 & 폴백 체인

### AI 호출 폴백
```
OCR:
  Upstage Document AI → (실패) → Claude Vision → (실패) → Gemini Vision → 에러 반환

채점/개념추출/문제생성:
  Claude Sonnet → (실패/타임아웃) → Claude Haiku → 에러 반환
  (Gemini 폴백은 채점 품질 저하 위험이 있어 사용하지 않음)

튜터 스트리밍:
  Claude Sonnet → (스트림 끊김) → 재연결 1회 → 에러 반환
```

### JSON 파싱 실패 재시도
```
채점 결과 파싱 실패:
  에러 메시지 포함 재호출 → 최대 2회
  2회 모두 실패 → 기본값 반환:
    { verdict: "partial", essence: "채점 오류", missing: null, gap: null,
      next: "다시 시도해주세요", modelAnswer: "" }
```

### 중복 문서 처리 (Ingestion)
```
업로드 시:
  Pinecone에서 source 메타데이터로 기존 파일 목록 조회
  → 동일 source가 있는 파일은 건너뜀
  → 신규 파일만 OCR → 청킹 → 임베딩 → 저장
  응답에 added_files, skipped_files 목록 포함
```

---

## 12. AI 파이프라인 품질 평가

### OCR 정확도 평가
```
방법: 정답 텍스트(ground truth) vs OCR 결과 단어 매칭률
지표: accuracy = (매칭 단어 수 / 전체 단어 수) × 100
목표: ≥ 90%
전처리 조합 비교: base, gray, quality, gray+quality, base+LLM
```

### RAG 검색 정확도 평가
```
방법: 질문-정답 쌍 평가셋(eval set) 구성 → 검색 결과에 정답 포함 여부
지표: Recall@k (k=3), MRR
도구: LangSmith (tracing + eval)
목표: Recall@3 ≥ 0.85
```

### 채점 일치율 평가
```
방법: 전문가 채점 결과 vs AI 채점 결과 비교
지표: Cohen's Kappa (verdict 3분류 일치율)
샘플: 개념 유형별 100개 답안
목표: Kappa ≥ 0.75
```

---

## 13. 비용 최적화 테이블

| 태스크 | 모델 | 이유 |
|--------|------|------|
| 손글씨 OCR | Upstage Document AI | 빠름, 저렴, 한글 특화 |
| OCR 정제 | Claude Haiku | 짧은 텍스트, 빠름 |
| 개념 추출 | Claude Sonnet | 긴 문서 이해 필요 |
| 문제 생성 (일반) | Claude Haiku | 빠름, 비용 낮음 |
| 문제 생성 (심화) | Claude Sonnet | derive/variant는 추론 필요 |
| 채점 | Claude Sonnet | 핵심 품질 — 타협 없음 |
| 튜터 대화 | Claude Sonnet | 대화 품질, 스트리밍 |
| 임베딩 (인덱싱) | Upstage embedding-passage | Pinecone 4096차원 |
| 임베딩 (검색) | Upstage embedding-query | 쿼리 최적화 |
