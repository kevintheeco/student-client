/* ════════════════════════════════════════════════════════════════
   수학 지식 그래프 — 대한민국 교육과정(2022 개정) 중1 ~ 미적분
   노드 = 단원(개념 묶음), 엣지 = 선수관계(가중치 = 의존 강도 0~1).
   "이 문제를 틀린 근본 원인이 어느 선수 개념의 결여인가"를
   그래프 역추적(traceRootCauses)으로 계산하는 데 쓰인다.
   단원명은 Academy.jsx CURRICULUM과 동일하게 유지할 것 (시험 unit 매핑).

   능력 요인(FACTORS)은 수학교육 표준 문헌의 5-strand 모델 기반:
   Kilpatrick·Swafford·Findell, "Adding It Up" (NRC, 2001)
   — 개념적 이해 / 절차적 유창성 / 전략적 역량 / 적응적 추론 / 생산적 성향.
   선수관계 역추적의 이론적 토대: Knowledge Space Theory
   (Doignon & Falmagne, 1985 — ALEKS의 기반 이론).
════════════════════════════════════════════════════════════════ */

/* ── 능력 요인 (NRC 5-strand) ──
   cu·pf·sc·ar는 AI 채점에서 문항별 0~2점으로 평가(→0~1 정규화),
   pd(생산적 성향)는 행동 데이터(오답 후 재도전율·후속질문 참여)로 산출. */
const FACTORS=[
  {id:"cu",name:"개념 이해",en:"Conceptual understanding",desc:"개념·연산·관계를 '왜 그런지'까지 이해",color:"#6C5CE7",ai:true},
  {id:"pf",name:"절차 유창성",en:"Procedural fluency",desc:"계산·절차를 정확하고 효율적으로 수행",color:"#4FACFE",ai:true},
  {id:"sc",name:"전략적 역량",en:"Strategic competence",desc:"문제를 해석하고 식을 세워 수학적으로 표현",color:"#27C2A0",ai:true},
  {id:"ar",name:"적응적 추론",en:"Adaptive reasoning",desc:"논리적으로 전개하고 정당화·설명",color:"#FFC24B",ai:true},
  {id:"pd",name:"생산적 성향",en:"Productive disposition",desc:"끈기 — 틀려도 다시 도전하는 태도(행동 데이터로 측정)",color:"#FF6B8A",ai:false},
];
// AI 채점 응답의 한글 요인명 → 요인 id (FACTORS: 개념=2 계산=1 … 형식 파싱용)
const FACTOR_KO={"개념":"cu","계산":"pf","전략":"sc","식":"sc","추론":"ar","논리":"ar"};
// 원시 요인값(0~2 or 한글 키 객체)을 {cu,pf,sc,ar} 0~1로 정규화. 유효값 없으면 null.
function normFactors(raw){
  if(!raw||typeof raw!=="object")return null;
  const out={};let found=false;
  for(const k in raw){
    const id=FACTOR_KO[k]||(FACTORS.some(f=>f.id===k)?k:null);
    const v=Number(raw[k]);
    if(id&&isFinite(v)){out[id]=Math.max(0,Math.min(1,v>1?v/2:v));found=true;}
  }
  return found?out:null;
}

/* ── 과정(시계열 축) & 영역 ── */
const COURSES=[
  {id:"m1",name:"중1",order:0},{id:"m2",name:"중2",order:1},{id:"m3",name:"중3",order:2},
  {id:"cm1",name:"공통수학1",order:3},{id:"cm2",name:"공통수학2",order:4},
  {id:"s1",name:"수학Ⅰ",order:5},{id:"s2",name:"수학Ⅱ",order:6},
  {id:"prob",name:"확률과 통계",order:7},{id:"calc",name:"미적분",order:8},
];
const STRANDS=[
  {id:"num",name:"수와 연산",color:"#FF8E72"},
  {id:"alg",name:"문자와 식",color:"#6C5CE7"},
  {id:"fun",name:"함수",color:"#4FACFE"},
  {id:"geo",name:"기하",color:"#27C2A0"},
  {id:"sta",name:"확률·통계",color:"#FFC24B"},
  {id:"cal",name:"해석(미적분)",color:"#FF6B8A"},
];

/* ── 노드: id, 과정, 단원명(CURRICULUM과 동일), 영역, 매칭 키워드 ── */
const N=(id,course,name,strand,kw)=>({id,course,name,strand,kw:kw||[]});
const GRAPH_NODES=[
  // 중1
  N("m1_prime","m1","소인수분해","num",["소인수","거듭제곱","최대공약수","최소공배수","약수","배수"]),
  N("m1_int","m1","정수와 유리수","num",["음수","절댓값","유리수","수직선","사칙연산"]),
  N("m1_expr","m1","문자의 사용과 식의 계산","alg",["문자식","대입","동류항","일차식"]),
  N("m1_lineq","m1","일차방정식","alg",["방정식","등식의 성질","이항","해"]),
  N("m1_coord","m1","좌표평면과 그래프(정비례·반비례)","fun",["좌표","순서쌍","정비례","반비례","그래프"]),
  N("m1_geo","m1","기본 도형","geo",["점선면","맞꼭지각","수직","평행","동위각","엇각"]),
  N("m1_cong","m1","작도와 합동","geo",["작도","합동","대응변","대응각"]),
  N("m1_plane","m1","평면도형의 성질","geo",["다각형","내각","외각","부채꼴","호","원주율"]),
  N("m1_solid","m1","입체도형의 성질","geo",["다면체","회전체","겉넓이","부피","각기둥","원뿔"]),
  N("m1_data","m1","자료의 정리와 해석","sta",["도수분포표","히스토그램","상대도수","줄기와 잎"]),
  // 중2
  N("m2_recur","m2","유리수와 순환소수","num",["순환소수","유한소수","기약분수"]),
  N("m2_poly","m2","단항식과 다항식의 계산","alg",["지수법칙","단항식","다항식","전개"]),
  N("m2_ineq","m2","일차부등식","alg",["부등식","부등호"]),
  N("m2_sys","m2","연립일차방정식","alg",["연립방정식","대입법","가감법"]),
  N("m2_linfun","m2","일차함수와 그래프","fun",["일차함수","기울기","절편"]),
  N("m2_lineq2","m2","일차함수와 일차방정식","fun",["직선의 방정식","교점","연립방정식의 해"]),
  N("m2_tri","m2","삼각형의 성질","geo",["이등변삼각형","외심","내심","직각삼각형"]),
  N("m2_quadr","m2","사각형의 성질","geo",["평행사변형","직사각형","마름모","사다리꼴"]),
  N("m2_sim","m2","도형의 닮음","geo",["닮음","닮음비","중점연결정리","평행선과 선분"]),
  N("m2_pyth","m2","피타고라스 정리","geo",["피타고라스","빗변"]),
  N("m2_case","m2","경우의 수와 확률","sta",["경우의 수","확률"]),
  // 중3
  N("m3_sqrt","m3","제곱근과 실수","num",["제곱근","무리수","실수","근호","분모의 유리화"]),
  N("m3_factor","m3","다항식의 곱셈과 인수분해","alg",["곱셈공식","인수분해","완전제곱식"]),
  N("m3_quad","m3","이차방정식","alg",["이차방정식","근의 공식","중근"]),
  N("m3_quadfun","m3","이차함수","fun",["이차함수","포물선","꼭짓점","축"]),
  N("m3_trig","m3","삼각비","geo",["삼각비","사인","코사인","탄젠트","sin","cos","tan"]),
  N("m3_circle","m3","원의 성질","geo",["원주각","중심각","접선","현"]),
  N("m3_stat","m3","대푯값과 산포도","sta",["평균","중앙값","최빈값","분산","표준편차","산점도","상관관계"]),
  // 공통수학1
  N("cm1_polyop","cm1","다항식의 연산","alg",["다항식의 나눗셈","조립제법","곱셈공식의 변형"]),
  N("cm1_rem","cm1","나머지정리와 인수분해","alg",["나머지정리","인수정리","고차식의 인수분해"]),
  N("cm1_complex","cm1","복소수와 이차방정식","alg",["복소수","허수","판별식","근과 계수의 관계"]),
  N("cm1_quadfun","cm1","이차방정식과 이차함수","fun",["이차함수의 최대최소","그래프와 교점","이차함수와 직선"]),
  N("cm1_eqs","cm1","여러 가지 방정식","alg",["삼차방정식","사차방정식","연립이차방정식"]),
  N("cm1_ineqs","cm1","여러 가지 부등식","alg",["이차부등식","연립부등식","절댓값 부등식"]),
  N("cm1_perm","cm1","순열과 조합","sta",["순열","조합","팩토리얼"]),
  N("cm1_matrix","cm1","행렬과 그 연산","alg",["행렬","성분","행렬의 곱셈"]),
  // 공통수학2
  N("cm2_coord","cm2","평면좌표와 직선의 방정식","geo",["두 점 사이의 거리","내분점","직선의 방정식","수직과 평행"]),
  N("cm2_circle","cm2","원의 방정식","geo",["원의 방정식","접선의 방정식","반지름"]),
  N("cm2_move","cm2","도형의 이동","geo",["평행이동","대칭이동"]),
  N("cm2_set","cm2","집합","alg",["집합","부분집합","교집합","합집합","여집합","드모르간"]),
  N("cm2_prop","cm2","명제","alg",["명제","역","대우","필요조건","충분조건","귀류법","증명"]),
  N("cm2_fun","cm2","함수","fun",["정의역","치역","합성함수","역함수","일대일대응"]),
  N("cm2_rat","cm2","유리함수와 무리함수","fun",["유리함수","무리함수","점근선"]),
  // 수학Ⅰ
  N("s1_log","s1","지수와 로그","alg",["거듭제곱근","로그","상용로그","밑"]),
  N("s1_expfun","s1","지수함수와 로그함수","fun",["지수함수","로그함수","지수방정식","로그부등식"]),
  N("s1_trifun","s1","삼각함수","fun",["호도법","라디안","주기","삼각함수의 그래프","사인함수","코사인함수"]),
  N("s1_sincos","s1","사인법칙과 코사인법칙","geo",["사인법칙","코사인법칙","삼각형의 넓이","외접원"]),
  N("s1_seq","s1","등차수열과 등비수열","alg",["등차수열","등비수열","공차","공비","일반항"]),
  N("s1_sum","s1","수열의 합","alg",["시그마","자연수 거듭제곱의 합","부분분수"]),
  N("s1_ind","s1","수학적 귀납법","alg",["귀납법","귀납적 정의","점화식"]),
  // 수학Ⅱ
  N("s2_lim","s2","함수의 극한","cal",["극한","수렴","발산","극한값","좌극한","우극한"]),
  N("s2_cont","s2","함수의 연속","cal",["연속","불연속","사잇값 정리","최대최소 정리"]),
  N("s2_diff","s2","미분계수와 도함수","cal",["미분계수","도함수","순간변화율","접선의 기울기","미분법"]),
  N("s2_diffapp","s2","도함수의 활용","cal",["접선의 방정식","증가와 감소","극대","극소","방정식의 실근"]),
  N("s2_anti","s2","부정적분","cal",["부정적분","적분상수","원시함수"]),
  N("s2_int","s2","정적분","cal",["정적분","구분구적법","미적분의 기본정리"]),
  N("s2_intapp","s2","정적분의 활용","cal",["넓이","속도와 거리"]),
  // 확률과 통계
  N("pr_perm","prob","순열과 조합","sta",["원순열","중복순열","중복조합","같은 것이 있는 순열"]),
  N("pr_binom","prob","이항정리","sta",["이항정리","이항계수","파스칼의 삼각형"]),
  N("pr_prob","prob","확률의 뜻과 활용","sta",["수학적 확률","여사건","확률의 덧셈정리"]),
  N("pr_cond","prob","조건부확률","sta",["조건부확률","독립","종속","확률의 곱셈정리"]),
  N("pr_rv","prob","확률변수와 확률분포","sta",["확률변수","확률분포","기댓값"]),
  N("pr_normal","prob","이항분포와 정규분포","sta",["이항분포","정규분포","표준화","표준정규분포"]),
  N("pr_est","prob","통계적 추정","sta",["모평균","표본평균","신뢰구간","모비율"]),
  // 미적분
  N("ca_limseq","calc","수열의 극한","cal",["수열의 극한","등비수열의 극한"]),
  N("ca_series","calc","급수","cal",["급수","등비급수","부분합"]),
  N("ca_dfelem","calc","지수·로그·삼각함수의 미분","cal",["자연로그","자연상수","덧셈정리","삼각함수의 극한"]),
  N("ca_dfmeth","calc","여러 가지 미분법","cal",["합성함수의 미분","몫의 미분","음함수","매개변수","이계도함수"]),
  N("ca_dfapp","calc","도함수의 활용","cal",["변곡점","그래프의 개형","속도와 가속도"]),
  N("ca_intmeth","calc","여러 가지 적분법","cal",["치환적분","부분적분"]),
  N("ca_intapp","calc","정적분의 활용","cal",["입체의 부피","곡선의 길이"]),
];

/* ── 엣지: [선수, 후속, 가중치, 근거] — 가중치 = "후속을 틀렸을 때 선수 결여를 의심할 강도" ── */
const E=(from,to,w,why)=>({from,to,w,why});
const GRAPH_EDGES=[
  // 수와 연산 → 대수의 뿌리
  E("m1_int","m1_expr",0.7,"음수·유리수 사칙연산이 문자식 계산의 기초"),
  E("m1_int","m1_lineq",0.6,"이항·양변 연산은 정수·유리수 연산 감각에 의존"),
  E("m1_expr","m1_lineq",0.9,"등식 조작은 문자식 계산 그 자체"),
  E("m1_prime","m2_recur",0.5,"유한소수 판정은 분모의 소인수 분석"),
  E("m1_prime","m3_sqrt",0.6,"근호를 간단히 하기는 소인수분해로 한다"),
  E("m1_expr","m2_poly",0.8,"다항식 계산은 문자식·동류항 정리의 확장"),
  // 방정식·부등식 계열
  E("m1_lineq","m2_ineq",0.8,"부등식 풀이 절차는 일차방정식과 동형(부호 반전만 추가)"),
  E("m1_lineq","m2_sys",0.9,"연립방정식은 일차방정식 풀이의 결합"),
  E("m2_poly","m3_factor",0.9,"곱셈공식·인수분해는 다항식 전개의 역과정"),
  E("m3_factor","m3_quad",0.9,"이차방정식의 기본 풀이는 인수분해"),
  E("m3_sqrt","m3_quad",0.7,"근의 공식은 제곱근 계산을 요구"),
  E("m3_quad","cm1_complex",0.8,"판별식·근과 계수의 관계는 이차방정식 이해의 심화"),
  E("m3_sqrt","cm1_complex",0.5,"허수 단위는 음수의 제곱근 개념에서 출발"),
  E("m2_poly","cm1_polyop",0.8,"다항식의 곱셈·나눗셈은 지수법칙·전개 위에서"),
  E("m3_factor","cm1_rem",0.9,"고차식 인수분해는 중3 인수분해 기능에 직접 의존"),
  E("cm1_polyop","cm1_rem",0.7,"나머지정리·조립제법은 다항식 나눗셈 이해가 전제"),
  E("cm1_rem","cm1_eqs",0.8,"삼차·사차방정식은 인수정리로 인수분해해 푼다"),
  E("cm1_complex","cm1_eqs",0.6,"허근·켤레근 처리 능력이 고차방정식에 쓰임"),
  E("m2_ineq","cm1_ineqs",0.7,"이차·연립부등식은 일차부등식 조작이 기본기"),
  E("cm1_quadfun","cm1_ineqs",0.7,"이차부등식은 이차함수 그래프 읽기로 푼다"),
  E("m2_sys","cm1_matrix",0.5,"행렬은 연립일차방정식의 계수 표현에서 동기 부여"),
  // 함수 계열
  E("m1_coord","m2_linfun",0.8,"함수 그래프는 좌표평면·정비례 개념 위에서"),
  E("m2_linfun","m2_lineq2",0.9,"직선의 방정식은 일차함수 그래프의 재해석"),
  E("m2_sys","m2_lineq2",0.6,"두 직선의 교점 = 연립방정식의 해"),
  E("m3_quad","m3_quadfun",0.8,"포물선과 x축의 교점은 이차방정식의 근"),
  E("m2_linfun","m3_quadfun",0.6,"그래프 평행이동·해석 감각의 연장"),
  E("m3_quadfun","cm1_quadfun",0.9,"공통수학1 이차함수 단원은 중3 이차함수의 직접 심화"),
  E("cm1_complex","cm1_quadfun",0.7,"판별식으로 그래프와 직선의 위치 관계를 판정"),
  E("m3_quadfun","cm2_fun",0.5,"함수 일반론은 구체적 함수(이차함수) 경험 위에서"),
  E("cm2_set","cm2_fun",0.7,"함수는 집합 사이의 대응으로 정의된다"),
  E("cm2_fun","cm2_rat",0.8,"유리·무리함수는 함수 일반론(정의역·역함수)의 적용"),
  E("cm2_fun","s1_expfun",0.7,"지수·로그함수의 역함수 관계는 함수 일반론"),
  E("s1_log","s1_expfun",0.9,"지수함수·로그함수는 지수·로그 연산 위에서"),
  E("m3_sqrt","s1_log",0.5,"거듭제곱근은 제곱근 개념의 일반화"),
  E("m2_poly","s1_log",0.5,"지수법칙 확장이 로그 계산의 뼈대"),
  E("m3_trig","s1_trifun",0.7,"삼각함수는 삼각비의 일반각 확장"),
  E("cm2_fun","s1_trifun",0.5,"주기·그래프 해석은 함수 일반론의 적용"),
  // 기하 계열
  E("m1_geo","m1_cong",0.7,"작도·합동은 기본 도형(각·평행) 이해가 전제"),
  E("m1_geo","m1_plane",0.6,"내각·외각 계산은 각 개념 위에서"),
  E("m1_cong","m2_tri",0.7,"삼각형 성질 증명은 합동 조건을 도구로 쓴다"),
  E("m2_tri","m2_quadr",0.7,"사각형 성질은 삼각형 분할·합동으로 증명"),
  E("m2_tri","m2_sim",0.6,"닮음 조건은 합동 조건의 확장"),
  E("m2_sim","m2_pyth",0.5,"피타고라스 증명·응용에 닮음이 쓰임"),
  E("m2_sim","m3_trig",0.8,"삼각비의 정의 자체가 닮은 직각삼각형의 비"),
  E("m2_pyth","m3_trig",0.8,"삼각비 계산은 피타고라스로 변을 구하는 것"),
  E("m2_sim","m3_circle",0.5,"원과 비례(할선·접선) 성질은 닮음으로 증명"),
  E("m1_plane","m3_circle",0.4,"중심각·호 개념 위에서 원주각을 다룬다"),
  E("m2_pyth","cm2_coord",0.8,"두 점 사이 거리 공식 = 피타고라스 정리"),
  E("m2_lineq2","cm2_coord",0.7,"직선의 방정식·기울기 개념의 좌표기하 확장"),
  E("cm2_coord","cm2_circle",0.8,"원의 방정식은 거리 공식으로 정의"),
  E("m3_circle","cm2_circle",0.5,"접선·현의 성질이 원의 방정식 문제에 재등장"),
  E("cm2_coord","cm2_move",0.6,"이동은 좌표 위 점·직선 표현이 전제"),
  E("cm2_circle","cm2_move",0.5,"도형의 이동은 원·직선의 방정식에 적용된다"),
  E("m3_trig","s1_sincos",0.8,"사인·코사인법칙은 삼각비의 일반 삼각형 확장"),
  E("s1_trifun","s1_sincos",0.5,"일반각 삼각함수 값 계산이 쓰임"),
  // 수열 계열
  E("m1_expr","s1_seq",0.5,"일반항은 문자식으로 규칙을 표현하는 것"),
  E("s1_seq","s1_sum",0.8,"합 공식은 등차·등비 일반항 위에서"),
  E("s1_sum","s1_ind",0.5,"시그마 조작이 귀납법 증명의 계산 도구"),
  E("cm2_prop","s1_ind",0.4,"귀납법은 명제·증명 개념의 적용"),
  // 해석(극한·미분·적분) 계열
  E("cm2_fun","s2_lim",0.7,"극한은 함수의 값·그래프 해석 위에서"),
  E("cm2_rat","s2_lim",0.5,"유리함수 극한 계산이 첫 관문"),
  E("s2_lim","s2_cont",0.9,"연속의 정의가 극한으로 서술된다"),
  E("s2_lim","s2_diff",0.9,"미분계수는 평균변화율의 극한"),
  E("m2_linfun","s2_diff",0.5,"접선의 기울기는 직선의 기울기 개념"),
  E("s2_diff","s2_diffapp",0.9,"활용(증감·극값)은 도함수 계산이 전제"),
  E("cm1_quadfun","s2_diffapp",0.5,"그래프 개형·최대최소 해석 감각"),
  E("cm1_ineqs","s2_diffapp",0.4,"부등식 성립 조건 문제는 이차부등식 처리력 요구"),
  E("s2_diff","s2_anti",0.8,"부정적분은 미분의 역연산"),
  E("s2_anti","s2_int",0.9,"정적분 계산은 부정적분(기본정리)으로"),
  E("s2_int","s2_intapp",0.9,"넓이·속도 문제는 정적분 계산 위에서"),
  E("m3_quadfun","s2_intapp",0.4,"곡선 사이 넓이의 단골은 이차함수 그래프"),
  E("s1_seq","ca_limseq",0.8,"수열의 극한은 등차·등비 일반항 위에서"),
  E("s2_lim","ca_limseq",0.6,"극한의 성질·계산 규칙 공유"),
  E("ca_limseq","ca_series",0.9,"급수는 부분합 수열의 극한"),
  E("s1_sum","ca_series",0.7,"부분합 계산은 시그마 조작"),
  E("s2_diff","ca_dfelem",0.8,"초월함수 미분은 수Ⅱ 미분법의 확장"),
  E("s1_expfun","ca_dfelem",0.8,"지수·로그함수의 성질과 극한이 미분의 재료"),
  E("s1_trifun","ca_dfelem",0.8,"삼각함수 정의·그래프가 삼각함수 극한·미분의 재료"),
  E("ca_dfelem","ca_dfmeth",0.9,"합성·몫·음함수 미분은 기본 도함수 위에서"),
  E("cm2_fun","ca_dfmeth",0.5,"합성함수·역함수 미분은 함수 합성 개념이 전제"),
  E("ca_dfmeth","ca_dfapp",0.9,"개형·변곡점 분석은 이계도함수 계산이 전제"),
  E("s2_diffapp","ca_dfapp",0.7,"증감·극값 논리를 초월함수로 확장"),
  E("ca_dfmeth","ca_intmeth",0.8,"치환·부분적분은 미분법(합성·곱)의 역"),
  E("s2_int","ca_intmeth",0.8,"정적분 개념·계산이 전제"),
  E("ca_intmeth","ca_intapp",0.9,"부피·길이 문제는 적분 기법 위에서"),
  E("s2_intapp","ca_intapp",0.6,"넓이·속도 해석 프레임 공유"),
  // 확률·통계 계열
  E("m1_data","m3_stat",0.7,"산포도는 도수분포 정리 위에서"),
  E("m2_case","cm1_perm",0.8,"순열·조합은 경우의 수 세기의 체계화"),
  E("cm1_perm","pr_perm",0.9,"중복·원순열은 순열·조합의 직접 확장"),
  E("pr_perm","pr_binom",0.8,"이항계수는 조합 그 자체"),
  E("cm1_perm","pr_prob",0.7,"수학적 확률 계산 = 경우의 수 비율"),
  E("m2_case","pr_prob",0.6,"확률의 기본 개념은 중2에서 시작"),
  E("pr_prob","pr_cond",0.9,"조건부확률은 확률의 곱셈·덧셈정리 위에서"),
  E("pr_prob","pr_rv",0.8,"확률분포는 사건별 확률 계산이 전제"),
  E("pr_rv","pr_normal",0.9,"이항·정규분포는 확률변수·기댓값 개념의 적용"),
  E("pr_normal","pr_est",0.9,"신뢰구간은 표본평균의 정규분포 근사 위에서"),
  E("m3_stat","pr_rv",0.4,"평균·분산 개념이 기댓값·분산으로 일반화"),
];

/* ── 조회 헬퍼 ── */
const _byId={};GRAPH_NODES.forEach(n=>{_byId[n.id]=n;});
const nodeById=(id)=>_byId[id]||null;
const prereqsOf=(id)=>GRAPH_EDGES.filter(e=>e.to===id);
const dependentsOf=(id)=>GRAPH_EDGES.filter(e=>e.from===id);
const courseOf=(id)=>COURSES.find(c=>c.id===(_byId[id]||{}).course)||null;
const strandOf=(id)=>STRANDS.find(s=>s.id===(_byId[id]||{}).strand)||null;

// 이 단원이 앞으로 영향을 주는 후속 단원 수(전이적) — "지금 안 잡으면 몇 단원이 무너지나"
function impactOf(id){
  const seen=new Set();const stack=[id];
  while(stack.length){
    const cur=stack.pop();
    for(const e of dependentsOf(cur)){if(!seen.has(e.to)){seen.add(e.to);stack.push(e.to);}}
  }
  return seen.size;
}

/* ── 자유 텍스트(개념명·단원명) → 그래프 노드 매칭 ──
   덱 개념은 AI가 뽑은 자유 문자열이라 키워드 점수로 최근접 노드를 찾는다. */
const _norm=(s)=>String(s||"").toLowerCase().replace(/[\s·().,ⅰⅱ]/g,"");
function matchNode(text,courseHint){
  const t=_norm(text);
  if(!t)return null;
  let best=null,bestScore=0;
  for(const n of GRAPH_NODES){
    let score=0;
    const nm=_norm(n.name);
    if(t===nm)score+=20;
    else if(t.includes(nm)||nm.includes(t))score+=10;
    for(const k of n.kw){const nk=_norm(k);if(nk&&t.includes(nk))score+=3;}
    if(score&&courseHint&&n.course===courseHint)score+=4;
    if(score>bestScore){bestScore=score;best=n;}
  }
  return bestScore>=3?best.id:null;
}

/* ── 근본 원인 역추적 ──
   약한 노드에서 선수 엣지를 거슬러 올라가며
   의심도 = 경로 가중치(엣지 곱) × (1 - 선수 숙련도) 로 후보를 랭킹.
   mastery: {nodeId:{m:0~1|null,n:횟수}} (mastery.js masteryByNode 결과) */
function traceRootCauses(nodeId,mastery,maxDepth=3){
  mastery=mastery||{};
  const found={};
  function walk(id,pathW,chain,depth){
    if(depth>maxDepth)return;
    for(const e of prereqsOf(id)){
      const w=pathW*e.w;
      if(w<0.15)continue;   // 너무 먼·약한 경로는 잡음
      const st=mastery[e.from];
      const m=(st&&st.m!=null)?st.m:null;
      const cand={id:e.from,node:_byId[e.from],pathW:w,mastery:m,n:st?st.n:0,
        measured:m!=null,suspicion:w*(1-(m==null?0.5:m)),chain:[...chain,e]};
      if(!found[e.from]||cand.suspicion>found[e.from].suspicion)found[e.from]=cand;
      walk(e.from,w,[...chain,e],depth+1);
    }
  }
  walk(nodeId,1,[],1);
  return Object.values(found).sort((a,b)=>b.suspicion-a.suspicion);
}

export { FACTORS, FACTOR_KO, normFactors, COURSES, STRANDS, GRAPH_NODES, GRAPH_EDGES,
  nodeById, prereqsOf, dependentsOf, courseOf, strandOf, impactOf, matchNode, traceRootCauses };
