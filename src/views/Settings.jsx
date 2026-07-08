import { CFG, LS, STORAGE_CAP, _idb, clearLocalStudyData, exportBackup, formatSize, getStorageSize, hasCloudConsent, importBackup, setCloudConsent, tr } from "../core/platform.js";
import { COMPANY_MODE, MODELS, QMODELS, callClaude, callGemini } from "../core/ai.js";
import { Prof } from "../ui/common.jsx";
import React from "react";
const { useState, useEffect, useRef, useCallback } = React;

function Onboard({onDone}){
  return(
    <div className="card panel">
      <div style={{textAlign:"center"}}><Prof size={84}/></div>
      <h2 className="jua" style={{textAlign:"center",margin:"4px 0 0",fontSize:24}}>{tr("안녕! 나 니가 교수야 👋","Hi! I'm your Prof 👋")}</h2>
      <p className="muted" style={{textAlign:"center",margin:0,fontSize:13.5,lineHeight:1.7}}>
        {tr("시작하려면 네 Anthropic API 키가 필요해. 공부한 걸 넣어주면 문제 내고 채점해줄게.","To start you'll need your Anthropic API key. Add what you studied and I'll quiz and grade you.")}
      </p>
      <KeyForm onSaved={onDone} cta={tr("시작하기","Get started")}/>
    </div>
  );
}
function Settings({onDone}){
  const [storSize,setStorSize]=useState(()=>getStorageSize());
  const MAX=STORAGE_CAP();
  const pct=Math.min(100,Math.round(storSize/MAX*100));
  const barColor=pct>=90?"var(--rose)":pct>=70?"var(--gold)":"var(--mint)";
  const fileRef=useRef(null);
  const [backupMsg,setBackupMsg]=useState("");
  const [cloudOn,setCloudOn]=useState(()=>hasCloudConsent());
  const [privacyMsg,setPrivacyMsg]=useState("");
  function doExport(){try{exportBackup();setBackupMsg(tr("✓ 백업 파일을 내려받았어. 안전한 곳에 보관해줘!","✓ Backup file downloaded. Keep it somewhere safe!"));}catch(e){setBackupMsg(tr("내보내기 실패: ","Export failed: ")+e.message);}}
  async function doImport(e){
    const f=e.target.files&&e.target.files[0];if(!f)return;
    if(!confirm(tr("백업을 불러오면 같은 이름의 현재 자료에 덮어써져.\n계속할까?","Importing will overwrite current data with the same names.\nContinue?"))){e.target.value="";return;}
    try{const n=await importBackup(f);setBackupMsg(tr("✓ 복원 완료 ("+n+"개 항목). 새로고침할게…","✓ Restored ("+n+" items). Reloading…"));setTimeout(()=>location.reload(),900);}
    catch(err){setBackupMsg(tr("복원 실패: ","Restore failed: ")+err.message);}
    e.target.value="";
  }
  function toggleCloud(on){
    setCloudConsent(on);setCloudOn(on);
    setPrivacyMsg(on
      ?tr("클라우드 동기화를 켰어. 다음 로그인/저장부터 자료와 학습 신호가 내 계정에 동기화돼.","Cloud sync is on. From the next sign-in/save, study data syncs to your account.")
      :tr("클라우드 동기화를 껐어. 새 변경사항은 이 기기에만 저장돼.","Cloud sync is off. New changes stay on this device."));
  }
  function wipeLocal(){
    if(!confirm(tr("이 기기의 자료·학습기록·닉네임·학원 연동 설정을 삭제할까?\nAPI 키/모델 설정은 남겨둘게. 되돌릴 수 없어.","Delete this device's materials, progress, nickname, and academy link?\nAPI keys/model settings stay. This cannot be undone.")))return;
    const n=clearLocalStudyData({keepKeys:true});
    setPrivacyMsg(tr("삭제 완료: ","Deleted ")+n+tr("개 항목. 새로고침할게…"," item(s). Reloading…"));
    setTimeout(()=>location.reload(),900);
  }
  return(
    <div className="card panel">
      <div className="eyebrow">{tr("설정","Settings")}</div>
      <div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:12.5,color:"var(--sub)",marginBottom:6}}>
          <span>{tr("저장 공간 ","Storage ")}{_idb?tr("(대용량 모드)","(large mode)"):tr("(기본 모드)","(basic mode)")}</span>
          <span style={{fontWeight:700,color:pct>=70?barColor:"var(--sub)"}}>{formatSize(storSize)} / {formatSize(MAX)} ({pct}%)</span>
        </div>
        <div className="bar"><i style={{width:pct+"%",background:barColor}}/></div>
        {pct>=80&&<p className="err" style={{fontSize:12.5,marginTop:8}}>{tr("⚠️ 저장 공간이 부족해. 오래된 자료를 삭제해줘.","⚠️ Storage is almost full. Delete old materials.")}</p>}
      </div>
      <div style={{borderTop:"1px solid var(--line)",paddingTop:14}}>
        <div style={{fontSize:12.5,color:"var(--sub)",marginBottom:8}}>🔐 {tr("개인정보·동기화","Privacy & sync")}</div>
        <label style={{display:"flex",gap:10,alignItems:"flex-start",padding:"10px 12px",border:"1px solid var(--line)",borderRadius:12,background:cloudOn?"#F0FDF4":"#FBFAFF",marginBottom:8,cursor:"pointer"}}>
          <input type="checkbox" checked={cloudOn} onChange={e=>toggleCloud(e.target.checked)} style={{marginTop:3,accentColor:"var(--pri)"}}/>
          <span style={{fontSize:12.5,lineHeight:1.6}}>
            <b>{tr("내 계정으로 클라우드 동기화 허용","Allow cloud sync to my account")}</b><br/>
            {tr("끄면 자료와 학습기록은 이 기기 브라우저에만 남아. 켜도 API 키·학원 코드·닉네임·시험 손글씨 이미지는 동기화하지 않아.",
               "When off, materials and progress stay in this browser. Even when on, API keys, academy code, nickname, and exam handwriting images are not synced.")}
          </span>
        </label>
        <div className="warn" style={{fontSize:12.5,lineHeight:1.6}}>
          {tr("AI 채점/요약을 위해 자료·답안 텍스트 일부가 선택한 AI 제공자 또는 학원 프록시로 전송될 수 있어. 이메일·전화번호·주민번호·API 키처럼 명백한 식별자는 자동 마스킹해.",
             "For AI grading/summaries, parts of materials/answers may be sent to your AI provider or organization proxy. Emails, phone numbers, resident IDs, and API keys are redacted automatically.")}
        </div>
        <button className="btn gho sm" onClick={wipeLocal} style={{marginTop:8,color:"#B91C1C"}}>{tr("이 기기 학습 데이터 삭제","Delete local study data")}</button>
        {privacyMsg&&<p style={{fontSize:12.5,marginTop:8,color:privacyMsg.includes("완료")||privacyMsg.includes("Deleted")?"var(--mint)":"var(--sub)"}}>{privacyMsg}</p>}
      </div>
      <div style={{borderTop:"1px solid var(--line)",paddingTop:14}}>
        <div style={{fontSize:12.5,color:"var(--sub)",marginBottom:8}}>{tr("💾 데이터 백업 ","💾 Data backup ")}<span style={{fontSize:11}}>{tr("(자료·학습기록을 파일로 저장 / 복원. API 키는 제외)","(save/restore data & progress to a file. API keys excluded)")}</span></div>
        <div className="row">
          <button className="btn gho sm" onClick={doExport}>{tr("⬇️ 내보내기","⬇️ Export")}</button>
          <button className="btn gho sm" onClick={()=>fileRef.current&&fileRef.current.click()}>{tr("⬆️ 불러오기","⬆️ Import")}</button>
          <input ref={fileRef} type="file" accept="application/json,.json" style={{display:"none"}} onChange={doImport}/>
        </div>
        {backupMsg&&<p style={{fontSize:12.5,marginTop:8,color:backupMsg.startsWith("✓")?"var(--mint)":"var(--rose)"}}>{backupMsg}</p>}
      </div>
      <KeyForm onSaved={onDone} cta={tr("저장","Save")} showCancel onCancel={onDone}/>
    </div>
  );
}
function KeyForm({onSaved,cta,showCancel,onCancel}){
  const [key,setKey]=useState(CFG.key);
  const [geminiKey,setGeminiKey]=useState(CFG.geminiKey);
  const [model,setModel]=useState(CFG.model);
  const [qmodel,setQmodel]=useState(CFG.qmodel);
  const [lang,setLang]=useState(CFG.lang||"ko");
  const [testing,setTesting]=useState(false);
  const [err,setErr]=useState("");
  async function save(){
    if(COMPANY_MODE){   // 회사가 키·모델 제공 → 사용자는 언어만 저장하면 됨(키 입력 불필요)
      CFG.lang=lang;LS.set("ng:lang",CFG.lang);onSaved();return;
    }
    const hasA=key.trim().length>0,hasG=geminiKey.trim().length>0;
    if(!hasA&&!hasG){setErr(tr("최소 하나의 API 키를 입력해줘.","Enter at least one API key."));return;}
    setTesting(true);setErr("");
    CFG.key=key.trim();CFG.model=model;CFG.qmodel=qmodel;CFG.geminiKey=geminiKey.trim();CFG.lang=lang;
    try{
      if(hasA)await callClaude("ping","'ok'라고만 답해.",false);
      else await callGemini("ping","'ok'라고만 답해.",false,{model:"gemini-2.5-flash"});
      LS.set("ng:key",CFG.key);LS.set("ng:model",CFG.model);LS.set("ng:qmodel",CFG.qmodel);LS.set("ng:geminiKey",CFG.geminiKey);LS.set("ng:lang",CFG.lang);
      setTesting(false);onSaved();
    }catch(e){setTesting(false);setErr(tr("연결 실패: ","Connection failed: ")+e.message);}
  }
  return(
    <>
      {COMPANY_MODE
        ? <div className="warn">🎓 {tr("AI는 회사가 제공해요. 따로 키를 넣지 않아도 바로 쓸 수 있어요.","Your AI is provided by your organization — no API key needed.")}</div>
        : <>
      <div className="selectrow"><label>{tr("Anthropic API 키","Anthropic API key")}</label>
        <input className="field" type="password" placeholder="sk-ant-..." value={key}
          onChange={e=>setKey(e.target.value)} autoComplete="off"/></div>
      <div className="selectrow"><label>{tr("Google Gemini API 키","Google Gemini API key")} <span className="muted" style={{fontWeight:400}}>{tr("(선택 · 무료 티어 있음)","(optional · free tier)")}</span></label>
        <input className="field" type="password" placeholder="AIzaSy..." value={geminiKey}
          onChange={e=>setGeminiKey(e.target.value)} autoComplete="off"/></div>
      <p className="hint" style={{marginTop:-6}}>{tr("Gemini 무료: 분당 15회·일 1500회.","Gemini free: 15/min · 1500/day.")}
        <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">{tr(" 키 발급 →"," Get a key →")}</a></p>
      <div className="selectrow"><label>{tr("채점·해설 모델","Grading & explanation model")}</label>
        <select className="field" value={model} onChange={e=>setModel(e.target.value)}>
          {MODELS.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}
        </select></div>
      <div className="selectrow"><label>{tr("문제 생성 모델","Question generation model")}</label>
        <select className="field" value={qmodel} onChange={e=>setQmodel(e.target.value)}>
          {QMODELS.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}
        </select></div>
        </>}
      <div className="selectrow"><label>{tr("🌐 공부 언어","🌐 Study language")} <span className="muted" style={{fontWeight:400}}>{tr("(문제·피드백·설명 언어 + 앱 화면)","(questions, feedback & the whole app)")}</span></label>
        <select className="field" value={lang} onChange={e=>setLang(e.target.value)}>
          <option value="ko">🇰🇷 한국어</option>
          <option value="en">🇬🇧 English</option>
        </select></div>
      {!COMPANY_MODE&&<div className="warn">{tr("키는 ","Keys are stored ")}<b>{tr("이 기기 브라우저에만","only in this browser")}</b>{tr(" 저장돼.",".")}
        Anthropic: <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a></div>}
      {err&&<div className="err">{err}</div>}
      <div className="row">
        <button className="btn pri" onClick={save} disabled={testing}>{testing?tr("연결 확인 중…","Checking…"):cta}</button>
        {showCancel&&<button className="btn gho" onClick={onCancel} disabled={testing}>{tr("취소","Cancel")}</button>}
      </div>
    </>
  );
}

/* ── 홈 ── */

export { Onboard, Settings, KeyForm };
