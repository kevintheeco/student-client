/* ── 학원 연동 — 개인 학습(손글씨) 데이터가 학원 분석으로 흐르는 파이프라인 ──
   학생이 학원 코드를 넣고 '연동'을 켜면(옵트인), 학습 신호가 Firestore
   aca_shared/{code}__{uid} 문서로 공유된다. 학원은 자기 코드의 공유 목록을 불러
   명단의 학생에게 병합 — 집 공부의 힌트 의존·포기·오개념까지 학원 인사이트에 합쳐진다.
   공유 내용: 시도 로그(텍스트만, 최근 600건)·평생 집계·오개념 사전·닉네임.
   절대 포함 안 됨: 손글씨 이미지, API 키, 자료 원문. */
import { LS, _db, withTimeout } from "./platform.js";
import { ATT_KEY, MAX_ATTEMPTS } from "./attempts.js";

const LINK_KEY="ng:aca:link";   // {code, on} — 학생 쪽 연동 설정
const getLink=()=>LS.get(LINK_KEY)||null;
const setLink=(v)=>LS.set(LINK_KEY,v);

/* 학생 → 학원: 지금 공유 (연동 켜져 있고 로그인 상태일 때) */
async function shareNow(uid,name){
  const link=getLink();
  if(!link||!link.on||!link.code)throw new Error("연동이 꺼져 있어");
  if(!_db)throw new Error("클라우드(Firestore)를 쓸 수 없어");
  if(!uid)throw new Error("로그인이 필요해");
  const attempts=(LS.get(ATT_KEY)||[]).slice(-600);   // 텍스트만 ~120KB (문서 1MB 한도 내)
  const doc={code:String(link.code),uid,name:name||"",t:Date.now(),v:1,
    attempts,agg:LS.get("ng:attagg")||{},misclex:LS.get("ng:misclex")||{}};
  await withTimeout(_db.collection("aca_shared").doc(link.code+"__"+uid).set(doc),15000,"학원 공유");
  return attempts.length;
}
// 자동 공유(디바운스): 클라우드 동기화가 성공할 때마다 호출해도 5초에 한 번만 실제 전송
let _timer=null,_last=0;
function maybeShare(uid,name){
  const link=getLink();
  if(!link||!link.on||!link.code||!_db||!uid)return;
  if(Date.now()-_last<60000)return;   // 최소 1분 간격
  clearTimeout(_timer);
  _timer=setTimeout(()=>{_last=Date.now();shareNow(uid,name).catch(e=>console.warn("[학원 연동]",e));},5000);
}

/* 학원 ← 학생: 내 코드로 공유된 학생 목록 */
async function fetchShared(code){
  if(!_db)throw new Error("클라우드(Firestore)를 쓸 수 없어");
  const snap=await withTimeout(_db.collection("aca_shared").where("code","==",String(code)).get(),15000,"연동 목록");
  const out=[];snap.forEach(d=>{const x=d.data();if(x&&x.uid)out.push(x);});
  return out.sort((a,b)=>(b.t||0)-(a.t||0));
}
/* 공유 데이터를 학원 기기의 시도 로그에 병합 (해당 학생 sid로 귀속, 시그니처 중복 제거) */
function importShared(shared,sid){
  const sig=(a)=>[a.t,a.src,a.concept,a.verdict].join("|");
  const list=LS.get(ATT_KEY)||[];
  const seen=new Set(list.filter(a=>a.sid===sid).map(sig));
  let added=0;
  for(const a of shared.attempts||[]){
    if(!a||!a.t)continue;
    const s=sig(a);if(seen.has(s))continue;seen.add(s);
    list.push({...a,sid});added++;
  }
  list.sort((x,y)=>(x.t||0)-(y.t||0));
  LS.set(ATT_KEY,list.length>MAX_ATTEMPTS?list.slice(list.length-MAX_ATTEMPTS):list);
  return added;
}

export { LINK_KEY, getLink, setLink, shareNow, maybeShare, fetchShared, importShared };
