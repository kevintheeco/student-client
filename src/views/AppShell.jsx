import { AddMaterial } from "./AddMaterial.jsx";
import { CFG, DECKS_KEY, LS, SUBJS_KEY, SUBJ_COLORS, _auth, _db, cloudSyncOnLogin, defaultSubjects, dk, fmtClock, nickKey, setSyncListener, setUid, tr } from "../core/platform.js";
import { COMPANY_MODE, MODELS, uid } from "../core/ai.js";
import { Exam } from "./Exam.jsx";
import { Home } from "./Home.jsx";
import { Insight } from "./Insight.jsx";
import { Onboard, Settings } from "./Settings.jsx";
import { Prof } from "../ui/common.jsx";
import { Study } from "./Study.jsx";
import { Tutor } from "./Tutor.jsx";
import { WeakNotes } from "./WeakNotes.jsx";
import React from "react";
const { useState, useEffect, useRef, useCallback } = React;

function App(){
  const [view,setView]=useState((CFG.key||COMPANY_MODE)?"home":"onboard");
  const [decks,setDecks]=useState([]);
  const [subjects,setSubjects]=useState(defaultSubjects());
  const [filterSubj,setFilterSubj]=useState("all");
  const [activeDeck,setActiveDeck]=useState(null);
  const [examTopic,setExamTopic]=useState(null);   // 책 시험: 선택 단원 src+문항수 (topic 기반)
  const [noteDeck,setNoteDeck]=useState(null);
  const [user,setUser]=useState(null);
  const [nick,setNick]=useState("");
  const [showProfile,setShowProfile]=useState(false);
  const [syncBusy,setSyncBusy]=useState(false);
  const [cloudStatus,setCloudStatus]=useState("off");  // off | ok | error
  const [lastSyncAt,setLastSyncAt]=useState(0);
  // 환영 화면: 앱 들어올 때 닉네임 부르며 잠깐 인사 (기존 사용자만 — 온보딩 중엔 X)
  const [welcomed,setWelcomed]=useState(!CFG.key);
  const [wHide,setWHide]=useState(false);
  const dismissWelcome=()=>{setWHide(true);setTimeout(()=>setWelcomed(true),360);};
  useEffect(()=>{if(!CFG.key)return;const t=setTimeout(dismissWelcome,2800);return ()=>clearTimeout(t);},[]);

  // 클라우드 동기화 상태 구독 (초기 병합 + 이후 변경 저장 모두 반영)
  useEffect(()=>{
    setSyncListener(s=>{
      if(s.busy!==undefined)setSyncBusy(s.busy);
      if(s.ok!==undefined)setCloudStatus(s.ok?"ok":"error");
      if(s.at)setLastSyncAt(s.at);
    });
    return ()=>setSyncListener(null);
  },[]);

  const refresh=()=>setDecks(LS.get(DECKS_KEY)||[]);
  useEffect(()=>{refresh();},[]);

  // 구글 로그인 상태 구독 + 클라우드 동기화
  useEffect(()=>{
    if(!_auth)return;
    return _auth.onAuthStateChanged(async u=>{
      setUser(u);
      if(!u){setUid(null);setNick("");return;}
      setUid(u.uid);
      if(_db){
        try{await cloudSyncOnLogin(u.uid);}catch(e){console.warn("[sync]",e);}
        refresh();setSubjects(defaultSubjects());
      }
      const stored=LS.get(nickKey(u.uid));
      const n=stored||u.displayName||(u.email?u.email.split("@")[0]:tr("학습자","Learner"));
      if(!stored)LS.set(nickKey(u.uid),n);
      setNick(n);
    });
  },[]);

  async function login(){
    if(!_auth){alert(tr("로그인 기능을 쓸 수 없어. 인터넷 연결이나 설정을 확인해줘.","Sign-in isn't available. Check your connection or settings."));return;}
    try{
      await _auth.signInWithPopup(new window.firebase.auth.GoogleAuthProvider());
    }catch(e){
      if(e.code==="auth/popup-closed-by-user"||e.code==="auth/cancelled-popup-request")return;
      alert(tr("로그인 실패: ","Sign-in failed: ")+(e.message||e.code));
    }
  }
  async function logout(){try{await _auth.signOut();}catch(e){}setShowProfile(false);}
  function saveNick(n){const v=(n||"").trim();if(!v||!user)return;setNick(v);LS.set(nickKey(user.uid),v);}

  function openStudy(id,mode){const d=LS.get(dk(id));if(!d)return;if(mode==="exam"){setExamTopic(null);setActiveDeck(d);setView("exam");return;}if(mode==="learn"){setActiveDeck(d);setView("tutor");return;}setActiveDeck({...d,studyType:mode||d.studyType||"explain"});setView("study");}
  // 책 소주제 하나만 집중 학습(이해=explain / 암기=quiz). focusId로 그 개념만 출제.
  function openConcept(deckId,conceptId,mode){const d=LS.get(dk(deckId));if(!d)return;setActiveDeck({...d,studyType:mode||"explain",focusId:conceptId});setView("study");}
  function openNotes(id){const d=LS.get(dk(id));if(d){setNoteDeck(d);setView("notes");}}
  function studyWeak(deck){
    const fresh=LS.get(dk(deck.id))||deck;
    const weakConcepts=(fresh.concepts||[]).filter(c=>(c.box||1)<=3||c.lapses>0);
    if(!weakConcepts.length){alert(tr("아직 약점 개념이 없어! 전체 공부부터 해봐 💪","No weak concepts yet! Study the full set first 💪"));return;}
    setActiveDeck({...fresh,concepts:weakConcepts});
    setView("study");
  }

  function saveSubjects(s){setSubjects(s);LS.set(SUBJS_KEY,s);}

  const filteredDecks=filterSubj==="all"?decks:decks.filter(d=>d.subjId===filterSubj);

  return(
    <>
      {!welcomed&&(
        <div onClick={dismissWelcome} style={{position:"fixed",inset:0,zIndex:200,cursor:"pointer",
          background:"linear-gradient(160deg,#6C5CE7 0%,#8B7BF0 60%,#A29BFE 100%)",
          display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:13,color:"#fff",
          opacity:wHide?0:1,transition:"opacity .36s ease",textAlign:"center",padding:24}}>
          <div style={{background:"#fff",borderRadius:"50%",padding:16,boxShadow:"0 14px 44px rgba(0,0,0,.22)"}}><Prof size={86}/></div>
          <div style={{fontFamily:"'Jua',sans-serif",fontSize:27,lineHeight:1.25,marginTop:4}}>
            {nick?tr("안녕, ","Hi, ")+nick+"! 👋":tr("어서 와! 👋","Welcome! 👋")}
          </div>
          <div style={{fontSize:15,opacity:.95}}>{tr("오늘도 니가 교수님이야 — 같이 공부하자 📚","You're the prof today — let's study 📚")}</div>
          <div style={{fontSize:12.5,opacity:.72,marginTop:20}}>{tr("화면을 누르면 시작","Tap anywhere to start")}</div>
        </div>
      )}
      <div className="hd">
        <div className="brand" onClick={()=>setView((CFG.key||COMPANY_MODE)?"home":"onboard")}>
          <Prof size={44}/><div><h1>{tr("니가 교수","You're the Prof")}</h1><div className="tag">{tr("니가 설명해봐, 내가 채점할게","You explain, I'll grade")}</div></div>
        </div>
        <div className="hd-r">
          {view!=="home"&&CFG.key&&<button className="btn gho sm" onClick={()=>{refresh();setView("home");}}>{tr("← 목록","← Back")}</button>}
          {_auth&&(user
            ?<button className="btn gho sm" onClick={()=>setShowProfile(true)} title={syncBusy?tr("동기화 중…","Syncing…"):cloudStatus==="ok"?tr("동기화 완료","Synced"):tr("내 프로필","My profile")}>
                {user.photoURL&&<img src={user.photoURL} alt="" style={{width:18,height:18,borderRadius:"50%",verticalAlign:"middle",marginRight:6}}/>}
                {nick||tr("내 프로필","My profile")}
                <span style={{marginLeft:5}}>{syncBusy?"☁️…":cloudStatus==="ok"?"☁️✓":cloudStatus==="error"?"⚠️":""}</span>
              </button>
            :<button className="btn gho sm" onClick={login}>{tr("🔑 로그인","🔑 Sign in")}</button>
          )}
          <button className="btn gho sm" onClick={()=>setView("settings")}>{tr("⚙️ 설정","⚙️ Settings")}</button>
        </div>
      </div>

      {showProfile&&user&&(
        <div onClick={()=>setShowProfile(false)} style={{position:"fixed",inset:0,background:"rgba(34,28,57,.42)",zIndex:60,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div onClick={e=>e.stopPropagation()} className="card" style={{maxWidth:340,width:"100%",padding:22,display:"flex",flexDirection:"column",gap:14}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              {user.photoURL&&<img src={user.photoURL} alt="" style={{width:46,height:46,borderRadius:"50%"}}/>}
              <div style={{minWidth:0}}>
                <div style={{fontFamily:"'Jua',sans-serif",fontSize:16,color:"var(--ink)"}}>{nick}</div>
                <div style={{fontSize:12,color:"var(--sub)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.email}</div>
              </div>
            </div>
            <div style={{fontSize:12.5,padding:"8px 12px",borderRadius:10,
              background:(!syncBusy&&cloudStatus==="ok")?"#F0FDF4":syncBusy?"#EEF2FF":"#FFF6E9",
              border:"1px solid "+((!syncBusy&&cloudStatus==="ok")?"#B7EBC6":syncBusy?"#C7D2FE":"#FBE3B8"),
              color:(!syncBusy&&cloudStatus==="ok")?"#166534":syncBusy?"#3730A3":"#8A5A12",lineHeight:1.6}}>
              {syncBusy?tr("☁️ 동기화 중…","☁️ Syncing…")
               :cloudStatus==="ok"?(tr("✅ 동기화 완료 — 어느 기기서든 이어집니다.","✅ Synced — continues on any device.")+(lastSyncAt?tr(" (마지막 "," (last ")+fmtClock(lastSyncAt)+")":""))
               :cloudStatus==="error"?tr("⚠️ 클라우드 연결 실패 — Firestore 설정을 확인해줘 (지금은 이 기기에만 저장).","⚠️ Cloud connection failed — check Firestore setup (saved on this device for now).")
               :tr("⚠️ 클라우드 미설정 — 이 기기에만 저장됩니다.","⚠️ Cloud not set up — saved on this device only.")}
            </div>
            <div className="selectrow">
              <label>{tr("닉네임","Nickname")}</label>
              <input className="field" value={nick} maxLength={20} onChange={e=>{const v=e.target.value;setNick(v);if(v.trim()&&user)LS.set(nickKey(user.uid),v.trim());}} onBlur={e=>saveNick(e.target.value)}/>
            </div>
            <div className="row">
              <button className="btn pri" onClick={()=>{saveNick(nick);setShowProfile(false);}}>{tr("저장","Save")}</button>
              <button className="btn gho" onClick={logout}>{tr("로그아웃","Sign out")}</button>
            </div>
          </div>
        </div>
      )}

      {view==="onboard"&&<Onboard onDone={()=>setView("home")}/>}
      {view==="settings"&&<Settings onDone={()=>setView((CFG.key||COMPANY_MODE)?"home":"onboard")}/>}
      {view==="home"&&(
        <>
          <SubjectTabs subjects={subjects} active={filterSubj} onChange={setFilterSubj} onSave={saveSubjects}/>
          <Home decks={filteredDecks} subjects={subjects} onAdd={()=>setView("add")} onOpen={openStudy} onNotes={openNotes} onChanged={refresh} nick={nick} onInsight={()=>setView("insight")}/>
        </>
      )}
      {view==="insight"&&<Insight onExit={()=>{refresh();setView("home");}}/>}
      {view==="add"&&<AddMaterial subjects={subjects} onSave={saveSubjects} onDone={()=>{refresh();setView("home");}} onCancel={()=>setView("home")}/>}
      {view==="study"&&activeDeck&&<Study deck={activeDeck} subjects={subjects} onExit={()=>{refresh();setView("home");}}/>}
      {view==="exam"&&(activeDeck||examTopic)&&<Exam deck={examTopic?null:activeDeck} topic={examTopic} onExit={()=>{setExamTopic(null);refresh();setView("home");}}/>}
      {view==="tutor"&&activeDeck&&<Tutor deck={activeDeck} onExit={()=>{refresh();setView("home");}} onPractice={(cid,mode)=>openConcept(activeDeck.id,cid,mode)} onExam={(topic)=>{setExamTopic(topic);setView("exam");}}/>}
      {view==="notes"&&noteDeck&&<WeakNotes deck={noteDeck} onBack={()=>{refresh();setView("home");}} onStudy={studyWeak}/>}

      <div className="footer">{tr("키와 자료는 이 기기에만 저장","Keys & data stay on this device only")} · {MODELS.find(m=>m.id===CFG.model)?.label.split(" ·")[0]||"Claude"}</div>
    </>
  );
}

/* ── 과목 탭 바 ── */
function SubjectTabs({subjects,active,onChange,onSave}){
  const [adding,setAdding]=useState(false);
  const [newName,setNewName]=useState("");
  const [editId,setEditId]=useState(null);
  const [editName,setEditName]=useState("");

  function addSubject(){
    const name=newName.trim();if(!name)return;
    const color=SUBJ_COLORS[subjects.length%SUBJ_COLORS.length];
    const s=[...subjects,{id:uid(),name,color}];
    onSave(s);setNewName("");setAdding(false);
  }
  function startEdit(s,e){
    e.stopPropagation();setEditId(s.id);setEditName(s.name);
  }
  function saveEdit(){
    const n=editName.trim();if(!n)return;
    onSave(subjects.map(s=>s.id===editId?{...s,name:n}:s));setEditId(null);
  }
  function delSubject(s,e){
    e.stopPropagation();
    if(!confirm(tr('"'+s.name+'" 과목 삭제할까? 덱 자료는 남아있어.','Delete folder "'+s.name+'"? Your decks stay.')))return;
    onSave(subjects.filter(x=>x.id!==s.id));
    if(active===s.id)onChange("all");
  }
  const btnStyle={background:"none",border:"none",cursor:"pointer",padding:"0 2px",opacity:.55,color:"inherit",fontSize:12,lineHeight:1};

  return(
    <div style={{marginBottom:20}}>
      <div className="sub-tabs">
        <button className={"sub-tab"+(active==="all"?" on":"")} onClick={()=>onChange("all")}>{tr("전체","All")}</button>
        {subjects.map(s=>
          editId===s.id?(
            <div key={s.id} className="subj-new" style={{display:"inline-flex",margin:0}}>
              <input value={editName} onChange={e=>setEditName(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter")saveEdit();if(e.key==="Escape")setEditId(null);}}
                autoFocus style={{width:100}}/>
              <button className="btn pri xs" onClick={saveEdit}>{tr("저장","Save")}</button>
              <button className="btn gho xs" onClick={()=>setEditId(null)}>{tr("취소","Cancel")}</button>
            </div>
          ):(
            <div key={s.id} className={"sub-tab"+(active===s.id?" on":"")}
              style={{display:"inline-flex",alignItems:"center",gap:3,paddingRight:6,cursor:"pointer"}}
              onClick={()=>onChange(s.id)}>
              <span className="sub-dot" style={{background:s.color}}/>
              <span>{s.name}</span>
              <button style={btnStyle} onClick={e=>startEdit(s,e)} title={tr("수정","Edit")}>✎</button>
              <button style={{...btnStyle,fontSize:14}} onClick={e=>delSubject(s,e)} title={tr("삭제","Delete")}>×</button>
            </div>
          )
        )}
        <button className="btn gho xs" onClick={()=>setAdding(v=>!v)}>{tr("+ 과목","+ Folder")}</button>
      </div>
      {adding&&(
        <div className="subj-new">
          <input placeholder={tr("과목 이름 (예: 통계학)","Folder name (e.g. Statistics)")} value={newName}
            onChange={e=>setNewName(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter")addSubject();if(e.key==="Escape")setAdding(false);}}
            autoFocus/>
          <button className="btn pri xs" onClick={addSubject}>{tr("추가","Add")}</button>
          <button className="btn gho xs" onClick={()=>setAdding(false)}>{tr("취소","Cancel")}</button>
        </div>
      )}
    </div>
  );
}

/* ── 온보딩 ── */

export { App, SubjectTabs };
