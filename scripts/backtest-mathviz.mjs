// mathviz 백테스트 — 프로덕션 모델(Sonnet 등)이 실제 앱 프롬프트로 유효한 장면 스크립트를
// 내는지, 우리 파이프라인(블록 추출→관대 파스→정밀 검증)이 깨지지 않는지 실 API로 검사한다.
//
// 사용:
//   ANTHROPIC_API_KEY=sk-ant-...  node scripts/backtest-mathviz.mjs [--model claude-sonnet-4-6] [--n 3]
//   YP_ACADEMY_CODE=코드          node scripts/backtest-mathviz.mjs   (프록시 경로 — 앱과 동일)
//
// 판정 기준(완화 금지):
//   수학 시나리오 = mathviz 블록 ≥1 && 모든 블록이 validateScript 통과
//   경제 시나리오 = mathviz 블록 0 && <svg> 존재 (이원화 계약 준수)
import { RICH_FMT } from "../src/core/platform.js";
import { parseSceneBlock, validateScript, SCENE_SCHEMA_PROMPT } from "../src/ui/mathviz/scenescript.js";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const arg=(k,d)=>{const i=process.argv.indexOf(k);return i>0?process.argv[i+1]:d;};
const MODEL=arg("--model","claude-sonnet-4-6");
const N=+arg("--n",3);
const KEY=process.env.ANTHROPIC_API_KEY||"";
const CODE=process.env.YP_ACADEMY_CODE||"";
const PROXY="https://yp-ai-proxy.soomin020114.workers.dev";
if(!KEY&&!CODE){console.error("ANTHROPIC_API_KEY 또는 YP_ACADEMY_CODE 환경변수가 필요합니다.");process.exit(2);}

async function callModel(system,user,maxTok=3000){
  const content=typeof user==="string"?user:user;   // 문자열 또는 콘텐츠 블록 배열(비전)
  if(KEY){
    const res=await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST",
      headers:{"content-type":"application/json","x-api-key":KEY,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({model:MODEL,max_tokens:maxTok,system,messages:[{role:"user",content}]}),
    });
    if(!res.ok)throw new Error("API HTTP "+res.status+" "+(await res.text()).slice(0,200));
    const d=await res.json();
    return (d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n");
  }
  const res=await fetch(PROXY+"/claude",{                     // 앱의 회사키 경로 그대로
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({academyCode:CODE,system,messages:[{role:"user",content}],wantJson:false,maxTok,model:MODEL,stream:false}),
  });
  if(!res.ok)throw new Error("Proxy HTTP "+res.status+" "+(await res.text()).slice(0,200));
  return ((await res.json()).text||"");
}

/* ── 시나리오: 앱의 실제 시스템 프롬프트(Study.jsx 원문) + 그래프가 꼭 필요한 질문 ── */
const EXPLAIN_NEW=(mat)=>"너는 친절한 튜터야. 학습자가 이 개념을 전혀 모르니 처음 배우는 사람에게 직관적으로(비유·예시·왜 중요한지) 반말로 설명해줘."+
  "\n\n출력 형식 규칙:\n① 제목은 ## 소제목은 ### ② 핵심 용어나 강조는 **굵게** ③ 목록은 - 기호 ④ 수식은 LaTeX($...$, $$...$$) ⑤ >> === 같은 ASCII 기호 금지 ⑥ 이해에 도움되면 표·그래프 적극 사용 — 함수 그래프는 아래 형식 규칙 4의 mathviz 스크립트, 함수식이 아닌 개념 도식만 <svg>"+RICH_FMT+"\n\n자료:\n"+mat;

const SCENARIOS=[
  {id:"explog",   kind:"math", sys:EXPLAIN_NEW("고1 수학: 지수함수 y=2^x-3 과 로그함수의 그래프, 점근선, 절편"),
   user:"개념: 지수함수의 그래프와 점근선\n원래 질문: y=2^x-3 의 그래프를 그리고 점근선과 x절편, y절편을 표시해서 설명해줘. 그래프 꼭 포함해줘."},
  {id:"extrema",  kind:"math", sys:EXPLAIN_NEW("수학2: 삼차함수의 극대·극소, 도함수와 증감표"),
   user:"개념: 삼차함수의 극값\n원래 질문: f(x)=x^3-3x 의 극대·극소를 그래프로 보여주면서 설명해줘. 그래프 꼭 포함해줘."},
  {id:"area",     kind:"math", sys:EXPLAIN_NEW("수학2: 정적분과 두 곡선 사이 넓이, 교점이 적분 한계"),
   user:"개념: 두 곡선 사이의 넓이\n원래 질문: y=x^2 과 y=2x 사이의 넓이를 구하는 과정을 그래프와 함께 설명해줘. 그래프 꼭 포함해줘."},
  {id:"conic",    kind:"math", sys:EXPLAIN_NEW("기하: 쌍곡선의 정의, 초점, 점근선, c²=a²+b²"),
   user:"개념: 쌍곡선의 초점\n원래 질문: x²/4 - y²/2 = 1 의 초점과 점근선을 그래프로 보여주면서 설명해줘. 그래프 꼭 포함해줘."},
  {id:"trig",     kind:"math", sys:EXPLAIN_NEW("대수: 삼각함수 y=sin x 의 그래프, 주기, 최댓값"),
   user:"개념: 사인함수의 그래프\n원래 질문: y=2sin(x) 의 그래프와 최댓값·최솟값 위치를 보여주면서 설명해줘. 그래프 꼭 포함해줘."},
  {id:"tangent",  kind:"math", sys:EXPLAIN_NEW("수학2: 미분계수와 접선의 방정식"),
   user:"개념: 접선의 방정식\n원래 질문: y=x^2 위의 점 (1,1) 에서의 접선을 그래프로 보여주면서 설명해줘. 그래프 꼭 포함해줘."},
  {id:"vecdot",   kind:"math", sys:EXPLAIN_NEW("기하: 벡터의 내적, 투영, 사잇각 θ — 그림은 vector·angle 스텝으로"),
   user:"개념: 벡터의 내적과 투영\n원래 질문: 내적이 왜 |a||b|cosθ 인지 투영 그림(두 벡터, 사잇각 θ, 수선)으로 보여주면서 설명해줘. 그림 꼭 포함해줘."},
  {id:"econ",     kind:"econ", sys:EXPLAIN_NEW("경제학원론: 수요와 공급, 균형가격, 수요곡선의 이동"),
   user:"개념: 수요곡선의 이동\n원래 질문: 소득이 늘면 수요곡선이 어떻게 이동하고 균형가격이 어떻게 변하는지 그래프로 설명해줘. 그래프 꼭 포함해줘."},
];

/* 비전: '벡터로 변환' — 그림 픽스처(삼각형+높이) → 장면 스크립트 (ExamBank toVector와 동일 계약) */
const FIGURE_PNG=(()=>{try{return fs.readFileSync(new URL("./fixtures/triangle-figure.png",import.meta.url)).toString("base64");}catch(_){return null;}})();
const VISION_SCENARIO=FIGURE_PNG&&{
  id:"tovector", kind:"vision",
  sys:"너는 수학 문항의 그림(그래프·도형)을 벡터 장면 스크립트로 정밀하게 옮기는 도구야. 그림에 실제로 있는 요소만 옮기고, 반드시 JSON만 출력해(코드블록·설명 금지).\n"+SCENE_SCHEMA_PROMPT,
  user:[
    {type:"image",source:{type:"base64",media_type:"image/png",data:FIGURE_PNG}},
    {type:"text",text:"[문항 본문 — 그림 해석의 맥락]\n삼각형 ABC의 넓이를 구하시오. (높이 AH가 표시되어 있다)\n\n이 그림을 장면 스크립트 JSON으로 재구성해."},
  ],
};

/* ── 판정 ── */
function judge(scn,text){
  const blocks=text.match(/```mathviz[\s\S]*?```/gi)||[];
  const errors=[];
  // 전 시나리오 공통: 유니코드 조합문자(글자 깨짐 원인) 회귀 감시
  if(/[⃐-⃿]/.test(text))errors.push("유니코드 조합문자 사용(b⃗류 — 글자 깨짐)");
  if(scn.kind==="vision"){   // JSON만 와야 함
    const script=parseSceneBlock("```mathviz\n"+text+"\n```");
    if(!script){errors.push("비전: 장면 스크립트 파스 실패");return{blocks:0,errors};}
    const v=validateScript(script);
    if(!v.ok)errors.push(...v.errors.map(e=>"비전: "+e));
    const types=new Set(script.steps.map(s=>s.type));
    if(!types.has("segment")&&!types.has("vector"))errors.push("비전: 삼각형 변(segment)이 없음");
    return {blocks:1,errors};
  }
  if(scn.kind==="econ"){
    if(blocks.length>0)errors.push("경제 도식에 mathviz 사용(이원화 계약 위반)");
    if(!/<svg[\s\S]*?<\/svg>/i.test(text))errors.push("<svg> 도식 없음");
    return {blocks:blocks.length,errors};
  }
  if(!blocks.length){errors.push("mathviz 블록 없음(그래프 요청했는데)");return{blocks:0,errors};}
  let anyVector=false;
  blocks.forEach((b,bi)=>{
    const script=parseSceneBlock(b);
    if(!script){errors.push("블록"+bi+": JSON 파스 실패");return;}
    const v=validateScript(script);
    if(!v.ok)errors.push(...v.errors.map(e=>"블록"+bi+": "+e));
    if(script.steps.some(s=>s.type==="vector"))anyVector=true;
  });
  // 벡터 개념 시나리오: 투영 '다이어그램'만 vector 스텝 필수 — cosθ 함수 그래프 블록은 plot이 정답
  if(scn.id==="vecdot"&&!anyVector)errors.push("vector 스텝을 쓴 다이어그램이 하나도 없음(손그림 SVG 회귀)");
  if(/```mathviz(?![\s\S]*```)/i.test(text))errors.push("닫히지 않은 mathviz 펜스");
  return {blocks:blocks.length,errors};
}

/* ── 실행 ── */
const outDir=fileURLToPath(new URL("../.backtest/",import.meta.url));   // 한글 경로 안전
fs.mkdirSync(outDir,{recursive:true});
let pass=0,fail=0;const failDetail={};
const ALL=[...SCENARIOS,...(VISION_SCENARIO?[VISION_SCENARIO]:[])];
console.log(`모델: ${MODEL} · 시나리오 ${ALL.length}종 × ${N}회 · 경로: ${KEY?"직접 API":"프록시(앱과 동일)"}${VISION_SCENARIO?"":" · (비전 픽스처 없음 — tovector 생략)"}\n`);
for(const scn of ALL){
  for(let t=1;t<=N;t++){
    let text="";
    try{text=await callModel(scn.sys,scn.user);}
    catch(e){fail++;(failDetail[scn.id]??=[]).push("호출 실패: "+e.message);console.log(`✖ ${scn.id}#${t} 호출 실패: ${e.message}`);continue;}
    fs.writeFileSync(outDir+scn.id+"-"+t+".md",text);
    const r=judge(scn,text);
    if(r.errors.length){
      fail++;(failDetail[scn.id]??=[]).push(...r.errors);
      console.log(`✖ ${scn.id}#${t} (블록 ${r.blocks}개)`);r.errors.forEach(e=>console.log("   - "+e));
    }else{pass++;console.log(`✔ ${scn.id}#${t} (블록 ${r.blocks}개 전부 유효)`);}
  }
}
console.log(`\n결과: ${pass}/${pass+fail} 통과`);
if(fail){
  console.log("실패 유형:");
  for(const[k,v]of Object.entries(failDetail))console.log(" ["+k+"] "+[...new Set(v)].join(" | "));
}
console.log("원문 저장: .backtest/");
process.exit(fail?1:0);
