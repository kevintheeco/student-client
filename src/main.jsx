import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { initStorage, loadCFG, initFirebase } from "./core/platform.js";
import { App } from "./views/AppShell.jsx";
import { AcademyApp } from "./views/Academy.jsx";
import { VizDemo } from "./views/VizDemo.jsx";

// 진입로 4갈래: 기본=범용(무엇이든 넣어 공부) · #student=한국 중고등 수학 학생용 · #us=미국 수학 학생용 · #academy=학원용
// + 개발용: #vizdemo(벡터 렌더러)·#geodemo(기하 상호작용) — student(/math/) 검사보다 먼저 봐야 함
function route(){
  if(/vizdemo|geodemo/i.test(location.hash))return "vizdemo";
  if(/academy/i.test(location.hash))return "academy";
  if(/^#us\b/i.test(location.hash))return "us";
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
