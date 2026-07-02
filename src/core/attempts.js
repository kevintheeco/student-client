/* ── 시도(attempt) 로그 — 진단 인텔리전스의 원천 데이터 ──
   기존에는 개념당 '마지막 시도'만 남아 시계열 분석이 불가능했다.
   여기서는 모든 채점 이벤트(학습·후속질문·퀴즈·시험)를 append-only로 축적한다.
   레코드는 텍스트만(손글씨 이미지 제외)이라 가볍고, 클라우드 동기화에 포함되어
   기기·학원 어디서든 같은 성장 데이터를 본다. */
import { LS } from "./platform.js";
import { matchNode, normFactors } from "./knowledgeGraph.js";

const ATT_KEY="ng:attempts";
const MAX_ATTEMPTS=2000;   // ~400KB 상한 (Firestore 문서 1MB 대비 여유)

/* a: {src:'study'|'followup'|'quiz'|'exam', deckId?, concept, unit?, course?,
      verdict:'correct'|'partial'|'incorrect', gapType?, gap?, qtype?, box?,
      score?, points?, factors?:{cu,pf,sc,ar} 0~1} */
function logAttempt(a){
  try{
    const rec={t:Date.now(),...a};
    if(rec.factors)rec.factors=normFactors(rec.factors);
    if(!rec.factors)delete rec.factors;
    // 개념·단원 텍스트 → 지식 그래프 노드 매핑 (수학 외 과목이면 null로 남음)
    if(!rec.nodeId){
      const nid=matchNode([rec.unit,rec.concept].filter(Boolean).join(" "),rec.course);
      if(nid)rec.nodeId=nid;
    }
    const list=LS.get(ATT_KEY)||[];
    list.push(rec);
    LS.set(ATT_KEY,list.length>MAX_ATTEMPTS?list.slice(list.length-MAX_ATTEMPTS):list);
  }catch(e){console.warn("[attempts] 기록 실패",e);}
}
const allAttempts=()=>LS.get(ATT_KEY)||[];
const attemptsForNode=(nodeId)=>allAttempts().filter(a=>a.nodeId===nodeId);

export { ATT_KEY, MAX_ATTEMPTS, logAttempt, allAttempts, attemptsForNode };
