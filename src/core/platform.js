/* ── 저장소: IndexedDB(대용량) + 메모리 캐시, 실패 시 localStorage 폴백 ── */
const DB_NAME="nigakyo", DB_STORE="kv";
let _idb=null;   // IndexedDB 핸들 (null이면 localStorage 폴백)
let _cache={};   // ng:* 전체 메모리 미러 (동기 읽기용)
let _meta={};    // 키별 마지막 수정 시각(ms) — 클라우드 병합용
const META_KEY="ng:__meta";
const CLOUD_CONSENT_KEY="ng:privacy:cloud";
// 클라우드 동기화 제외: API 키(보안) + 내부 메타 + 시험 기록(손글씨 이미지가 커서 Firestore 1MB 초과)
// + 기출은행(ng:bank: — 대량 축적 시 1MB 초과, 로컬 우선. 공유 단계에서 Firestore 컬렉션으로 이전)
// + 개인정보/동의 상태/학원 공유 토큰/닉네임은 기본 동기화 대상에서 제외
const SYNC_EXCLUDE=new Set(["ng:key","ng:geminiKey",META_KEY,CLOUD_CONSENT_KEY,"ng:aca:link"]);
const noSync=(k)=>SYNC_EXCLUDE.has(k)||k.startsWith("ng:__")||k.startsWith("ng:exam:")||k.startsWith("ng:bank:")||k.startsWith("ng:nick:");

/* ── 데이터 스키마 버전 (ADR-014 A1): 구버전 데이터 기기 × 신버전 앱 충돌 방지 ──
   저장 형식을 바꾸는 변경은 SCHEMA_VERSION을 올리고 _MIGRATIONS[새버전]에 변환 함수를 추가한다.
   변환 함수는 cache를 직접 수정하고, 바뀐 키 배열을 반환한다(반환된 키만 디스크에 다시 쓴다). */
const SCHEMA_KEY="ng:__schema";
const SCHEMA_VERSION=1;
const _MIGRATIONS={ /* 예) 2:(cache)=>{ cache["ng:decks"]=...; return ["ng:decks"]; } */ };
function migrateSchema(cache,fromV,toV,migrations){
  const changed=[];
  for(let v=fromV+1;v<=toV;v++){
    const fn=migrations[v];
    if(fn){const ks=fn(cache);if(Array.isArray(ks))changed.push(...ks);}
  }
  return changed;
}

function _idbOpen(){
  return new Promise((res,rej)=>{
    let req;try{req=indexedDB.open(DB_NAME,1);}catch(e){return rej(e);}
    req.onupgradeneeded=()=>{try{req.result.createObjectStore(DB_STORE);}catch(_){}};
    req.onsuccess=()=>res(req.result);
    req.onerror=()=>rej(req.error);
  });
}
function _idbAll(db){
  return new Promise((res)=>{
    const out={};
    try{
      const cur=db.transaction(DB_STORE,"readonly").objectStore(DB_STORE).openCursor();
      cur.onsuccess=()=>{const c=cur.result;if(c){out[c.key]=c.value;c.continue();}else res(out);};
      cur.onerror=()=>res(out);
    }catch(e){res(out);}
  });
}
function _idbPut(k,v){try{_idb.transaction(DB_STORE,"readwrite").objectStore(DB_STORE).put(v,k);}catch(e){console.warn("[idb put]",e);}}
function _idbDel(k){try{_idb.transaction(DB_STORE,"readwrite").objectStore(DB_STORE).delete(k);}catch(e){console.warn("[idb del]",e);}}
// 쓰기가 '실제로 디스크에 커밋'됐는지 확인(용량초과는 비동기 abort로 옴). 성공 true / 실패 false.
function _idbPutAwait(k,v){
  return new Promise((res)=>{
    try{
      const tx=_idb.transaction(DB_STORE,"readwrite");
      tx.objectStore(DB_STORE).put(v,k);
      tx.oncomplete=()=>res(true);
      tx.onerror=()=>res(false);
      tx.onabort=()=>res(false);   // QuotaExceededError 등
    }catch(e){console.warn("[idb putAwait]",e);res(false);}
  });
}

async function initStorage(){
  try{
    _idb=await _idbOpen();
    _cache=await _idbAll(_idb);
    // 용량 압박 시 브라우저가 저장 데이터를 함부로 비우지 않도록 영속 저장 요청(베스트 에포트)
    try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist();}catch(_){}
    // 첫 실행 마이그레이션: IndexedDB가 비어있고 localStorage에 기존 데이터가 있으면 복사
    // (localStorage 원본은 지우지 않고 백업으로 보존)
    if(Object.keys(_cache).length===0){
      for(let i=0;i<localStorage.length;i++){
        const k=localStorage.key(i);
        if(k&&k.startsWith("ng:")){
          let v;try{v=JSON.parse(localStorage.getItem(k));}catch{v=localStorage.getItem(k);}
          _cache[k]=v;_idbPut(k,v);
        }
      }
    }
  }catch(e){
    console.warn("[storage] IndexedDB 사용 불가 — localStorage 폴백",e);
    _idb=null;_cache={};
    try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith("ng:")){try{_cache[k]=JSON.parse(localStorage.getItem(k));}catch{_cache[k]=localStorage.getItem(k);}}}}catch(_){}
  }
  _meta=(_cache[META_KEY]&&typeof _cache[META_KEY]==="object")?_cache[META_KEY]:{};
  // A1: 스키마 마이그레이션 — 버전 없는 기존 데이터는 v1으로 간주, 낮은 버전은 순차 변환 후 버전 스탬프
  try{
    const from=typeof _cache[SCHEMA_KEY]==="number"?_cache[SCHEMA_KEY]:1;
    if(from<SCHEMA_VERSION)migrateSchema(_cache,from,SCHEMA_VERSION,_MIGRATIONS).forEach(k=>_writeLocal(k,_cache[k]));
    else if(from>SCHEMA_VERSION){console.warn("[schema] 데이터("+from+")가 앱("+SCHEMA_VERSION+")보다 새 버전 — 앱 업데이트 필요");return;}
    if(_cache[SCHEMA_KEY]!==SCHEMA_VERSION)_writeLocal(SCHEMA_KEY,SCHEMA_VERSION);
  }catch(e){console.warn("[schema]",e);}
}

// 로컬에만 기록 (클라우드 푸시 없음) — 동기화 시 역방향 루프 방지
function _writeLocal(k,v){
  _cache[k]=v;
  try{
    if(_idb)_idbPut(k,v);
    else if(typeof localStorage!=="undefined")localStorage.setItem(k,JSON.stringify(v));
    return true;
  }
  catch(e){console.error("[LS] 저장 실패:",k,e);return false;}
}
const hasCloudConsent=()=>LS.get(CLOUD_CONSENT_KEY)===true;
function setCloudConsent(on){return _writeLocal(CLOUD_CONSENT_KEY,!!on);}
const LS = {
  get(k){return Object.prototype.hasOwnProperty.call(_cache,k)?_cache[k]:null;},
  set(k,v){
    const ok=_writeLocal(k,v);
    if(k.startsWith("ng:")&&k!==META_KEY){
      _meta[k]=Date.now();_writeLocal(META_KEY,_meta);
      cloudMaybePush(k);
    }
    return ok;
  },
  del(k){
    delete _cache[k];try{if(_idb)_idbDel(k);else if(typeof localStorage!=="undefined")localStorage.removeItem(k);}catch{}
    if(k.startsWith("ng:")&&k!==META_KEY){
      delete _meta[k];_writeLocal(META_KEY,_meta);
      cloudMaybeDelete(k);
    }
  },
  // 저장이 실제로 영속됐는지 '기다려서' 확인. 용량초과·거부 시 false + 캐시 롤백(거짓 성공 방지). 큰 저장(책 등)에 사용.
  async setVerified(k,v){
    const had=Object.prototype.hasOwnProperty.call(_cache,k),prev=_cache[k];
    _cache[k]=v;
    let ok;
    if(_idb)ok=await _idbPutAwait(k,v);
    else if(typeof localStorage!=="undefined"){try{localStorage.setItem(k,JSON.stringify(v));ok=true;}catch(e){console.error("[LS] 저장 실패:",k,e);ok=false;}}
    else ok=true;
    if(!ok){if(had)_cache[k]=prev;else delete _cache[k];return false;}
    if(k.startsWith("ng:")&&k!==META_KEY){_meta[k]=Date.now();_writeLocal(META_KEY,_meta);cloudMaybePush(k);}
    return true;
  },
};
function getStorageSize(){
  let t=0;
  try{for(const k in _cache){if(k.startsWith("ng:"))t+=(k.length+JSON.stringify(_cache[k]).length)*2;}}
  catch{}
  return t;
}
const STORAGE_CAP=()=>_idb?200*1024*1024:4.5*1024*1024;
// 브라우저가 보고하는 실제 사용량/할당량(가능하면). 폴백: 캐시 추정치. {usage,quota,free}
async function estimateStorage(){
  try{
    if(navigator.storage&&navigator.storage.estimate){
      const e=await navigator.storage.estimate();
      if(e&&typeof e.quota==="number"&&typeof e.usage==="number")
        return {usage:e.usage,quota:e.quota,free:Math.max(0,e.quota-e.usage)};
    }
  }catch(_){}
  const used=getStorageSize(),cap=STORAGE_CAP();
  return {usage:used,quota:cap,free:Math.max(0,cap-used)};
}
// 객체를 저장했을 때 대략 차지할 바이트(UTF-16 기준 보수적)
const byteSize=(k,v)=>{try{return(k.length+JSON.stringify(v).length)*2;}catch{return 0;}};
function formatSize(b){
  if(b<1024)return b+"B";
  if(b<1048576)return(b/1024).toFixed(1)+"KB";
  return(b/1048576).toFixed(2)+"MB";
}
function fmtClock(ts){if(!ts)return"";const d=new Date(ts);return d.getHours()+":"+String(d.getMinutes()).padStart(2,"0");}
const DECKS_KEY="ng:decks";
const SUBJS_KEY="ng:subjects";
const dk=(id)=>"ng:deck:"+id;

// ── 백업: 학습 데이터 내보내기/불러오기 (API 키는 보안상 제외) ──
function exportBackup(){
  const data={};
  for(const k in _cache){if(k.startsWith("ng:")&&k!=="ng:key"&&k!=="ng:geminiKey")data[k]=_cache[k];}
  const blob=new Blob([JSON.stringify({app:"nigakyo",version:1,exportedAt:Date.now(),data},null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download="니가교수_백업_"+new Date().toISOString().slice(0,10)+".json";
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function importBackup(file){
  const parsed=JSON.parse(await file.text());
  if(parsed.app!=="nigakyo"||!parsed.data)throw new Error("니가교수 백업 파일이 아니야");
  let n=0;
  for(const k in parsed.data){if(k.startsWith("ng:")&&k!=="ng:key"&&k!=="ng:geminiKey"){LS.set(k,parsed.data[k]);n++;}}
  return n;
}

/* ── 과목 색상 팔레트 ── */
const SUBJ_COLORS=["#6C5CE7","#27C2A0","#FF6B8A","#FF8E72","#FFC24B","#4FACFE","#A29BFE","#55EFC4"];
const defaultSubjects=()=>LS.get(SUBJS_KEY)||[
  {id:"math",name:"수학",color:"#6C5CE7"},
  {id:"econ",name:"경제",color:"#27C2A0"},
  {id:"etc", name:"기타",color:"#857FA0"},
];

/* ── API 설정 (initStorage 후 loadCFG로 채움) ── */
const CFG={key:"",model:"claude-sonnet-4-6",qmodel:"claude-haiku-4-5-20251001",geminiKey:"",lang:"ko"};
function loadCFG(){
  CFG.key=LS.get("ng:key")||"";
  CFG.model=LS.get("ng:model")||"claude-sonnet-4-6";
  CFG.qmodel=LS.get("ng:qmodel")||"claude-haiku-4-5-20251001";
  CFG.geminiKey=LS.get("ng:geminiKey")||"";
  CFG.lang=LS.get("ng:lang")||"ko";
  // 종료된(2026-06-01) Gemini 2.0 모델을 저장해둔 사용자는 후속 모델로 자동 이전 (소스 치환만으론 안 고쳐짐)
  const DEAD={"gemini-2.0-flash":"gemini-2.5-flash","gemini-2.0-flash-001":"gemini-2.5-flash","gemini-2.0-flash-lite":"gemini-2.5-flash-lite","gemini-2.0-flash-lite-001":"gemini-2.5-flash-lite"};
  if(DEAD[CFG.model]){CFG.model=DEAD[CFG.model];LS.set("ng:model",CFG.model);}
  if(DEAD[CFG.qmodel]){CFG.qmodel=DEAD[CFG.qmodel];LS.set("ng:qmodel",CFG.qmodel);}
}
// 앱 UI 언어(전역, 설정값 CFG.lang 기준) — 모든 컴포넌트 공용 라벨 번역
const tr=(ko,en)=>CFG.lang==="en"?en:ko;
// 자료 언어 자동 감지: 한글 거의 없고 라틴 문자 많으면 'en'
function detectLang(text){
  const ko=(text.match(/[가-힣]/g)||[]).length;
  const en=(text.match(/[A-Za-z]/g)||[]).length;
  return (en>30&&en>ko*4)?"en":"ko";
}
// 해설 가독성 규칙 — 수식/표/그래프가 화면에서 안 깨지게 출력 형식을 강제
const RICH_FMT="\n\n[출력 형식 규칙 — 가독성 최우선, 반드시 지킬 것]\n"+
"1) 모든 수식·기호·그리스문자는 LaTeX로: 인라인은 $...$, 행렬·여러 줄·정렬식(aligned)·연립식은 반드시 $$...$$ 블록(여러 줄 가능). 유니코드 수학기호(×·≤≥∫∑√ 등) 직접 쓰지 말고 LaTeX(\\times \\le \\int 등)로.\n"+
"2) 달러·통화 금액은 백슬래시로 이스케이프: \\$10, \\$1,200 처럼. (수식 아닌 맨 $ 기호 절대 금지 — 안 그러면 화면이 깨짐)\n"+
"2-1) 수식 안에서 퍼센트는 반드시 \\% 로 써라(그냥 %는 LaTeX 주석으로 먹혀 식 전체가 깨짐). 예: 인플레이션 목표 $\\pi^*=2\\%$. 인라인 $...$ 안에는 줄바꿈 넣지 말고, 길거나 여러 줄이면 $$...$$ 블록(여러 줄은 \\begin{aligned}...\\end{aligned})으로.\n"+
"3) 비교·수치·항목 정리는 GitHub 마크다운 표로:\n| 항목 | 값 |\n| --- | --- |\n| 예 | 1 |\n표 앞뒤에 빈 줄을 넣고, HTML <table>은 쓰지 말 것.\n"+
"4) [수학 그래프·도형은 mathviz 스크립트로] 함수 그래프(다항·유리·지수·로그·삼각, 접선·극점·넓이·점근선·이차곡선)와 좌표 도형·벡터 다이어그램(내적·투영·각 표시)은 <svg> 대신 ```mathviz 코드블록에 장면 스크립트 JSON을 넣어라 — 렌더러가 교점·절편·극점·초점을 자동 계산하고 화살촉·각도 호·라벨 배치까지 정확히 그린다. 예:\n"+
'```mathviz\n{"version":1,"theme":"algebra","view":{"x":[-3,4.6],"y":[-3,4.6]},"steps":[{"type":"axes","ticks":1},{"type":"plot","id":"f","expr":"exp(x)-2","domain":[-3,1.85],"color":"accent"},{"type":"plot","id":"g","expr":"log(x+2)","domain":[-1.86,4.6],"color":"chalk"},{"type":"asymptote","axis":"h","at":-2,"label":"y=-2"},{"type":"intercepts","of":"f"},{"type":"intersections","of":["f","g"]},{"type":"area","between":["f","g"],"range":"auto-intersections"},{"type":"pill","text":"두 곡선 사이 넓이는 교점부터"}]}\n```\n'+
'다른 step: {"type":"extrema"|"inflections","of":"f"} · {"type":"tangent","of":"f","at":x0} · {"type":"point","at":[x,y],"label":"(1,\\\\,2)"} · {"type":"guide","at":[x,y]} · {"type":"segment","from":[x,y],"to":[x,y],"dash":true,"label":"…"} · {"type":"vector","from":[x,y],"to":[x,y],"label":"\\\\vec{a}"}(벡터 화살표) · {"type":"angle","at":[꼭짓점],"from":[방향점],"to":[방향점],"label":"θ"}(각도 호) · {"type":"conic","kind":"ellipse|hyperbola|parabola","a":2,"b":1.414,"p":2,"show":["foci","asymptotes","vertices"]} · {"type":"formula","tex":"…","box":true} · {"type":"lines","tex":["유도…","결론"],"mutedExceptLast":true} · {"type":"chip","text":"용어"}\n'+
"규칙: expr는 사칙·^·sin·cos·tan·exp·log·ln·sqrt·abs·pi·e·x만. 교점·절편·극점·변곡점·초점 좌표를 JSON에 직접 쓰지 말 것(intercepts/intersections/extrema/inflections/conic 스텝이 자동 계산). plot의 domain은 정의역 안으로(log 등). lines는 6줄 이하. tex의 백슬래시는 \\\\ 이스케이프. 라벨에 유니코드 조합문자(b⃗의 ⃗) 절대 금지 — 벡터는 \\\\vec{b}. 벡터 다이어그램처럼 축이 불필요하면 axes 생략 가능.\n"+
"4-1) [비함수 개념 도식은 <svg>] 함수식이 아닌 정성적 도식(경제 모형, 개념도, 구조도)은 기존처럼 <svg>를 코드블록 없이 직접, 아끼지 말고 그려(필요하면 여러 개): viewBox 사용, width≤520 height≤380. 축마다 라벨(예: 가로 수량 Q·실질소득 Y, 세로 가격 P·실질이자율 r), 곡선마다 라벨, 교점(균형점)은 점+좌표/값 표시, 곡선 이동·변화는 '이동 전(점선·회색) → 이동 후(실선)' + 방향 화살표로. 색은 반드시 앱 팔레트만: 축선·글자=#221C39, 곡선·강조=#6C5CE7(주색)·#27C2A0·#FFC24B, 배경 #FFFDF8 — 원색 red/green/blue 금지, 빨강·장미 계열(#FF6B8A 등)도 금지(오답 표시와 혼동). 글자 11~13px, <text>에 유니코드 조합문자(b⃗의 ⃗ 등) 절대 금지(폰트가 못 그려 깨짐 — 벡터 표기는 굵은 이탤릭 글자로만).\n"+
"4-2) 특히 경제학: 그래프로 표현되는 개념은 글로만 때우지 말고 반드시 그려라(수요·공급, 한계비용·평균비용 곡선, IS곡선, LM·MP곡선, AD–AS, 필립스곡선, IS–MP에서 AD 도출 등). 여러 곡선이 얽힌 모형은 서로 '유기적으로 연결'되게 그려라 — 같은 축·같은 균형점을 정렬하거나, 패널을 세로로 쌓아 한 패널의 균형값(예: r* 또는 Y*)이 다음 패널의 입력이 되도록 점선 보조선으로 이어서, 인과 흐름이 한눈에 보이게.\n"+
"4-3) SVG는 간결하게 그려라(불필요한 점·격자·장식 최소화) — 그래야 안 잘린다. 모든 <svg>는 반드시 </svg>로, 모든 ```mathviz 블록은 반드시 ```로 닫아라(안 닫히면 그래프가 안 보임).";
// 이미지·PDF 인식용 모델: 가진 키 기준 (Claude 우선, 없으면 Gemini) — Gemini-only 유저도 동작
function ocrModel(){
  if(CFG.key)return"claude-sonnet-4-6";
  if(CFG.geminiKey)return"gemini-2.5-flash";
  return CFG.model;
}

/* ── Firebase 구글 로그인 (선택 기능 — 실패해도 앱은 정상 동작) ── */
const FIREBASE_CONFIG={
  apiKey:"AIzaSyD0ObaK3aKotOjKjtg1MGz_SB4qHX0DhdA",
  authDomain:"yourprofessor-94a2d.firebaseapp.com",
  projectId:"yourprofessor-94a2d",
  storageBucket:"yourprofessor-94a2d.firebasestorage.app",
  messagingSenderId:"307018527457",
  appId:"1:307018527457:web:83c46611055283c427bda0"
};
let _auth=null,_db=null;
function initFirebase(){
  try{
    if(window.firebase&&FIREBASE_CONFIG.apiKey&&!window.firebase.apps.length){
      window.firebase.initializeApp(FIREBASE_CONFIG);
    }
    if(window.firebase)_auth=window.firebase.auth();
    try{if(window.firebase&&window.firebase.firestore)_db=window.firebase.firestore();}
    catch(e){console.warn("[firebase] Firestore 사용 불가 — 클라우드 동기화 비활성",e);_db=null;}
  }catch(e){console.warn("[firebase] 초기화 실패 — 로그인 비활성",e);_auth=null;_db=null;}
}
function nickKey(uid){return"ng:nick:"+uid;}

/* ── 클라우드 동기화 (로그인 시 계정에 데이터 묶기) ──
   구조: users/{uid}/data/{key} = {k:원본키, v:값, t:수정시각}.
   API 키는 올리지 않음. Firestore 미설정/오류 시 조용히 로컬 전용으로 동작. */
let _uid=null;          // 현재 로그인 uid (null이면 동기화 안 함)
function setUid(u){_uid=u;} // 모듈 밖(AppShell 로그인 구독)에서 갱신용
let _syncing=false;     // 초기 병합 중(이 동안 푸시 억제)
const _pending=new Set();let _pendTimer=null;
// 동기화 상태를 UI에 알림: {busy, ok, at}
let _syncCb=null;
function setSyncListener(fn){_syncCb=fn;}
function _emitSync(s){try{_syncCb&&_syncCb(s);}catch(_){}}
// 약속이 일정 시간 내 안 끝나면 실패 처리(Firestore 미설정 시 매달림 방지)
function withTimeout(p,ms,label){
  return Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error((label||"작업")+" 시간초과")),ms))]);
}
function encKey(k){return encodeURIComponent(k).replace(/%/g,"_");}  // Firestore 문서 ID 안전화
function _dataCol(uid){return _db.collection("users").doc(uid).collection("data");}
async function cloudPushKey(uid,key){
  if(noSync(key)||!_db||!hasCloudConsent())return;
  const v=Object.prototype.hasOwnProperty.call(_cache,key)?_cache[key]:null;
  await withTimeout(_dataCol(uid).doc(encKey(key)).set({k:key,v:v===undefined?null:v,t:_meta[key]||Date.now()}),12000,"업로드");
}
async function cloudPushKeys(uid,keys){
  if(!_db||!uid||!hasCloudConsent())return 0;
  const clean=[...new Set(keys)].filter(k=>!noSync(k));
  let pushed=0;
  for(let i=0;i<clean.length;i+=450){
    const chunk=clean.slice(i,i+450);
    const batch=_db.batch();
    chunk.forEach(key=>{
      const v=Object.prototype.hasOwnProperty.call(_cache,key)?_cache[key]:null;
      batch.set(_dataCol(uid).doc(encKey(key)),{k:key,v:v===undefined?null:v,t:_meta[key]||Date.now()});
    });
    await withTimeout(batch.commit(),15000,"일괄 업로드");
    pushed+=chunk.length;
  }
  return pushed;
}
async function cloudDeleteKey(uid,key){if(!_db)return;await withTimeout(_dataCol(uid).doc(encKey(key)).delete(),12000,"삭제");}
function cloudMaybePush(k){
  if(!_db||!_uid||_syncing||noSync(k)||!hasCloudConsent())return;
  _pending.add(k);clearTimeout(_pendTimer);_pendTimer=setTimeout(flushPending,1200);
}
async function flushPending(){
  if(!_db||!_uid||!hasCloudConsent())return;
  const keys=[..._pending];_pending.clear();
  if(!keys.length)return;
  _emitSync({busy:true});let ok=true;
  try{await cloudPushKeys(_uid,keys);}
  catch(e){ok=false;console.warn("[cloud push batch]",e);}
  _emitSync({busy:false,ok,at:Date.now()});
}
function cloudMaybeDelete(k){
  if(!_db||!_uid||_syncing||noSync(k)||!hasCloudConsent())return;
  _emitSync({busy:true});
  cloudDeleteKey(_uid,k).then(()=>_emitSync({busy:false,ok:true,at:Date.now()}))
    .catch(e=>{console.warn("[cloud del]",k,e);_emitSync({busy:false,ok:false});});
}
// 로그인 시: 클라우드와 로컬을 시각 비교로 병합 (최신 우선, 비기면 로컬 유지+업로드)
async function cloudSyncOnLogin(uid){
  if(!_db||!uid||!hasCloudConsent())return{pulled:0,pushed:0,ok:false,consent:false};
  _syncing=true;let pulled=0,pushed=0,ok=true;
  _emitSync({busy:true});
  try{
    const snap=await withTimeout(_dataCol(uid).get(),12000,"동기화");
    const cloud={};
    snap.forEach(d=>{const x=d.data();if(x&&typeof x.k==="string")cloud[x.k]={v:x.v,t:x.t||0};});
    const localKeys=Object.keys(_cache).filter(k=>k.startsWith("ng:")&&!noSync(k));
    const keys=new Set([...localKeys,...Object.keys(cloud)]);
    const toPush=[],backup={};   // A2(ADR-014): 클라우드가 로컬을 덮기 전 원본 1회분 보존 — 잘못 병합 시 수동 복구용
    keys.forEach(key=>{
      if(noSync(key))return;
      const hasLocal=Object.prototype.hasOwnProperty.call(_cache,key);
      const lt=_meta[key]||0;
      const c=cloud[key];
      if(!c){if(hasLocal)toPush.push(key);return;}      // 클라우드에 없음 → 올림
      if(!hasLocal||c.t>lt){if(hasLocal)backup[key]={v:_cache[key],t:lt};_writeLocal(key,c.v);_meta[key]=c.t;pulled++;return;} // 클라우드가 최신 → 받음
      toPush.push(key);                                  // 로컬이 최신/동률 → 올림
    });
    if(Object.keys(backup).length)_writeLocal("ng:__syncBackup",{at:Date.now(),items:backup});
    _writeLocal(META_KEY,_meta);
    toPush.forEach(key=>{if(!_meta[key])_meta[key]=Date.now();});
    if(toPush.length)pushed=await cloudPushKeys(uid,toPush);
    if(pushed)_writeLocal(META_KEY,_meta);
  }catch(e){console.warn("[cloud] 로그인 동기화 실패 (Firestore 설정 확인)",e);ok=false;}
  _syncing=false;_emitSync({busy:false,ok,at:ok?Date.now():0});return{pulled,pushed,ok};
}
// 사용자가 직접 고르는 모델은 클로드만(니가교수=클로드). GPT/Gemini는 클로드 장애 시 서버가 자동으로 쓰는 백업.

function clearLocalStudyData({keepKeys=true}={}){
  const keys=Object.keys(_cache).filter(k=>k.startsWith("ng:")&&(!keepKeys||!["ng:key","ng:geminiKey","ng:model","ng:qmodel"].includes(k)));
  keys.forEach(k=>LS.del(k));
  return keys.length;
}

export { setUid, DB_NAME, DB_STORE, _idb, _cache, _meta, META_KEY, CLOUD_CONSENT_KEY, SYNC_EXCLUDE, noSync, SCHEMA_KEY, SCHEMA_VERSION, migrateSchema, _idbOpen, _idbAll, _idbPut, _idbDel, _idbPutAwait, initStorage, _writeLocal, hasCloudConsent, setCloudConsent, LS, getStorageSize, STORAGE_CAP, estimateStorage, byteSize, formatSize, fmtClock, DECKS_KEY, SUBJS_KEY, dk, exportBackup, importBackup, clearLocalStudyData, SUBJ_COLORS, defaultSubjects, CFG, loadCFG, tr, detectLang, RICH_FMT, ocrModel, FIREBASE_CONFIG, _auth, _db, initFirebase, nickKey, _uid, _syncing, _pending, _syncCb, setSyncListener, _emitSync, withTimeout, encKey, _dataCol, cloudPushKey, cloudPushKeys, cloudDeleteKey, cloudMaybePush, flushPending, cloudMaybeDelete, cloudSyncOnLogin };
