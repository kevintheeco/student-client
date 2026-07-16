/* ── 기출문제 은행: 입력 도구 (Phase 0) ──
   흐름: 목록(필터·통계) → 업로드(출처·과목·파일) → AI 추출 → 사람 검수 → 저장.
   검수(verified) 통과분만 출제 검색 후보가 된다 — 0오류 보증선. */
import { tr } from "../core/platform.js";
import { callAI, extractAnswerKey, extractBankItems, prepImage, solveBankItem, splitPdfPages, toB64, uid } from "../core/ai.js";
import { bankAll, bankAdd, bankUpdate, bankDel, bankStats } from "../core/examBank.js";
import { FileDropZone, Prof, Stat } from "../ui/common.jsx";
import { MathText } from "../ui/math.jsx";
import { MathViz } from "../ui/mathviz/MathViz.jsx";
import { isSceneScript, validateScript, SCENE_SCHEMA_PROMPT } from "../ui/mathviz/scenescript.js";
import { CURRICULUM } from "../core/curriculum.js";
import React from "react";
const { useState, useMemo, useRef, useEffect } = React;

const QTYPES=[["mc",tr("객관식","MC")],["short",tr("단답형","Short")],["essay",tr("서술형","Essay")]];
const DIFFS=[["easy",tr("쉬움","Easy")],["medium",tr("보통","Medium")],["hard",tr("어려움","Hard")]];
const qtypeLabel=(v)=>(QTYPES.find(q=>q[0]===v)||[])[1]||v;

// 과목 평탄화: 업로드 시 과목을 고르면 그 과목 대단원이 unit 태그 후보가 된다
const SUBJECTS=CURRICULUM.flatMap(lv=>lv.subjects.map(s=>({id:s.id,name:s.name,level:lv.level,units:s.units})));
// 자동 모드(모의고사·전국연합처럼 여러 학년 범위가 섞인 시험지): 전체 목차에서 단원 판별
const ALL_UNITS=[...new Set(SUBJECTS.flatMap(s=>s.units))];
const UNIT_SUBJECT={};SUBJECTS.forEach(s=>s.units.forEach(u=>{if(!(u in UNIT_SUBJECT))UNIT_SUBJECT[u]=s.name;}));

/* ── 그림 크롭 도구: 시험지 사진에서 도형·그래프 영역만 드래그로 잘라 문항에 첨부 ── */
function _cropToDataURL(img,sel,sc){
  // sel(캔버스 좌표)·sc(축소비율)로 원본에서 잘라 최대 900px 폭 JPEG로 압축
  const sx=sel?sel.x/sc:0, sy=sel?sel.y/sc:0;
  const sw=sel?sel.w/sc:img.width, sh=sel?sel.h/sc:img.height;
  const os=Math.min(1,900/sw);
  const c=document.createElement("canvas");
  c.width=Math.max(1,Math.round(sw*os));c.height=Math.max(1,Math.round(sh*os));
  const ctx=c.getContext("2d");
  ctx.fillStyle="#fff";ctx.fillRect(0,0,c.width,c.height);
  ctx.drawImage(img,sx,sy,sw,sh,0,0,c.width,c.height);
  return c.toDataURL("image/jpeg",0.85);
}
function FigureCropper({src,onDone,onCancel}){
  const cvRef=useRef(null);const imgRef=useRef(null);const scRef=useRef(1);
  const [sel,setSel]=useState(null);const dragRef=useRef(null);
  useEffect(()=>{
    const img=new Image();
    img.onload=()=>{
      imgRef.current=img;const cv=cvRef.current;if(!cv)return;
      const maxW=Math.min(860,window.innerWidth-72);
      const sc=Math.min(1,maxW/img.width);scRef.current=sc;
      cv.width=Math.round(img.width*sc);cv.height=Math.round(img.height*sc);
      draw(null);
    };
    img.src=src;
  },[src]);
  function draw(rect){
    const cv=cvRef.current,img=imgRef.current;if(!cv||!img)return;
    const ctx=cv.getContext("2d");
    ctx.drawImage(img,0,0,cv.width,cv.height);
    if(rect&&rect.w>2&&rect.h>2){
      ctx.fillStyle="rgba(20,26,48,.42)";
      ctx.fillRect(0,0,cv.width,rect.y);
      ctx.fillRect(0,rect.y,rect.x,rect.h);
      ctx.fillRect(rect.x+rect.w,rect.y,cv.width-rect.x-rect.w,rect.h);
      ctx.fillRect(0,rect.y+rect.h,cv.width,cv.height-rect.y-rect.h);
      ctx.strokeStyle="#6C5CE7";ctx.lineWidth=2;
      ctx.strokeRect(rect.x,rect.y,rect.w,rect.h);
    }
  }
  const pos=(e)=>{const r=cvRef.current.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
  const norm=(a,b)=>({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)});
  return(
    <div onClick={onCancel} style={{position:"fixed",inset:0,background:"rgba(20,26,48,.55)",zIndex:80,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div onClick={e=>e.stopPropagation()} className="card" style={{padding:16,maxWidth:920,maxHeight:"92vh",overflow:"auto"}}>
        <div style={{fontSize:13.5,fontWeight:700,color:"var(--ink)",marginBottom:8}}>
          🖼 {tr("그림으로 쓸 영역을 드래그로 선택하세요 (도형·그래프만 깔끔하게)","Drag to select the figure region")}
        </div>
        <canvas ref={cvRef} style={{maxWidth:"100%",cursor:"crosshair",touchAction:"none",borderRadius:8,border:"1px solid var(--line)"}}
          onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);dragRef.current=pos(e);}}
          onPointerMove={e=>{if(!dragRef.current)return;const r=norm(dragRef.current,pos(e));setSel(r);draw(r);}}
          onPointerUp={()=>{dragRef.current=null;}}/>
        <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
          <button className="btn pri" disabled={!(sel&&sel.w>6&&sel.h>6)}
            onClick={()=>onDone(_cropToDataURL(imgRef.current,sel,scRef.current))}>✂️ {tr("선택 영역 잘라서 첨부","Crop & attach")}</button>
          <button className="btn gho" onClick={()=>onDone(_cropToDataURL(imgRef.current,null,1))}>{tr("전체 이미지 사용","Use whole image")}</button>
          <button className="btn gho" onClick={onCancel} style={{marginLeft:"auto"}}>{tr("취소","Cancel")}</button>
        </div>
      </div>
    </div>);
}

/* ── 문제 1건 편집 카드 (검수·수정 공용) ── */
function ItemEditor({item,units,onChange,onRemove}){
  const set=(f,v)=>onChange({...item,[f]:v});
  const setSrc=(f,v)=>onChange({...item,src:{...(item.src||{}),[f]:v}});
  const [preview,setPreview]=useState(true);
  const [cropSrc,setCropSrc]=useState(null);   // 그림 첨부용 원본 이미지 (크롭 대기)
  const [vecDraft,setVecDraft]=useState(null); // AI가 만든 벡터 스크립트 초안 (사람 승인 대기)
  const [vecBusy,setVecBusy]=useState(false);
  const [vecErr,setVecErr]=useState("");
  function pickFigure(file){
    const rd=new FileReader();
    rd.onload=()=>setCropSrc(rd.result);
    rd.readAsDataURL(file);
  }
  // 그림 PNG → AI가 장면 스크립트 초안 생성 → 아래 나란히 미리보기 → 사람이 승인해야 저장 (§5)
  async function toVector(){
    if(vecBusy)return;
    setVecBusy(true);setVecErr("");setVecDraft(null);
    try{
      const m=String(item.figure||"").match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
      if(!m)throw new Error(tr("그림 형식을 읽을 수 없어","Bad figure format"));
      const sys="너는 수학 문항의 그림(그래프·도형)을 벡터 장면 스크립트로 정밀하게 옮기는 도구야. 그림에 실제로 있는 요소만 옮기고, 반드시 JSON만 출력해(코드블록·설명 금지).\n"+SCENE_SCHEMA_PROMPT;
      const blocks=[
        {type:"image",source:{type:"base64",media_type:m[1],data:m[2]}},
        {type:"text",text:"[문항 본문 — 그림 해석의 맥락]\n"+(item.question||"(없음)")+"\n\n이 그림을 장면 스크립트 JSON으로 재구성해."},
      ];
      const r=await callAI(sys,blocks,true,{maxTok:1900});
      const v=validateScript(r);   // 정밀 검증: expr 컴파일·plot 참조·정의역까지 통과해야 초안 표시
      if(!v.ok)throw new Error(tr("AI 초안 검증 실패: ","Draft failed: ")+v.errors.slice(0,2).join(" / "));
      setVecDraft(r);
    }catch(e){setVecErr(e.message||String(e));}
    setVecBusy(false);
  }
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
          <label className="btn gho xs" style={{cursor:"pointer"}} title={tr("시험지 사진에서 도형·그래프 영역을 잘라 첨부","Attach & crop a figure")}>
            📷 {item.figure?tr("그림 교체","Replace"):tr("그림 첨부","Figure")}
            <input type="file" accept="image/*" style={{display:"none"}} onChange={e=>{if(e.target.files[0])pickFigure(e.target.files[0]);e.target.value="";}}/>
          </label>
          <button className="btn gho xs" onClick={()=>setPreview(v=>!v)}>{preview?tr("✏️ 편집","✏️ Edit"):tr("👁 미리보기","👁 Preview")}</button>
          <button className="btn gho xs" onClick={onRemove} style={{color:"#B91C1C"}}>{tr("삭제","Delete")}</button>
        </span>
      </div>
      {cropSrc&&<FigureCropper src={cropSrc} onCancel={()=>setCropSrc(null)}
        onDone={(dataUrl)=>{onChange({...item,figure:dataUrl,hasFigure:true});setCropSrc(null);}}/>}
      {item.figure?(
        <div style={{display:"flex",alignItems:"flex-start",gap:10,flexWrap:"wrap"}}>
          <img src={item.figure} alt="" style={{maxWidth:280,maxHeight:200,border:"1px solid var(--line)",borderRadius:8,background:"#fff"}}/>
          <span style={{display:"inline-flex",flexDirection:"column",gap:6}}>
            <button className="btn gho xs" onClick={()=>set("figure",null)} style={{color:"#B91C1C"}}>✕ {tr("그림 제거","Remove figure")}</button>
            {!item.figureScript&&<button className="btn gho xs" onClick={toVector} disabled={vecBusy}
              title={tr("AI가 그림을 벡터 스크립트 초안으로 변환 — 검수 승인해야 저장","AI drafts a vector script — approve to save")}>
              {vecBusy?tr("🧭 변환 중…","🧭 Converting…"):tr("🧭 벡터로 변환","🧭 To vector")}
            </button>}
            {item.figureScript&&<span className="chip" style={{background:"var(--pri-s)",color:"var(--pri-d)",fontWeight:800}}>🧭 {tr("벡터 그림 있음","Vector figure")}</span>}
            {item.figureScript&&<button className="btn gho xs" onClick={()=>set("figureScript",null)} style={{color:"#B91C1C"}}>✕ {tr("벡터 제거","Remove vector")}</button>}
          </span>
          {vecErr&&<span style={{fontSize:12.5,color:"#B91C1C"}}>⚠️ {vecErr}</span>}
        </div>
      ):(item.hasFigure&&
        <div style={{padding:"8px 12px",background:"#FEF2F2",borderRadius:9,fontSize:12.5,color:"#991B1B"}}>
          ⚠️ {tr("그림 필수 문항인데 그림이 없어요 — 첨부 전까지는 출제 후보에서 제외됩니다.","Figure required but missing — excluded from exams until attached.")}
        </div>)}
      {vecDraft&&(   /* AI 벡터 초안: 원본과 나란히 놓고 사람이 승인/거절 */
        <div style={{border:"1.5px solid var(--pri)",borderRadius:12,padding:12,display:"flex",flexDirection:"column",gap:8,background:"var(--pri-s)"}}>
          <b style={{fontSize:13,color:"var(--pri-d)"}}>🧭 {tr("AI 벡터 초안 — 원본 그림과 비교해서 승인해줘","AI vector draft — compare & approve")}</b>
          <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"flex-start"}}>
            <img src={item.figure} alt="" style={{maxWidth:240,maxHeight:180,border:"1px solid var(--line)",borderRadius:8,background:"#fff"}}/>
            <div style={{maxWidth:300,flex:"1 1 240px"}}><MathViz script={vecDraft} staticOnly controls={false}/></div>
          </div>
          <span style={{display:"flex",gap:8}}>
            <button className="btn pri xs" onClick={()=>{onChange({...item,figureScript:vecDraft});setVecDraft(null);}}>✓ {tr("승인 — 벡터 저장","Approve")}</button>
            <button className="btn gho xs" onClick={()=>setVecDraft(null)}>{tr("거절","Discard")}</button>
            <button className="btn gho xs" onClick={toVector} disabled={vecBusy}>{tr("다시 생성","Regenerate")}</button>
          </span>
        </div>
      )}
      {!vecDraft&&item.figureScript&&preview&&(
        <div style={{maxWidth:320}}><MathViz script={item.figureScript} staticOnly controls={false}/></div>
      )}
      {preview?(
        <div style={{fontSize:14,lineHeight:1.75}}>
          <MathText text={item.question||""} tag="div"/>
          {(item.choices||[]).length>0&&<div style={{marginTop:4,color:"var(--ink)"}}>{(item.choices||[]).map((c,i)=><MathText key={i} text={c} tag="div"/>)}</div>}
          {item.answer&&<div style={{marginTop:8,padding:"8px 12px",background:"#F0FDF4",borderRadius:9,fontSize:13}}>
            <b style={{color:"#166534"}}>{tr("정답","Answer")}</b> <MathText text={item.answer} tag="span"/>
            {item.answerSource==="sheet"&&<span className="chip" style={{marginLeft:8,background:"#DCFCE7",color:"#166534",fontSize:10.5}}>📄 {tr("정답지 반영","From key")}</span>}
            {item.answerSource==="ai"&&<span className="chip" style={{marginLeft:8,background:"#FEF3C7",color:"#92400E",fontSize:10.5,fontWeight:800}}>🧮 {tr("AI 풀이 초안 — 공식 정답 대조 필요","AI draft — verify vs official key")}</span>}
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
        for(const f of batch){const p=await prepImage(f);blocks.push({type:"image",source:{type:"base64",media_type:p.mime,data:p.b64}});}
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

  // ── 정답지 병합: 정답지 파일에서 문항번호→정답 추출 → 문항번호로 초안에 자동 매칭 (정답지가 진리) ──
  const normNo=(s)=>String(s||"").replace(/[^0-9]/g,"");
  async function mergeAnswerSheet(file){
    setBusy(true);setErr("");
    try{
      setBusyMsg(tr("정답지 읽는 중… ","Reading answer key… ")+file.name);
      let block;
      if(file.type==="application/pdf"){
        block={type:"document",source:{type:"base64",media_type:"application/pdf",data:await toB64(file)}};
      }else{
        const p=await prepImage(file);
        block={type:"image",source:{type:"base64",media_type:p.mime,data:p.b64}};
      }
      const key=await extractAnswerKey([block]);
      let hit=0;
      const next=draft.map(d=>{
        const m=key.find(k=>normNo(k.number)&&normNo(k.number)===normNo(d.src?.number));
        if(!m)return d;
        hit++;
        return{...d,answer:m.answer,explanation:m.explanation||d.explanation,answerSource:"sheet"};
      });
      setDraft(next);
      if(!key.length)setErr(tr("정답지에서 정답을 못 읽었어 — 파일을 확인해줘.","Couldn't read the answer key."));
      else alert(tr("정답 "+key.length+"개 추출 → "+hit+"문제에 반영했어 (문항번호 기준 매칭).",key.length+" answers extracted, "+hit+" matched."));
    }catch(e){setErr(tr("정답지 병합 실패: ","Answer merge failed: ")+(e.message||e));}
    setBusy(false);setBusyMsg("");
  }

  // ── AI 풀이 초안: 정답 없는 문제를 AI가 풀어 채움 — 100%가 아니므로 반드시 '대조 필요' 표시 ──
  async function solveAll(){
    const targets=draft.filter(d=>!(d.answer||"").trim());
    if(!targets.length){setErr(tr("정답이 비어 있는 문제가 없어.","No unanswered items."));return;}
    if(!confirm(tr("정답 없는 "+targets.length+"문제를 AI가 풀어 초안을 채울게.\n\n⚠️ AI 풀이는 정확도가 높지만 100%는 아니야. 반드시 공식 정답표와 대조한 뒤 '검수 완료'를 체크해줘. 진행할까?","AI will draft answers for "+targets.length+" items. Not 100% accurate — verify against the official key. Proceed?")))return;
    setBusy(true);setErr("");
    for(let i=0;i<targets.length;i++){
      setBusyMsg(tr("AI 풀이 중… (","Solving… (")+(i+1)+"/"+targets.length+")");
      try{
        const s=await solveBankItem(targets[i]);
        if(s)setDraft(ds=>ds.map(d=>d.id===targets[i].id
          ?{...d,answer:s.answer,explanation:s.explanation||d.explanation,answerSource:"ai"}:d));
      }catch(e){console.warn("[bank] AI 풀이 실패",e);}
    }
    setBusy(false);setBusyMsg("");
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
          // 벡터 그림은 검증 통과분만 (깨진 JSON·거대 쓰레기 저장 방지)
          figureScript:isSceneScript(it.figureScript)?it.figureScript:undefined,
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
        {draft.filter(d=>!(d.answer||"").trim()).length>0&&
          <span className="chip" style={{background:"#FEF3C7",color:"#92400E"}}>{tr("정답 없음 ","No answer ")}{draft.filter(d=>!(d.answer||"").trim()).length}</span>}
        <span style={{marginLeft:"auto",display:"inline-flex",gap:6,flexWrap:"wrap"}}>
          <label className="btn gho sm" style={{cursor:busy?"default":"pointer",opacity:busy?.5:1}} title={tr("공식 정답지(PDF/사진)를 올리면 문항번호로 정답을 자동 병합 — 정답지가 진리","Merge official answer key by question number")}>
            📄 {tr("정답지 병합","Merge key")}
            <input type="file" accept="image/*,application/pdf" style={{display:"none"}} disabled={busy}
              onChange={e=>{if(e.target.files[0])mergeAnswerSheet(e.target.files[0]);e.target.value="";}}/>
          </label>
          <button className="btn gho sm" onClick={solveAll} disabled={busy} title={tr("정답 없는 문제를 AI가 풀어 초안 작성 — 100%가 아니므로 공식 정답 대조 필수","AI drafts answers — verify against the official key")}>🧮 {tr("AI 풀이 초안","AI draft")}</button>
          <button className="btn gho sm" disabled={busy}
            onClick={()=>setDraft(ds=>ds.map(d=>({...d,verified:true,verifiedAt:Date.now()})))}>{tr("전체 검수 완료로 표시","Mark all verified")}</button>
        </span>
      </div>
      {busy&&<div style={{display:"flex",alignItems:"center",gap:10,color:"var(--sub)",fontSize:13.5,marginBottom:12}}><span className="spinner" style={{width:16,height:16}}/>{busyMsg}</div>}
      {err&&<div style={{color:"#B91C1C",fontSize:13,marginBottom:12}}>{err}</div>}
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
                {it.figure&&<span className="chip" style={{background:"#EFF6FF",color:"#1E40AF"}}>🖼 {tr("그림","Fig")}</span>}
                {it.hasFigure&&!it.figure&&<span className="chip" style={{background:"#FEF2F2",color:"#991B1B",fontWeight:800}}>⚠️ {tr("그림 필요 — 출제 제외","Needs figure")}</span>}
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
