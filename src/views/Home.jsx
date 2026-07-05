import { CFG, DECKS_KEY, LS, dk, tr } from "../core/platform.js";
import { Prof, RateBar, ratePct } from "../ui/common.jsx";
import { deckSummary } from "../core/srs.js";
import React from "react";
const { useState, useEffect, useRef, useCallback } = React;

function Home({decks,subjects,onAdd,onUnits,onOpen,onNotes,onChanged,nick,onInsight}){
  const [det,setDet]=useState({});
  const [pickFor,setPickFor]=useState(null);   // 공부 시작 시 모드 선택 시트 {id,def}
  useEffect(()=>{
    const o={};decks.forEach(d=>{const f=LS.get(dk(d.id));if(f)o[d.id]={...deckSummary(f),createdAt:f.createdAt,isExam:f.isExam,examCount:(f.examQuestions||[]).length,studyType:f.studyType};});setDet(o);
  },[decks]);

  function del(id,name){
    if(!confirm(tr('"'+name+'" 자료와 학습 기록을 완전히 삭제할까?\n되돌릴 수 없어.','Delete "'+name+'" and all its progress?\nThis cannot be undone.')))return;
    LS.del(dk(id));
    LS.set(DECKS_KEY,(LS.get(DECKS_KEY)||[]).filter(x=>x.id!==id));
    onChanged();
  }
  function move(id,newSubjId){
    const f=LS.get(dk(id));
    if(f)LS.set(dk(id),{...f,subjId:newSubjId});
    LS.set(DECKS_KEY,(LS.get(DECKS_KEY)||[]).map(x=>x.id===id?{...x,subjId:newSubjId}:x));
    onChanged();
  }
  function setMode(id,type){
    const f=LS.get(dk(id));
    if(f)LS.set(dk(id),{...f,studyType:type});
    LS.set(DECKS_KEY,(LS.get(DECKS_KEY)||[]).map(x=>x.id===id?{...x,studyType:type}:x));
    onChanged();
  }
  const getSubj=(id)=>subjects.find(s=>s.id===id);

  return(
    <section>
      <div className="hero">
        <Prof size={66}/>
        <div>
          {nick&&<div style={{fontFamily:"'Jua',sans-serif",fontSize:15,color:"var(--pri)",marginBottom:4}}>{tr("안녕, ","Hi, ")}{nick}! 👋</div>}
          {onUnits?(
            <>
              <h2>{tr(<>중·고등 수학,<br/>단원별로 정복하자</>,<>Middle·High math,<br/>unit by unit</>)}</h2>
              <p>{tr(<>교과서 단원을 고르거나, 학교 프린트·노트를 넣어줘.<br/>맞히면 뜸하게, 틀리면 자주 — 그게 장기기억의 비결이야.</>,<>Pick a textbook unit or drop in your own notes.<br/>Right → less often, wrong → more often.</>)}</p>
            </>
          ):(
            <>
              <h2>{tr(<>공부한 거,<br/>다시 안 까먹게 해줄게</>,<>What you studied,<br/>I'll keep it from fading</>)}</h2>
              <p>{tr(<>자료를 넣어주면 핵심을 뽑아 무작위로 물어봐.<br/>맞히면 뜸하게, 틀리면 자주 — 그게 장기기억의 비결이야.</>,<>Add your material and I'll pull out the key ideas and quiz you.<br/>Right → less often, wrong → more often — that's how long-term memory works.</>)}</p>
            </>
          )}
        </div>
      </div>
      {onUnits?(
        <>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))",gap:12,marginBottom:12}}>
            <article className="card" onClick={onUnits} style={{cursor:"pointer",padding:"18px 20px",border:"1.5px solid var(--pri)",background:"var(--pri-s)"}}>
              <div style={{fontSize:24}}>📚</div>
              <div style={{fontFamily:"'Jua',sans-serif",fontSize:16,color:"var(--ink)",margin:"6px 0 4px"}}>{tr("단원별 공부","Study by unit")}</div>
              <div style={{fontSize:12.5,color:"var(--sub)",lineHeight:1.6}}>{tr("교과서 목차에서 단원을 고르면 AI 교수님이 바로 과외 시작 — 자료 없어도 OK","Pick units from the curriculum — no material needed")}</div>
            </article>
            <article className="card" onClick={onAdd} style={{cursor:"pointer",padding:"18px 20px"}}>
              <div style={{fontSize:24}}>📎</div>
              <div style={{fontFamily:"'Jua',sans-serif",fontSize:16,color:"var(--ink)",margin:"6px 0 4px"}}>{tr("학습자료 넣어 공부","Study my material")}</div>
              <div style={{fontSize:12.5,color:"var(--sub)",lineHeight:1.6}}>{tr("학교 프린트·문제집·노트·PDF를 넣으면 핵심을 뽑아 복습시켜줘","Drop in handouts, notes, or PDFs")}</div>
            </article>
          </div>
          <div className="row" style={{marginBottom:18}}>
            {onInsight&&<button className="btn gho" onClick={onInsight}>{tr("📊 성장 인사이트","📊 Growth insight")}</button>}
          </div>
        </>
      ):(
        <div className="row" style={{marginBottom:18}}>
          <button className="btn pri" onClick={onAdd}>{tr("+ 공부한 거 추가","+ Add material")}</button>
          {onInsight&&<button className="btn gho" onClick={onInsight}>{tr("📊 성장 인사이트","📊 Growth insight")}</button>}
        </div>
      )}
      {decks.length===0?(
        <div className="empty">{tr("아직 자료가 없네! 공부한 거 던져주면 문제 낼게 📚","No materials yet! Drop in what you studied and I'll quiz you 📚")}</div>
      ):(
        <div className="grid">
          {decks.map(d=>{
            const s=det[d.id];const subj=getSubj(d.subjId);
            return(
              <article key={d.id} className="card deck">
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:6}}>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    <select
                      value={subjects.some(x=>x.id===d.subjId)?d.subjId:""}
                      onChange={e=>move(d.id,e.target.value)}
                      className="subj-badge"
                      style={{background:(subj?subj.color:"#888")+"22",color:subj?subj.color:"var(--sub)",
                        border:"none",cursor:"pointer",fontFamily:"inherit"}}
                      title={tr("폴더 이동","Move folder")}>
                      {!subjects.some(x=>x.id===d.subjId)&&<option value="" disabled>{tr("폴더 선택","Pick folder")}</option>}
                      {subjects.map(x=><option key={x.id} value={x.id}>📁 {x.name}</option>)}
                    </select>
                    {s?.isExam&&<div className="subj-badge" style={{background:"#FFF7E0",color:"#946200"}}>{tr("📜 기출","📜 Past exam")}</div>}
                    <select
                      value={s?.studyType==="quiz"?"quiz":"explain"}
                      onChange={e=>setMode(d.id,e.target.value)}
                      className="subj-badge"
                      style={{background:(s?.studyType==="quiz"?"#EAF3FF":"#F0EAFF"),color:(s?.studyType==="quiz"?"#1B5FB0":"#6A3FB0"),
                        border:"none",cursor:"pointer",fontFamily:"inherit"}}
                      title={tr("학습 방식 바꾸기","Change study mode")}>
                      <option value="explain">{tr("🧠 이해","🧠 Explain")}</option>
                      <option value="quiz">{tr("📇 암기","📇 Quiz")}</option>
                    </select>
                  </div>
                  {s?.createdAt&&<span style={{fontSize:11,color:"var(--sub)",flexShrink:0,marginTop:2}}>{new Date(s.createdAt).toLocaleDateString(CFG.lang==="en"?"en-US":"ko-KR",{year:"numeric",month:"short",day:"numeric"})}</span>}
                </div>
                <div className="nm">{d.name}</div>
                {s?(<>
                  <div style={{display:"flex",alignItems:"baseline",gap:6,marginBottom:11}}>
                    <span style={{fontFamily:"'Jua',sans-serif",fontSize:18,color:"var(--ink)"}}>{s.total}</span>
                    <span style={{fontSize:11,color:"var(--sub)"}}>{tr("개념","concepts")}</span>
                    {s.due>0&&<span style={{marginLeft:"auto",fontSize:11,fontWeight:700,color:"var(--pri)"}}>{tr("오늘 복습 ","Due today ")}{s.due}</span>}
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    <RateBar label={tr("개념 진행률","Started")} pct={ratePct(s.started,s.total)} tone="pri"/>
                    <RateBar label={tr("복습 진도율","Reviewed")} pct={ratePct(s.reviewed,s.total)} tone="gold"/>
                    <RateBar label={tr("심화 진도율","Mastered")} pct={ratePct(s.deep,s.total)} tone="mint"/>
                  </div>
                </>):<div className="muted">{tr("준비 중…","Preparing…")}</div>}
                <div className="acts">
                  <button className="btn pri sm" onClick={()=>setPickFor({id:d.id,def:(s?.studyType==="quiz"?"quiz":"explain")})}>
                    {tr("공부 시작","Study")}{s&&s.due>0?" · "+s.due+tr("개",""):""}
                  </button>
                  <button className="btn gho sm" onClick={()=>onNotes(d.id)}>📓</button>
                  <button className="btn gho sm" onClick={()=>del(d.id,d.name)}>{tr("삭제","Delete")}</button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {pickFor&&(
        <div onClick={()=>setPickFor(null)} style={{position:"fixed",inset:0,background:"rgba(34,28,57,.42)",zIndex:60,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div onClick={e=>e.stopPropagation()} className="card" style={{maxWidth:360,width:"100%",padding:22,display:"flex",flexDirection:"column",gap:12}}>
            <div style={{fontFamily:"'Jua',sans-serif",fontSize:16,color:"var(--ink)"}}>{tr("이 자료, 어떻게 공부할래?","How do you want to study this?")}</div>
            {[["learn","🎓",tr("개념 과외","Tutor"),tr("AI가 처음부터 1:1로 이해시켜주는 플립러닝","AI teaches you 1:1 first")],
              ["explain","🧠",tr("이해·설명형","Explain"),tr("손글씨로 풀고 AI 채점","Write it out, AI grades")],
              ["quiz","📇",tr("암기·퀴즈형","Flashcards"),tr("OX·객관식·단답 즉시채점","Instant OX / choice / short")],
              ["exam","📝",tr("시험 보기","Exam"),tr("객관식+단답+서술 실전 시험 → 한 번에 채점·점수","MC+short+essay test → graded at once")]].map(([val,emo,lbl,desc])=>{
              const cur=pickFor.def===val;
              return(
                <button key={val} className="card" onClick={()=>{const id=pickFor.id;if(val!=="exam"&&val!=="learn"&&val!==pickFor.def)setMode(id,val);setPickFor(null);onOpen(id,val);}}
                  style={{textAlign:"left",padding:"14px 16px",cursor:"pointer",
                    border:"1.5px solid "+(cur?"var(--pri)":"var(--line)"),background:cur?"var(--pri-s)":"#FBFAFF"}}>
                  <div style={{fontWeight:800,color:"var(--ink)"}}>{emo} {lbl}{cur?tr(" · 기본"," · default"):""}</div>
                  <div style={{fontSize:12.5,color:"var(--sub)",marginTop:3}}>{desc}</div>
                </button>);
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export { Home };
