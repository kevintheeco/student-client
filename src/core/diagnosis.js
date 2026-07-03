/* ── AI 서술식 진단 ──
   "이 단원을 틀리는 근본 원인은 어떤 선수 개념의 결여인가"를
   지식 그래프 역추적(traceRootCauses) + 실제 시도 증거로 조립해
   AI가 학생·학부모가 읽을 수 있는 서술형 소견으로 풀어낸다.
   결과는 ng:diag:<nodeId>에 캐시하고, 그 노드의 시도 수가 변하면 재생성. */
import { LS, tr } from "./platform.js";
import { callAI } from "./ai.js";
import { courseOf, impactOf, nodeById, traceRootCauses } from "./knowledgeGraph.js";
import { miscBreakdown } from "./mastery.js";

const diagKey=(nodeId)=>"ng:diag:"+nodeId;

// 진단에 먹일 증거 텍스트 조립 (프롬프트 재료)
function buildEvidence(nodeId,mastery,attempts){
  const node=nodeById(nodeId);if(!node)return null;
  const mine=attempts.filter(a=>a.nodeId===nodeId);
  const st=mastery[nodeId]||{m:null,n:0};
  const causes=traceRootCauses(nodeId,mastery).slice(0,5);
  const gapLines=mine.filter(a=>a.gap&&a.gap!=="없음").slice(-6)
    .map(a=>"· ["+(a.gapType||"갭")+"] "+String(a.gap).replace(/\s+/g," ").slice(0,110));
  const traps=miscBreakdown(attempts,nodeId,2).slice(0,5);
  const causeLines=causes.map(c=>{
    const chain=c.chain.map(e=>nodeById(e.from).name).reverse().join(" → ")+" → "+node.name;
    return "· "+(courseOf(c.id)?.name||"")+" 「"+c.node.name+"」 (경로: "+chain+" / 의존도 "+Math.round(c.pathW*100)+"%"+
      (c.measured?" / 학생 숙련도 "+Math.round(c.mastery*100)+"%·"+c.n+"회 측정":" / 아직 미측정")+") — "+c.chain[c.chain.length-1].why;
  });
  return {node,st,causes,
    text:"[대상 단원] "+(courseOf(nodeId)?.name||"")+" 「"+node.name+"」\n"+
      "[현재 숙련도] "+(st.m!=null?Math.round(st.m*100)+"% ("+st.n+"회 측정)":"미측정")+"\n"+
      "[이 단원이 무너지면 영향받는 후속 단원 수] "+impactOf(nodeId)+"개\n"+
      "[선수 개념 의심 후보 — 그래프 역추적]\n"+(causeLines.join("\n")||"· 없음(뿌리 단원)")+"\n"+
      "[이 단원에서 실제 드러난 갭 — AI 채점 기록]\n"+(gapLines.join("\n")||"· 기록 없음")+"\n"+
      "[반복 실수·오개념 패턴 (2회 이상)]\n"+(traps.map(t=>"· "+t.label+" ×"+t.n).join("\n")||"· 없음")};
}

/* 서술식 진단 생성 (캐시 우선). 반환: {story, rootCause, plan:[..], t}
   opts.noCache: 데모 데이터 등 실기록이 아닐 때 캐시를 읽지도 쓰지도 않음 */
async function narrateDiagnosis(nodeId,mastery,attempts,signal,opts){
  opts=opts||{};
  const ev=buildEvidence(nodeId,mastery,attempts);
  if(!ev)throw new Error("unknown node");
  const nAtt=attempts.filter(a=>a.nodeId===nodeId).length;
  const cached=opts.noCache?null:LS.get(diagKey(nodeId));
  if(cached&&cached.nAtt===nAtt&&cached.out)return cached.out;
  const sys=
    "너는 수학 학습 진단 전문가다. 학생의 지식 그래프 역추적 결과와 실제 채점 기록을 보고, "+
    "'이 단원이 흔들리는 근본 원인'을 인과적 서사로 설명한다. 규칙:\n"+
    "① 점수 나열이 아니라 개념 간 인과(어느 선수 개념의 결여가 어떻게 이 단원의 오류로 이어지는지)를 짚어라.\n"+
    "② 반드시 주어진 역추적 후보·채점 기록을 근거로 삼고, 근거 없는 추측은 하지 마라. 미측정 후보는 '확인이 필요하다'고 말해라.\n"+
    "③ 따뜻하지만 정확하게, 학생이 직접 읽는 톤(존중하는 평어체). 수식은 LaTeX($...$).\n"+
    "반드시 JSON만 출력(코드블록 없이):\n"+
    '{"rootCause":"근본 원인 한 문장","story":"서술식 진단 3~5문장 — 어떤 선수 개념의 어떤 결여가 시간적으로 어떻게 누적되어 지금 이 단원의 오류로 나타나는지","plan":["보강 순서 1(가장 뿌리부터)","보강 순서 2","보강 순서 3"]}';
  const r=await callAI(sys,ev.text,true,{maxTok:900,lang:tr("ko","en")},signal);
  if(!r||!r.story)throw new Error(tr("진단 생성 실패","Diagnosis failed"));
  const out={rootCause:r.rootCause||"",story:r.story,plan:Array.isArray(r.plan)?r.plan:[],t:Date.now()};
  if(!opts.noCache){try{LS.set(diagKey(nodeId),{nAtt,out});}catch(e){/* 캐시 실패해도 진단은 반환 */}}
  return out;
}

export { buildEvidence, narrateDiagnosis, diagKey };
