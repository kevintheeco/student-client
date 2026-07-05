import { CFG, ocrModel } from "./platform.js";
import { normErrType, normStage } from "./knowledgeGraph.js";
const MODELS=[
  {id:"claude-sonnet-4-6",label:"Sonnet 4.6 · 추천"},
  {id:"claude-haiku-4-5-20251001",label:"Haiku 4.5 · 가장 저렴"},
  {id:"claude-opus-4-8",label:"Opus 4.8 · 가장 똑똑"},
];
const QMODELS=[
  {id:"claude-haiku-4-5-20251001",label:"Haiku 4.5 · 빠름 (권장)"},
  {id:"claude-sonnet-4-6",label:"Sonnet 4.6 · 정확"},
  {id:"claude-opus-4-8",label:"Opus 4.8 · 최고 품질"},
];

// opts: { cache:bool, maxTok:number, model:string }
async function callGemini(system,userContent,wantJson,opts={},signal){
  if(!CFG.geminiKey){const e=new Error("Gemini API 키가 없어 — 설정에서 추가해줘");e.noFallback=true;throw e;}
  const model=(opts.model||"gemini-2.5-flash");
  const maxTok=opts.maxTok||(wantJson?2048:1024);
  const parts=[];
  if(typeof userContent==="string"){parts.push({text:userContent});}
  else{for(const b of userContent){
    if(b.type==="text")parts.push({text:b.text});
    else if(b.type==="image")parts.push({inline_data:{mime_type:b.source.media_type,data:b.source.data}});
    else if(b.type==="document")parts.push({inline_data:{mime_type:"application/pdf",data:b.source.data}});
  }}
  let contents;
  if(opts.messages){
    contents=opts.messages.map(m=>{
      const c=m.content,ps=[];
      if(typeof c==="string")ps.push({text:c});
      else for(const b of c){
        if(b.type==="text")ps.push({text:b.text});
        else if(b.type==="image")ps.push({inline_data:{mime_type:b.source.media_type,data:b.source.data}});
        else if(b.type==="document")ps.push({inline_data:{mime_type:"application/pdf",data:b.source.data}});
      }
      return{role:m.role==="assistant"?"model":"user",parts:ps};
    });
  }else contents=[{role:"user",parts}];
  const body={
    system_instruction:{parts:[{text:system}]},
    contents,
    generationConfig:{maxOutputTokens:maxTok,temperature:0.3},
  };
  const res=await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${CFG.geminiKey}`,
    {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal}
  );
  if(!res.ok){let m="Gemini "+res.status;try{const j=await res.json();m=j.error?.message||m}catch{}const er=new Error(m);er.status=res.status;throw er;}
  const data=await res.json();
  const text=(data.candidates?.[0]?.content?.parts||[]).map(p=>p.text||"").join("").trim();
  if(!wantJson)return text;
  let clean=text.replace(/```json\s*/gi,"").replace(/```/g,"").trim();
  const s=clean.indexOf("{"),e=clean.lastIndexOf("}");
  if(s===-1)throw new Error("JSON 응답 없음");
  return parseJsonLoose(clean.slice(s,e>s?e+1:clean.length));
}
// 클로드 API 장애 시 폴백할 백업 프록시(Cloudflare Worker). 키는 프록시 서버에만 있음.
// 최초 배포(proxy/) 후 워커 URL을 여기에 채운다. 비어있으면 공용 폴백 비활성(개인키 폴백만 동작).
const PROXY_URL="https://yp-ai-proxy.soomin020114.workers.dev";
// 학원(회사키) 모드: 전용 링크 …/#academy=<코드> 면 활성. 프록시가 그 학원 키로 클로드 호출.
let COMPANY_MODE=false, ACADEMY_CODE="";
try{const _am=(location.hash||"").match(/academy=([A-Za-z0-9_-]+)/i);if(_am){ACADEMY_CODE=_am[1];COMPANY_MODE=true;}}catch{}
const _sleep=ms=>new Promise(r=>setTimeout(r,ms));
function _aiRetriable(e){
  if(!e||e.noFallback||e.name==="AbortError")return false;
  if(e.status===undefined)return true;        // 네트워크 끊김(TypeError 등) → 재시도/폴백 대상
  return [408,429,500,502,503,504,529].includes(e.status);
}
function _geminiFallbackModel(model){
  return (model||"").toLowerCase().includes("haiku")?"gemini-2.5-flash":"gemini-2.5-pro";
}
let _fbToastT;
function _notifyFallback(which){
  try{
    let el=document.getElementById("aiFbToast");
    if(!el){el=document.createElement("div");el.id="aiFbToast";
      el.style.cssText="position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99999;background:rgba(20,20,22,.94);color:#fff;padding:9px 16px;border-radius:20px;font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.35);opacity:0;transition:opacity .3s;pointer-events:none";
      document.body.appendChild(el);}
    el.textContent=which==="gemini"?"⚡ 클로드 지연 — 백업 AI로 이어서 처리 중":"⚡ 백업 AI로 이어서 처리 중";
    el.style.opacity="1";clearTimeout(_fbToastT);_fbToastT=setTimeout(()=>{el.style.opacity="0";},3500);
  }catch{}
}
// 백업 프록시 호출 — 서버가 Gemini→GPT 순으로 처리. 키 노출 없음.
async function callProxy(system,userContent,wantJson,opts={},signal){
  if(!PROXY_URL)throw new Error("백업 프록시 미설정");
  const tier=(opts.model||CFG.model||"").toLowerCase().includes("haiku")?"fast":"smart";
  const messages=opts.messages||[{role:"user",content:userContent}];
  const res=await fetch(PROXY_URL,{
    method:"POST",headers:{"content-type":"application/json"},signal,
    body:JSON.stringify({system,messages,wantJson,maxTok:opts.maxTok,tier}),
  });
  if(!res.ok){let m="Proxy "+res.status;try{const j=await res.json();m=j.error||(j.detail&&j.detail.join("; "))||m;}catch{}const er=new Error(m);er.status=res.status;throw er;}
  const data=await res.json();
  const text=(data.text||"").trim();
  if(opts.onDelta&&!wantJson&&text){try{opts.onDelta(text);}catch{}}
  if(!wantJson)return text;
  let clean=text.replace(/```json\s*/gi,"").replace(/```/g,"").trim();
  const s=clean.indexOf("{"),e=clean.lastIndexOf("}");
  if(s===-1)throw new Error("JSON 응답 없음 — 다시 시도해봐");
  return parseJsonLoose(clean.slice(s,e>s?e+1:clean.length));
}
// 클로드 SSE 스트림을 읽어 글자씩 onDelta로 흘리고 최종 텍스트 반환 (callClaude·callProxyClaude 공용)
async function _readClaudeSSE(res,onDelta){
  const reader=res.body.getReader(),dec=new TextDecoder();let buf="",full="";
  while(true){
    const {done,value}=await reader.read();
    if(done)break;
    buf+=dec.decode(value,{stream:true});
    let nl;
    while((nl=buf.indexOf("\n"))>=0){
      const line=buf.slice(0,nl).trim();buf=buf.slice(nl+1);
      if(!line.startsWith("data:"))continue;
      const pl=line.slice(5).trim();if(pl==="[DONE]")continue;
      let ev;try{ev=JSON.parse(pl);}catch{continue;}
      if(ev.type==="content_block_delta"&&ev.delta&&ev.delta.type==="text_delta"){full+=ev.delta.text;try{onDelta&&onDelta(full);}catch{}}
      else if(ev.type==="error")throw new Error(ev.error?.message||"stream error");
    }
  }
  return full.trim();
}
// 회사키(학원) 메인 경로 — 프록시 /claude로 클로드 호출(스트리밍 유지). 클로드 죽으면 프록시 내부서 제미나이/o3 폴백.
async function callProxyClaude(system,userContent,wantJson,opts={},signal){
  if(!PROXY_URL)throw new Error("프록시 미설정");
  const messages=opts.messages||[{role:"user",content:userContent}];
  const stream=!!opts.onDelta&&!wantJson;
  const res=await fetch(PROXY_URL+"/claude",{
    method:"POST",headers:{"content-type":"application/json"},signal,
    body:JSON.stringify({academyCode:ACADEMY_CODE,system,messages,wantJson,maxTok:opts.maxTok,model:opts.model||CFG.model,stream}),
  });
  if(!res.ok){let m="Proxy "+res.status;try{const j=await res.json();m=j.error||(j.detail&&j.detail.join("; "))||m;}catch{}const er=new Error(m);er.status=res.status;throw er;}
  const ct=res.headers.get("content-type")||"";
  if(stream&&ct.includes("text/event-stream")&&res.body&&res.body.getReader) return await _readClaudeSSE(res,opts.onDelta);
  // JSON 응답(비스트림 또는 프록시 내부 폴백 결과)
  const data=await res.json();
  const text=(data.text||"").trim();
  if(opts.onDelta&&!wantJson&&text){try{opts.onDelta(text);}catch{}}
  if(!wantJson)return text;
  let clean=text.replace(/```json\s*/gi,"").replace(/```/g,"").trim();
  const s=clean.indexOf("{"),e=clean.lastIndexOf("}");
  if(s===-1)throw new Error("JSON 응답 없음 — 다시 시도해봐");
  return parseJsonLoose(clean.slice(s,e>s?e+1:clean.length));
}
async function callAI(system,userContent,wantJson,opts={},signal){
  if(opts.lang==="en")system=
    "WRITE YOUR ENTIRE RESPONSE IN ENGLISH. Even though the instructions below and the study material may be in Korean, every sentence you output — questions, feedback, explanations, hints, model answers, table cells, graph labels — MUST be in natural English. Translate ideas from Korean source material into English; never reply in Korean prose. The ONLY exception: if a strict output format below lists fixed Korean tokens for the fields QTYPE / GAP_TYPE / DEPTH / VERDICT, keep those exact tokens (recall/understand/apply; 개념누락/이해얕음/핵심비껴감/표현부족/갭없음; 암기 수준/이해 수준/설명가능 수준/응용가능 수준; correct/partial/incorrect). Everything else = English.\n\n"
    +system
    +"\n\n[REMINDER: Respond in ENGLISH only. Do not drift back to Korean even if the source is Korean.]";
  const m=opts.model||CFG.model;
  const primaryGemini=m.startsWith("gemini");
  const runPrimary=()=>COMPANY_MODE
    ?callProxyClaude(system,userContent,wantJson,opts,signal)   // 학원(회사키): 프록시가 클로드+내부 백업 처리
    :primaryGemini
      ?callGemini(system,userContent,wantJson,opts,signal)
      :callClaude(system,userContent,wantJson,opts,signal);
  // 1) 1차 시도 + 같은 API 자동 재시도 (클로드 과부하 529 등은 보통 몇 초 뒤 풀림)
  const delays=[0,800,2200];
  let lastErr;
  for(let i=0;i<delays.length;i++){
    if(signal&&signal.aborted)throw new DOMException("aborted","AbortError");
    if(delays[i])await _sleep(delays[i]);
    try{return await runPrimary();}
    catch(e){lastErr=e;if(!_aiRetriable(e))break;}
  }
  // 2) 그래도 실패 → 다른 경로로 자동 폴백 (순서대로 시도, 먼저 성공하는 걸 사용)
  if(!_aiRetriable(lastErr))throw lastErr;
  if(COMPANY_MODE)throw lastErr;   // 학원: 프록시가 이미 클로드→제미나이→o3 다 시도함(프록시 자체 불통이면 끝)
  const fallbacks=[];
  if(primaryGemini){
    // Gemini 장애 → 클로드(개인키 있으면) → 공용 프록시
    if(CFG.key)fallbacks.push(()=>callClaude(system,userContent,wantJson,{...opts,model:CFG.model},signal));
  }else{
    // 클로드 장애 → 개인 Gemini 키(있으면) → 공용 프록시(Gemini→GPT)
    if(CFG.geminiKey)fallbacks.push(()=>callGemini(system,userContent,wantJson,{...opts,model:_geminiFallbackModel(m)},signal));
  }
  if(PROXY_URL)fallbacks.push(()=>callProxy(system,userContent,wantJson,opts,signal));
  for(const fb of fallbacks){
    if(signal&&signal.aborted)throw new DOMException("aborted","AbortError");
    try{
      _notifyFallback("backup");
      const r=await fb();
      if(opts.onDelta&&typeof r==="string"){try{opts.onDelta(r);}catch{}}  // 폴백은 스트리밍 없음 → 한 번에 전달
      return r;
    }catch(e2){ if(e2&&e2.name==="AbortError")throw e2; /* 다음 폴백 시도 */ }
  }
  throw lastErr;   // 모든 폴백 실패 → 원래 에러 표시
}
function fixJson(str){
  let out="",inStr=false,i=0;
  while(i<str.length){
    const c=str[i];
    if(!inStr){out+=c;if(c==='"')inStr=true;i++;}
    else if(c==='\\'){
      const n=str[i+1];
      if(n==='"'||n==='\\'||n==='/'){out+=c+n;i+=2;}
      else if(n==='u'&&/[0-9a-fA-F]{4}/.test(str.slice(i+2,i+6))){out+=str.slice(i,i+6);i+=6;}
      else{out+='\\\\';i++;}
    }
    else if(c==='"'){out+=c;inStr=false;i++;}
    else if(c==='\n'){out+='\\n';i++;}
    else if(c==='\r'){out+='\\r';i++;}
    else{out+=c;i++;}
  }
  return out;
}
// 잘린(truncated) JSON 복구: 문자열/괄호 상태를 1회 스캔해 닫고, 완성된 앞쪽 객체들은 보존
function repairJson(s){
  let inStr=false,esc=false;const stack=[];
  for(let i=0;i<s.length;i++){
    const c=s[i];
    if(inStr){if(esc)esc=false;else if(c==='\\')esc=true;else if(c==='"')inStr=false;continue;}
    if(c==='"'){inStr=true;continue;}
    if(c==='{'||c==='[')stack.push(c==='{'?'}':']');
    else if(c==='}'||c===']')stack.pop();
  }
  let out=s;
  if(inStr)out+='"';                 // 끝이 문자열 안이면 닫기
  out=out.replace(/\s+$/,'');
  out=out.replace(/,$/,'');           // 끝의 매달린 콤마 제거
  if(/:$/.test(out))out+='null';      // 값 없는 콜론은 null로
  for(let i=stack.length-1;i>=0;i--)out+=stack[i];  // 열린 괄호 역순으로 닫기
  return out;
}
// 정상 JSON은 그대로 파싱(바이트 동일), 실패 시에만 복구 시도
function parseJsonLoose(slice){
  try{return JSON.parse(fixJson(slice));}
  catch(_){return JSON.parse(fixJson(repairJson(slice)));}
}
// FACTORS 줄 파싱: "개념=2 계산=1 전략=- 추론=0" → {개념:2,...} (- 는 미평가로 제외)
function parseFactorsLine(s){
  if(!s)return null;
  const out={};let found=false;
  const re=/(개념|계산|전략|추론|식|논리)\s*[=:]\s*([0-2])/g;let m;
  while((m=re.exec(s)))if(out[m[1]]===undefined){out[m[1]]=Number(m[2]);found=true;}
  return found?out:null;
}
// Parse gap-analysis grading response
function parseGrading(txt){
  const KEYS=['ESSENCE','GOT_IT','GAP','GAP_TYPE','DEPTH','NEXT','FACTORS','ERROR','STAGE','MISC','VERDICT','ANSWER'];
  const vals={};
  for(let i=0;i<KEYS.length;i++){
    const key=KEYS[i];
    const sm=new RegExp('(?:^|\\n)'+key+'\\s*:[\\t ]*','i').exec(txt);
    if(!sm)continue;
    const from=sm.index+sm[0].length;
    let to=txt.length;
    // 경계: 뒤에 오는 '아무' 키든 가장 가까운 것 (모델이 일부 키를 빼먹어도 값이 안 섞임)
    if(i<KEYS.length-1){
      const em=new RegExp('\\n(?:'+KEYS.slice(i+1).join('|')+')\\s*:','i').exec(txt.slice(from));
      if(em)to=from+em.index;
    }
    vals[key]=txt.slice(from,to).trim();
  }
  const v=(vals.VERDICT||'').toLowerCase().replace(/[^a-z]/g,'');
  const DEPTH_LEVELS=['암기 수준','이해 수준','설명가능 수준','응용가능 수준'];
  const rawDepth=vals.DEPTH||'';
  const depth=DEPTH_LEVELS.find(l=>rawDepth.includes(l.split(' ')[0]))||rawDepth;
  const GAP_TYPES=['개념누락','이해얕음','핵심비껴감','표현부족','갭없음'];
  const rawGapType=vals.GAP_TYPE||'';
  const gap_type=GAP_TYPES.find(t=>rawGapType.includes(t))||rawGapType;
  return{
    verdict:['correct','partial','incorrect'].includes(v)?v:'partial',
    essence:vals.ESSENCE||'',
    got_it:vals.GOT_IT||'',
    gap:vals.GAP||'',
    gap_type,
    depth,
    next:vals.NEXT||'',
    factors:parseFactorsLine(vals.FACTORS),
    err:normErrType(vals.ERROR),
    stage:normStage(vals.STAGE),
    misc:(vals.MISC&&!/^-/.test(vals.MISC.trim()))?vals.MISC.trim():'',
    model_answer:vals.ANSWER||'',
    feedback:vals.GOT_IT||'',
  };
}
// Parse derivation plan
function parseDerivePlan(txt){
  const totalSteps=Math.max(2,Math.min(8,parseInt((txt.match(/STEPS\s*:\s*(\d+)/i)||[])[1])||4));
  const start=((txt.match(/START\s*:\s*([^\n]+)/i)||[])[1]||'첫 단계를 써봐.').trim();
  const hints=[];
  for(let i=1;i<=totalSteps;i++){
    hints.push(((txt.match(new RegExp('HINT'+i+'\\s*:\\s*([^\\n]+)','i'))||[])[1]||'').trim());
  }
  return{totalSteps,startHint:start,hints};
}
// Parse derivation step check
function parseDeriveCheck(txt){
  function field(key){
    const sm=new RegExp('(?:^|\\n)'+key+'\\s*:[\\t ]*','i').exec(txt);
    if(!sm)return'';
    const from=sm.index+sm[0].length;
    const em=/\n[A-Z]+\s*:/.exec(txt.slice(from));
    return txt.slice(from,em?from+em.index:txt.length).trim();
  }
  return{correct:/yes/i.test(field('CORRECT')),done:/yes/i.test(field('DONE')),
    feedback:field('FEEDBACK'),nextPrompt:field('NEXT')||'다음 단계를 써봐.'};
}
// Parse question response in plain-text structured format
function parseOcrCheck(txt){
  const tm=/TEXT\s*:\s*([\s\S]*?)(?=\nUNCLEAR\s*:|$)/i.exec(txt);
  const um=/UNCLEAR\s*:\s*([\s\S]+)/i.exec(txt);
  const text=(tm?.[1]||"").trim();
  const us=(um?.[1]||"").trim();
  const unclear=(!us||/없음/i.test(us))?[]:
    us.split("|").map(s=>{const p=s.trim().split(",").map(Number);return p.length===4&&p.every(n=>!isNaN(n))?{x:p[0],y:p[1],w:p[2],h:p[3]}:null;}).filter(Boolean);
  return{text,unclear};
}
function parseQuestion(txt){
  const KEYS=['QTYPE','QUESTION','POINTS'];
  const vals={};
  for(let i=0;i<KEYS.length;i++){
    const key=KEYS[i],next=KEYS[i+1];
    const sm=new RegExp('(?:^|\\n)'+key+'\\s*:[\\t ]*','i').exec(txt);
    if(!sm)continue;
    const from=sm.index+sm[0].length;
    let to=txt.length;
    if(next){const em=new RegExp('\\n'+next+'\\s*:','i').exec(txt.slice(from));if(em)to=from+em.index;}
    vals[key]=txt.slice(from,to).trim();
  }
  const rawQt=(vals.QTYPE||'').toLowerCase();
  const qtype=['recall','understand','apply'].find(t=>rawQt.includes(t))||'understand';
  return{
    qtype,
    question:vals.QUESTION||'',
    key_points:(vals.POINTS||'').split('|').map(s=>s.trim()).filter(Boolean),
  };
}
async function callClaude(system,userContent,wantJson,opts={},signal){
  if(!CFG.key){const e=new Error("NO_KEY");e.noFallback=true;throw e;}
  const maxTok=opts.maxTok||(wantJson?2048:1024);
  const hdrs={"content-type":"application/json","x-api-key":CFG.key,
    "anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"};
  if(opts.cache)hdrs["anthropic-beta"]="prompt-caching-2024-07-31";
  const sysPay=opts.cache
    ?[{type:"text",text:system,cache_control:{type:"ephemeral"}}]
    :system;
  const wantStream=!!opts.onDelta&&!wantJson;   // 스트리밍: 글자씩 onDelta로 흘려보냄(정확도 동일, 체감속도 ↑)
  const res=await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",headers:hdrs,signal,
    body:JSON.stringify({model:opts.model||CFG.model,max_tokens:maxTok,system:sysPay,
      messages:opts.messages||[{role:"user",content:userContent}],...(wantStream?{stream:true}:{})}),
  });
  if(!res.ok){let m="API "+res.status;try{const j=await res.json();if(j.error?.message)m=j.error.message}catch{}const er=new Error(m);er.status=res.status;throw er;}
  if(wantStream&&res.body&&res.body.getReader) return await _readClaudeSSE(res,opts.onDelta);
  const data=await res.json();
  const text=(data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n").trim();
  if(!wantJson)return text;
  let clean=text.replace(/```json\s*/gi,"").replace(/```/g,"").trim();
  const s=clean.indexOf("{"),e=clean.lastIndexOf("}");
  if(s===-1)throw new Error("JSON 응답 없음 — 다시 시도해봐");
  return parseJsonLoose(clean.slice(s,e>s?e+1:clean.length));   // 잘린 응답(닫는 } 없음/꼬리 잘림)도 복구
}

async function transcribeFile(base64,mediaType,kind){
  const sys="너는 한국어 손글씨 OCR 전문가야. S펜·디지털 펜으로 쓴 한국어 학습 답안·노트 인식이 전문이야. 규칙: ①획이 불명확해도 문맥·형태로 최선 추론, 절대 포기하지 않음 ②수식은 LaTeX($...$) 형식 ③한자·영어 약어·그리스 문자도 그대로 출력 ④설명·주석 없이 인식 텍스트만 출력";
  const hint=kind==="answer"
    ?"이건 학습자가 S펜으로 쓴 한국어 답안이야. 수식·한자·영어 약어가 섞일 수 있어. 빠짐없이 읽어줘."
    :"이건 학습자의 한국어 공부 노트야. 제목·소제목·수식·목록이 섞여 있을 수 있어. 빠짐없이 읽어줘.";
  const fileBlock={type:"image",source:{type:"base64",media_type:mediaType||"image/png",data:base64}};
  return await callAI(sys,
    [fileBlock,{type:"text",text:hint+" 애매한 글자는 가장 가능성 높은 글자로 판단해. 텍스트만 출력."}],
    false,{maxTok:1500,model:ocrModel()});
}

// PDF는 텍스트 변환 없이 직접 분석 — summary+concepts 한 번에 추출
async function processPdf(base64){
  try{
    const r=await callAI(
      "너는 학습 자료 분석 전문가야. PDF를 읽고 학습에 필요한 핵심 내용을 추출해.",
      [{type:"document",source:{type:"base64",media_type:"application/pdf",data:base64}},
       {type:"text",text:"이 PDF가 무엇을 가르치려는지 핵심 주제와 목적을 먼저 파악해. 그런 다음 그 목적에 맞는 핵심 개념을 추출해. 단순히 등장하는 단어가 아니라, 이 자료의 학습 목표를 대표하는 개념이어야 해. JSON만: {\"summary\":\"핵심 개념·공식·예시 압축 요약 (3000자 이내, 수식은 LaTeX 형식 그대로 유지)\",\"concepts\":[\"이 자료의 핵심 학습 목표에 해당하는 개념 10~20개 (짧은 명사구, 자료의 주제를 반영\"]}"}],
      true,{maxTok:3000,model:ocrModel()});
    return r;
  }catch(e){
    console.warn("[processPdf] 실패:",e.message);
    return null;
  }
}

// 기출/족보에서 실제 출제 문제들을 추출 (개념 태그 + 정답이 있으면 함께)
async function extractExamQuestions(material,conceptNames){
  try{
    const r=await callAI(
      "너는 기출문제·족보 분석 전문가야. 자료에서 실제로 출제된 문제들을 빠짐없이 뽑아내. 각 문제마다:\n"+
      "- question: 문제 본문 (보기·조건 포함, 수식은 LaTeX $...$ 형식)\n"+
      "- concept: 아래 [개념 목록] 중 이 문제가 가장 관련된 것 하나를 그대로 골라 적기\n"+
      "- answer: 자료에 정답·해설이 있으면 그대로 정리해 적고, 없으면 빈 문자열\n"+
      "JSON만 출력: {\"questions\":[{\"question\":\"...\",\"concept\":\"...\",\"answer\":\"...\"}]}",
      "[개념 목록]: "+conceptNames.join(", ")+"\n\n[자료]:\n"+material.slice(0,14000),
      true,{maxTok:3500});
    return Array.isArray(r.questions)?r.questions.filter(q=>q&&q.question):[];
  }catch(e){console.warn("[extractExamQuestions]",e.message);return[];}
}

// 기출DB 입력 도구: 시험지·문제집 PDF/이미지에서 문제를 구조화 추출 (사람 검수 전 초안)
async function extractBankItems(fileBlocks,unitNames,srcHint){
  const r=await callAI(
    "너는 수학 기출문제 디지털화 전문가야. 시험지·문제집 자료에서 출제 문제를 빠짐없이 구조화해 추출해. 규칙:\n"+
    "①수식은 반드시 LaTeX($...$) ②객관식은 choices에 보기 전부(①②③④⑤ 기호 포함) ③answer·explanation은 자료에 있는 것만 그대로 옮기고 없으면 빈 문자열 — 절대 지어내지 마 ④unit은 [단원 목록]에서 가장 맞는 것 하나를 글자 그대로 복사 ⑤그림·도형 없이는 풀 수 없는 문제는 hasFigure:true",
    [...fileBlocks,{type:"text",text:
      "[단원 목록]: "+unitNames.join(", ")+"\n"+(srcHint?"[출처]: "+srcHint+"\n":"")+
      'JSON만 출력: {"items":[{"number":"문항번호(없으면 빈 문자열)","question":"...","choices":[],"qtype":"mc|short|essay","answer":"...","explanation":"...","unit":"...","points":0,"difficulty":"easy|medium|hard","hasFigure":false}]}'}],
    true,{maxTok:8000});
  return Array.isArray(r?.items)?r.items.filter(q=>q&&q.question):[];
}

/* ── 책(교재) 모드: 긴 PDF를 페이지로 쪼개 흡수 → 대/중/소단원 개념 트리 ── */
// PDF base64를 per쪽씩 잘라 여러 PDF로 (pdf-lib). 짧거나 실패하면 원본 1개.
async function splitPdfPages(b64,per){
  per=per||40;
  try{
    if(!window.PDFLib)return[b64];
    const src=await PDFLib.PDFDocument.load(b64);
    const n=src.getPageCount();
    if(n<=per)return[{b64,from:1,to:n}];
    const chunks=[];
    for(let s=0;s<n;s+=per){
      const sub=await PDFLib.PDFDocument.create();
      const idxs=[];for(let i=s;i<Math.min(s+per,n);i++)idxs.push(i);
      const pages=await sub.copyPages(src,idxs);
      pages.forEach(p=>sub.addPage(p));
      chunks.push({b64:await sub.saveAsBase64(),from:s+1,to:Math.min(s+per,n)});
    }
    return chunks;
  }catch(e){console.warn("[splitPdf]",e);return[b64];}
}
// 한 chunk(PDF 일부)에서 대>중>소단원(개념) + 개념별 과외용 핵심내용(src) 추출
async function analyzeBookChunk(b64,label,lang){
  const r=await callAI(
    "너는 대학 전공 교재를 분석해 '목차 트리'로 정확히 정리하는 전문가다. 주어진 PDF 일부를 읽고 내용을 대단원>중단원>개념(소단원) 3계층으로 정리한다.\n"+
    "★ 정확도 규칙:\n"+
    "- u1(대단원)·u2(중단원)은 교재가 실제로 쓰는 제목·번호를 그대로 따라라(예: '제3장 극한', '3.2 연속함수'). 번호가 있으면 번호도 포함. 네가 새 분류를 지어내지 마라.\n"+
    "- 교재에 나온 순서를 유지하라(앞에서 뒤로).\n"+
    "- 개념(소단원)은 '하나의 가르칠 단위'(정의·정리·공식·기법 하나)로 잘라라. 너무 뭉뚱그려 묶지도, 한 문장씩 잘게 쪼개지도 마라.\n"+
    "- 표지·목차·머리말·참고문헌·연습문제답안처럼 가르칠 내용이 없는 페이지는 건너뛰고 units에 넣지 마라.\n"+
    "- 한 중단원이 이 chunk 경계에서 잘렸으면, 이 chunk에 실제로 있는 내용만 담아라(다음 chunk와 자연히 이어진다).\n"+
    "- src는 그 개념을 1:1 과외할 수 있을 만큼의 핵심(정의·직관·핵심 공식·대표 예시)을 교재 내용 그대로 압축해라(수식은 LaTeX $...$). 교재에 없는 건 지어내지 마라.",
    [{type:"document",source:{type:"base64",media_type:"application/pdf",data:b64}},
     {type:"text",text:"이 부분("+label+")을 목차 트리로 정리해. 실제 교재 제목·순서·번호를 따라. JSON만 출력(코드블록 없이): {\"units\":[{\"u1\":\"대단원(장) 제목\",\"u2\":\"중단원(절) 제목\",\"concepts\":[{\"name\":\"개념(소단원) 이름\",\"src\":\"이 개념 과외용 핵심 내용 300~700자, LaTeX 유지\"}]}]}"}],
    true,{maxTok:8000,model:ocrModel(),lang});
  return (r&&Array.isArray(r.units))?r.units:[];
}
// 책 전체 흡수: 분할 → chunk별 분석 → 트리 합쳐 평탄화된 concepts[] (각 개념에 u1/u2/src)
async function ingestBook(b64,onProgress,lang){
  const chunks=await splitPdfPages(b64,40);
  const allUnits=[];
  for(let i=0;i<chunks.length;i++){
    const ck=chunks[i];
    if(onProgress)onProgress(i,chunks.length);
    const label=ck&&ck.from?("p."+ck.from+"–"+ck.to):"전체";
    try{allUnits.push(...await analyzeBookChunk(ck.b64||ck,label,lang));}
    catch(e){console.warn("[ingestBook chunk]",i,e);}
  }
  if(onProgress)onProgress(chunks.length,chunks.length);
  const concepts=[];
  allUnits.forEach(u=>{
    const u1=((u.u1||"")+"").slice(0,60)||"본문";
    const u2=((u.u2||"")+"").slice(0,60);
    (Array.isArray(u.concepts)?u.concepts:[]).forEach(c=>{
      const name=((c&&c.name)||"").toString().slice(0,80);if(!name)return;
      concepts.push({id:uid(),name,u1,u2,src:((c.src||"")+"").slice(0,1200),box:1,dueAt:0,reps:0,lapses:0});
    });
  });
  return concepts;
}

/* 파일 → base64 */
const toB64=(file)=>new Promise((res,rej)=>{
  const r=new FileReader();r.onload=()=>res(String(r.result).split(",")[1]);r.onerror=rej;r.readAsDataURL(file);
});


let _uidSeq=0;
const uid=()=>Date.now().toString(36)+(_uidSeq++).toString(36).padStart(3,'0')+Math.random().toString(36).slice(2,5);

export { MODELS, QMODELS, callGemini, PROXY_URL, COMPANY_MODE, ACADEMY_CODE, _sleep, _aiRetriable, _geminiFallbackModel, _fbToastT, _notifyFallback, callProxy, _readClaudeSSE, callProxyClaude, callAI, fixJson, repairJson, parseJsonLoose, parseFactorsLine, parseGrading, parseDerivePlan, parseDeriveCheck, parseOcrCheck, parseQuestion, callClaude, transcribeFile, processPdf, extractExamQuestions, extractBankItems, splitPdfPages, analyzeBookChunk, ingestBook, toB64, _uidSeq, uid };
