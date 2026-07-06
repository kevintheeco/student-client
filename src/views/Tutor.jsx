import { CFG, LS, dk, tr } from "../core/platform.js";
import { Cheer } from "../ui/common.jsx";
import { DAY, INTERVALS } from "../core/srs.js";
import { MathText } from "../ui/math.jsx";
import { PenPad } from "../ui/pads.jsx";
import { callAI } from "../core/ai.js";
import React from "react";
const { useState, useEffect, useRef, useCallback } = React;

function Tutor({deck:initial,onExit,onPractice,onExam}){
  const [deck,setDeck]=useState(initial);
  const [concept,setConcept]=useState(null);
  const [turns,setTurns]=useState([]);          // {role, content(API), img?}
  const [busy,setBusy]=useState(false);
  const [control,setControl]=useState(null);    // ASK | NEXT | DONE | COPY | RECALL
  const [input,setInput]=useState("");
  const [penMode,setPenMode]=useState(true);   // 손글씨 우선 — 타이핑은 '✕ 텍스트로'
  const [hidePeek,setHidePeek]=useState(false);  // RECALL(백지 회상): 직전 교수님 말풍선 가리기
  const [err,setErr]=useState("");
  const [stream,setStream]=useState("");        // 스트리밍: 도착 중인 교수님 답(글자씩)
  const [options,setOptions]=useState([]);      // 교수님이 준 '탭해서 고르기' 보기(OPTIONS:)
  const [openU,setOpenU]=useState({});          // 책 모드 목차 트리: 펼친 대/중단원
  const [examOpen,setExamOpen]=useState(false); // 책 시험 빌더 표시
  const [examSel,setExamSel]=useState({});      // 시험 출제 대단원 선택 {u1:bool}
  const [examN,setExamN]=useState(10);          // 시험 문항 수
  const padRef=useRef(null);
  const sysRef=useRef("");
  const abortRef=useRef(null);
  const scrollRef=useRef(null);
  const concepts=deck.concepts||[];

  useEffect(()=>()=>abortRef.current?.abort(),[]);
  useEffect(()=>{const el=scrollRef.current;if(el)el.scrollTop=el.scrollHeight;},[turns,busy]);

  function tutorSystem(c){
    const sibPool=c.u1?concepts.filter(x=>x.u1===c.u1):concepts;   // 책이면 같은 대단원 내 개념을 이웃으로
    const sibs=sibPool.map(x=>x.name).filter(n=>n&&n!==c.name).slice(0,20).join(", ");
    const loc=c.u1?` 교재 위치: ${c.u1}${c.u2?" > "+c.u2:""} > ${c.name}.`:"";
    const mat=c.src?(""+c.src).slice(0,1400):(deck.summary||deck.material||"").slice(0,4000);
    const matLabel=c.src?"교재에서 이 개념에 해당하는 핵심 내용":"학생이 올린 강의자료 발췌";
    return `너는 학생의 1:1 개인 과외 교수다(학생은 너를 '교수님'이라 부른다). **답변에서 너 자신을 가리킬 땐 절대 '선생님'이라고 쓰지 말고 '교수님' 또는 '나'라고 해라.** 지금 학생이 고른 개념은 "${c.name}"이고, "${deck.name}" ${c.src?"교재":"자료"}의 일부다.${loc}`+
(sibs?` 같은 단원의 다른 개념들: ${sibs}.`:"")+
(mat?`\n\n[참고 — ${matLabel}. 이 내용에 뿌리내려 설명하고, 부족하면 일반 지식으로 보충하되 자료와 어긋나지 마라]\n${mat}\n`:"")+
`

학생은 공식을 그냥 외우기보다 "왜 그렇게 되는지"를 이해해야 문제를 푸는 사람이다. 가장 중요한 목표는 "학생이 스스로 문제를 풀 수 있는 골격을 잡아주는 것"이다. 답을 빨리 주는 것보다 개념의 흐름과 문제풀이 루틴을 만들어주는 게 중요하다. 설명은 한국어로 하되, 필요한 영어 용어는 괄호로 같이 알려줘라. 예: 확률수렴(convergence in probability), 일치추정량(consistent estimator).

# 진행 방식 (가이드형 플립러닝)
한 번에 다 쏟아붓지 말고 단계별로 끊어서 학생과 주고받아라. 한 번의 답변엔 한 단계(또는 그 일부)만 담고, 학생이 따라왔는지 확인한 뒤 넘어가라. 항상 이 4단계 흐름을 따른다.
1단계 — 큰 질문: 이 개념이 속한 단원의 큰 질문을 한 문장으로 던져라.
2단계 — 핵심 쪼개기: 이 개념을 두세 조각의 한 줄 의미로 압축해라. (예: LLN=어디로 가는가 / CLT=어떻게 흔들리는가)
3단계 — 층층 설명 + 능동 과제: ①말로 된 직관 → ②아주 쉬운 숫자 예시 → ③원래 개념/문제의 수식 적용. 수식은 공식부터 던지지 말고 먼저 말로 번역한 뒤 보여주고, 기호를 하나씩 해석해라. **각 층을 설명한 직후 반드시 학생을 직접 손으로 쓰게 시켜라**: 공식을 보여줬으면 "따라 써봐"(COPY), 적용을 배웠으면 "이 문제 직접 풀어봐"(ASK), 네 말로 설명해보라 할 때도 ASK. (백지회상 RECALL은 아무 층에서나 쓰지 말고 아래 '★ 백지 가리기 타이밍' 규칙을 따른다.) 학생이 쓴 걸 받으면 막힌 지점·빠뜨린 기호를 콕 집어 교정한 뒤 다음으로.
4단계 — 시험용 루틴: 시험장에서 바로 쓸 한 줄 판단 루틴으로 정리해라. (예: "plim·consistent 나오면 Slutsky, asymptotic variance 나오면 Delta Method.")

# 답변 끝 제어 신호 (매우 중요)
매 답변의 맨 마지막 줄에, 학생이 다음에 뭘 할지 알려주는 신호를 정확히 하나 붙여라. 이 줄은 학생에게 안 보이니 부가설명 없이 형식 그대로만:
· CONTROL: COPY   — 방금 보여준 공식·식·문장을 학생에게 "직접 따라 써봐"라고 시켰을 때
· CONTROL: RECALL — 백지 회상을 시켰을 때("안 보고 떠올려 적어봐"). 단, 아래 '★ 백지 가리기 타이밍' 조건이 맞을 때만 쓴다(아무 때나 X).
· CONTROL: ASK    — 그 외 직접 풀어보거나 네 말로 설명해보라고 시켰을 때
· CONTROL: NEXT   — 시킬 게 정말 없는 짧은 도입·전환일 때만(아껴 써라)
· CONTROL: DONE   — 4단계를 다 마치고 마지막 정리까지 끝냈을 때

# 탭해서 고르기 (OPTIONS) — 손으로 안 쓰고 누르게
학생이 '고르기'만 하면 되는 질문을 할 땐, 답변 끝(CONTROL 줄 바로 위 줄)에 보기를 이 형식으로 붙여라:
OPTIONS: 보기1 | 보기2 | 보기3
보기 구분은 반드시 양옆에 공백을 둔 ' | '(스페이스+막대+스페이스)로만 한다. 보기 안 수식에서 절댓값·조건부확률의 세로막대는 구분자와 헷갈리니 |…| 대신 \lvert…\rvert, P(A\mid B) 처럼 LaTeX 명령으로 써라(맨 | 금지). 수식은 항상 $…$로 감싸라.
그러면 학생이 손글씨 대신 버튼으로 탭해 고른다. 보기는 2~4개, 각각 한 구절로 짧게.
**★ 절대 규칙: 답이 정해진 몇 개(특히 2개) 중 하나로 갈리는 질문은 산문으로만 묻지 말고 반드시 OPTIONS를 붙여라.** 여기 해당:
- 양자택일("A 편이야, 아니면 B 편이야?", "~하는 게 맞을까 아니면 ~일까?") → 그 두 갈래를 그대로 보기로.
- 이해 점검("느낌으로 와? 아직 헷갈려?", "이해됐어?", "감 잡혔어?") → OPTIONS: 느낌 와! | 아직 헷갈려  (또는 예/아니오에 맞는 짧은 말)
- 예/아니오, "맞을까 틀릴까", "어디서 막혔어?", "둘 중 뭐야?" 등.
예: 질문이 "확률수렴과 분포수렴이 다르다는 게 느낌으로 와, 아니면 섞여서 헷갈려?"라면 → 맨 끝 줄에 OPTIONS: 느낌 와! | 아직 헷갈려 를 붙인다.
단, **학생이 직접 써야 의미 있는 과제(COPY 따라쓰기·RECALL 백지회상·풀이/유도 ASK)에는 OPTIONS를 절대 붙이지 마라** — 그땐 손으로 쓰게 둬라.

**핵심 원칙: 설명만 하고 그냥 넘어가지 마라.** 핵심 조각 하나를 설명할 때마다 COPY/RECALL/ASK 중 하나로 학생이 직접 손으로 쓰게 시켜라(=새 내용을 설명한 답변은 대부분 이 셋 중 하나로 끝난다).

**★ 피드백 먼저, 새 과제는 그 다음 (절대 규칙).** 학생이 방금 과제 답(쓰기·말·손글씨)을 제출한 직후의 답변은 **반드시 그 답에 대한 구체적 피드백으로 시작**해라 — 무엇이 맞았고, 어디가 틀렸고, 어떤 기호·단계를 빠뜨렸는지 콕 집어서. **★ 정직하게 채점해라(가장 중요).** 학생이 쓴 걸 실제로 읽고, 답이나 흐름이 틀렸으면 **절대 "맞다"고 하지 마라 — 틀린 답을 맞다고 인정하는 것이 이 과외에서 가장 큰 잘못이다.** 손글씨 이미지는 글자·수식을 있는 그대로 판독해서 채점하고(예쁘게 봐주지 마라), 흐릿해서 안 읽히면 추측으로 맞다고 넘기지 말고 "이 부분이 안 읽혀, 다시 또렷하게 써줄래?"라고 해라. 친절한 건 톤이지 채점이 아니다 — 틀린 건 분명히 틀렸다고 짚고 어디가 왜 틀렸는지 고쳐줘라. **피드백을 건너뛰고 곧장 새 과제(특히 백지회상 RECALL)로 점프하는 것은 금지.** "학생 답 무시 + 새 과제만"인 답변은 절대 만들지 마라. 예: 학생이 'ASK(네 말로 설명해봐)'에 답했으면 → 그 설명을 짚어 교정·보강(이때 CONTROL은 보통 ASK나 NEXT). 학생이 충분히 이해했다고 보일 때에만 다음 단계나 새 과제로 넘어가라(아직 막혀 있으면 같은 지점을 다시 시켜라). **★ 백지 가리기(RECALL) 타이밍 — 이 조건이 모두 맞을 때만 써라.** ①직전에 중요한 공식·핵심 개념이 나왔고 ②학생이 그걸 잘 이해 못 해 막혔거나 다시 설명해 달라고 했고 ③네가 다시 설명해줬고 ④학생이 "이해했어/다음으로 넘어가자"고 할 때 — 즉 **어렵게 넘긴 개념을 통과시키기 직전에 백지로 점검**하는 것이다(바로 다음 단계로 넘기기 전에). 이때 RECALL 메시지 안에 **무엇을 떠올려 쓸지 한 줄로 짚어줘라**(예: "좋아, 넘어가기 전에 방금 그 ___ 공식을 안 보고 떠올려 써봐") — 그 메시지는 화면에서 가려지니 학생이 기억으로 써야 한다. 그 외(처음 설명한 직후, 학생이 안 막혔을 때, 사소한 내용, 학생이 막 답을 제출한 직후)에는 RECALL을 쓰지 말고 COPY·ASK를 쓰거나 그냥 다음으로 가라. 피드백 단계를 건너뛰면서까지 RECALL하지 마라. 또한 과제가 학생 수준에 비해 너무 쉬우면 굳이 반복시키지 말고, 학생이 "넘어갈게/안 쓸게/이미 알아"라고 하면 그건 답 제출이 아니니 억지로 채점·재시도시키지 말고 가볍게 인정한 뒤 바로 다음 단계로 가라.

# 학생을 대하는 방식
- "전혀 모르겠다/노베이스다/따로 논다"고 하면 추상적 설명을 반복하지 말고 어디서 끊겼는지부터 찾아 그 지점부터 다시. (예: "좋아, 네가 막힌 지점은 정확히 g가 갑자기 튀어나온 거야.")
- 학생이 쓴 답(텍스트/손글씨 이미지)을 받으면: 맞았으면 어디가 좋았는지 짚고, 틀렸거나 비었으면 어디서 막혔는지 정확히 짚은 뒤 그 지점부터 다시. 그냥 정답만 던지지 마라.
- 헷갈려하면 ①헷갈린 식 다시 써주기 ②말로 번역 ③아주 쉬운 숫자 예시 ④원래 문제로 돌아와 적용 ⑤시험용 한 줄 정리.
- 외워야 할 것과 이해해야 할 것을 구분해줘라("이건 이해보다 암기에 가까우니 외워도 돼").
- 말투는 친절·차분하되 과한 칭찬·감정적 위로 없이 과외하듯 정확히 이끌어라. "좋아, 지금 막힌 지점은 여기야", "복잡해 보여도 구조는 하나야", "시험장에선 이렇게 판단하면 돼" 톤. "답만/간단히"면 핵심만, "자세히/이해 안 돼"면 단계별로 길게.

# 수식·표기
수식은 LaTeX로(인라인 $...$, 디스플레이 $$...$$), 한 줄씩 나누고 중간 계산(분산·표준화·미분)을 생략하지 마라. **수식 기호는 반드시 짝을 맞춰 닫아라 — 여는 $ 또는 $$ 를 닫지 않고 남기면 화면에 날것 LaTeX($s^2=...)가 그대로 깨져 보인다.** 인라인 $…$ 는 한 줄 안에서 열고 닫고(줄을 넘기지 마라), 여러 줄·행렬·긴 식은 $$…$$ 로 써라. 필요하면 마크다운 표를 써라. 함수 그래프(다항·지수·로그·삼각·이차곡선)와 좌표 도형·벡터 다이어그램(내적·투영·각 표시)은 \`\`\`mathviz 코드블록의 장면 스크립트 JSON으로 그려라 — 학생이 단계별로 넘겨보는 애니메이션 그래프가 된다. 예: \`\`\`mathviz
{"version":1,"theme":"algebra","view":{"x":[-4,4],"y":[-3,3]},"steps":[{"type":"axes","ticks":1},{"type":"plot","id":"f","expr":"sin(x)","domain":[-4,4],"color":"accent"},{"type":"extrema","of":"f"},{"type":"pill","text":"극값은 미분=0에서"}]}
\`\`\` 벡터·각은 {"type":"vector","from":[0,0],"to":[3,2],"label":"\\\\vec{b}"} 와 {"type":"angle","at":[0,0],"from":[4,0],"to":[3,2],"label":"θ"} 스텝으로(화살촉·각도 호를 렌더러가 정확히 그림 — 축 불필요하면 axes 생략). expr는 사칙·^·sin·cos·tan·exp·log·ln·sqrt·abs·pi·e·x만. 교점·절편·극점 좌표를 직접 쓰지 말고 intercepts/intersections/extrema 스텝으로 자동 계산. 층층 설명의 각 층에서 그래프가 도움되면 아끼지 마라. 함수식이 아닌 개념 도식만 라벨 있는 인라인 SVG로 — 이때 색은 앱 팔레트만(#6C5CE7 주색·#221C39 글자·배경 #FFFDF8, 원색 red/green/blue 금지), <text>에 유니코드 조합문자(b⃗의 ⃗) 절대 금지(깨져 보임).

위 예시들(LLN/CLT/Slutsky/Delta 등)은 '가르치는 방식'의 본보기일 뿐이다. 실제 내용은 학생이 고른 개념 "${c.name}"과 위 자료에 맞춰라. 지금부터 학생과 주고받으며 과외를 시작해라.`;
  }

  // 스트리밍 표시용: 끝의 CONTROL 신호는 화면에 안 보이게 떼고 보여줌
  const stripCtrl=s=>s.replace(/\n*(CONTROL:|OPTIONS:)[\s\S]*$/i,"").trimEnd();
  // 스트리밍 중 아직 안 닫힌 마지막 수식($···, $$···)은 날 LaTeX로 깨져 보임 → 닫히기 전까진 빼고 표시(완성되면 나타남)
  function trimOpenMath(s){
    let cut=s.length,i=0;
    while(i<s.length){
      if(s[i]==="\\"&&s[i+1]==="$"){i+=2;continue;}        // 통화 \$ 는 수식 아님
      if(s[i]==="$"&&s[i+1]==="$"){                          // 디스플레이 $$..$$
        const c=s.indexOf("$$",i+2);
        if(c<0){cut=i;break;}                                // 안 닫힘 → 여기부터 숨김
        i=c+2;continue;
      }
      if(s[i]==="$"){                                        // 인라인 $..$
        const c=s.indexOf("$",i+1);
        if(c<0){cut=i;break;}                                // 안 닫힘
        i=c+1;continue;
      }
      i++;
    }
    return cut<s.length?s.slice(0,cut).trimEnd():s;
  }

  async function turn(userTurn,base){
    const next=[...(base!==undefined?base:turns),userTurn];
    setTurns(next);setBusy(true);setControl(null);setErr("");setHidePeek(false);
    setStream("");setOptions([]);
    const ctrl=new AbortController();abortRef.current=ctrl;
    try{
      const reply=await callAI(sysRef.current,"",false,
        {maxTok:2000,cache:true,model:CFG.model,messages:next.map(t=>({role:t.role,content:t.content})),
         onDelta:full=>setStream(trimOpenMath(stripCtrl(full)))},ctrl.signal);
      setStream("");
      const sig=(reply.match(/CONTROL:\s*(ASK|NEXT|DONE|COPY|RECALL)/i)||[])[1];
      const clean=stripCtrl(reply).replace(/\n+$/,"").trim();
      setTurns(t=>[...t,{role:"assistant",content:clean}]);
      const c=(sig||"NEXT").toUpperCase();setControl(c);
      // '탭해서 고르기' 보기 — 직접 써야 하는 과제(COPY/RECALL)엔 무시
      const om=reply.match(/OPTIONS:\s*([^\n]+)/i);
      // 분리자는 양옆 공백 있는 ' | '만 — LaTeX 절댓값 |x|·조건부확률 P(A|B)이 쪼개지지 않게
      setOptions((c==="COPY"||c==="RECALL"||!om)?[]:om[1].split(/\s+\|\s+/).map(s=>s.trim()).filter(Boolean).slice(0,4));
      // 손글씨로 직접 쓰는 게 핵심 → 매 턴 손글씨 패드를 기본으로 펼침(타이핑은 '✕ 텍스트로'). RECALL은 직전 설명을 가려 '백지'로.
      setPenMode(true);
      setHidePeek(c==="RECALL");
      if(c==="DONE")markTaught();
    }catch(e){setStream("");if(e.name!=="AbortError")setErr(e.message||tr("오류가 났어. 다시 시도해줘.","Something went wrong. Try again."));}
    setBusy(false);
  }

  function start(c){
    abortRef.current?.abort();
    setConcept(c);setTurns([]);setControl(null);setErr("");setInput("");setPenMode(true);
    sysRef.current=tutorSystem(c);
    turn({role:"user",content:`'${c.name}' 개념 과외 시작해 주세요. 1단계 큰 질문부터 한 단계씩.`},[]);
  }
  // 책 시험: 선택한 대단원들의 src를 모아 문항 수 지정해 출제(Exam topic으로)
  function startBookExam(){
    if(!onExam)return;
    const picked=Object.keys(examSel).filter(k=>examSel[k]);
    const chosen=picked.length?concepts.filter(c=>picked.includes(c.u1||"본문")):concepts;
    if(!chosen.length){setErr(tr("출제할 단원을 골라줘.","Pick at least one unit."));return;}
    const src=chosen.map(c=>"["+(c.u1||"")+(c.u2?" > "+c.u2:"")+" / "+c.name+"]\n"+(c.src||c.name)).join("\n\n");
    const unitNames=[...new Set(chosen.map(c=>c.u1).filter(Boolean))];
    const n=Math.max(1,Math.min(40,Number(examN)||10));
    onExam({id:deck.id+"_be"+Date.now().toString(36),label:deck.name+" "+tr("시험","Exam"),src,count:n,unitNames});
  }
  // 학생이 '과제(ASK/COPY/RECALL)' 답을 막 냈을 때만, 모델에게 '피드백 먼저, 새 과제 점프 금지'를 숨겨서 상기시킨다(채팅엔 안 보임).
  function fbHint(){
    return (control==="ASK"||control==="COPY"||control==="RECALL")
      ? "\n\n[흐름 규칙(학생에겐 안 보임): 위는 학생이 방금 낸 과제 답이다. 이번 답변은 반드시 이 답에 대한 구체적 피드백—잘한 점·틀린 곳·빠뜨린 기호나 단계—부터 시작해라. 피드백을 건너뛰고 곧장 새 과제(특히 백지회상 RECALL)로 점프하지 마라. 학생이 그 부분을 이해했다고 보일 때만 다음 단계로 넘어가라.]"
      : "";
  }
  function sendText(){const t=input.trim();if(!t||busy)return;setInput("");const h=fbHint();turn(h?{role:"user",content:t+h,display:t}:{role:"user",content:t});}
  function sendOption(opt){if(busy||!opt)return;setOptions([]);turn({role:"user",content:opt});}
  function sendPen(){
    if(busy)return;
    const pad=padRef.current;
    if(!pad||!pad.hasStrokes()){setErr(tr("먼저 손글씨로 써줘.","Write something first."));return;}
    const b64=pad.getImageBase64();pad.clear();setPenMode(false);
    turn({role:"user",img:b64,content:[{type:"image",source:{type:"base64",media_type:"image/png",data:b64}},{type:"text",text:"(내가 손글씨로 쓴 답이야. 글자·식을 있는 그대로 읽고 맞았는지 틀렸는지 정직하게 판단해줘 — 안 읽히면 추측해서 맞다고 넘기지 말고 다시 써달라고 해.)"+fbHint()}]});
  }
  function quick(msg){if(busy)return;turn({role:"user",content:msg});}
  function markTaught(){
    if(!concept)return;
    const fresh=LS.get(dk(deck.id))||deck;
    const nd={...fresh,concepts:(fresh.concepts||[]).map(x=>{
      if(x.id!==concept.id)return x;
      // 개념 과외 완료 → 진도율 연동: box를 '복습(자리잡음)' 단계(3)까지 올림. 이미 더 높으면 유지(심화는 시험/퀴즈로).
      const box=Math.max(x.box||1,3);
      const days=INTERVALS[box]??1;
      return{...x,taughtAt:Date.now(),box,dueAt:Date.now()+days*DAY,reps:(x.reps||0)+1,lastResult:"taught",lastSeen:Date.now()};
    })};
    LS.set(dk(deck.id),nd);setDeck(nd);
  }

  // ── 개념 고르기 ──
  if(!concept)return(
    <section className="wrap">
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
        <button className="btn gho sm" onClick={onExit}>{tr("← 목록","← Back")}</button>
        <div style={{fontFamily:"'Jua',sans-serif",fontSize:17,color:"var(--ink)"}}>🎓 {tr("개념 과외","Tutor")} · {deck.name}</div>
      </div>
      <p className="hint" style={{marginBottom:14}}>{tr("개념을 하나 고르면, 교수님이 처음부터 1:1로 이해시켜줄게. 옆 🧠이해문제로 그 소단원만 풀 수도 있어. 시험은 위 버튼에서 단원을 골라 봐.","Pick a concept for 1:1 tutoring. Use 🧠 for that sub-topic's practice. Build a test from the button above.")}</p>
      {concepts.some(c=>c.u1)&&onExam&&(examOpen?(
        <div style={{border:"1.5px solid var(--pri)",borderRadius:14,padding:"14px 15px",marginBottom:12,background:"#FBFAFF",display:"flex",flexDirection:"column",gap:10}}>
          <div style={{fontWeight:800,color:"var(--pri-d)",fontSize:14}}>📝 {tr("시험 만들기","Build a test")}</div>
          <div style={{fontSize:12,color:"var(--sub)"}}>{tr("출제할 단원을 골라줘 (안 고르면 전체 범위)","Pick units to test (none = whole book)")}</div>
          <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:240,overflowY:"auto"}}>
            {[...new Set(concepts.map(c=>c.u1||"본문"))].map(u1=>{
              const cnt=concepts.filter(c=>(c.u1||"본문")===u1).length;
              return(
                <label key={u1} style={{display:"flex",alignItems:"center",gap:9,padding:"8px 10px",border:"1px solid var(--line)",borderRadius:10,cursor:"pointer",background:examSel[u1]?"var(--pri-s)":"#fff"}}>
                  <input type="checkbox" checked={!!examSel[u1]} onChange={e=>setExamSel(s=>({...s,[u1]:e.target.checked}))} style={{width:16,height:16,accentColor:"var(--pri)",flexShrink:0}}/>
                  <span style={{flex:1,minWidth:0,fontSize:13,fontWeight:600}}><MathText text={u1} tag="span"/></span>
                  <span style={{fontSize:11,color:"var(--sub)",flexShrink:0}}>{cnt}{tr("개","")}</span>
                </label>
              );
            })}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:13,fontWeight:600}}>{tr("문항 수","Questions")}</span>
            <input type="number" min="1" max="40" value={examN} onChange={e=>setExamN(e.target.value)} style={{width:72,padding:"7px 9px",border:"1.5px solid var(--line)",borderRadius:9,fontSize:14,outline:"none"}}/>
            <span style={{fontSize:11,color:"var(--sub)"}}>{tr("(1~40)","")}</span>
          </div>
          {err&&<div className="err" style={{fontSize:13}}>{err}</div>}
          <div style={{display:"flex",gap:8}}>
            <button className="btn pri" onClick={startBookExam}>📝 {tr("시험 시작","Start test")}</button>
            <button className="btn gho" onClick={()=>{setExamOpen(false);setErr("");}}>{tr("취소","Cancel")}</button>
          </div>
        </div>
      ):(
        <button className="btn gho" onClick={()=>setExamOpen(true)} style={{marginBottom:12,borderColor:"var(--pri)",color:"var(--pri-d)",fontWeight:700}}>📝 {tr("시험 보기 — 단원 골라 출제","Take a test — pick units")}</button>
      ))}
      <div style={{display:"flex",flexDirection:"column",gap:9}}>
        {concepts.length===0&&<div className="empty">{tr("이 자료엔 아직 개념이 없어.","No concepts in this material yet.")}</div>}
        {(()=>{
          const leaf=(c)=>(
            <div key={c.id} style={{display:"flex",gap:6,alignItems:"stretch"}}>
              <button className="card" onClick={()=>start(c)}
                style={{flex:1,minWidth:0,textAlign:"left",padding:"11px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:10,border:"1.5px solid var(--line)",background:"#FBFAFF"}}>
                <span style={{fontSize:16}}>{c.taughtAt?"✅":"🎓"}</span>
                <span style={{flex:1,minWidth:0,fontWeight:600,color:"var(--ink)"}}><MathText text={c.name} tag="span"/></span>
                {c.taughtAt&&<span style={{fontSize:11,color:"var(--sub)",flexShrink:0}}>{tr("배웠어","learned")}</span>}
              </button>
              {onPractice&&<button title={tr("이해 문제 풀이","Practice — understanding")} onClick={()=>onPractice(c.id,"explain")}
                style={{flexShrink:0,padding:"0 12px",fontSize:12.5,fontWeight:700,cursor:"pointer",border:"1.5px solid var(--pri)",color:"var(--pri-d)",borderRadius:11,background:"var(--pri-s)",whiteSpace:"nowrap"}}>🧠 {tr("이해문제","Practice")}</button>}
            </div>
          );
          if(!concepts.some(c=>c.u1))return concepts.map(leaf);   // 일반 덱: 평탄 목록
          // 책 덱: 대단원 > 중단원 > 개념 토글 트리
          const tree={};
          concepts.forEach(c=>{const a=c.u1||"본문",b=c.u2||"";(tree[a]=tree[a]||{});(tree[a][b]=tree[a][b]||[]).push(c);});
          const tg=k=>setOpenU(o=>({...o,[k]:!o[k]}));
          return Object.keys(tree).map(u1=>{
            const mids=tree[u1];
            const all=Object.keys(mids).reduce((a,k)=>a.concat(mids[k]),[]);
            const dn=all.filter(x=>x.taughtAt).length,open=openU[u1];
            return(
              <div key={u1} style={{border:"1.5px solid var(--line)",borderRadius:14,overflow:"hidden"}}>
                <button onClick={()=>tg(u1)} style={{width:"100%",textAlign:"left",padding:"13px 15px",cursor:"pointer",display:"flex",alignItems:"center",gap:10,background:"var(--pri-s)",border:"none"}}>
                  <span style={{fontSize:12,color:"var(--pri-d)"}}>{open?"▾":"▸"}</span>
                  <span style={{flex:1,fontWeight:800,color:"var(--pri-d)"}}><MathText text={u1} tag="span"/></span>
                  <span style={{fontSize:11,color:"var(--sub)",fontWeight:700}}>{dn}/{all.length}</span>
                </button>
                {open&&(
                  <div style={{padding:"8px 10px",display:"flex",flexDirection:"column",gap:7}}>
                    {Object.keys(mids).map(u2=>{
                      if(!u2)return mids[u2].map(leaf);
                      const cs=mids[u2],k=u1+"||"+u2,o2=openU[k],d2=cs.filter(x=>x.taughtAt).length;
                      return(
                        <div key={k} style={{border:"1px solid var(--line)",borderRadius:11,overflow:"hidden"}}>
                          <button onClick={()=>tg(k)} style={{width:"100%",textAlign:"left",padding:"10px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:9,background:"#FBFAFF",border:"none"}}>
                            <span style={{fontSize:11,color:"var(--sub)"}}>{o2?"▾":"▸"}</span>
                            <span style={{flex:1,fontWeight:700,color:"var(--ink)",fontSize:13.5}}><MathText text={u2} tag="span"/></span>
                            <span style={{fontSize:10.5,color:"var(--sub)"}}>{d2}/{cs.length}</span>
                          </button>
                          {o2&&<div style={{padding:"7px 9px",display:"flex",flexDirection:"column",gap:6}}>{cs.map(leaf)}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          });
        })()}
      </div>
    </section>
  );

  // ── 과외 세션 ──
  const shown=turns.filter(t=>!(t.role==="user"&&typeof t.content==="string"&&t.content.startsWith("'"+concept.name)));
  let lastAiIdx=-1;shown.forEach((t,i)=>{if(t.role==="assistant")lastAiIdx=i;});
  const TASK={
    COPY:{emo:"✍️",label:tr("따라 써보기","Copy it"),desc:tr("위 식을 안 보고도 쓰게, 직접 한 번 써봐 — 손이 기억해.","Write the formula above yourself.")},
    RECALL:{emo:"🧠",label:tr("백지 테스트","Blank-paper recall"),desc:tr("안 보고! 방금 이해한 걸 네 손으로 적어봐.","No peeking — write what you just understood.")},
    ASK:{emo:"✍️",label:tr("직접 해보기","Your turn"),desc:tr("배운 걸 직접 풀거나 네 말로 설명해봐.","Solve it / explain it in your own words.")}};
  const task=TASK[control];
  return(
    <section className="wrap" style={{display:"flex",flexDirection:"column",minHeight:"70vh"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
        <button className="btn gho sm" onClick={()=>{abortRef.current?.abort();setConcept(null);}}>{tr("← 개념","← Concepts")}</button>
        <div style={{flex:1,fontFamily:"'Jua',sans-serif",fontSize:15,color:"var(--ink)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}><MathText text={concept.name} tag="span"/></div>
        <button className="btn gho sm" onClick={onExit}>{tr("목록","Home")}</button>
      </div>

      <div ref={scrollRef} style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:12,padding:"6px 2px 14px"}}>
        {shown.map((t,i)=>(
          t.role==="assistant"?(
            (hidePeek&&i===lastAiIdx)?(
            <div key={i} style={{alignSelf:"flex-start",maxWidth:"92%",background:"#fff",border:"1.5px dashed var(--pri)",borderRadius:"4px 16px 16px 16px",padding:"16px 15px",textAlign:"center"}}>
              <div style={{fontSize:26,marginBottom:4}}>🙈</div>
              <div style={{fontSize:12.5,color:"var(--sub)",marginBottom:9,lineHeight:1.5}}>{tr("교수님 설명을 가렸어.\n안 보고 먼저 손으로 적어봐!","Hidden — write from memory first!")}</div>
              <button className="btn gho sm" onClick={()=>setHidePeek(false)}>{tr("👀 펼쳐보기","👀 Reveal")}</button>
            </div>
            ):(
            <div key={i} style={{alignSelf:"flex-start",maxWidth:"92%",background:"#fff",border:"1.5px solid var(--line)",borderRadius:"4px 16px 16px 16px",padding:"12px 15px"}}>
              <div style={{fontSize:11,color:"var(--pri)",fontWeight:700,marginBottom:3}}>🎓 {tr("교수님","Tutor")}</div>
              <MathText text={t.content}/>
            </div>
            )
          ):(
            <div key={i} style={{alignSelf:"flex-end",maxWidth:"88%",background:"var(--pri-s)",border:"1.5px solid var(--pri)",borderRadius:"16px 4px 16px 16px",padding:"10px 14px"}}>
              {t.img?<img src={"data:image/png;base64,"+t.img} alt="손글씨" style={{maxWidth:"100%",borderRadius:8,display:"block"}}/>
                :<MathText text={String(t.display||t.content||"")} style={{color:"var(--ink)",lineHeight:1.6}}/>}
            </div>
          )
        ))}
        {busy&&stream&&(
          <div style={{alignSelf:"flex-start",maxWidth:"92%",background:"#fff",border:"1.5px solid var(--line)",borderRadius:"4px 16px 16px 16px",padding:"12px 15px"}}>
            <div style={{fontSize:11,color:"var(--pri)",fontWeight:700,marginBottom:3}}>🎓 {tr("교수님","Tutor")}</div>
            <MathText text={stream}/><span style={{opacity:.5}}>▍</span>
          </div>
        )}
        {busy&&!stream&&(
          <div style={{alignSelf:"stretch",padding:"4px 8px",display:"flex",flexDirection:"column",gap:6}}>
            <div style={{color:"var(--sub)",fontSize:13}}>🎓 {tr("교수님이 준비 중…","Tutor is getting ready…")}</div>
            <Cheer/>
          </div>
        )}
        {err&&<div className="err" style={{fontSize:13}}>{err}</div>}
      </div>

      {control==="DONE"?(
        <div style={{display:"flex",gap:8,flexWrap:"wrap",borderTop:"1.5px solid var(--line)",paddingTop:12}}>
          <div style={{width:"100%",color:"var(--mint-d,#0F766E)",fontWeight:700,marginBottom:2}}>🎓 {tr("이 개념 정복! 너, 점점 교수가 되고 있어 👏","Concept conquered — you're becoming the professor! 👏")}</div>
          <button className="btn pri" onClick={()=>setConcept(null)}>{tr("다음 개념 🎓","Next concept 🎓")}</button>
          <button className="btn gho" onClick={()=>quick("핵심만 한 번 더 짧게 정리해 주세요.")}>{tr("한 번 더 정리","Recap")}</button>
        </div>
      ):(
        <div style={{borderTop:"1.5px solid var(--line)",paddingTop:12,display:"flex",flexDirection:"column",gap:8}}>
          {task&&(
            <div style={{display:"flex",gap:10,alignItems:"center",background:control==="RECALL"?"#EEF6FF":"#FFF6E9",border:"1.5px solid "+(control==="RECALL"?"#9CC3FF":"#FBD38D"),borderRadius:12,padding:"10px 13px"}}>
              <span style={{fontSize:22}}>{task.emo}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:800,color:control==="RECALL"?"#1E40AF":"#92620A",fontSize:13.5}}>{task.label}</div>
                <div style={{fontSize:12,color:"var(--sub)",lineHeight:1.4,whiteSpace:"pre-line"}}>{task.desc}</div>
              </div>
            </div>
          )}
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {control==="NEXT"&&<button className="btn pri sm" disabled={busy} onClick={()=>quick("이해했어요. 다음 단계로 넘어가 주세요.")}>{tr("이해했어요, 다음 ▶","Got it, next ▶")}</button>}
            <button className="btn gho sm" disabled={busy} onClick={()=>quick("아직 잘 모르겠어요. 어디서 막히는 건지 더 쉽게 다시 설명해 주세요.")}>{tr("😵 모르겠어요","😵 Lost")}</button>
            {(control==="COPY"||control==="RECALL"||control==="ASK")&&<button className="btn gho sm" disabled={busy} onClick={()=>quick("이 과제는 이미 충분히 알아서 안 쓰고 넘어갈게요. 채점·피드백 말고 바로 다음 단계로 가 주세요.")}>{tr("넘어갈래요 ⏭","Skip ⏭")}</button>}
          </div>
          {options.length>0&&(
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {options.map((o,i)=>(
                <button key={i} className="btn gho sm" disabled={busy} onClick={()=>sendOption(o)}
                  style={{borderColor:"var(--pri)",color:"var(--pri-d)",background:"var(--pri-s)"}}>
                  <MathText text={o} tag="span"/>
                </button>
              ))}
            </div>
          )}
          {penMode?(
            <>
              <PenPad ref={padRef} kind="answer" hideOcr penOnlyDefault={true}/>
              <div style={{display:"flex",gap:8}}>
                <button className="btn pri" disabled={busy} onClick={sendPen}>{tr("🎓 교수님께 제출!","🎓 Submit to Professor!")}</button>
                <button className="btn gho" onClick={()=>setPenMode(false)}>{tr("✕ 텍스트로","✕ Text")}</button>
              </div>
            </>
          ):(
            <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
              <textarea className="field" value={input} disabled={busy}
                onChange={e=>setInput(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendText();}}}
                placeholder={control==="ASK"?tr("여기에 답을 써봐 (또는 ✍️로 손글씨)","Write your answer (or ✍️)"):tr("질문하거나 답해봐…","Ask or answer…")}
                rows={2} style={{flex:1,resize:"none",fontFamily:"inherit"}}/>
              <button className="btn gho" title={tr("손글씨로","Handwriting")} disabled={busy} onClick={()=>{setErr("");setPenMode(true);}}>✍️</button>
              <button className="btn pri" disabled={busy||!input.trim()} onClick={sendText}>{tr("보내기","Send")}</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ── 학습 세션 ── */

export { Tutor };
