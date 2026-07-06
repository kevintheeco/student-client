import { tr } from "../core/platform.js";
import { LEVELS } from "../core/curriculum.js";
import { GRAPH_NODES, GRAPH_EDGES, NAME_EDGES, STRANDS } from "../core/knowledgeGraph.js";
import React from "react";
const { useState, useRef, useEffect } = React;

/* ════════════════════════════════════════════════════════════════
   🗺️ 수학 지식 지도 — 옵시디언 볼트의 캔버스 지도를 앱 안에서.
   과목 열 × 단원 카드 × 선수관계 화살표(SVG). 휠 확대 · 드래그 이동,
   카드 클릭 → 그 단원으로 줌 + 상세 패널(소단원·선수/후속·이유)
   → "이 단원으로 레벨테스트"로 바로 연결.
   데이터 원천 = curriculum.js + knowledgeGraph.js (옵시디언 볼트와 동일)
════════════════════════════════════════════════════════════════ */

const NODE_W=200,NODE_H=48,GY=18,COL_GAP=170;
function buildMap(){
  const flow=LEVELS.filter(l=>l.levelId!=="high15");   // 고3(2015)은 대수·미적분Ⅰ과 동일 단원
  const nodeByName=new Map();GRAPH_NODES.forEach(n=>{if(!nodeByName.has(n.name))nodeByName.set(n.name,n);});
  const units=new Map();const cols=[];
  let x=0;
  flow.forEach(lv=>lv.subjects.forEach(s=>{
    const colH=s.chapters.length*(NODE_H+GY)-GY;
    const y0=-colH/2;
    const col={name:s.name,x,top:y0,units:[]};
    s.chapters.forEach((ch,ci)=>{
      if(units.has(ch.name))return;
      const n=nodeByName.get(ch.name);
      const strand=n?n.strand
        :/확률|순열|조합|이항|통계/.test(s.name+ch.name)?"sta"
        :/미적분|극한|급수|미분|적분/.test(s.name+ch.name)?"cal":"geo";
      const u={name:ch.name,topics:ch.topics,subjId:s.id,subjName:s.name,strand,x,y:y0+ci*(NODE_H+GY)};
      units.set(ch.name,u);col.units.push(u);
    });
    cols.push(col);x+=NODE_W+COL_GAP;
  }));
  const byId=new Map(GRAPH_NODES.map(n=>[n.id,n]));
  const edges=[];const seen=new Set();
  const push=(from,to,w,why)=>{if(!units.has(from)||!units.has(to))return;const k=from+"→"+to;if(seen.has(k))return;seen.add(k);edges.push({from,to,w,why});};
  GRAPH_EDGES.forEach(e=>{const f=byId.get(e.from),t=byId.get(e.to);if(f&&t)push(f.name,t.name,e.w,e.why);});
  NAME_EDGES.forEach(e=>push(e.from,e.to,e.w,e.why));
  let minY=1e9,maxY=-1e9;units.forEach(u=>{minY=Math.min(minY,u.y);maxY=Math.max(maxY,u.y+NODE_H);});
  const bounds={x:-60,y:minY-90,w:x-COL_GAP+120,h:maxY-minY+160};
  return {cols,units,edges,bounds};
}
const MAP=buildMap();
const S_COLOR={};STRANDS.forEach(s=>S_COLOR[s.id]=s.color);
const strandName=(id)=>(STRANDS.find(s=>s.id===id)||{}).name||id;
const prereqsOf=(n)=>MAP.edges.filter(e=>e.to===n);
const nextOf=(n)=>MAP.edges.filter(e=>e.from===n);
function impactOf(n){const seen=new Set();const st=[n];while(st.length){for(const e of nextOf(st.pop()))if(!seen.has(e.to)){seen.add(e.to);st.push(e.to);}}return seen.size;}
function edgePath(e){
  const f=MAP.units.get(e.from),t=MAP.units.get(e.to);
  if(f.x===t.x){ // 같은 과목 열: 아래/위로
    const down=f.y<t.y;
    const x1=f.x+NODE_W*0.82,y1=down?f.y+NODE_H:f.y,x2=t.x+NODE_W*0.82,y2=down?t.y:t.y+NODE_H;
    return `M ${x1} ${y1} C ${x1+46} ${y1+(down?18:-18)}, ${x2+46} ${y2+(down?-18:18)}, ${x2} ${y2}`;
  }
  const x1=f.x+NODE_W,y1=f.y+NODE_H/2,x2=t.x,y2=t.y+NODE_H/2,dx=Math.max(60,(x2-x1)/2);
  return `M ${x1} ${y1} C ${x1+dx} ${y1}, ${x2-dx} ${y2}, ${x2} ${y2}`;
}

// scopeUnits(선택)가 주어지면 그 단원들만 확대해 보여주는 바운딩박스를 계산 — 시험 1건 범위로 지도를 좁힐 때 사용
function boundsOfUnits(names){
  let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9,found=0;
  names.forEach(n=>{const u=MAP.units.get(n);if(!u)return;found++;
    minX=Math.min(minX,u.x);maxX=Math.max(maxX,u.x+NODE_W);minY=Math.min(minY,u.y);maxY=Math.max(maxY,u.y+NODE_H);});
  if(!found)return MAP.bounds;
  const pad=90;
  return{x:minX-pad,y:minY-pad,w:(maxX-minX)+pad*2,h:(maxY-minY)+pad*2};
}

function KnowledgeMap({onPickUnit=()=>{},scopeUnits,weakUnits}){
  const scopeSet=scopeUnits&&scopeUnits.length?new Set(scopeUnits):null;
  const weakSet=weakUnits&&weakUnits.length?new Set(weakUnits):null;
  const scopedBounds=scopeSet?boundsOfUnits(scopeUnits):MAP.bounds;
  const [vb,setVb]=useState(scopedBounds);
  const [sel,setSel]=useState(null);
  const wrapRef=useRef(null),svgRef=useRef(null),drag=useRef(null),anim=useRef(null),moved=useRef(false);
  const selUnit=sel?MAP.units.get(sel):null;
  const related=selUnit?new Set([sel,...prereqsOf(sel).map(e=>e.from),...nextOf(sel).map(e=>e.to)]):null;

  function animateTo(target){
    if(anim.current)cancelAnimationFrame(anim.current);
    const from={...vbRef.current},t0=performance.now(),DUR=300;
    const step=(now)=>{
      const p=Math.min(1,(now-t0)/DUR),k=1-Math.pow(1-p,3);
      setVb({x:from.x+(target.x-from.x)*k,y:from.y+(target.y-from.y)*k,w:from.w+(target.w-from.w)*k,h:from.h+(target.h-from.h)*k});
      if(p<1)anim.current=requestAnimationFrame(step);
    };
    anim.current=requestAnimationFrame(step);
  }
  const vbRef=useRef(vb);vbRef.current=vb;

  function focusUnit(u){ // 클릭 → 그 단원 중심으로 확대
    setSel(u.name);
    const w=Math.min(MAP.bounds.w,1250),h=w*(MAP.bounds.h/MAP.bounds.w);
    animateTo({x:u.x+NODE_W/2-w/2,y:u.y+NODE_H/2-h/2,w,h});
  }
  const resetView=()=>{setSel(null);animateTo(scopedBounds);};

  // 휠 줌 (커서 기준) — passive:false 필요해서 직접 등록
  useEffect(()=>{
    const el=svgRef.current;if(!el)return;
    const onWheel=(e)=>{
      e.preventDefault();
      const r=el.getBoundingClientRect(),v=vbRef.current;
      const px=v.x+(e.clientX-r.left)/r.width*v.w,py=v.y+(e.clientY-r.top)/r.height*v.h;
      const k=e.deltaY>0?1.16:1/1.16;
      const w=Math.min(MAP.bounds.w*1.4,Math.max(340,v.w*k)),h=w*(v.h/v.w);
      setVb({x:px-(px-v.x)*(w/v.w),y:py-(py-v.y)*(h/v.h),w,h});
    };
    el.addEventListener("wheel",onWheel,{passive:false});
    return ()=>el.removeEventListener("wheel",onWheel);
  },[]);
  const onDown=(e)=>{drag.current={cx:e.clientX,cy:e.clientY,v:{...vb},moved:false};e.target.setPointerCapture?.(e.pointerId);};
  const onMove=(e)=>{
    const d=drag.current;if(!d)return;
    const r=svgRef.current.getBoundingClientRect();
    const dx=(e.clientX-d.cx)/r.width*d.v.w,dy=(e.clientY-d.cy)/r.height*d.v.h;
    if(Math.abs(e.clientX-d.cx)+Math.abs(e.clientY-d.cy)>4)d.moved=true;
    setVb({...d.v,x:d.v.x-dx,y:d.v.y-dy});
  };
  const onUp=(e)=>{const d=drag.current;drag.current=null;moved.current=!!(d&&d.moved);if(d&&!d.moved&&e.target===svgRef.current)setSel(null);};

  const EdgeRow=({e,dir})=>{
    const other=MAP.units.get(dir==="pre"?e.from:e.to);
    return(
      <button onClick={()=>focusUnit(other)} style={{display:"block",width:"100%",textAlign:"left",cursor:"pointer",
        border:"1px solid var(--line)",borderRadius:10,padding:"8px 10px",background:"#FBFAFF",marginBottom:6}}>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <span style={{width:8,height:8,borderRadius:"50%",background:S_COLOR[other.strand],flexShrink:0}}/>
          <b style={{fontSize:12.5,color:"var(--ink)"}}>{dir==="pre"?"⬅":"➡"} {other.name}</b>
          <span className="chip" style={{marginLeft:"auto",background:e.w>=0.8?"#FFE3EA":"var(--pri-s)",color:e.w>=0.8?"#C0264B":"var(--pri-d)",fontSize:10.5}}>{Math.round(e.w*100)}%</span>
        </div>
        <div style={{fontSize:11,color:"var(--sub)",marginTop:3,lineHeight:1.5}}>{e.why}</div>
      </button>);
  };

  return(
    <section style={{paddingBottom:30}}>
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:10}}>
        <div>
          <div style={{fontFamily:"'Jua',sans-serif",fontSize:20,color:"var(--ink)"}}>🗺️ {scopeSet?tr("이 시험의 개념지도","This exam's concept map"):tr("수학 지식 지도","Math knowledge map")}</div>
          <div style={{fontSize:12.5,color:"var(--sub)"}}>{scopeSet?tr("이 시험에 나온 단원만 확대해서 보여줘요.","Zoomed to just this exam's units."):tr("단원을 클릭하면 확대되며 선수·후속 관계가 보여요. 휠로 확대, 드래그로 이동.","Click a unit to zoom into its prerequisites. Wheel to zoom, drag to pan.")}</div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:6}}>
          <button className="btn gho sm" onClick={resetView}>⤢ {scopeSet?tr("이 시험 범위","Fit exam"):tr("전체 보기","Fit all")}</button>
        </div>
      </div>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",fontSize:11.5,color:"var(--sub)",marginBottom:8}}>
        {STRANDS.map(s=><span key={s.id} style={{display:"inline-flex",alignItems:"center",gap:5}}><span style={{width:9,height:9,borderRadius:"50%",background:s.color}}/>{s.name}</span>)}
        <span style={{display:"inline-flex",alignItems:"center",gap:5}}><span style={{width:16,height:3,background:"#E14360",borderRadius:2}}/>{tr("의존도 80%+","80%+ dependency")}</span>
        {weakSet&&<span style={{display:"inline-flex",alignItems:"center",gap:5}}><span style={{width:9,height:9,borderRadius:"50%",border:"2px solid #FF3B5C"}}/>{tr("이번 시험에서 틀린 단원","Missed on this exam")}</span>}
      </div>

      <div ref={wrapRef} style={{position:"relative",border:"1px solid var(--line)",borderRadius:18,overflow:"hidden",background:"linear-gradient(160deg,#FDFDFF 0%,#F4F3FB 100%)"}}>
        <svg ref={svgRef} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} style={{width:"100%",height:"72vh",display:"block",cursor:drag.current?"grabbing":"grab",touchAction:"none"}}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
          <defs>
            <marker id="km-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#9AA2C4"/></marker>
            <marker id="km-arr-hot" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#E14360"/></marker>
          </defs>
          {/* 과목 열 제목 */}
          {MAP.cols.map(c=>(
            <text key={c.name} x={c.x+NODE_W/2} y={c.top-34} textAnchor="middle"
              style={{fontFamily:"'Jua',sans-serif",fontSize:19,fill:"var(--ink)",opacity:related?0.35:0.85}}>{c.name}</text>
          ))}
          {/* 선수관계 화살표 */}
          {MAP.edges.map((e,i)=>{
            const hot=e.w>=0.8;
            const on=related&&(e.from===sel||e.to===sel);
            const dim=related&&!on;
            return <path key={i} d={edgePath(e)} fill="none"
              stroke={on?"#E14360":hot?"#E14360":"#9AA2C4"}
              strokeWidth={on?3:hot?1.9:1.2}
              opacity={dim?0.05:on?0.95:hot?0.5:0.3}
              markerEnd={on||hot?"url(#km-arr-hot)":"url(#km-arr)"}/>;
          })}
          {/* 단원 카드 */}
          {[...MAP.units.values()].map(u=>{
            const c=S_COLOR[u.strand];
            const on=sel===u.name,near=related?related.has(u.name):true;
            return(
              <g key={u.name} onClick={(e)=>{e.stopPropagation();if(moved.current)return;focusUnit(u);}}
                 style={{cursor:"pointer"}} opacity={near?1:0.22}>
                <rect x={u.x} y={u.y} width={NODE_W} height={NODE_H} rx={13}
                  fill={on?c+"26":"#FFFFFF"} stroke={c} strokeWidth={on?3:1.6}/>
                <rect x={u.x} y={u.y} width={7} height={NODE_H} rx={3.5} fill={c}/>
                <text x={u.x+NODE_W/2+3} y={u.y+NODE_H/2+4} textAnchor="middle"
                  style={{fontSize:u.name.length>14?10.5:12.5,fontWeight:700,fill:"#2A2547"}}>{u.name}</text>
              </g>);
          })}
        </svg>

        {/* 상세 패널 */}
        {selUnit&&(
          <div style={{position:"absolute",top:12,right:12,bottom:12,width:"min(330px,86%)",overflowY:"auto",
            background:"rgba(255,255,255,.97)",border:"1.5px solid var(--line)",borderRadius:16,padding:"16px 16px 14px",boxShadow:"0 10px 34px rgba(34,28,57,.16)"}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
              <div style={{flex:1}}>
                <div style={{fontSize:11.5,color:"var(--sub)"}}>{selUnit.subjName} · {strandName(selUnit.strand)}</div>
                <div style={{fontFamily:"'Jua',sans-serif",fontSize:18,color:"var(--ink)",lineHeight:1.3}}>{selUnit.name}</div>
              </div>
              <button className="btn gho xs" onClick={()=>setSel(null)}>✕</button>
            </div>
            {impactOf(sel)>0&&<div style={{fontSize:12,color:"#C0264B",fontWeight:700,margin:"8px 0 2px"}}>
              ⚡ {tr("이 단원이 흔들리면 이후 ","If this shakes, ")}{impactOf(sel)}{tr("개 단원이 함께 흔들려요"," later units shake too")}</div>}
            <button className="btn pri sm" style={{width:"100%",margin:"10px 0 12px"}}
              onClick={()=>onPickUnit(selUnit.subjId,selUnit.subjName,selUnit.name)}>🧪 {tr("이 단원으로 레벨테스트","Level-test this unit")}</button>
            <div style={{fontSize:12,fontWeight:800,color:"var(--ink)",marginBottom:5}}>{tr("소단원","Topics")} ({selUnit.topics.length})</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:12}}>
              {selUnit.topics.map(t=><span key={t} className="chip gho" style={{fontSize:10.5}}>{t}</span>)}
            </div>
            {prereqsOf(sel).length>0&&<>
              <div style={{fontSize:12,fontWeight:800,color:"var(--ink)",marginBottom:5}}>⬅ {tr("선수 단원 — 여기가 비면 막혀요","Prerequisites")}</div>
              {prereqsOf(sel).sort((a,b)=>b.w-a.w).map((e,i)=><EdgeRow key={i} e={e} dir="pre"/>)}
            </>}
            {nextOf(sel).length>0&&<>
              <div style={{fontSize:12,fontWeight:800,color:"var(--ink)",margin:"8px 0 5px"}}>➡ {tr("후속 단원 — 이 단원이 여는 문","Unlocks")}</div>
              {nextOf(sel).sort((a,b)=>b.w-a.w).map((e,i)=><EdgeRow key={i} e={e} dir="next"/>)}
            </>}
          </div>
        )}
      </div>
      <p className="hint" style={{marginTop:10}}>{tr("니가교수의 오답 근본원인 추적과 같은 지식그래프예요 — 학생이 어떤 단원에서 막히면, 이 지도의 ⬅ 방향으로 거슬러 올라가며 보강하면 됩니다.","Same graph the diagnosis engine uses — trace ⬅ to find the root gap.")}</p>
    </section>
  );
}

export { KnowledgeMap };
