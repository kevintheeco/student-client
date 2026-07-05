// mathviz primitives — Axis·Curve·Point·Label·AreaFill·DashedLine·수식박스·칩·필 (§2-2)
// 전부 픽셀 좌표를 받는다 (MathViz가 수학→px 변환, GeoFeedback은 패드 px 그대로 사용).
// draw-on: 실선은 pathLength=1 정규화, 점선은 마스크(진행 노출) — pathLength·dash 병용 금지.
import React from "react";
import { _safeKatex } from "../math.jsx";

const { useId } = React;

/* ── 경로 유틸 ── */
// [x,y] 점열(null=정의역 끊김)을 path d로. NaN 구간은 M으로 재시작
function pathFrom(pts){
  let d="", pen=false;
  for(const p of pts){
    if(!p || Number.isNaN(p[0]) || Number.isNaN(p[1])){ pen=false; continue; }
    d += (pen?" L":" M")+p[0].toFixed(2)+" "+p[1].toFixed(2);
    pen=true;
  }
  return d.trim();
}
function polyLength(pts){
  let L=0, prev=null;
  for(const p of pts){
    if(!p || Number.isNaN(p[0]) || Number.isNaN(p[1])){ prev=null; continue; }
    if(prev) L += Math.hypot(p[0]-prev[0], p[1]-prev[1]);
    prev=p;
  }
  return L;
}

// 짧은 LaTeX 라벨 → SVG <text>용 평문 (좌표·꼭짓점 이름 수준만 담당)
const SUP={"0":"⁰","1":"¹","2":"²","3":"³","4":"⁴","5":"⁵","6":"⁶","7":"⁷","8":"⁸","9":"⁹","-":"⁻","+":"⁺","n":"ⁿ"};
const SUB={"0":"₀","1":"₁","2":"₂","3":"₃","4":"₄","5":"₅","6":"₆","7":"₇","8":"₈","9":"₉","n":"ₙ"};
function detex(s){
  return String(s)
    .replace(/\\left|\\right/g,"")
    .replace(/\\,|\\;|\\!|\\ /g," ")
    .replace(/\\pi/g,"π").replace(/\\theta/g,"θ").replace(/\\sqrt/g,"√")
    .replace(/\\cdot/g,"·").replace(/\\times/g,"×").replace(/\\pm/g,"±").replace(/\\prime/g,"′")
    .replace(/\^\{([^}]*)\}/g,(m,p)=>[...p].map(c=>SUP[c]||c).join(""))
    .replace(/\^(.)/g,(m,c)=>SUP[c]||c)
    .replace(/_\{([^}]*)\}/g,(m,p)=>[...p].map(c=>SUB[c]||c).join(""))
    .replace(/_(.)/g,(m,c)=>SUB[c]||c)
    .replace(/[{}$]/g,"");
}

const animStyle=(anim, name)=> anim && anim.animate
  ? { animation:`${name} ${anim.dur||0}ms ease forwards`, animationDelay:(anim.delay||0)+"ms" }
  : null;

/* ── 곡선·직선 (실선 draw-on) ── */
function Curve({pts, color, width=2.6, anim}){
  const d=pathFrom(pts);
  if(!d) return null;
  const on=anim && anim.animate;
  return (
    <path d={d} fill="none" stroke={color} strokeWidth={width}
      strokeLinecap="round" strokeLinejoin="round"
      pathLength={on?1:undefined}
      style={on?{strokeDasharray:1,strokeDashoffset:1,...animStyle(anim,"viz-draw")}:null}/>
  );
}

/* ── 점선 (점근선·수선·보완 오버레이) — 마스크로 진행 노출 ── */
function DashedLine({pts, color, width=1.8, dash="8 8", anim}){
  const id=useId().replace(/[«»:]/g,"v");   // SVG id로 안전하게
  const d=pathFrom(pts);
  if(!d) return null;
  const on=anim && anim.animate;
  const line=(
    <path d={d} fill="none" stroke={color} strokeWidth={width}
      strokeLinecap="round" strokeDasharray={dash}
      mask={on?`url(#${id})`:undefined}/>
  );
  if(!on) return line;
  return (
    <g>
      <mask id={id} maskUnits="userSpaceOnUse">
        <path d={d} fill="none" stroke="#fff" strokeWidth={width+6}
          strokeLinecap="round" pathLength={1}
          style={{strokeDasharray:1,strokeDashoffset:1,...animStyle(anim,"viz-draw")}}/>
      </mask>
      {line}
    </g>
  );
}

/* ── 좌표축 + 눈금 ── */
function Axis({mapping, ticks=1, chalk, grid, anim, fontSize=11}){
  const {toPx, view}=mapping;
  const [x0,x1]=view.x, [y0,y1]=view.y;
  const els=[], tickEls=[];
  const ax=Math.min(Math.max(0,x0),x1), ay=Math.min(Math.max(0,y0),y1); // 축 위치(0이 밖이면 가장자리)
  const xA=[[x0,ay],[x1,ay]].map(p=>toPx(p[0],p[1]));
  const yA=[[ax,y0],[ax,y1]].map(p=>toPx(p[0],p[1]));
  els.push(<Curve key="xa" pts={xA} color={chalk} width={1.6} anim={anim}/>);
  els.push(<Curve key="ya" pts={yA} color={chalk} width={1.6} anim={anim}/>);
  // 화살촉 (+방향)
  const ah=(p,dx,dy,key)=>(
    <path key={key} d={`M${p[0]} ${p[1]} l${-7*dx+3.5*dy} ${-7*dy-3.5*dx} M${p[0]} ${p[1]} l${-7*dx-3.5*dy} ${-7*dy+3.5*dx}`}
      stroke={chalk} strokeWidth={1.6} strokeLinecap="round" fill="none"
      style={anim&&anim.animate?{opacity:0,animation:`viz-fade 200ms ease forwards ${(anim.delay||0)+(anim.dur||0)}ms`}:null}/>
  );
  els.push(ah(xA[1],1,0,"xh"), ah(yA[1],0,-1,"yh"));
  if(ticks>0){
    for(let t=Math.ceil(x0/ticks)*ticks; t<=x1; t+=ticks){
      if(Math.abs(t)<1e-9) continue;
      const p=toPx(t,ay);
      tickEls.push(<line key={"tx"+t} x1={p[0]} y1={p[1]-3} x2={p[0]} y2={p[1]+3} stroke={grid} strokeWidth={1.2}/>);
      tickEls.push(<text key={"lx"+t} x={p[0]} y={p[1]+14} fill={grid} fontSize={fontSize} textAnchor="middle">{+t.toFixed(6)}</text>);
    }
    for(let t=Math.ceil(y0/ticks)*ticks; t<=y1; t+=ticks){
      if(Math.abs(t)<1e-9) continue;
      const p=toPx(ax,t);
      tickEls.push(<line key={"ty"+t} x1={p[0]-3} y1={p[1]} x2={p[0]+3} y2={p[1]} stroke={grid} strokeWidth={1.2}/>);
      tickEls.push(<text key={"ly"+t} x={p[0]-7} y={p[1]+4} fill={grid} fontSize={fontSize} textAnchor="end">{+t.toFixed(6)}</text>);
    }
  }
  const to=toPx(ax,ay);
  tickEls.push(<text key="o" x={to[0]-6} y={to[1]+14} fill={grid} fontSize={fontSize} textAnchor="end">O</text>);
  return (
    <g>
      {els}
      <g style={anim&&anim.animate?{opacity:0,animation:`viz-fade 300ms ease forwards ${(anim.delay||0)+(anim.dur||0)*0.5}ms`}:null}>
        {tickEls}
      </g>
    </g>
  );
}

/* ── 점·라벨·영역·직각 표시 ── */
function PointDot({at, color, r=4.5, anim}){
  return <circle cx={at[0]} cy={at[1]} r={r} fill={color}
    className="viz-dot" style={animStyle(anim,"viz-pop")||undefined}/>;
}

// at: placeLabel이 계산한 라벨 박스 좌상단
function SvgLabel({at, text, color, fontSize=15, anim}){
  return <text x={at[0]} y={at[1]+fontSize*0.95} fill={color} fontSize={fontSize}
    fontWeight={600} className="viz-dot" style={animStyle(anim,"viz-pop")||undefined}>
    {detex(text)}
  </text>;
}

function AreaFill({pts, color, opacity=0.35, anim}){
  const d=pathFrom(pts);
  if(!d) return null;
  return <path d={d+" Z"} fill={color} stroke="none"
    style={anim&&anim.animate
      ?{opacity:0,animation:`viz-area ${anim.dur||500}ms ease forwards ${(anim.delay||0)}ms`,"--viz-op":opacity}
      :{opacity}}/>;
}

// 직각 표시: 꼭짓점 corner에서 uA·uB 단위벡터 방향으로 size만큼 꺾은 폴리라인
function RightAngleMark({corner, uA, uB, size=14, color, anim}){
  const p1=[corner[0]+uA[0]*size, corner[1]+uA[1]*size];
  const p3=[corner[0]+uB[0]*size, corner[1]+uB[1]*size];
  const p2=[p1[0]+uB[0]*size, p1[1]+uB[1]*size];
  return <polyline points={`${p1} ${p2} ${p3}`} fill="none" stroke={color} strokeWidth={2.2}
    className="viz-dot" style={animStyle(anim,"viz-pop")||undefined}/>;
}

/* ── HTML 캡션 존 (보드 아래) — KaTeX는 여기서만 ── */
function katexOrText(tex){
  const html=_safeKatex(tex,false);
  return html
    ? <span dangerouslySetInnerHTML={{__html:html}}/>
    : <span>{tex}</span>;
}

// 결론 수식 (box=true면 라운드 보더 박스 — 문법 규칙 ③)
function FormulaBox({tex, color, box=true, anim}){
  return (
    <div className={"viz-formula"+(box?" boxed":"")+(anim&&anim.animate?" viz-line-in":"")}
      style={{color, borderColor:box?color:undefined, animationDelay:anim?(anim.delay||0)+"ms":undefined}}>
      {katexOrText(tex)}
    </div>
  );
}

// 유도식 줄 단위 순차 등장 — 중간 줄 muted·결론만 accent (문법 규칙 ②)
function Lines({tex, mutedExceptLast=true, muted, accent, anim, lineWrite=800, lineGap=300}){
  const arr=Array.isArray(tex)?tex:[tex];
  return (
    <div className="viz-lines">
      {arr.map((t,i)=>{
        const last=i===arr.length-1;
        const color=mutedExceptLast&&!last?muted:accent;
        const delay=(anim?(anim.delay||0):0)+i*(lineWrite+lineGap);
        return (
          <div key={i} className={"viz-lineitem"+(anim&&anim.animate?" viz-line-in":"")}
            style={{color, animationDelay:delay+"ms", animationDuration:lineWrite+"ms"}}>
            {katexOrText(t)}
          </div>
        );
      })}
    </div>
  );
}

function Chip({text, color, anim}){
  return <span className={"viz-chip"+(anim&&anim.animate?" viz-line-in":"")}
    style={{color, borderColor:color, animationDelay:anim?(anim.delay||0)+"ms":undefined}}>{text}</span>;
}
function Pill({text, chalk, anim}){
  return <div className={"viz-pill"+(anim&&anim.animate?" viz-line-in":"")}
    style={{color:chalk, animationDelay:anim?(anim.delay||0)+"ms":undefined}}>{text}</div>;
}

export {
  pathFrom, polyLength, detex,
  Curve, DashedLine, Axis, PointDot, SvgLabel, AreaFill, RightAngleMark,
  FormulaBox, Lines, Chip, Pill,
};
