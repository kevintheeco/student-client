import { CFG, DECKS_KEY, LS, SUBJ_COLORS, byteSize, dk, estimateStorage, formatSize, tr } from "../core/platform.js";
import { COMPANY_MODE, callAI, uid } from "../core/ai.js";
import { LEVELS } from "../core/curriculum.js";
import { LEVELS_US } from "../core/curriculumUS.js";
import { Cheer } from "../ui/common.jsx";
import React from "react";
const { useState } = React;

/* ════════════════════════════════════════════════════════════════
   단원별 공부 — 자료 없이 교육과정 목차에서 단원을 골라 바로 공부.
   선택한 단원마다 AI가 소단원별 과외 내용(src)을 써서
   교재 모드와 같은 형태의 덱을 만든다 → 과외·이해·암기·시험 엔진 재사용.
   edition==="us"면 미국 커리큘럼(curriculumUS.js)+영어 프롬프트 사용.
════════════════════════════════════════════════════════════════ */

function UnitStudy({edition="student",subjects,onSave,onDone,onCancel}){
  const isUS=edition==="us";
  const levels=isUS?LEVELS_US:LEVELS;
  const [openSubj,setOpenSubj]=useState(null);          // 펼친 과목 id
  const [picked,setPicked]=useState({});                // "subjId::단원명" → true
  const [busy,setBusy]=useState(false);
  const [busyMsg,setBusyMsg]=useState("");
  const [progress,setProgress]=useState(0);
  const [err,setErr]=useState("");

  const key=(sid,ch)=>sid+"::"+ch;
  const toggle=(sid,ch)=>{if(busy)return;setPicked(p=>{const n={...p};if(n[key(sid,ch)])delete n[key(sid,ch)];else n[key(sid,ch)]=true;return n;});};
  const pickedList=Object.keys(picked);

  // 과목 이름의 폴더가 없으면 만들어서 id 반환
  function ensureFolder(name,curSubjects){
    const ex=curSubjects.find(s=>s.name===name);
    if(ex)return {id:ex.id,subjects:curSubjects};
    const ns={id:uid(),name,color:SUBJ_COLORS[curSubjects.length%SUBJ_COLORS.length]};
    const next=[...curSubjects,ns];
    onSave(next);
    return {id:ns.id,subjects:next};
  }

  async function build(){
    if(!CFG.key&&!CFG.geminiKey&&!COMPANY_MODE){
      setErr(tr("API 키가 없어. 설정에서 Claude 또는 Gemini 키를 먼저 입력해줘.","No API key. Add a Claude or Gemini key in Settings first."));return;
    }
    if(!pickedList.length){setErr(tr("공부할 단원을 하나 이상 골라줘.","Pick at least one unit."));return;}
    setBusy(true);setErr("");setProgress(0);

    // 과목별로 묶기: subjId → [chapter...]
    const bySubj={};
    pickedList.forEach(k=>{const i=k.indexOf("::");const sid=k.slice(0,i),ch=k.slice(i+2);(bySubj[sid]=bySubj[sid]||[]).push(ch);});
    const subjIds=Object.keys(bySubj);
    const totalCh=pickedList.length;
    let doneCh=0;

    let curSubjects=subjects;
    try{
      for(const sid of subjIds){
        let subjDef=null;
        for(const lv of levels){const f=lv.subjects.find(s=>s.id===sid);if(f){subjDef=f;break;}}
        if(!subjDef)continue;
        const chapters=bySubj[sid].map(chName=>subjDef.chapters.find(c=>c.name===chName)).filter(Boolean);

        // 단원마다 AI가 소단원별 과외 내용 작성
        const concepts=[];
        for(const ch of chapters){
          setBusyMsg(tr("단원 내용 만드는 중… ","Writing unit content… ")+subjDef.name+" · "+ch.name+" ("+(doneCh+1)+"/"+totalCh+")");
          let made=null;
          try{
            const r=isUS?await callAI(
              "You are an outstanding US math tutor who knows the Common Core / high-school & AP curriculum precisely. Keep grade-level rigor, write math in LaTeX ($...$). Output JSON only (no code fences)."+
              (CFG.lang==="ko"?"\n\n중요: 이 학생은 미국 커리큘럼을 공부하는 한국어 사용자다. 소단원 이름(name)은 영어 원문 그대로 두되, 과외 내용(src)은 한국어로 써라 — 수학 용어는 영어를 유지하고 괄호로 한국어를 병기해도 좋다.":""),
              "Subject: "+subjDef.name+"\nUnit: "+ch.name+"\nSpecific lessons: "+ch.topics.join(", ")+
              "\n\nFor each lesson, write a focused 1:1 tutoring explanation (60-90 words) — include the definition, key formula, one worked example, and one common mistake. Keep lesson names exactly as listed. JSON only: {\"concepts\":[{\"name\":\"lesson name\",\"src\":\"tutoring content\"}]}",
              true,{maxTok:7000,lang:CFG.lang}):await callAI(
              "너는 대한민국 중·고등학교 수학 교육과정을 정확히 아는 최고의 수학 과외 선생님이야. 교과서 수준을 지키고, 수식은 LaTeX($...$)로 써. JSON만 출력해(코드블록 없이).",
              "과목: "+subjDef.name+"\n대단원: "+ch.name+"\n소단원 목록: "+ch.topics.join(", ")+
              "\n\n각 소단원마다 1:1 과외용 핵심 내용을 300~500자로 써줘 — 정의·핵심 공식·대표 예시 1개·자주 하는 실수 1개 포함. 소단원 이름은 목록 그대로. JSON만: {\"concepts\":[{\"name\":\"소단원명\",\"src\":\"과외 내용\"}]}",
              true,{maxTok:7000});
            if(Array.isArray(r?.concepts))made=r.concepts;
          }catch(e){console.warn("[unit] 내용 생성 실패:",ch.name,e.message);}
          const list=made&&made.length?made:ch.topics.map(t=>({name:t,src:""}));
          list.forEach(c=>{
            const name=String(c.name||"").slice(0,80);if(!name)return;
            concepts.push({id:uid(),name,u1:ch.name,src:String(c.src||"").slice(0,1200),box:1,dueAt:0,reps:0,lapses:0});
          });
          doneCh++;setProgress(Math.round(doneCh/totalCh*90));
        }
        if(!concepts.length)continue;

        // 과목 이름 폴더에 저장 (없으면 자동 생성)
        const ef=ensureFolder(subjDef.name,curSubjects);curSubjects=ef.subjects;
        const chNames=chapters.map(c=>c.name);
        const deckName=subjDef.name+" · "+(chNames.length>1?chNames[0]+tr(" 외 "," +")+(chNames.length-1)+tr("개 단원"," units"):chNames[0]);
        const id=uid();
        const deck={id,name:deckName,subjId:ef.id,
          material:(isUS?"US Math Curriculum — ":"대한민국 수학 교육과정 — ")+subjDef.name+" / "+chNames.join(", "),
          summary:tr("단원별 공부: ","Units: ")+chNames.join(" · "),createdAt:Date.now(),
          isBook:true,isUnit:true,k12:true,...(isUS?{k12us:true}:{}),studyType:"explain",concepts};

        setBusyMsg(tr("저장 공간 확인 중…","Checking storage…"));
        const need=byteSize(dk(id),deck),est=await estimateStorage();
        if(est.free<need*1.5){setErr(tr("저장 공간이 부족해 (남은 ","Not enough storage (free ")+formatSize(est.free)+tr("). 오래된 자료를 삭제하고 다시 시도해줘.","). Delete old materials and retry."));setBusy(false);setBusyMsg("");setProgress(0);return;}
        setBusyMsg(tr("저장 중…","Saving…"));
        if(!(await LS.setVerified(dk(id),deck))){LS.del(dk(id));setErr(tr("저장 실패: 용량 부족이거나 저장이 거부됐어.","Save failed: out of space or blocked."));setBusy(false);setBusyMsg("");setProgress(0);return;}
        const prevList=LS.get(DECKS_KEY)||[];
        if(!(await LS.setVerified(DECKS_KEY,[{id,name:deck.name,subjId:ef.id,studyType:"explain"},...prevList]))){LS.del(dk(id));setErr(tr("저장 실패: 저장 공간이 꽉 찼어.","Save failed: storage full."));setBusy(false);setBusyMsg("");setProgress(0);return;}
      }
      setProgress(100);setBusyMsg(tr("완료! 🎉 이제 공부 시작하자","Done! 🎉 Let's study"));
      setTimeout(()=>{setBusy(false);setBusyMsg("");onDone();},800);
    }catch(e){
      setBusy(false);setBusyMsg("");setProgress(0);
      setErr(tr("단원 생성 실패: ","Failed to build units: ")+(e.message||e));
    }
  }

  return(
    <section className="card panel">
      <div className="eyebrow">{tr("단원별 공부","Study by unit")}</div>
      <p style={{fontSize:13,color:"var(--sub)",lineHeight:1.65,margin:"2px 0 6px"}}>
        {tr("자료가 없어도 돼! 교과서 목차에서 단원을 고르면 AI 교수님이 소단원마다 과외 내용을 만들어줘. 만들어진 단원은 홈에서 과외·이해·암기·시험 어떤 방식으로든 공부할 수 있어.",
           "No material needed — pick units from the national curriculum and the AI prof writes tutoring content per topic.")}
      </p>

      {levels.map(lv=>(
        <div key={lv.levelId} style={{marginBottom:4}}>
          <div style={{fontFamily:"'Jua',sans-serif",fontSize:14.5,color:"var(--ink)",margin:"10px 0 8px"}}>{lv.level}</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {lv.subjects.map(sj=>{
              const nSel=sj.chapters.filter(c=>picked[key(sj.id,c.name)]).length;
              const open=openSubj===sj.id;
              return(
                <div key={sj.id} className="card" style={{padding:"12px 14px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}} onClick={()=>setOpenSubj(open?null:sj.id)}>
                    <span style={{fontWeight:800,color:"var(--ink)",fontSize:14}}>{sj.name}</span>
                    <span style={{fontSize:11.5,color:"var(--sub)"}}>{sj.chapters.length}{tr("개 단원"," units")}</span>
                    {nSel>0&&<span className="chip" style={{background:"var(--pri)",color:"#fff"}}>{nSel}</span>}
                    <span style={{marginLeft:"auto",color:"var(--sub)"}}>{open?"▾":"▸"}</span>
                  </div>
                  {open&&(
                    <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:6}}>
                      {sj.chapters.map(ch=>{
                        const on=!!picked[key(sj.id,ch.name)];
                        return(
                          <button key={ch.name} type="button" onClick={()=>toggle(sj.id,ch.name)} disabled={busy}
                            style={{textAlign:"left",padding:"10px 12px",cursor:busy?"default":"pointer",borderRadius:12,
                              border:"1.5px solid "+(on?"var(--pri)":"var(--line)"),background:on?"var(--pri-s)":"#FBFAFF",transition:"all .15s"}}>
                            <div style={{fontSize:13,fontWeight:700,color:on?"var(--pri-d)":"var(--ink)"}}>{on?"✅ ":""}{ch.name}</div>
                            <div style={{fontSize:11,color:"var(--sub)",marginTop:3,lineHeight:1.5}}>{ch.topics.join(" · ")}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {err&&<div className="err">{err}</div>}
      {busy&&(
        <div style={{position:"sticky",bottom:0,zIndex:10,background:"var(--card)",
          border:"2px solid var(--pri)",borderRadius:14,padding:"14px 16px",
          boxShadow:"0 4px 24px rgba(108,92,231,.18)",display:"flex",flexDirection:"column",gap:8}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:13,fontWeight:600,color:progress===100?"var(--mint)":"var(--pri-d)"}}>{busyMsg||tr("만드는 중…","Working…")}</span>
            <span style={{fontSize:15,fontWeight:700,color:progress===100?"var(--mint)":"var(--pri-d)"}}>{progress}%</span>
          </div>
          <div style={{height:12,borderRadius:8,background:"#F0EDFA",overflow:"hidden"}}>
            <div style={{height:"100%",borderRadius:8,
              background:progress===100?"var(--mint)":"linear-gradient(90deg,var(--pri),var(--mint))",
              width:progress+"%",transition:"width .5s ease"}}/>
          </div>
          {progress<100&&<span style={{fontSize:11.5,color:"var(--sub)"}}>{tr("페이지를 닫지 마. 단원마다 과외 내용을 쓰고 있어 (단원당 30초 정도).","Don't close the page — writing content per unit (~30s each).")}</span>}
          {progress<100&&<Cheer style={{marginTop:2}}/>}
        </div>
      )}
      <div className="row">
        <button className="btn pri" onClick={build} disabled={busy}>
          {busy?tr("만드는 중…","Building…"):tr("이 단원들로 공부 시작! 📚","Study these units! 📚")+(pickedList.length?" ("+pickedList.length+")":"")}
        </button>
        <button className="btn gho" onClick={onCancel} disabled={busy}>{tr("취소","Cancel")}</button>
      </div>
      <p className="hint">{tr("단원을 고르면 과목 이름의 폴더가 자동으로 만들어져. 이미 공부하던 단원을 또 만들면 새 덱으로 추가돼.","Units are saved into a folder named after the subject.")}</p>
    </section>
  );
}

export { UnitStudy };
