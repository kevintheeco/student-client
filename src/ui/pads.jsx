import { prepImage, transcribeFile } from "../core/ai.js";
import { tr } from "../core/platform.js";
import React from "react";
const { useState, useEffect, useRef, useCallback } = React;

const PEN_ERASE_DEBOUNCE=140; // ms: 드래그 중 버튼 신호 깜빡임 무시
function penBarrelHeld(e){
  if(e.pointerType==="eraser")return true;
  if(e.pointerType!=="pen")return false;
  return !!(e.buttons&2)||!!(e.buttons&32)||e.button===2||e.button===5;
}
// 지금 이 순간 지우개여야 하나? lastSeenRef로 신호 깜빡임을 디바운스.
function eraseNow(e,lastSeenRef,toolIsEraser){
  if(toolIsEraser)return true;
  const now=e.timeStamp||performance.now();
  if(penBarrelHeld(e)){lastSeenRef.current=now;return true;}
  if(e.pointerType==="pen"&&lastSeenRef.current&&now-lastSeenRef.current<PEN_ERASE_DEBOUNCE)return true;
  return false;
}

/* ── 팜 리젝션: 펜이 쓰기 칸 근처에 오면(호버 포함) 페이지 스크롤을 통째로 얼린다.
   손바닥이 '먼저' 닿아 브라우저가 이미 스크롤 제스처를 시작한 경우, 나중의 preventDefault로는
   못 멈추므로(cancelable=false) overflow:hidden으로 스크롤 자체를 즉시 동결하는 방식.
   펜이 떠나고 0.9초 지나면 자동 해제 — 펜을 치우면 손가락 스크롤은 평소처럼 동작. ── */
const _penNearAt={t:0};
let _scrollLockT=null;
function _freezeScroll(){
  document.documentElement.style.overflow="hidden";
  document.body.style.overflow="hidden";
}
function _thawScroll(){
  document.documentElement.style.overflow="";
  document.body.style.overflow="";
}
function penSeen(){
  _penNearAt.t=Date.now();
  _freezeScroll();
  clearTimeout(_scrollLockT);
  _scrollLockT=setTimeout(_thawScroll,900);
}
function usePalmBlock(drawingRef){
  useEffect(()=>{
    const block=(e)=>{if(e.cancelable&&(drawingRef.current||Date.now()-_penNearAt.t<900))e.preventDefault();};
    document.addEventListener("touchstart",block,{passive:false});
    document.addEventListener("touchmove",block,{passive:false});
    return()=>{
      document.removeEventListener("touchstart",block);
      document.removeEventListener("touchmove",block);
      clearTimeout(_scrollLockT);_thawScroll();   // 패드가 사라지면 스크롤 잠금도 반드시 해제
    };
  },[]);
}

/* ── 해설 오버레이 캔버스 (투명, 형광펜·초록펜이 텍스트 위에 직접 표시) ── */
const AnnotPad=React.forwardRef(function AnnotPad({disabled,tool},fwdRef){
  const cvs=useRef(null);
  const strokes=useRef([]);
  const drawing=useRef(false);
  const eraseGesture=useRef(false);
  const lastBtn=useRef(0);
  usePalmBlock(drawing);
  React.useImperativeHandle(fwdRef,()=>({
    getImageBase64:()=>cvs.current?.toDataURL("image/png").split(",")[1]||null,
    hasStrokes:()=>strokes.current.length>0,
    clear:()=>{strokes.current=[];redraw();},
  }));
  function syncSize(){
    const c=cvs.current;if(!c)return;
    const p=c.parentElement;if(!p)return;
    const rect=p.getBoundingClientRect();
    const w=Math.round(rect.width),h=Math.round(rect.height);
    if(!w||!h)return;
    const dpr=window.devicePixelRatio||1;
    c.style.width=w+"px";c.style.height=h+"px";
    c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);
    const ctx=c.getContext("2d");ctx.setTransform(1,0,0,1,0,0);ctx.scale(dpr,dpr);
    redraw();
  }
  function redraw(){
    const c=cvs.current;if(!c)return;
    const ctx=c.getContext("2d"),dpr=window.devicePixelRatio||1,w=c.width/dpr,h=c.height/dpr;
    ctx.clearRect(0,0,w,h);
    strokes.current.forEach(({pts,col,sz})=>{
      if(pts.length<2)return;
      ctx.lineCap="round";ctx.lineJoin="round";ctx.strokeStyle=col;ctx.lineWidth=sz;
      ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
      for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);
      ctx.stroke();
    });
  }
  React.useLayoutEffect(()=>{
    syncSize();
    const parent=cvs.current?.parentElement;if(!parent)return;
    const ro=new ResizeObserver(syncSize);ro.observe(parent);
    window.addEventListener("resize",syncSize);
    return()=>{ro.disconnect();window.removeEventListener("resize",syncSize);};
  },[]);
  useEffect(()=>{
    const c=cvs.current;if(!c)return;
    const prev=(e)=>e.preventDefault();   // 쓰기 칸 위에선 어떤 터치·펜도 스크롤 금지 — 써지는 기능만 (touch-action:none의 이중 안전장치)
    c.addEventListener("touchstart",prev,{passive:false});
    c.addEventListener("touchmove",prev,{passive:false});
    return()=>{c.removeEventListener("touchstart",prev);c.removeEventListener("touchmove",prev);};
  },[]);
  const pt=(e)=>{const r=cvs.current.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
  function eraseAt(x,y){
    const R=16*16,prev=strokes.current.length;
    strokes.current=strokes.current.filter(({pts})=>!pts.some(p=>(p.x-x)**2+(p.y-y)**2<R));
    if(strokes.current.length!==prev)redraw();
  }
  function startStroke(p){
    drawing.current=true;
    if(strokes.current.length>=500)strokes.current.shift();
    strokes.current.push({pts:[p],col:tool==="hl"?"rgb(255,230,0)":"#27AE60",sz:tool==="hl"?20:2.5});
  }
  function down(e){
    if(e.pointerType==="pen")penSeen();
    if(disabled||e.pointerType!=="pen")return;
    e.preventDefault();
    try{e.target.setPointerCapture(e.pointerId);}catch(_){}
    const p=pt(e);
    if(eraseNow(e,lastBtn,tool==="eraser")){eraseGesture.current=true;drawing.current=false;eraseAt(p.x,p.y);return;}
    eraseGesture.current=false;
    startStroke(p);
  }
  function move(e){
    if(e.pointerType==="pen")penSeen();
    if(disabled||e.pointerType!=="pen")return;
    const p=pt(e);
    if(eraseNow(e,lastBtn,tool==="eraser")){
      e.preventDefault();
      if(drawing.current){const st=strokes.current[strokes.current.length-1];if(st&&st.pts.length<2)strokes.current.pop();drawing.current=false;}
      eraseGesture.current=true;eraseAt(p.x,p.y);return;
    }
    if(eraseGesture.current){eraseGesture.current=false;e.preventDefault();startStroke(p);return;}
    if(!drawing.current)return;
    e.preventDefault();
    const st=strokes.current[strokes.current.length-1];if(!st)return;
    st.pts.push(p);
    const ctx=cvs.current.getContext("2d");
    ctx.lineCap="round";ctx.lineJoin="round";ctx.strokeStyle=st.col;ctx.lineWidth=st.sz;
    if(st.pts.length>1){ctx.beginPath();ctx.moveTo(st.pts[st.pts.length-2].x,st.pts[st.pts.length-2].y);ctx.lineTo(p.x,p.y);ctx.stroke();}
  }
  const up=()=>{drawing.current=false;eraseGesture.current=false;lastBtn.current=0;};
  return(
    <canvas ref={cvs}
      style={{position:"absolute",top:0,left:0,
        mixBlendMode:"multiply",touchAction:"none",zIndex:5,
        cursor:disabled?"not-allowed":tool==="eraser"?"cell":"crosshair",
        pointerEvents:disabled?"none":"auto"}}
      onPointerDown={down} onPointerMove={move} onPointerUp={up}
      onPointerLeave={up} onPointerCancel={up}
      onContextMenu={e=>{e.preventDefault();const p=pt(e);eraseAt(p.x,p.y);}}/>
  );
});

/* ── 질문 손글씨 패드 (단독, 배경 있음) ── */
const QuestionPad=React.forwardRef(function QuestionPad({disabled,tool="pen",onInk},fwdRef){
  const cvs=useRef(null);const strokes=useRef([]);const drawing=useRef(false);
  const eraseGesture=useRef(false);const lastBtn=useRef(0);
  usePalmBlock(drawing);
  const notifyInk=()=>onInk&&onInk(strokes.current.length>0);
  React.useImperativeHandle(fwdRef,()=>({
    getImageBase64:()=>cvs.current?.toDataURL("image/png").split(",")[1]||null,
    hasStrokes:()=>strokes.current.length>0,
    clear:()=>{strokes.current=[];redraw();notifyInk();},
    undo:()=>{if(strokes.current.length>0){strokes.current.pop();redraw();notifyInk();}},
  }));
  const getDpr=()=>window.devicePixelRatio||1;
  function setup(){
    const c=cvs.current;if(!c)return;
    const r=c.getBoundingClientRect(),dpr=getDpr();
    c.width=Math.round(r.width*dpr);c.height=Math.round(r.height*dpr);
    const ctx=c.getContext("2d");ctx.setTransform(1,0,0,1,0,0);ctx.scale(dpr,dpr);redraw();
  }
  function redraw(){
    const c=cvs.current;if(!c)return;
    const ctx=c.getContext("2d"),dpr=getDpr(),w=c.width/dpr,h=c.height/dpr;
    ctx.fillStyle="#FFFDF8";ctx.fillRect(0,0,w,h);
    ctx.strokeStyle="#EDE9F0";ctx.lineWidth=1;
    for(let y=28;y<h;y+=28){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
    strokes.current.forEach(({pts})=>{
      if(pts.length<2)return;
      ctx.lineCap="round";ctx.lineJoin="round";ctx.strokeStyle="#221C39";ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
      for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();
    });
  }
  useEffect(()=>{setup();const f=()=>setup();window.addEventListener("resize",f);return()=>window.removeEventListener("resize",f);},[]);
  useEffect(()=>{
    const c=cvs.current;if(!c)return;
    const prev=(e)=>e.preventDefault();   // 쓰기 칸 위에선 어떤 터치·펜도 스크롤 금지 — 써지는 기능만 (touch-action:none의 이중 안전장치)
    c.addEventListener("touchstart",prev,{passive:false});
    c.addEventListener("touchmove",prev,{passive:false});
    return()=>{c.removeEventListener("touchstart",prev);c.removeEventListener("touchmove",prev);};
  },[]);
  const pt=(e)=>{const r=cvs.current.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
  function eraseAt(x,y){
    const R=12*12,prev=strokes.current.length;
    strokes.current=strokes.current.filter(({pts})=>!pts.some(p=>(p.x-x)**2+(p.y-y)**2<R));
    if(strokes.current.length!==prev){redraw();notifyInk();}
  }
  function startStroke(p){
    drawing.current=true;
    if(strokes.current.length>=500)strokes.current.shift();
    strokes.current.push({pts:[p]});
  }
  function down(e){
    if(e.pointerType==="pen")penSeen();
    if(disabled)return;
    if(e.pointerType!=="pen")return;
    e.preventDefault();
    const p=pt(e);
    if(eraseNow(e,lastBtn,tool==="eraser")){eraseGesture.current=true;drawing.current=false;eraseAt(p.x,p.y);return;}
    eraseGesture.current=false;
    try{e.target.setPointerCapture(e.pointerId);}catch(_){}
    startStroke(p);
  }
  function move(e){
    if(e.pointerType==="pen")penSeen();
    if(e.pointerType!=="pen"){drawing.current=false;return;}
    if(disabled)return;
    const p=pt(e);
    if(eraseNow(e,lastBtn,tool==="eraser")){
      e.preventDefault();
      if(drawing.current){const st=strokes.current[strokes.current.length-1];if(st&&st.pts.length<2)strokes.current.pop();drawing.current=false;}
      eraseGesture.current=true;eraseAt(p.x,p.y);return;
    }
    if(eraseGesture.current){eraseGesture.current=false;e.preventDefault();startStroke(p);return;}
    if(!drawing.current)return;
    e.preventDefault();
    const st=strokes.current[strokes.current.length-1];if(!st)return;
    st.pts.push(p);
    const ctx=cvs.current.getContext("2d");
    ctx.lineCap="round";ctx.lineJoin="round";ctx.strokeStyle="#221C39";ctx.lineWidth=2;
    if(st.pts.length>1){ctx.beginPath();ctx.moveTo(st.pts[st.pts.length-2].x,st.pts[st.pts.length-2].y);ctx.lineTo(st.pts[st.pts.length-1].x,st.pts[st.pts.length-1].y);ctx.stroke();}
  }
  const up=()=>{drawing.current=false;eraseGesture.current=false;lastBtn.current=0;notifyInk();};
  return(
    <canvas ref={cvs} className="pad"
      style={{height:110,cursor:disabled?"not-allowed":tool==="eraser"?"cell":"crosshair",borderRadius:12}}
      onPointerDown={down} onPointerMove={move} onPointerUp={up}
      onPointerLeave={up} onPointerCancel={up}
      onContextMenu={e=>{e.preventDefault();const p=pt(e);eraseAt(p.x,p.y);}}/>
  );
});

/* ── 풀사이즈 펜 패드 ── */
const PEN_COLORS=["#221C39","#2563EB","#DC2626"];
const PEN_LABELS=["검정","파랑","빨강"];

const PenPad=React.forwardRef(function PenPad({kind,onText,disabled,hideOcr,penOnlyDefault=false,highlights,highlightSize,onTypeMode},fwdRef){
  const canvasRef=useRef(null);
  const pages=useRef([[]]);                 // 장(page)별 획 배열 — 장을 넘겨도 메모리에 그대로 보존됨
  const curRef=useRef(0);                   // 지금 보고 있는 장 index
  const strokes=useRef(pages.current[0]);   // 항상 현재 장을 가리키는 별칭 (기존 그리기 코드 호환)
  const redoRef=useRef([]);                 // 다시 실행(redo) 스택 — 취소·전체지우기·지우개로 사라진 획 되살리기
  const [pgUI,setPgUI]=useState({i:0,n:1}); // 페이지 표시/버튼 갱신용
  const drawing=useRef(false);
  const eraseGesture=useRef(false);   // 지금 버튼-지우개 중인지
  const lastBtn=useRef(0);            // 버튼 신호 마지막으로 본 시각(디바운스용)
  usePalmBlock(drawing);
  const [tool,setTool]=useState("pen");
  const [color,setColor]=useState(PEN_COLORS[0]);
  const [size,setSize]=useState(1);
  const [busy,setBusy]=useState(false);
  const [padErr,setPadErr]=useState("");
  const [hasInk,setHasInk]=useState(false);
  const [canRedo,setCanRedo]=useState(false);   // ↪ 다시 버튼 활성화 여부
  const [penOnly,setPenOnly]=useState(penOnlyDefault);
  const cpStroke=(s)=>({pts:s.pts.slice(),col:s.col,sz:s.sz});

  React.useImperativeHandle(fwdRef,()=>({
    getImageBase64:()=>exportAllPages(),
    hasStrokes:()=>pages.current.some(p=>p.length>0),
    clear:()=>{pages.current=[[]];curRef.current=0;strokes.current=pages.current[0];redraw();setHasInk(false);setPadErr("");setPgUI({i:0,n:1});},
    forceColor:(c)=>{setColor(c);setTool("pen");},
    setEraser:()=>setTool("eraser"),
    setPen:()=>setTool("pen"),
    getSize:()=>exportSize(),
    // 풀이 통계(시도 로그용): 총 획수·페이지 수 — 이미지 없이 풀이 분량을 수치로 남긴다
    strokeStats:()=>({st:pages.current.reduce((s,p)=>s+p.length,0),pg:pages.current.length}),
    // 시험 모드: 문항 넘겨도 손글씨를 보존·재편집하려고 획 데이터를 통째로 빼고/싣는다
    dump:()=>{const c=canvasRef.current,dpr=getDpr();return{pages:pages.current.map(pg=>pg.map(s=>({pts:s.pts.slice(),col:s.col,sz:s.sz}))),w:c?c.width/dpr:800,h:c?c.height/dpr:340};},
    load:(data)=>{const pgs=(data&&Array.isArray(data.pages)&&data.pages.length)?data.pages:[[]];pages.current=pgs.map(pg=>pg.map(s=>({pts:(s.pts||[]).slice(),col:s.col,sz:s.sz})));curRef.current=0;strokes.current=pages.current[0];redraw();setHasInk(pages.current.some(p=>p.length>0));setPgUI({i:0,n:pages.current.length});},
  }));

  const getDpr=()=>window.devicePixelRatio||1;
  function setup(){
    const c=canvasRef.current;if(!c)return;
    const r=c.getBoundingClientRect(),dpr=getDpr();
    c.width=Math.round(r.width*dpr);c.height=Math.round(r.height*dpr);
    const ctx=c.getContext("2d");ctx.setTransform(1,0,0,1,0,0);ctx.scale(dpr,dpr);
    redraw();
  }
  function paintStrokes(ctx,arr){
    arr.forEach(({pts,col,sz})=>{
      if(pts.length<2)return;
      ctx.lineCap="round";ctx.lineJoin="round";
      ctx.globalCompositeOperation="source-over";ctx.strokeStyle=col;
      for(let i=1;i<pts.length;i++){
        ctx.beginPath();ctx.lineWidth=sz*(0.8+(pts[i].p||.5)*0.4)*2;
        ctx.moveTo(pts[i-1].x,pts[i-1].y);ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();
      }
    });
  }
  function redraw(){
    const c=canvasRef.current;if(!c)return;
    const ctx=c.getContext("2d");
    const dpr=getDpr();const w=c.width/dpr,h=c.height/dpr;
    ctx.fillStyle="#FFFDF8";ctx.fillRect(0,0,w,h);
    ctx.strokeStyle="#EDE9F0";ctx.lineWidth=1;
    for(let y=32;y<h;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
    paintStrokes(ctx,strokes.current);
  }
  // 잉크가 있는 마지막 장까지 카운트 (빈 뒤쪽 장은 내보내지 않음)
  function exportCount(){let last=0;pages.current.forEach((p,i)=>{if(p.length)last=i;});return last+1;}
  function exportSize(){const c=canvasRef.current;if(!c)return{w:800,h:680};return{w:c.width,h:c.height*exportCount()};}
  // 모든 장을 세로로 이어붙여 하나의 PNG로 — 채점·OCR은 전체를 한 장처럼 봄
  function exportAllPages(){
    const c=canvasRef.current;if(!c)return null;
    const dpr=getDpr();const cssW=c.width/dpr,cssH=c.height/dpr;const n=exportCount();
    const off=document.createElement("canvas");off.width=c.width;off.height=c.height*n;
    const ctx=off.getContext("2d");ctx.scale(dpr,dpr);
    for(let i=0;i<n;i++){
      ctx.save();ctx.translate(0,i*cssH);
      ctx.fillStyle="#FFFDF8";ctx.fillRect(0,0,cssW,cssH);
      paintStrokes(ctx,pages.current[i]);
      ctx.restore();
    }
    return off.toDataURL("image/png").split(",")[1];
  }
  function showPage(i){if(i<0||i>=pages.current.length)return;curRef.current=i;strokes.current=pages.current[i];redraw();setPgUI({i,n:pages.current.length});}
  function addPage(){pages.current.push([]);showPage(pages.current.length-1);}
  useEffect(()=>{setup();const f=()=>setup();window.addEventListener("resize",f);return()=>window.removeEventListener("resize",f);},[]);
  useEffect(()=>{
    const c=canvasRef.current;if(!c)return;
    const prev=(e)=>e.preventDefault();   // 쓰기 칸 위에선 어떤 터치·펜도 스크롤 금지 — 써지는 기능만 (touch-action:none의 이중 안전장치)
    c.addEventListener("touchstart",prev,{passive:false});
    c.addEventListener("touchmove",prev,{passive:false});
    return()=>{c.removeEventListener("touchstart",prev);c.removeEventListener("touchmove",prev);};
  },[]);

  const pt=(e)=>{const r=canvasRef.current.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top,p:e.pressure||.5};};
  function eraseAt(x,y){
    const R=13*13;
    const before=strokes.current;
    const kept=before.filter(({pts})=>
      !pts.some(p=>(p.x-x)*(p.x-x)+(p.y-y)*(p.y-y)<R)
    );
    if(kept.length!==before.length){
      const removed=before.filter(s=>kept.indexOf(s)<0);
      redoRef.current.push({page:curRef.current,strokes:removed.map(cpStroke)});setCanRedo(true);
      strokes.current=kept;pages.current[curRef.current]=strokes.current;
      redraw();setHasInk(pages.current.some(p=>p.length>0));
    }
  }
  function startStroke(p){
    drawing.current=true;
    redoRef.current=[];setCanRedo(false);   // 새 획을 그으면 redo 무효
    if(strokes.current.length>=500)strokes.current.shift();
    strokes.current.push({pts:[p],col:color,sz:size});
  }
  function down(e){
    if(e.pointerType==="pen")penSeen();
    if(disabled)return;
    if(penOnly&&e.pointerType!=="pen")return;
    e.preventDefault();
    try{e.target.setPointerCapture(e.pointerId);}catch(_){}
    const p=pt(e);
    if(eraseNow(e,lastBtn,tool==="eraser")){
      eraseGesture.current=true;
      drawing.current=false;
      eraseAt(p.x,p.y);
      return;
    }
    eraseGesture.current=false;
    startStroke(p);
  }
  function move(e){
    if(e.pointerType==="pen")penSeen();
    if(disabled)return;
    if(penOnly&&e.pointerType!=="pen"){drawing.current=false;return;}
    const p=pt(e);
    if(eraseNow(e,lastBtn,tool==="eraser")){
      e.preventDefault();
      if(drawing.current){   // 그리던 중 버튼 누름 → 짧은 점 획은 버리고 지우개로
        const st=strokes.current[strokes.current.length-1];
        if(st&&st.pts.length<2)strokes.current.pop();
        drawing.current=false;
      }
      eraseGesture.current=true;
      eraseAt(p.x,p.y);
      return;
    }
    if(eraseGesture.current){   // 버튼에서 손 뗌 → 펜으로 복귀, 여기서부터 새 획
      eraseGesture.current=false;
      e.preventDefault();
      startStroke(p);
      return;
    }
    if(!drawing.current)return;
    e.preventDefault();
    const st=strokes.current[strokes.current.length-1];
    if(!st)return;
    st.pts.push(p);
    const ctx=canvasRef.current.getContext("2d");
    if(st.pts.length>1){
      ctx.lineCap="round";ctx.lineJoin="round";
      ctx.globalCompositeOperation="source-over";ctx.strokeStyle=st.col;
      ctx.beginPath();ctx.lineWidth=st.sz*(0.8+(p.p||.5)*0.4)*2;
      ctx.moveTo(st.pts[st.pts.length-2].x,st.pts[st.pts.length-2].y);ctx.lineTo(p.x,p.y);ctx.stroke();
    }
    if(!hasInk)setHasInk(true);
  }
  const up=()=>{drawing.current=false;eraseGesture.current=false;lastBtn.current=0;};
  const cancel=()=>{drawing.current=false;eraseGesture.current=false;lastBtn.current=0;};
  function undo(){
    if(disabled)return;
    const popped=strokes.current.pop();
    if(popped){redoRef.current.push({page:curRef.current,stroke:cpStroke(popped)});setCanRedo(true);}
    redraw();setHasInk(pages.current.some(p=>p.length>0));
  }
  function clearPad(){
    const hadInk=pages.current.some(p=>p.length>0);
    const snap=pages.current.map(pg=>pg.map(cpStroke));
    pages.current=[[]];curRef.current=0;strokes.current=pages.current[0];redraw();setHasInk(false);setPadErr("");setPgUI({i:0,n:1});
    if(hadInk){redoRef.current=[{clearSnap:snap,cur:0}];setCanRedo(true);}   // 통째로 복구용(이전 redo는 버림)
  }
  function redoFn(){
    if(disabled)return;
    const e=redoRef.current.pop();
    if(!e){setCanRedo(false);return;}
    if(e.clearSnap){
      pages.current=e.clearSnap.map(pg=>pg.map(cpStroke));
      curRef.current=Math.min(e.cur||0,pages.current.length-1);
      strokes.current=pages.current[curRef.current];
      setPgUI({i:curRef.current,n:pages.current.length});
    }else{
      const pi=Math.min(e.page||0,pages.current.length-1);
      curRef.current=pi;strokes.current=pages.current[pi];
      (e.stroke?[e.stroke]:(e.strokes||[])).forEach(s=>strokes.current.push(s));
      setPgUI({i:pi,n:pages.current.length});
    }
    redraw();setHasInk(pages.current.some(p=>p.length>0));setCanRedo(redoRef.current.length>0);
  }
  async function recognize(){
    if(!hasInk){setPadErr(tr("먼저 써봐.","Write something first."));return;}
    setBusy(true);setPadErr("");
    try{
      const data=exportAllPages();
      const t=await transcribeFile(data,"image/png",kind);
      onText((t||"").trim());clearPad();
    }catch(e){setPadErr("인식 실패: "+e.message);}
    setBusy(false);
  }

  return(
    <div className="pen-wrap">
      <div className="pen-toolbar">
        <button className={"btn ico gho sm"+(tool==="pen"?" on":"")} onClick={()=>setTool("pen")} title="펜" disabled={disabled}>✏️</button>
        <button className={"btn ico gho sm"+(tool==="eraser"?" on":"")} onClick={()=>setTool("eraser")} title="지우개" disabled={disabled}>🧽</button>
        <div className="sep"/>
        {PEN_COLORS.map((c,i)=>(
          <button key={c} className={"color-btn"+(color===c&&tool==="pen"?" on":"")}
            style={{background:c}} title={PEN_LABELS[i]}
            onClick={()=>{setColor(c);setTool("pen");}}/>
        ))}
        <div className="sep"/>
        <div className="size-row">
          <span>굵기</span>
          <input type="range" min="1" max="10" step="0.5" value={size} onChange={e=>setSize(Number(e.target.value))}/>
          <span style={{minWidth:22,textAlign:"right"}}>{size}</span>
        </div>
        <div className="sep"/>
        <button className="btn gho xs" onClick={undo} disabled={busy||disabled}>↩ {tr("취소","Undo")}</button>
        <button className="btn gho xs" onClick={redoFn} disabled={busy||disabled||!canRedo} title={tr("실수로 취소·지운 획 되살리기","Redo — bring back undone/erased strokes")}>↪ {tr("다시","Redo")}</button>
        <button className="btn gho xs" onClick={clearPad} disabled={busy||disabled}>🗑️ {tr("전체","Clear")}</button>
        <div className="sep"/>
        <button className={"btn gho xs"+(penOnly?" on":"")} onClick={()=>setPenOnly(v=>!v)}
          title={penOnly?tr("펜 전용 ON — 손가락 터치 무시 중 (S펜·Apple Pencil)","Pen only — ignoring finger touch (S Pen·Apple Pencil)"):tr("터치·마우스도 허용 중","Touch & mouse allowed")}>
          ✒️ {penOnly?tr("펜 전용","Pen only"):tr("터치","Touch")}
        </button>
        {onTypeMode&&<button className="btn gho xs" onClick={onTypeMode} disabled={disabled}
          title={tr("타이핑으로 답하기 — 큰 답안지","Type your answer — big sheet")}>⌨️ {tr("타이핑","Type")}</button>}
      </div>
      <div style={{position:"relative",width:"100%",touchAction:"none"}}>
        <canvas ref={canvasRef} className={"pad"+(tool==="eraser"?" eraser":"")}
          style={{touchAction:"none",...(disabled?{opacity:.55,pointerEvents:"none"}:{})}}
          onPointerDown={down} onPointerMove={move} onPointerUp={up}
          onPointerLeave={up} onPointerCancel={cancel}
          onContextMenu={e=>{e.preventDefault();const p=pt(e);eraseAt(p.x,p.y);}}/>
        {highlights&&highlights.length>0&&canvasRef.current&&highlights.map((h,i)=>{
          const pw=canvasRef.current.width,ph=canvasRef.current.height; // 한 장의 device px
          const pageOf=Math.floor(h.y/ph);          // 이 박스가 속한 장
          if(pageOf!==curRef.current)return null;    // 다른 장의 표시는 그 장을 펼쳤을 때만
          const ly=h.y-pageOf*ph;
          return(
          <div key={i} style={{position:"absolute",
            left:(h.x/pw*100)+"%",top:(ly/ph*100)+"%",
            width:(h.w/pw*100)+"%",height:(h.h/ph*100)+"%",
            border:"2.5px solid var(--rose)",borderRadius:4,
            background:"rgba(255,107,138,0.16)",boxShadow:"0 0 0 1px rgba(255,255,255,.6)",
            pointerEvents:"none",boxSizing:"border-box"}}>
            <span style={{position:"absolute",top:-9,left:-7,fontSize:11,background:"var(--rose)",color:"#fff",
              borderRadius:"50%",width:16,height:16,lineHeight:"16px",textAlign:"center",fontWeight:700}}>?</span>
          </div>
        );})}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:6,marginTop:8,flexWrap:"wrap"}}>
        <button className="btn gho xs" style={{flex:"0 1 auto"}} onClick={()=>showPage(curRef.current-1)} disabled={disabled||pgUI.i<=0}>◀ {tr("이전","Prev")}</button>
        <span style={{minWidth:54,textAlign:"center",fontSize:12,fontWeight:700,color:"var(--pri-d)"}}>{pgUI.i+1} / {pgUI.n} {tr("장","pg")}</span>
        <button className="btn gho xs" style={{flex:"0 1 auto"}} onClick={()=>showPage(curRef.current+1)} disabled={disabled||pgUI.i>=pgUI.n-1}>{tr("다음","Next")} ▶</button>
        <button className="btn pri xs" style={{flex:"0 1 auto",marginLeft:"auto"}} onClick={addPage} disabled={disabled}>+ {tr("새 장","New page")}</button>
      </div>
      {!hideOcr&&(
        <div className="pen-bottom">
          <span className="ph">{tr("S펜이나 손가락으로 써봐","Write with S Pen or finger")}</span>
          <div className="row">
            <button className="btn pri sm" onClick={recognize} disabled={busy||!hasInk}>
              {busy?tr("인식 중…","Reading…"):tr("✅ 인식해서 넣기","✅ Recognize & add")}
            </button>
          </div>
        </div>
      )}
      {padErr&&<div className="err">{padErr}</div>}
    </div>
  );
});

// 저장된 손글씨 획 데이터(dump 결과)를 라이브 패드 없이 JPEG로 굽는다 — 시험 채점·검토용
function renderInkPNG(data){
  if(!data||!Array.isArray(data.pages)||!data.pages.some(p=>p&&p.length))return null;
  const w=data.w||800,h=data.h||340,n=data.pages.length,dpr=2;
  const c=document.createElement("canvas");c.width=Math.round(w*dpr);c.height=Math.round(h*n*dpr);
  const ctx=c.getContext("2d");ctx.scale(dpr,dpr);
  for(let i=0;i<n;i++){
    ctx.save();ctx.translate(0,i*h);
    ctx.fillStyle="#FFFDF8";ctx.fillRect(0,0,w,h);
    (data.pages[i]||[]).forEach(({pts,col,sz})=>{
      if(!pts||pts.length<2)return;
      ctx.lineCap="round";ctx.lineJoin="round";ctx.strokeStyle=col||"#221C39";
      for(let j=1;j<pts.length;j++){
        ctx.beginPath();ctx.lineWidth=(sz||1)*(0.8+(pts[j].p||.5)*0.4)*2;
        ctx.moveTo(pts[j-1].x,pts[j-1].y);ctx.lineTo(pts[j].x,pts[j].y);ctx.stroke();
      }
    });
    ctx.restore();
  }
  return c.toDataURL("image/jpeg",0.72).split(",")[1];
}
function inkHas(data){return !!(data&&Array.isArray(data.pages)&&data.pages.some(p=>p&&p.length));}

/* ── 사진 버튼 ── */
function PhotoButton({kind,onText,label}){
  const ref=useRef(null);const[busy,setBusy]=useState(false);
  async function handle(e){
    const f=e.target.files&&e.target.files[0];e.target.value="";if(!f)return;
    setBusy(true);
    try{const p=await prepImage(f);const t=await transcribeFile(p.b64,p.mime,kind);onText((t||"").trim());}
    catch(e){alert(tr("인식 실패: ","Recognition failed: ")+e.message);}
    setBusy(false);
  }
  return(
    <>
      <button className="btn gho sm" onClick={()=>ref.current&&ref.current.click()} disabled={busy}>
        {busy?tr("읽는 중…","Reading…"):(label||tr("📷 사진","📷 Photo"))}
      </button>
      <input ref={ref} type="file" accept="image/*" capture="environment" onChange={handle} style={{display:"none"}}/>
    </>
  );
}

/* ── 자료 추가 ── */

export { PEN_ERASE_DEBOUNCE, penBarrelHeld, eraseNow, AnnotPad, QuestionPad, PEN_COLORS, PEN_LABELS, PenPad, renderInkPNG, inkHas, PhotoButton };
