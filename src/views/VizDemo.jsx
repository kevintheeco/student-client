// VizDemo — 벡터수학엔진 개발용 데모 라우트 (#vizdemo / #geodemo)
// §2-1 예시 스크립트 3종을 렌더해 draw-on·자동계산·라벨회피·스텝제어를 눈으로 검증한다.
// 특이점 좌표는 스크립트에 없다 — intercepts/intersections/extrema 스텝이 전부 자동 계산.
import React from "react";
import { MathViz } from "../ui/mathviz/MathViz.jsx";

const { useState, useEffect } = React;

/* ① 삼각형 넓이 (geometry) — 4단계 기하 상호작용의 정답 모델과 같은 언어 */
const DEMO_TRIANGLE={
  version:1, theme:"geometry",
  view:{ x:[-1,7.2], y:[-1,5.6] },
  steps:[
    { type:"axes", ticks:1 },
    { type:"segment", from:[1,1],   to:[6,1],   color:"chalk" },
    { type:"segment", from:[6,1],   to:[2.5,4.5], color:"chalk" },
    { type:"segment", from:[2.5,4.5], to:[1,1], color:"chalk" },
    { type:"point", at:[2.5,4.5], label:"A" },
    { type:"point", at:[1,1],     label:"B" },
    { type:"point", at:[6,1],     label:"C" },
    { type:"segment", from:[2.5,4.5], to:[2.5,1], color:"fix", dash:true },
    { type:"point", at:[2.5,1], label:"H" },
    { type:"lines", tex:["BC=5,\\quad AH=3.5","S=\\tfrac12\\cdot BC\\cdot AH"], mutedExceptLast:true },
    { type:"formula", tex:"S=\\tfrac12\\cdot 5\\cdot 3.5=\\tfrac{35}{4}", box:true },
    { type:"chip", text:"보조선 = 높이" },
    { type:"pill", text:"넓이는 밑변과 높이부터 — 높이가 없으면 그려 넣는다" },
  ],
};

/* ② 지수·로그 점근선 — 지시서 §2-1 예시 그대로 (절편·교점·넓이 전부 자동) */
const DEMO_EXPLOG={
  version:1, theme:"sequence",
  view:{ x:[-3,4.6], y:[-3,4.6] },
  steps:[
    { type:"axes", ticks:1 },
    { type:"plot", id:"f", expr:"exp(x)-2",  domain:[-3,1.85],   color:"accent" },
    { type:"plot", id:"g", expr:"log(x+2)",  domain:[-1.86,4.6], color:"chalk" },
    { type:"asymptote", axis:"h", at:-2, label:"y=-2" },
    { type:"asymptote", axis:"v", at:-2, label:"x=-2" },
    { type:"intercepts", of:"f" },
    { type:"intersections", of:["f","g"] },
    { type:"area", between:["f","g"], range:"auto-intersections" },
    { type:"chip", text:"교점 = 적분 한계" },
    { type:"pill", text:"두 곡선 사이 넓이는 교점부터 잡는다" },
  ],
};

/* ③ 쌍곡선 초점 — c²=a²+b² 자동 계산 (√6 ≈ 2.449가 어디에도 안 적혀 있음) */
const DEMO_HYPERBOLA={
  version:1, theme:"geometry",
  view:{ x:[-6,6], y:[-4,4] },
  steps:[
    { type:"axes", ticks:1 },
    { type:"conic", kind:"hyperbola", a:2, b:1.414, show:["asymptotes","vertices","foci"] },
    { type:"formula", tex:"\\frac{x^2}{4}-\\frac{y^2}{2}=1", box:true },
    { type:"lines", tex:["c^2=a^2+b^2=4+2","c=\\sqrt{6}"], mutedExceptLast:true },
    { type:"chip", text:"초점 자동 계산" },
    { type:"pill", text:"쌍곡선의 초점은 점근선보다 바깥에 있다" },
  ],
};

const DEMOS=[
  { key:"tri",  name:"① 삼각형 넓이",     script:DEMO_TRIANGLE },
  { key:"log",  name:"② 지수·로그 점근선", script:DEMO_EXPLOG },
  { key:"hyp",  name:"③ 쌍곡선 초점",     script:DEMO_HYPERBOLA },
];

function VizDemo(){
  const geoHash=()=>/geodemo/i.test(location.hash);
  const [tab,setTab]=useState(geoHash()?"geo":"tri");
  const [theme,setTheme]=useState("dark");
  const [runId,setRunId]=useState(0);          // key 갈아끼워 처음부터 재생
  useEffect(()=>{
    const f=()=>{ if(geoHash())setTab("geo"); };
    window.addEventListener("hashchange",f);
    return ()=>window.removeEventListener("hashchange",f);
  },[]);
  const demo=DEMOS.find(d=>d.key===tab);
  return (
    <div style={{maxWidth:640,margin:"0 auto",padding:"26px 16px 60px",
      display:"flex",flexDirection:"column",gap:16}}>
      <h1 style={{fontFamily:"'Jua',sans-serif",fontSize:22,textAlign:"center",margin:0}}>
        벡터 수학 렌더링 데모
      </h1>
      <p style={{textAlign:"center",color:"var(--sub)",fontSize:13,margin:0}}>
        교점·절편·초점은 전부 함수식에서 자동 계산 — 스크립트에 좌표가 없습니다
      </p>
      <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
        {DEMOS.map(d=>(
          <button key={d.key} className="btn" onClick={()=>{setTab(d.key);setRunId(r=>r+1);}}
            style={{fontSize:13,padding:"8px 14px",
              opacity:tab===d.key?1:.55,fontWeight:tab===d.key?700:400}}>
            {d.name}
          </button>
        ))}
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"center"}}>
        <button className="btn" style={{fontSize:12,padding:"6px 12px"}}
          onClick={()=>setTheme(t=>t==="dark"?"light":"dark")}>
          테마: {theme==="dark"?"🌙 다크 칠판":"☀️ 라이트"}
        </button>
        <button className="btn" style={{fontSize:12,padding:"6px 12px"}}
          onClick={()=>setRunId(r=>r+1)}>
          ⟲ 처음부터
        </button>
      </div>
      {demo&&(
        <div style={{display:"flex",justifyContent:"center"}}>
          <MathViz key={demo.key+theme+runId} script={demo.script} theme={theme}
            controls autoplay/>
        </div>
      )}
    </div>
  );
}

export { VizDemo };
