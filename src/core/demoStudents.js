/* ── 예시 학생 생성기 — 학원 대시보드·성장 인사이트 데모 ──
   "6개월 동안 우리 앱으로 공부한 학생들"을 실데이터와 같은 스키마로 시딩.
   각 학생은 뚜렷한 페르소나(성장형·실수형·개념결여형·고1·회피형)를 갖고,
   26주치 시도 로그가 ng:attempts에 sid로 귀속돼 실제 파이프라인
   (Rasch·요인 회귀·습관 프로파일)이 그대로 돌아간다.
   시딩된 학생은 demo:true 플래그 + 이름 (예시) 접미사 — 한 번에 제거 가능. */
import { LS } from "./platform.js";
import { ATT_KEY, AGG_KEY, MISC_KEY } from "./attempts.js";
import { nodeById } from "./knowledgeGraph.js";

const W=7*864e5,DAY=864e5;
const STU_KEY="ng:aca:students",ACT_KEY="ng:aca:active";
const clamp01=(v)=>Math.max(0,Math.min(1,v));

/* 노드별 대표 함정(오개념 라벨) — 같은 라벨이 반복돼야 '반복 함정'으로 승격된다 */
const TRAP={
  m1_int:"음수 곱셈 부호 실수",m1_expr:"동류항 정리 실수",m1_lineq:"이항 부호 반전 누락",
  m2_poly:"지수법칙 곱을 합으로 혼동",m2_ineq:"음수로 나눌 때 부등호 방향",m2_sys:"가감법 계수 맞추기 실수",
  m2_linfun:"기울기·절편 해석 혼동",m2_tri:"이등변 성질 적용 오류",m2_sim:"닮음비 대응 순서 혼동",
  m2_pyth:"빗변 판별 없이 공식 대입",m2_case:"합·곱의 법칙 구분 혼동",
  m3_sqrt:"분모 유리화 누락",m3_factor:"공통인수 묶기 누락",m3_quad:"근의 공식 부호 실수",
  m3_quadfun:"꼭짓점을 일반형에서 못 끌어냄",m3_trig:"기준각 대응변 혼동",m3_circle:"원주각·중심각 관계 혼동",
  m3_stat:"분산 계산 절차 혼동",
  cm1_polyop:"조립제법 부호 배열 실수",cm1_rem:"인수정리 조건 혼동",cm1_complex:"켤레근 조건 누락",
  cm1_quadfun:"판별식·교점 연결 혼동",cm1_eqs:"인수분해 후 근 누락",cm1_ineqs:"부호 영역 판정 혼동",
  cm1_perm:"순열·조합 구분 혼동",
};

/* 페르소나: plan=[node,시작 숙련도,주당 성장], beh=행동 파라미터.
   errW = 오답일 때 오류 유형 가중치. density = 주당 각 단원을 잡을 확률. */
const PERSONAS=[
  {id:"demo-kim",name:"김하늘 (예시)",seed:11,density:.5,
   // 중3 성실 성장형: 인수분해 계열이 약했지만 6개월간 꾸준히 끌어올림 — retry·follow 높음
   plan:[["m2_poly",.40,.021],["m3_factor",.30,.024],["m3_quad",.28,.025],["m3_quadfun",.35,.022],
     ["m3_sqrt",.55,.012],["m1_lineq",.82,.004],["m2_sys",.78,.005],["m2_linfun",.65,.010],
     ["m2_pyth",.55,.012],["m3_trig",.45,.015],["m3_circle",.50,.012],["m3_stat",.80,.002]],
   beh:{hintWeak:.30,hintStrong:.05,giveup:.02,skip:.02,retry:.80,follow:.70,dur:210,durTrend:-3.2},
   errW:{slip:.30,concept:.40,strategy:.15,interpret:.15},fOff:{cu:0,pf:0,sc:-.03,ar:0}},
  {id:"demo-lee",name:"이준서 (예시)",seed:23,density:.5,
   // 중3 실수형: 개념은 아는데 계산이 빠르고 거칠다 — slip 다수, 재도전은 안 하는 편
   plan:[["m2_poly",.68,.006],["m3_factor",.62,.008],["m3_quad",.60,.008],["m3_quadfun",.58,.008],
     ["m3_sqrt",.70,.005],["m2_sys",.72,.004],["m2_ineq",.65,.005],["m3_trig",.60,.007],
     ["m2_case",.66,.005],["m3_circle",.55,.008],["m3_stat",.72,.003]],
   beh:{hintWeak:.10,hintStrong:.06,giveup:.01,skip:.06,retry:.40,follow:.30,dur:85,durTrend:-.4},
   errW:{slip:.72,concept:.08,strategy:.08,interpret:.12},fOff:{cu:.14,pf:-.16,sc:.05,ar:.04}},
  {id:"demo-park",name:"박서준 (예시)",seed:37,density:.5,
   // 개념 결여형: 중1 대수 뿌리(문자식·일차방정식)부터 흔들려 후속이 다 무너짐 — 힌트 의존 높음
   plan:[["m1_int",.50,.004],["m1_expr",.38,.006],["m1_lineq",.42,.008],["m2_poly",.30,.007],
     ["m2_ineq",.35,.006],["m2_sys",.33,.008],["m2_linfun",.30,.006],["m3_factor",.22,.005],
     ["m2_tri",.48,.004],["m2_sim",.40,.005]],
   beh:{hintWeak:.52,hintStrong:.25,giveup:.16,skip:.10,retry:.22,follow:.28,dur:265,durTrend:-.6},
   errW:{slip:.10,concept:.62,strategy:.16,interpret:.12},fOff:{cu:-.10,pf:-.02,sc:-.14,ar:-.08}},
  {id:"demo-choi",name:"최유나 (예시)",seed:53,density:.5,
   // 고1 공통수학1: 중3 기반은 준수, 나머지정리→고차방정식 사슬이 새 병목 — 자기주도형
   plan:[["cm1_polyop",.55,.012],["cm1_rem",.40,.015],["cm1_complex",.45,.014],["cm1_quadfun",.50,.013],
     ["cm1_eqs",.35,.014],["cm1_ineqs",.50,.012],["cm1_perm",.50,.010],["m3_factor",.62,.008],
     ["m3_quad",.66,.007],["m3_quadfun",.56,.010]],
   beh:{hintWeak:.16,hintStrong:.04,giveup:.04,skip:.03,retry:.65,follow:.50,dur:225,durTrend:-2.1},
   errW:{slip:.25,concept:.35,strategy:.25,interpret:.15},fOff:{cu:.04,pf:.02,sc:0,ar:.06}},
  {id:"demo-jung",name:"정민재 (예시)",seed:71,density:.42,
   // 회피형: '모르겠어'·스킵이 잦고 오답을 다시 안 잡는다 — 상담 포인트가 가장 많이 뜨는 학생
   plan:[["m2_poly",.36,.004],["m3_factor",.30,.003],["m3_sqrt",.42,.004],["m3_quad",.30,.004],
     ["m2_linfun",.38,.003],["m2_pyth",.40,.004],["m3_trig",.34,.003],["m2_case",.45,.002],
     ["m2_sys",.44,.004]],
   beh:{hintWeak:.44,hintStrong:.30,giveup:.24,skip:.14,retry:.14,follow:.10,dur:95,durTrend:.3},
   errW:{slip:.12,concept:.45,strategy:.15,interpret:.10,blank:.18},fOff:{cu:-.08,pf:-.06,sc:-.12,ar:-.10}},
];

function pickErr(rand,errW,weakBoost){
  let entries=Object.entries(errW);
  if(weakBoost)entries=entries.map(([k,w])=>[k,k==="concept"?w*1.5:w]);
  const total=entries.reduce((s,[,w])=>s+w,0);
  let r=rand()*total;
  for(const[k,w]of entries){r-=w;if(r<=0)return k;}
  return "concept";
}

/* 한 페르소나의 26주 시도 로그 생성 (실기록과 같은 v2 스키마, sid 귀속) */
function genAttempts(p,now){
  let seed=p.seed;const rand=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
  const out=[];
  const WEEKS=26;
  const push=(rec)=>{for(const k in rec)if(rec[k]===undefined||rec[k]===null||rec[k]==="")delete rec[k];out.push(rec);};
  const mkStudy=(node,name,t,pr,w,opts)=>{
    const r=rand();
    const verdict=r<pr?"correct":(r<pr+(1-pr)*.5?"partial":"incorrect");
    const wrong=verdict!=="correct";
    const err=wrong?pickErr(rand,p.errW,pr<.45):undefined;
    const hintP=pr<.5?p.beh.hintWeak:p.beh.hintStrong;
    const f=(c)=>clamp01(c+(rand()-.5)*.22);
    const fo=p.fOff;
    push({v:2,t,sid:p.id,src:"study",concept:name,nodeId:node,verdict,
      box:1+Math.floor(rand()*3)+(pr>.6?1:0),
      err,stage:err?(err==="slip"?"compute":"setup"):undefined,
      misc:err&&err!=="blank"&&rand()<.7?(err==="slip"?"부호 계산 실수":(TRAP[node]||"개념 연결 혼동")):undefined,
      gap:wrong&&rand()<.4?(TRAP[node]||"핵심 개념 연결 누락"):undefined,
      gapType:wrong&&rand()<.4?"개념누락":undefined,
      hint:rand()<hintP?(rand()<.25?2:1):undefined,
      dur:Math.max(35,Math.min(600,Math.round(p.beh.dur+p.beh.durTrend*w+(rand()-.5)*70))),
      factors:{cu:f(pr+fo.cu),pf:f(pr+fo.pf),sc:f(pr+fo.sc),ar:f(pr+fo.ar)}});
    if(wrong){
      // 소크라테스 후속 문답 참여
      if(rand()<p.beh.follow)
        push({v:2,t:t+36e5,sid:p.id,src:"followup",concept:name,nodeId:node,verdict:rand()<.7?"correct":"partial"});
      // 끈기: 1~3일 안에 같은 단원을 다시 잡는다 (retryRate·pd의 행동 근거)
      if(!opts?.isRetry&&rand()<p.beh.retry)
        mkStudy(node,name,t+DAY*(1+Math.floor(rand()*2.5))+Math.floor(rand()*8*36e5),
          Math.min(.95,pr+.15),w,{isRetry:true});
    }
  };
  for(let w=0;w<WEEKS;w++){
    for(const[node,base,grow]of p.plan){
      if(rand()>=p.density)continue;
      const name=nodeById(node)?.name||node;
      const t=now-(WEEKS-w)*W+Math.floor(rand()*W*.86);
      const pr=Math.min(.93,base+grow*w+(rand()-.5)*.14);
      if(rand()<p.beh.giveup)
        push({v:2,t:t-9e5,sid:p.id,src:"dontknow",concept:name,nodeId:node,verdict:"incorrect",err:"blank"});
      if(rand()<p.beh.skip)
        push({v:2,t:t-6e5,sid:p.id,src:"skip",concept:name,nodeId:node});
      mkStudy(node,name,t,pr,w);
      if(rand()<.25)mkStudy(node,name,t+Math.floor(rand()*2*DAY),Math.min(.93,pr+(rand()-.5)*.1),w);
    }
  }
  return out;
}

const demoIds=()=>new Set((LS.get(STU_KEY)||[]).filter(s=>s.demo).map(s=>s.id));
const hasDemoStudents=()=>demoIds().size>0;

/* 예시 학생 5명 + 6개월 시도 로그 시딩. 이미 있으면 no-op. */
function seedDemoStudents(){
  if(hasDemoStudents())return{students:0,attempts:0};
  const now=Date.now();
  const stuList=LS.get(STU_KEY)||[];
  const newStus=PERSONAS.map(p=>({id:p.id,name:p.name,createdAt:now-26*W,demo:true}));
  LS.set(STU_KEY,[...stuList,...newStus]);
  let att=[];
  for(const p of PERSONAS)att=att.concat(genAttempts(p,now));
  const merged=(LS.get(ATT_KEY)||[]).concat(att).sort((a,b)=>(a.t||0)-(b.t||0));
  LS.set(ATT_KEY,merged);
  return{students:newStus.length,attempts:att.length};
}

/* 예시 학생·시도 로그·학생별 집계를 전부 제거 (실제 데이터는 건드리지 않음) */
function clearDemoStudents(){
  const ids=demoIds();
  if(!ids.size)return 0;
  LS.set(STU_KEY,(LS.get(STU_KEY)||[]).filter(s=>!s.demo));
  LS.set(ATT_KEY,(LS.get(ATT_KEY)||[]).filter(a=>!ids.has(a.sid)));
  for(const id of ids){LS.del(AGG_KEY+":"+id);LS.del(MISC_KEY+":"+id);}
  if(ids.has(LS.get(ACT_KEY)))LS.del(ACT_KEY);
  return ids.size;
}

export { seedDemoStudents, clearDemoStudents, hasDemoStudents };
