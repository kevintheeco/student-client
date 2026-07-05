// MathViz — 장면 스크립트 JSON(§2-1)을 벡터 SVG로 렌더하는 메인 컴포넌트.
// 특이점(교점·절편·극점·변곡점·초점)은 여기 컴파일 패스에서 mathcore로 자동 계산해
// 프리미티브로 전개한다 — 스크립트에도 코드에도 좌표 하드코딩이 없다(§8).
// 스텝 제어(재생/이전/다음/스크럽)는 원본 사전렌더 영상이 못 하는 차별화 기능.
import React from "react";
import { TIMING, LONG_CURVE_PX, vizTheme } from "./tokens.js";
import { tryCompileExpr } from "./exprparser.js";
import {
  findIntersections, findExtrema, findInflections, xIntercepts, yIntercept,
  d1, conicFoci, ellipsePoints, hyperbolaPoints, parabolaPoints, safeFn,
} from "./mathcore.js";
import { placeLabel, estimateLabelBox } from "./placeLabel.js";
import {
  Curve, DashedLine, Axis, PointDot, SvgLabel, AreaFill,
  FormulaBox, Lines, Chip, Pill, polyLength, detex,
} from "./primitives.jsx";

const { useState, useEffect, useMemo, useRef } = React;

/* ── 좌표 매핑: 수학 좌표 → 보드 픽셀 (y 반전) ── */
const BOARD_W=520, BOARD_PAD=16;
function makeMapping(view, W=BOARD_W){
  const [x0,x1]=view.x, [y0,y1]=view.y;
  const H=Math.max(220, Math.min(420, Math.round(W*(y1-y0)/(x1-x0))));
  const sx=(W-2*BOARD_PAD)/(x1-x0), sy=(H-2*BOARD_PAD)/(y1-y0);
  const toPx=(x,y)=>[BOARD_PAD+(x-x0)*sx, BOARD_PAD+(y1-y)*sy];
  return { toPx, W, H, sx, sy, unit:sx, view };
}

const fmt=(v)=>{const r=Math.round(v);return Math.abs(v-r)<1e-6?String(r):String(+v.toFixed(2));};

/* ── 컴파일 패스: 스크립트 → {스텝별 프리미티브 스펙, 지속시간} ── */
function compileScript(script, theme){
  const t=vizTheme(theme);
  const accent=(script.theme && t.accent[script.theme]) || t.accent.sequence;
  const color=(c)=>{
    if(!c)return t.chalk;
    if(c==="accent")return accent;
    if(c in t && typeof t[c]==="string")return t[c];
    return /^#[0-9a-fA-F]{3,8}$/.test(c)?c:t.chalk;
  };
  const view=(script.view&&script.view.x&&script.view.y)?script.view:{x:[-5,5],y:[-4,4]};
  const m=makeMapping(view);
  const [vx0,vx1]=view.x,[vy0,vy1]=view.y;
  const slack=(vy1-vy0)*0.25;
  const plots={};        // id → {f, domain, color}
  const obstacles=[];    // 라벨 회피용 픽셀 샘플점 (스텝 순서대로 누적)
  const items=[];        // {step, zone:'svg'|'html', ...spec}
  const durs=[];         // 스텝별 애니메이션 길이(ms)
  const warn=(msg)=>{ if(typeof console!=="undefined")console.warn("[MathViz] "+msg); };

  // 수학 점열 → px 점열 (뷰 밖·NaN은 null로 끊음)
  const toPxPts=(mathPts)=>mathPts.map(p=>{
    if(!p||Number.isNaN(p[0])||Number.isNaN(p[1]))return null;
    if(p[1]<vy0-slack||p[1]>vy1+slack)return null;
    return m.toPx(p[0],p[1]);
  });
  const sampleFn=(f,dom,n=240)=>{
    const pts=[];
    for(let k=0;k<=n;k++){const x=dom[0]+(dom[1]-dom[0])*k/n;pts.push([x,f(x)]);}
    return toPxPts(pts);
  };
  const addObstacles=(pxPts,every=4)=>{
    for(let k=0;k<pxPts.length;k+=every){const p=pxPts[k];if(p)obstacles.push(p);}
  };
  // 선분을 따라 장애물 점 샘플 (끝점만으로는 라벨이 선 위에 얹힘)
  const addSegObstacles=(a,b,n=16)=>{
    for(let k=0;k<=n;k++)obstacles.push([a[0]+(b[0]-a[0])*k/n, a[1]+(b[1]-a[1])*k/n]);
  };
  // 점 + 라벨(회피 배치) — 라벨 박스도 장애물로 등록해 라벨끼리 안 겹침
  const addPoint=(step,mathXY,labelText,dotColor,labelColor,fontSize=13.5)=>{
    const at=m.toPx(mathXY[0],mathXY[1]);
    items.push({step,zone:"svg",kind:"dot",at,color:dotColor});
    obstacles.push(at);
    if(labelText==null)return;
    const plain=detex(labelText);
    const {w,h}=estimateLabelBox(plain,fontSize);
    const pos=placeLabel({anchor:at,w,h,obstacles,unit:m.unit});
    items.push({step,zone:"svg",kind:"label",at:[pos.x,pos.y],text:labelText,color:labelColor||dotColor,fontSize});
    obstacles.push([pos.x,pos.y],[pos.x+w,pos.y],[pos.x,pos.y+h],[pos.x+w,pos.y+h],[pos.x+w/2,pos.y+h/2]);
  };
  const needPlot=(id)=>{
    if(plots[id])return plots[id];
    warn("plot id '"+id+"' 미정의");return null;
  };

  const steps=Array.isArray(script.steps)?script.steps:[];
  steps.forEach((s,i)=>{
    let dur=TIMING.cardFade;
    switch(s.type){
      case "axes":{
        items.push({step:i,zone:"svg",kind:"axes",ticks:s.ticks??1});
        // 축 자체를 장애물로 (라벨이 축과 겹치지 않게)
        for(let k=0;k<=40;k++){
          const x=vx0+(vx1-vx0)*k/40;obstacles.push(m.toPx(x,Math.min(Math.max(0,vy0),vy1)));
        }
        for(let k=0;k<=30;k++){
          const y=vy0+(vy1-vy0)*k/30;obstacles.push(m.toPx(Math.min(Math.max(0,vx0),vx1),y));
        }
        dur=TIMING.drawOn;break;
      }
      case "plot":{
        const {f,error}=tryCompileExpr(s.expr);
        if(!f){warn("expr 오류: "+error);break;}
        const dom=s.domain||[vx0,vx1];
        plots[s.id||("f"+i)]={f,domain:dom,color:color(s.color)};
        const pts=sampleFn(f,dom);
        addObstacles(pts);
        const L=polyLength(pts);
        dur=L>LONG_CURVE_PX?TIMING.drawOnLong:TIMING.drawOn;
        items.push({step:i,zone:"svg",kind:"curve",pts,color:color(s.color),width:2.8,dur});
        break;
      }
      case "asymptote":{
        const pts=s.axis==="v"
          ?[m.toPx(s.at,vy0),m.toPx(s.at,vy1)]
          :[m.toPx(vx0,s.at),m.toPx(vx1,s.at)];
        items.push({step:i,zone:"svg",kind:"dash",pts,color:t.muted,width:1.8,dash:"7 8"});
        addSegObstacles(pts[0],pts[1]);
        if(s.label){
          const anchor=s.axis==="v"?m.toPx(s.at,vy0+(vy1-vy0)*0.12):m.toPx(vx0+(vx1-vx0)*0.1,s.at);
          const plain=detex(s.label);
          const {w,h}=estimateLabelBox(plain,12.5);
          const pos=placeLabel({anchor,w,h,obstacles,unit:m.unit});
          items.push({step:i,zone:"svg",kind:"label",at:[pos.x,pos.y],text:s.label,color:t.muted,fontSize:12.5});
        }
        dur=TIMING.drawOn;break;
      }
      case "intercepts":{
        const P=needPlot(s.of);if(!P)break;
        for(const [x,y] of xIntercepts(P.f,P.domain[0],P.domain[1]))
          addPoint(i,[x,y],`(${fmt(x)},\\,0)`,t.point);
        const yi=yIntercept(P.f);
        if(yi&&P.domain[0]<=0&&0<=P.domain[1]&&Math.abs(yi[1])>1e-6)
          addPoint(i,yi,`(0,\\,${fmt(yi[1])})`,t.point);
        break;
      }
      case "intersections":{
        const A=needPlot(s.of&&s.of[0]),B=needPlot(s.of&&s.of[1]);if(!A||!B)break;
        const lo=Math.max(A.domain[0],B.domain[0]),hi=Math.min(A.domain[1],B.domain[1]);
        for(const [x,y] of findIntersections(A.f,B.f,lo,hi))
          addPoint(i,[x,y],`(${fmt(x)},\\,${fmt(y)})`,t.point);
        break;
      }
      case "extrema":{
        const P=needPlot(s.of);if(!P)break;
        for(const e of findExtrema(P.f,P.domain[0],P.domain[1]))
          addPoint(i,[e.x,e.y],e.kind==="max"?"극대":"극소",t.point,accent);
        break;
      }
      case "inflections":{
        const P=needPlot(s.of);if(!P)break;
        for(const [x,y] of findInflections(P.f,P.domain[0],P.domain[1]))
          addPoint(i,[x,y],"변곡점",t.point,accent);
        break;
      }
      case "tangent":{
        const P=needPlot(s.of);if(!P)break;
        const f=safeFn(P.f),x0=s.at??0,half=s.halfLen??1.4,mm=d1(f,x0);
        const pts=toPxPts([[x0-half,f(x0)-mm*half],[x0+half,f(x0)+mm*half]]);
        items.push({step:i,zone:"svg",kind:"curve",pts,color:t.chalk,width:2.4,dur:TIMING.drawOn});
        addPoint(i,[x0,f(x0)],null,t.point);
        dur=TIMING.drawOn;break;
      }
      case "area":{
        const A=needPlot(s.between&&s.between[0]);if(!A)break;
        const B=s.between[1]?needPlot(s.between[1]):null;
        const fb=B?B.f:()=>0;   // 상대 곡선 없으면 x축과의 사이
        let r0,r1;
        if(Array.isArray(s.range)){[r0,r1]=s.range;}
        else{ // "auto-intersections": 교점 자동 계산으로 적분 한계를 잡는다
          const lo=B?Math.max(A.domain[0],B.domain[0]):A.domain[0];
          const hi=B?Math.min(A.domain[1],B.domain[1]):A.domain[1];
          const xs=findIntersections(A.f,fb,lo,hi);
          if(xs.length<2){warn("area: 교점이 2개 미만");break;}
          r0=xs[0][0];r1=xs[xs.length-1][0];
        }
        const n=120,poly=[];
        for(let k=0;k<=n;k++){const x=r0+(r1-r0)*k/n;poly.push([x,safeFn(A.f)(x)]);}
        for(let k=n;k>=0;k--){const x=r0+(r1-r0)*k/n;poly.push([x,safeFn(fb)(x)]);}
        items.push({step:i,zone:"svg",kind:"area",pts:toPxPts(poly),color:color(s.color)||accent,opacity:s.opacity??0.3});
        break;
      }
      case "point":{
        if(!Array.isArray(s.at))break;
        addPoint(i,s.at,s.label??null,t.point);
        break;
      }
      case "segment":{   // 명시 선분 (도형·보조선) — from/to는 수학 좌표
        if(!Array.isArray(s.from)||!Array.isArray(s.to))break;
        const pts=[m.toPx(s.from[0],s.from[1]),m.toPx(s.to[0],s.to[1])];
        if(s.dash)items.push({step:i,zone:"svg",kind:"dash",pts,color:color(s.color),width:s.width??2,dash:"8 9"});
        else items.push({step:i,zone:"svg",kind:"curve",pts,color:color(s.color),width:s.width??2.8,dur:TIMING.drawOn});
        addSegObstacles(pts[0],pts[1]);
        dur=TIMING.drawOn;break;
      }
      case "guide":{
        if(!Array.isArray(s.at))break;
        const p=s.at;
        items.push({step:i,zone:"svg",kind:"dash",pts:[m.toPx(p[0],0),m.toPx(p[0],p[1])],color:t.muted,width:1.4,dash:"5 6"});
        items.push({step:i,zone:"svg",kind:"dash",pts:[m.toPx(0,p[1]),m.toPx(p[0],p[1])],color:t.muted,width:1.4,dash:"5 6"});
        dur=TIMING.drawOn;break;
      }
      case "conic":{
        const a=s.a,b=s.b,p=s.p;
        let branches=[];
        if(s.kind==="ellipse")branches=[ellipsePoints(a,b)];
        else if(s.kind==="hyperbola"){
          const reach=Math.max(Math.abs(vx0),Math.abs(vx1))/a*0.98;
          const tMax=reach>1?Math.acosh(reach):1;
          branches=hyperbolaPoints(a,b,tMax);
        }else if(s.kind==="parabola")branches=[parabolaPoints(p,vy1*0.95)];
        else{warn("conic: 알 수 없는 kind '"+s.kind+"'");break;}
        let maxL=0;
        for(const br of branches){
          const pts=toPxPts(br);addObstacles(pts);
          maxL=Math.max(maxL,polyLength(pts));
          items.push({step:i,zone:"svg",kind:"curve",pts,color:accent,width:2.8,dur:TIMING.drawOn});
        }
        dur=maxL>LONG_CURVE_PX?TIMING.drawOnLong:TIMING.drawOn;
        const show=s.show||[];
        if(show.includes("asymptotes")&&s.kind==="hyperbola"){
          for(const sign of[1,-1]){
            const pts=[m.toPx(vx0,sign*(b/a)*vx0),m.toPx(vx1,sign*(b/a)*vx1)];
            items.push({step:i,zone:"svg",kind:"dash",pts,color:t.muted,width:1.8,dash:"7 8"});
            addObstacles(pts,1);
          }
        }
        if(show.includes("foci")){
          const foci=conicFoci(s.kind,a,b,p);
          foci.forEach((F,fi)=>addPoint(i,F,foci.length>1?(fi===0?"F":"F'"):"F",t.point));
        }
        if(show.includes("vertices")){
          if(s.kind==="parabola")addPoint(i,[0,0],null,t.chalk);
          else for(const sign of[1,-1])addPoint(i,[sign*a,0],null,t.chalk);
        }
        break;
      }
      case "formula":
        items.push({step:i,zone:"html",kind:"formula",tex:s.tex,box:s.box!==false});
        break;
      case "lines":{
        const arr=Array.isArray(s.tex)?s.tex:[s.tex];
        if(arr.length>6)warn("lines: 카드당 유도 6줄 초과 — 스크립트를 나누세요(§1-⑥)");
        items.push({step:i,zone:"html",kind:"lines",tex:arr,mutedExceptLast:s.mutedExceptLast!==false});
        dur=arr.length*TIMING.lineWrite+(arr.length-1)*TIMING.lineGap;
        break;
      }
      case "chip":
        items.push({step:i,zone:"html",kind:"chip",text:s.text});
        break;
      case "pill":
        items.push({step:i,zone:"html",kind:"pill",text:s.text});
        break;
      default:
        warn("알 수 없는 step type '"+s.type+"' — 건너뜀");
    }
    durs.push(dur);
  });
  return { items, durs, mapping:m, tokens:t, accent, total:steps.length };
}

/* ── reduced-motion ── */
function usePrefersReducedMotion(){
  const get=()=>typeof window!=="undefined"&&window.matchMedia
    &&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [r,setR]=useState(get);
  useEffect(()=>{
    if(!window.matchMedia)return;
    const mq=window.matchMedia("(prefers-reduced-motion: reduce)");
    const f=()=>setR(mq.matches);
    if(mq.addEventListener){mq.addEventListener("change",f);return()=>mq.removeEventListener("change",f);}
    mq.addListener(f);return()=>mq.removeListener(f);
  },[]);
  return r;
}

/* ── 스텝 플레이어: 재생/일시정지/이전/다음/스크럽 (§2-2) ── */
function useMathVizPlayer(total, durs, {autoplay=true, reduced=false}={}){
  const start=(reduced||!autoplay)?Math.max(0,total-1):0;
  const [step,setStepRaw]=useState(start);
  const [playing,setPlaying]=useState(!reduced&&autoplay&&total>1);
  const timer=useRef(null);
  useEffect(()=>{
    if(!playing)return;
    if(step>=total-1){setPlaying(false);return;}
    timer.current=setTimeout(()=>setStepRaw(s=>Math.min(s+1,total-1)),(durs[step]||500)+TIMING.lineGap);
    return()=>clearTimeout(timer.current);
  },[playing,step,total,durs]);
  const setStep=(i)=>{setPlaying(false);setStepRaw(Math.max(0,Math.min(total-1,i)));};
  const toggle=()=>{
    if(playing){setPlaying(false);return;}
    if(step>=total-1)setStepRaw(0);
    setPlaying(true);
  };
  return { step, setStep, playing, toggle,
    next:()=>setStep(step+1), prev:()=>setStep(step-1) };
}

/* ── 스펙 → 엘리먼트 ── */
function renderSvgItem(it, idx, cur, reduced, compiled){
  const animate=!reduced&&it.step===cur;
  const anim={animate,dur:it.dur||compiled.durs[it.step]||500,delay:0};
  const key=idx+(animate?"-a"+cur:"");
  switch(it.kind){
    case "axes":
      return <Axis key={key} mapping={compiled.mapping} ticks={it.ticks}
        chalk={compiled.tokens.chalk} grid={compiled.tokens.muted} anim={anim}/>;
    case "curve": return <Curve key={key} pts={it.pts} color={it.color} width={it.width} anim={anim}/>;
    case "dash":  return <DashedLine key={key} pts={it.pts} color={it.color} width={it.width} dash={it.dash} anim={anim}/>;
    case "dot":   return <PointDot key={key} at={it.at} color={it.color} anim={{...anim,dur:400}}/>;
    case "label": return <SvgLabel key={key} at={it.at} text={it.text} color={it.color} fontSize={it.fontSize} anim={{...anim,dur:400,delay:120}}/>;
    case "area":  return <AreaFill key={key} pts={it.pts} color={it.color} opacity={it.opacity} anim={{...anim,dur:TIMING.cardFade}}/>;
    default: return null;
  }
}
function renderHtmlItem(it, idx, cur, reduced, compiled){
  const animate=!reduced&&it.step===cur;
  const anim={animate,dur:TIMING.cardFade,delay:0};
  const key=idx+(animate?"-a"+cur:"");
  const t=compiled.tokens;
  switch(it.kind){
    case "formula": return <FormulaBox key={key} tex={it.tex} color={compiled.accent} box={it.box} anim={anim}/>;
    case "lines":   return <Lines key={key} tex={it.tex} mutedExceptLast={it.mutedExceptLast}
      muted={t.muted} accent={compiled.accent} anim={anim} lineWrite={reduced?0:TIMING.lineWrite} lineGap={reduced?0:TIMING.lineGap}/>;
    case "chip":    return <Chip key={key} text={it.text} color={compiled.accent} anim={anim}/>;
    case "pill":    return <Pill key={key} text={it.text} chalk={t.chalk} anim={anim}/>;
    default: return null;
  }
}

/* ── 메인 컴포넌트 ──
   script: §2-1 장면 스크립트 JSON / theme: "dark"|"light" / controls: 스텝 제어 UI
   autoplay: 마운트 시 자동 재생 / staticOnly: 최종 상태만(검수 미리보기용) */
function MathViz({script, theme="dark", controls=true, autoplay=true, staticOnly=false, className}){
  const reduced=usePrefersReducedMotion()||staticOnly;
  const compiled=useMemo(()=>{
    try{return compileScript(script||{},theme);}
    catch(e){console.warn("[MathViz] 스크립트 컴파일 실패",e);return null;}
  },[script,theme]);
  const total=compiled?compiled.total:0;
  const player=useMathVizPlayer(total,compiled?compiled.durs:[],{autoplay:autoplay&&!staticOnly,reduced});
  if(!compiled||!total)return null;
  const {mapping:m,tokens:t}=compiled;
  const cur=player.step;
  const chips=compiled.items.filter(it=>it.zone==="html"&&it.kind==="chip"&&it.step<=cur);
  const blocks=compiled.items.filter(it=>it.zone==="html"&&it.kind!=="chip"&&it.step<=cur);
  return (
    <div className={"mathviz theme-"+theme+(className?" "+className:"")}
      style={{background:t.board,borderColor:t.grid}}>
      <svg className="mathviz-board" viewBox={`0 0 ${m.W} ${m.H}`}
        style={{background:t.bg}} role="img" aria-label="수학 그래프">
        {compiled.items.map((it,idx)=>it.zone==="svg"&&it.step<=cur
          ?renderSvgItem(it,idx,cur,reduced,compiled):null)}
      </svg>
      {(blocks.length>0||chips.length>0)&&(
        <div className="viz-caption">
          {blocks.map((it,idx)=>renderHtmlItem(it,"b"+idx,cur,reduced,compiled))}
          {chips.length>0&&<div className="viz-chiprow">
            {chips.map((it,idx)=>renderHtmlItem(it,"c"+idx,cur,reduced,compiled))}
          </div>}
        </div>
      )}
      {controls&&!staticOnly&&total>1&&(
        <div className="viz-controls" style={{color:t.muted}}>
          <button type="button" aria-label="이전 단계" onClick={player.prev} disabled={cur<=0}>◀</button>
          <button type="button" aria-label={player.playing?"일시정지":"재생"} onClick={player.toggle}>
            {player.playing?"❚❚":"▶"}
          </button>
          <button type="button" aria-label="다음 단계" onClick={player.next} disabled={cur>=total-1}>▶</button>
          <input type="range" min={0} max={total-1} value={cur} aria-label="단계 이동"
            onChange={(e)=>player.setStep(+e.target.value)}/>
          <span className="viz-stepnum">{cur+1}/{total}</span>
        </div>
      )}
    </div>
  );
}

export { MathViz, compileScript, useMathVizPlayer, makeMapping };
