# UI 디자인 가이드: 니가 교수

## 디자인 원칙
1. **도구처럼 보여야 한다** — 학습 앱은 매일 쓰는 도구다. 마케팅 페이지가 아니다.
2. **손글씨 입력이 1등 시민** — 태블릿/S펜 UX를 PC보다 먼저 고려한다.
3. **두 개의 스킨, 하나의 시스템** — B2C(개인)와 B2B(학원)는 같은 컴포넌트, 다른 CSS 변수로 분리한다.
4. **수식과 표는 네이티브 수준으로** — KaTeX 렌더링, 마크다운 표, SVG 그래프를 깨지지 않게 처리한다.

## AI 슬롭 안티패턴 — 하지 마라
| 금지 사항 | 이유 |
|-----------|------|
| backdrop-filter: blur() | glass morphism은 AI 템플릿의 가장 흔한 징후 |
| gradient-text (배경 그라데이션 텍스트) | AI가 만든 SaaS 랜딩의 1번 특징 |
| "Powered by AI" 배지 | 기능이 아니라 장식. 사용자에게 가치 없음 |
| box-shadow 글로우 애니메이션 | 네온 글로우 = AI 슬롭 |
| 기존 --pri 색상 임의 변경 | B2C=#6C5CE7, B2B=#27406B 로 확정. 변경 금지 |
| 모든 카드에 동일한 rounded-2xl | 균일한 둥근 모서리는 템플릿 느낌 |
| 배경 gradient orb (blur-3xl 원형) | 모든 AI 랜딩 페이지에 있는 장식 |

## 색상 시스템

### B2C 개인 모드 (기본)
| 변수 | 값 | 용도 |
|------|----|------|
| --bg | #F3F1FB | 페이지 배경 |
| --card | #fff | 카드 배경 |
| --ink | #221C39 | 주 텍스트 |
| --sub | #857FA0 | 보조 텍스트 |
| --line | #ECE9F6 | 구분선/테두리 |
| --pri | #6C5CE7 | 주 색상 (버튼, 강조) |
| --pri-d | #5A48E0 | 주 색상 hover |
| --pri-s | #EEEBFE | 주 색상 배경 (선택 상태) |
| --mint | #27C2A0 | 긍정/정답/완료 |
| --rose | #FF6B8A | 부정/오답/경고 |
| --gold | #FFC24B | 중립/힌트/부분정답 |
| --peach | #FF8E72 | 강조 보조 |

### B2B 학원 모드 (.academy-skin)
| 변수 | 값 | 용도 |
|------|----|------|
| --bg | #EDF1F6 | 페이지 배경 |
| --card | #fff | 카드 배경 |
| --ink | #1A2436 | 주 텍스트 |
| --sub | #5B6779 | 보조 텍스트 |
| --line | #DCE3EC | 구분선/테두리 |
| --pri | #27406B | 주 색상 (네이비) |
| --pri-d | #1B2D4D | 주 색상 hover |
| --pri-s | #EAF0F7 | 주 색상 배경 |
| --mint | #2F855A | 긍정/정답 |
| --rose | #C0392B | 부정/오답 |
| --gold | #B7791F | 중립/힌트 |

### 스킨 전환 메커니즘
```
URL에 #academy={코드} 포함 여부로 자동 전환.
B2B 진입: <body> 또는 루트 컴포넌트에 .academy-skin 클래스 추가
B2C 진입: .academy-skin 클래스 없음 (기본 CSS 변수 사용)

CSS 스코프: body:has(.academy-skin) { background: #EDF1F6 }
컴포넌트: academy-skin 클래스가 조상에 있을 때 CSS 변수가 오버라이드됨
```

## 컴포넌트

### 카드
```css
.card { background:var(--card); border:1px solid var(--line); border-radius:22px; box-shadow:var(--sh); }
```

### 버튼
```
Primary: background:var(--pri); color:#fff; border-radius:14px; font-weight:700
Ghost:   background:#fff; border:1.5px solid var(--line)
Active:  .on → border-color:var(--pri); color:var(--pri); background:var(--pri-s)
Sizes:   .sm (8/13px padding), .xs (6/10px), .ico (아이콘 전용 9/11px)
```

### 배지 / 레이블
```
과목 배지: border-radius:999px; font-size:11px; font-weight:700
verdict:
  correct  → color:var(--mint)
  partial  → color:var(--gold)
  incorrect→ color:var(--rose)
```

## 레이아웃
- 전체 너비: max-width:1440px, padding: clamp(14px, 3vw, 28px)
- 덱 그리드: grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap:14px
- 버튼 그룹: gap:8px~10px

## 타이포그래피
| 용도 | 스타일 |
|------|--------|
| 브랜드/섹션 제목 | font-family: 'Jua' (B2C) |
| 본문 | font-family: 'Noto Sans KR' |
| 학원 모드 | font-family: 'Pretendard', 'Noto Sans KR' |
| 보조 레이블 | .eyebrow — 12px; letter-spacing:1px; color:var(--pri) |
| 에러 | .err — color:#E0466A; 13px |
| 힌트 | .hint — 12.5px; color:var(--sub); line-height:1.7 |

## 애니메이션
- 버튼 클릭: transform scale(.97), 0.12s
- 박스 그림자 전환: transition 0.2s
- 진행률 바: width 0.5s ease
- 그 외 추가 금지

## 수식 & 마크다운 렌더링
- KaTeX auto-render: `$...$` (인라인), `$$...$$` (블록)
- `\[...\]`, `\(...\)` → 렌더 전 `$$`, `$` 로 정규화
- 통화 `\$` 는 수식으로 오인하지 않도록 이스케이프 보호
- 마크다운 표: 정렬(`:---:`) 및 셀 내 수식 지원
- 여러 줄 디스플레이 수식(행렬, aligned)은 `$$` 블록으로 먼저 분리 후 렌더

## 손글씨 입력 (PenPad)
- 기본 도구: 펜 (검정, strokeWidth 2~3)
- 지우개: S펜 배럴 버튼(button value 2/32/5) 또는 화면 토글
- OCR 불명확 처리: 불명확 글자 위치에 빨간 박스 오버레이 → 지우개 모드 자동 전환
- force 제출: OCR 불명확이 있어도 "이대로 제출" 버튼으로 강제 확정 가능

## 아이콘
- 이모지 아이콘 사용 (SVG 아이콘 컨테이너 박스로 감싸지 않는다)
- 버튼 내 아이콘: .btn.ico 클래스 사용
