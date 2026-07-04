/* ── 학원 대시보드 — 전체 학생 한눈에 ──
   학생별 측정 요약을 한 테이블로: 숙련도(Rasch)·5요인·학습 습관(힌트 의존/
   포기/재도전)·취약 단원·주간 활동·경고 플래그. 행을 누르면 그 학생의
   성장 인사이트로 들어간다. "점수 몇 점"이 아니라 "누가 어떤 이유로
   관심이 필요한가"를 원장이 10초 만에 파악하는 화면. */
import { tr } from "../core/platform.js";
import { attemptsOf } from "../core/attempts.js";
import { abilityByNode } from "../core/rasch.js";
import { factorSummary } from "../core/mastery.js";
import { habitInsights, habitProfile } from "../core/habits.js";
import { FACTORS, courseOf, nodeById } from "../core/knowledgeGraph.js";
import React from "react";
const { useMemo } = React;

const DAY=864e5;
const pct=(v)=>v==null?"—":Math.round(v*100)+"%";
const mColor=(m)=>m==null?"#B9C3D2":m<0.45?"#C0392B":m<0.7?"#B7791F":"#2F855A";
const ago=(t)=>{
  if(!t)return tr("기록 없음","no data");
  const d=Math.floor((Date.now()-t)/DAY);
  return d<=0?tr("오늘","today"):d===1?tr("어제","yesterday"):d+tr("일 전","d ago");
};

function AcademyDash({students,onInsight,onBack}){
  const rows=useMemo(()=>students.map(s=>{
    const at=attemptsOf(s.id);
    const graded=at.filter(a=>a.src!=="followup"&&a.src!=="skip");
    const week=graded.filter(a=>Date.now()-a.t<7*DAY).length;
    const {ability}=abilityByNode(at);
    const meas=Object.entries(ability).filter(([,x])=>!x.indirect);
    const avgM=meas.length?meas.reduce((sum,[,x])=>sum+x.m,0)/meas.length:null;
    const weak=meas.filter(([,x])=>x.m<0.55&&x.n>=2).sort((a,b)=>a[1].m-b[1].m).slice(0,2)
      .map(([id])=>{const n=nodeById(id);return(courseOf(id)?.name||"")+" "+(n?n.name:id);});
    const fs=factorSummary(at);
    const hb=habitProfile(at);
    const warns=habitInsights(hb).filter(l=>l.tone==="warn");
    const lastT=at.length?at[at.length-1].t:0;
    return{s,at,n:graded.length,week,avgM,measN:meas.length,weak,fs,hb,warns,lastT};
  }).sort((a,b)=>b.lastT-a.lastT),[students]);

  const activeWeek=rows.filter(r=>r.week>0).length;
  const needCare=rows.filter(r=>r.warns.length>0||r.weak.length>0);
  const th={padding:"8px 10px",border:"1px solid var(--line)",fontSize:11.5,whiteSpace:"nowrap"};
  const td={padding:"8px 10px",border:"1px solid var(--line)",fontSize:12.5,verticalAlign:"middle"};

  return(
    <section>
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:14}}>
        <h2 style={{margin:0,fontFamily:"'Jua',sans-serif",fontSize:21,color:"var(--ink)"}}>📋 {tr("학원 대시보드","Academy dashboard")}</h2>
        <span style={{fontSize:12.5,color:"var(--sub)"}}>
          {tr("학생 ","students ")}{students.length}{tr("명 · 이번 주 활동 "," · active this week ")}{activeWeek}{tr("명 · 관심 필요 "," · needs attention ")}{needCare.length}{tr("명","")}
        </span>
        <button className="btn gho sm" style={{marginLeft:"auto"}} onClick={onBack}>{tr("← 학생 관리","← Students")}</button>
      </div>

      {students.length===0?(
        <div className="card" style={{padding:"26px",textAlign:"center",color:"var(--sub)",lineHeight:1.8}}>
          {tr("학생 목록이 비어 있어요. 학생 관리에서 학생을 추가하거나, 🔗 홈학습 연동으로 가져오세요.","Add students first, or import via home-study link.")}
        </div>
      ):(
      <div className="card" style={{padding:"14px 12px"}}>
        <div style={{overflowX:"auto"}}>
          <table style={{borderCollapse:"collapse",width:"100%",minWidth:920}}>
            <thead>
              <tr style={{background:"var(--pri-s)",color:"var(--pri-d)"}}>
                {[tr("학생","Student"),tr("숙련도","Mastery"),tr("5요인 (개념·계산·전략·추론·끈기)","5 factors"),
                  tr("힌트의존","Hints"),tr("포기","Give-up"),tr("재도전","Retry"),
                  tr("취약 단원","Weak units"),tr("주간/전체 시도","Week/total"),tr("마지막","Last"),""].map((h,i)=>
                  <th key={i} style={{...th,textAlign:i===0||i===6?"left":"center"}}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r,i)=>(
                <tr key={r.s.id} style={{...(i%2?{background:"var(--bg)"}:{}),cursor:"pointer"}} onClick={()=>onInsight(r.s)} title={tr("누르면 성장 인사이트","Open growth insight")}>
                  <td style={td}>
                    <b>{r.s.name}</b>
                    {r.warns.length>0&&<span title={r.warns.map(w=>w.text).join("\n")} style={{marginLeft:6,fontSize:11,fontWeight:800,color:"#C0392B"}}>⚠️{r.warns.length}</span>}
                  </td>
                  <td style={{...td,textAlign:"center",minWidth:110}}>
                    {r.avgM==null?<span style={{color:"var(--sub)"}}>—</span>:(<>
                      <b style={{color:mColor(r.avgM)}}>{pct(r.avgM)}</b>
                      <span style={{fontSize:10.5,color:"var(--sub)"}}> · {r.measN}{tr("단원","u")}</span>
                      <div className="bar" style={{height:5,marginTop:3}}><i style={{width:Math.round(r.avgM*100)+"%",background:mColor(r.avgM)}}/></div>
                    </>)}
                  </td>
                  <td style={{...td,textAlign:"center",minWidth:150}}>
                    <div style={{display:"inline-flex",gap:5,alignItems:"flex-end"}}>
                      {FACTORS.map(f=>{
                        const v=r.fs[f.id]?.cur;
                        return<div key={f.id} title={f.name+": "+pct(v)} style={{width:13,height:26,background:"var(--line)",borderRadius:3,position:"relative"}}>
                          <div style={{position:"absolute",bottom:0,left:0,right:0,height:Math.round((v||0)*100)+"%",background:f.color,borderRadius:3,opacity:v==null?.25:1}}/>
                        </div>;})}
                    </div>
                  </td>
                  {[["hintRate",0.4],["giveupRate",0.2]].map(([k,warnAt])=>(
                    <td key={k} style={{...td,textAlign:"center",fontWeight:700,
                      color:r.hb[k]!=null&&r.hb[k]>=warnAt?"#C0392B":"var(--ink)"}}>{pct(r.hb[k])}</td>))}
                  <td style={{...td,textAlign:"center",fontWeight:700,color:r.hb.retryRate!=null&&r.hb.retryRate>=0.6?"#2F855A":"var(--ink)"}}>{pct(r.hb.retryRate)}</td>
                  <td style={{...td,maxWidth:220}}>
                    {r.weak.length?r.weak.map(w=><div key={w} style={{fontSize:11.5,color:"#C0392B",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>⚠ {w}</div>)
                      :<span style={{fontSize:11.5,color:"var(--sub)"}}>{r.n?tr("없음","none"):"—"}</span>}
                  </td>
                  <td style={{...td,textAlign:"center"}}>{r.week} / {r.n}</td>
                  <td style={{...td,textAlign:"center",fontSize:11.5,color:"var(--sub)",whiteSpace:"nowrap"}}>{ago(r.lastT)}</td>
                  <td style={{...td,textAlign:"center"}}><button className="btn gho xs" onClick={e=>{e.stopPropagation();onInsight(r.s);}}>📊</button></td>
                </tr>))}
            </tbody>
          </table>
        </div>
        <div style={{fontSize:11,color:"var(--sub)",marginTop:10,padding:"0 4px"}}>
          {tr("숙련도 = 온라인 Rasch 추정(직접 측정 단원 평균) · ⚠️ = 학습 습관 경고(마우스를 올리면 내용) · 행을 누르면 학생별 성장 인사이트","Mastery = online Rasch estimate · hover ⚠️ for habit warnings · click a row for the student's insight")}
        </div>
      </div>)}

      {needCare.length>0&&(
        <div className="card" style={{padding:"16px 18px",marginTop:14}}>
          <div className="eyebrow" style={{marginBottom:8}}>{tr("이번 주 상담 포인트","Consultation points")}</div>
          {needCare.slice(0,6).map(r=>(
            <div key={r.s.id} style={{fontSize:13,lineHeight:1.7,marginBottom:6}}>
              <b style={{cursor:"pointer"}} onClick={()=>onInsight(r.s)}>{r.s.name}</b>
              {r.weak.length>0&&<span> — {tr("취약: ","weak: ")}{r.weak.join(", ")}</span>}
              {r.warns.slice(0,1).map((w,i)=><span key={i} style={{color:"#9B1C1C"}}> · {w.text}</span>)}
            </div>))}
        </div>)}
    </section>
  );
}

export { AcademyDash };
