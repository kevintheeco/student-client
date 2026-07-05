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
    verified, verifiedAt}                   // 사람 검수 완료 여부 — 검색 후보 자격 */

function bankAll(){return LS.get(BANK_KEY)||[];}
function bankSet(list){return LS.set(BANK_KEY,list);}
function bankAdd(items){const list=[...items,...bankAll()];bankSet(list);return list;}
function bankUpdate(id,patch){const list=bankAll().map(it=>it.id===id?{...it,...patch}:it);bankSet(list);return list;}
function bankDel(id){const list=bankAll().filter(it=>it.id!==id);bankSet(list);return list;}

// 검색 1단계: 태그 필터링(단원·과목·유형·검수여부). 건수가 커지면 임베딩 검색을 이 뒤에 얹는다.
function bankSearch({subject,unit,qtype,verifiedOnly=true,limit=8}={}){
  let list=bankAll();
  if(verifiedOnly)list=list.filter(it=>it.verified);
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

export { BANK_KEY, bankAll, bankAdd, bankUpdate, bankDel, bankSearch, bankStats };
