// mathviz 디자인 토큰 — 벡터수학엔진 §1 확정값. 구조·타이밍은 고정, 색은 테마별 세트.
// 대비 전부 ≥4.5:1 (벤치마크 원본의 최대 약점 보완 — muted 포함)

// 다크 칠판 세트 (기본) — 벤치마크 릴스의 시각 문법 그대로
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

// 라이트 반전 세트 — 앱 크림 톤(#FFFDF8) 위에서 4.5:1 확보한 어두운 변형
export const VIZ_LIGHT = {
  bg: "#FFFDF8",
  board: "#FFFDF8",
  chalk: "#221C39",
  muted: "#5F5A6B",
  grid: "#E4DFEA",
  accent: { algebra: "#B3286B", geometry: "#8A5B12", sequence: "#0E7A93" },
  point: "#B45309",
  student: "#0E7A93",
  fix: "#B45309",
  ok: "#2E7D32",
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

export function vizTheme(theme){ return theme === "light" ? VIZ_LIGHT : VIZ; }
