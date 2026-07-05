// GeoFeedback — 기하 상호작용 화면: 손글씨 → 벡터 재구성 → 정답 비교 → 보조선 보완 (§4)
// 학생 원본 잉크는 0.22로 페이드하고, 재구성·보완은 MathViz primitives로 패드 위에 덧그린다.
// pads.jsx는 수정하지 않는다 — dump()로 획만 읽고, 페이드는 캔버스 style만 건드린다.
import React from "react";
import { PenPad } from "./pads.jsx";
import { normalizeStrokes, recognize, compare, dist } from "../core/geointeract.js";
import { logAttempt } from "../core/attempts.js";
import { VIZ_LIGHT } from "./mathviz/tokens.js";
import { Curve, DashedLine, PointDot, SvgLabel, RightAngleMark, FormulaBox } from "./mathviz/primitives.jsx";
import { placeLabel, estimateLabelBox } from "./mathviz/placeLabel.js";

const { useState, useRef } = React;
const T=VIZ_LIGHT;   // 오버레이는 크림색 패드 위에 그림 — 라이트 세트가 4.5:1 확보
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const STEP_NAMES=["① 스트로크 인식","② 벡터 재구성","③ 정답 모델 비교","④ 보조선 보완"];

// 꼭짓점 라벨을 무게중심 반대 방향으로 살짝 밀어 배치
function vertexLabelPos(v, centroid, off=22){
  const dx=v[0]-centroid[0], dy=v[1]-centroid[1];
  const L=Math.hypot(dx,dy)||1;
  return [v[0]+dx/L*off-5, v[1]+dy/L*off-9];
}

// 한글 판정 라벨("내 그림 (오답 풀이)"/"정답 풀이")을 그림·다른 라벨과 안 겹치게 배치 (대표 지시)
function judgeLabel(text, anchor, color, obst, bounds, fontSize=17, delay=1400){
  const {w,h}=estimateLabelBox(text,fontSize);
  const pos=placeLabel({anchor,w,h,obstacles:obst,unit:60,maxBuff:1.6});
  const x=Math.max(6,Math.min(bounds.w-w-6,pos.x));      // 캔버스 밖으로 안 나가게 클램프
  const y=Math.max(6,Math.min(bounds.h-h-6,pos.y));
  obst.push([x,y],[x+w,y],[x,y+h],[x+w,y+h],[x+w/2,y+h/2]);
  return {kind:"label",at:[x,y],text,color,fontSize,delay};
}

function GeoFeedback({
  title="삼각형 ABC의 넓이를 구하기 위한 그림을 완성하시오. (필요한 보조선 포함)",
  requirements,            // {aux:["height"]} — 5단계부터 기출은행 정답 모델이 공급
  concept="삼각형의 넓이 작도", unit="평면도형",
  penOnly=false, onGraded,
}){
  const padRef=useRef(null), wrapRef=useRef(null);
  const [stepSt,setStepSt]=useState(["","","",""]);
  const [items,setItems]=useState([]);           // 오버레이 프리미티브 스펙
  const [box,setBox]=useState(null);             // 오버레이 svg 위치·좌표계
  const [result,setResult]=useState(null);
  const [locked,setLocked]=useState(false);
  const [canRetry,setCanRetry]=useState(false);

  const fadeInk=(on)=>{
    const cv=wrapRef.current&&wrapRef.current.querySelector("canvas");
    if(cv){cv.style.transition="opacity .5s";cv.style.opacity=on?"0.22":"1";}
  };
  const clearOverlay=()=>{setItems([]);setBox(null);setResult(null);setStepSt(["","","",""]);fadeInk(false);};

  async function grade(){
    if(locked)return;
    const pad=padRef.current;if(!pad)return;
    const dump=pad.dump();
    const strokes=normalizeStrokes(dump);
    if(!strokes.length){
      setResult({tags:[{ok:false,label:"입력 없음"}],msg:"먼저 삼각형을 그려주세요."});
      return;
    }
    setLocked(true);setResult(null);
    setStepSt(["on","","",""]);await wait(450);                     // ① 인식
    const model=recognize(strokes,{minArea:8000});
    if(!model.ok){
      setStepSt(["","","",""]);setLocked(false);
      setResult({tags:[{ok:false,label:"인식 실패"}],msg:"삼각형을 조금 더 크게, 변이 만나게 그려주세요."});
      return;
    }
    setStepSt(["done","on","",""]);await wait(350);                 // ② 재구성
    // 오버레이 좌표계: 패드 캔버스의 CSS px 그대로 (스트로크 좌표계와 동일)
    const cv=wrapRef.current.querySelector("canvas");
    const wr=wrapRef.current.getBoundingClientRect(), cr=cv.getBoundingClientRect();
    setBox({left:cr.left-wr.left,top:cr.top-wr.top,width:cr.width,height:cr.height,w:dump.w,h:dump.h});
    fadeInk(true);
    const {A,B,C}=model.vertices, H=model.foot;
    const cen=[(A[0]+B[0]+C[0])/3,(A[1]+B[1]+C[1])/3];
    const base=[
      {kind:"line",pts:[B,C],color:T.student,delay:0},
      {kind:"line",pts:[C,A],color:T.student,delay:250},
      {kind:"line",pts:[A,B],color:T.student,delay:500},
      {kind:"label",at:vertexLabelPos(A,cen),text:"A",color:T.student,delay:800},
      {kind:"label",at:vertexLabelPos(B,cen),text:"B",color:T.student,delay:900},
      {kind:"label",at:vertexLabelPos(C,cen),text:"C",color:T.student,delay:1000},
    ];
    setItems(base);
    await wait(1100);
    setStepSt(["done","done","on",""]);await wait(450);             // ③ 비교
    const diff=compare(model,requirements);
    const missingAux=diff.missing.filter(m=>m.kind==="auxline");
    setStepSt(["done","done","done","on"]);await wait(350);         // ④ 보완
    // 직각 표시 방향: 밑변 방향 × 높이 방향
    const uB=(()=>{const p=dist(B,H)>2?B:C;const L=dist(p,H)||1;return[(p[0]-H[0])/L,(p[1]-H[1])/L];})();
    const uA=(()=>{const L=dist(A,H)||1;return[(A[0]-H[0])/L,(A[1]-H[1])/L];})();
    // 판정 라벨 겹침 회피용 장애물: 학생 획 전체 + 꼭짓점·수선의 발 + AH 선분
    const obst=[...strokes.flat(),A,B,C,H];
    for(let k=0;k<=12;k++)obst.push([A[0]+(H[0]-A[0])*k/12, A[1]+(H[1]-A[1])*k/12]);
    const bounds={w:dump.w,h:dump.h};
    if(missingAux.length){
      setItems([...base,
        {kind:"dash",pts:[A,H],color:T.fix,width:3,delay:200},
        {kind:"dot",at:H,color:T.fix,delay:1000},
        {kind:"label",at:[H[0]+10,H[1]+14],text:"H",color:T.fix,delay:1100},
        {kind:"angle",corner:H,uA:uB,uB:uA,color:T.fix,delay:1300},
        judgeLabel("내 그림 (오답 풀이)",B,T.student,obst,bounds),
        judgeLabel("정답 풀이: 높이 AH",[(A[0]+H[0])/2,(A[1]+H[1])/2],T.fix,obst,bounds,17,1600),
      ]);
      setStepSt(["done","done","done","done"]);
      setResult({
        tags:[{ok:true,label:"꼭짓점 3개 ✓"},{ok:true,label:"변 3개 ✓"},{ok:false,label:"보조선 누락"}],
        msg:"삼각형은 정확해요. 그런데 넓이를 구하려면 높이 AH가 필요합니다. 네가 그린 그림 위에 주황색으로 그려줬어요 — 다음엔 이 보조선부터!",
        formula:"S=\\tfrac12\\cdot\\overline{BC}\\cdot\\overline{AH}", pass:false,
      });
      setCanRetry(true);
    }else{
      setItems([...base,
        {kind:"dash",pts:[A,H],color:T.ok,width:2.6,delay:200},
        {kind:"dot",at:H,color:T.ok,delay:900},
        {kind:"angle",corner:H,uA:uB,uB:uA,color:T.ok,delay:1000},
        judgeLabel("내 그림 (정답 풀이 ✓)",B,T.ok,obst,bounds),
      ]);
      setStepSt(["done","done","done","done"]);
      setResult({
        tags:[{ok:true,label:"꼭짓점 3개 ✓"},{ok:true,label:"변 3개 ✓"},{ok:true,label:"보조선(높이) ✓"}],
        msg:"완벽합니다. 높이까지 그렸으니 넓이를 바로 계산할 수 있어요.",
        formula:"S=\\tfrac12\\cdot\\overline{BC}\\cdot\\overline{AH}", pass:true,
      });
      setCanRetry(false);
    }
    // 기존 SRS/오답 흐름에 "기하 구성" 유형으로 기록 (§4-4)
    logAttempt({
      src:"geo", qtype:"essay", concept, unit,
      verdict:missingAux.length?"partial":"correct",
      score:missingAux.length?0.5:1, points:1,
      err:missingAux.length?"geometry":"none",
      stage:missingAux.length?"setup":undefined,
      misc:missingAux.length?"보조선(높이) 누락":undefined,
    });
    if(onGraded)onGraded(diff,model);
  }

  function retry(){                 // "직접 그어보기": 보완 숨기고 학생이 다시 긋는다 (§4-4 재시도 루프)
    clearOverlay();setLocked(false);setCanRetry(false);
  }
  function reset(){
    if(padRef.current)padRef.current.clear();
    clearOverlay();setLocked(false);setCanRetry(false);
  }

  const renderItem=(it,i)=>{
    const anim={animate:true,dur:700,delay:it.delay||0};
    switch(it.kind){
      case "line": return <Curve key={i} pts={it.pts} color={it.color} width={4} anim={anim}/>;
      case "dash": return <DashedLine key={i} pts={it.pts} color={it.color} width={it.width||3} dash="10 11" anim={anim}/>;
      case "dot":  return <PointDot key={i} at={it.at} color={it.color} r={6} anim={{...anim,dur:400}}/>;
      case "label":return <SvgLabel key={i} at={it.at} text={it.text} color={it.color} fontSize={it.fontSize||19} anim={{...anim,dur:400}}/>;
      case "angle":return <RightAngleMark key={i} corner={it.corner} uA={it.uA} uB={it.uB} size={15} color={it.color} anim={{...anim,dur:400}}/>;
      default: return null;
    }
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div className="geo-problem"><b>문제.</b> {title}</div>
      <div ref={wrapRef} style={{position:"relative"}}>
        <PenPad ref={padRef} kind="geo" hideOcr penOnlyDefault={penOnly} disabled={locked}/>
        {box&&(
          <svg viewBox={`0 0 ${box.w} ${box.h}`} aria-hidden="true"
            style={{position:"absolute",left:box.left,top:box.top,width:box.width,height:box.height,
              pointerEvents:"none",overflow:"visible"}}>
            {items.map(renderItem)}
          </svg>
        )}
      </div>
      <div className="geo-steps">
        {STEP_NAMES.map((n,i)=>(
          <span key={i} className={"geo-step "+stepSt[i]}>{n}</span>
        ))}
      </div>
      <div style={{display:"flex",gap:10,justifyContent:"center"}}>
        <button className="btn pri" onClick={grade} disabled={locked&&!result}>채점하기</button>
        {canRetry&&<button className="btn gho" onClick={retry}>✏️ 직접 그어보기</button>}
        <button className="btn gho" onClick={reset}>다시 그리기</button>
      </div>
      {result&&(
        <div className="geo-result">
          <div>
            {result.tags.map((t,i)=>(
              <span key={i} className="geo-tag" style={{color:t.ok?T.ok:T.fix,borderColor:t.ok?T.ok:T.fix}}>
                {t.label}
              </span>
            ))}
          </div>
          <p style={{margin:"4px 0 0"}}>{result.msg}</p>
          {result.formula&&<FormulaBox tex={result.formula} color={T.fix} box anim={{animate:true,dur:500,delay:300}}/>}
        </div>
      )}
    </div>
  );
}

export { GeoFeedback };
