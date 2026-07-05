/* ── 기출문제 은행(examBank): 로컬 RAG 코퍼스 ──
   출제·채점 시 검색해 근거로 주입하는 검증된 기출 저장소.
   verified=true(사람 검수 완료)만 검색 후보에 들어간다 — 0오류 보증선.
   저장: ng:bank:items 단일 배열(IndexedDB). 클라우드 동기화 제외(로컬 우선) —
   여러 학원·기기 공유가 필요해지는 시점에 Firestore 컬렉션으로 이전한다. */
import { LS } from "./platform.js";

const BANK_KEY="ng:bank:items";

/* 한 건 스키마:
   {id, createdAt,
    corpus: "기출" | "문제집",              // 원자료 종류 — 적재된 원본이 어디서 왔는지
    src: {year, school, exam, number},      // 출처(연도·학교·시험명·문항번호)
    subject, unit,                          // curriculum 과목명·대단원명(knowledgeGraph 노드와 1:1)
    qtype: "mc" | "short" | "essay",
    question,                               // LaTeX($...$) 포함 본문
    choices: [],                            // 객관식 보기(①~⑤)
    answer, explanation,                    // 자료에 있던 공식 정답·해설 (지어낸 것 금지)
    points, difficulty, hasFigure,
    figure,                                 // 그림 raster: JPEG dataURL (크롭 도구 산출물, 폴백)
    figureScript,                           // 그림 vector: 장면 스크립트 JSON(§2-1) — MathViz 렌더·채점 컨텍스트용, figure와 병행
    verified, verifiedAt}                   // 사람 검수 완료 여부 — 검색 후보 자격 */

function bankAll(){return LS.get(BANK_KEY)||[];}
function bankSet(list){return LS.set(BANK_KEY,list);}
function bankAdd(items){const list=[...items,...bankAll()];bankSet(list);return list;}
function bankUpdate(id,patch){const list=bankAll().map(it=>it.id===id?{...it,...patch}:it);bankSet(list);return list;}
function bankDel(id){const list=bankAll().filter(it=>it.id!==id);bankSet(list);return list;}

// 검색 1단계: 태그 필터링(단원·과목·유형·검수여부). 건수가 커지면 임베딩 검색을 이 뒤에 얹는다.
// 그림 필수(hasFigure)인데 그림이 첨부되지 않은 문항은 출제 후보에서 제외 — 그림 없이 나가면 못 푸는 문제가 되므로.
function bankSearch({subject,unit,qtype,verifiedOnly=true,limit=8}={}){
  let list=bankAll();
  if(verifiedOnly)list=list.filter(it=>it.verified);
  list=list.filter(it=>!it.hasFigure||it.figure||it.figureScript);
  if(subject)list=list.filter(it=>it.subject===subject);
  if(unit)list=list.filter(it=>it.unit===unit);
  if(qtype)list=list.filter(it=>it.qtype===qtype);
  return list.slice(0,limit);
}

function bankStats(){
  const list=bankAll();
  const verified=list.filter(it=>it.verified).length;
  const units={};list.forEach(it=>{if(it.unit)units[it.unit]=(units[it.unit]||0)+1;});
  return {total:list.length,verified,pending:list.length-verified,unitCount:Object.keys(units).length,units};
}

// 은행 문제 → Exam 문항 변환. origin="기출"(원본 그대로 출제)로 표시된다.
// mc는 정답 텍스트의 ①~⑤ 기호로 정답 인덱스를 복원 — 복원 불가면 단답형으로 강등해 텍스트 채점(오채점 방지).
const CIRC="①②③④⑤";
function toExamItem(it,uidFn){
  const srcLabel=[it.src?.year,it.src?.school,it.src?.exam].filter(Boolean).join(" ")+(it.src?.number?" · "+it.src.number+"번":"");
  const base={id:uidFn(),origin:"기출",bankId:it.id,srcLabel:srcLabel.trim(),
    unit:it.unit||"",concept:it.unit||"",question:it.question||"",figure:it.figure||null,figureScript:it.figureScript||null,
    points:Number(it.points)>0?Number(it.points):(it.qtype==="essay"?15:5)};
  if(it.qtype==="mc"&&Array.isArray(it.choices)&&it.choices.length>=2){
    const m=(it.answer||"").match(/[①②③④⑤]/);
    const ai=m?CIRC.indexOf(m[0]):-1;
    if(ai>=0&&ai<it.choices.length)
      return{...base,type:"mc",choices:it.choices.map(c=>String(c).replace(/^\s*[①②③④⑤]\s*/,"")),answer:ai,
        accept:[],rubric:[],solution:it.explanation||it.answer||"",model_answer:""};
    return{...base,type:"short",question:(it.question||"")+"\n"+it.choices.join("  "),answer:it.answer||"",
      accept:[],rubric:[],solution:it.explanation||"",model_answer:""};
  }
  if(it.qtype==="essay")
    return{...base,type:"essay",accept:[],rubric:[],solution:it.explanation||"",
      model_answer:(it.answer?it.answer+"\n":"")+(it.explanation||"")};
  return{...base,type:"short",answer:it.answer||"",accept:[],rubric:[],solution:it.explanation||"",model_answer:""};
}

export { BANK_KEY, bankAll, bankAdd, bankUpdate, bankDel, bankSearch, bankStats, toExamItem };
