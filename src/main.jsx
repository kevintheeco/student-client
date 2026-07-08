import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { initStorage, loadCFG, initFirebase } from "./core/platform.js";
import { PROXY_URL } from "./core/ai.js";

// A5(ADR-014): 최소 에러 리포팅 — 처리 안 된 예외를 Worker /log로 전송. 메시지·스택 앞부분만(개인정보·학습데이터 없음).
let _errN=0;
function reportError(msg,stack){
  if(!PROXY_URL||++_errN>5)return;   // 세션당 5건 캡 — 에러 루프로 인한 전송 폭주 방지
  try{
    fetch(PROXY_URL+"/log",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({msg:String(msg||"").slice(0,500),stack:String(stack||"").slice(0,1500),url:location.hash.slice(0,100)})
    }).catch(()=>{});
  }catch{/* 리포팅 실패는 무시 */}
}
window.addEventListener("error",e=>reportError(e.message,e.error&&e.error.stack));
window.addEventListener("unhandledrejection",e=>reportError((e.reason&&e.reason.message)||e.reason,e.reason&&e.reason.stack));
import { App } from "./views/AppShell.jsx";
import { AcademyApp } from "./views/Academy.jsx";
import { VizDemo } from "./views/VizDemo.jsx";

// 진입로 3갈래: 기본=범용(무엇이든 넣어 공부) · #student=중고등 수학 학생용 · #academy=학원용
// + 개발용: #vizdemo(벡터 렌더러)·#geodemo(기하 상호작용) — student(/math/) 검사보다 먼저 봐야 함
function route(){
  if(/vizdemo|geodemo/i.test(location.hash))return "vizdemo";
  if(/academy/i.test(location.hash))return "academy";
  if(/student|math/i.test(location.hash))return "student";
  return "general";
}
function Root(){
  const [mode,setMode]=useState(route());
  useEffect(()=>{const f=()=>setMode(route());window.addEventListener("hashchange",f);return ()=>window.removeEventListener("hashchange",f);},[]);
  if(mode==="vizdemo")return <VizDemo/>;
  if(mode==="academy")return <div className="academy-skin"><AcademyApp/></div>;
  return <App key={mode} edition={mode}/>;
}

function boot(){
  loadCFG();initFirebase();
  createRoot(document.getElementById("root")).render(<Root/>);
}
initStorage().then(boot).catch(e=>{console.error("[boot]",e);boot();});
