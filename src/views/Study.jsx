import { AnnotPad, PEN_COLORS, PenPad, QuestionPad } from "../ui/pads.jsx";
import { CFG, LS, RICH_FMT, dk, ocrModel, tr } from "../core/platform.js";
import { Cheer, DepthGauge, Meter, Prof, RateBar, ratePct } from "../ui/common.jsx";
import { DAY, deckSummary, diffLong, diffWord, pickConcept, quizFormat, schedule } from "../core/srs.js";
import { MathText } from "../ui/math.jsx";
import { callAI, parseDeriveCheck, parseDerivePlan, parseGrading, parseOcrCheck, parseQuestion, uid } from "../core/ai.js";
import { logAttempt } from "../core/attempts.js";
import React from "react";
const { useState, useEffect, useRef, useCallback } = React;

function Study({deck:initial,subjects,onExit}){
  const [deck,setDeck]=useState(initial);
  const [concept,setConcept]=useState(null);
  const [q,setQ]=useState(null);
  const [phase,setPhase]=useState("loading");
  const [answer,setAnswer]=useState("");
  const [inputMode,setInputMode]=useState("note");   // 'note'(손글씨) | 'type'(타이핑)
  const [ev,setEv]=useState(null);
  const [errMsg,setErrMsg]=useState("");
  const [submitErr,setSubmitErr]=useState("");
  const [deeper,setDeeper]=useState("");
  const [deepBusy,setDeepBusy]=useState(false);
  const [dontknow,setDontknow]=useState("");
  const [dontknowBusy,setDontknowBusy]=useState(false);
  const [count,setCount]=useState(0);
  const [annotOpen,setAnnotOpen]=useState(false);
  const [highlightActive,setHighlightActive]=useState(false);
  const [annotTool,setAnnotTool]=useState("hl");
  const [annotQMode,setAnnotQMode]=useState("pen");
  const [annotQTool,setAnnotQTool]=useState("pen");
  const [annotQ,setAnnotQ]=useState("");
  const [annotQInk,setAnnotQInk]=useState(false); // 펜 질문에 획이 있는지(반응형) — '질문하기' 버튼 활성화용
  const [annotBusy,setAnnotBusy]=useState(false);
  const [annotAnswer,setAnnotAnswer]=useState("");
  const annotPadRef=useRef(null);
  const annotQPadRef=useRef(null);
  const [leftPage,setLeftPage]=useState(0);
  const [derivePlan,setDerivePlan]=useState(null);
  const [deriveIdx,setDeriveIdx]=useState(0);
  const [deriveHistory,setDeriveHistory]=useState([]);
  const [deriveFeedback,setDeriveFeedback]=useState("");
  const [deriveChecking,setDeriveChecking]=useState(false);
  const [deriveDone,setDeriveDone]=useState(false);
  const [deriveHintShow,setDeriveHintShow]=useState(false);
  const [followupQ,setFollowupQ]=useState("");
  const [followupCount,setFollowupCount]=useState(0);
  const [followupHistory,setFollowupHistory]=useState([]);
  const [followupBusy,setFollowupBusy]=useState(false);
  const [followupEv,setFollowupEv]=useState(null);
  const [followupHint,setFollowupHint]=useState("");
  const [followupHintBusy,setFollowupHintBusy]=useState(false);
  const [followupSuccess,setFollowupSuccess]=useState(false);
  const [gradeProg,setGradeProg]=useState(0);
  const [limitHelp,setLimitHelp]=useState("");      // '여기가 내 한계야' → 교수 캐릭터 도움 말풍선
  const [limitBusy,setLimitBusy]=useState(false);
  const [ocrHighlights,setOcrHighlights]=useState([]);
  const [ocrImg,setOcrImg]=useState(null);
  const [ocrImgSize,setOcrImgSize]=useState({w:800,h:680});
  const [quizItem,setQuizItem]=useState(null);       // 퀴즈 모드: 생성된 문제 {format,...}
  const [quizSel,setQuizSel]=useState(null);         // 고른 보기 idx / OX bool / 단답 입력값
  const [quizGraded,setQuizGraded]=useState(false);
  const [quizCorrect,setQuizCorrect]=useState(false);
  const [quizShortChecking,setQuizShortChecking]=useState(false);
  const [scratchOpen,setScratchOpen]=useState(false);   // 퀴즈 연습장(채점 무관)
  const last=useRef(null);
  const padRef=useRef(null);
  const ocrImgRef=useRef(null);
  const deckRef=useRef(deck);
  const prefetchRef=useRef(null);        // 미리 생성한 다음 퀴즈 {id, item}
  const prefetchAbortRef=useRef(null);
  const submitting=useRef(false);
  const followupSubmitting=useRef(false);
  const genId=useRef(0);
  const abortRef=useRef(null);
  const lastAnswerRef=useRef({});
  // 시도 로그용 행동 신호: 문제 노출 시각(풀이 시간), 힌트 요청·OCR 재작성 횟수
  const qStartRef=useRef(null);
  const hintRef=useRef(0);
  const ocrRef=useRef(0);

  function persist(d){
    deckRef.current=d;
    setDeck(d);
    const {focusId,...store}=d;   // focusId는 집중학습용 임시값 — 저장엔 안 남겨 다음 일반 학습 오염 방지
    if(!LS.set(dk(d.id),store)){
      setSubmitErr(T("⚠️ 학습 기록 저장 실패: 저장 공간 부족. 설정에서 오래된 자료를 삭제해줘.","⚠️ Couldn't save progress: storage full. Delete old materials in Settings."));
    }
  }

  const quizMode=deck.studyType==="quiz";
  // 세션 전체에서 캐시 공유: summary 있으면 우선 사용 (8000자 이하)
  const studyMat=deck.summary||deck.material.slice(0,8000);
  const matFor=(c)=>(c&&c.src)?(""+c.src):studyMat;   // 책 개념이면 그 섹션(src)을 자료로 — 소주제별 정확한 출제·채점
  // 두 축: UI 라벨 언어 = 설정(CFG.lang) / AI 출제·채점 내용 언어 = 덱별 override(deck.lang) 우선
  const studyLang=(deck.lang||CFG.lang)==="en"?"en":"ko";   // callAI lang: (내용)
  const T=tr;                                                // UI 라벨 (앱 언어)
  const GAP_TYPE_EN={"개념누락":"Missing concept","이해얕음":"Shallow grasp","핵심비껴감":"Off the point","표현부족":"Unclear wording","갭없음":"No gap"};
  const gapTypeLabel=(t)=>CFG.lang==="en"?(GAP_TYPE_EN[t]||t):t;

  async function retryVariant(){
    // 배운 걸로 굳히기: 같은 개념의 '변형 문제'(숫자·상황·표현만 바꿈)를 새로 만들어 다시 풀게 함
    abortRef.current?.abort();
    const ctrl=new AbortController();abortRef.current=ctrl;
    const myId=++genId.current;
    const baseQ=q,c=concept;
    // 결과·노트 정리 후 로딩
    setEv(null);setAnswer("");setDeeper("");setDontknow("");setSubmitErr("");
    setHighlightActive(false);setAnnotQ("");setAnnotQInk(false);setAnnotAnswer("");setLeftPage(0);
    setOcrHighlights([]);setOcrImg(null);ocrImgRef.current=null;
    setFollowupQ("");setFollowupCount(0);setFollowupHistory([]);setFollowupEv(null);setFollowupSuccess(false);
    padRef.current?.clear();
    setTimeout(()=>padRef.current?.forceColor(PEN_COLORS[0]),50);
    setPhase("loading");setQ(null);
    try{
      const raw=await callAI(
        "너는 문제 변형 출제 전문가야. 아래 [원래 문제]와 똑같은 개념·유형을 묻되, 숫자·상황·예시·표현만 살짝 바꾼 변형문제 하나를 만들어. 방금 본 모범답안을 그대로 베껴 쓸 수 없고 새로 풀어야 하도록. 난이도는 원래와 비슷하게. 수식은 LaTeX($...$). 반드시 아래 형식으로만 출력 (코드블록 없이):\nQTYPE: recall 또는 understand 또는 apply\nQUESTION: 질문 내용\nPOINTS: 핵심1 | 핵심2 | 핵심3\n\n자료:\n"+studyMat.slice(0,4000),
        "개념: "+c.name+"\n원래 문제 유형: "+(baseQ?.qtype||"understand")+"\n[원래 문제]:\n"+(baseQ?.question||""),
        false,{maxTok:800,model:CFG.qmodel,lang:studyLang},ctrl.signal);
      if(genId.current!==myId)return;
      const pq=parseQuestion(raw);
      if(baseQ?.qtype)pq.qtype=baseQ.qtype;
      pq.source="변형";
      const examSol=baseQ?.examAnswer||baseQ?.examRef; // 기출 변형이면 원본 공식 해답을 해설 참고용으로 계승
      if(examSol)pq.examRef=examSol;
      setQ(pq);setPhase("answering");
    }catch(e){
      if(genId.current!==myId||e.name==="AbortError")return;
      // 변형 생성 실패 시 원래 문제로 폴백
      setQ(baseQ);setPhase("answering");setSubmitErr(T("변형 문제 생성 실패: ","Variant generation failed: ")+e.message+T(" — 원래 문제로 다시 풀어볼게"," — retrying the original question"));
    }
  }

  function skipConcept(){
    // 페널티 없는 스킵: box(레벨)는 그대로 두고 dueAt만 내일로 미뤄 오늘은 다시 안 나오게 함
    const c=concept;let d=deckRef.current;
    if(c){
      const uc={...c,dueAt:Date.now()+DAY,lastSeen:Date.now()};
      d={...d,concepts:(d.concepts||[]).map(x=>x.id===c.id?uc:x)};
      persist(d);
    }
    next(d);
  }

  async function next(d,forceId,practical){
    d=d||deck;
    if(!forceId&&d.focusId)forceId=d.focusId;   // 책 소주제 집중 학습: 항상 그 개념만 출제
    abortRef.current?.abort();
    const ctrl=new AbortController();
    abortRef.current=ctrl;
    const myId=++genId.current;
    setPhase("loading");setQ(null);setEv(null);setAnswer("");setDeeper("");setDontknow("");setErrMsg("");setSubmitErr("");
    setAnnotOpen(false);setHighlightActive(false);setAnnotTool("hl");setAnnotQMode("pen");setAnnotQ("");setAnnotQInk(false);setAnnotBusy(false);setAnnotAnswer("");setLeftPage(0);
    setOcrHighlights([]);setOcrImg(null);ocrImgRef.current=null;
    setDerivePlan(null);setDeriveIdx(0);setDeriveHistory([]);setDeriveFeedback("");setDeriveDone(false);setDeriveHintShow(false);setDeriveChecking(false);
    setFollowupQ("");setFollowupCount(0);setFollowupHistory([]);setFollowupBusy(false);setFollowupEv(null);setFollowupSuccess(false);
    setLimitHelp("");setLimitBusy(false);
    setQuizItem(null);setQuizSel(null);setQuizGraded(false);setQuizCorrect(false);setQuizShortChecking(false);setScratchOpen(false);
    padRef.current?.clear();
    const c=forceId?(d.concepts||[]).find(x=>x.id===forceId)||pickConcept(d,last.current):pickConcept(d,last.current);
    if(!c){setPhase("error");setErrMsg(T("질문할 개념이 없어.","No concepts to quiz."));return;}
    setConcept(c);last.current=c.id;
    const box=c.box||1;

    // ── 암기·퀴즈형 덱: 카드 퀴즈 생성 (기출·explain 경로 건너뜀) ──
    if(quizMode){
      const cache=prefetchRef.current;
      if(cache&&!forceId&&cache.id===c.id){ prefetchRef.current=null; setQuizItem(cache.item); setPhase("quiz"); return; }
      prefetchRef.current=null;
      await generateQuiz(c,ctrl,myId); return;
    }

    // ── 기출/족보 덱: box 레벨로 출제 모드 자동 결정 ──
    const examPool=(!practical&&d.isExam&&Array.isArray(d.examQuestions))
      ?d.examQuestions.filter(eq=>eq&&eq.question&&eq.concept===c.name):[];
    if(examPool.length){
      const picked=examPool[(c.reps||0)%examPool.length];
      // box 2 → 원본 기출 그대로 출제 (AI 호출 없음)
      if(box===2){
        setQ({qtype:"apply",question:picked.question,key_points:[],source:"기출",examAnswer:picked.answer||""});
        setPhase("answering");return;
      }
      // box 3~4 → 변형, box 5 → 심화
      if(box>=3){
        const deep=box>=5;
        const sys=deep
          ?"너는 심화문제 출제 전문가야. 아래 [원본 기출문제]가 다루는 개념을 더 깊이 파고드는 심화문제 하나를 만들어. 원본보다 어렵게: 여러 개념을 연결하거나, '왜/어떤 경우에'를 묻거나, 한 단계 더 응용하게. 수식은 LaTeX($...$). 반드시 형식으로만 출력:\nQTYPE: understand 또는 apply\nQUESTION: 질문 내용\nPOINTS: 핵심1 | 핵심2 | 핵심3"
          :"너는 기출문제 변형 출제 전문가야. 아래 [원본 기출문제]와 같은 개념·유형을 묻되 숫자·상황·예시만 바꾼 변형문제 하나를 만들어."+(box>=4?" 난이도는 원본보다 살짝 높여 응용을 더해.":" 난이도는 원본과 비슷하게.")+" 수식은 LaTeX($...$). 반드시 형식으로만 출력:\nQTYPE: recall 또는 understand 또는 apply\nQUESTION: 질문 내용\nPOINTS: 핵심1 | 핵심2 | 핵심3";
        try{
          const raw=await callAI(sys+"\n\n자료:\n"+matFor(c).slice(0,4000),
            "개념: "+c.name+"\n[원본 기출문제]:\n"+picked.question,
            false,{maxTok:800,model:CFG.qmodel,lang:studyLang},ctrl.signal);
          if(genId.current!==myId)return;
          const pq=parseQuestion(raw);pq.source=deep?"심화":"변형";
          if(picked.answer)pq.examRef=picked.answer; // 원본 기출 공식 해답 → 해설이 그 기조 참고 (채점 기준엔 미사용)
          setQ(pq);setPhase("answering");
        }catch(e){if(genId.current===myId&&e.name!=="AbortError"){setPhase("error");setErrMsg(T("문제 생성 실패: ","Question generation failed: ")+e.message);}}
        return;
      }
      // box 1 → 아래 일반 개념 암기(recall) 생성으로 진행
    }

    const qtypeRule=practical
      ?"▶ QTYPE: apply 고정 — 수치나 조건을 직접 주고 계산·풀이를 요구하는 문제."
      :box<=2
      ?"▶ QTYPE: recall — 핵심 공식·정의·조건·용어를 정확히 쓰거나 말하게 하는 단답형. 답의 개수를 특정하면 더 좋음. (예: '공식을 성분으로 나타내어라', '두 가지 조건을 말하시오', '정의를 써라', '임진왜란 발발 연도와 강화 조약명을 쓰시오')"
      :box<=3
      ?"▶ QTYPE: recall 또는 understand 중 이 개념에 더 핵심적인 것을 선택. (암기 과목이면 recall 단답형을 골라도 좋음)"
      :"▶ QTYPE: understand 또는 apply — 이해·비교·연결·응용을 요구. 단, 암기 위주 개념이면 recall(단답형)을 유지하되 묻는 항목·조건을 더 넓고 정밀하게 올려라.";
    try{
      const raw=await callAI(
        "너는 대학 시험 출제 전문가야. 아래 자료에서 목표 개념을 파악하고, 질문 하나를 만들어.\n\n"+
        "━━ 질문 생성 순서 ━━\n"+
        "1. 이 개념이 왜 중요한지, 어디에 쓰이는지, 무엇과 연결되는지를 자료에서 파악한다.\n"+
        "2. 그 핵심을 진짜로 이해했는지 드러나는 질문을 만든다.\n\n"+
        "━━ 좋은 질문 기준 ━━\n"+
        "✓ 그 개념을 실제로 이해했을 때만 답할 수 있는 질문\n"+
        "✓ 왜 그렇게 되는지 / 언제 쓰는지 / 다른 개념과 어떻게 다른지 / 특정 케이스에서 왜 그런 결과가 나오는지\n"+
        "✓ 시험에 실제로 나올 법한 질문\n"+
        "✓ 답의 형태는 과목에 맞게: 추론·계산 과목이면 설명·풀이를 요구하고, 암기 과목이면 정확한 단답(용어·정의·조건·연도·목록 등)을 요구\n\n"+
        "━━ 절대 피할 것 ━━\n"+
        "✗ '~란 무엇인가' 식 정의 받아쓰기 (recall 유형 제외)\n"+
        "✗ 자료의 지엽적 수치·각주·예시를 그대로 묻는 질문\n"+
        "✗ 상식이거나 안 봐도 아는 질문\n"+
        "✗ 자료에 근거 없어 추측해야 하는 질문\n\n"+
        "━━ 과목 특성 반영 (먼저 판단) ━━\n"+
        "이 개념이 어떤 성격인지 보고 질문·답 형태를 맞춰라.\n"+
        "· 암기 위주(역사 사건·연도, 법조문, 생물/의학·법률 용어, 정의·분류, 영단어 등): 시험에 실제 나오는 '단답형'이 자연스럽다. 용어·정의·조건·연도·목록을 정확히 쓰게 하고, 억지로 긴 서술을 요구하지 마라. 난이도는 묻는 항목 수↑·조건 정밀화·사례 적용으로 올린다.\n"+
        "· 이해·추론·계산 위주(수학·물리·경제 모형 등): 왜/언제/어떻게를 묻고 설명·풀이·계산을 요구한다.\n"+
        "· 섞인 과목이면 개념마다 더 맞는 쪽을 골라라.\n\n"+
        qtypeRule+"\n\n"+
        "━━ 유형별 예시 ━━\n"+
        "recall: '$\\mathbf{a}\\times\\mathbf{b}$를 성분으로 나타내어라', '피타고라스 정리를 써라', '선형변환이 되기 위한 두 가지 조건을 말하시오 (개수 명시하며 묻는 것이 좋음)'\n"+
        "understand: '외적이 내적과 근본적으로 다른 점은? 기하학적으로 설명해봐', '왜 이 조건에서 해가 유일한가?', '$\\mathbf{a}\\times\\mathbf{a}$가 항상 영벡터인 이유는?', '자료의 반례를 이용해 이 함수가 왜 선형변환이 아닌지 서술하시오 (반례+이유 설명 요구)', '왜 [특정 케이스]에서 [특정 결과]가 나오는가?'\n"+
        "apply: '$\\mathbf{a}=(1,2,3),\\,\\mathbf{b}=(4,0,-1)$일 때 $\\mathbf{a}\\times\\mathbf{b}$를 구하시오', '$T(x,y)=2x+y$가 선형변환인지 두 조건으로 보여라 (정의를 직접 적용해 검증하는 문제)'\n\n"+
        "수식은 LaTeX($...$, $$...$$). 반드시 아래 형식으로만 출력:\nQTYPE: recall 또는 understand 또는 apply\nQUESTION: 질문 내용\nPOINTS: 핵심1 | 핵심2 | 핵심3 (| 구분, 3~5개)\n\n자료:\n"+matFor(c).slice(0,6000),
        "목표 개념: "+c.name+"\n복습 단계: "+diffLong(c.box),
        false,{cache:true,maxTok:800,model:CFG.qmodel,lang:studyLang},ctrl.signal);
      if(genId.current!==myId)return;
      setQ(parseQuestion(raw));setPhase("answering");
    }catch(e){if(genId.current===myId&&e.name!=="AbortError"){setPhase("error");setErrMsg(T("질문 생성 실패: ","Question generation failed: ")+e.message);}}
  }

  // ── 암기·퀴즈형: box 레벨로 형식 결정 후 카드 문제 객체 생성(상태 변경 없음) ──
  async function buildQuizItem(c,signal){
    const fmt=quizFormat(c.box);
    const common="너는 대학 학습용 퀴즈 출제 전문가야. 아래 자료 범위 안에서 목표 개념을 묻는 문제 하나를 만들어. 수식은 LaTeX($...$)로. 자료에 근거 없는 내용은 묻지 마.";
    let sys;
    if(fmt==="mc"){
      sys=common+" 객관식 4지선다로 만들어.\n규칙: ① 정답은 정확히 1개, 오답 3개는 모두 그럴듯해야 함(흔한 오개념 활용) ② 정답이 질문 문장에 그대로 드러나면 안 됨 ③ 보기 4개의 길이·문체를 비슷하게 ④ '위 모두 정답'/'정답 없음' 류 금지.\nJSON만 출력: {\"question\":\"질문\",\"choices\":[\"보기A\",\"보기B\",\"보기C\",\"보기D\"],\"answer\":0,\"explain\":\"왜 그 보기가 정답이고 나머지는 왜 틀렸는지 짧은 해설\"} (answer는 정답 보기의 0-based 인덱스)";
    }else if(fmt==="ox"){
      sys=common+" 참/거짓(OX) 진술문으로 만들어.\n규칙: ① 한 문장의 명확한 진술 ② 거짓일 경우 흔한 오개념을 그럴듯하게 담을 것 ③ 너무 뻔하지 않게.\nJSON만 출력: {\"statement\":\"진술문\",\"answer\":true,\"explain\":\"참/거짓인 이유 짧은 해설\"} (answer는 진술이 참이면 true, 거짓이면 false)";
    }else{
      sys=common+" 단답형으로 만들어.\n규칙: ① 정답은 용어·정의·연도·짧은 구절 등 짧고 명확한 것 ② 표현·표기·동의어 차이를 허용 목록으로 함께 제공.\nJSON만 출력: {\"question\":\"질문\",\"answer\":\"대표 정답\",\"accept\":[\"허용되는 다른 표기·동의어들\"],\"explain\":\"짧은 해설\"}";
    }
    const r=await callAI(sys+"\n\n자료:\n"+matFor(c).slice(0,5000),
      "목표 개념: "+c.name,
      true,{cache:true,maxTok:700,model:CFG.qmodel,lang:studyLang},signal);
    if(!r||(fmt==="mc"&&!Array.isArray(r.choices)))throw new Error(T("형식 오류","bad format"));
    return {format:fmt,...r};
  }
  async function generateQuiz(c,ctrl,myId){
    try{
      const item=await buildQuizItem(c,ctrl.signal);
      if(genId.current!==myId)return;
      setQuizItem(item);setPhase("quiz");
    }catch(e){if(genId.current===myId&&e.name!=="AbortError"){setPhase("error");setErrMsg(T("문제 생성 실패: ","Question generation failed: ")+e.message);}}
  }
  // 채점 후 다음 due 개념의 문제를 백그라운드로 미리 생성해 캐시(즉각성)
  function prefetchNext(){
    const d=deckRef.current;
    const c=pickConcept(d,concept?.id);   // next()와 동일한 avoidId 규칙으로 예측
    if(!c)return;
    prefetchAbortRef.current?.abort();
    const ctrl=new AbortController();prefetchAbortRef.current=ctrl;
    buildQuizItem(c,ctrl.signal).then(item=>{prefetchRef.current={id:c.id,item};}).catch(()=>{});
  }

  const normAns=(s)=>String(s||"").toLowerCase().replace(/\s+/g,"").replace(/[.,;:!?'"()[\]{}·・]/g,"");
  async function gradeQuiz(sel){
    if(!quizItem||quizGraded)return;
    const fmt=quizItem.format;let correct=false;
    if(fmt==="mc"){correct=sel===quizItem.answer;}
    else if(fmt==="ox"){correct=sel===quizItem.answer;}
    else{
      const pool=[quizItem.answer,...(Array.isArray(quizItem.accept)?quizItem.accept:[])].map(normAns).filter(Boolean);
      const got=normAns(sel);
      correct=pool.includes(got);
      if(!correct&&got){
        // 정규화로 안 맞으면 AI로 동의어·오타 관대 판정
        setQuizShortChecking(true);
        try{
          const r=await callAI(
            "학습자의 단답 답안이 정답과 사실상 같은 뜻인지 판단해. 오타·띄어쓰기·표현 차이·동의어는 관대하게 정답 처리하되, 핵심 의미가 다르면 오답. JSON만: {\"correct\":true 또는 false}",
            "정답: "+quizItem.answer+"\n허용: "+(quizItem.accept||[]).join(", ")+"\n학습자 답: "+sel,
            true,{maxTok:16,model:CFG.qmodel,lang:studyLang});
          correct=!!(r&&r.correct);
        }catch(e){/* 판정 실패 시 오답 처리 */}
        setQuizShortChecking(false);
      }
    }
    persist({...deckRef.current,concepts:deckRef.current.concepts.map(x=>x.id===concept.id?schedule(x,correct?"correct":"incorrect"):x)});
    logAttempt({src:"quiz",deckId:deck.id,concept:concept.name,unit:[concept.u1,concept.u2].filter(Boolean).join(" "),
      verdict:correct?"correct":"incorrect",qtype:quizItem.format,box:concept.box||1,dur:elapsedSec()});
    setQuizSel(sel);setQuizCorrect(correct);setQuizGraded(true);setCount(n=>n+1);
    prefetchNext();   // 다음 문제 미리 생성
  }

  useEffect(()=>{next(initial);return()=>{abortRef.current?.abort();prefetchAbortRef.current?.abort();};},[]);

  // 풀이 시간 측정: 문제가 화면에 뜬 시점부터. 새 문제 로딩 때 카운터 리셋 (OCR 재작성 복귀는 타이머 유지)
  useEffect(()=>{
    if(phase==="loading"){qStartRef.current=null;hintRef.current=0;ocrRef.current=0;}
    else if((phase==="answering"||phase==="quiz")&&!qStartRef.current)qStartRef.current=Date.now();
  },[phase]);
  const elapsedSec=()=>qStartRef.current?Math.round((Date.now()-qStartRef.current)/1000):undefined;

  // 채점 가짜 진행률 (0→93 천천히, 끝나면 100% 후 리셋)
  useEffect(()=>{
    const grading=phase==="grading"||followupBusy;
    if(!grading)return;
    setGradeProg(5);let p=5;
    const id=setInterval(()=>{
      if(p<70)p+=2;else if(p<93)p+=0.5;
      setGradeProg(Math.min(93,Math.round(p)));
    },70);
    return()=>{clearInterval(id);setGradeProg(100);setTimeout(()=>setGradeProg(0),450);};
  },[phase,followupBusy]);

  async function submit(force){
    if(phase!=="answering")return;
    if(submitting.current)return;
    submitting.current=true;
    const hasInk=padRef.current?.hasStrokes();
    const hasTxt=answer.trim().length>0;
    if(!hasInk&&!hasTxt){submitting.current=false;setSubmitErr(T("노트에 써보거나 텍스트로 답을 입력해봐!","Write on the note or type an answer!"));return;}
    const img=hasInk?padRef.current.getImageBase64():null;
    setPhase("grading");setSubmitErr("");setOcrHighlights([]);

    // ── OCR 사전 체크 (손글씨 있을 때만, '그냥 제출'이면 건너뜀) ──
    if(img&&!force){
      const sz=padRef.current?.getSize()||{w:800,h:680};
      try{
        const ocrRaw=await callAI(
          "너는 손글씨 OCR 전문가야. 이 학습 답안을 읽어줘. 이미지 크기: "+sz.w+"×"+sz.h+"px (좌상단이 0,0).\n"+
          "정말 읽기 어려운 글자·기호·수식이 있으면, 그 부분마다 그것을 '딱 감싸는 최소 크기'의 박스를 따로따로 잡아줘. 한 덩어리로 크게 잡지 말고 안 읽히는 글자만 좁게, 최대 6개. 잘 읽히면 '없음'.\n\n"+
          "다음 형식으로만 출력:\nTEXT: 인식된 전체 텍스트 (안 읽히는 글자는 □로 표시)\nUNCLEAR: 없음 (또는 불명확한 영역을 x,y,너비,높이 픽셀 단위로 — 여러 개면 | 로 구분)",
          [{type:"image",source:{type:"base64",media_type:"image/png",data:img}}],
          false,{maxTok:400,model:ocrModel()},abortRef.current?.signal
        );
        const ocr=parseOcrCheck(ocrRaw);
        if(ocr.unclear.length>0){
          // 별도 화면 대신, 쓰던 노트 그대로 두고 안 읽힌 곳에 빨간 박스 표시 + 지우개 모드
          setOcrImgSize(sz);
          ocrRef.current++;   // 알아볼 수 없어 다시 쓰게 한 횟수 — 필기 명료성 신호
          setOcrHighlights(ocr.unclear);
          setPhase("answering");
          setTimeout(()=>padRef.current?.setEraser(),50);
          submitting.current=false;
          return;
        }
      }catch(e){if(e.name==="AbortError"){submitting.current=false;return;}console.warn("[OCR check]",e.message);}
    }
    try{
      const userBlocks=[];
      if(img)userBlocks.push({type:"image",source:{type:"base64",media_type:"image/png",data:img}});
      const qtype=q?.qtype||'understand';
      const qtypeCtx=qtype==='recall'
        ?"이 문제는 【암기 확인·단답형】 유형이야. 정의·공식·용어·연도·목록을 정확히 썼는지가 핵심이야. 단답형이니 답만 정확하면 correct로 인정하고, 추가 설명·서술이 없다고 깎지 마라(표현부족으로 판정 금지). 핵심이 맞으면 correct, 일부 빠지거나 틀리면 partial, 못 쓰면 incorrect."
        :qtype==='apply'
        ?"이 문제는 【응용·계산】 유형이야. 수치·풀이 과정이 맞는지가 핵심이야. 과정과 결과가 맞으면 correct, 방향은 맞는데 실수 있으면 partial."
        :"이 문제는 【이해 확인】 유형이야. 개념을 얼마나 이해했는지가 핵심이야.";
      const textParts=["문제 유형: "+qtype,"목표 개념: "+concept.name,"질문: "+q.question,"채점 핵심: "+JSON.stringify(q.key_points||[])];
      if(q?.examAnswer)textParts.push("\n[이 기출문제의 공식 정답·해설 — 이 기준으로 채점하고 ANSWER에는 이 정답을 정리해 써]\n"+q.examAnswer);
      if(hasTxt)textParts.push("\n학습자 텍스트 답안:\n"+answer.trim());
      if(img)textParts.push("\n학습자가 위 이미지에 손으로 쓴 답도 포함돼. 이미지 속 내용을 읽고 함께 채점해줘.");
      userBlocks.push({type:"text",text:textParts.join("\n")});
      const gradingRaw=await callAI(
        "너는 학습 분석 튜터야. "+qtypeCtx+" 학습자 답안을 보고 '이 개념의 본질 대비 내 답의 갭'을 분석해. 수식·행렬·그리스 문자·수학 기호(⊥ ∥ ∈ ∉ ⊆ ℝ ∇ 등)는 반드시 LaTeX로: 인라인 $...$, 블록 $$...$$. 유니코드 기호 직접 사용 금지. 다음 형식으로만 출력 (JSON·코드블록 없이):\nESSENCE: 이 질문이 진짜 요구하는 핵심 요소 1~3가지 (학습자가 반드시 알아야 할 것)\nGOT_IT: 내 답이 제대로 담은 부분 (인정해줄 것, 반말)\nGAP: 본질 대비 빠지거나 얕거나 비껴간 핵심 부분 (없으면 정확히 '없음')\nGAP_TYPE: 개념누락 / 이해얕음 / 핵심비껴감 / 표현부족 / 갭없음 중 정확히 하나\nDEPTH: 암기 수준 / 이해 수준 / 설명가능 수준 / 응용가능 수준 중 정확히 하나\nNEXT: 이 갭을 메우려면 구체적으로 뭘 보강해야 하는지 (반말, 1~2문장)\nFACTORS: 이 답안에서 드러난 능력을 각각 평가 — 개념(개념 이해)·계산(절차·연산 정확성)·전략(문제 해석·식 세우기)·추론(논리 전개·정당화)을 0(부족)/1(보통)/2(좋음)으로, 이 문제에서 드러나지 않는 능력은 - 로. 예: 개념=2 계산=1 전략=- 추론=1\nERROR: 오답의 성격을 정확히 하나로 — 없음 / 실수(개념은 아는데 계산·부호·옮겨쓰기 실수) / 개념(필요한 개념 자체를 모르거나 잘못 앎) / 전략(접근·풀이 방법 선택이 틀림) / 해석(문제 조건을 오독·누락) / 표기(과정은 맞는데 표현이 부정확) / 백지(손을 못 댐). '실수'와 '개념'의 구분이 가장 중요하니 풀이 과정을 근거로 신중히 판단해.\nSTAGE: 첫 오류가 난 단계 — 식세우기 / 계산 / 해석 중 하나 (오류 없으면 -)\nMISC: 드러난 오개념·실수 패턴을 12자 이내 라벨로 (예: 부호 분배 실수, 판별식 조건 혼동 — 없으면 -)\nVERDICT: correct 또는 partial 또는 incorrect (갭없음이면 correct, 핵심 갭이면 partial, 본질 전체 누락이면 incorrect)\nANSWER: 모범답안 3~5문장 (수식 LaTeX, 그래프 필요시 <svg> 태그 직접)"+RICH_FMT+"\n\n자료:\n"+studyMat,
        userBlocks,false,{cache:true,maxTok:3500,lang:studyLang},abortRef.current?.signal);
      const r=parseGrading(gradingRaw);setEv(r);
      const v=["correct","partial","incorrect"].includes(r.verdict)?r.verdict:"partial";
      lastAnswerRef.current={answer:hasTxt?answer.trim():"[손글씨]",gap:r.gap||"",gapType:r.gap_type||""};
      logAttempt({src:"study",deckId:deck.id,concept:concept.name,unit:[concept.u1,concept.u2].filter(Boolean).join(" "),
        verdict:v,gapType:r.gap_type||"",gap:r.gap&&r.gap!=="없음"?r.gap:"",qtype,box:concept.box||1,factors:r.factors,
        err:r.err||(v==="correct"?"none":undefined),stage:r.stage,misc:r.misc,
        dur:elapsedSec(),ink:padRef.current?.strokeStats?.(),
        hint:hintRef.current||undefined,ocr:ocrRef.current||undefined});
      const enrichConcept=(c)=>({...c,lastAnswer:lastAnswerRef.current.answer,lastGap:lastAnswerRef.current.gap,lastGapType:lastAnswerRef.current.gapType});
      if(v==="correct"){
        const uc=schedule(enrichConcept(concept),v);
        persist({...deckRef.current,concepts:deckRef.current.concepts.map(c=>c.id===concept.id?uc:c)});
        setConcept(uc);setCount(n=>n+1);setPhase("result");
        setTimeout(()=>padRef.current?.forceColor(PEN_COLORS[2]),50);
      }else{
        const coreGap=r.gap&&r.gap!=="없음"&&(r.gap_type==="개념누락"||r.gap_type==="핵심비껴감");
        if(coreGap){
          // 원래 답안(손글씨/텍스트)은 그대로 두고 빨간펜으로 빠진 부분만 보완하게 함
          setFollowupCount(1);setFollowupHistory([]);setFollowupEv(null);setFollowupSuccess(false);
          setTimeout(()=>padRef.current?.forceColor(PEN_COLORS[2]),50);
          await generateFollowup(r,[],hasTxt?answer.trim():"");
        }else{
          const uc=schedule(enrichConcept(concept),v);
          persist({...deckRef.current,concepts:deckRef.current.concepts.map(c=>c.id===concept.id?uc:c)});
          setConcept(uc);setCount(n=>n+1);setPhase("result");
        }
      }
    }catch(e){if(e.name==="AbortError")return;setPhase("answering");setSubmitErr(T("채점 실패: ","Grading failed: ")+e.message);}
    finally{submitting.current=false;}
  }

  async function generateFollowup(ev0,history,myAnswer){
    setFollowupBusy(true);
    try{
      const histTxt=history.length?"이전 보충 시도:\n"+history.map((h,i)=>(i+1)+". "+h.answer+" → "+h.verdict).join("\n")+"\n\n":"";
      const myAns=(myAnswer&&myAnswer.trim())?myAnswer.trim():"(손글씨로 답함 — 아래 GOT_IT/GAP 분석을 학습자가 실제로 쓴 내용으로 보고 질문을 만들 것)";
      const gapTxt=(ev0&&ev0.gap)?ev0.gap:(typeof ev0==="string"?ev0:"");
      const userCtx=
        "개념: "+concept.name+"\n"+
        "원래 질문: "+q.question+"\n"+
        "── 학습자가 실제로 쓴 답 ──\n"+myAns+"\n\n"+
        "이 답에서 학습자가 이미 맞게 한 부분(GOT_IT): "+((ev0&&ev0.got_it)||"-")+"\n"+
        "이 답에서 빠지거나 비껴간 핵심(GAP): "+(gapTxt||"-")+"\n"+
        "이 갭을 메우려면 보강할 것(NEXT): "+((ev0&&ev0.next)||"-")+"\n\n"+
        histTxt+"후속 질문만 출력:";
      const raw=await callAI(
        "너는 소크라테스식 학습 튜터야. 학습자가 '자기가 쓴 답의 빠진 부분'을 스스로 떠올려 채우도록, 후속 질문을 딱 하나만 만들어.\n"+
        "규칙:\n"+
        "① 반드시 위 GAP(이 학습자 답의 빠진 핵심)만 정조준해. 개념 전체나 새로운 주제로 넘어가지 말 것 — 학습자 답과 동떨어진 엉뚱한 질문은 절대 금지.\n"+
        "② 학습자가 이미 쓴 답(GOT_IT)을 출발점으로 삼아, '네가 ~라고 했는데, 그럼 …?' 처럼 그 답에 이어 붙는 질문으로 만들어. 학습자가 흐릿하게 기억하는 부분을 스스로 끄집어내도록 유도해.\n"+
        "③ 절대 정답·모범답안을 알려주지 말 것. 답을 떠먹여주지 말고 떠올리게만 해.\n"+
        "④ '왜', '그렇다면', '어떤 경우에' 같은 소크라테스식, 반말, 친근하게.\n"+
        "⑤ 질문 한 문장만 출력 (설명·안내 없이).\n\n자료:\n"+matFor(concept).slice(0,4000),
        userCtx,
        false,{maxTok:200,model:CFG.qmodel,lang:studyLang},abortRef.current?.signal
      );
      setFollowupQ((raw||"").trim());
      setFollowupHint("");setFollowupHintBusy(false);
      setPhase("followup");
    }catch(e){
      if(e.name==="AbortError")return;
      setSubmitErr(T("후속 질문 생성 실패: ","Follow-up generation failed: ")+e.message);
      setPhase("answering");
    }
    setFollowupBusy(false);
  }

  async function submitFollowup(){
    if(followupSubmitting.current)return;
    followupSubmitting.current=true;
    const hasInk=padRef.current?.hasStrokes();
    const hasTxt=answer.trim().length>0;
    if(!hasInk&&!hasTxt){followupSubmitting.current=false;setSubmitErr(T("답을 써봐!","Write an answer!"));return;}
    const img=hasInk?padRef.current.getImageBase64():null;
    setFollowupBusy(true);setSubmitErr("");
    try{
      const userBlocks=[];
      if(img)userBlocks.push({type:"image",source:{type:"base64",media_type:"image/png",data:img}});
      const textParts=["개념: "+concept.name,"원래 질문: "+q.question,"후속 질문: "+followupQ];
      if(hasTxt)textParts.push("\n학습자 답변:\n"+answer.trim());
      if(img)textParts.push("\n이미지에는 학습자의 '원래 답(검은펜/파란펜)'과 후속 질문에 답하려고 새로 보탠 '빨간펜 보완'이 함께 있어. 빨간펜으로 새로 보탠 내용을 중심으로, 후속 질문에 제대로 답했는지 평가해줘.");
      userBlocks.push({type:"text",text:textParts.join("\n")});
      const raw=await callAI(
        "너는 학습 분석 튜터야. 후속 질문에 대한 답변만 갭 분석해. 이 후속 질문이 묻는 부분만 평가해 (전체 모범답안 기준 아님). 다음 형식으로만 출력:\nESSENCE: 이 후속 질문이 묻는 핵심\nGOT_IT: 맞게 표현한 부분 (반말)\nGAP: 여전히 부족한 부분 (없으면 정확히 '없음')\nGAP_TYPE: 개념누락 / 이해얕음 / 핵심비껴감 / 표현부족 / 갭없음 중 하나\nDEPTH: 암기 수준 / 이해 수준 / 설명가능 수준 / 응용가능 수준 중 하나\nNEXT: 1문장 (반말)\nVERDICT: correct 또는 partial 또는 incorrect\nANSWER: "+RICH_FMT+"\n\n자료:\n"+studyMat,
        userBlocks,false,{cache:true,maxTok:800,lang:studyLang},abortRef.current?.signal
      );
      const r=parseGrading(raw);
      setFollowupEv(r);
      logAttempt({src:"followup",deckId:deck.id,concept:concept.name,unit:[concept.u1,concept.u2].filter(Boolean).join(" "),
        verdict:r.verdict,gapType:r.gap_type||"",box:concept.box||1});
      const newHistory=[...followupHistory,{answer:answer.trim()||(img?"|손글씨|":""),verdict:r.verdict}];
      setFollowupHistory(newHistory);
      const newCount=followupCount+1;
      setFollowupSuccess(r.verdict==="correct");
      const finalVerdict=r.verdict==="correct"?"partial":(ev?.verdict||"incorrect");
      const la=lastAnswerRef.current;
      const uc=schedule({...concept,...(la.answer?{lastAnswer:la.answer,lastGap:la.gap,lastGapType:la.gapType}:{})},finalVerdict);
      persist({...deckRef.current,concepts:deckRef.current.concepts.map(c=>c.id===concept.id?uc:c)});
      setConcept(uc);setCount(n=>n+1);
      padRef.current?.clear();setAnswer("");
      setPhase("result");
      setLeftPage(r.verdict==="correct"?0:1);
      setTimeout(()=>padRef.current?.forceColor(PEN_COLORS[2]),50);
    }catch(e){if(e.name==="AbortError")return;setSubmitErr(T("채점 실패: ","Grading failed: ")+e.message);}
    finally{followupSubmitting.current=false;}
    setFollowupBusy(false);
  }

  function toggleDeriveMode(cid){
    const updated={...deck,concepts:deck.concepts.map(c=>c.id===cid?{...c,deriveMode:c.deriveMode==="derive"?"memorize":"derive"}:c)};
    persist(updated);
  }

  async function startDerive(){
    setDerivePlan(null);setDeriveIdx(0);setDeriveHistory([]);setDeriveFeedback("");setDeriveDone(false);setDeriveHintShow(false);
    setPhase("derive_load");
    try{
      const raw=await callAI(
        "수식 유도 튜터. 학습자가 한 단계씩 공식을 직접 유도할 수 있도록 계획을 세워. 각 단계는 한 줄~두 줄 수식 하나로 분리해. 수식은 LaTeX($...$).",
        "개념: "+concept.name+"\n자료:\n"+matFor(concept).slice(0,4000)+"\n\n다음 형식으로만 출력:\nSTEPS: 단계수(3~6)\nSTART: 시작 안내 문장\nHINT1: 1단계 힌트\nHINT2: 2단계 힌트\n... (단계수만큼)",
        false,{maxTok:700,model:CFG.qmodel,lang:studyLang},abortRef.current?.signal);
      setDerivePlan(parseDerivePlan(raw));
      setPhase("derive_step");
    }catch(e){if(e.name==="AbortError")return;setPhase("answering");setSubmitErr(T("유도 시작 실패: ","Couldn't start derivation: ")+e.message);}
  }

  async function submitDeriveStep(){
    const hasInk=padRef.current?.hasStrokes();
    const hasTxt=answer.trim().length>0;
    if(!hasInk&&!hasTxt){setSubmitErr(T("이 단계를 먼저 써봐!","Write this step first!"));return;}
    const img=hasInk?padRef.current.getImageBase64():null;
    setDeriveChecking(true);setDeriveHintShow(false);setSubmitErr("");
    const userBlocks=[];
    if(img)userBlocks.push({type:"image",source:{type:"base64",media_type:"image/png",data:img}});
    const histTxt=deriveHistory.length?"이전 단계들:\n"+deriveHistory.map((h,i)=>(i+1)+". "+h).join("\n")+"\n\n":"";
    userBlocks.push({type:"text",text:
      "개념: "+concept.name+"\n현재 단계: "+(deriveIdx+1)+"/"+derivePlan.totalSteps+"\n"+histTxt+
      "학습자 답"+(hasTxt?":\n"+answer.trim():" (손글씨 이미지)")+"\n\n"+
      "자료:\n"+matFor(concept).slice(0,2500)+"\n\n"+
      "다음 형식으로 평가:\nCORRECT: yes 또는 no\nDONE: yes 또는 no (마지막 단계가 맞을 때만)\nFEEDBACK: 1~2문장 반말\nNEXT: 다음 단계 안내 (CORRECT=yes·DONE=no일 때만)"
    });
    try{
      const raw=await callAI(
        "수식 유도 단계 평가자. 표기가 완벽하지 않아도 수학적 방향이 맞으면 CORRECT: yes. 관대하게 평가해.",
        userBlocks,false,{maxTok:350,lang:studyLang},abortRef.current?.signal);
      const res=parseDeriveCheck(raw);
      setDeriveFeedback(res.feedback);
      if(res.correct){
        const newHist=[...deriveHistory,answer.trim()||("|손글씨 "+(deriveIdx+1)+"단계|")];
        setDeriveHistory(newHist);
        padRef.current?.clear();setAnswer("");
        if(res.done||deriveIdx+1>=derivePlan.totalSteps){
          setDeriveDone(true);setPhase("derive_done");
          const uc=schedule(concept,"correct");
          persist({...deckRef.current,concepts:deckRef.current.concepts.map(c=>c.id===concept.id?uc:c)});
          setConcept(uc);setCount(n=>n+1);
        }else{
          setDeriveIdx(deriveIdx+1);setDeriveFeedback("");
        }
      }
    }catch(e){if(e.name==="AbortError")return;setSubmitErr(T("평가 실패: ","Evaluation failed: ")+e.message);}
    setDeriveChecking(false);
  }

  // '여기가 내 한계야' — 막힌 채로 누르면, 답안화면 그대로 두고 교수 캐릭터가 도움 말풍선을 띄움.
  // AI가 막힌 정도를 보고 살짝이면 유도질문, 많이면 힌트를 줌(정답은 안 알려줌). 레벨 영향 없음.
  async function handleLimit(){
    if(limitBusy||phase!=="answering")return;
    hintRef.current++;   // 힌트 요청 — 이 문제를 혼자 못 푼다는 신호(시도 로그에 포함)
    const hasInk=padRef.current?.hasStrokes();
    const hasTxt=answer.trim().length>0;
    const img=hasInk?padRef.current.getImageBase64():null;
    setLimitBusy(true);setSubmitErr("");setLimitHelp("");
    const examSol=q?.examAnswer||q?.examRef||"";
    // 전용 컨트롤러 + 타임아웃: 공유 abortRef가 중간에 끊거나 호출이 매달려도 항상 말풍선에 피드백을 남김
    const myId=genId.current;
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort("timeout"),60000);
    try{
      const userBlocks=[];
      if(img)userBlocks.push({type:"image",source:{type:"base64",media_type:"image/png",data:img}});
      const parts=["개념: "+concept.name,"질문: "+q.question];
      if(hasTxt)parts.push("학습자가 지금까지 쓴 답(텍스트):\n"+answer.trim());
      if(img)parts.push("학습자가 노트에 손으로 쓴 답도 이미지로 첨부됨 — 읽어서 어디까지 갔는지 파악해.");
      if(!hasTxt&&!img)parts.push("학습자가 아직 거의 못 썼어 (백지에 가까움).");
      if(examSol)parts.push("\n[참고용 공식 해답 — 절대 그대로 알려주지 말고 방향만 잡는 데 써]\n"+examSol);
      userBlocks.push({type:"text",text:parts.join("\n")});
      const r=await callAI(
        "너는 '니가교수'라는 따뜻한 교수 캐릭터야. 학습자가 문제를 풀다 막혀서 '여기가 내 한계야' 버튼을 눌렀어. 학습자가 지금까지 쓴 답을 보고, 막힌 정도를 스스로 판단해서 딱 맞는 도움을 한 번 줘:\n"+
        "· 거의 다 왔거나 조금만 막혔으면 → '네가 ~까지 했는데, 그럼 …?' 식의 소크라테스식 유도 질문 하나로 스스로 떠올리게 해.\n"+
        "· 많이 막혔거나 백지에 가까우면 → 시작할 발판이 되는 구체적 힌트(어떤 개념·공식·접근을 떠올리면 되는지)를 줘.\n"+
        "규칙: ① 절대 최종 정답·완성된 풀이를 통째로 주지 마 — 학습자가 마지막 한 걸음은 직접 딛게. ② 반말, 따뜻하고 짧게(2~4문장). ③ 수식은 LaTeX($...$). ④ ##·목록·>> 같은 기호 없이 말풍선처럼 자연스러운 말투로. 격려 한마디로 끝맺어.\n\n자료:\n"+matFor(concept).slice(0,5000),
        userBlocks,false,{maxTok:500,model:CFG.qmodel,lang:studyLang},ctrl.signal);
      if(genId.current!==myId)return;
      const help=(r||"").trim();
      setLimitHelp(help||T("막힌 부분을 한 줄만 적어줄래? 거기에 딱 맞춰 도와줄게.","Jot the part you're stuck on in one line and I'll target it."));
      setTimeout(()=>padRef.current?.forceColor(PEN_COLORS[0]),50);
    }catch(e){
      if(genId.current===myId)setLimitHelp("⚠️ "+(ctrl.signal.reason==="timeout"
        ?T("응답이 너무 오래 걸렸어. 잠깐 뒤 '여기가 내 한계야'를 다시 눌러줘.","Timed out — tap “I'm stuck here” again in a moment.")
        :(T("도움을 못 불러왔어: ","Couldn't load help: ")+((e&&e.message)||String(e)))));
    }finally{clearTimeout(timer);if(genId.current===myId)setLimitBusy(false);}
  }

  async function handleDontKnow(){
    const arc=LS.get("ng:dontknow")||[];
    arc.unshift({id:uid(),deckId:deck.id,conceptId:concept.id,
      conceptName:concept.name,question:q?.question||"",ts:Date.now()});
    if(!LS.set("ng:dontknow",arc.slice(0,200)))console.warn("[handleDontKnow] dontknow 로그 저장 실패");
    // '모르겠어'는 가장 강한 비숙련 신호 — 백지 오답으로 시도 로그에 기록 (재도전하면 끈기로 회복)
    logAttempt({src:"dontknow",deckId:deck.id,concept:concept.name,unit:[concept.u1,concept.u2].filter(Boolean).join(" "),
      verdict:"incorrect",err:"blank",qtype:q?.qtype,box:concept.box||1,dur:elapsedSec()});
    const uc={...concept,box:1,dueAt:0};
    persist({...deckRef.current,concepts:deckRef.current.concepts.map(c=>c.id===concept.id?uc:c)});
    setConcept(uc);
    setPhase("dontknow");setDontknow("");setDontknowBusy(true);
    const examSol=q?.examAnswer||q?.examRef||""; // 기출 공식 해답 있으면 그 기조로 설명
    try{
      const r=await callAI(
        "너는 친절한 튜터야. 학습자가 이 개념을 전혀 모르니 처음 배우는 사람에게 직관적으로(비유·예시·왜 중요한지) 반말로 설명해줘."+(examSol?" 아래 [기출 공식 해답]이 주어졌어 — 설명의 방향·용어·풀이 기조를 그 해답에 맞추되, 처음 배우는 사람도 따라오도록 더 쉽고 자세히 풀어줘. 공식 해답과 어긋나게 설명하지 마.":"")+"\n\n출력 형식 규칙:\n① 제목은 ## 소제목은 ### ② 핵심 용어나 강조는 **굵게** ③ 목록은 - 기호 ④ 수식은 LaTeX($...$, $$...$$) ⑤ >> === 같은 ASCII 기호 금지 ⑥ 이해에 도움되면 표·그래프(<svg>) 적극 사용"+RICH_FMT+"\n\n자료:\n"+studyMat,
        "개념: "+concept.name+(q?"\n원래 질문: "+q.question:"")+(examSol?"\n\n[기출 공식 해답 — 이 기조를 따라 설명]\n"+examSol:""),
        false,{cache:true,maxTok:1900,lang:studyLang},abortRef.current?.signal);
      setDontknow(r);
    }catch(e){if(e.name==="AbortError")return;setDontknow("설명 불러오기 실패: "+e.message);}
    setDontknowBusy(false);
  }

  async function handleFollowupHint(){
    if(followupHintBusy)return;
    setFollowupHintBusy(true);setFollowupHint("");
    try{
      const gap=ev?.gap&&ev.gap!=="없음"?ev.gap:"";
      const r=await callAI(
        "너는 친절한 튜터야. 학습자가 후속 질문에 막혔어. 반말로 핵심만 짧게 (3~5문장) 힌트를 줘. 정답을 직접 말하지 말고 생각할 수 있게 유도해줘.\n\n출력 형식: ## 소제목 없이, **굵게** 강조만 허용, 수식은 LaTeX($...$), >> --- ASCII 기호 금지.",
        "개념: "+concept.name+"\n후속 질문: "+followupQ+(gap?"\n빠진 부분: "+gap:""),
        false,{maxTok:400,cache:true,lang:studyLang},abortRef.current?.signal);
      setFollowupHint(r);
    }catch(e){if(e.name==="AbortError")return;setFollowupHint("힌트 불러오기 실패: "+e.message);}
    setFollowupHintBusy(false);
  }

  async function explainMore(){
    setDeepBusy(true);
    const examSol=q?.examAnswer||q?.examRef||""; // 기출 공식 해답 있으면 그 기조로 설명
    try{const r=await callAI(
      "너는 친절한 튜터야. 자료에 근거해 더 깊이 직관적으로(비유·예시·왜) 반말로 설명해. 수식·행렬·그리스 문자·수학 기호(⊥ ∥ ∈ ∉ ⊆ ℝ ∇ × · 등)는 반드시 모두 LaTeX로: 인라인은 $...$, 블록은 $$..$$. 유니코드 기호 직접 사용 금지. 그래프·곡선·다이어그램이 이해에 도움이 되면 SVG로 그려줘(코드블록 없이 <svg> 태그 직접 사용, width≤380 height≤260 viewBox 사용, 축·레이블 포함, font-size 11~13, 색상: 축선=#221C39, 곡선은 #6C5CE7·#27C2A0·#FF6B8A·#FFC24B, 균형점=원형 #FFC24B, 배경=#FFFDF8)."+(examSol?" 아래 [기출 공식 해답]이 주어졌어 — 그 해답의 풀이 기조·논리 전개 순서·용어·표기를 그대로 따라가되, 학습자가 스스로 이해하도록 각 단계를 더 자세히 풀어서 설명해. 공식 해답과 어긋나는 설명은 하지 마.":"")+RICH_FMT+"\n\n자료:\n"+studyMat,
      "개념: "+concept.name+"\n질문: "+q.question+"\n모범답안: "+(ev?.model_answer||"")+(examSol?"\n\n[기출 공식 해답 — 이 기조를 따라 설명]\n"+examSol:""),
      false,{cache:true,maxTok:1900,lang:studyLang},abortRef.current?.signal);
      setDeeper(r);}
    catch(e){if(e.name==="AbortError")return;setDeeper("실패: "+e.message);}
    setDeepBusy(false);
  }

  async function askAnnotation(ctxText){
    const hasHL=annotPadRef.current?.hasStrokes();
    const hasQPen=annotQMode==="pen"&&annotQPadRef.current?.hasStrokes();
    const hasQTxt=annotQMode==="type"&&annotQ.trim().length>0;
    if(!hasHL&&!hasQPen&&!hasQTxt)return;
    setAnnotBusy(true);
    const ctx=ctxText||[ev?.essence,ev?.gap,ev?.model_answer].filter(Boolean).join("\n\n");
    const userBlocks=[];
    if(hasHL){const img=annotPadRef.current.getImageBase64();userBlocks.push({type:"image",source:{type:"base64",media_type:"image/png",data:img}});}
    if(hasQPen){const img=annotQPadRef.current.getImageBase64();userBlocks.push({type:"image",source:{type:"base64",media_type:"image/png",data:img}});}
    const desc=(hasHL?"노란 형광펜으로 표시한 부분":"")+(hasHL&&hasQPen?" + ":"")+(hasQPen?"손글씨로 질문을 씀":"")+(hasQTxt?"타이핑 질문 있음":"");
    userBlocks.push({type:"text",text:
      "학습자가 해설에서 이해 안 되는 부분에 표시하고 질문을 남겼어 ("+desc+"). 질문에 직접 답해. 메타 문장 없이.\n"+
      (hasQTxt?"질문: "+annotQ.trim()+"\n\n":"")+
      "해설:\n"+ctx
    });
    try{
      const r=await callAI(
        "친절한 튜터. 첫 글자부터 바로 설명. 반말."+RICH_FMT,
        userBlocks,false,{maxTok:1200,cache:true,lang:studyLang},abortRef.current?.signal);
      setAnnotAnswer(r);
    }catch(e){if(e.name==="AbortError")return;setAnnotAnswer("실패: "+e.message);}
    setAnnotBusy(false);
  }

  const [showInfo,setShowInfo]=useState(false);
  const subj=subjects?.find(s=>s.id===deck.subjId);
  const s=deckSummary(deck);
  const v=ev?.verdict;
  const vTone=v==="correct"?"mint":v==="incorrect"?"rose":"gold";
  const vLabel=v==="correct"?T("오 정확해! 💯","Spot on! 💯"):v==="incorrect"?T("이건 다시 보자 🔁","Let's revisit this 🔁"):T("거의 다 왔어 ✏️","Almost there ✏️");
  const isDeriving=phase==="derive_load"||phase==="derive_step"||phase==="derive_done";
  const isActive=phase==="answering"||phase==="grading"||phase==="result"||phase==="dontknow"||isDeriving||phase==="followup";

  return(
    <section className="study">
      {/* ── 상단 바 ── */}
      <div className="card study-bar">
        {subj&&<span style={{fontSize:11,fontWeight:700,color:subj.color,flexShrink:0}}>{subj.name}</span>}
        <span className="snm">{deck.name}</span>
        <div className="prog" style={{gap:12}}>
          <RateBar compact label={T("개념","Concept")} pct={ratePct(s.started,s.total)} tone="pri"/>
          <RateBar compact label={T("복습","Review")} pct={ratePct(s.reviewed,s.total)} tone="gold"/>
          <RateBar compact label={T("심화","Deep")} pct={ratePct(s.deep,s.total)} tone="mint"/>
        </div>
        <span className="muted" style={{fontSize:11,flexShrink:0}}>{count}{T("문제"," done")}</span>
        <button className="btn gho xs" style={{flexShrink:0}} onClick={()=>setShowInfo(v=>!v)}>
          {showInfo?T("▲ 닫기","▲ Close"):T("▼ 개념 목록","▼ Concepts")}
        </button>
        {phase!=="session_done"&&<button className="btn gho xs" style={{flexShrink:0,borderColor:"var(--rose)",color:"var(--rose)"}}
          onClick={()=>{abortRef.current?.abort();setShowInfo(false);setPhase("session_done");}}>🏁 {T("학습 종료","End")}</button>}
      </div>

      {/* ── 개념 목록 토글 ── */}
      {showInfo&&(
        <div className="card clist-panel">
          {deck.concepts.slice().sort((a,b)=>(a.box||1)-(b.box||1)).map(c=>(
            <div key={c.id} className={"crow"+(concept&&c.id===concept.id?" active":"")}
              onClick={()=>{if(phase!=="loading"&&phase!=="grading"){setShowInfo(false);next(deck,c.id);}}}>
              <Meter box={c.box||1}/><MathText text={c.name} tag="span" className="cn"/>
              <span className={"derive-badge"+(c.deriveMode==="derive"?" on":"")}
                title={c.deriveMode==="derive"?T("유도 모드 ON — 클릭해서 끄기","Derive mode ON — click to turn off"):T("클릭하면 유도 모드로","Click for derive mode")}
                onClick={e=>{e.stopPropagation();toggleDeriveMode(c.id);}}>∫</span>
            </div>
          ))}
        </div>
      )}

      <div className="stage">
        {phase==="session_done"&&(
          <div className="card qcard" style={{maxWidth:460,margin:"0 auto",textAlign:"center",padding:"26px 22px"}}>
            <Prof size={72}/>
            <div style={{fontFamily:"'Jua',sans-serif",fontSize:20,color:"var(--ink)",margin:"10px 0 4px"}}>{T("오늘 학습 끝! 수고했어 🎉","Done for today! 🎉")}</div>
            <div style={{fontSize:13.5,color:"var(--sub)",marginBottom:16}}>{count>0?T("오늘 ","Solved ")+count+T("문제 풀었어. 꾸준함이 실력이야 💪"," today. Consistency wins 💪"):T("다음엔 한 문제라도 풀어보자 💪","Try at least one next time 💪")}</div>
            <div style={{display:"flex",flexDirection:"column",gap:9,textAlign:"left",marginBottom:18}}>
              <RateBar label={T("개념 진행률","Started")} pct={ratePct(s.started,s.total)} tone="pri"/>
              <RateBar label={T("복습 진도율","Reviewed")} pct={ratePct(s.reviewed,s.total)} tone="gold"/>
              <RateBar label={T("심화 진도율","Mastered")} pct={ratePct(s.deep,s.total)} tone="mint"/>
            </div>
            <div className="row" style={{justifyContent:"center"}}>
              <button className="btn gho" onClick={()=>next(deck)}>{T("더 풀래","Keep going")}</button>
              <button className="btn pri" onClick={()=>onExit&&onExit()}>{T("홈으로 →","Home →")}</button>
            </div>
          </div>
        )}
        {phase==="error"&&(
          <div className="card qcard msgcard"><Prof size={64}/><p className="muted">{errMsg}</p>
            <button className="btn pri" onClick={()=>next()}>{T("다시 시도","Try again")}</button></div>
        )}
        {phase==="loading"&&(
          <div className="card qcard msgcard"><div className="spinner"/><p className="muted">{T("문제 만드는 중…","Making a question…")}</p><Cheer style={{marginTop:6}}/></div>
        )}
        {phase==="quiz"&&quizItem&&(
          <div key={concept?.id||""} style={{display:"flex",gap:14,alignItems:"flex-start",justifyContent:"center",flexWrap:"wrap",maxWidth:scratchOpen?1140:680,margin:"0 auto"}}>
          <div className="card qcard" style={{flex:"1 1 380px",maxWidth:680,minWidth:0}}>
            <div className="chips" style={{marginBottom:14}}>
              <MathText text={concept?.name} tag="span" className="chip"/>
              <span className="chip gho"><Meter box={concept?.box||1}/></span>
              <span className="chip" style={{background:"var(--pri-s)",color:"var(--pri-d)"}}>
                {quizItem.format==="mc"?T("객관식","Multiple choice"):quizItem.format==="ox"?T("OX 퀴즈","True / False"):T("단답형","Short answer")}
              </span>
              <button type="button" className={"chip gho"+(scratchOpen?" on":"")} style={{cursor:"pointer",marginLeft:"auto"}}
                onClick={()=>setScratchOpen(v=>!v)} title={T("계산·메모용 연습장 (채점 안 됨)","Scratchpad for working out (not graded)")}>
                {scratchOpen?T("✏️ 연습장 접기","✏️ Hide scratchpad"):T("✏️ 연습장","✏️ Scratchpad")}
              </button>
            </div>

            {quizItem.format==="mc"&&(<>
              <MathText text={quizItem.question} tag="div" style={{fontSize:17,fontWeight:600,lineHeight:1.6,marginBottom:16}}/>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {(quizItem.choices||[]).map((ch,i)=>{
                  const isAns=i===quizItem.answer, isPick=quizSel===i;
                  const bg=!quizGraded?"#FBFAFF":isAns?"#E9FBF0":isPick?"#FFEEEE":"#FBFAFF";
                  const bd=!quizGraded?"var(--line)":isAns?"#3BB371":isPick?"#E06666":"var(--line)";
                  return(
                    <button key={i} type="button" disabled={quizGraded} onClick={()=>gradeQuiz(i)}
                      style={{textAlign:"left",padding:"13px 16px",borderRadius:13,border:"1.5px solid "+bd,
                        background:bg,cursor:quizGraded?"default":"pointer",display:"flex",gap:10,alignItems:"center"}}>
                      <span style={{fontWeight:800,color:"var(--sub)",flexShrink:0}}>{"ABCD"[i]}</span>
                      <MathText text={ch} tag="span" style={{fontSize:15,lineHeight:1.5}}/>
                      {quizGraded&&isAns&&<span style={{marginLeft:"auto"}}>✅</span>}
                      {quizGraded&&isPick&&!isAns&&<span style={{marginLeft:"auto"}}>❌</span>}
                    </button>
                  );
                })}
              </div>
            </>)}

            {quizItem.format==="ox"&&(<>
              <MathText text={quizItem.statement} tag="div" style={{fontSize:17,fontWeight:600,lineHeight:1.6,marginBottom:18}}/>
              <div style={{display:"flex",gap:12}}>
                {[[true,"⭕",T("참 (O)","True")],[false,"❌",T("거짓 (X)","False")]].map(([val,emo,lbl])=>{
                  const isAns=val===quizItem.answer, isPick=quizSel===val;
                  const bg=!quizGraded?"#FBFAFF":isAns?"#E9FBF0":isPick?"#FFEEEE":"#FBFAFF";
                  const bd=!quizGraded?"var(--line)":isAns?"#3BB371":isPick?"#E06666":"var(--line)";
                  return(
                    <button key={String(val)} type="button" disabled={quizGraded} onClick={()=>gradeQuiz(val)}
                      style={{flex:1,padding:"22px 8px",borderRadius:14,border:"1.5px solid "+bd,background:bg,
                        cursor:quizGraded?"default":"pointer",textAlign:"center"}}>
                      <div style={{fontSize:30}}>{emo}</div>
                      <div style={{fontSize:14,fontWeight:700,marginTop:4}}>{lbl}</div>
                    </button>
                  );
                })}
              </div>
            </>)}

            {quizItem.format==="short"&&(<>
              <MathText text={quizItem.question} tag="div" style={{fontSize:17,fontWeight:600,lineHeight:1.6,marginBottom:16}}/>
              <form onSubmit={e=>{e.preventDefault();if(!quizGraded&&!quizShortChecking&&String(quizSel||"").trim())gradeQuiz(quizSel);}}>
                <input className="field" autoFocus disabled={quizGraded||quizShortChecking}
                  placeholder={T("정답을 입력해줘","Type your answer")}
                  value={quizGraded?quizSel:(quizSel||"")} onChange={e=>setQuizSel(e.target.value)}
                  style={{marginBottom:12,borderColor:quizGraded?(quizCorrect?"#3BB371":"#E06666"):undefined}}/>
                {!quizGraded&&(
                  <button className="btn pri" type="submit" disabled={quizShortChecking||!String(quizSel||"").trim()}>
                    {quizShortChecking?T("채점 중…","Checking…"):T("제출","Submit")}
                  </button>
                )}
              </form>
            </>)}

            {quizGraded&&(
              <div style={{marginTop:18,borderTop:"1px solid var(--line)",paddingTop:14}}>
                <div style={{fontSize:15,fontWeight:800,color:quizCorrect?"#1E9E5A":"#D9534F",marginBottom:8}}>
                  {quizCorrect?T("정답이야! 🎉","Correct! 🎉"):T("아쉬워, 다시 보자 🔁","Not quite — let's review 🔁")}
                </div>
                {quizItem.format==="short"&&!quizCorrect&&(
                  <div style={{fontSize:13.5,marginBottom:8}}>{T("정답: ","Answer: ")}<b>{quizItem.answer}</b></div>
                )}
                {quizItem.explain&&<MathText text={quizItem.explain} tag="div" style={{fontSize:14,lineHeight:1.7,color:"var(--ink)"}}/>}
                <button className="btn pri" style={{marginTop:14}} onClick={()=>next()}>{T("다음 문제 →","Next →")}</button>
              </div>
            )}

          </div>

            {/* 연습장 — 문제 오른쪽, 계산·메모용 손글씨 (채점에 안 들어감) */}
            {scratchOpen&&(
              <div className="card" key={"scratch"+(concept?.id||"")} style={{flex:"1 1 360px",minWidth:0,position:"sticky",top:16,padding:14}}>
                <div style={{fontSize:11,fontWeight:700,color:"var(--sub)",marginBottom:8}}>{T("📝 연습장 — 여기 끄적인 건 채점에 안 들어가","📝 Scratchpad — anything here isn't graded")}</div>
                <PenPad kind="scratch" onText={()=>{}} hideOcr/>
              </div>
            )}
          </div>
        )}
        {isActive&&(
          <div className="ans-layout" key={concept?.id||""}>

            {/* ── 왼쪽: 문제 (+ 결과일 때 해설) ── */}
            <div className="card qcard">
              <div style={{position:"sticky",top:0,background:"var(--card)",zIndex:3,paddingBottom:phase==="result"?8:0,borderBottom:phase==="result"?"1px solid var(--line)":"none",marginBottom:phase==="result"?10:0,maxHeight:phase==="result"?"38vh":"none",overflowY:phase==="result"?"auto":"visible"}}>
                <div className="chips">
                  <MathText text={concept?.name} tag="span" className="chip"/>
                  <span className="chip gho">{diffWord(concept?.box)}</span>
                  {q?.source&&<span className="chip" style={{
                    background:q.source==="기출"?"#FFF7E0":q.source==="심화"?"#FFE4EC":"#EFE7FF",
                    color:q.source==="기출"?"#946200":q.source==="심화"?"#C2185B":"#5B21B6",
                    border:"none",fontSize:11,fontWeight:700
                  }}>{q.source==="기출"?T("📜 기출","📜 Past exam"):q.source==="심화"?T("🔥 심화","🔥 Deep"):T("🔄 변형","🔄 Variant")}</span>}
                  {q?.qtype&&<span className="chip" style={{
                    background:q.qtype==='recall'?"#FFF0E6":q.qtype==='apply'?"#E6F7FF":"#F0EDFF",
                    color:q.qtype==='recall'?"#C05A00":q.qtype==='apply'?"#0066A3":"#5B21B6",
                    border:"none",fontSize:11
                  }}>{q.qtype==='recall'?"암기":q.qtype==='apply'?"응용":"이해"}</span>}
                </div>
                {phase!=="followup"&&<MathText text={q?.question} tag="h2" className="q" style={{margin:"8px 0 0",overflowWrap:"break-word"}}/>}
              </div>
              {phase==="followup"&&(
                <div style={{display:"flex",flexDirection:"column",gap:10,flex:1}}>
                  <div style={{fontSize:12.5,color:"var(--sub)",lineHeight:1.65,padding:"8px 12px",background:"var(--bg)",borderRadius:10,borderLeft:"3px solid var(--line)"}}>
                    <div style={{fontSize:10,fontWeight:700,color:"var(--sub)",marginBottom:3,letterSpacing:".5px"}}>{T("원래 질문","Original question")}</div>
                    <MathText text={q?.question} tag="div" style={{fontSize:12.5,color:"var(--sub)",lineHeight:1.65}}/>
                  </div>
                  {ev?.gap&&ev.gap_type!=="갭없음"&&ev.gap!=="없음"&&(
                    <div style={{background:"#FFF5F5",border:"1.5px solid #FECACA",borderRadius:10,padding:"8px 12px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                        <span style={{fontSize:10,fontWeight:700,color:"#DC2626",letterSpacing:".3px"}}>{T("빠진 것","What's missing")}</span>
                        {ev.gap_type&&<span style={{fontSize:10,background:"#FEE2E2",color:"#B91C1C",borderRadius:5,padding:"1px 6px",fontWeight:600}}>{gapTypeLabel(ev.gap_type)}</span>}
                      </div>
                      <MathText text={ev.gap} tag="div" style={{fontSize:12.5,color:"#7F1D1D",lineHeight:1.5}}/>
                    </div>
                  )}
                  {followupBusy?(
                    <div style={{display:"flex",gap:8,alignItems:"center",padding:"12px 0"}}>
                      <div className="spinner" style={{width:16,height:16,borderWidth:2}}/>
                      <span className="muted" style={{fontSize:13}}>{T("후속 질문 만드는 중…","Making a follow-up…")}</span>
                    </div>
                  ):(
                    <div style={{background:"#FFF6E9",border:"1.5px solid #FBD38D",borderRadius:14,padding:"14px 16px"}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                        <div style={{fontFamily:"'Jua',sans-serif",fontSize:11,letterSpacing:".5px",color:"#92620A"}}>{T("보충 질문","Follow-up")}</div>
                        {!followupHint&&<button className="btn gho sm" style={{fontSize:11,padding:"3px 10px"}} onClick={handleFollowupHint} disabled={followupHintBusy}>
                          {followupHintBusy?<><span className="spinner" style={{width:10,height:10,borderWidth:1.5,display:"inline-block",verticalAlign:"middle",marginRight:4}}/>{T("힌트 중…","Hint…")}</>:T("💡 힌트 주세요","💡 Hint please")}
                        </button>}
                      </div>
                      <MathText text={followupQ} tag="div" style={{fontSize:15,lineHeight:1.9,fontWeight:600,color:"var(--ink)"}}/>
                    </div>
                  )}
                  {followupHint&&(
                    <div style={{background:"#F0FDF4",border:"1.5px solid #86EFAC",borderRadius:12,padding:"12px 14px"}}>
                      <div style={{fontSize:10,fontWeight:700,color:"#166534",letterSpacing:".4px",marginBottom:6}}>{T("💡 힌트","💡 Hint")}</div>
                      <MathText text={followupHint} tag="div" style={{fontSize:13,color:"#14532D",lineHeight:1.75}}/>
                    </div>
                  )}
                  <p className="hint" style={{margin:0}}>{T(<>원래 답은 그대로 두고, <b style={{color:"#DC2626"}}>빨간펜</b>으로 빠진 부분을 보완해봐 ✍️</>,<>Keep your answer, add the missing part in <b style={{color:"#DC2626"}}>red pen</b> ✍️</>)}</p>
                </div>
              )}
              {isDeriving&&(
                <div style={{marginBottom:8}}>
                  <div className="eyebrow" style={{marginBottom:6}}>{T("증명 쉐도잉 — ","Proof shadowing — ")}{concept?.name}</div>
                  {phase==="derive_load"&&<div className="derive-prompt">{T("유도 계획 세우는 중…","Planning the derivation…")}</div>}
                  {(phase==="derive_step"||phase==="derive_done")&&derivePlan&&(
                    <div className="derive-track">
                      {/* 완료된 단계들 */}
                      {deriveHistory.map((h,i)=>(
                        <div key={i} className="derive-step-row done">
                          <div className="dn">✓</div>
                          <MathText text={h} tag="span" style={{fontSize:13,color:"var(--ink)"}}/>
                        </div>
                      ))}
                      {/* 현재 단계 프롬프트 */}
                      {phase==="derive_step"&&(
                        <div className="derive-prompt">
                          <span style={{fontSize:11,fontWeight:700,display:"block",marginBottom:4,opacity:.7}}>
                            {deriveIdx+1} / {derivePlan.totalSteps} {T("단계","steps")}
                          </span>
                          <MathText text={derivePlan.hints&&derivePlan.hints[deriveIdx]?derivePlan.hints[deriveIdx]:derivePlan.startHint||"다음 단계를 유도해봐."} tag="span"/>
                        </div>
                      )}
                      {/* 완성 */}
                      {phase==="derive_done"&&(
                        <div style={{textAlign:"center",padding:"14px 0"}}>
                          <div style={{fontSize:28}}>🎉</div>
                          <div className="jua" style={{fontSize:16,color:"var(--pri-d)",marginTop:4}}>{T("유도 완성!","Derivation complete!")}</div>
                          <div className="muted" style={{fontSize:12,marginTop:2}}>{T("box +1 올라갔어 👍","Level +1 👍")}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {!isDeriving&&phase!=="result"&&phase!=="followup"&&(
                <p className="hint" style={{margin:"4px 0 0",overflowWrap:"break-word"}}>오른쪽 노트에 직접 써봐 ✍️</p>
              )}
              {phase==="result"&&ev&&(
                <div className="result" style={{marginTop:12}}>
                  {/* ── 페이지 네비 ── */}
                  <div className="pg-nav">
                    <button className="pg-btn" onClick={()=>setLeftPage(0)} disabled={leftPage===0}>‹</button>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                      <span className="pg-info">{leftPage===0?T("채점 결과","Result"):T("해설","Explanation")}</span>
                      <div className="pg-dots">
                        <span className={leftPage===0?"on":""}/>
                        <span className={leftPage===1?"on":""}/>
                      </div>
                    </div>
                    <button className="pg-btn" onClick={()=>setLeftPage(1)} disabled={leftPage===1}>›</button>
                  </div>

                  {/* ── Page 0: 갭 분석 결과 ── */}
                  {leftPage===0&&(
                    <>
                      {followupSuccess?(
                        <>
                          <div className="verdict mint"><span className="dot"/>{T("갭을 스스로 메웠어! 🎉","You filled the gap yourself! 🎉")}</div>
                          {(followupEv?.essence||ev?.essence)&&(
                            <div style={{background:"#F0EDFF",border:"1.5px solid #C4B5FD",borderRadius:12,padding:"10px 14px"}}>
                              <div style={{fontSize:10,fontWeight:700,color:"#6C5CE7",letterSpacing:".5px",marginBottom:4}}>{T("이 개념의 본질","The essence")}</div>
                              <MathText text={followupEv?.essence||ev?.essence} tag="div" style={{fontSize:13,color:"#221C39",lineHeight:1.6}}/>
                            </div>
                          )}
                          {(followupEv?.got_it||ev?.got_it)&&(
                            <div style={{display:"flex",gap:8,alignItems:"flex-start",padding:"8px 12px",background:"#F0FFF8",border:"1.5px solid #A7F3D0",borderRadius:10}}>
                              <span style={{color:"#27C2A0",fontSize:15,marginTop:1,flexShrink:0}}>✓</span>
                              <MathText text={followupEv?.got_it||ev?.got_it} tag="div" style={{fontSize:13,color:"#065F46",lineHeight:1.5}}/>
                            </div>
                          )}
                        </>
                      ):(
                        <>
                          <div className={"verdict "+vTone}><span className="dot"/>{vLabel}</div>
                          {/* ESSENCE */}
                          {ev.essence&&(
                            <div style={{background:"#F0EDFF",border:"1.5px solid #C4B5FD",borderRadius:12,padding:"10px 14px"}}>
                              <div style={{fontSize:10,fontWeight:700,color:"#6C5CE7",letterSpacing:".5px",marginBottom:4}}>{T("이 개념이 진짜 묻는 것","What this really asks")}</div>
                              <MathText text={ev.essence} tag="div" style={{fontSize:13.5,color:"#221C39",lineHeight:1.6}}/>
                            </div>
                          )}
                          {/* GOT_IT */}
                          {ev.got_it&&(
                            <div style={{display:"flex",gap:8,alignItems:"flex-start",padding:"8px 12px",background:"#F0FFF8",border:"1.5px solid #A7F3D0",borderRadius:10}}>
                              <span style={{color:"#27C2A0",fontSize:15,marginTop:1,flexShrink:0}}>✓</span>
                              <MathText text={ev.got_it} tag="div" style={{fontSize:13,color:"#065F46",lineHeight:1.5}}/>
                            </div>
                          )}
                          {/* GAP */}
                          {ev.gap&&ev.gap_type!=="갭없음"&&ev.gap!=="없음"?(
                            <div style={{background:"#FFF5F5",border:"2px solid #FECACA",borderRadius:12,padding:"10px 14px"}}>
                              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}>
                                <span style={{fontSize:11,fontWeight:700,color:"#DC2626",letterSpacing:".3px"}}>{T("빠진 것","What's missing")}</span>
                                {ev.gap_type&&<span style={{fontSize:11,background:"#FEE2E2",color:"#B91C1C",borderRadius:6,padding:"2px 7px",fontWeight:600}}>{gapTypeLabel(ev.gap_type)}</span>}
                              </div>
                              <MathText text={ev.gap} tag="div" style={{fontSize:13.5,color:"#7F1D1D",lineHeight:1.6,fontWeight:500}}/>
                            </div>
                          ):ev.gap_type==="갭없음"&&(
                            <div style={{padding:"8px 12px",background:"#F0FFF8",border:"1.5px solid #A7F3D0",borderRadius:10,fontSize:13,color:"#065F46"}}>
                              {T("갭 없음 — 핵심을 완전히 잡았어 👍","No gap — you nailed the core 👍")}
                            </div>
                          )}
                          {/* DEPTH 게이지 */}
                          <DepthGauge depth={ev.depth} lang={CFG.lang}/>
                          {/* NEXT */}
                          {ev.next&&ev.gap_type!=="갭없음"&&(
                            <div style={{background:"#FFFDF8",border:"1.5px solid var(--line)",borderRadius:10,padding:"8px 12px"}}>
                              <div style={{fontSize:10,fontWeight:700,color:"var(--sub)",letterSpacing:".5px",marginBottom:3}}>{T("다음에 보강할 것","What to work on next")}</div>
                              <MathText text={ev.next} tag="div" style={{fontSize:13,color:"var(--ink)",lineHeight:1.55}}/>
                            </div>
                          )}
                        </>
                      )}
                      <button className="btn gho sm" style={{alignSelf:"flex-end",marginTop:4}} onClick={()=>setLeftPage(1)}>{T("모범 답안 펼쳐보기 ›","See model answer ›")}</button>
                    </>
                  )}

                  {/* ── Page 1: 해설 ── */}
                  {leftPage===1&&(
                    <>
                      {followupHistory.length>0&&!followupSuccess&&(
                        <div style={{background:"#FFF6E9",border:"1px solid #FBE3B8",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#8A5A12",marginBottom:4}}>
                          {T("3회 시도 완료 — 모범답안으로 개념을 잡아봐 💡","3 tries done — grab the concept from the model answer 💡")}
                        </div>
                      )}
                      {/* 해설 텍스트 + 오버레이 하이라이트 캔버스 */}
                      <div style={{position:"relative",borderRadius:14}}>
                        <div className="blk" style={{margin:0}}>
                          <div className="bl">이렇게 답하면 완벽</div>
                          <MathText text={ev.model_answer}/>
                        </div>
                        {deeper&&<div className="blk deeper" style={{margin:0}}><div className="bl">더 풀어서</div><MathText text={deeper}/></div>}
                        {highlightActive&&<AnnotPad ref={annotPadRef} disabled={annotBusy} tool={annotTool}/>}
                      </div>
                      {!deeper&&<button className="btn gho sm" onClick={explainMore} disabled={deepBusy}>{deepBusy?"불러오는 중…":"더 풀어서 설명해줘"}</button>}

                      {/* 의문점 섹션 */}
                      <div className="annot-section">
                        {/* 하이라이트 토글 */}
                        <div className="annot-hl-bar">
                          <button className={"btn gho sm"+(highlightActive?" on":"")}
                            onClick={()=>{setHighlightActive(v=>!v);if(!annotOpen)setAnnotOpen(true);}}>
                            🖊 {highlightActive?T("하이라이트 중","Highlighting"):T("해설에 하이라이트","Highlight the explanation")}
                          </button>
                          {highlightActive&&<>
                            <button className={"btn gho xs"+(annotTool==="hl"?" on":"")} onClick={()=>setAnnotTool("hl")}>🟡</button>
                            <button className={"btn gho xs"+(annotTool==="pen"?" on":"")} onClick={()=>setAnnotTool("pen")}>🟢</button>
                            <button className={"btn gho xs"+(annotTool==="eraser"?" on":"")} onClick={()=>setAnnotTool("eraser")}>🧽</button>
                            <button className="btn gho xs" onClick={()=>annotPadRef.current?.clear()}>🗑️</button>
                            <span className="note" style={{fontSize:11}}>S펜·Pencil만 인식</span>
                          </>}
                        </div>

                        {/* 질문 영역 */}
                        <div className="annot-q-bar">
                          <span className="muted" style={{fontSize:12,fontWeight:600}}>질문</span>
                          <button className="btn gho xs" onClick={()=>{setAnnotQMode(m=>m==="pen"?"type":"pen");setAnnotQInk(false);}}>
                            {annotQMode==="pen"?T("⌨ 타이핑으로","⌨ Type instead"):T("✍ 손글씨로","✍ Handwrite")}
                          </button>
                        </div>
                        {annotQMode==="pen"
                          ?(<div style={{display:"flex",flexDirection:"column",gap:4}}>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:5}}>
                                <div style={{display:"flex",gap:4}}>
                                  <button className={"btn gho xs"+(annotQTool==="pen"?" on":"")} onClick={()=>setAnnotQTool("pen")}>✏️ 펜</button>
                                  <button className={"btn gho xs"+(annotQTool==="eraser"?" on":"")} onClick={()=>setAnnotQTool("eraser")}>🧽 지우개</button>
                                </div>
                                <div style={{display:"flex",gap:4}}>
                                  <button className="btn gho xs" onClick={()=>annotQPadRef.current?.undo()} disabled={annotBusy}>↩ 취소</button>
                                  <button className="btn gho xs" onClick={()=>annotQPadRef.current?.clear()} disabled={annotBusy}>🗑️ 전체</button>
                                </div>
                              </div>
                              <QuestionPad ref={annotQPadRef} disabled={annotBusy} tool={annotQTool} onInk={setAnnotQInk}/>
                            </div>)
                          :<textarea value={annotQ} onChange={e=>setAnnotQ(e.target.value)} disabled={annotBusy}
                              placeholder={T("모르는 게 뭔지 타이핑해봐","Type what you don't get")}
                              style={{width:"100%",minHeight:64,padding:"8px 10px",borderRadius:10,
                                border:"1.5px solid var(--line)",fontFamily:"'Noto Sans KR',sans-serif",
                                fontSize:13,resize:"none",outline:"none",background:"var(--bg)",color:"var(--ink)"}}/>
                        }
                        <button className="btn pri sm" onClick={()=>askAnnotation()}
                          disabled={annotBusy||(!highlightActive&&!annotQInk&&!annotQ.trim())}>
                          {annotBusy?T("답변 불러오는 중…","Getting answer…"):T("질문하기 →","Ask →")}
                        </button>
                        {annotAnswer&&<div className="annot-answer"><MathText text={annotAnswer} tag="div"/></div>}
                      </div>
                    </>
                  )}

                  <div className="nextrow">
                    <span className="nn">{v==="correct"?T("다음 복습은 더 뒤로 미뤄둘게 👍","Next review pushed further out 👍"):T("넘어가기 전에 비슷한 문제로 굳혀볼래?","Lock it in with a similar question before moving on?")}</span>
                    <div style={{display:"flex",gap:8}}>
                      {v!=="correct"&&<button className="btn gho" onClick={retryVariant} title={T("같은 개념의 변형 문제(숫자·형태만 바뀜)로 다시 풀기","A variant (numbers/form changed) of the same concept")}>{T("🔁 비슷한 문제 풀래","🔁 Try a similar one")}</button>}
                      <button className="btn pri" onClick={()=>next(deck,null,true)}>{T("넘어가요 →","Next →")}</button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ── 오른쪽: 노트 캔버스 / 몰라요 강의 ── */}
            {isDeriving?(
              <div className="card notecol" style={{padding:14,display:"flex",flexDirection:"column",gap:10}}>
                {phase==="derive_load"&&(
                  <div style={{display:"flex",alignItems:"center",gap:10,padding:"20px 0"}}>
                    <div className="spinner" style={{width:20,height:20,borderWidth:2}}/>
                    <span className="muted" style={{fontSize:13}}>{T("유도 계획 세우는 중…","Planning the derivation…")}</span>
                  </div>
                )}
                {phase==="derive_step"&&(
                  <>
                    <PenPad ref={padRef} kind="answer" hideOcr penOnlyDefault={true} disabled={deriveChecking}/>
                    <textarea value={answer} onChange={e=>setAnswer(e.target.value)} disabled={deriveChecking}
                      placeholder={T("이 단계의 식을 텍스트로 써도 돼 (선택)","Type this step as text too (optional)")}
                      style={{width:"100%",minHeight:60,padding:"8px 10px",borderRadius:10,
                        border:"1.5px solid var(--line)",fontFamily:"'Noto Sans KR',sans-serif",
                        fontSize:13,resize:"vertical",outline:"none",background:"var(--bg)",color:"var(--ink)"}}/>
                    {submitErr&&<div className="err">{submitErr}</div>}
                    {deriveFeedback&&(
                      <div style={{background:"#FFF5F5",border:"1.5px solid #FECACA",borderRadius:11,padding:"10px 14px"}}>
                        <div style={{fontSize:10,fontWeight:700,color:"#DC2626",letterSpacing:".4px",marginBottom:4}}>피드백</div>
                        <MathText text={deriveFeedback} tag="div" style={{fontSize:13,color:"#7F1D1D",lineHeight:1.6}}/>
                      </div>
                    )}
                    {deriveHintShow&&derivePlan?.hints[deriveIdx]&&(
                      <div className="derive-hint">
                        <span style={{fontSize:11,fontWeight:700,display:"block",marginBottom:3}}>힌트</span>
                        <MathText text={derivePlan.hints[deriveIdx]} tag="span"/>
                      </div>
                    )}
                    <div className="row note-foot">
                      <button className="btn pri" onClick={submitDeriveStep} disabled={deriveChecking}>
                        {deriveChecking?T("확인 중…","Checking…"):T("이 단계 맞아? ✓","Is this step right? ✓")}
                      </button>
                      <button className="btn gho" onClick={()=>setDeriveHintShow(v=>!v)} disabled={deriveChecking}>
                        {deriveHintShow?T("힌트 숨기기","Hide hint"):T("막혔어요 💡","I'm stuck 💡")}
                      </button>
                    </div>
                  </>
                )}
                {phase==="derive_done"&&(
                  <div className="row" style={{padding:"20px 0",justifyContent:"center"}}>
                    <button className="btn pri" onClick={()=>next(deck,concept.id)}>{T("다시 도전 →","Try again →")}</button>
                    <button className="btn gho" onClick={()=>next(deck,null,true)}>{T("넘어가요 →","Next →")}</button>
                  </div>
                )}
              </div>
            ):phase==="dontknow"?(
              <div className="card notecol" style={{padding:20,display:"flex",flexDirection:"column",gap:14,overflowY:"auto",maxHeight:"calc(100vh - 280px)"}}>
                <div style={{display:"flex",alignItems:"center",gap:12,paddingBottom:10,borderBottom:"1.5px solid var(--line)"}}>
                  <span style={{fontSize:26,lineHeight:1}}>📖</span>
                  <div>
                    <div style={{fontFamily:"'Jua',sans-serif",fontSize:17,color:"var(--ink)",lineHeight:1.3}}>{T("이 개념 먼저 잡아보자","Let's nail this concept first")}</div>
                    <div style={{fontSize:12,color:"var(--sub)",marginTop:3}}>{concept?.name}</div>
                  </div>
                </div>
                {dontknowBusy&&(
                  <div style={{display:"flex",gap:10,alignItems:"center",padding:"12px 0"}}><div className="spinner" style={{width:22,height:22,borderWidth:2.5}}/><span className="muted" style={{fontSize:13}}>{T("설명 불러오는 중…","Loading explanation…")}</span></div>
                )}
                {!dontknowBusy&&dontknow&&(
                  <>
                    <div style={{position:"relative",borderRadius:16}}>
                      <div style={{background:"var(--pri-s)",border:"1.5px solid #C8C2F0",borderRadius:16,padding:"18px 20px"}}>
                        <div style={{fontFamily:"'Jua',sans-serif",fontSize:11,letterSpacing:".6px",color:"var(--pri)",marginBottom:12,display:"flex",alignItems:"center",gap:5}}>
                          <span style={{width:6,height:6,borderRadius:"50%",background:"var(--pri)",display:"inline-block"}}/>{T("개념 설명","Concept explainer")}
                        </div>
                        <MathText text={dontknow} tag="div" style={{fontSize:14.5,lineHeight:2.1,color:"var(--ink)"}}/>
                      </div>
                      {highlightActive&&<AnnotPad ref={annotPadRef} disabled={annotBusy} tool={annotTool}/>}
                    </div>
                    <div className="annot-section">
                      <div className="annot-hl-bar">
                        <button className={"btn gho sm"+(highlightActive?" on":"")}
                          onClick={()=>setHighlightActive(v=>!v)}>
                          🖊 {highlightActive?T("하이라이트 중","Highlighting"):T("해설에 하이라이트","Highlight the explanation")}
                        </button>
                        {highlightActive&&<>
                          <button className={"btn gho xs"+(annotTool==="hl"?" on":"")} onClick={()=>setAnnotTool("hl")}>🟡</button>
                          <button className={"btn gho xs"+(annotTool==="pen"?" on":"")} onClick={()=>setAnnotTool("pen")}>🟢</button>
                          <button className={"btn gho xs"+(annotTool==="eraser"?" on":"")} onClick={()=>setAnnotTool("eraser")}>🧽</button>
                          <button className="btn gho xs" onClick={()=>annotPadRef.current?.clear()}>🗑️</button>
                          <span className="note" style={{fontSize:11}}>S펜·Pencil만 인식</span>
                        </>}
                      </div>
                      <div className="annot-q-bar">
                        <span className="muted" style={{fontSize:12,fontWeight:600}}>질문</span>
                        <button className="btn gho xs" onClick={()=>{setAnnotQMode(m=>m==="pen"?"type":"pen");setAnnotQInk(false);}}>
                          {annotQMode==="pen"?"⌨ 타이핑으로":"✍ 손글씨로"}
                        </button>
                      </div>
                      {annotQMode==="pen"
                        ?(<div style={{display:"flex",flexDirection:"column",gap:4}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:5}}>
                              <div style={{display:"flex",gap:4}}>
                                <button className={"btn gho xs"+(annotQTool==="pen"?" on":"")} onClick={()=>setAnnotQTool("pen")} disabled={annotBusy}>✏️ 펜</button>
                                <button className={"btn gho xs"+(annotQTool==="eraser"?" on":"")} onClick={()=>setAnnotQTool("eraser")} disabled={annotBusy}>🧽 지우개</button>
                              </div>
                              <div style={{display:"flex",gap:4}}>
                                <button className="btn gho xs" onClick={()=>annotQPadRef.current?.undo()} disabled={annotBusy}>↩ 취소</button>
                                <button className="btn gho xs" onClick={()=>annotQPadRef.current?.clear()} disabled={annotBusy}>🗑️ 전체</button>
                              </div>
                            </div>
                            <QuestionPad ref={annotQPadRef} disabled={annotBusy} tool={annotQTool} onInk={setAnnotQInk}/>
                          </div>)
                        :<textarea value={annotQ} onChange={e=>setAnnotQ(e.target.value)} disabled={annotBusy}
                            placeholder={T("모르는 게 뭔지 타이핑해봐","Type what you don't get")}
                            style={{width:"100%",minHeight:64,padding:"8px 10px",borderRadius:10,
                              border:"1.5px solid var(--line)",fontFamily:"'Noto Sans KR',sans-serif",
                              fontSize:13,resize:"none",outline:"none",background:"var(--bg)",color:"var(--ink)"}}/>
                      }
                      <button className="btn pri sm" onClick={()=>askAnnotation(dontknow)}
                        disabled={annotBusy||(!highlightActive&&!annotQInk&&!annotQ.trim())}>
                        {annotBusy?"답변 불러오는 중…":"질문하기 →"}
                      </button>
                      {annotAnswer&&<div className="annot-answer"><MathText text={annotAnswer} tag="div"/></div>}
                    </div>
                  </>
                )}
                {!dontknowBusy&&(
                  <div className="row" style={{marginTop:6}}>
                    <button className="btn pri" onClick={()=>next(deck,concept.id)}>{T("다시 도전 →","Try again →")}</button>
                    <button className="btn gho" onClick={()=>next(deck,null,true)}>{T("넘어가요 →","Next →")}</button>
                  </div>
                )}
              </div>
            ):(
              <div className="card notecol" style={{padding:14,display:"flex",flexDirection:"column",gap:10}}>
                {(phase==="grading"||followupBusy)&&(
                  <div style={{display:"flex",flexDirection:"column",gap:7,padding:"4px 0 6px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontSize:13,fontWeight:600,color:gradeProg>=100?"var(--mint)":"var(--pri-d)"}}>
                        🧠 {gradeProg<40?T("답안 읽는 중…","Reading your answer…"):gradeProg<75?T("개념이랑 비교하는 중…","Comparing with the concept…"):gradeProg>=100?T("완료!","Done!"):T("피드백 정리하는 중…","Writing feedback…")}
                      </span>
                      <span style={{fontSize:14,fontWeight:700,color:gradeProg>=100?"var(--mint)":"var(--pri-d)"}}>{gradeProg}%</span>
                    </div>
                    <div style={{height:10,borderRadius:8,background:"#F0EDFA",overflow:"hidden"}}>
                      <div style={{height:"100%",borderRadius:8,
                        background:gradeProg>=100?"var(--mint)":"linear-gradient(90deg,var(--pri),var(--mint))",
                        width:gradeProg+"%",transition:"width .3s ease"}}/>
                    </div>
                  </div>
                )}
                {inputMode==="note"?(<>
                <PenPad ref={padRef} kind="answer" hideOcr penOnlyDefault={true} disabled={phase==="grading"||followupBusy}
                  onTypeMode={()=>setInputMode("type")}
                  highlights={phase==="answering"?ocrHighlights:null} highlightSize={ocrImgSize}/>
                {phase==="answering"&&ocrHighlights.length>0&&(
                  <div style={{background:"#FFF5F5",border:"1.5px solid #FECACA",borderRadius:11,padding:"10px 12px",display:"flex",flexDirection:"column",gap:8}}>
                    <div style={{fontSize:12.5,color:"#7F1D1D",lineHeight:1.6}}>
                      {T(<><b style={{color:"var(--rose)"}}>빨간 박스 ❓</b> 부분이 잘 안 읽혔어. <b>🧽 지우개</b>로 그 부분만 지우고 <b>✏️ 펜</b>으로 또렷하게 다시 써줄래? (지금 지우개로 바꿔놨어. 박스가 안 보이면 다른 장에 있을 수 있어 — 장을 넘겨봐)</>,<>The <b style={{color:"var(--rose)"}}>red box ❓</b> parts were hard to read. Erase just those with the <b>🧽 eraser</b> and rewrite them clearly with the <b>✏️ pen</b>. (Switched to eraser for you. If you don't see a box, it may be on another page — flip pages)</>)}
                    </div>
                    <button className="btn gho sm" style={{alignSelf:"flex-start"}} onClick={()=>submit(true)} disabled={phase==="grading"}>
                      {T("이대로 그냥 제출 →","Submit as is →")}
                    </button>
                  </div>
                )}
                {phase==="result"&&<p className="hint" style={{margin:"2px 0 0",fontSize:12}}>{T("✏️ 빨간 펜으로 보완해봐","✏️ Add corrections in red pen")}</p>}
                {phase!=="result"&&(
                  <textarea
                    value={answer}
                    onChange={e=>setAnswer(e.target.value)}
                    disabled={phase==="grading"||followupBusy}
                    placeholder={tr("텍스트로도 답할 수 있어 (선택사항)","You can also answer in text (optional)")}
                    style={{width:"100%",minHeight:72,padding:"8px 10px",borderRadius:10,
                      border:"1.5px solid var(--line)",fontFamily:"'Noto Sans KR',sans-serif",
                      fontSize:13,resize:"vertical",outline:"none",background:"var(--bg)",color:"var(--ink)"}}
                  />
                )}
                </>):(<>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                  <span style={{fontSize:12.5,fontWeight:600,color:"var(--pri-d)"}}>⌨️ {tr("타이핑 답안지","Typing sheet")}</span>
                  <button className="btn gho xs" onClick={()=>setInputMode("note")} disabled={phase==="grading"||followupBusy}
                    title={tr("손글씨 노트로 돌아가기","Back to handwriting note")}>✍️ {tr("노트로","Note")}</button>
                </div>
                <textarea
                  value={answer}
                  onChange={e=>setAnswer(e.target.value)}
                  disabled={phase==="grading"}
                  placeholder={tr("여기에 답을 타이핑해","Type your answer here")}
                  style={{width:"100%",flex:1,minHeight:"calc(100vh - 240px)",padding:"14px 16px",borderRadius:14,
                    border:"1.5px solid var(--line)",fontFamily:"'Noto Sans KR',sans-serif",
                    fontSize:15,lineHeight:1.8,resize:"vertical",outline:"none",background:"#FFFDF8",color:"var(--ink)"}}
                />
                </>)}
                {phase==="answering"&&(
                  <>
                    {concept?.deriveMode==="derive"&&(
                      <button className="btn gho sm" style={{borderColor:"var(--pri)",color:"var(--pri-d)"}}
                        onClick={startDerive}>{T("✏️ 직접 유도해볼게","✏️ Derive it myself")}</button>
                    )}
                    {q?.source==="기출"&&(
                      <button className="btn gho sm" style={{alignSelf:"flex-start",borderColor:"var(--pri)",color:"var(--pri-d)"}}
                        onClick={retryVariant} disabled={phase==="grading"}
                        title={T("기출은 이미 아니까 숫자·상황만 바꾼 변형문제로 바로 풀기","Already know this past exam — jump straight to a variant (numbers/situation changed)")}>
                        {T("🔄 변형문제로 바로 풀래","🔄 Jump to a variant")}</button>
                    )}
                    {submitErr&&<div className="err">{submitErr}</div>}
                    {/* 교수 캐릭터 도움 말풍선 ('여기가 내 한계야') */}
                    {(limitBusy||limitHelp)&&(
                      <div style={{display:"flex",gap:9,alignItems:"flex-start",background:"#FFF9EC",
                        border:"1.5px solid #FFE3A3",borderRadius:14,padding:"11px 13px",margin:"2px 0"}}>
                        <div style={{flexShrink:0,marginTop:-2}}><Prof size={40}/></div>
                        <div style={{minWidth:0,flex:1}}>
                          <div style={{fontSize:10.5,fontWeight:700,color:"#946200",letterSpacing:".3px",marginBottom:3}}>{T("니가교수의 도움","Prof's nudge")}</div>
                          {limitBusy
                            ?<div style={{display:"flex",alignItems:"center",gap:8,color:"#946200",fontSize:12.5}}>
                                <span className="spinner" style={{width:13,height:13,borderWidth:2}}/>{T("네 답을 보는 중…","Reading your answer…")}</div>
                            :<MathText text={limitHelp} tag="div" style={{fontSize:13.5,color:"#5B4600",lineHeight:1.7}}/>}
                          {limitHelp&&!limitBusy&&<div style={{fontSize:11,color:"#946200",marginTop:6}}>{T("힌트 보고 이어서 써봐 — 다 쓰면 '📖 제출·해설 보기'","Use the nudge, keep writing — then '📖 Submit & see explanation'")}</div>}
                        </div>
                      </div>
                    )}
                    <div className="row note-foot">
                      <button className="btn pri" onClick={()=>submit()} disabled={phase==="grading"||limitBusy}
                        title={T("내 답을 채점하고 해설을 봐 (끝내는 길)","Grade my answer and see the explanation (the finishing path)")}>{T("📖 제출·해설 보기","📖 Submit & see explanation")}</button>
                      <button className="btn gho" onClick={handleLimit} disabled={phase==="grading"||limitBusy}
                        style={{borderColor:"#FFC24B",color:"#946200"}}
                        title={T("쓰다 막혔을 때 — 교수님이 정답 대신 살짝 도와줘 (레벨 안 깎임)","Stuck mid-answer — Prof nudges you without giving the answer (level kept)")}>
                        {limitBusy?T("도와주는 중…","Helping…"):T("🙋 여기가 내 한계야","🙋 I'm stuck here")}</button>
                      <button className="btn gho" onClick={handleDontKnow} disabled={phase==="grading"||limitBusy}>{T("모르겠어 😅","Don't know 😅")}</button>
                      <button className="btn gho" onClick={skipConcept} disabled={phase==="grading"||limitBusy} title={T("이 개념은 오늘 패스 (레벨 안 깎임)","Skip this concept today (level kept)")}>{T("패스 ⏭️","Skip ⏭️")}</button>
                    </div>
                  </>
                )}
                {phase==="followup"&&(
                  <>
                    {submitErr&&<div className="err">{submitErr}</div>}
                    <div className="row note-foot">
                      <button className="btn pri" onClick={submitFollowup} disabled={followupBusy}>
                        {followupBusy?T("채점 중…","Grading…"):T("보충 답변 제출 ✓","Submit follow-up ✓")}
                      </button>
                      <button className="btn gho" onClick={()=>{
                        const uc=schedule(concept,ev?.verdict||"incorrect");
                        persist({...deckRef.current,concepts:deckRef.current.concepts.map(c=>c.id===concept.id?uc:c)});
                        setConcept(uc);setCount(n=>n+1);setPhase("result");setLeftPage(1);
                      }} disabled={followupBusy}>{T("모범답안 볼게","Show answer")}</button>
                    </div>
                  </>
                )}
              </div>
            )}

          </div>
        )}
      </div>
    </section>
  );
}

/* ── SVG 살균 ── */

export { Study };
