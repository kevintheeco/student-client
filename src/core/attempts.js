/* ── 시도(attempt) 로그 — 진단 인텔리전스의 원천 데이터 ──
   설계 원칙 (수천 명 규모에서도 안정·효율·집계 가능한 데이터):
   ① 원문이 아니라 '부호화된 신호'를 저장 — 오류 유형·단계는 고정 enum,
      자유 텍스트(gap·misc)는 길이 상한. 손글씨 이미지는 절대 로그에 넣지 않음.
   ② 레코드는 고정 스키마 + 버전(v) — 스키마 진화에도 과거 데이터 해석 가능.
   ③ 이중 구조: 원시 로그는 최근 2,000건 순환(ng:attempts),
      노드별 '평생 집계'는 영구 누적(ng:attagg) — 로그가 밀려나도 이력은 안 잃음.
   모든 채점 이벤트(학습·후속질문·퀴즈·시험·모르겠어)를 append-only로 기록하고
   클라우드 동기화에 포함되어 기기·학원 어디서든 같은 성장 데이터를 본다.

   레코드 v2 필드:
   t 시각 | src study|followup|quiz|exam|dontknow | deckId | concept | unit | nodeId
   qtype | box | verdict correct|partial|incorrect | score/points(시험)
   err  오류 유형 enum (knowledgeGraph.ERR_TYPES: slip/concept/strategy/interpret/notation/blank)
   stage 첫 오류 단계 setup|compute|interpret | misc 오개념 라벨(≤48자)
   gap 갭 서술(≤140자) | gapType | factors {cu,pf,sc,ar} 0~1
   dur 풀이 시간(초) | ink {st:획수,pg:페이지} | hint 힌트 요청 수 | ocr OCR 재작성 수 */
import { LS } from "./platform.js";
import { matchNode, normFactors } from "./knowledgeGraph.js";
import { scoreOf } from "./mastery.js";

const ATT_KEY="ng:attempts";
const AGG_KEY="ng:attagg";
const MISC_KEY="ng:misclex";
const MAX_ATTEMPTS=2000;   // ~400KB 상한 (Firestore 문서 1MB 대비 여유)
const MISC_PER_NODE=20;    // 노드당 오개념 라벨 상한 (빈도 낮고 오래된 것부터 탈락)
const clip=(s,n)=>s==null?undefined:String(s).slice(0,n);

/* ── 학생 컨텍스트 (학원 모드) ──
   학원은 한 기기에서 여러 학생이 응시한다. 활성 학생을 지정하면:
   · 모든 시도 레코드에 sid가 찍히고, allAttempts()가 그 학생 것만 돌려줌
   · 평생 집계·오개념 사전이 학생별 키(ng:attagg:<sid> 등)로 분리됨
   개인 모드는 학생 미지정(null) — 기존 동작 그대로. */
let _sid=null;
function setActiveStudent(sid){_sid=sid||null;}
const activeStudent=()=>_sid;
const _aggKey=()=>_sid?AGG_KEY+":"+_sid:AGG_KEY;
const _miscKey=()=>_sid?MISC_KEY+":"+_sid:MISC_KEY;

/* ── 오개념 사전 (misconception lexicon) ──
   AI가 붙인 오개념 라벨("부호 분배 실수")을 노드별로 누적.
   같은 라벨이 2회 이상 반복되면 '이 학생이 이 단원에서 반복해서 밟는 함정'으로 승격 —
   다음 출제 때 그 함정을 정조준하는 문제를 내는 피드포워드 루프의 재료.
   학원 데이터가 모이면 학생 간 클러스터링으로 단원 공통 함정 통제어휘로 발전시킨다. */
const normMiscKey=(s)=>String(s||"").trim().replace(/\s+/g," ").replace(/[.,!?~'"·]/g,"");
function updateMiscLex(nodeId,label){
  const key=normMiscKey(label);
  if(!key||key.length<2)return;
  const lex=LS.get(_miscKey())||{};
  const node=lex[nodeId]||(lex[nodeId]={});
  const e=node[key]||(node[key]={n:0,label:String(label).trim().slice(0,48)});
  e.n++;e.lastT=Date.now();
  const keys=Object.keys(node);
  if(keys.length>MISC_PER_NODE){
    keys.sort((a,b)=>(node[a].n-node[b].n)||((node[a].lastT||0)-(node[b].lastT||0)));
    delete node[keys[0]];
  }
  LS.set(_miscKey(),lex);
}
// 노드의 오개념 라벨(빈도순). minN=2면 '반복 함정'만
function miscLexFor(nodeId,minN){
  if(!nodeId)return[];
  const node=(LS.get(_miscKey())||{})[nodeId]||{};
  return Object.values(node).filter(e=>e.n>=(minN||1)).sort((a,b)=>b.n-a.n);
}

function logAttempt(a){
  try{
    const rec={v:2,t:Date.now(),...a};
    if(_sid&&!rec.sid)rec.sid=_sid;
    rec.concept=clip(rec.concept,60);
    rec.unit=clip(rec.unit,60);
    rec.gap=clip(rec.gap,140);
    rec.misc=clip(rec.misc,48);
    if(rec.dur!=null)rec.dur=Math.max(0,Math.min(3600,Math.round(rec.dur)));
    if(rec.factors)rec.factors=normFactors(rec.factors);
    // 개념·단원 텍스트 → 지식 그래프 노드 매핑 (수학 외 과목이면 null로 남음)
    if(!rec.nodeId){
      const nid=matchNode([rec.unit,rec.concept].filter(Boolean).join(" "),rec.course);
      if(nid)rec.nodeId=nid;
    }
    for(const k in rec)if(rec[k]===undefined||rec[k]===null||rec[k]==="")delete rec[k];
    const list=LS.get(ATT_KEY)||[];
    list.push(rec);
    LS.set(ATT_KEY,list.length>MAX_ATTEMPTS?list.slice(list.length-MAX_ATTEMPTS):list);
    if(rec.nodeId&&rec.misc)updateMiscLex(rec.nodeId,rec.misc);
    // ── 평생 집계: 노드별 누적 카운터 (로그 순환과 무관하게 영구) ──
    if(rec.nodeId&&rec.src!=="followup"&&rec.src!=="skip"){
      const agg=LS.get(_aggKey())||{};
      const g=agg[rec.nodeId]||(agg[rec.nodeId]={n:0,sum:0,err:{},durSum:0,durN:0,lastT:0});
      g.n++;g.sum=Math.round((g.sum+scoreOf(rec))*100)/100;
      if(rec.err&&rec.err!=="none")g.err[rec.err]=(g.err[rec.err]||0)+1;
      if(rec.dur){g.durSum+=rec.dur;g.durN++;}
      g.lastT=rec.t;
      LS.set(_aggKey(),agg);
    }
  }catch(e){console.warn("[attempts] 기록 실패",e);}
}
// 활성 학생이 있으면 그 학생의 시도만, 개인 모드(_sid 없음)는 sid 없는 기록만 —
// 같은 기기의 학원 학생(예시 학생 포함) 기록이 개인 인사이트에 섞이지 않게.
const allAttempts=()=>{
  const list=LS.get(ATT_KEY)||[];
  return _sid?list.filter(a=>a.sid===_sid):list.filter(a=>!a.sid);
};
const attemptsForNode=(nodeId)=>allAttempts().filter(a=>a.nodeId===nodeId);
// 특정 학생의 시도 (활성 학생과 무관 — 학원 대시보드처럼 여러 학생을 한 번에 볼 때)
const attemptsOf=(sid)=>(LS.get(ATT_KEY)||[]).filter(a=>a.sid===sid);
const lifetimeAgg=()=>LS.get(_aggKey())||{};

export { ATT_KEY, AGG_KEY, MISC_KEY, MAX_ATTEMPTS, setActiveStudent, activeStudent, logAttempt, allAttempts, attemptsForNode, attemptsOf, lifetimeAgg, miscLexFor, updateMiscLex };
