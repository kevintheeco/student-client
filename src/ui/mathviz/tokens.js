// mathviz 디자인 토큰 — 벡터수학엔진 §1 확정값. 구조·타이밍은 고정, 색은 테마별 세트.
// 대비 전부 ≥4.5:1 (벤치마크 원본의 최대 약점 보완 — muted 포함)

// 다크 칠판 세트 — 벤치마크 릴스의 시각 문법 (데모 토글·향후 다크모드용)
export const VIZ = {
  bg: "#0a0a0c",                 // 칠판
  board: "#101014",              // 보드 카드
  chalk: "#f2f0eb",              // 기본 선·텍스트
  muted: "#8e8a93",              // 유도 중간 단계 (bg 대비 약 5.8:1)
  grid: "#2a2a30",               // 눈금·보조 격자
  accent: { algebra: "#e8a0bf", geometry: "#e7b36a", sequence: "#58c4dd" },
  point: "#f5a623",              // 교점·특이점 (오렌지)
  student: "#58c4dd",            // 학생 그림 재구성 색
  fix: "#f5a623",                // 보완 오버레이 색
  ok: "#7bc98a",
};

// 라이트 세트 (기본) — 앱 브랜드 팔레트의 어두운 변형, 전부 #FFFDF8 대비 ≥4.5:1 수치 검증
export const VIZ_LIGHT = {
  bg: "#FFFDF8",                 // 앱 그래프 배경색 그대로
  board: "#FFFDF8",
  chalk: "#221C39",              // --ink (15.97:1)
  muted: "#6B6486",              // --sub(#857FA0)은 3.73:1 탈락 → 같은 계열 어둡게 (5.45:1)
  grid: "#E4DFEA",
  accent: {
    algebra: "#5A48E0",          // --pri-d 브랜드 보라 (6.01:1) — 장미색은 오답 표시와 혼동돼 제외(2026-07-07 대표 결정)
    geometry: "#8A5A12",         // 앱 골드 텍스트색(derive-hint와 동일) (5.82:1)
    sequence: "#147A5C",         // --mint 계열 다크 (5.21:1)
  },
  point: "#B45309",              // --gold 계열 다크 (4.94:1)
  student: "#5A48E0",            // 학생 그림 재구성 = 앱 대표 보라 (6.01:1)
  fix: "#B45309",                // 보완 오버레이 — 학생 보라와 명확 구분
  ok: "#147A5C",                 // --mint 계열 다크 (5.21:1)
};

// 애니메이션 타이밍 (ms) — 역공학 확정값, 테마와 무관하게 고정
export const TIMING = {
  lineWrite: 800,   // 유도 한 줄 등장
  lineGap: 300,     // 줄 사이 간격
  drawOn: 1000,     // 곡선·화살표·직선 그리기
  drawOnLong: 2000, // 긴 곡선
  cardFade: 500,    // 장면 전환 페이드 (하드컷 금지)
  cellWalk: 1000,   // 행렬 셀 워크스루 셀당
};

export const LONG_CURVE_PX = 1200;  // 이 픽셀 길이 초과 곡선은 drawOnLong 적용

// 기본 = 라이트(우리 앱 톤). "dark"를 명시할 때만 칠판 세트
export function vizTheme(theme){ return theme === "dark" ? VIZ : VIZ_LIGHT; }
