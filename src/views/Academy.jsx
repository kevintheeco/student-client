import { CFG, LS, _auth, tr } from "../core/platform.js";
import { AcademyDash } from "./AcademyDash.jsx";
import { Exam } from "./Exam.jsx";
import { Insight } from "./Insight.jsx";
import { KeyForm } from "./Settings.jsx";
import { Prof } from "../ui/common.jsx";
import { setActiveStudent } from "../core/attempts.js";
import { clearDemoStudents, seedDemoStudents } from "../core/demoStudents.js";
import { fetchShared, importShared } from "../core/link.js";
import { ACADEMY_CODE, uid } from "../core/ai.js";
import { CURRICULUM } from "../core/curriculum.js";
import React from "react";
const { useState, useEffect, useRef, useCallback } = React;

function AcademyApp(){
  const [view,setView]=useState("home");   // home | students | build | preview | exam | insight | dash
  const [topic,setTopic]=useState(null);
  const [student,setStudent]=useState(LS.get("ng:academy:student")||"");
  const [acaName,setAcaName]=useState(LS.get("ng:academy:name")||"");
  const saveAca=(v)=>{setAcaName(v);LS.set("ng:academy:name",v);};
  const [picked,setPicked]=useState({});     // "subjId::단원" → {name,subj,count,difficulty}
  const [openSubj,setOpenSubj]=useState(null);
  const [keyReady,setKeyReady]=useState(!!(CFG.key||CFG.geminiKey));
  const DIFFS=[["easy",tr("쉬움","Easy")],["medium",tr("보통","Medium")],["hard",tr("어려움","Hard")]];
  const toPersonal=()=>{location.hash="";location.reload();};
  const saveStudent=(v)=>{setStudent(v);LS.set("ng:academy:student",v);};

  // ── 학생 명단: 한 기기 다중 학생 — 학생별로 시도 로그·숙련도·오개념 사전 분리 ──
  const [students,setStudents]=useState(LS.get("ng:aca:students")||[]);
  const [activeSid,setActiveSid]=useState(LS.get("ng:aca:active")||null);
  const [newStu,setNewStu]=useState("");
  const saveStudents=(list)=>{setStudents(list);LS.set("ng:aca:students",list);};
  function selectStudent(s){
    setActiveSid(s.id);LS.set("ng:aca:active",s.id);
    setActiveStudent(s.id);           // 이후 모든 시도 로그·집계가 이 학생에게 귀속
    saveStudent(s.name);
  }
  function addStudent(){
    const name=newStu.trim();if(!name)return;
    const s={id:uid(),name,createdAt:Date.now()};
    saveStudents([...students,s]);setNewStu("");selectStudent(s);
  }
  function delStudent(s,e){
    e.stopPropagation();
    if(!confirm(tr('"'+s.name+'" 학생을 명단에서 뺄까? 시험·성장 기록은 지워지지 않아.','Remove "'+s.name+'"? Records are kept.')))return;
    saveStudents(students.filter(x=>x.id!==s.id));
    if(activeSid===s.id){setActiveSid(null);LS.del("ng:aca:active");setActiveStudent(null);saveStudent("");}
  }
  useEffect(()=>{
    // 마이그레이션: 기존 단일 학생명만 있던 기기는 명단으로 승격
    if(!students.length){
      const legacy=(LS.get("ng:academy:student")||"").trim();
      if(legacy){const s={id:uid(),name:legacy,createdAt:Date.now()};saveStudents([s]);selectStudent(s);return;}
    }
    if(activeSid)setActiveStudent(activeSid);   // 새로고침 후 활성 학생 복원
  },[]);
  const activeStu=students.find(s=>s.id===activeSid)||null;

  // ── 예시 학생: 6개월 학습 시나리오 5명을 시딩해 대시보드·인사이트를 미리 본다 ──
  const hasDemo=students.some(s=>s.demo);
  function seedDemo(){
    seedDemoStudents();
    setStudents(LS.get("ng:aca:students")||[]);
    setView("dash");
  }
  function clearDemo(){
    if(!confirm(tr("불러온 학생 5명과 6개월치 기록을 모두 지울까? 직접 등록한 학생 데이터는 그대로 남아.","Remove the 5 loaded students and their records? Real data is kept.")))return;
    clearDemoStudents();
    const list=LS.get("ng:aca:students")||[];
    setStudents(list);
    if(activeSid&&!list.some(s=>s.id===activeSid)){setActiveSid(null);setActiveStudent(null);saveStudent("");}
  }

  // ── 홈학습 연동: 학생 개인 앱이 공유한 데이터를 명단 학생에게 병합 ──
  const [linkOpen,setLinkOpen]=useState(false);
  const [sharedList,setSharedList]=useState(null);
  const [linkBusy,setLinkBusy]=useState(false);
  const [linkMsg,setLinkMsg]=useState("");
  async function loadShared(){
    setLinkBusy(true);setLinkMsg("");
    try{
      if(_auth&&!_auth.currentUser)await _auth.signInWithPopup(new window.firebase.auth.GoogleAuthProvider());
      setSharedList(await fetchShared(ACADEMY_CODE||"test"));
    }catch(e){setLinkMsg("⚠️ "+(e.message||e));}
    setLinkBusy(false);
  }
  function doImport(sh){
    // 명단에 같은 이름이 있으면 그 학생에게, 없으면 새 학생으로
    let stu=students.find(s=>s.name===(sh.name||"").trim())||activeStu;
    if(!stu){stu={id:uid(),name:(sh.name||tr("학생","Student")).trim(),createdAt:Date.now()};saveStudents([...students,stu]);}
    selectStudent(stu);
    const added=importShared(sh,stu.id);
    setLinkMsg("✅ "+(sh.name||"학생")+" → "+stu.name+tr(" 명단에 "+added+"건 병합 — 성장 인사이트에서 확인"," merged "+added+" records"));
  }
  const keyOf=(sid,u)=>sid+"::"+u;
  const toggleUnit=(sid,sname,u)=>setPicked(p=>{const k=keyOf(sid,u),n={...p};if(n[k])delete n[k];else n[k]={name:u,subj:sname,count:2,difficulty:"medium"};return n;});
  const setField=(k,f,v)=>setPicked(p=>({...p,[k]:{...p[k],[f]:v}}));
  const pickedList=Object.entries(picked);
  const totalQ=pickedList.reduce((s,[,v])=>s+(Number(v.count)||0),0);
  function makeTest(){
    const units=pickedList.map(([,v])=>({name:v.name,count:Number(v.count)||2,difficulty:v.difficulty}));
    const subjs=[...new Set(pickedList.map(([,v])=>v.subj))];
    setTopic({id:"level_"+Date.now(),label:subjs.join(", ")+" · "+tr("레벨테스트","Level test"),grade:subjs.join(", "),subject:subjs[0]||"",units});
    setView("preview");
  }
  const Head=()=>(
    <div className="hd">
      <div className="brand"><Prof size={44}/><div><h1>{tr("니가교수 학원","Academy")}</h1><div className="tag">{tr("단원 선택 → 레벨테스트 → 학부모 리포트","Pick units → level test → parent report")}</div></div></div>
      <div className="hd-r">
        {view!=="home"&&<button className="btn gho sm" onClick={()=>setView("home")}>🏠 {tr("홈","Home")}</button>}
        {students.length>0&&view!=="dash"&&<button className="btn gho sm" onClick={()=>setView("dash")}>📋 {tr("대시보드","Dashboard")}</button>}
        <button className="btn gho sm" onClick={toPersonal}>{tr("← 개인 학습","← Personal")}</button>
      </div>
    </div>
  );
  // ── 학원명·학생 목록 카드 + 홈학습 연동 다이얼로그 (학생 관리·레벨테스트 화면 공용) ──
  const rosterCard=(
    <div className="card" style={{padding:"14px 16px",marginBottom:16,display:"flex",gap:14,flexWrap:"wrap"}}>
      <div style={{flex:"1 1 220px"}}>
        <label style={{fontSize:12.5,fontWeight:700,color:"var(--sub)",display:"block",marginBottom:6}}>🏫 {tr("학원명","Academy name")}</label>
        <input className="field" value={acaName} onChange={e=>saveAca(e.target.value)} placeholder={tr("예: 구주이배수학학원","e.g. Acme Math")}/>
      </div>
      <div style={{flex:"2 1 320px"}}>
        <label style={{fontSize:12.5,fontWeight:700,color:"var(--sub)",display:"block",marginBottom:6}}>
          🧑‍🎓 {tr("학생 목록","Student list")}
          <span style={{fontWeight:400,marginLeft:6,fontSize:11.5}}>{tr("— 선택한 학생에게 시험·성장 기록이 귀속돼요","— records attach to the selected student")}</span>
        </label>
        <div style={{display:"flex",gap:7,flexWrap:"wrap",alignItems:"center"}}>
          {students.map(s=>{
            const on=s.id===activeSid;
            return(
              <span key={s.id} onClick={()=>selectStudent(s)}
                style={{display:"inline-flex",alignItems:"center",gap:5,padding:"7px 11px",borderRadius:11,cursor:"pointer",fontSize:13,fontWeight:on?800:600,
                  border:"1.5px solid "+(on?"var(--pri)":"var(--line)"),background:on?"var(--pri-s)":"#fff",color:on?"var(--pri-d)":"var(--ink)"}}>
                {on?"✓ ":""}{s.name}
                <button onClick={e=>delStudent(s,e)} title={tr("명단에서 빼기","Remove")}
                  style={{background:"none",border:"none",cursor:"pointer",padding:"0 1px",opacity:.5,color:"inherit",fontSize:13,lineHeight:1}}>×</button>
              </span>);})}
          <span style={{display:"inline-flex",gap:5}}>
            <input className="field" value={newStu} onChange={e=>setNewStu(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter")addStudent();}}
              placeholder={tr("+ 학생 이름","+ Student name")} style={{width:130,padding:"7px 10px",fontSize:13}}/>
            <button className="btn pri xs" onClick={addStudent} disabled={!newStu.trim()}>{tr("추가","Add")}</button>
          </span>
          <span style={{marginLeft:"auto",display:"inline-flex",gap:6}}>
            <button className="btn gho sm" onClick={()=>{setLinkOpen(true);if(!sharedList)loadShared();}}>🔗 {tr("홈학습 연동","Home-study link")}</button>
            {activeStu&&<button className="btn gho sm" onClick={()=>setView("insight")}>📊 {tr("성장 인사이트","Growth insight")}</button>}
            {hasDemo
              ?<button className="btn gho sm" onClick={clearDemo} title={tr("불러온 학생 목록과 기록만 지웁니다 — 직접 등록한 학생은 남아요","Removes only the loaded sample list; real students are kept")}>🧹 {tr("불러온 목록 지우기","Clear loaded list")}</button>
              :<button className="btn gho sm" onClick={seedDemo} title={tr("6개월 학습 데이터를 가진 학생 5명의 목록을 불러와 대시보드를 미리 봅니다","Load a sample roster of 5 students with 6 months of history")}>👥 {tr("학생 목록 불러오기","Load student list")}</button>}
          </span>
        </div>
      </div>
    </div>);
  const linkDialog=linkOpen&&(
    <div onClick={()=>setLinkOpen(false)} style={{position:"fixed",inset:0,background:"rgba(26,36,54,.42)",zIndex:60,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div onClick={e=>e.stopPropagation()} className="card" style={{maxWidth:480,width:"100%",padding:22,display:"flex",flexDirection:"column",gap:12}}>
        <div style={{fontFamily:"'Jua',sans-serif",fontSize:17,color:"var(--ink)"}}>🔗 {tr("홈학습 연동","Home-study link")}</div>
        <div style={{fontSize:12.5,color:"var(--sub)",lineHeight:1.7}}>
          {tr("학생이 개인 니가교수 앱(프로필 → 학원 연동)에 학원 코드를 넣으면 여기 나타나요. 가져오면 집에서 공부한 시도·오개념·학습 습관이 그 학생의 성장 인사이트에 합쳐집니다.",
             "Students who enter this academy's code in their personal app appear here.")}
        </div>
        {linkBusy&&<div style={{color:"var(--sub)",fontSize:13}}><span className="spinner" style={{width:14,height:14,display:"inline-block",verticalAlign:"middle",marginRight:8}}/>{tr("불러오는 중…","Loading…")}</div>}
        {sharedList&&sharedList.length===0&&!linkBusy&&<div style={{fontSize:13,color:"var(--sub)"}}>{tr("아직 이 학원 코드로 공유한 학생이 없어요.","No shared students yet.")}</div>}
        {sharedList&&sharedList.map(sh=>(
          <div key={sh.uid} style={{display:"flex",alignItems:"center",gap:10,border:"1px solid var(--line)",borderRadius:10,padding:"10px 13px"}}>
            <div style={{minWidth:0,flex:1}}>
              <b style={{fontSize:14}}>{sh.name||tr("이름 없음","Unnamed")}</b>
              <div style={{fontSize:11.5,color:"var(--sub)"}}>{tr("시도 ","attempts ")}{(sh.attempts||[]).length}{tr("건 · 마지막 공유 "," · last ")}{new Date(sh.t).toLocaleDateString("ko-KR")}</div>
            </div>
            <button className="btn pri sm" onClick={()=>doImport(sh)}>{tr("가져오기","Import")}</button>
          </div>))}
        {linkMsg&&<div style={{fontSize:12.5,lineHeight:1.6,color:linkMsg.startsWith("✅")?"#166534":"#9B1C1C"}}>{linkMsg}</div>}
        <div className="row">
          <button className="btn gho sm" onClick={loadShared} disabled={linkBusy}>{tr("새로고침","Refresh")}</button>
          <button className="btn gho sm" onClick={()=>setLinkOpen(false)}>{tr("닫기","Close")}</button>
        </div>
      </div>
    </div>);

  if(!keyReady)return(<><Head/><div className="card panel"><div className="eyebrow" style={{marginBottom:8}}>{tr("API 키 입력","API key")}</div><KeyForm onSaved={()=>setKeyReady(true)} cta={tr("저장하고 시작","Save & start")}/></div></>);

  // ── 홈: 큰 위젯 두 개 — 레벨테스트 하기 · 학생 관리 ──
  if(view==="home")return(<>
    <Head/>
    <section>
      <div className="hero">
        <Prof size={56}/>
        <div>
          <h2>{tr(<>오늘은 무엇을<br/>도와드릴까요?</>,<>What shall we<br/>do today?</>)}</h2>
          <p>{tr("레벨테스트로 학생을 진단하거나, 학생 목록에서 성장을 관리하세요.","Diagnose with a level test, or manage student growth.")}</p>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16}}>
        {[
          {e:"🧪",go:"build",t:tr("레벨테스트 하기","Make a level test"),
           d:tr("단원을 고르면 AI가 시험을 만들고, 손글씨 풀이까지 채점해 단원별 약점과 학부모 리포트를 만들어요.","Pick units — AI builds the test, grades handwriting, and writes the parent report."),
           cta:tr("시험 만들러 가기 →","Start →")},
          {e:"👥",go:"students",t:tr("학생 관리","Students"),
           badge:students.length?students.length+tr("명",""):null,
           d:tr("학생 목록·홈학습 연동·전체 대시보드·성장 인사이트 — 누가 어떤 이유로 관심이 필요한지 한눈에.","Roster, home-study link, dashboard and growth insight in one place."),
           cta:tr("학생 보러 가기 →","Open →")},
        ].map(w=>(
          <div key={w.go} className="card" onClick={()=>setView(w.go)}
            style={{padding:"30px 28px",cursor:"pointer",display:"flex",flexDirection:"column",gap:8,minHeight:190}}>
            <div style={{fontSize:46,lineHeight:1}}>{w.e}</div>
            <div style={{fontFamily:"'Jua',sans-serif",fontSize:21,color:"var(--ink)",display:"flex",alignItems:"center",gap:8}}>
              {w.t}{w.badge&&<span className="chip" style={{background:"var(--pri-s)",color:"var(--pri-d)",fontSize:12}}>{w.badge}</span>}
            </div>
            <p style={{fontSize:13.5,color:"var(--sub)",lineHeight:1.7,margin:0,flex:1}}>{w.d}</p>
            <span style={{fontSize:14,fontWeight:800,color:"var(--pri)"}}>{w.cta}</span>
          </div>))}
      </div>
    </section>
  </>);

  // ── 학생 관리 ──
  if(view==="students")return(<>
    <Head/>
    <section style={{paddingBottom:40}}>
      <div className="hero">
        <Prof size={56}/>
        <div>
          <h2>{tr(<>학생 관리</>,<>Students</>)}</h2>
          <p>{tr("학생을 등록·선택하고, 홈학습 연동으로 집 공부 데이터를 합치고, 대시보드에서 전체 성장을 한눈에 봐요.","Manage the roster, merge home-study data, and see growth at a glance.")}</p>
        </div>
      </div>
      {rosterCard}
      {linkDialog}
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        {students.length>0&&<button className="btn pri" onClick={()=>setView("dash")}>📋 {tr("학원 대시보드 — 전체 학생 한눈에","Dashboard — all students")}</button>}
        {activeStu&&<button className="btn gho" onClick={()=>setView("insight")}>📊 {activeStu.name+tr(" 성장 인사이트"," growth insight")}</button>}
      </div>
    </section>
  </>);
  if(view==="exam"&&topic)return(<Exam topic={topic} student={student} academy academyName={acaName} onExit={()=>setView("build")}/>);
  if(view==="insight")return(<><Head/><Insight onExit={()=>setView("students")} studentName={activeStu?.name||student}/></>);
  if(view==="dash")return(<><Head/><AcademyDash students={students} onBack={()=>setView("students")} onInsight={(s)=>{selectStudent(s);setView("insight");}}/></>);

  // ── 미리보기 ──
  if(view==="preview"&&topic)return(<>
    <Head/>
    <section>
      <div className="card" style={{padding:"22px 24px",maxWidth:680,margin:"0 auto"}}>
        <div className="eyebrow" style={{marginBottom:6}}>{tr("레벨테스트 미리보기","Test preview")}</div>
        <div style={{fontFamily:"'Jua',sans-serif",fontSize:20,color:"var(--ink)",marginBottom:4}}>{topic.label}</div>
        <div style={{fontSize:13.5,color:"var(--sub)",marginBottom:16}}>{tr("학생","Student")}: <b style={{color:"var(--ink)"}}>{student||tr("(미입력)","(none)")}</b></div>
        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
          {topic.units.map((u,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:10,border:"1px solid var(--line)",borderRadius:10,padding:"10px 14px"}}>
              <span style={{flex:1,fontWeight:600,color:"var(--ink)"}}>{u.name}</span>
              <span className="chip" style={{background:"var(--pri-s)",color:"var(--pri-d)"}}>{u.count}{tr("문항","Q")}</span>
              <span className="chip gho">{(DIFFS.find(d=>d[0]===u.difficulty)||[])[1]}</span>
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:16,fontSize:14,fontWeight:700,color:"var(--ink)",marginBottom:6}}>
          <span>📋 {tr("총","Total")} {totalQ}{tr("문항","Q")}</span>
          <span>⏱️ {tr("예상","Est.")} {Math.max(5,totalQ*2)}{tr("분","min")}</span>
        </div>
        <p className="hint" style={{marginBottom:16}}>{tr("‘학생 응시 시작’을 누르면 AI가 위 구성으로 문제를 생성해 (조금 걸려요).","Tap start — AI generates the questions (takes a moment).")}</p>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button className="btn pri" onClick={()=>setView("exam")}>▶ {tr("학생 응시 시작","Start test")}</button>
          <button className="btn gho" onClick={()=>setView("build")}>{tr("← 단원 다시 고르기","← Edit units")}</button>
        </div>
      </div>
    </section>
  </>);

  // ── 빌더 ──
  return(<>
    <Head/>
    <section style={{paddingBottom:96}}>
      <div className="hero">
        <Prof size={56}/>
        <div>
          <h2>{tr(<>단원을 선택하면,<br/>레벨테스트가 바로 만들어집니다</>,<>Pick units,<br/>get a level test</>)}</h2>
          <p>{tr("학생 이름을 적고, 과목을 펼쳐 진단할 단원을 골라줘. 단원별 문항 수·난이도를 정한 뒤 테스트를 만들면 손글씨 풀이까지 AI가 채점해 단원별 약점과 학부모 리포트를 보여줘.","Name the student, expand a subject, pick units, set counts/difficulty.")}</p>
        </div>
      </div>
      {rosterCard}
      {linkDialog}
      {/* 과목·단원 선택 */}
      {CURRICULUM.map((lv,li)=>(
        <div key={li} style={{marginBottom:16}}>
          <div className="eyebrow" style={{marginBottom:8}}>{lv.level}</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {lv.subjects.map(sub=>{
              const open=openSubj===sub.id;
              const nSel=sub.units.filter(u=>picked[keyOf(sub.id,u)]).length;
              return(
              <article key={sub.id} className="card" style={{padding:"4px 6px"}}>
                <button onClick={()=>setOpenSubj(open?null:sub.id)} style={{width:"100%",display:"flex",alignItems:"center",gap:10,background:"none",border:"none",cursor:"pointer",padding:"12px 12px",fontFamily:"inherit"}}>
                  <span style={{fontFamily:"'Jua',sans-serif",fontSize:16,color:"var(--ink)",flex:1,textAlign:"left"}}>{sub.name}</span>
                  {nSel>0&&<span className="chip" style={{background:"var(--pri)",color:"#fff"}}>{nSel}{tr(" 단원"," units")}</span>}
                  <span style={{color:"var(--sub)",fontSize:13}}>{open?"▲":"▼"}</span>
                </button>
                {open&&(
                  <div style={{display:"flex",flexWrap:"wrap",gap:8,padding:"0 12px 14px"}}>
                    {sub.units.map((u,ui)=>{const on=!!picked[keyOf(sub.id,u)];return(
                      <button key={ui} className="btn sm" onClick={()=>toggleUnit(sub.id,sub.name,u)}
                        style={{border:"1.5px solid "+(on?"var(--pri)":"var(--line)"),background:on?"var(--pri-s)":"#fff",color:on?"var(--pri-d)":"var(--ink)",fontWeight:on?700:500}}>
                        {on?"✓ ":""}{u}
                      </button>);})}
                  </div>
                )}
              </article>);
            })}
          </div>
        </div>
      ))}
      {/* 선택한 단원 설정 */}
      {pickedList.length>0&&(
        <div className="card" style={{padding:"16px 18px",marginBottom:16}}>
          <div style={{fontFamily:"'Jua',sans-serif",fontSize:15,color:"var(--ink)",marginBottom:10}}>🎯 {tr("선택한 단원","Selected units")} ({pickedList.length})</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {pickedList.map(([k,v])=>(
              <div key={k} style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",borderBottom:"1px solid var(--line)",paddingBottom:10}}>
                <span style={{flex:"1 1 140px",fontWeight:600,color:"var(--ink)"}}>{v.name} <span style={{fontSize:11,color:"var(--sub)",fontWeight:400}}>· {v.subj}</span></span>
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  <button className="btn gho xs" onClick={()=>setField(k,"count",Math.max(1,(Number(v.count)||1)-1))}>−</button>
                  <span style={{minWidth:46,textAlign:"center",fontSize:13,fontWeight:700}}>{v.count}{tr("문항","Q")}</span>
                  <button className="btn gho xs" onClick={()=>setField(k,"count",Math.min(8,(Number(v.count)||1)+1))}>+</button>
                </div>
                <select className="field" value={v.difficulty} onChange={e=>setField(k,"difficulty",e.target.value)} style={{width:"auto",padding:"6px 8px",fontSize:12.5}}>
                  {DIFFS.map(([id,lbl])=><option key={id} value={id}>{lbl}</option>)}
                </select>
                <button className="btn gho xs" onClick={()=>toggleUnit(k.split("::")[0],v.subj,v.name)} title={tr("빼기","Remove")}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="hint" style={{marginBottom:8}}>{tr("※ 목차는 초안이야 — 학원 납품 전 검수·수정 필요.","Draft curriculum — verify before delivery.")}</p>
      {/* 하단 고정 생성 버튼 */}
      <div style={{position:"sticky",bottom:12,marginTop:8}}>
        <button className="btn pri" disabled={!totalQ} onClick={makeTest} style={{width:"100%",padding:"15px",fontSize:15,opacity:totalQ?1:0.5,boxShadow:"0 6px 20px rgba(108,92,231,.3)"}}>
          🧪 {tr("레벨테스트 만들기","Make level test")}{totalQ?" · "+tr("총","")+" "+totalQ+tr("문항","Q"):""}
        </button>
      </div>
    </section>
  </>);
}


export { CURRICULUM, AcademyApp };
