/* ── 기출문제 은행: 입력 도구 (Phase 0) ──
   흐름: 목록(필터·통계) → 업로드(출처·과목·파일) → AI 추출 → 사람 검수 → 저장.
   검수(verified) 통과분만 출제 검색 후보가 된다 — 0오류 보증선. */
import { tr } from "../core/platform.js";
import { extractBankItems, splitPdfPages, toB64, uid } from "../core/ai.js";
import { bankAll, bankAdd, bankUpdate, bankDel, bankStats } from "../core/examBank.js";
import { FileDropZone, Prof, Stat } from "../ui/common.jsx";
import { MathText } from "../ui/math.jsx";
import { CURRICULUM } from "../core/curriculum.js";
import React from "react";
const { useState, useMemo } = React;

const QTYPES=[["mc",tr("객관식","MC")],["short",tr("단답형","Short")],["essay",tr("서술형","Essay")]];
const DIFFS=[["easy",tr("쉬움","Easy")],["medium",tr("보통","Medium")],["hard",tr("어려움","Hard")]];
const qtypeLabel=(v)=>(QTYPES.find(q=>q[0]===v)||[])[1]||v;

// 과목 평탄화: 업로드 시 과목을 고르면 그 과목 대단원이 unit 태그 후보가 된다
const SUBJECTS=CURRICULUM.flatMap(lv=>lv.subjects.map(s=>({id:s.id,name:s.name,level:lv.level,units:s.units})));
// 자동 모드(모의고사·전국연합처럼 여러 학년 범위가 섞인 시험지): 전체 목차에서 단원 판별
const ALL_UNITS=[...new Set(SUBJECTS.flatMap(s=>s.units))];
const UNIT_SUBJECT={};SUBJECTS.forEach(s=>s.units.forEach(u=>{if(!(u in UNIT_SUBJECT))UNIT_SUBJECT[u]=s.name;}));

/* ── 문제 1건 편집 카드 (검수·수정 공용) ── */
function ItemEditor({item,units,onChange,onRemove}){
  const set=(f,v)=>onChange({...item,[f]:v});
  const setSrc=(f,v)=>onChange({...item,src:{...(item.src||{}),[f]:v}});
  const [preview,setPreview]=useState(true);
  return(
    <div className="card" style={{padding:"14px 16px",display:"flex",flexDirection:"column",gap:10,
      borderLeft:"4px solid "+(item.verified?"#16A34A":"#F59E0B")}}>
      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <span className="chip" style={{background:item.verified?"#DCFCE7":"#FEF3C7",color:item.verified?"#166534":"#92400E",fontWeight:800}}>
          {item.verified?tr("✓ 검수 완료","✓ Verified"):tr("⏳ 검수 대기","⏳ Pending")}
        </span>
        {item.src?.number&&<span className="chip gho">{tr("문항 ","No. ")}{item.src.number}</span>}
        <select className="field" value={item.qtype||"short"} onChange={e=>set("qtype",e.target.value)} style={{width:"auto",padding:"5px 8px",fontSize:12.5}}>
          {QTYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}
        </select>
        <select className="field" value={item.difficulty||"medium"} onChange={e=>set("difficulty",e.target.value)} style={{width:"auto",padding:"5px 8px",fontSize:12.5}}>
          {DIFFS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
        </select>
        <select className="field" value={item.unit||""} onChange={e=>set("unit",e.target.value)} style={{width:"auto",maxWidth:220,padding:"5px 8px",fontSize:12.5}}>
          <option value="">{tr("단원 선택…","Pick unit…")}</option>
          {units.map(u=><option key={u} value={u}>{u}</option>)}
        </select>
        <label style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:12.5,color:"var(--sub)",cursor:"pointer"}}>
          <input type="checkbox" checked={!!item.hasFigure} onChange={e=>set("hasFigure",e.target.checked)}/>{tr("그림 필수","Figure")}
        </label>
        <span style={{marginLeft:"auto",display:"inline-flex",gap:6}}>
          <button className="btn gho xs" onClick={()=>setPreview(v=>!v)}>{preview?tr("✏️ 편집","✏️ Edit"):tr("👁 미리보기","👁 Preview")}</button>
          <button className="btn gho xs" onClick={onRemove} style={{color:"#B91C1C"}}>{tr("삭제","Delete")}</button>
        </span>
      </div>
      {preview?(
        <div style={{fontSize:14,lineHeight:1.75}}>
          <MathText text={item.question||""} tag="div"/>
          {(item.choices||[]).length>0&&<div style={{marginTop:4,color:"var(--ink)"}}>{(item.choices||[]).map((c,i)=><MathText key={i} text={c} tag="div"/>)}</div>}
          {item.answer&&<div style={{marginTop:8,padding:"8px 12px",background:"#F0FDF4",borderRadius:9,fontSize:13}}>
            <b style={{color:"#166534"}}>{tr("정답","Answer")}</b> <MathText text={item.answer} tag="span"/>
          </div>}
          {item.explanation&&<div style={{marginTop:6,padding:"8px 12px",background:"var(--pri-s)",borderRadius:9,fontSize:13}}>
            <b style={{color:"var(--pri-d)"}}>{tr("해설","Solution")}</b> <MathText text={item.explanation} tag="div"/>
          </div>}
          {!item.answer&&<div style={{marginTop:6,fontSize:12.5,color:"#B45309"}}>⚠️ {tr("정답 없음 — 자료에 정답이 없었어요. 직접 입력 후 검수하세요.","No answer in source — enter one before verifying.")}</div>}
        </div>
      ):(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          <textarea className="field" rows={3} value={item.question||""} onChange={e=>set("question",e.target.value)} placeholder={tr("문제 본문 (수식은 $...$)","Question (LaTeX in $...$)")}/>
          <textarea className="field" rows={2} value={(item.choices||[]).join("\n")} onChange={e=>set("choices",e.target.value.split("\n").filter(Boolean))} placeholder={tr("객관식 보기 — 한 줄에 하나 (① … / ② …)","Choices — one per line")}/>
          <textarea className="field" rows={2} value={item.answer||""} onChange={e=>set("answer",e.target.value)} placeholder={tr("정답","Answer")}/>
          <textarea className="field" rows={3} value={item.explanation||""} onChange={e=>set("explanation",e.target.value)} placeholder={tr("해설","Solution")}/>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <input className="field" value={item.src?.number||""} onChange={e=>setSrc("number",e.target.value)} placeholder={tr("문항번호","No.")} style={{width:90}}/>
            <input className="field" type="number" value={item.points||0} onChange={e=>set("points",Number(e.target.value)||0)} placeholder={tr("배점","Points")} style={{width:90}}/>
          </div>
        </div>
      )}
      <label style={{display:"inline-flex",alignItems:"center",gap:7,fontSize:13.5,fontWeight:700,cursor:"pointer",
        color:item.verified?"#166534":"var(--ink)"}}>
        <input type="checkbox" checked={!!item.verified} onChange={e=>onChange({...item,verified:e.target.checked,verifiedAt:e.target.checked?Date.now():null})}/>
        {tr("문제·정답·해설·단원을 원본과 대조해 확인했습니다 (검수 완료)","I verified this against the original (verified)")}
      </label>
    </div>);
}

/* ── 메인 ── */
function ExamBank({onExit}){
  const [mode,setMode]=useState("list");           // list | upload | review
  const [items,setItems]=useState(bankAll());      // 은행 전체 (목록 화면)
  const [draft,setDraft]=useState([]);             // 추출 직후 검수 대기 초안 (검수 화면)
  // 업로드 폼
  const [corpus,setCorpus]=useState("기출");
  const [srcYear,setSrcYear]=useState("");const [srcSchool,setSrcSchool]=useState("");const [srcExam,setSrcExam]=useState("");
  const [subjId,setSubjId]=useState(SUBJECTS[0]?.id||"");
  const [files,setFiles]=useState([]);
  const [pasted,setPasted]=useState("");
  const [busy,setBusy]=useState(false);const [busyMsg,setBusyMsg]=useState("");const [err,setErr]=useState("");
  // 목록 필터
  const [fSubj,setFSubj]=useState("");const [fUnit,setFUnit]=useState("");const [fVer,setFVer]=useState("");
  const [editing,setEditing]=useState(null);       // 목록에서 단건 수정 중인 id

  const isAuto=subjId==="auto";
  const subj=SUBJECTS.find(s=>s.id===subjId)||SUBJECTS[0];
  const tagUnits=isAuto?ALL_UNITS:subj.units;   // 추출·검수에서 쓰는 단원 태그 후보
  const stats=useMemo(()=>bankStats(),[items]);
  const shown=items.filter(it=>
    (!fSubj||it.subject===fSubj)&&(!fUnit||it.unit===fUnit)&&
    (fVer===""||(fVer==="1")===!!it.verified));
  const filterUnits=useMemo(()=>{
    const set=new Set(items.filter(it=>!fSubj||it.subject===fSubj).map(it=>it.unit).filter(Boolean));
    return[...set];
  },[items,fSubj]);
  const bankSubjects=useMemo(()=>[...new Set(items.map(it=>it.subject).filter(Boolean))],[items]);

  // ── 추출: 파일(PDF/이미지)+붙여넣은 텍스트 → AI 구조화 → 검수 초안 ──
  async function extract(){
    if(!files.length&&!pasted.trim()){setErr(tr("파일을 올리거나 문제 텍스트를 붙여넣어줘.","Add files or paste text."));return;}
    setBusy(true);setErr("");
    const srcHint=[srcYear,srcSchool,srcExam].filter(Boolean).join(" ");
    const out=[];
    try{
      // 이미지들은 한 호출에 최대 4장씩 묶어 추출
      const imgs=files.filter(f=>f.type.startsWith("image/"));
      for(let i=0;i<imgs.length;i+=4){
        const batch=imgs.slice(i,i+4);
        setBusyMsg(tr("이미지 분석 중… (","Reading images… (")+(i+1)+"~"+Math.min(i+4,imgs.length)+"/"+imgs.length+")");
        const blocks=[];
        for(const f of batch)blocks.push({type:"image",source:{type:"base64",media_type:f.type||"image/jpeg",data:await toB64(f)}});
        out.push(...await extractBankItems(blocks,tagUnits,srcHint));
      }
      // PDF는 6쪽 단위로 쪼개 순차 추출 (시험지 여러 장도 안전)
      for(const f of files.filter(f=>f.type==="application/pdf")){
        if(f.size>30*1024*1024){setErr(f.name+tr(": 30MB 초과",": over 30MB"));continue;}
        const b64=await toB64(f);
        const chunks=await splitPdfPages(b64,6);
        for(let ci=0;ci<chunks.length;ci++){
          const c=chunks[ci];const cb64=typeof c==="string"?c:c.b64;
          setBusyMsg(tr("PDF 분석 중… ","Reading PDF… ")+f.name+(chunks.length>1?" ("+(ci+1)+"/"+chunks.length+")":""));
          out.push(...await extractBankItems([{type:"document",source:{type:"base64",media_type:"application/pdf",data:cb64}}],tagUnits,srcHint));
        }
      }
      if(pasted.trim()){
        setBusyMsg(tr("텍스트 분석 중…","Reading text…"));
        out.push(...await extractBankItems([{type:"text",text:"[자료]\n"+pasted.slice(0,14000)}],tagUnits,srcHint));
      }
      if(!out.length){setErr(tr("문제를 추출하지 못했어. 자료 상태나 API 키를 확인해줘.","No questions extracted — check the files or API key."));setBusy(false);return;}
      setDraft(out.map(q=>({
        id:uid(),createdAt:Date.now(),corpus,
        src:{year:srcYear.trim(),school:srcSchool.trim(),exam:srcExam.trim(),number:q.number||""},
        subject:isAuto?(UNIT_SUBJECT[q.unit]||""):subj.name,
        unit:tagUnits.includes(q.unit)?q.unit:"",
        qtype:["mc","short","essay"].includes(q.qtype)?q.qtype:"short",
        question:q.question||"",choices:Array.isArray(q.choices)?q.choices:[],
        answer:q.answer||"",explanation:q.explanation||"",
        points:Number(q.points)||0,difficulty:["easy","medium","hard"].includes(q.difficulty)?q.difficulty:"medium",
        hasFigure:!!q.hasFigure,verified:false,verifiedAt:null,
      })));
      setMode("review");
    }catch(e){setErr(tr("추출 실패: ","Extraction failed: ")+(e.message||e));}
    setBusy(false);
  }

  // ── JSON 백업/이관: 은행 전체 내보내기·가져오기 (기기 간 이동, 외부에서 준비한 데이터 반입) ──
  function exportJson(){
    const blob=new Blob([JSON.stringify(bankAll(),null,1)],{type:"application/json"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);a.download="기출은행-"+new Date().toISOString().slice(0,10)+".json";
    a.click();URL.revokeObjectURL(a.href);
  }
  function importJson(file){
    const rd=new FileReader();
    rd.onload=()=>{
      try{
        const arr=JSON.parse(rd.result);
        if(!Array.isArray(arr))throw new Error("JSON 배열이 아님");
        const ok=arr.filter(it=>it&&it.question&&it.unit!==undefined).map(it=>({
          ...it,id:uid(),createdAt:it.createdAt||Date.now(),
          corpus:it.corpus==="문제집"?"문제집":"기출",
          verified:!!it.verified,verifiedAt:it.verified?(it.verifiedAt||Date.now()):null}));
        if(!ok.length){setErr(tr("가져올 문제가 없어 — 형식을 확인해줘.","Nothing to import."));return;}
        setItems(bankAdd(ok));
        alert(tr(ok.length+"문제를 가져왔어. 검수 안 된 문제는 검수 후에 출제에 쓰여.",ok.length+" items imported."));
      }catch(e){setErr(tr("가져오기 실패: ","Import failed: ")+(e.message||e));}
    };
    rd.readAsText(file);
  }

  function saveDraft(){
    const noUnit=draft.filter(d=>!d.unit).length;
    if(noUnit&&!confirm(tr(noUnit+"개 문제에 단원 태그가 없어. 태그 없는 문제는 단원 검색에 안 잡혀 — 그래도 저장할까?",noUnit+" items have no unit tag. Save anyway?")))return;
    setItems(bankAdd(draft));
    setDraft([]);setFiles([]);setPasted("");setMode("list");
  }

  const Head=({title,desc})=>(
    <div className="hero">
      <Prof size={56}/>
      <div><h2>{title}</h2><p>{desc}</p></div>
    </div>);

  // ── 검수 화면 ──
  if(mode==="review")return(
    <section style={{paddingBottom:96}}>
      <Head title={tr(<>추출 결과 검수<br/>— 사람 눈이 보증선입니다</>,<>Review extracted items</>)}
        desc={tr("AI가 뽑은 초안이에요. 원본과 대조해 문제·정답·해설·단원을 확인하고 '검수 완료'를 체크해줘. 검수된 문제만 출제 근거로 쓰입니다.","Check each item against the original, then mark verified.")}/>
      <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:14,flexWrap:"wrap"}}>
        <span className="chip" style={{background:"var(--pri-s)",color:"var(--pri-d)",fontWeight:800}}>{draft.length}{tr("문제 추출됨"," extracted")}</span>
        <span className="chip" style={{background:"#DCFCE7",color:"#166534"}}>{draft.filter(d=>d.verified).length}{tr(" 검수됨"," verified")}</span>
        <button className="btn gho sm" style={{marginLeft:"auto"}}
          onClick={()=>setDraft(ds=>ds.map(d=>({...d,verified:true,verifiedAt:Date.now()})))}>{tr("전체 검수 완료로 표시","Mark all verified")}</button>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {draft.map((d,i)=>(
          <ItemEditor key={d.id} item={d} units={tagUnits}
            onChange={(nd)=>setDraft(ds=>ds.map((x,xi)=>xi===i?nd:x))}
            onRemove={()=>setDraft(ds=>ds.filter((_,xi)=>xi!==i))}/>))}
      </div>
      <div style={{position:"sticky",bottom:12,marginTop:16,display:"flex",gap:8}}>
        <button className="btn pri" onClick={saveDraft} disabled={!draft.length}
          style={{flex:1,padding:"15px",fontSize:15,boxShadow:"0 6px 20px rgba(108,92,231,.3)"}}>
          💾 {tr("은행에 저장","Save to bank")} · {draft.length}{tr("문제","Q")} ({draft.filter(d=>d.verified).length}{tr(" 검수됨"," verified")})
        </button>
        <button className="btn gho" onClick={()=>{if(confirm(tr("추출 결과를 버릴까?","Discard?")))setMode("upload");}}>{tr("버리기","Discard")}</button>
      </div>
    </section>);

  // ── 업로드 화면 ──
  if(mode==="upload")return(
    <section style={{paddingBottom:40}}>
      <Head title={tr(<>기출 올리기</>,<>Add past exams</>)}
        desc={tr("시험지 사진이나 PDF를 올리면 AI가 문제·보기·정답·해설을 추출하고 단원 태그를 달아요. 저장 전 반드시 사람 검수를 거칩니다.","Upload photos/PDFs — AI extracts and tags; you verify before saving.")}/>
      <div className="card" style={{padding:"18px 20px",display:"flex",flexDirection:"column",gap:14}}>
        <div>
          <label style={{fontSize:12.5,fontWeight:700,color:"var(--sub)",display:"block",marginBottom:6}}>{tr("원자료 종류","Corpus type")}</label>
          <div style={{display:"flex",gap:8}}>
            {[["기출",tr("📜 기출 (학교·공식 시험)","📜 Past exam")],["문제집",tr("📗 문제집 (시판 교재)","📗 Workbook")]].map(([v,l])=>(
              <button key={v} className="btn sm" onClick={()=>setCorpus(v)}
                style={{border:"1.5px solid "+(corpus===v?"var(--pri)":"var(--line)"),background:corpus===v?"var(--pri-s)":"#fff",color:corpus===v?"var(--pri-d)":"var(--ink)",fontWeight:corpus===v?700:500}}>
                {corpus===v?"✓ ":""}{l}
              </button>))}
          </div>
          {corpus==="문제집"&&<div style={{marginTop:8,padding:"9px 12px",background:"#FEF2F2",borderRadius:9,fontSize:12.5,color:"#991B1B",lineHeight:1.6}}>
            ⚠️ {tr("시판 문제집은 저작권 보호 대상이에요. 출판사 라이선스 확보 전에는 내부 검토·실험 용도로만 쓰고, 학생에게 원본 그대로 출제하지 마세요.","Commercial workbooks are copyrighted — internal testing only until licensed.")}
          </div>}
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <input className="field" value={srcYear} onChange={e=>setSrcYear(e.target.value)} placeholder={tr("연도 (예: 2025)","Year")} style={{flex:"1 1 100px"}}/>
          <input className="field" value={srcSchool} onChange={e=>setSrcSchool(e.target.value)} placeholder={tr("학교·기관 (예: 대치중)","School")} style={{flex:"2 1 160px"}}/>
          <input className="field" value={srcExam} onChange={e=>setSrcExam(e.target.value)} placeholder={tr("시험명 (예: 2학기 중간고사)","Exam name")} style={{flex:"2 1 180px"}}/>
        </div>
        <div>
          <label style={{fontSize:12.5,fontWeight:700,color:"var(--sub)",display:"block",marginBottom:6}}>
            {tr("과목 (단원 태그가 이 과목 목차에서 달려요)","Subject — units are tagged from its chapters")}
          </label>
          <select className="field" value={subjId} onChange={e=>setSubjId(e.target.value)}>
            <option value="auto">🌐 {tr("자동 — 전체 목차에서 단원 판별 (모의고사·전국연합처럼 여러 학년 범위가 섞인 시험지)","Auto — detect units across all subjects")}</option>
            {SUBJECTS.map(s=><option key={s.id} value={s.id}>{s.level} · {s.name}</option>)}
          </select>
        </div>
        <div>
          <div style={{fontSize:12.5,fontWeight:700,color:"var(--sub)",marginBottom:8}}>📎 {tr("시험지 파일 (사진·PDF)","Files (image · PDF)")}</div>
          <FileDropZone files={files} onChange={setFiles}/>
        </div>
        <textarea className="field" rows={4} value={pasted} onChange={e=>setPasted(e.target.value)}
          placeholder={tr("또는 문제 텍스트 직접 붙여넣기 (선택)","Or paste question text (optional)")}/>
        {err&&<div style={{color:"#B91C1C",fontSize:13,lineHeight:1.6}}>{err}</div>}
        {busy
          ?<div style={{display:"flex",alignItems:"center",gap:10,color:"var(--sub)",fontSize:13.5}}><span className="spinner" style={{width:16,height:16}}/>{busyMsg}</div>
          :<div style={{display:"flex",gap:8}}>
            <button className="btn pri" onClick={extract} style={{flex:1,padding:"13px"}}>🤖 {tr("AI로 문제 추출하기","Extract with AI")}</button>
            <button className="btn gho" onClick={()=>setMode("list")}>{tr("← 은행으로","← Bank")}</button>
          </div>}
      </div>
    </section>);

  // ── 목록(기본) 화면 ──
  return(
    <section style={{paddingBottom:40}}>
      <Head title={tr(<>기출문제 은행</>,<>Exam bank</>)}
        desc={tr("검증된 기출이 쌓일수록 출제·변형의 근거가 탄탄해져요. 실전 출제는 검수 완료된 기출만 사용합니다.","Verified items power authentic exams and variants.")}/>
      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}>
        <Stat n={stats.total} l={tr("전체","Total")}/>
        <Stat n={stats.verified} l={tr("검수 완료","Verified")}/>
        <Stat n={stats.pending} l={tr("검수 대기","Pending")}/>
        <Stat n={stats.unitCount} l={tr("커버 단원","Units")}/>
        <button className="btn pri" onClick={()=>{setErr("");setMode("upload");}} style={{marginLeft:"auto",alignSelf:"center"}}>➕ {tr("기출 올리기","Add exams")}</button>
        <label className="btn gho sm" style={{alignSelf:"center",cursor:"pointer"}} title={tr("JSON 파일에서 문제 가져오기","Import from JSON")}>
          📥 {tr("가져오기","Import")}
          <input type="file" accept="application/json,.json" style={{display:"none"}} onChange={e=>{if(e.target.files[0])importJson(e.target.files[0]);e.target.value="";}}/>
        </label>
        {items.length>0&&<button className="btn gho sm" onClick={exportJson} style={{alignSelf:"center"}} title={tr("은행 전체를 JSON으로 백업","Export bank as JSON")}>📤 {tr("백업","Export")}</button>}
        <button className="btn gho" onClick={onExit} style={{alignSelf:"center"}}>🏠 {tr("홈","Home")}</button>
      </div>
      {err&&mode==="list"&&<div style={{color:"#B91C1C",fontSize:13,marginBottom:12}}>{err}</div>}
      {items.length>0&&(
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
          <select className="field" value={fSubj} onChange={e=>{setFSubj(e.target.value);setFUnit("");}} style={{width:"auto",padding:"7px 10px",fontSize:13}}>
            <option value="">{tr("전체 과목","All subjects")}</option>
            {bankSubjects.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
          <select className="field" value={fUnit} onChange={e=>setFUnit(e.target.value)} style={{width:"auto",maxWidth:220,padding:"7px 10px",fontSize:13}}>
            <option value="">{tr("전체 단원","All units")}</option>
            {filterUnits.map(u=><option key={u} value={u}>{u}</option>)}
          </select>
          <select className="field" value={fVer} onChange={e=>setFVer(e.target.value)} style={{width:"auto",padding:"7px 10px",fontSize:13}}>
            <option value="">{tr("검수 전체","All")}</option>
            <option value="1">{tr("검수 완료만","Verified only")}</option>
            <option value="0">{tr("검수 대기만","Pending only")}</option>
          </select>
          <span style={{alignSelf:"center",fontSize:12.5,color:"var(--sub)"}}>{shown.length}{tr("문제","Q")}</span>
        </div>)}
      {items.length===0&&(
        <div className="card" style={{padding:"36px 28px",textAlign:"center"}}>
          <div style={{fontSize:44,marginBottom:8}}>📚</div>
          <div style={{fontFamily:"'Jua',sans-serif",fontSize:18,color:"var(--ink)",marginBottom:6}}>{tr("아직 은행이 비어 있어요","The bank is empty")}</div>
          <p style={{fontSize:13.5,color:"var(--sub)",lineHeight:1.7,maxWidth:420,margin:"0 auto 16px"}}>
            {tr("첫 기출 시험지를 올려보세요. 사진 몇 장이면 AI가 문제·정답·해설을 뽑고 단원 태그까지 달아줘요 — 검수만 해주시면 됩니다.","Upload your first exam — AI does the heavy lifting; you verify.")}
          </p>
          <button className="btn pri" onClick={()=>{setErr("");setMode("upload");}}>➕ {tr("첫 기출 올리기","Add first exam")}</button>
        </div>)}
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {shown.map(it=>editing===it.id?(
          <div key={it.id}>
            <ItemEditor item={it} units={(SUBJECTS.find(s=>s.name===it.subject)||{}).units||ALL_UNITS}
              onChange={(nd)=>setItems(bankUpdate(it.id,nd))}
              onRemove={()=>{if(confirm(tr("이 문제를 은행에서 삭제할까?","Delete this item?"))){setItems(bankDel(it.id));setEditing(null);}}}/>
            <div style={{textAlign:"right",marginTop:6}}><button className="btn gho sm" onClick={()=>setEditing(null)}>{tr("닫기","Close")}</button></div>
          </div>
        ):(
          <div key={it.id} className="card" onClick={()=>setEditing(it.id)}
            style={{padding:"12px 15px",cursor:"pointer",display:"flex",alignItems:"flex-start",gap:10,
              borderLeft:"4px solid "+(it.verified?"#16A34A":"#F59E0B")}}>
            <div style={{minWidth:0,flex:1}}>
              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:5,fontSize:11.5}}>
                <span className="chip" style={{background:it.corpus==="기출"?"#FFF7E0":"#FEF2F2",color:it.corpus==="기출"?"#946200":"#991B1B"}}>{it.corpus==="기출"?"📜":"📗"} {it.corpus}</span>
                {it.unit&&<span className="chip gho">{it.unit}</span>}
                <span className="chip gho">{qtypeLabel(it.qtype)}</span>
                {[it.src?.year,it.src?.school,it.src?.exam].filter(Boolean).length>0&&
                  <span style={{color:"var(--sub)",alignSelf:"center"}}>{[it.src?.year,it.src?.school,it.src?.exam].filter(Boolean).join(" ")}{it.src?.number?" · "+it.src.number+tr("번",""):""}</span>}
              </div>
              <MathText text={(it.question||"").slice(0,180)+((it.question||"").length>180?"…":"")} tag="div" style={{fontSize:13.5,lineHeight:1.65,margin:0}}/>
            </div>
            <span style={{fontSize:12,fontWeight:800,whiteSpace:"nowrap",color:it.verified?"#16A34A":"#B45309"}}>{it.verified?tr("✓ 검수","✓ OK"):tr("⏳ 대기","⏳")}</span>
          </div>))}
      </div>
    </section>);
}

export { ExamBank };
