import { CFG, LS } from "../core/platform.js";
import { Cheer, Fb, Prof } from "../ui/common.jsx";
import { MathText } from "../ui/math.jsx";
import { PenPad, inkHas, renderInkPNG } from "../ui/pads.jsx";
import { callAI, uid } from "../core/ai.js";
import { bankSearch, toExamItem } from "../core/examBank.js";
import { activeStudent, logAttempt } from "../core/attempts.js";
import { errTypeById, normErrType, normFactors, normStage } from "../core/knowledgeGraph.js";
import { MathViz } from "../ui/mathviz/MathViz.jsx";
import { GeoInsight } from "../ui/GeoFeedback.jsx";
import React from "react";
const { useState, useEffect, useRef, useCallback } = React;

function Exam({deck,topic,onExit,student,academy,academyName}){
  const examLang=((deck&&deck.lang)||CFG.lang)==="en"?"en":"ko";
  const T=(ko,en)=>examLang==="en"?en:ko;
  const studyMat=deck?(deck.summary||deck.material.slice(0,8000)):"";
  const qmodel=CFG.qmodel||CFG.model;
  const examTitle=deck?deck.name:(topic?topic.label:T("시험","Exam"));
  const scopeId=deck?deck.id:("topic_"+((topic&&topic.id)||"x"));

  const [phase,setPhase]=useState("gen");     // gen | take | grading | result | error
  const [showReport,setShowReport]=useState(false);   // 학부모 상담 리포트 보기
  const [items,setItems]=useState([]);
  const [idx,setIdx]=useState(0);
  const [answers,setAnswers]=useState([]);    // [{choice,text}] (손글씨는 inkRef)
  const [grades,setGrades]=useState([]);
  const [score,setScore]=useState(0);
  const [maxScore,setMaxScore]=useState(0);
  const [genMsg,setGenMsg]=useState("");
  const [gradeProg,setGradeProg]=useState(0);
  const [errMsg,setErrMsg]=useState("");
  const [analysis,setAnalysis]=useState(null);     // 학생 총체 분석(AI) {overall,praise,strengths,growth,advice}
  const [analysisBusy,setAnalysisBusy]=useState(false);

  const padRef=useRef(null);
  const inkRef=useRef({});                     // {qid:{pages,w,h}}
  const abortRef=useRef(null);
  const answersRef=useRef([]); answersRef.current=answers;

  const TYPE_LABEL=(t)=>t==="mc"?T("객관식","Multiple choice"):t==="short"?T("단답형","Short answer"):T("서술·논술형","Essay");
  const LET="ABCDE";   // 객관식 보기 문자 — 기출 원본은 5지선다일 수 있음
  // 문제 출처 레이블: 기출(은행 원본 그대로) / 제작(신규 제작). Study의 기출변형과 함께 3분류.
  const originChip=(o,src)=>o?(<>
    <span className="chip" style={{background:o==="기출"?"#FFF7E0":"#EEF2FF",color:o==="기출"?"#946200":"#3730A3",fontWeight:800}}>
      {o==="기출"?"📜 "+T("기출","Past exam"):"✨ "+T("제작","Original")}</span>
    {o==="기출"&&src&&<span style={{fontSize:11,color:"var(--sub)",alignSelf:"center"}}>{src}</span>}
  </>):null;

  // ── 출제 ──
  useEffect(()=>{generate();return ()=>{abortRef.current?.abort();};},[]);
  async function generate(){
    abortRef.current?.abort();
    const ctrl=new AbortController();abortRef.current=ctrl;
    setPhase("gen");setErrMsg("");setGenMsg(T("시험지 만드는 중… 최상 퀄리티로 출제할게 (조금 걸려)","Building your test at top quality (takes a moment)…"));
    try{
      const schema=
        "반드시 JSON만 출력(코드블록 없이):\n"+
        '{"questions":[\n'+
        ' {"type":"mc","unit":"단원명","concept":"개념명","points":5,"question":"문제","choices":["A","B","C","D"],"answer":0,"solution":"정답 풀이/이유"},\n'+
        ' {"type":"short","unit":"단원명","concept":"개념명","points":5,"question":"문제","answer":"대표 정답","accept":["허용 동의어"],"solution":"부연"},\n'+
        ' {"type":"essay","unit":"단원명","concept":"개념명","points":15,"question":"문제","rubric":["채점기준1","채점기준2","채점기준3"],"model_answer":"모범답안(수식 LaTeX)"}\n'+
        ']} (answer는 정답 보기의 0-based 인덱스. "unit"은 그 문항이 속한 단원명 — 아래 지정된 단원명을 그대로 사용)';
      const DIFF_KO={easy:"쉬움(기초 개념·계산)",medium:"보통(표준 유형)",hard:"어려움(응용·심화)"};
      const commonRule=
        "객관식(mc)·단답형(short)·서술/논술형(essay)을 적절히 섞고, 문항 수를 범위 깊이에 맞게 스스로 정해(보통 6~10문항). 난이도는 쉬움→어려움 고루.\n"+
        "출제 규칙: ① 정답이 문제 문장에 드러나면 안 됨 ② 객관식 오답 3개는 모두 그럴듯(흔한 오개념) ③ 서술형은 단계적 풀이·근거를 요구하는 좋은 문제 ④ 수식은 KaTeX로 렌더되는 유효한 LaTeX($...$)로 — 여는 $·중괄호 {}·\left\right는 반드시 닫고, 위/아래첨자(^_) 뒤엔 인자를 붙이고(x^2처럼), 인라인 안엔 줄바꿈 금지(여러 줄·행렬은 $$...$$). 유니코드 수학기호 대신 \times \le \int 등 명령 사용 ⑤ 범위 전반을 고르게.\n"+
        "배점: 객관식·단답은 작게, 서술은 크게. 총합 100점 근처.\n";
      let sys,userMsg;
      let bankPicked=[];          // 기출은행에서 원본 그대로 출제할 문항 (origin="기출")
      let markMade=false;         // 학원 시험이면 AI 신규 문항에 origin="제작" 표시
      if(topic&&topic.src){
        // 책(교재) 시험 — 선택 단원의 교재 내용(src)으로, 지정한 문항 수만큼 출제
        const n=Math.max(1,Math.min(40,Number(topic.count)||8));
        sys="너는 대학 전공 교재로 시험을 출제하는 전문가야. 아래 [교재 내용]에 근거해서만 실전 시험지를 만들어(교재에 없는 내용은 절대 출제 금지). 반드시 정확히 "+n+"문항만 출제해. mc(객관식)·short(단답)·essay(서술)를 적절히 섞고 난이도는 쉬움→어려움 고루. 각 문항의 'unit'에 그 문항이 속한 단원명을 넣어.\n출제 규칙: ① 정답이 문제 문장에 드러나면 안 됨 ② 객관식 오답 3개는 모두 그럴듯(흔한 오개념) ③ 서술형은 단계적 풀이·근거를 요구 ④ 수식은 KaTeX로 렌더되는 유효한 LaTeX($...$)로 — 여는 $·중괄호 {}·\left\right는 반드시 닫고, 위/아래첨자(^_) 뒤엔 인자를 붙이고(x^2처럼), 인라인 안엔 줄바꿈 금지(여러 줄·행렬은 $$...$$). 유니코드 수학기호 대신 \times \le \int 등 명령 사용 ⑤ 범위 전반을 고르게. 배점: 객관식·단답 작게, 서술 크게.\n"+schema;
        userMsg="[총 문항 수] 정확히 "+n+"문항\n[단원] "+((topic.unitNames||[]).join(", ")||"전체")+"\n[교재 내용]:\n"+(""+topic.src).slice(0,14000);
      }else if(topic&&Array.isArray(topic.units)&&topic.units.length){
        // 학원 레벨테스트 — 기출은행 우선: 단원별 검증 기출을 먼저 꺼내고, 모자란 만큼만 AI가 신규 제작
        markMade=true;
        const aiUnits=[];
        topic.units.forEach(u=>{
          const want=Math.max(1,Number(u.count)||2);
          const hits=bankSearch({unit:u.name,verifiedOnly:true,limit:want});
          bankPicked.push(...hits.map(it=>toExamItem(it,uid)));
          if(want-hits.length>0)aiUnits.push({...u,count:want-hits.length});
        });
        if(bankPicked.length)setGenMsg(T("검증된 기출 "+bankPicked.length+"문항 확보 — "+(aiUnits.length?"나머지는 신규 제작 중… (조금 걸려)":"기출만으로 시험지를 구성했어!"),
          "Using "+bankPicked.length+" verified past-exam questions…"));
        if(!aiUnits.length){
          // 전 문항이 검증 기출 — AI 호출 없이 즉시 시험지 완성 (가장 빠르고 가장 정확)
          setItems(bankPicked);setAnswers(bankPicked.map(()=>({})));
          setMaxScore(bankPicked.reduce((s,q)=>s+q.points,0));
          inkRef.current={};setIdx(0);setPhase("take");return;
        }
        const lines=aiUnits.map(u=>"· "+u.name+" — "+(u.count||2)+"문항, 난이도 "+(DIFF_KO[u.difficulty]||u.difficulty||"보통")).join("\n");
        const totalQ=aiUnits.reduce((s,u)=>s+(Number(u.count)||0),0);
        sys="너는 대한민국 중·고등 수학 학원의 베테랑 출제위원이야. 학원 '레벨테스트(진단평가)'용 시험지를 한국 수학 교육과정 표준에 근거해 만들어. 아래 [단원별 출제 지시]를 정확히 지켜 — 각 단원에서 지정된 문항 수만큼, 지정된 난이도로 출제하고, 문항마다 그 문항이 속한 단원명을 'unit' 필드에 아래 표기 그대로 넣어. 학생 수준을 진단할 수 있게 단원별 핵심 유형(개념·계산·증명·그래프·활용)을 담아.\n"+
          "출제 규칙: ① 정답이 문제 문장에 드러나면 안 됨 ② 객관식 오답 3개는 모두 그럴듯(흔한 오개념) ③ 서술형은 단계적 풀이·근거를 요구 ④ 수식은 KaTeX로 렌더되는 유효한 LaTeX($...$)로 — 여는 $·중괄호 {}·\left\right는 반드시 닫고, 위/아래첨자(^_) 뒤엔 인자를 붙이고(x^2처럼), 인라인 안엔 줄바꿈 금지(여러 줄·행렬은 $$...$$). 유니코드 수학기호 대신 \times \le \int 등 명령 사용 ⑤ mc/short/essay를 적절히 섞어. 배점: 객관식·단답 작게, 서술 크게, 총합 100점 근처.\n"+schema;
        userMsg="[학년·과목] "+(topic.grade||topic.subject||"")+"\n[단원별 출제 지시] (총 "+totalQ+"문항)\n"+lines+"\n반드시 지정 단원만, 지정 문항 수대로 출제.";
      }else if(topic){
        // 교과과정(목차) 기반 — 자료 없이 한국 수학 교육과정 표준 내용으로 출제 (단일 단원)
        sys="너는 대한민국 중·고등 수학 학원의 베테랑 출제위원이야. 아래 [학년·과목]의 [단원] 범위에서, 한국 수학 교육과정 표준 내용에 근거한 실전 시험지를 만들어. 그 단원에서 실제로 시험에 자주 나오는 핵심 유형(개념·계산·증명·그래프·활용)을 빠짐없이 담아. "+commonRule+schema;
        userMsg="[학년·과목] "+(topic.subject||"")+"\n[단원] "+(topic.unit||"")+(topic.sub?(" > "+topic.sub):"")+"\n이 단원 범위만 출제(다른 단원 내용은 섞지 마).";
      }else{
        const concepts=(deck.concepts||[]).map(c=>c.name).slice(0,40).join(", ");
        sys="너는 대학·학원 단원평가 출제위원이야. 아래 [자료] 전체를 포괄하는 실전 시험지를 만들어. "+commonRule+"단, 자료에 근거가 있는 것만 출제.\n"+schema+"\n\n[자료]:\n"+studyMat.slice(0,7000);
        userMsg="개념 목록: "+concepts;
      }
      const r=await callAI(sys,userMsg,true,{maxTok:8000,model:qmodel,lang:examLang},ctrl.signal);
      const arr=Array.isArray(r)?r:(r&&Array.isArray(r.questions)?r.questions:[]);
      const norm=arr.filter(q=>q&&q.question&&["mc","short","essay"].includes(q.type)).map(q=>({
        id:uid(),type:q.type,concept:q.concept||"",unit:q.unit||q.concept||"",points:Math.max(1,Math.round(Number(q.points)||(q.type==="essay"?15:5))),
        question:String(q.question),
        choices:q.type==="mc"&&Array.isArray(q.choices)?q.choices.slice(0,4):undefined,
        answer:q.type==="mc"?Number(q.answer)||0:undefined,
        accept:Array.isArray(q.accept)?q.accept:[],
        rubric:Array.isArray(q.rubric)?q.rubric:[],
        solution:q.solution||"",model_answer:q.model_answer||"",
        origin:markMade?"제작":undefined,
      })).filter(q=>q.type!=="mc"||(q.choices&&q.choices.length===4));
      if(!norm.length&&!bankPicked.length)throw new Error(T("문항을 만들지 못했어. 자료가 너무 짧거나 형식 오류.","Couldn't build questions."));
      // 기출 + 신규 제작 병합 — 단원 선택 순서대로 정렬(단원별 진단 흐름 유지)
      let finalItems=norm;
      if(bankPicked.length){
        const uo=(u)=>{const i=(topic&&Array.isArray(topic.units))?topic.units.findIndex(x=>x.name===u):-1;return i<0?999:i;};
        finalItems=[...bankPicked,...norm].sort((a,b)=>uo(a.unit)-uo(b.unit));
      }
      setItems(finalItems);setAnswers(finalItems.map(()=>({})));setMaxScore(finalItems.reduce((s,q)=>s+q.points,0));
      inkRef.current={};setIdx(0);setPhase("take");
    }catch(e){if(e.name==="AbortError")return;setErrMsg((e&&e.message)||String(e));setPhase("error");}
  }

  // ── 응시: 문항 넘길 때 손글씨 보존/복원 ──
  useEffect(()=>{
    if(phase!=="take")return;
    const id=items[idx]?.id;const pad=padRef.current;
    if(pad&&id)pad.load(inkRef.current[id]);
  },[idx,phase]);
  function saveInk(){const q=items[idx];const pad=padRef.current;if(q&&pad)inkRef.current[q.id]=pad.dump();}
  function goto(n){if(n<0||n>=items.length)return;saveInk();setIdx(n);}
  const setChoice=(i)=>setAnswers(a=>a.map((x,k)=>k===idx?{...x,choice:i}:x));
  const setText=(t)=>setAnswers(a=>a.map((x,k)=>k===idx?{...x,text:t}:x));
  const answered=(i)=>{const a=answers[i]||{},q=items[i];return (q?.type==="mc"?a.choice!=null:(a.text&&a.text.trim())||inkHas(inkRef.current[q?.id]));};

  // ── 제출 → 일괄 채점 ──
  async function submit(){
    saveInk();
    const left=items.filter((q,i)=>!answered(i)).length;
    const msg=left>0?T(left+"문항이 비어 있어. 그래도 제출하고 채점할까? (제출 후 수정 불가)",left+" question(s) blank. Submit and grade anyway? (no edits after)")
                    :T("제출하면 채점이 시작돼 (수정 불가). 최상 퀄리티 채점이라 조금 걸려. 제출할까?","Submit and grade? Quality grading takes a bit. (No edits after)");
    if(!confirm(msg))return;
    abortRef.current?.abort();
    const ctrl=new AbortController();abortRef.current=ctrl;
    setPhase("grading");setGradeProg(0);setAnalysis(null);
    const ans=answersRef.current;
    const tasks=items.map((q,i)=>({q,i,ans:ans[i]||{},ink:inkRef.current[q.id]}));
    const out=new Array(items.length);let done=0;
    const lanes=[[],[],[]];tasks.forEach((t,i)=>lanes[i%3].push(t));
    async function worker(list){
      for(const t of list){
        if(ctrl.signal.aborted)return;
        try{out[t.i]=await gradeOne(t,ctrl.signal);}
        catch(e){if(e.name==="AbortError")return;out[t.i]={error:true,points:t.q.points,score:0,model:t.q.model_answer||t.q.solution||"",type:t.q.type,mcAnswer:t.q.answer,choice:t.ans.choice,text:t.ans.text,concept:t.q.concept,unit:t.q.unit||t.q.concept||"",origin:t.q.origin,srcLabel:t.q.srcLabel,figure:t.q.figure||null,figureScript:t.q.figureScript||null,inkImg:inkHas(t.ink)?renderInkPNG(t.ink):null,gap:T("채점 오류 — 다시 시도해줘","Grading error")};}
        done++;setGradeProg(done);
      }
    }
    await Promise.all(lanes.map(worker));
    if(ctrl.signal.aborted)return;
    const total=out.reduce((s,g)=>s+(g&&g.score||0),0);
    setGrades(out);setScore(total);setIdx(0);setPhase("result");
    const key=saveRecord(out,total);
    analyzeStudent(out,total,ctrl.signal).then(a=>{ if(a&&key){try{const r=LS.get(key);if(r){r.analysis=a;LS.set(key,r);}}catch{}} });
  }

  // 학생 총체 분석(시험 전체를 보고 복합·심층 분석 + 문항 근거 예시 + 확실한 칭찬). 채점 뒤 1콜.
  async function analyzeStudent(out,total,signal){
    setAnalysisBusy(true);
    try{
      const us=aggUnits(out);
      const unitLines=us.map(u=>u.unit+": "+u.rate+"% ("+u.sc+"/"+u.pts+")").join(" / ");
      const cut=(s)=>(s||"").toString().replace(/\s+/g," ").slice(0,90);
      const qlines=out.map((g,i)=>(i+1)+"번 ["+TYPE_LABEL(g.type)+"·"+(g.unit||g.concept||"기타")+"] "+(g.score||0)+"/"+(g.points||0)+"점 "+(g.verdict||"")+" | 핵심:"+cut(g.essence)+" | 잘함:"+cut(g.gotIt)+" | 갭:"+cut(g.gap)).join("\n");
      const sys=
        "너는 수학 학원의 베테랑 진단 교수다. 한 학생의 시험 전체를 보고 '총체적이고 심층적인' 분석을 한다. 단순 점수 나열이 아니라 학생의 사고 특성을 읽어라 — 수학적 감각·사고력, 개념 간 유기성(개념을 따로따로 아는지 서로 연결하는지), 계산 능력, 영역 편차(예: 도형 약함), 실수 빈도(아는데 틀리는지), 답은 맞아도 풀이에 핵심개념이 빠졌는지 등을 복합적으로 짚어라. 반드시 구체적 문항을 근거로 들어라(예: '2번은 맞았지만 핵심개념이 풀이에서 누락'). 칭찬할 점은 분명하고 구체적으로 칭찬해라. 따뜻하지만 정확하게, 학부모가 읽을 상담 소견 톤(반말 금지, 존중하는 평어체).\n"+
        "수식·기호는 LaTeX($...$). 반드시 JSON만 출력(코드블록 없이):\n"+
        '{"overall":"학생의 큰 그림 2~4문장(수학적 감/사고력/개념 유기성 등)","praise":["확실히 칭찬할 점 1~3개, 구체적으로"],"strengths":[{"label":"강점 한마디","evidence":"몇 번 문항을 근거로 구체적으로"}],"growth":[{"label":"성장이 필요한 영역 한마디","evidence":"몇 번 문항 근거로 구체적으로(예: n번은 맞았지만 핵심개념 누락)"}],"advice":"앞으로의 학습 방향 1~2가지 구체 제언"}';
      const ep=errProfileData(out);
      const errLine=Object.entries(ep.counts).map(([k,n])=>(errTypeById(k)?.name||k)+" "+n).join(" · ");
      const usr="[학생] "+(student||"학생")+"\n[시험] "+examTitle+"\n[총점] "+total+"/"+maxScore+" ("+(maxScore?Math.round(total/maxScore*100):0)+"%)\n[단원별] "+unitLines+
        (errLine?"\n[오류 성격 분포 — 실수는 개념이 아니라 절차 문제] "+errLine:"")+"\n[문항별]\n"+qlines;
      const r=await callAI(sys,usr,true,{maxTok:1800,lang:examLang},signal);
      if(r&&(r.overall||(r.strengths&&r.strengths.length)||(r.praise&&r.praise.length))){setAnalysis(r);setAnalysisBusy(false);return r;}
    }catch(e){if(e.name!=="AbortError")console.warn("[exam] 분석 실패",e);}
    setAnalysisBusy(false);return null;
  }

  async function gradeOne({q,ans,ink},signal){
    const inkImg=inkHas(ink)?renderInkPNG(ink):null;
    const blocks=[];
    // 문제 그림(기하·그래프)이 있으면 첫 번째 이미지로 채점 AI에 전달 — 그림 없이는 채점 근거가 불완전
    const figM=q.figure?String(q.figure).match(/^data:(image\/[\w+.-]+);base64,(.+)$/):null;
    if(figM)blocks.push({type:"image",source:{type:"base64",media_type:figM[1],data:figM[2]}});
    if(inkImg)blocks.push({type:"image",source:{type:"base64",media_type:"image/jpeg",data:inkImg}});
    const parts=["[문항 유형] "+TYPE_LABEL(q.type),"[배점] "+q.points+"점","[문제]\n"+q.question];
    if(figM)parts.push(inkImg?"※ 이미지 순서: 첫 번째=[문제 그림], 두 번째=학생의 손글씨(연습장/답안).":"※ 첫 번째 이미지는 [문제 그림]이야.");
    // 벡터 그림이 있으면 스크립트 원문도 전달 — 래스터보다 정확한 함수식·좌표가 채점 근거가 된다
    if(q.figureScript)parts.push("[문제 그림 — 벡터 장면 스크립트(정확한 함수·좌표, 그림과 동일)]\n"+JSON.stringify(q.figureScript));
    if(q.type==="mc"){
      parts.push("[보기]\n"+q.choices.map((c,i)=>LET[i]+". "+c).join("\n"));
      parts.push("[정답] "+LET[q.answer]);
      parts.push("[학생이 고른 답] "+(ans.choice!=null?LET[ans.choice]:T("미선택","none")));
      parts.push("[정답 풀이] "+(q.solution||""));
      parts.push("※ 학생이 위 이미지(연습장)에 정답을 고른 '근거'를 손글씨로 적었을 수 있어. 반드시 읽어서 근거의 타당성까지 평가해. 답만 맞고 근거가 빈약하면 부분점수.");
    }else if(q.type==="short"){
      parts.push("[정답] "+q.answer+(q.accept&&q.accept.length?" (허용: "+q.accept.join(", ")+")":""));
      parts.push("[학생 답(텍스트)] "+(ans.text||T("(없음)","(none)")));
      parts.push("[부연] "+(q.solution||""));
      parts.push("※ 학생이 위 이미지에 손글씨로 답·풀이를 적었을 수 있어 — 함께 읽어. 오타·표현차는 관대하게.");
    }else{
      parts.push("[채점 기준(rubric)] "+JSON.stringify(q.rubric||[]));
      parts.push("[모범답안] "+(q.model_answer||""));
      parts.push("[학생 답(텍스트)] "+(ans.text||T("(없음)","(none)")));
      parts.push("※ 학생의 서술 답안은 주로 위 이미지에 손글씨로 있어 — 반드시 읽어서 rubric 항목별로 부분점수를 매겨.");
    }
    blocks.push({type:"text",text:parts.join("\n")});
    const sys=
      "너는 학원 시험 채점위원이자 1:1 튜터야. 아래 한 문항을 깊이 채점해. 단순 정오를 넘어, 학생이 무엇을 알고 무엇을 모르는지·무엇을 잘했고 어디가 결핍인지 구체적으로 짚어줘(반말, 따뜻하지만 정확하게). 객관식은 고른 답의 정오뿐 아니라 손글씨 '근거'의 타당성도 채점에 반영. 서술형은 rubric 항목별 부분점수. 점수는 반드시 [배점] 범위(0~배점) 안의 숫자.\n"+
      "수식·기호는 LaTeX($...$). 반드시 JSON만 출력(코드블록 없이):\n"+
      '{"score":획득점수숫자,"verdict":"correct|partial|incorrect","essence":"이 문항이 진짜 묻는 핵심 1~2문장","gotIt":"내가 제대로 한 것(구체적, 없으면 \'없음\')","gap":"결핍·약점(구체적, 없으면 \'없음\')","known":"내 답에서 드러난, 내가 확실히 아는 것","unknown":"드러난, 내가 모르거나 헷갈리는 것","next":"이 약점을 메우려면 뭘 보강해야 하는지","model":"모범답안/풀이(수식 LaTeX)","factors":{"개념":0~2,"계산":0~2,"전략":0~2,"추론":0~2}}\n'+
      '(factors는 답안에서 드러난 능력 평가 — 개념 이해/계산 정확성/식 세우기·문제 해석/논리 전개. 0=부족 1=보통 2=좋음, 드러나지 않은 능력은 키 자체를 생략)\n'+
      '추가로 오답이면 "error":{"type":"실수|개념|전략|해석|표기|기하구성|백지","stage":"식세우기|계산|해석","label":"오개념 12자 라벨"}를 포함해 (정답이면 error 생략). type에서 실수(개념은 아는데 계산·부호 실수)와 개념(개념 자체를 모름)의 구분이 가장 중요해. 도형·그래프 문항에서 보조선(높이·수선·접선)이나 그림 구성 누락이 오답의 원인이면 기하구성.';
    const r=await callAI(sys,blocks,true,{maxTok:1600,lang:examLang},signal);
    const pts=q.points||0;
    let sc=Number(r&&r.score);
    if(!isFinite(sc))sc=(q.type==="mc"?(ans.choice===q.answer?pts:0):0);
    sc=Math.max(0,Math.min(pts,Math.round(sc*10)/10));
    return {score:sc,points:pts,verdict:r&&r.verdict,essence:r&&r.essence,gotIt:r&&r.gotIt,gap:r&&r.gap,known:r&&r.known,unknown:r&&r.unknown,next:r&&r.next,
      factors:(r&&r.factors)||null,error:(r&&r.error)||null,
      model:(r&&r.model)||q.model_answer||q.solution||"",type:q.type,mcAnswer:q.answer,choices:q.choices,choice:ans.choice,text:ans.text,question:q.question,concept:q.concept,unit:q.unit||q.concept||"",
      origin:q.origin,srcLabel:q.srcLabel,figure:q.figure||null,figureScript:q.figureScript||null,inkImg};
  }

  // 단원별 집계: 단원→{정답률·약점·보강}. 결과 요약·학부모 리포트·저장에 공용 사용
  function aggUnits(gr){
    const m={};
    gr.forEach(g=>{const u=(g&&(g.unit||g.concept))||T("기타","Other");(m[u]=m[u]||[]).push(g);});
    return Object.keys(m).map(unit=>{
      const gs=m[unit];
      const pts=gs.reduce((s,g)=>s+(g.points||0),0),sc=gs.reduce((s,g)=>s+(g.score||0),0);
      const rate=pts?Math.round(sc/pts*100):0;
      const wrong=gs.filter(g=>g.verdict!=="correct");
      return{unit,n:gs.length,sc,pts,rate,weak:rate<60,
        gaps:wrong.map(g=>g.gap).filter(x=>x&&x!=="없음"),
        nexts:wrong.map(g=>g.next).filter(Boolean)};
    }).sort((a,b)=>a.rate-b.rate);
  }
  function saveRecord(gr,total){
    try{
      const id=uid();
      const rec={id,scope:scopeId,title:examTitle,studentName:student||"",sid:activeStudent()||undefined,takenAt:Date.now(),score:total,maxScore,
        byUnit:aggUnits(gr),grades:gr.map(g=>({...g}))};
      const key="ng:exam:"+scopeId+":"+id;
      LS.set(key,rec);
      const idxKey="ng:examidx:"+scopeId;
      const list=LS.get(idxKey)||[];
      LS.set(idxKey,[{id,takenAt:rec.takenAt,score:total,maxScore},...list].slice(0,50));
      // 시도 로그에도 문항별로 기록 — 지식 그래프·요인 분석의 원천 데이터 (이미지 제외, 텍스트만)
      gr.forEach(g=>{if(g)logAttempt({src:"exam",deckId:deck?deck.id:undefined,concept:g.concept||"",unit:g.unit||"",
        verdict:g.verdict||"partial",gap:g.gap&&g.gap!=="없음"?g.gap:"",qtype:g.type,score:g.score,points:g.points,factors:g.factors,
        err:g.verdict==="correct"?"none":normErrType(g.error&&g.error.type),
        stage:normStage(g.error&&g.error.stage),misc:(g.error&&g.error.label)||undefined});});
      return key;
    }catch(e){console.warn("[exam] 기록 저장 실패",e);return null;}
  }

  const pct=maxScore?Math.round(score/maxScore*100):0;
  const vColor=(v)=>v==="correct"?"#1E9E5A":v==="incorrect"?"#D9534F":"#C98A00";
  const vLabel=(v)=>v==="correct"?T("정답","Correct"):v==="incorrect"?T("오답","Wrong"):T("부분","Partial");

  // ── 오류 프로파일: 문항 채점의 error/factors 집계 (결과·학부모 리포트 공용) ──
  function errProfileData(gr){
    const counts={};const fs={cu:[],pf:[],sc:[],ar:[]};
    gr.forEach(g=>{
      if(!g)return;
      const e=g.verdict==="correct"?null:normErrType(g.error&&g.error.type);
      if(e&&e!=="none")counts[e]=(counts[e]||0)+1;
      const f=normFactors(g.factors);
      if(f)for(const k in f)if(fs[k])fs[k].push(f[k]);
    });
    const favg={};for(const k in fs)favg[k]=fs[k].length?fs[k].reduce((s,v)=>s+v,0)/fs[k].length:null;
    return{counts,favg,hasErr:Object.keys(counts).length>0,hasF:Object.values(favg).some(v=>v!=null)};
  }
  function errAdvice(counts){
    const n=(k)=>counts[k]||0;
    if(n("slip")>=2&&n("slip")>=n("concept"))return T("오답의 다수가 '실수' 유형입니다 — 개념은 알고 있으므로 계산 절차·검산 습관 훈련이 가장 효과적입니다.","Most misses are slips — the concepts are there; drill procedure and checking habits.");
    if(n("concept")>=2)return T("'개념 결여'형 오답이 많습니다 — 해당 단원의 선수 개념부터 다시 잡는 보강을 권합니다.","Concept-gap errors dominate — remediate prerequisite concepts first.");
    if(n("interpret")>=2)return T("문제 조건을 놓치는 '해석 오류'가 잦습니다 — 조건에 표시하며 읽는 훈련을 권합니다.","Frequent misreading of conditions — train annotated reading.");
    if(n("strategy")>=2)return T("풀이 '전략 선택' 오류가 반복됩니다 — 유형별 접근법을 정리하는 학습을 권합니다.","Repeated strategy-choice errors — organize approach patterns by problem type.");
    return null;
  }
  const FLABEL={cu:[T("개념 이해","Concept"),"#6C5CE7"],pf:[T("계산","Fluency"),"#4FACFE"],sc:[T("식 세우기","Strategy"),"#27C2A0"],ar:[T("논리","Reasoning"),"#FFC24B"]};
  // compact=결과 화면용 칩 / 아니면 리포트용 풀 섹션
  function errProfileView(gr,compact){
    const ep=errProfileData(gr);
    if(!ep.hasErr&&!ep.hasF)return null;
    const chips=Object.entries(ep.counts).sort((a,b)=>b[1]-a[1]).map(([id,n])=>{
      const et=errTypeById(id);
      return <span key={id} className="chip" title={et?.desc||""} style={{background:(et?.color||"#888")+"1e",color:et?.color||"var(--sub)",border:"1px solid "+(et?.color||"#888")+"55"}}>{(et?.name||id)+" "+n}</span>;});
    const advice=errAdvice(ep.counts);
    if(compact)return(
      <div style={{marginBottom:16}}>
        <div style={{fontSize:12,fontWeight:700,color:"var(--sub)",marginBottom:6}}>{T("오류 성격","Error profile")}</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>{chips}</div>
        {advice&&<div style={{fontSize:12.5,color:"var(--pri-d)",fontWeight:700,marginTop:6}}>💡 {advice}</div>}
      </div>);
    return(
      <div style={{marginBottom:18}}>
        <div style={{fontFamily:"'Jua',sans-serif",fontSize:15,color:"var(--ink)",marginBottom:8}}>🔬 {T("오류 성격 분석","Error profile")}</div>
        {ep.hasErr&&<div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:advice?6:10}}>{chips}</div>}
        {advice&&<div style={{background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:10,padding:"9px 13px",fontSize:13,lineHeight:1.6,marginBottom:10}}>💡 {advice}</div>}
        {ep.hasF&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:"8px 14px"}}>
            {Object.keys(FLABEL).map(k=>{
              const v=ep.favg[k];if(v==null)return null;
              const[lbl,col]=FLABEL[k];
              return(
                <div key={k}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:11.5,marginBottom:3}}>
                    <span style={{color:"var(--sub)",fontWeight:600}}>{lbl}</span>
                    <b style={{color:col}}>{Math.round(v*100)}%</b>
                  </div>
                  <div className="bar" style={{height:7}}><i style={{width:Math.round(v*100)+"%",background:col}}/></div>
                </div>);})}
          </div>)}
        <div style={{fontSize:10.5,color:"var(--sub)",marginTop:8}}>{T("이 시험의 답안에서 드러난 능력 평가 (NRC 수학적 숙련도 요인 기준)","Ability evidence from this exam (NRC proficiency strands)")}</div>
      </div>);
  }

  // 학생 총체 분석 렌더(결과 화면·학부모 리포트 공용). analysis 없으면 null.
  function analysisInner(){
    const a=analysis; if(!a)return null;
    const lblS=(c)=>({fontWeight:800,color:c,fontSize:12.5,marginBottom:4,marginTop:2});
    const itemS={fontSize:13.5,lineHeight:1.65,marginBottom:3};
    return [
      a.overall?<div key="ov" style={{margin:"0 0 12px",lineHeight:1.75,fontSize:14}}><MathText text={a.overall} tag="span"/></div>:null,
      (a.praise&&a.praise.length)?<div key="pr" style={{marginBottom:11}}>
        <div style={lblS("#065F46")}>👏 {T("이런 점이 좋아요","What's great")}</div>
        {a.praise.map((p,i)=><div key={i} style={itemS}>· <MathText text={String(p)} tag="span"/></div>)}
      </div>:null,
      (a.strengths&&a.strengths.length)?<div key="st" style={{marginBottom:11}}>
        <div style={lblS("var(--pri-d)")}>💪 {T("강점","Strengths")}</div>
        {a.strengths.map((s,i)=><div key={i} style={itemS}>· <b><MathText text={String(s.label||"")} tag="span"/></b>{s.evidence?<> — <MathText text={String(s.evidence)} tag="span"/></>:null}</div>)}
      </div>:null,
      (a.growth&&a.growth.length)?<div key="gr" style={{marginBottom:11}}>
        <div style={lblS("#9B1C1C")}>🌱 {T("성장이 필요한 부분","Growth areas")}</div>
        {a.growth.map((s,i)=><div key={i} style={itemS}>· <b><MathText text={String(s.label||"")} tag="span"/></b>{s.evidence?<> — <MathText text={String(s.evidence)} tag="span"/></>:null}</div>)}
      </div>:null,
      a.advice?<div key="ad" style={{background:"#fff",border:"1px solid var(--pri)",borderRadius:10,padding:"10px 13px",fontSize:13.5,lineHeight:1.65}}><b style={{color:"var(--pri-d)"}}>🎯 {T("학습 제언","Advice")}:</b> <MathText text={String(a.advice)} tag="span"/></div>:null
    ];
  }

  // ── 렌더 ──
  return(
    <section className="study">
      <div className="card study-bar">
        <span className="snm">📝 {examTitle} · {T("시험 보기","Exam")}</span>
        {phase==="take"&&<span className="muted" style={{fontSize:11,marginLeft:"auto"}}>{T("문항 ","Q ")}{idx+1}/{items.length}</span>}
        {phase==="result"&&<span className="muted" style={{fontSize:12,marginLeft:"auto",fontWeight:800,color:"var(--pri-d)"}}>{score}/{maxScore} · {pct}%</span>}
        <button className="btn gho xs" style={{flexShrink:0,marginLeft:phase==="take"||phase==="result"?8:"auto"}} onClick={()=>{abortRef.current?.abort();onExit();}}>✕ {T("나가기","Exit")}</button>
      </div>

      <div className="stage">
        {phase==="gen"&&(
          <div className="card qcard msgcard"><div className="spinner"/><p className="muted">{genMsg}</p><Cheer style={{marginTop:6}}/></div>
        )}
        {phase==="error"&&(
          <div className="card qcard msgcard"><Prof size={56}/><p className="muted">{T("출제 실패: ","Failed: ")}{errMsg}</p>
            <button className="btn pri" onClick={generate}>{T("다시 출제","Retry")}</button></div>
        )}
        {phase==="grading"&&(
          <div className="card qcard msgcard">
            <div className="spinner"/>
            <p className="muted" style={{marginBottom:10}}>{T("최상 퀄리티로 채점 중… 손글씨 근거까지 꼼꼼히 봐","Grading at top quality — reading your handwritten reasoning too")}</p>
            <div style={{width:"100%",maxWidth:320}}>
              <div className="bar" style={{height:10}}><i style={{width:(items.length?Math.round(gradeProg/items.length*100):0)+"%",background:"linear-gradient(90deg,var(--pri),var(--mint))"}}/></div>
              <div style={{textAlign:"center",fontSize:12,color:"var(--sub)",marginTop:6}}>{gradeProg}/{items.length} {T("문항","graded")}</div>
            </div>
            <Cheer style={{marginTop:12}}/>
          </div>
        )}

        {phase==="take"&&items[idx]&&(()=>{const q=items[idx];const a=answers[idx]||{};return(
          <div className="card qcard" key={q.id} style={{maxWidth:760,margin:"0 auto"}}>
            <div className="chips" style={{marginBottom:12}}>
              <span className="chip" style={{background:"var(--pri-s)",color:"var(--pri-d)"}}>{TYPE_LABEL(q.type)}</span>
              {originChip(q.origin,q.srcLabel)}
              {q.concept&&<MathText text={q.concept} tag="span" className="chip gho"/>}
              <span className="chip gho">{q.points}{T("점","pt")}</span>
              <span style={{marginLeft:"auto",fontSize:11,color:"var(--sub)"}}>{idx+1} / {items.length}</span>
            </div>
            <MathText text={q.question} tag="div" style={{fontSize:17,fontWeight:600,lineHeight:1.7,marginBottom:q.figure?10:14}}/>
            {q.figureScript
              ?<div style={{maxWidth:560,margin:"0 auto 14px"}}><MathViz script={q.figureScript} controls autoplay={false}/></div>
              :q.figure&&<img src={q.figure} alt={T("문제 그림","Figure")} style={{maxWidth:"100%",maxHeight:360,display:"block",margin:"0 auto 14px",border:"1px solid var(--line)",borderRadius:10,background:"#fff"}}/>}

            {q.type==="mc"&&(
              <div style={{display:"flex",flexDirection:"column",gap:9,marginBottom:14}}>
                {q.choices.map((ch,i)=>{const on=a.choice===i;return(
                  <button key={i} type="button" onClick={()=>setChoice(i)}
                    style={{textAlign:"left",padding:"12px 15px",borderRadius:12,border:"1.5px solid "+(on?"var(--pri)":"var(--line)"),
                      background:on?"var(--pri-s)":"#FBFAFF",cursor:"pointer",display:"flex",gap:10,alignItems:"center"}}>
                    <span style={{fontWeight:800,color:on?"var(--pri-d)":"var(--sub)"}}>{LET[i]}</span>
                    <MathText text={ch} tag="span" style={{fontSize:15,lineHeight:1.5}}/>
                  </button>);})}
              </div>
            )}
            {q.type==="short"&&(
              <input className="field" value={a.text||""} onChange={e=>setText(e.target.value)}
                placeholder={T("정답을 입력 (또는 아래 연습장에 손글씨로)","Type your answer (or handwrite below)")} style={{marginBottom:14}}/>
            )}
            {q.type==="essay"&&(
              <textarea className="field" rows={3} value={a.text||""} onChange={e=>setText(e.target.value)}
                placeholder={T("서술 답안을 타이핑해도 되고, 아래 손글씨로 써도 돼 (둘 다 채점)","Type your essay, or handwrite below (both graded)")} style={{marginBottom:12,resize:"vertical"}}/>
            )}

            <div style={{fontSize:11.5,fontWeight:700,color:"var(--sub)",marginBottom:6}}>
              {q.type==="essay"?T("✍️ 손글씨 답안","✍️ Handwritten answer"):T("✍️ 풀이·근거 (학원 제출용 — 왜 그렇게 답했는지 적어줘)","✍️ Your reasoning (write why you chose this)")}
            </div>
            <PenPad ref={padRef} kind="exam" onText={()=>{}} hideOcr/>

            <div className="row" style={{marginTop:14,gap:8,alignItems:"center"}}>
              <button className="btn gho" onClick={()=>goto(idx-1)} disabled={idx<=0}>◀ {T("이전","Prev")}</button>
              <button className="btn gho" onClick={()=>goto(idx+1)} disabled={idx>=items.length-1}>{T("다음","Next")} ▶</button>
              <button className="btn pri" style={{marginLeft:"auto"}} onClick={submit}>{T("제출하고 채점받기 ✓","Submit & grade ✓")}</button>
            </div>
            {/* 문항 번호 점프 */}
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:12}}>
              {items.map((qq,i)=>(
                <button key={qq.id} type="button" onClick={()=>goto(i)}
                  title={answered(i)?T("응답함","answered"):T("미응답","blank")}
                  style={{width:30,height:30,borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",
                    border:"1.5px solid "+(i===idx?"var(--pri)":"var(--line)"),
                    background:i===idx?"var(--pri)":answered(i)?"var(--pri-s)":"#fff",
                    color:i===idx?"#fff":answered(i)?"var(--pri-d)":"var(--sub)"}}>{i+1}</button>
              ))}
            </div>
          </div>
        );})()}

        {phase==="result"&&!showReport&&(
          <div className="card qcard" style={{maxWidth:760,margin:"0 auto"}}>
            {/* 총점 헤더 */}
            <div style={{textAlign:"center",padding:"6px 0 16px",borderBottom:"1px solid var(--line)",marginBottom:16}}>
              <div style={{fontFamily:"'Jua',sans-serif",fontSize:40,color:pct>=80?"var(--mint)":pct>=60?"var(--gold)":"var(--rose)"}}>{score}<span style={{fontSize:20,color:"var(--sub)"}}> / {maxScore}</span></div>
              <div style={{fontSize:14,fontWeight:700,color:"var(--ink)",marginTop:2}}>{pct}% · {pct>=80?T("훌륭해! 🎉","Excellent! 🎉"):pct>=60?T("좋아, 약점만 보강하자 💪","Good — shore up the gaps 💪"):T("여기서부터 키우자 🔁","Let's build from here 🔁")}</div>
            </div>
            {/* 단원별 정답률 요약 */}
            {(()=>{const us=aggUnits(grades);return us.length>1?(
              <div style={{marginBottom:16}}>
                <div style={{fontSize:12,fontWeight:700,color:"var(--sub)",marginBottom:8}}>{T("단원별 정답률","Accuracy by unit")}</div>
                <div style={{display:"flex",flexDirection:"column",gap:9}}>
                  {us.map((u,i)=>(
                    <div key={i}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:3,gap:8}}>
                        <span style={{fontSize:13,fontWeight:600,color:u.weak?"#9B1C1C":"var(--ink)"}}>{u.weak?"⚠️ ":""}<MathText text={u.unit} tag="span"/></span>
                        <span style={{fontSize:13,fontWeight:800,color:u.rate>=80?"var(--mint)":u.rate>=60?"var(--gold)":"var(--rose)"}}>{u.rate}%</span>
                      </div>
                      <div className="bar"><i style={{width:u.rate+"%",background:u.rate>=80?"var(--mint)":u.rate>=60?"var(--gold)":"var(--rose)"}}/></div>
                    </div>
                  ))}
                </div>
              </div>
            ):null;})()}
            {/* 오류 성격 (실수 vs 개념 결여) */}
            {errProfileView(grades,true)}
            {/* 총체 분석 */}
            {(analysis||analysisBusy)&&(
              <div style={{marginBottom:16,border:"1.5px solid var(--line)",borderRadius:12,padding:"13px 15px"}}>
                <div style={{fontFamily:"'Jua',sans-serif",fontSize:15,color:"var(--ink)",marginBottom:8}}>🧠 {T("총체 분석","Overall analysis")}</div>
                {analysis?analysisInner():<div style={{color:"var(--sub)",fontSize:13,display:"flex",alignItems:"center",gap:8}}><span className="spinner" style={{width:16,height:16}}/>{T("학생 전체를 보고 심층 분석 작성 중…","Analyzing the whole test…")}</div>}
              </div>
            )}
            {/* 문항 네비 */}
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
              <button className="btn gho sm" onClick={()=>setIdx(i=>Math.max(0,i-1))} disabled={idx<=0}>◀</button>
              <span style={{fontSize:13,fontWeight:700}}>{T("문항 ","Q ")}{idx+1}/{grades.length}</span>
              <button className="btn gho sm" onClick={()=>setIdx(i=>Math.min(grades.length-1,i+1))} disabled={idx>=grades.length-1}>▶</button>
              {grades[idx]&&<span style={{marginLeft:"auto",fontWeight:800,color:vColor(grades[idx].verdict)}}>{grades[idx].score}/{grades[idx].points}{T("점","")} · {vLabel(grades[idx].verdict)}</span>}
            </div>
            {grades[idx]&&(()=>{const g=grades[idx];return(<>
              <span className="chip" style={{background:"var(--pri-s)",color:"var(--pri-d)"}}>{TYPE_LABEL(g.type)}</span>
              {originChip(g.origin,g.srcLabel)}
              <MathText text={g.question} tag="div" style={{fontSize:15.5,fontWeight:600,lineHeight:1.6,margin:"10px 0 12px"}}/>
              {g.figureScript
                ?<div style={{maxWidth:520,margin:"0 auto 12px"}}><MathViz script={g.figureScript} staticOnly controls={false}/></div>
                :g.figure&&<img src={g.figure} alt="" style={{maxWidth:"100%",maxHeight:300,display:"block",margin:"0 auto 12px",border:"1px solid var(--line)",borderRadius:10,background:"#fff"}}/>}
              {/* 기하 문항 + 삼각형 작도가 감지되면 자동 구성 분석 (같은 세션의 손글씨) */}
              <GeoInsight ink={items[idx]&&inkRef.current[items[idx].id]} question={g.question||""} concept={g.concept||""} unit={g.unit||""}/>
              {/* 내 답 */}
              {g.type==="mc"&&g.choices&&(
                <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12}}>
                  {g.choices.map((ch,i)=>{const isAns=i===g.mcAnswer,isPick=g.choice===i;return(
                    <div key={i} style={{padding:"8px 12px",borderRadius:10,fontSize:14,display:"flex",gap:8,alignItems:"center",
                      border:"1.5px solid "+(isAns?"#3BB371":isPick?"#E06666":"var(--line)"),background:isAns?"#E9FBF0":isPick?"#FFEEEE":"#FBFAFF"}}>
                      <b style={{color:"var(--sub)"}}>{LET[i]}</b><MathText text={ch} tag="span"/>
                      {isAns&&<span style={{marginLeft:"auto"}}>✅</span>}{isPick&&!isAns&&<span style={{marginLeft:"auto"}}>❌</span>}
                    </div>);})}
                </div>
              )}
              {g.text&&<div style={{background:"var(--bg)",borderRadius:10,padding:"9px 12px",marginBottom:10}}>
                <div style={{fontSize:10,fontWeight:700,color:"var(--sub)",marginBottom:3}}>{T("내 답(텍스트)","My answer")}</div>
                <div style={{fontSize:13.5,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{g.text}</div></div>}
              {g.inkImg&&<div style={{marginBottom:12}}>
                <div style={{fontSize:10,fontWeight:700,color:"var(--sub)",marginBottom:4}}>{g.type==="essay"?T("내 손글씨 답안","My handwritten answer"):T("내 풀이·근거","My reasoning")}</div>
                <img src={"data:image/jpeg;base64,"+g.inkImg} alt="" style={{width:"100%",border:"1px solid var(--line)",borderRadius:10,display:"block"}}/></div>}
              {/* 깊은 피드백 */}
              <div style={{display:"flex",flexDirection:"column",gap:9}}>
                {g.essence&&<Fb label={T("핵심","Essence")} color="#221C39" bg="#F3F1FA" text={g.essence}/>}
                {g.gotIt&&g.gotIt!=="없음"&&<Fb label={T("잘한 것","Strength")} color="#065F46" bg="#ECFDF3" text={g.gotIt}/>}
                {g.gap&&g.gap!=="없음"&&<Fb label={T("결핍·약점","Gap")} color="#9B1C1C" bg="#FEF2F2" text={g.gap}/>}
                {g.known&&<Fb label={T("내가 아는 것","You know")} color="#1E40AF" bg="#EFF6FF" text={g.known}/>}
                {g.unknown&&<Fb label={T("모르는·헷갈리는 것","You're unsure")} color="#92400E" bg="#FFFBEB" text={g.unknown}/>}
                {g.next&&<Fb label={T("보강 방향","Next")} color="#5B21B6" bg="#F5F3FF" text={g.next}/>}
                {g.model&&<Fb label={T("모범답안","Model answer")} color="#0F766E" bg="#F0FDFA" text={g.model}/>}
              </div>
            </>);})()}
            <div style={{display:"flex",gap:8,marginTop:18,flexWrap:"wrap"}}>
              <button className="btn pri" onClick={()=>{setShowReport(true);}}>🧾 {academy?T("학부모 상담 리포트","Parent report"):T("진단 리포트","Diagnostic report")}</button>
              <button className="btn gho" onClick={onExit}>{T("← 홈으로","← Home")}</button>
            </div>
          </div>
        )}
        {phase==="result"&&showReport&&(()=>{
          const us=aggUnits(grades);
          const weakUnits=us.filter(u=>u.weak);
          const strongUnits=us.filter(u=>u.rate>=80);
          const verdictKo=(v)=>v==="correct"?T("정답","Correct"):v==="incorrect"?T("오답","Wrong"):T("부분","Partial");
          const wlist=weakUnits.map(u=>u.unit).join(", ");
          const summary=pct>=80
            ?T(`전반적으로 안정적입니다.${weakUnits.length?` 다만 ${wlist} 단원만 더 다듬으면 완성도가 올라갑니다.`:" 선택한 단원 전반을 잘 소화하고 있습니다."}`,"Solid overall.")
            :pct>=60
            ?T(`기본기는 갖췄으나 ${weakUnits.length?wlist+" 단원에서":"일부 단원에서"} 반복적으로 막힙니다. 이 단원을 집중 보완하면 점수가 빠르게 오를 단계입니다.`,"Knows the basics; focus the weak units below.")
            :T(`여러 단원에서 기초가 흔들립니다. 새 진도보다 ${weakUnits.slice(0,2).map(u=>u.unit).join(", ")||"약한 단원"}부터 핵심 개념을 다시 잡아주길 권합니다.`,"Foundations need rebuilding first.");
          return(
          <div id="parent-report" className="card qcard" style={{maxWidth:760,margin:"0 auto",padding:"24px 26px"}}>
            <style>{`@media print{body *{visibility:hidden!important}#parent-report,#parent-report *{visibility:visible!important}#parent-report{position:absolute;left:0;top:0;width:100%;max-width:none;border:none;box-shadow:none;margin:0}.report-noprint{display:none!important}}`}</style>
            {/* 레터헤드 */}
            <div style={{textAlign:"center",borderBottom:"3px double var(--pri)",paddingBottom:14,marginBottom:18}}>
              <div style={{fontSize:13,fontWeight:700,letterSpacing:".06em",color:"var(--pri-d)"}}>{academyName||T("○○ 학원","Academy")}</div>
              <div style={{fontSize:24,fontWeight:800,color:"var(--ink)",letterSpacing:"-.01em",margin:"4px 0 2px"}}>{T("레벨테스트 진단 리포트","Level Test Diagnostic Report")}</div>
              <div style={{fontSize:11.5,color:"var(--sub)"}}>{T("학부모 상담용","For parent consultation")} · {new Date().toLocaleDateString(examLang==="en"?"en-US":"ko-KR",{year:"numeric",month:"long",day:"numeric"})}</div>
            </div>
            {/* 학생·범위·총점 */}
            <div style={{display:"flex",flexWrap:"wrap",gap:"10px 24px",marginBottom:16,fontSize:14}}>
              <div><span style={{color:"var(--sub)"}}>{T("학생","Student")}</span> <b>{student||T("학생","Student")}</b></div>
              <div><span style={{color:"var(--sub)"}}>{T("범위","Scope")}</span> <b>{examTitle}</b></div>
              <div style={{marginLeft:"auto",fontFamily:"'Jua',sans-serif",fontSize:22,color:pct>=80?"var(--mint)":pct>=60?"var(--gold)":"var(--rose)"}}>{score}/{maxScore} <span style={{fontSize:14,color:"var(--sub)"}}>({pct}%)</span></div>
            </div>
            {/* 시험 구성: 검증 기출 vs 신규 제작 — 학부모 신뢰 포인트 */}
            {(()=>{const nReal=grades.filter(g=>g&&g.origin==="기출").length;const nMade=grades.filter(g=>g&&g.origin==="제작").length;
              return nReal>0?(
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:16,padding:"9px 13px",background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:10,fontSize:13}}>
                <b style={{color:"#92400E"}}>{T("본 시험 구성","Test composition")}</b>
                <span className="chip" style={{background:"#FFF7E0",color:"#946200",fontWeight:800}}>📜 {T("실제 기출 ","Past exam ")}{nReal}{T("문항","Q")}</span>
                {nMade>0&&<span className="chip" style={{background:"#EEF2FF",color:"#3730A3",fontWeight:800}}>✨ {T("신규 제작 ","Original ")}{nMade}{T("문항","Q")}</span>}
                <span style={{color:"var(--sub)",fontSize:12}}>{T("— 기출은 검수를 거친 실제 시험 문제를 원본 그대로 출제했습니다.","— past-exam items are verified originals.")}</span>
              </div>):null;})()}
            {/* 종합 소견 */}
            <div style={{background:"var(--pri-s)",borderRadius:12,padding:"14px 16px",marginBottom:18,lineHeight:1.7,fontSize:14}}>
              <div style={{fontWeight:800,color:"var(--pri-d)",marginBottom:6}}>📋 {T("종합 소견","Summary")}</div>
              {analysis?analysisInner():(analysisBusy?<div style={{color:"var(--sub)",fontSize:13}}>{T("심층 분석 작성 중… 곧 표시됩니다.","Analyzing… will appear shortly.")}</div>:summary)}
            </div>
            {/* 단원별 진단 표 */}
            <div style={{fontFamily:"'Jua',sans-serif",fontSize:15,color:"var(--ink)",marginBottom:8}}>📊 {T("단원별 진단","By unit")}</div>
            <div style={{overflowX:"auto",marginBottom:18}}>
              <table style={{borderCollapse:"collapse",width:"100%",fontSize:13}}>
                <thead><tr style={{background:"var(--pri-s)",color:"var(--pri-d)"}}>
                  {[T("단원","Unit"),T("문항","Q"),T("정답률","Accuracy"),T("상태","Status")].map((h,i)=>
                    <th key={i} style={{padding:"7px 10px",border:"1px solid var(--line)",textAlign:i?"center":"left"}}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {us.map((u,i)=>(
                    <tr key={i} style={i%2?{background:"var(--bg)"}:undefined}>
                      <td style={{padding:"7px 10px",border:"1px solid var(--line)"}}><MathText text={u.unit} tag="span"/></td>
                      <td style={{padding:"7px 10px",border:"1px solid var(--line)",textAlign:"center"}}>{u.n}</td>
                      <td style={{padding:"7px 10px",border:"1px solid var(--line)",textAlign:"center",fontWeight:800,color:u.rate>=80?"var(--mint)":u.rate>=60?"var(--gold)":"var(--rose)"}}>{u.rate}%</td>
                      <td style={{padding:"7px 10px",border:"1px solid var(--line)",textAlign:"center",fontWeight:700,color:u.weak?"#9B1C1C":"#065F46"}}>{u.weak?T("보완 필요","Needs work"):u.rate>=80?T("우수","Strong"):T("양호","OK")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* 오류 성격 분석 (실수 vs 개념 결여 + 능력 요인) */}
            {errProfileView(grades,false)}
            {/* 집중 보완 단원 */}
            <div style={{fontFamily:"'Jua',sans-serif",fontSize:15,color:"#9B1C1C",marginBottom:8}}>🎯 {T("집중 보완이 필요한 단원","Focus units")} ({weakUnits.length})</div>
            {weakUnits.length?(
              <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:18}}>
                {weakUnits.map((u,i)=>(
                  <div key={i} style={{border:"1.5px solid #FECACA",background:"#FEF2F2",borderRadius:10,padding:"11px 14px"}}>
                    <div style={{fontWeight:700,color:"#9B1C1C",marginBottom:4}}><MathText text={u.unit} tag="span"/> <span style={{fontSize:11,color:"var(--sub)",fontWeight:400}}>· {T("정답률","accuracy")} {u.rate}%</span></div>
                    {u.gaps.length>0&&<div style={{fontSize:13,lineHeight:1.6,marginBottom:3}}><b style={{color:"#9B1C1C"}}>{T("막힌 곳","Gaps")}:</b> <MathText text={u.gaps.slice(0,2).join(" / ")} tag="span"/></div>}
                    {u.nexts.length>0&&<div style={{fontSize:13,lineHeight:1.6}}><b style={{color:"#5B21B6"}}>{T("보강 방향","Next")}:</b> <MathText text={u.nexts[0]} tag="span"/></div>}
                  </div>
                ))}
              </div>
            ):<div style={{color:"var(--sub)",marginBottom:18,fontSize:13}}>{T("이번 평가에서 보완이 시급한 단원은 없습니다. 👏","No urgent weak units this time. 👏")}</div>}
            {/* 강점 단원 */}
            {strongUnits.length>0&&<>
              <div style={{fontFamily:"'Jua',sans-serif",fontSize:15,color:"#065F46",marginBottom:8}}>💪 {T("잘하고 있는 단원","Strong units")} ({strongUnits.length})</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:18}}>
                {strongUnits.map((u,i)=><span key={i} className="chip" style={{background:"#ECFDF3",color:"#065F46",border:"1px solid #A7F3D0"}}><MathText text={u.unit} tag="span"/> {u.rate}%</span>)}
              </div>
            </>}
            {/* 문항별 결과 표 */}
            <div style={{fontFamily:"'Jua',sans-serif",fontSize:15,color:"var(--ink)",marginBottom:8}}>📊 {T("문항별 결과","By question")}</div>
            <div style={{overflowX:"auto",marginBottom:18}}>
              <table style={{borderCollapse:"collapse",width:"100%",fontSize:12.5}}>
                <thead><tr style={{background:"var(--pri-s)",color:"var(--pri-d)"}}>
                  {[T("#","#"),T("유형","Type"),T("출처","Origin"),T("개념","Concept"),T("점수","Score"),T("결과","Result")].map((h,i)=>
                    <th key={i} style={{padding:"7px 9px",border:"1px solid var(--line)",textAlign:i>3?"center":"left"}}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {grades.map((g,i)=>(
                    <tr key={i} style={i%2?{background:"var(--bg)"}:undefined}>
                      <td style={{padding:"6px 9px",border:"1px solid var(--line)",textAlign:"center"}}>{i+1}</td>
                      <td style={{padding:"6px 9px",border:"1px solid var(--line)"}}>{TYPE_LABEL(g.type)}</td>
                      <td style={{padding:"6px 9px",border:"1px solid var(--line)",fontSize:11.5}}>{g.origin==="기출"?("📜 "+T("기출","Past")+(g.srcLabel?" · "+g.srcLabel:"")):g.origin==="제작"?"✨ "+T("제작","Orig."):"-"}</td>
                      <td style={{padding:"6px 9px",border:"1px solid var(--line)"}}><MathText text={g.concept||"-"} tag="span"/></td>
                      <td style={{padding:"6px 9px",border:"1px solid var(--line)",textAlign:"center"}}>{g.score}/{g.points}</td>
                      <td style={{padding:"6px 9px",border:"1px solid var(--line)",textAlign:"center",color:vColor(g.verdict),fontWeight:700}}>{verdictKo(g.verdict)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* 서명·확인란 (인쇄 포함) */}
            <div style={{display:"flex",gap:18,flexWrap:"wrap",marginTop:10,paddingTop:16,borderTop:"1px solid var(--line)",fontSize:13,color:"var(--sub)"}}>
              <div style={{flex:"1 1 150px"}}>{T("상담일","Date")} <span style={{display:"inline-block",minWidth:84,borderBottom:"1px solid var(--ink)"}}>&nbsp;</span></div>
              <div style={{flex:"1 1 150px"}}>{T("담당 선생님","Teacher")} <span style={{display:"inline-block",minWidth:84,borderBottom:"1px solid var(--ink)"}}>&nbsp;</span> {T("(인)","")}</div>
              <div style={{flex:"1 1 150px"}}>{T("학부모 확인","Parent")} <span style={{display:"inline-block",minWidth:84,borderBottom:"1px solid var(--ink)"}}>&nbsp;</span> {T("(인)","")}</div>
            </div>
            <div className="report-noprint" style={{display:"flex",gap:8,flexWrap:"wrap",borderTop:"1px solid var(--line)",paddingTop:14,marginTop:14}}>
              <button className="btn pri" onClick={()=>window.print()}>🖨️ {T("인쇄 / PDF 저장","Print / Save PDF")}</button>
              <button className="btn gho" onClick={()=>setShowReport(false)}>{T("← 채점 결과로","← Back to results")}</button>
              <button className="btn gho" onClick={onExit}>{T("홈으로","Home")}</button>
            </div>
          </div>);
        })()}
      </div>
    </section>
  );
}

export { Exam };
