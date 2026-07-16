import { CFG, DECKS_KEY, LS, SUBJ_COLORS, byteSize, detectLang, dk, estimateStorage, formatSize, tr } from "../core/platform.js";
import { COMPANY_MODE, callAI, extractExamQuestions, ingestBook, prepImage, processPdf, toB64, transcribeFile, uid } from "../core/ai.js";
import { Cheer, FileDropZone } from "../ui/common.jsx";
import { PenPad, PhotoButton } from "../ui/pads.jsx";
import React from "react";
const { useState, useEffect, useRef, useCallback } = React;

function AddMaterial({edition="general",subjects,onSave,onDone,onCancel}){
  const isK12=edition==="student"||edition==="us";   // 학생용 입구에서 만든 덱 = 중·고등 실전형 출제 대상
  const [name,setName]=useState("");
  const [subjId,setSubjId]=useState(subjects[0]?.id||"");
  const [material,setMaterial]=useState("");
  const [files,setFiles]=useState([]);
  const [busy,setBusy]=useState(false);
  const [busyMsg,setBusyMsg]=useState("");
  const [progress,setProgress]=useState(0);
  const [err,setErr]=useState("");
  const [pen,setPen]=useState(false);
  const [newSubj,setNewSubj]=useState("");
  const [isExam,setIsExam]=useState(false);
  const [isBook,setIsBook]=useState(false);
  const [studyType,setStudyType]=useState("auto");
  const append=(t)=>{if(t)setMaterial(p=>(p.trim()?p.trim()+"\n":"")+t);};

  // 새 과목 빠른 추가
  function quickAddSubj(){
    const n=newSubj.trim();if(!n)return;
    const color=SUBJ_COLORS[subjects.length%SUBJ_COLORS.length];
    const s={id:uid(),name:n,color};
    onSave([...subjects,s]);setSubjId(s.id);setNewSubj("");
  }

  async function save(){
    if(!CFG.key&&!CFG.geminiKey&&!COMPANY_MODE){
      setErr(tr("API 키가 없어. 설정에서 Claude 또는 Gemini 키를 먼저 입력해줘.","No API key. Add a Claude or Gemini key in Settings first."));return;
    }
    if(!material.trim()&&files.length===0){
      setErr(tr("자료를 입력하거나 파일을 첨부해줘.","Enter some material or attach a file."));return;
    }

    // 새 과목 칸에 이름만 적고 '+추가'를 안 눌렀어도 자동으로 만들어 배정 (입력한 이름 우선)
    let useSubjId=subjId;
    const pendingName=newSubj.trim();
    if(pendingName){
      const existing=subjects.find(s=>s.name===pendingName);
      if(existing){useSubjId=existing.id;}
      else{
        const ns={id:uid(),name:pendingName,color:SUBJ_COLORS[subjects.length%SUBJ_COLORS.length]};
        onSave([...subjects,ns]);useSubjId=ns.id;
      }
      setSubjId(useSubjId);setNewSubj("");
    }
    if(!useSubjId)useSubjId=subjects[0]?.id||"";

    setBusy(true);setErr("");setProgress(0);setBusyMsg(tr("준비 중…","Preparing…"));

    // 글로벌 가짜 진행률 타이머: 0→70 빠르게, 70→90 느리게, 90에서 멈춤
    let _prog=0;
    const fakeTimer=setInterval(()=>{
      if(_prog<70){_prog=Math.min(70,_prog+1.5);}
      else if(_prog<90){_prog=Math.min(90,_prog+0.3);}
      setProgress(Math.round(_prog));
    },60);

    const fail=(msg)=>{
      clearInterval(fakeTimer);
      setProgress(0);setBusy(false);setBusyMsg("");
      setErr(msg);
    };
    const done=()=>{
      clearInterval(fakeTimer);
      setProgress(100);
      setBusyMsg(tr("완료! 🎉 이제 공부 시작하자","Done! 🎉 Let's study"));
      setTimeout(()=>{setBusy(false);setBusyMsg("");onDone();},800);
    };

    // ── 책(교재) 모드: 긴 PDF 흡수 → 대/중/소단원 트리 ──
    if(isBook){
      clearInterval(fakeTimer);
      const pdf=files.find(f=>f.type==="application/pdf");
      if(!pdf){fail(tr("책 모드는 PDF가 필요해. PDF를 첨부해줘.","Book mode needs a PDF. Attach one."));return;}
      if(pdf.size>30*1024*1024){fail(tr("PDF가 너무 커. 30MB 이하만 지원해.","PDF too big. Max 30MB."));return;}
      try{
        setBusyMsg(tr("교재 페이지 나누는 중…","Splitting pages…"));
        const b64=await toB64(pdf);
        const bookConcepts=await ingestBook(b64,(d,t)=>{
          setProgress(Math.round(t?d/t*88:0));
          setBusyMsg(tr("교재 분석 중… ","Analyzing textbook… ")+"("+d+"/"+t+tr(" 묶음)"," parts)"));
        },CFG.lang);
        if(!bookConcepts.length){fail(tr("교재에서 목차를 못 뽑았어. 글자가 들어있는 PDF인지 확인해줘.","Couldn't extract a TOC — is it a text-based PDF?"));return;}
        const id=uid();
        const u1s=[...new Set(bookConcepts.map(c=>c.u1).filter(Boolean))];
        const deck={id,name:name.trim()||pdf.name.replace(/\.pdf$/i,"")||tr("교재","Textbook"),subjId:useSubjId,
          material:"",summary:tr("교재 목차: ","Textbook TOC: ")+u1s.join(" · "),createdAt:Date.now(),
          isBook:true,...(isK12?{k12:true}:{}),...(edition==="us"?{k12us:true}:{}),studyType:"explain",concepts:bookConcepts};
        setBusyMsg(tr("저장 공간 확인 중…","Checking storage…"));
        const need=byteSize(dk(id),deck),est=await estimateStorage();
        if(est.free<need*1.5){fail(tr("저장 공간이 부족해 (남은 ","Not enough storage (free ")+formatSize(est.free)+tr("). 오래된 자료를 삭제하고 다시 시도해줘.","). Delete old materials and retry."));return;}
        setBusyMsg(tr("저장 중…","Saving…"));
        if(!(await LS.setVerified(dk(id),deck))){LS.del(dk(id));fail(tr("저장 실패: 용량 부족이거나 저장이 거부됐어.","Save failed: out of space or blocked."));return;}
        const prevList=LS.get(DECKS_KEY)||[];
        if(!(await LS.setVerified(DECKS_KEY,[{id,name:deck.name,subjId:useSubjId,studyType:"explain"},...prevList]))){LS.del(dk(id));fail(tr("저장 실패: 저장 공간이 꽉 찼어.","Save failed: storage full."));return;}
        done();return;
      }catch(e){fail(tr("교재 분석 실패: ","Textbook analysis failed: ")+(e.message||e));return;}
    }

    // ── 파일 처리 ──
    const pdfResults=[];
    let imageText="";
    let fileErrMsg="";
    for(let i=0;i<files.length;i++){
      const f=files[i];
      const isPdf=f.type==="application/pdf";
      if(isPdf&&f.size>30*1024*1024){fail(tr("PDF가 너무 커. 30MB 이하 파일만 지원해.","PDF is too big. Max 30MB."));return;}
      try{
        setBusyMsg(tr("파일 읽는 중… (","Reading file… (")+f.name+")");
        if(isPdf){
          const b64=await toB64(f);
          setBusyMsg(tr("PDF 분석 중… ","Analyzing PDF… ")+f.name+tr(" (AI가 읽는 중, 1~2분 걸릴 수 있어)"," (AI reading, may take 1–2 min)"));
          const r=await processPdf(b64);
          if(r){pdfResults.push(r);}
          else{fileErrMsg+=f.name+tr(": PDF 분석 실패 (Claude 키 확인 필요). ",": PDF analysis failed (check Claude key). ");}
        }else{
          setBusyMsg(tr("이미지 읽는 중… (","Reading image… (")+f.name+")");
          const p=await prepImage(f);   // JPEG 변환·축소 — HEIC·대용량·고해상도 촬영본 안전 처리
          const t=await transcribeFile(p.b64,p.mime,"note");
          imageText+=(t||"")+"\n";
        }
      }catch(e){
        fileErrMsg+=f.name+": "+e.message+". ";
        console.warn("파일 처리 실패",f.name,e);
      }
    }

    // ── 자료 합치기 ──
    const pdfSummaryText=pdfResults.map(r=>r.summary||"").filter(Boolean).join("\n\n");
    const fullMaterial=[material,imageText,pdfSummaryText].map(s=>s.trim()).filter(Boolean).join("\n").trim();
    const finalName=name.trim()||tr("새 자료","New material");

    if(!fullMaterial){
      fail(tr("자료 내용을 읽지 못했어.","Couldn't read the material.")+(fileErrMsg?tr(" 오류: "," Error: ")+fileErrMsg:"")+tr(" 텍스트로 직접 입력하거나 Claude API 키를 확인해줘."," Type it in directly or check your Claude API key."));return;
    }
    if(fileErrMsg)setErr(tr("⚠️ 일부 파일 오류: ","⚠️ Some files failed: ")+fileErrMsg+tr("나머지 자료로 계속 진행할게.","Continuing with the rest."));

    // ── 앱이 한국어인데 영어 자료면: 이 덱을 어느 언어로 공부할지 물어봄 ──
    let deckLang=CFG.lang;
    if(CFG.lang==="ko"&&detectLang(fullMaterial)==="en"){
      deckLang=confirm("이 자료는 영어로 되어 있네! 이 자료를 영어로 공부할래?\n\n[확인] = 영어로 (문제·해설·채점 영어)\n[취소] = 한국어로")?"en":"ko";
    }

    // ── 개념 추출 ──
    setBusyMsg(tr("핵심 개념 정리 중…","Pulling out key concepts…"));
    let concepts=pdfResults.flatMap(r=>Array.isArray(r.concepts)?r.concepts:[]);
    if(concepts.length<5){
      try{
        const r=await callAI(
          "너는 학습 자료 분석 전문가야. 자료가 무엇을 가르치려는지 핵심 주제와 목적을 먼저 파악해. 그 목적에 맞는 핵심 개념 8~15개를 짧은 명사구로 뽑아. 단순히 등장하는 단어가 아니라 이 자료의 학습 목표를 대표하는 개념이어야 해. JSON만: {\"concepts\":[\"...\"]}",
          "자료:\n\n"+fullMaterial.slice(0,12000),true,{maxTok:512,lang:deckLang});
        const extra=Array.isArray(r.concepts)?r.concepts:[];
        concepts=[...concepts,...extra.filter(c=>!concepts.includes(c))];
      }catch(e){
        fail(tr("개념 추출 실패: ","Concept extraction failed: ")+e.message+tr(" — API 키와 인터넷 연결을 확인해줘."," — check your API key and connection."));return;
      }
    }
    if(!concepts.length)concepts=[tr("전체 자료","Whole material")];

    // ── 학습 방식 결정 (auto면 AI 분류) ──
    let resolvedType=studyType;
    if(studyType==="auto"){
      resolvedType="explain";
      try{
        const r=await callAI(
          "너는 학습 자료를 분류하는 전문가야. 이 자료가 어떤 학습 방식에 더 적합한지 판단해.\n· quiz = 용어·정의·연도·분류·법조문·단어 등 '암기'가 핵심인 자료 (역사·생물·법학·어휘 등)\n· explain = 이해·증명·풀이·계산이 핵심인 자료 (수학·물리·경제모형 등)\nJSON만: {\"type\":\"quiz\" 또는 \"explain\"}",
          "개념: "+concepts.slice(0,15).join(", ")+"\n\n자료:\n"+fullMaterial.slice(0,3000),
          true,{maxTok:16,model:CFG.qmodel,lang:deckLang});
        if(r&&r.type==="quiz")resolvedType="quiz";
      }catch(e){console.warn("학습 방식 분류 실패 (explain으로):",e.message);}
    }

    // ── 기출/족보 문제 추출 ──
    let examQuestions=[];
    if(isExam){
      setBusyMsg(tr("기출문제 뽑아내는 중…","Extracting exam questions…"));
      examQuestions=(await extractExamQuestions(fullMaterial,concepts)).slice(0,25);
    }

    // ── 요약 ──
    let summary=pdfSummaryText;
    if(!summary&&fullMaterial.length>2000){
      setBusyMsg(tr("거의 다 됐어… 마무리 중","Almost done… wrapping up"));
      try{
        summary=await callAI(
          "너는 학습 자료 요약 전문가야. 핵심 개념·공식·예시를 빠짐없이 압축해. 수식·기호 원문 그대로. 텍스트만 출력.",
          "자료:\n"+fullMaterial.slice(0,20000),false,{maxTok:900});
      }catch(e){console.warn("요약 생성 실패 (건너뜀):",e.message);}
    }

    // ── 저장 ──
    const id=uid();
    const materialToStore=summary?fullMaterial.slice(0,5000):fullMaterial.slice(0,12000);
    const deck={id,name:finalName,subjId:useSubjId,material:materialToStore,summary,createdAt:Date.now(),
      ...(deckLang!==CFG.lang?{lang:deckLang}:{}),
      ...(isK12?{k12:true}:{}),...(edition==="us"?{k12us:true}:{}),
      isExam:isExam&&examQuestions.length>0,examQuestions,studyType:resolvedType,
      concepts:concepts.map(nm=>({id:uid(),name:String(nm).slice(0,80),box:1,dueAt:0,reps:0,lapses:0}))};

    // ── 저장 전 실제 용량 검증 (브라우저 할당량 기준) ──
    setBusyMsg(tr("저장 공간 확인 중…","Checking storage…"));
    const need=byteSize(dk(id),deck);
    const est=await estimateStorage();
    if(est.free < need*1.5){   // 새 자료 + 색인·메타 여유까지 1.5배 확보 안 되면 거부
      fail(tr("저장 공간이 부족해 (남은 공간 ","Not enough storage (free ")+formatSize(est.free)+tr(", 필요 ~",", need ~")+formatSize(need)+tr("). 설정에서 오래된 자료를 삭제하고 다시 시도해줘.","). Delete old materials in Settings and retry."));return;
    }
    // ── 검증된 쓰기 (실제 영속 확인, 실패 시 롤백) ──
    setBusyMsg(tr("저장 중…","Saving…"));
    if(!(await LS.setVerified(dk(id),deck))){
      LS.del(dk(id));
      fail(tr("저장 실패: 용량 부족이거나 브라우저 저장이 거부됐어. 오래된 자료를 삭제하고 다시 시도해줘.","Save failed: out of space or storage was blocked. Delete old materials and retry."));return;
    }
    const prevList=LS.get(DECKS_KEY)||[];
    if(!(await LS.setVerified(DECKS_KEY,[{id,name:deck.name,subjId:useSubjId,studyType:resolvedType},...prevList]))){
      LS.del(dk(id));   // 본체 롤백 — 목록에 안 잡히는 유령 덱 방지
      fail(tr("저장 실패: 저장 공간이 꽉 찼어. 오래된 자료를 삭제해줘.","Save failed: storage is full. Delete old materials."));return;
    }
    done();
  }

  const selSubj=subjects.find(s=>s.id===subjId);

  return(
    <section className="card panel">
      <div className="eyebrow">{tr("새 자료 추가","Add material")}</div>

      {/* 과목 선택 */}
      <div>
        <div style={{fontSize:12.5,color:"var(--sub)",marginBottom:8}}>{tr("과목","Folder")}</div>
        <div className="subj-picker">
          {subjects.map(s=>(
            <button key={s.id} className={"subj-pill"+(subjId===s.id?" on":"")}
              style={subjId===s.id?{background:s.color}:{color:s.color,borderColor:s.color+"44"}}
              onClick={()=>setSubjId(s.id)}>{s.name}</button>
          ))}
        </div>
        <div className="subj-new" style={{marginTop:8}}>
          <input placeholder={tr("새 과목 이름","New folder name")} value={newSubj} onChange={e=>setNewSubj(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&quickAddSubj()}/>
          <button className="btn gho xs" onClick={quickAddSubj}>{tr("+ 추가","+ Add")}</button>
        </div>
      </div>

      {/* 제목 */}
      <input className="field" placeholder={tr("제목 — 예: 선형대수 5장 (고유값)","Title — e.g. Linear Algebra Ch.5 (Eigenvalues)")} value={name}
        onChange={e=>setName(e.target.value)} disabled={busy}/>

      {/* 기출/족보 토글 */}
      <label style={{display:"flex",alignItems:"center",gap:11,padding:"12px 15px",cursor:busy?"default":"pointer",
        border:"1.5px solid "+(isExam?"var(--pri)":"var(--line)"),borderRadius:14,
        background:isExam?"var(--pri-s)":"#FBFAFF",transition:"all .2s"}}>
        <input type="checkbox" checked={isExam} disabled={busy} onChange={e=>setIsExam(e.target.checked)}
          style={{width:18,height:18,accentColor:"var(--pri)",flexShrink:0}}/>
        <div style={{minWidth:0}}>
          <div style={{fontSize:13.5,fontWeight:700,color:isExam?"var(--pri-d)":"var(--ink)"}}>{tr("📑 기출문제·족보예요","📑 These are past exam questions")}</div>
          <div style={{fontSize:11.5,color:"var(--sub)",marginTop:2,lineHeight:1.5}}>{tr("실제 문제를 뽑아서 그대로 풀고, 변형·심화문제까지 자동으로 만들어줘","I'll pull the real questions, drill them, and auto-make variants & harder ones")}</div>
        </div>
      </label>

      {/* 책(교재) 모드 토글 */}
      <label style={{display:"flex",alignItems:"center",gap:11,padding:"12px 15px",cursor:busy?"default":"pointer",
        border:"1.5px solid "+(isBook?"var(--pri)":"var(--line)"),borderRadius:14,
        background:isBook?"var(--pri-s)":"#FBFAFF",transition:"all .2s"}}>
        <input type="checkbox" checked={isBook} disabled={busy} onChange={e=>setIsBook(e.target.checked)}
          style={{width:18,height:18,accentColor:"var(--pri)",flexShrink:0}}/>
        <div style={{minWidth:0}}>
          <div style={{fontSize:13.5,fontWeight:700,color:isBook?"var(--pri-d)":"var(--ink)"}}>{tr("📚 전공책·교재 통째로예요 (긴 PDF)","📚 Whole textbook (long PDF)")}</div>
          <div style={{fontSize:11.5,color:"var(--sub)",marginTop:2,lineHeight:1.5}}>{tr("긴 PDF를 페이지별로 나눠 읽고 대단원·중단원·소단원 목차로 정리해 개념마다 1:1 과외해줘 (분석에 몇 분 걸려)","I split a long PDF, build a chapter→section→topic outline, and tutor each topic 1:1 (takes a few min)")}</div>
        </div>
      </label>

      {/* 학습 방식 선택 */}
      <div>
        <div style={{fontSize:12.5,color:"var(--sub)",marginBottom:8}}>{tr("어떻게 공부할까?","How do you want to study this?")}</div>
        <div style={{display:"flex",gap:8}}>
          {[["auto","🤖",tr("자동추천","Auto"),tr("내가 알아서 골라줄게","I'll decide for you")],
            ["explain","🧠",tr("이해·설명형","Explain"),tr("손글씨로 설명·풀이","Write & explain")],
            ["quiz","📇",tr("암기·퀴즈형","Quiz"),tr("OX·객관식·단답 카드","OX · MC · short cards")]].map(([val,emo,lbl,desc])=>(
            <button key={val} type="button" disabled={busy} onClick={()=>setStudyType(val)}
              style={{flex:1,padding:"10px 8px",cursor:busy?"default":"pointer",textAlign:"center",
                border:"1.5px solid "+(studyType===val?"var(--pri)":"var(--line)"),borderRadius:14,
                background:studyType===val?"var(--pri-s)":"#FBFAFF",transition:"all .2s"}}>
              <div style={{fontSize:18}}>{emo}</div>
              <div style={{fontSize:12.5,fontWeight:700,color:studyType===val?"var(--pri-d)":"var(--ink)",marginTop:2}}>{lbl}</div>
              <div style={{fontSize:10.5,color:"var(--sub)",marginTop:2,lineHeight:1.4}}>{desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 내용 */}
      <textarea className="field" rows={7} disabled={busy} value={material}
        placeholder={tr("공부한 내용을 붙여넣거나, 아래 도구로 추가해줘.","Paste what you studied, or add it with the tools below.")}
        onChange={e=>setMaterial(e.target.value)}/>

      {/* 파일 첨부 */}
      <div>
        <div style={{fontSize:12.5,color:"var(--sub)",marginBottom:8}}>{tr("📎 파일 첨부 (이미지·PDF)","📎 Attach files (image · PDF)")}</div>
        <FileDropZone files={files} onChange={setFiles}/>
      </div>

      {/* 펜·사진 */}
      <div className="tools">
        <button className={"btn gho sm"+(pen?" on":"")} onClick={()=>setPen(v=>!v)} disabled={busy}>{tr("✍️ 펜으로 쓰기","✍️ Write with pen")}</button>
        <PhotoButton kind="note" onText={append} label={tr("📷 노트 사진","📷 Photo of notes")}/>
        <span className="note">{tr("인식 결과는 위 칸에 추가돼","Recognized text is added above")}</span>
      </div>
      {pen&&<PenPad kind="note" onText={append}/>}

      {err&&<div className="err">{err}</div>}
      {busy&&(
        <div style={{position:"sticky",bottom:0,zIndex:10,background:"var(--card)",
          border:"2px solid var(--pri)",borderRadius:14,padding:"14px 16px",
          boxShadow:"0 4px 24px rgba(108,92,231,.18)",display:"flex",flexDirection:"column",gap:8}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:13,fontWeight:600,color:progress===100?"var(--mint)":"var(--pri-d)"}}>{busyMsg||tr("처리 중…","Working…")}</span>
            <span style={{fontSize:15,fontWeight:700,color:progress===100?"var(--mint)":"var(--pri-d)"}}>{progress}%</span>
          </div>
          <div style={{height:12,borderRadius:8,background:"#F0EDFA",overflow:"hidden"}}>
            <div style={{height:"100%",borderRadius:8,
              background:progress===100?"var(--mint)":"linear-gradient(90deg,var(--pri),var(--mint))",
              width:progress+"%",transition:"width .5s ease"}}/>
          </div>
          {progress===100
            ?<span style={{fontSize:12,color:"var(--mint)",fontWeight:600,textAlign:"center"}}>{tr("저장 완료! 이제 공부 시작하자 🎉","Saved! Let's start studying 🎉")}</span>
            :<span style={{fontSize:11.5,color:"var(--sub)"}}>{tr("페이지를 닫지 마. 분석이 끝나면 자동으로 저장돼.","Don't close the page. It saves automatically when analysis finishes.")}</span>
          }
          {progress<100&&<Cheer style={{marginTop:2}}/>}
        </div>
      )}
      <div className="row">
        <button className="btn pri" onClick={save} disabled={busy}>{busy?tr("분석 중…","Analyzing…"):tr("이제 공부하자! 📖","Let's study! 📖")}</button>
        <button className="btn gho" onClick={onCancel} disabled={busy}>{tr("취소","Cancel")}</button>
      </div>
      <p className="hint">{tr("PDF는 최대 50페이지·30MB까지 지원. 이미지·손글씨 노트도 첨부 가능.","PDF up to 50 pages · 30MB. Images & handwritten notes welcome too.")}</p>
    </section>
  );
}

/* ── 이해 깊이 게이지 ── */

export { AddMaterial };
