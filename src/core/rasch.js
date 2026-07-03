/* ════════════════════════════════════════════════════════════════
   측정 엔진 v2 — 온라인 Rasch(1PL) 능력 추정
   세계 표준 측정 모델(PISA·TIMSS·CAT)의 원리를 스트리밍 데이터에 맞게 구현.

   이론적 토대:
   · Rasch/1PL IRT: P(정답) = σ(θ − b) — 능력 θ와 문항 난이도 b를 같은 척도에.
   · Elo 온라인 추정: 사전 보정 없는 문항 흐름에서 θ를 점진 갱신
     (Klinkenberg, Straatemeier & van der Maas 2011 — Math Garden;
      Duolingo·체스 레이팅과 동일 계열. Elo는 Rasch의 확률적 경사 추정량).
   · 망각 반감기: 관측이 없으면 θ가 사전값으로 수축, 반감기는 연습량에 따라
     성장(간격 효과) — Duolingo Half-Life Regression(Settles & Meeder 2016)의 근사.
   · 자기 검증: 모든 관측 전에 P를 '예측'으로 기록하고 실제와 비교(Brier score,
     신뢰도 다이어그램) — 측정 모델의 품질을 모델 스스로 정량 공개한다.
   · 그래프 증거 전파: 후속 단원의 성공은 선수 단원 사용의 증거 —
     선수 엣지를 따라 약한 갱신을 전파해 미측정 단원도 간접 추정(1홉).

   전부 시도 로그의 순수 재생(replay)으로 계산 — 저장 상태 없음, 해석 가능,
   로그만 있으면 어떤 시점의 능력도 재현 가능(감사 가능한 측정).
════════════════════════════════════════════════════════════════ */
import { prereqsOf } from "./knowledgeGraph.js";
import { DAY, scoreOf } from "./mastery.js";

const PRIOR=0;                 // 사전 능력 (로짓 0 = 성공률 50%)
const K_MAX=0.6,K_MIN=0.12;    // Elo 학습률: 초반 크게, 관측 쌓이면 안정화
const PROP=0.25;               // 선수 엣지 증거 전파 비율
const sigmoid=(x)=>1/(1+Math.exp(-x));

/* 문항 난이도 프록시(로짓) — 사전 보정된 문항이 없는 v2의 근사:
   box(SRS 단계=출제 난이도 계층) + 문항 유형 + 출처.
   로드맵: 학원 데이터가 모이면 문항별 실측 난이도(2PL)로 교체. */
function itemDifficulty(a){
  let b=({1:-1.2,2:-0.6,3:0,4:0.6,5:1.2})[a.box]??0;
  if(a.qtype==="apply"||a.qtype==="essay")b+=0.35;
  else if(a.qtype==="recall"||a.qtype==="mc"||a.qtype==="ox")b-=0.25;
  if(a.src==="exam")b+=0.15;
  return b;
}

// 망각 감쇠: 마지막 관측 후 경과 시간만큼 사전값 방향으로 수축.
// 반감기 = 30일 + 12일×관측수 (상한 240일) — 연습할수록 기억이 오래간다(간격 효과).
function decayedTheta(st,t){
  if(!st.lastT||t<=st.lastT)return st.theta;
  const half=Math.min(240,30+12*st.n)*DAY;
  const lam=Math.pow(2,-(t-st.lastT)/half);
  return st.theta*lam+PRIOR*(1-lam);
}

/* 시도 로그 재생 → 노드별 능력 + 자기 검증 통계.
   반환: {ability:{nodeId:{m,theta,se,ciLow,ciHigh,n,indirect,lastT}},
          calibration:{n,brier,buckets:[{n,p,s}×5]}} */
function abilityByNode(attempts,now){
  const sorted=attempts.filter(a=>a.nodeId&&a.src!=="followup").slice().sort((a,b)=>(a.t||0)-(b.t||0));
  now=now||(sorted.length?sorted[sorted.length-1].t:Date.now());
  const S={};
  const get=(id)=>S[id]||(S[id]={theta:PRIOR,n:0,direct:0,info:0,lastT:0});
  const cal={n:0,brierSum:0,buckets:Array.from({length:5},()=>({n:0,p:0,s:0}))};
  for(const a of sorted){
    const st=get(a.nodeId);
    st.theta=decayedTheta(st,a.t);
    const b=itemDifficulty(a);
    const s=scoreOf(a);
    const P=sigmoid(st.theta-b);
    // 갱신 '전'의 P가 곧 모델의 예측 — 실제 s와 비교해 적중률을 기록 (자기 검증)
    cal.n++;cal.brierSum+=(P-s)*(P-s);
    const bi=Math.min(4,Math.floor(P*5));
    cal.buckets[bi].n++;cal.buckets[bi].p+=P;cal.buckets[bi].s+=s;
    const K=Math.max(K_MIN,K_MAX/(1+st.n/8));
    st.theta+=K*(s-P);
    st.n++;st.direct++;st.info+=P*(1-P);st.lastT=a.t;
    // 선수 단원으로 증거 전파: 이 문제를 풀었다 = 선수 개념을 (못) 썼다는 약한 증거
    for(const e of prereqsOf(a.nodeId)){
      if(e.w<0.5)continue;
      const ps=get(e.from);
      ps.theta=decayedTheta(ps,a.t);
      ps.theta+=PROP*e.w*K*(s-P);
      ps.info+=PROP*e.w*P*(1-P);
      ps.n++;ps.lastT=a.t;   // n은 감쇠 반감기용 (직접 측정 횟수는 direct)
    }
  }
  const ability={};
  for(const id in S){
    const st=S[id];
    if(st.direct===0&&st.info<0.2)continue;   // 증거가 너무 약한 간접 추정은 버림
    const theta=decayedTheta(st,now);
    const se=1/Math.sqrt(Math.max(st.info,0.25));   // 누적 피셔 정보 기반 표준오차(로짓)
    ability[id]={m:sigmoid(theta),theta,se,
      ciLow:sigmoid(theta-1.96*se),ciHigh:sigmoid(theta+1.96*se),
      n:st.direct,indirect:st.direct===0,lastT:st.lastT};
  }
  return{ability,calibration:{n:cal.n,brier:cal.n?cal.brierSum/cal.n:null,
    buckets:cal.buckets.map(b=>({n:b.n,p:b.n?b.p/b.n:null,s:b.n?b.s/b.n:null}))}};
}

// 이 학생이 이 노드에서 특정 난이도 문항을 맞힐 확률 (적응형 출제 보정용)
function predictSuccess(abilityMap,nodeId,item){
  const st=nodeId&&abilityMap&&abilityMap[nodeId];
  if(!st)return null;
  return sigmoid(st.theta-itemDifficulty(item||{}));
}

export { sigmoid, itemDifficulty, decayedTheta, abilityByNode, predictSuccess };
