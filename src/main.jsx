import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { initStorage, loadCFG, initFirebase } from "./core/platform.js";
import { App } from "./views/AppShell.jsx";
import { AcademyApp } from "./views/Academy.jsx";

// 진입로 3갈래: 기본=범용(무엇이든 넣어 공부) · #student=중고등 수학 학생용 · #academy=학원용
function route(){
  if(/academy/i.test(location.hash))return "academy";
  if(/student|math/i.test(location.hash))return "student";
  return "general";
}
function Root(){
  const [mode,setMode]=useState(route());
  useEffect(()=>{const f=()=>setMode(route());window.addEventListener("hashchange",f);return ()=>window.removeEventListener("hashchange",f);},[]);
  if(mode==="academy")return <div className="academy-skin"><AcademyApp/></div>;
  return <App key={mode} edition={mode}/>;
}

function boot(){
  loadCFG();initFirebase();
  createRoot(document.getElementById("root")).render(<Root/>);
}
initStorage().then(boot).catch(e=>{console.error("[boot]",e);boot();});
