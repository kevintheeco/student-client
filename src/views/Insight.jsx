/* ════════════════════════════════════════════════════════════════
   인사이트 — 진단 인텔리전스 대시보드
   ① 지식 그래프: 중1→미적분 시계열 축 위에 단원 노드를 놓고
      선수관계 엣지로 연결. 노드 색 = 숙련도, 클릭 → 근본 원인 역추적 + AI 서술 진단.
   ② 능력 요인: NRC 5-strand 레이더(현재 vs 한 달 전).
   ③ 성장: 요인별 주간 시계열 + 최소제곱 회귀 기울기(주당 성장률).
   데이터 = 시도 로그(ng:attempts). 데이터가 적으면 데모 미리보기 제공.
════════════════════════════════════════════════════════════════ */
import { tr } from "../core/platform.js";
import { MathText } from "../ui/math.jsx";
import { allAttempts } from "../core/attempts.js";
import { COURSES, FACTORS, GRAPH_EDGES, GRAPH_NODES, courseOf, dependentsOf, errTypeById, impactOf, nodeById, prereqsOf, strandOf, traceRootCauses } from "../core/knowledgeGraph.js";
import { errBreakdown, factorSeries, factorSummary, miscBreakdown, nodeTrends } from "../core/mastery.js";
import { abilityByNode } from "../core/rasch.js";
import { habitInsights, habitProfile } from "../core/habits.js";
import { narrateDiagnosis } from "../core/diagnosis.js";
import React from "react";
const { useState, useMemo, useRef } = React;

const STRAND_ORDER={num:0,alg:1,fun:2,geo:3,sta:4,cal:5};
const mColor=(m)=>m==null?"#DBD7EC":m<0.45?"#FF6B8A":m<0.7?"#FFC24B":"#27C2A0";
const mLabel=(m)=>m==null?tr("미측정","No data"):m<0.45?tr("취약","Weak"):m<0.7?tr("불안정","Shaky"):tr("탄탄","Solid");
const pct=(v)=>v==null?"—":Math.round(v*100)+"%";

/* ── 데모 데이터: "중3, 인수분해 계열이 취약한 학생"의 10주 성장 시나리오 ──
   실기록이 부족할 때 대시보드가 어떤 모습이 되는지 미리보기용(저장 안 함). */
function demoAttempts(){
  const now=Date.now(),W=7*864e5;
  let seed=42;const rand=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
  const GAPS={m2_poly:"지수법칙에서 곱을 합으로 처리하는 실수",m3_factor:"공통인수를 먼저 묶는 단계 누락",
    m3_quad:"인수분해가 안 될 때 근의 공식 전환이 늦음",m3_quadfun:"꼭짓점 좌표를 일반형에서 못 끌어냄",
    m3_trig:"기준각에 대한 변의 대응 혼동",m2_pyth:"빗변 판별 없이 공식 대입"};
  const plan=[
    {node:"m2_poly",base:.45,grow:.04},{node:"m3_factor",base:.32,grow:.05},
    {node:"m3_quad",base:.3,grow:.055},{node:"m3_quadfun",base:.4,grow:.04},
    {node:"m1_lineq",base:.85,grow:.005},{node:"m2_sys",base:.8,grow:.01},
    {node:"m2_linfun",base:.7,grow:.02},{node:"m2_pyth",base:.58,grow:.02},
    {node:"m3_trig",base:.5,grow:.03},{node:"m2_sim",base:.55,grow:.02},
    {node:"m3_sqrt",base:.62,grow:.03},{node:"m2_case",base:.75,grow:.01},{node:"m3_stat",base:.8,grow:.005},
  ];
  const out=[];
  for(let w=0;w<10;w++)for(const p of plan){
    const nAtt=1+Math.floor(rand()*2.4);
    for(let k=0;k<nAtt;k++){
      const pr=Math.min(.95,p.base+p.grow*w+(rand()-.5)*.16);
      const r=rand();
      const verdict=r<pr?"correct":(r<pr+(1-pr)*.55?"partial":"incorrect");
      const t=now-(10-w)*W+Math.floor(rand()*W*.9);
      const f=(c)=>Math.max(0,Math.min(1,c+(rand()-.5)*.3));
      const err=verdict==="correct"?"none":(rand()<(p.base>.6?.6:.3)?"slip":(rand()<.7?"concept":(rand()<.5?"strategy":"interpret")));
      // 행동 신호: 약한 단원일수록 힌트를 자주 찾는 학생 시나리오 + 간헐적 포기·스킵
      if(rand()<.05)out.push({t:t-1,src:"dontknow",concept:nodeById(p.node).name,nodeId:p.node,verdict:"incorrect",err:"blank"});
      if(rand()<.04)out.push({t:t-2,src:"skip",concept:nodeById(p.node).name,nodeId:p.node});
      out.push({t,src:"study",concept:nodeById(p.node).name,nodeId:p.node,verdict,
        hint:(p.base<.5&&rand()<.4)?1:undefined,
        err,stage:err==="none"?undefined:(err==="slip"?"compute":"setup"),
        misc:err==="none"?undefined:(err==="slip"?"부호 계산 실수":(GAPS[p.node]||"개념 연결 혼동").slice(0,20)),
        dur:60+Math.floor(rand()*180),
        gapType:verdict==="correct"?"":"개념누락",gap:verdict==="correct"?"":(GAPS[p.node]||"핵심 개념 연결 누락"),
        factors:{cu:f(pr),pf:f(Math.min(1,pr+.12)),sc:f(Math.max(0,pr-.1)),ar:f(Math.max(0,pr-.05))}});
      if(verdict!=="correct"&&rand()<.6)
        out.push({t:t+36e5,src:"followup",concept:nodeById(p.node).name,nodeId:p.node,verdict:rand()<.7?"correct":"partial"});
    }
  }
  return out.sort((a,b)=>a.t-b.t);
}

function Insight({onExit,studentName}){
  const [tab,setTab]=useState("graph");
  const [demo,setDemo]=useState(false);
  const [sel,setSel]=useState(null);
  const [diag,setDiag]=useState(null);       // {busy, out, err} — 선택 노드의 AI 서술 진단
  const abortRef=useRef(null);

  const real=useMemo(()=>allAttempts(),[]);
  const demoRef=useRef(null);   // 데모 시나리오는 세션당 한 번만 생성 (렌더마다 재생성 방지)
  const attempts=demo?(demoRef.current||(demoRef.current=demoAttempts())):real;

  // 측정 엔진 v2: 온라인 Rasch 재생 — 노드별 능력(신뢰구간 포함) + 모델 자기 검증 통계
  const engine=useMemo(()=>abilityByNode(attempts),[attempts]);
  const mastery=engine.ability;
  const calib=engine.calibration;
  const fsum=useMemo(()=>factorSummary(attempts),[attempts]);
  const series=useMemo(()=>factorSeries(attempts),[attempts]);
  const trends=useMemo(()=>nodeTrends(attempts),[attempts]);
  const habits=useMemo(()=>habitProfile(attempts),[attempts]);
  const hLines=useMemo(()=>habitInsights(habits),[habits]);
  const measuredN=Object.keys(mastery).length;

  /* ── 그래프 레이아웃: x=과정(시계열), y=영역 순 정렬 ── */
  const layout=useMemo(()=>{
    const colW=152,rowH=54,left=86,top=58;
    const pos={};let maxRows=0;
    COURSES.forEach(c=>{
      const nodes=GRAPH_NODES.filter(n=>n.course===c.id)
        .slice().sort((a,b)=>STRAND_ORDER[a.strand]-STRAND_ORDER[b.strand]);
      nodes.forEach((n,i)=>{pos[n.id]={x:left+c.order*colW,y:top+i*rowH};});
      maxRows=Math.max(maxRows,nodes.length);
    });
    return{pos,w:left+COURSES.length*colW-30,h:top+maxRows*rowH+16,colW,left,top};
  },[]);

  // 선택 노드의 조상(선수)·후손(후속) 집합 — 엣지 하이라이트용
  const rel=useMemo(()=>{
    if(!sel)return null;
    const walk=(id,dir)=>{const set=new Set();const st=[id];
      while(st.length){const cur=st.pop();
        for(const e of (dir==="up"?prereqsOf(cur):dependentsOf(cur))){
          const nid=dir==="up"?e.from:e.to;
          if(!set.has(nid)){set.add(nid);st.push(nid);}}}
      return set;};
    return{up:walk(sel,"up"),down:walk(sel,"down")};
  },[sel]);

  const causes=useMemo(()=>sel?traceRootCauses(sel,mastery).slice(0,5):[],[sel,mastery]);
  const selErr=useMemo(()=>sel?errBreakdown(attempts,sel):null,[sel,attempts]);
  const selTraps=useMemo(()=>sel?miscBreakdown(attempts,sel,2).slice(0,4):[],[sel,attempts]);

  const weakList=useMemo(()=>Object.keys(mastery)
    .map(id=>({id,st:mastery[id],impact:impactOf(id)}))
    .filter(x=>x.st.m!=null&&x.st.m<0.7&&x.st.n>=2)
    .map(x=>({...x,prio:(1-x.st.m)*(1+x.impact/8)}))
    .sort((a,b)=>b.prio-a.prio).slice(0,8),[mastery]);

  function pick(id){
    setSel(id===sel?null:id);
    setDiag(null);abortRef.current?.abort();
  }
  async function runDiagnosis(){
    if(!sel)return;
    abortRef.current?.abort();
    const ctrl=new AbortController();abortRef.current=ctrl;
    setDiag({busy:true});
    try{
      const out=await narrateDiagnosis(sel,mastery,attempts,ctrl.signal,{noCache:demo});
      setDiag({out});
    }catch(e){if(e.name!=="AbortError")setDiag({err:e.message});}
  }

  const selNode=sel?nodeById(sel):null;
  const selSt=sel?mastery[sel]:null;

  /* ── 엣지 렌더 ── */
  const edgeEls=GRAPH_EDGES.map((e,i)=>{
    const a=layout.pos[e.from],b=layout.pos[e.to];
    if(!a||!b)return null;
    let color="#B7B1D6",op=0.22,w2=0.7+e.w*0.9;
    if(rel){
      const onUp=(e.to===sel||rel.up.has(e.to))&&rel.up.has(e.from);
      const onDown=(e.from===sel||rel.down.has(e.from))&&rel.down.has(e.to);
      if(onUp){color="#FF6B8A";op=0.85;w2=1+e.w*1.6;}
      else if(onDown){color="#27C2A0";op=0.75;w2=1+e.w*1.4;}
      else op=0.06;
    }
    const mx=(a.x+b.x)/2;
    return <path key={i} d={`M${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`}
      fill="none" stroke={color} strokeWidth={w2} opacity={op}/>;
  });

  /* ── 노드 렌더 ── */
  const nodeEls=GRAPH_NODES.map(n=>{
    const p=layout.pos[n.id];if(!p)return null;
    const st=mastery[n.id];
    const m=st&&st.m!=null?st.m:null;
    const r=8+Math.min(st?st.n:0,12)*0.45;
    const dim=rel&&n.id!==sel&&!rel.up.has(n.id)&&!rel.down.has(n.id);
    const label=n.name.length>9?n.name.slice(0,9)+"…":n.name;
    return(
      <g key={n.id} transform={`translate(${p.x},${p.y})`} style={{cursor:"pointer"}} opacity={dim?0.25:1}
        onClick={()=>pick(n.id)}>
        <title>{(courseOf(n.id)?.name||"")+" · "+n.name+(m!=null?" — "+tr("숙련도 ","mastery ")+pct(m)+(st.indirect?tr(" (간접 추정)"," (inferred)"):" · "+st.n+tr("회"," attempts")):"")}</title>
        {n.id===sel&&<circle r={r+5.5} fill="none" stroke="#6C5CE7" strokeWidth="2.5" opacity=".9"/>}
        <circle r={r} fill={mColor(m)} stroke={strandOf(n.id)?.color||"#888"} strokeWidth="2" strokeDasharray={st&&st.indirect?"3 3":undefined}/>
        {st&&st.n>0&&<text y={4} textAnchor="middle" fontSize="9" fontWeight="800" fill="#fff">{st.n}</text>}
        <text y={r+12} textAnchor="middle" fontSize="9" fill={m==null?"#9A94B8":"#221C39"}>{label}</text>
      </g>);
  });

  const courseHeads=COURSES.map(c=>(
    <text key={c.id} x={layout.left+c.order*layout.colW} y={26} textAnchor="middle"
      fontSize="12" fontWeight="800" fill="#5A48E0" fontFamily="'Jua',sans-serif">{c.name}</text>));

  /* ── 요인 레이더 ── */
  function Radar(){
    const C=132,R=96;
    const pt=(i,v)=>{const ang=-Math.PI/2+i*2*Math.PI/5;return[(C+R*v*Math.cos(ang)).toFixed(1),(C+R*v*Math.sin(ang)).toFixed(1)];};
    const poly=(vals)=>vals.map((v,i)=>pt(i,Math.max(v==null?0.04:v,0.04)).join(",")).join(" ");
    const cur=FACTORS.map(f=>fsum[f.id]?.cur);
    const prev=FACTORS.map(f=>fsum[f.id]?.prev);
    return(
      <svg viewBox="-18 -6 300 276" style={{width:"100%",maxWidth:330}}>
        {[0.25,0.5,0.75,1].map(g=><polygon key={g} points={poly([g,g,g,g,g])} fill="none" stroke="#E3E0F0" strokeWidth="1"/>)}
        {FACTORS.map((f,i)=>{const[x,y]=pt(i,1);return <line key={f.id} x1={C} y1={C} x2={x} y2={y} stroke="#E3E0F0"/>;})}
        {prev.some(v=>v!=null)&&<polygon points={poly(prev)} fill="none" stroke="#B7B1D6" strokeWidth="1.6" strokeDasharray="4 3"/>}
        <polygon points={poly(cur)} fill="rgba(108,92,231,.22)" stroke="#6C5CE7" strokeWidth="2.2"/>
        {FACTORS.map((f,i)=>{const[x,y]=pt(i,1.17);return(
          <text key={f.id} x={x} y={y} textAnchor="middle" fontSize="11" fontWeight="700" fill={f.color}>{f.name}</text>);})}
      </svg>);
  }

  /* ── 요인 스파크라인 ── */
  function Spark({fid,color}){
    const pts=series[fid]||[];
    const W=210,H=44;
    const val=pts.map(p=>p.avg);
    const segs=[];let cur=[];
    val.forEach((v,i)=>{
      if(v==null){if(cur.length>1)segs.push(cur);cur=[];return;}
      cur.push([(i/(Math.max(pts.length-1,1)))*W,H-v*(H-6)-3]);
    });
    if(cur.length>1)segs.push(cur);
    const dots=val.map((v,i)=>v==null?null:
      <circle key={i} cx={(i/(Math.max(pts.length-1,1)))*W} cy={H-v*(H-6)-3} r="2.2" fill={color}/>);
    return(
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:H}}>
        <line x1="0" y1={H-3} x2={W} y2={H-3} stroke="#EEEBF8"/>
        {segs.map((s,i)=><polyline key={i} points={s.map(p=>p.join(",")).join(" ")} fill="none" stroke={color} strokeWidth="2"/>)}
        {dots}
      </svg>);
  }

  const slopeTxt=(s)=>s==null?tr("데이터 부족","not enough data")
    :(s>=0?"+":"")+(Math.round(s*1000)/10)+"p"+tr("/주","/wk");

  const TABS=[["graph",tr("🕸 지식 그래프","🕸 Knowledge graph")],["factors",tr("🎯 능력 요인","🎯 Ability factors")],["growth",tr("📈 성장","📈 Growth")]];

  return(
    <section>
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:14}}>
        <h2 style={{margin:0,fontFamily:"'Jua',sans-serif",fontSize:22,color:"var(--ink)"}}>{tr("📊 성장 인사이트","📊 Growth insight")}{studentName?" · "+studentName:""}</h2>
        <span style={{fontSize:12,color:"var(--sub)"}}>
          {tr("시도 ","attempts ")}{attempts.length}{tr("회 · 측정 단원 "," · units measured ")}{measuredN}
        </span>
        <div style={{marginLeft:"auto",display:"flex",gap:8}}>
          {real.length<10&&(
            <button className={"btn sm "+(demo?"pri":"gho")} onClick={()=>{setDemo(v=>!v);setSel(null);setDiag(null);}}>
              {demo?tr("데모 데이터 보는 중 · 끄기","Demo data on · turn off"):tr("✨ 데모 미리보기","✨ Demo preview")}
            </button>)}
          <button className="btn gho sm" onClick={onExit}>{tr("← 목록","← Back")}</button>
        </div>
      </div>

      {attempts.length===0?(
        <div className="card" style={{padding:"28px 26px",textAlign:"center",lineHeight:1.8}}>
          <div style={{fontSize:34}}>🌱</div>
          <div style={{fontFamily:"'Jua',sans-serif",fontSize:17,color:"var(--ink)",marginTop:4}}>{tr("아직 분석할 기록이 없어","No data to analyze yet")}</div>
          <div style={{fontSize:13.5,color:"var(--sub)",maxWidth:520,margin:"6px auto 0"}}>
            {tr("공부(손글씨 채점)·퀴즈·시험을 볼 때마다 모든 시도가 자동으로 쌓여, 단원별 숙련도와 5가지 능력 요인의 성장이 여기 나타나. 위의 ✨ 데모 미리보기로 어떤 모습인지 볼 수 있어.",
               "Every graded attempt (study, quiz, exam) accumulates here into per-unit mastery and 5-factor growth. Try the ✨ demo preview above.")}
          </div>
        </div>
      ):(<>
        <div className="sub-tabs" style={{marginBottom:14}}>
          {TABS.map(([id,lbl])=>
            <button key={id} className={"sub-tab"+(tab===id?" on":"")} onClick={()=>setTab(id)}>{lbl}</button>)}
        </div>

        {tab==="graph"&&(<>
          <div className="card" style={{padding:"14px 12px 10px"}}>
            <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center",padding:"0 8px 8px",fontSize:11.5,color:"var(--sub)"}}>
              {[[null,tr("미측정","No data")],[0.3,tr("취약","Weak")],[0.6,tr("불안정","Shaky")],[0.9,tr("탄탄","Solid")]].map(([m,l],i)=>
                <span key={i} style={{display:"inline-flex",alignItems:"center",gap:5}}>
                  <span style={{width:11,height:11,borderRadius:"50%",background:mColor(m),display:"inline-block"}}/>{l}</span>)}
              <span style={{marginLeft:"auto"}}>{tr("노드를 눌러 근본 원인 역추적","Tap a node to trace root causes")} · <b style={{color:"#FF6B8A"}}>{tr("빨강=선수 경로","red = prerequisites")}</b> · <b style={{color:"#27C2A0"}}>{tr("초록=영향받는 후속","green = downstream")}</b></span>
            </div>
            <div style={{overflowX:"auto"}}>
              <svg viewBox={`0 0 ${layout.w} ${layout.h}`} style={{width:layout.w,maxWidth:"none",display:"block"}}>
                {courseHeads}{edgeEls}{nodeEls}
              </svg>
            </div>
          </div>

          {selNode&&(
            <div className="card" style={{padding:"18px 20px",marginTop:14}}>
              <div style={{display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap"}}>
                <div style={{fontFamily:"'Jua',sans-serif",fontSize:18,color:"var(--ink)"}}>
                  {courseOf(sel)?.name} · {selNode.name}
                </div>
                <span className="subj-badge" style={{background:(strandOf(sel)?.color||"#888")+"22",color:strandOf(sel)?.color}}>{strandOf(sel)?.name}</span>
                <span style={{fontSize:13,fontWeight:800,color:mColor(selSt?.m)}}>
                  {mLabel(selSt?.m)}
                  {selSt?.m!=null&&" · "+pct(selSt.m)+(selSt.se!=null?" ±"+Math.round((selSt.ciHigh-selSt.ciLow)/2*100)+"p":"")}
                  {selSt?.n>0&&tr(" · "+selSt.n+"회 측정"," · "+selSt.n+" measured")}
                </span>
                {selSt?.indirect&&<span className="subj-badge" style={{background:"#EEF2FF",color:"#3730A3",border:"1px dashed #C7D2FE"}} title={tr("직접 풀어본 적은 없지만 후속 단원 풀이에서 유추한 추정치","Inferred from downstream evidence — not directly tested")}>{tr("간접 추정","inferred")}</span>}
                <span style={{fontSize:12,color:"var(--sub)"}}>{tr("이 단원이 흔들리면 후속 ","affects ")}{impactOf(sel)}{tr("개 단원에 영향"," later units")}</span>
              </div>

              {selErr&&Object.keys(selErr.err).length>0&&(()=>{
                const entries=Object.entries(selErr.err).sort((a,b)=>b[1]-a[1]);
                const slip=selErr.err.slip||0,concept2=selErr.err.concept||0;
                const insight=slip>=2&&slip>=concept2
                  ?tr("오답의 다수가 '실수' — 개념은 잡혀 있으니 검산·절차 훈련이 처방이야.","Most misses are slips — concept is there; drill procedure & checking.")
                  :concept2>=2?tr("'개념 결여'형 오답 — 아래 선수 개념 역추적부터 보강하는 게 맞아.","Concept-gap errors — remediate prerequisites below first.")
                  :null;
                return(
                  <div style={{marginTop:10}}>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                      <span className="eyebrow">{tr("오류 유형","Error types")}</span>
                      {entries.map(([id,n])=>{const et=errTypeById(id);return(
                        <span key={id} className="subj-badge" title={et?.desc||""} style={{background:(et?.color||"#888")+"22",color:et?.color||"var(--sub)"}}>{(et?.name||id)+" "+n}</span>);})}
                      {selErr.avgDur!=null&&<span style={{fontSize:11.5,color:"var(--sub)"}}>{tr("평균 풀이 ","avg ")}{selErr.avgDur}{tr("초","s")}</span>}
                    </div>
                    {insight&&<div style={{fontSize:12.5,color:"var(--pri-d)",fontWeight:700,marginTop:6}}>💡 {insight}</div>}
                    {selTraps.length>0&&(
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginTop:7}}>
                        <span className="eyebrow">{tr("반복 함정","Repeated traps")}</span>
                        {selTraps.map(t=>(
                          <span key={t.label} className="subj-badge" style={{background:"#FFF3F5",color:"#B4234B",border:"1px dashed #F5B8C6"}}>
                            <MathText text={t.label} tag="span"/> ×{t.n}
                          </span>))}
                        <span style={{fontSize:11,color:"var(--sub)"}}>{tr("→ 다음 출제에 이 함정을 정조준한 문제가 나가","→ next questions will target these")}</span>
                      </div>)}
                  </div>);})()}

              <div style={{marginTop:12}}>
                <div className="eyebrow" style={{marginBottom:6}}>{tr("근본 원인 후보 — 선수 개념 역추적","Root-cause candidates — prerequisite trace")}</div>
                {causes.length===0&&<div style={{fontSize:13,color:"var(--sub)"}}>{tr("선수 단원이 없는 뿌리 개념이야.","This is a root concept with no prerequisites.")}</div>}
                {causes.map(c=>(
                  <div key={c.id} onClick={()=>pick(c.id)} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"8px 10px",borderRadius:10,cursor:"pointer",background:c.suspicion>0.3?"#FFF3F5":"var(--bg)",marginBottom:6}}>
                    <span style={{fontSize:11,fontWeight:800,color:"#fff",background:mColor(c.measured?c.mastery:null),borderRadius:8,padding:"3px 8px",whiteSpace:"nowrap"}}>
                      {tr("의심도 ","suspicion ")}{Math.round(c.suspicion*100)}
                    </span>
                    <div style={{minWidth:0}}>
                      <b style={{fontSize:13.5}}>{courseOf(c.id)?.name} · {c.node.name}</b>
                      <span style={{fontSize:12,color:"var(--sub)",marginLeft:6}}>
                        {c.measured?tr("숙련도 ","mastery ")+pct(c.mastery)+(c.n>0?" · "+c.n+tr("회"," attempts"):tr(" · 간접 추정"," · inferred")):tr("아직 미측정 — 확인 필요","not yet measured")}
                      </span>
                      <div style={{fontSize:12,color:"var(--sub)",marginTop:2}}>{c.chain[c.chain.length-1].why}</div>
                    </div>
                  </div>))}
              </div>

              <div style={{marginTop:12}}>
                <button className="btn pri sm" onClick={runDiagnosis} disabled={diag?.busy}>
                  {diag?.busy?tr("진단 작성 중…","Writing diagnosis…"):tr("🩺 AI 서술 진단 받기","🩺 AI narrative diagnosis")}
                </button>
                {diag?.err&&<span style={{fontSize:12.5,color:"#D9534F",marginLeft:10}}>{diag.err}</span>}
                {diag?.out&&(
                  <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:10}}>
                    <div style={{background:"var(--pri-s)",borderRadius:12,padding:"12px 15px"}}>
                      <div style={{fontSize:10.5,fontWeight:800,color:"var(--pri-d)",marginBottom:4}}>{tr("근본 원인","ROOT CAUSE")}</div>
                      <MathText text={diag.out.rootCause} tag="div" style={{fontSize:14,fontWeight:700,lineHeight:1.6}}/>
                    </div>
                    <MathText text={diag.out.story} tag="div" style={{fontSize:13.5,lineHeight:1.8,color:"var(--ink)"}}/>
                    {diag.out.plan.length>0&&(
                      <div style={{background:"#F0FDF4",border:"1px solid #B7EBC6",borderRadius:12,padding:"12px 15px"}}>
                        <div style={{fontSize:10.5,fontWeight:800,color:"#166534",marginBottom:6}}>{tr("보강 순서 (뿌리부터)","REMEDIATION ORDER")}</div>
                        {diag.out.plan.map((p,i)=><MathText key={i} text={(i+1)+". "+p} tag="div" style={{fontSize:13,lineHeight:1.7}}/>)}
                      </div>)}
                  </div>)}
              </div>
            </div>)}

          {weakList.length>0&&(
            <div className="card" style={{padding:"18px 20px",marginTop:14}}>
              <div className="eyebrow" style={{marginBottom:8}}>{tr("우선 보강 순위 — (1−숙련도) × 후속 영향","Priority queue — (1−mastery) × downstream impact")}</div>
              {weakList.map((x,i)=>(
                <div key={x.id} onClick={()=>{setTab("graph");pick(x.id);}} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 8px",borderRadius:10,cursor:"pointer"}}>
                  <span style={{fontFamily:"'Jua',sans-serif",color:"var(--pri)",width:22}}>{i+1}</span>
                  <b style={{fontSize:13.5}}>{courseOf(x.id)?.name} · {nodeById(x.id).name}</b>
                  <span style={{fontSize:12,color:mColor(x.st.m),fontWeight:800}}>{pct(x.st.m)}</span>
                  <span style={{fontSize:11.5,color:"var(--sub)",marginLeft:"auto"}}>{tr("후속 ","+")}{x.impact}{tr("개 단원 영향"," units affected")}</span>
                </div>))}
            </div>)}
        </>)}

        {tab==="factors"&&(<>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:14}}>
            <div className="card" style={{padding:"20px 18px",display:"flex",flexDirection:"column",alignItems:"center"}}>
              <div className="eyebrow" style={{alignSelf:"flex-start",marginBottom:8}}>{tr("수학적 숙련도 5요인 (NRC, Adding It Up)","5 strands of proficiency (NRC)")}</div>
              <Radar/>
              <div style={{fontSize:11.5,color:"var(--sub)"}}>{tr("실선 = 최근 4주 · 점선 = 그 이전 4주","solid = last 4 wks · dashed = 4 wks before")}</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {FACTORS.map(f=>{
                const s=fsum[f.id]||{};
                return(
                  <div key={f.id} className="card" style={{padding:"13px 16px"}}>
                    <div style={{display:"flex",alignItems:"baseline",gap:8}}>
                      <b style={{color:f.color,fontSize:14}}>{f.name}</b>
                      <span style={{fontSize:11,color:"var(--sub)"}}>{f.en}</span>
                      <span style={{marginLeft:"auto",fontFamily:"'Jua',sans-serif",fontSize:19,color:f.color}}>{pct(s.cur)}</span>
                      {s.delta!=null&&<span style={{fontSize:12,fontWeight:800,color:s.delta>=0?"#1E9E5A":"#D9534F"}}>{(s.delta>=0?"▲":"▼")+Math.abs(Math.round(s.delta*100))}p</span>}
                    </div>
                    <div style={{fontSize:12,color:"var(--sub)",marginTop:3}}>{f.desc}</div>
                    <div className="bar" style={{marginTop:8}}><i style={{width:Math.round((s.cur||0)*100)+"%",background:f.color}}/></div>
                  </div>);})}
            </div>
          </div>
          {/* 학습 습관 — SRL(자기조절학습) 5차원 + 지식 조합. 풀이 '과정'에서만 나오는 행동 신호 */}
          {habits.n>=5&&(()=>{
            const H=habits;
            const wheelNames=H.wheelNodes.slice(0,2).map(id=>nodeById(id)?.name||id).join(", ");
            const gapTxt=H.integGap==null?"—":(H.integGap>=0?"−":"+")+Math.abs(Math.round(H.integGap*100))+"p";
            const DIMS=[
              {t:tr("① 시작·계획","① Initiation"),rows:[
                {l:tr("포기(모르겠어)","Give-up"),v:H.giveupRate,col:H.giveupRate!=null&&H.giveupRate>=0.2?"#D9534F":"#FF8E72",sub:H.giveupN+tr("회","")},
                {l:tr("넘어가기","Skip"),v:H.skipRate,col:"#A29BFE",sub:H.skipN+tr("회","")},
                {l:tr("식 세우기 오류 비중","Setup-stage errors"),v:H.setupShare,col:H.setupShare!=null&&H.setupShare>=0.6?"#D9534F":"#4FACFE",sub:tr("오류 ","")+(H.stagedN||0)+tr("회 기준","")},
              ]},
              {t:tr("② 수행 조절","② Regulation"),rows:[
                {l:tr("빠른 오답(찍기)","Rapid wrong"),v:H.rapidWrongRate,col:H.rapidWrongRate!=null&&H.rapidWrongRate>=0.2?"#D9534F":"#4FACFE",sub:H.rapidN+"/"+(H.wrongDN||0)+tr("오답","")},
                {l:tr("덤벙 계산실수","Careless slips"),v:H.fastSlipRate,col:H.fastSlipRate!=null&&H.fastSlipRate>=0.35?"#D9534F":"#FFC24B",sub:tr("실수 ","")+(H.slipN||0)+tr("회 중","")},
                {l:tr("헛바퀴 단원","Wheel-spinning"),v:H.wheelNodes.length?Math.min(1,H.wheelNodes.length/3):0,txt:H.wheelNodes.length+tr("개",""),col:H.wheelNodes.length?"#D9534F":"#27C2A0",sub:wheelNames},
              ]},
              {t:tr("③ 도움 추구","③ Help-seeking"),rows:[
                {l:tr("힌트 의존도","Hint reliance"),v:H.hintRate,col:H.hintRate!=null&&H.hintRate>=0.4?"#D9534F":"#4FACFE",sub:H.hintN+tr("회","")},
                {l:tr("혼자 정답률","Solo accuracy"),v:H.soloCorrect,col:"#6C5CE7"},
                {l:tr("힌트 후 정답률","With-hint accuracy"),v:H.hintCorrect,col:"#B7B1D6"},
              ]},
              {t:tr("④ 오답 성찰","④ Reflection"),rows:[
                {l:tr("오답 재도전율","Retry after wrong"),v:H.retryRate,col:H.retryRate!=null&&H.retryRate>=0.6?"#27C2A0":"#FFC24B",sub:H.wrongN+tr("회 오답 중","")},
                {l:tr("재도전 성공률","Retry win rate"),v:H.retryWinRate,col:"#27C2A0",sub:(H.retriedN||0)+tr("회 재도전","")},
                {l:tr("같은 함정 반복","Trap repeats"),v:H.trapRepeatRate,col:H.trapRepeatRate!=null&&H.trapRepeatRate>=0.5?"#D9534F":"#FF8E72",sub:(H.trapKinds||0)+tr("종 오개념","")},
              ]},
              {t:tr("⑤ 꾸준함·분산","⑤ Consistency"),rows:[
                {l:tr("주 활동일","Days/week"),v:H.daysPerWeek==null?null:H.daysPerWeek/7,txt:H.daysPerWeek==null?"—":(Math.round(H.daysPerWeek*10)/10)+tr("일","d"),col:H.daysPerWeek!=null&&H.daysPerWeek>=3?"#27C2A0":"#FFC24B"},
                {l:tr("단원 재방문 간격","Revisit gap"),v:null,txt:H.medGapDays==null?"—":H.medGapDays+tr("일","d"),col:"#4FACFE"},
                {l:tr("평균 풀이 시간","Avg solve time"),v:null,txt:H.avgDur==null?"—":H.avgDur+tr("초","s"),col:"#A29BFE",
                 sub:H.durRecent!=null&&H.durPrev!=null?tr(H.durPrev+"초 → "+H.durRecent+"초",""):""},
              ]},
              {t:tr("🧩 지식 조합","🧩 Integration"),rows:[
                {l:tr("기본 문항 정답률","Basic accuracy"),v:H.basicAcc,col:"#6C5CE7",sub:(H.basicN||0)+tr("문항","")},
                {l:tr("응용·서술 정답률","Applied accuracy"),v:H.applyAcc,col:"#27C2A0",sub:(H.applyN||0)+tr("문항","")},
                {l:tr("조합 격차","Integration gap"),v:H.integGap==null?null:Math.min(1,Math.abs(H.integGap)*2),txt:gapTxt,col:H.integGap!=null&&H.integGap>=0.25?"#D9534F":"#27C2A0",
                 sub:tr("아는 개념을 섞어 쓰는 힘","combining known concepts")},
              ]},
            ];
            return(
            <div className="card" style={{padding:"18px 20px",marginTop:14}}>
              <div className="eyebrow" style={{marginBottom:4}}>{tr("🧭 학습 습관 — SRL 5차원 프로파일","🧭 Study habits — SRL 5-dimension profile")}</div>
              <div style={{fontSize:12,color:"var(--sub)",marginBottom:12}}>{tr("자기조절학습(계획→수행→성찰) 틀로 본 '어떻게 공부하는가' — 손글씨 풀이 과정에서만 나오는 신호야.","How you study, framed by self-regulated learning — signals only a process-level app can see.")}</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(205px,1fr))",gap:"14px 20px",marginBottom:12}}>
                {DIMS.map(d=>(
                  <div key={d.t}>
                    <div style={{fontSize:11,fontWeight:800,color:"var(--pri-d)",marginBottom:7,borderBottom:"1px solid var(--line)",paddingBottom:4}}>{d.t}</div>
                    {d.rows.map((r,i)=>(
                      <div key={i} style={{marginBottom:7}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                          <span style={{fontSize:11.5,color:"var(--sub)",fontWeight:600}}>{r.l}</span>
                          <b style={{color:r.col,fontSize:14,fontFamily:"'Jua',sans-serif"}}>{r.txt!==undefined?r.txt:(r.v==null?"—":Math.round(r.v*100)+"%")}</b>
                        </div>
                        {r.v!=null&&<div className="bar" style={{height:5,marginTop:2}}><i style={{width:Math.round(Math.max(0,Math.min(1,r.v))*100)+"%",background:r.col}}/></div>}
                        {r.sub?<div style={{fontSize:10,color:"var(--sub)",marginTop:1}}>{r.sub}</div>:null}
                      </div>))}
                  </div>))}
              </div>
              {hLines.map((l,i)=>(
                <div key={i} style={{fontSize:12.5,lineHeight:1.7,fontWeight:600,color:l.tone==="warn"?"#9B1C1C":l.tone==="good"?"#166534":"var(--ink)"}}>
                  {l.tone==="warn"?"⚠️ ":l.tone==="good"?"👏 ":"· "}{l.text}
                </div>))}
            </div>);})()}
        </>)}

        {tab==="growth"&&(<>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(250px,1fr))",gap:14}}>
            {FACTORS.map(f=>{
              const s=fsum[f.id]||{};
              return(
                <div key={f.id} className="card" style={{padding:"14px 16px"}}>
                  <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:6}}>
                    <b style={{color:f.color,fontSize:13.5}}>{f.name}</b>
                    <span style={{marginLeft:"auto",fontSize:12.5,fontWeight:800,color:(s.slope||0)>=0?"#1E9E5A":"#D9534F"}}>
                      {tr("성장률 ","slope ")}{slopeTxt(s.slope)}
                    </span>
                  </div>
                  <Spark fid={f.id} color={f.color}/>
                  <div style={{fontSize:11,color:"var(--sub)",marginTop:4}}>{tr("최근 12주 · 주 단위 평균 · 기울기 = 최소제곱 회귀","12 wks · weekly avg · least-squares slope")}</div>
                </div>);})}
          </div>
          {calib.n>=20&&(
            <div className="card" style={{padding:"18px 20px",marginTop:14}}>
              <div className="eyebrow" style={{marginBottom:4}}>{tr("🧪 측정 엔진 자기 검증","🧪 Engine self-validation")}</div>
              <div style={{fontSize:12.5,color:"var(--sub)",lineHeight:1.6,marginBottom:10}}>
                {tr("이 대시보드의 숙련도는 온라인 Rasch(1PL) 추정치야. 엔진은 매 문제 전에 '맞힐 확률'을 예측하고 실제 결과와 비교해 자기 정확도를 공개해.",
                   "Mastery here is an online Rasch (1PL) estimate. Before every attempt the engine predicts P(correct) and audits itself against reality.")}
              </div>
              <div style={{display:"flex",gap:16,flexWrap:"wrap",alignItems:"baseline",marginBottom:10}}>
                <span style={{fontFamily:"'Jua',sans-serif",fontSize:22,color:"var(--pri)"}}>{calib.brier!=null?calib.brier.toFixed(3):"—"}</span>
                <span style={{fontSize:12,color:"var(--sub)"}}>{tr("Brier 점수 (0=완벽 예측, 0.25=동전 던지기) · 예측 "+calib.n+"회","Brier score (0=perfect, .25=coin flip) · "+calib.n+" predictions")}</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10}}>
                {calib.buckets.map((b,i)=>b.n<3?null:(
                  <div key={i} style={{background:"var(--bg)",borderRadius:10,padding:"8px 11px"}}>
                    <div style={{fontSize:10.5,fontWeight:700,color:"var(--sub)",marginBottom:5}}>{tr("예측 ","pred ")+(i*20)+"~"+((i+1)*20)+"% · "+b.n+tr("회","x")}</div>
                    {[[tr("예측","pred"),b.p,"#B7B1D6"],[tr("실제","actual"),b.s,"var(--pri)"]].map(([lbl,v,col])=>(
                      <div key={lbl} style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                        <span style={{fontSize:10,color:"var(--sub)",width:26}}>{lbl}</span>
                        <div className="bar" style={{height:6,flex:1}}><i style={{width:Math.round((v||0)*100)+"%",background:col}}/></div>
                        <b style={{fontSize:11,width:32,textAlign:"right"}}>{Math.round((v||0)*100)}%</b>
                      </div>))}
                  </div>))}
              </div>
              <div style={{fontSize:11,color:"var(--sub)",marginTop:8}}>{tr("예측과 실제가 가까울수록 잘 보정된 측정 — 이 지표가 우리가 모델을 개선하는 기준이야.","The closer prediction tracks reality, the better calibrated the measurement.")}</div>
            </div>)}
          {trends.length>0&&(
            <div className="card" style={{padding:"18px 20px",marginTop:14}}>
              <div className="eyebrow" style={{marginBottom:8}}>{tr("단원별 성장 추세 (시도 4회 이상)","Per-unit trend (≥4 attempts)")}</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:6}}>
                {trends.slice(0,10).map(t=>(
                  <div key={t.id} onClick={()=>{setTab("graph");pick(t.id);}} style={{display:"flex",gap:8,alignItems:"center",padding:"6px 8px",borderRadius:9,cursor:"pointer"}}>
                    <span style={{fontSize:13,fontWeight:800,color:t.slope>=0?"#1E9E5A":"#D9534F",width:74}}>{(t.slope>=0?"▲ +":"▼ ")+(Math.round(t.slope*1000)/10)+"p/주"}</span>
                    <span style={{fontSize:13}}>{courseOf(t.id)?.name} · {nodeById(t.id)?.name}</span>
                    <span style={{fontSize:11,color:"var(--sub)",marginLeft:"auto"}}>{t.n}{tr("회","x")}</span>
                  </div>))}
              </div>
            </div>)}
        </>)}
      </>)}
      {demo&&attempts.length>0&&(
        <div style={{marginTop:12,fontSize:12,color:"#946200",background:"#FFF7E0",border:"1px solid #FBE3B8",borderRadius:10,padding:"8px 13px"}}>
          {tr("✨ 지금 보는 건 데모 시나리오(중3·인수분해 취약 학생의 10주)야. 실제 학습이 쌓이면 자동으로 네 데이터로 바뀌어.","✨ This is a demo scenario. Your real data replaces it as you study.")}
        </div>)}
    </section>
  );
}

export { Insight };
