/* ── 학습 습관(행동) 지표 v2 — SRL 5차원 프로파일 ──
   점수·숙련도가 "무엇을 아는가"라면, 습관은 "어떻게 공부하는가"다.
   자기조절학습(SRL: 계획→수행→성찰, Zimmerman 2002) 틀로 구조화:
   ① 시작·계획   포기·미착수·세팅 오류 (혼자 시작하는 힘)
   ② 수행 조절   빠른 오답(찍기, Wise & Kong 2005)·덤벙 실수·헛바퀴(Beck & Gong 2013)
   ③ 도움 추구   힌트 의존과 힌트 유무 정답률 차 (Aleven & Koedinger)
   ④ 오답 성찰   재도전·재도전 성공률·같은 함정 반복
   ⑤ 꾸준함·분산 주 활동일·단원 재방문 간격 (분산 연습, Cepeda 2006)
   + 🧩 지식 조합  기본 문항 대비 응용·서술 문항 정확도 격차 —
     "아는 개념을 복합적으로 조합해 쓸 수 있는가" (전이·통합)
   전부 풀이 '과정' 로그에서만 나오는 신호 — 답안지만 보는 서비스는 못 잰다. */
import { scoreOf } from "./mastery.js";
import { nodeById } from "./knowledgeGraph.js";

const DAY=864e5,WEEK=7*DAY;

/* attempts → 습관 프로파일.
   반환 비율은 0~1 (근거 부족이면 null), *N은 근거 표본 수. */
function habitProfile(attempts){
  const study=attempts.filter(a=>a.src==="study");
  const graded=attempts.filter(a=>a.src==="study"||a.src==="quiz"||a.src==="exam");
  const giveups=attempts.filter(a=>a.src==="dontknow");
  const skips=attempts.filter(a=>a.src==="skip");
  const rate=(num,den)=>den>0?num/den:null;
  const acc=(list)=>list.length?list.reduce((s,a)=>s+scoreOf(a),0)/list.length:null;

  /* ── ③ 도움 추구: '한계야' 힌트를 얼마나 찾고, 힌트 없이는 어떤가 ── */
  const withHint=study.filter(a=>(a.hint||0)>0);
  const noHint=study.filter(a=>!(a.hint>0));
  const correct=(list)=>rate(list.filter(a=>a.verdict==="correct").length,list.length);
  const hintRate=rate(withHint.length,study.length);
  const hintCorrect=correct(withHint);
  const soloCorrect=correct(noHint);

  /* ── ① 시작·계획: 포기·스킵 + 첫 오류가 '세팅'에서 나는 비중 ── */
  const giveupRate=rate(giveups.length,study.length+giveups.length);
  const skipRate=rate(skips.length,study.length+skips.length);
  const staged=graded.filter(a=>a.stage);
  const setupShare=rate(staged.filter(a=>a.stage==="setup").length,staged.length);

  /* ── ② 수행 조절: 속도-정확도 균형 ──
     빠른 오답 = 본인 중앙값의 45% 이하 시간에 틀림(찍기/서두름 근사)
     덤벙 실수 = 계산 실수(slip) 중 평소보다 빠르게 푼 비중(부주의 신호)
     헛바퀴   = 6회 이상 시도했는데 최근 5회 평균이 여전히 절반 이하인 단원 */
  const dursAll=graded.filter(a=>a.dur>0).map(a=>a.dur).sort((x,y)=>x-y);
  const medDur=dursAll.length?dursAll[Math.floor(dursAll.length/2)]:null;
  const wrongsD=graded.filter(a=>a.verdict!=="correct"&&a.dur>0);
  const rapidTh=medDur?Math.max(25,medDur*0.45):null;
  const rapidN=rapidTh?wrongsD.filter(a=>a.dur<=rapidTh).length:0;
  const rapidWrongRate=rapidTh?rate(rapidN,wrongsD.length):null;
  const slips=graded.filter(a=>a.err==="slip");
  // 명확히 빠른(중앙값 60% 이하) 풀이에서 난 계산 실수만 '덤벙'으로 집계 — 절반은 원래 중앙값보다 빠르니까
  const fastSlipRate=medDur?rate(slips.filter(a=>a.dur>0&&a.dur<medDur*0.6).length,slips.length):null;
  const byNode={};
  for(const a of graded)if(a.nodeId)(byNode[a.nodeId]=byNode[a.nodeId]||[]).push(a);
  const wheelNodes=Object.entries(byNode)
    .filter(([,list])=>list.length>=6&&acc(list.slice(-5))<0.5)
    .map(([id])=>id);

  /* ── ④ 오답 성찰: 재도전율 + 재도전이 실제로 이기는가 + 함정 반복 ── */
  const byKey={};
  for(const a of attempts){const k=(a.deckId||"")+"|"+(a.concept||a.nodeId||"");(byKey[k]=byKey[k]||[]).push(a);}
  for(const k in byKey)byKey[k].sort((x,y)=>x.t-y.t);
  const wrongs=graded.filter(a=>a.verdict!=="correct");
  let retriedN=0,retryWinN=0;
  for(const a of wrongs){
    const k=(a.deckId||"")+"|"+(a.concept||a.nodeId||"");
    const next=(byKey[k]||[]).find(b=>b.t>a.t&&b.t-a.t<4*DAY&&b.src!=="followup"&&b.src!=="skip");
    if(next){retriedN++;if(next.verdict==="correct")retryWinN++;}
  }
  const retryRate=rate(retriedN,wrongs.length);
  const retryWinRate=rate(retryWinN,retriedN);
  const followPerWrong=rate(attempts.filter(a=>a.src==="followup").length,wrongs.length);
  // 함정 반복: 같은 (단원,오개념 라벨)이 2회 이상 재출현한 발생 비중
  const lex={};
  for(const a of attempts)if(a.misc&&a.nodeId){const k=a.nodeId+"|"+String(a.misc).trim();lex[k]=(lex[k]||0)+1;}
  const lexN=Object.values(lex);
  const miscTotal=lexN.reduce((s,n)=>s+n,0);
  const trapRepeatRate=miscTotal>=4?rate(lexN.filter(n=>n>=2).reduce((s,n)=>s+n,0),miscTotal):null;

  /* ── ⑤ 꾸준함·분산: 주 활동일 + 같은 단원 재방문 간격(분산 연습) ── */
  const times=graded.map(a=>a.t).sort((x,y)=>x-y);
  const spanW=times.length>1?Math.max(1,(times[times.length-1]-times[0])/WEEK):1;
  const activeDays=new Set(graded.map(a=>Math.floor(a.t/DAY))).size;
  const daysPerWeek=times.length>=5?Math.min(7,activeDays/spanW):null;
  const gaps=[];
  for(const id in byNode){
    const l=byNode[id];
    for(let i=1;i<l.length;i++){const g=(l[i].t-l[i-1].t)/DAY;if(g>0.04)gaps.push(g);}
  }
  gaps.sort((x,y)=>x-y);
  const medGapDays=gaps.length>=4?Math.round(gaps[Math.floor(gaps.length/2)]*10)/10:null;

  /* ── 🧩 지식 조합: 기본(recall·mc·ox) vs 응용·서술(apply·essay) 정확도 격차 ── */
  const applyList=graded.filter(a=>a.qtype==="apply"||a.qtype==="essay");
  const basicList=graded.filter(a=>a.qtype==="recall"||a.qtype==="mc"||a.qtype==="ox");
  const applyAcc=acc(applyList),basicAcc=acc(basicList);
  const integGap=(applyAcc!=null&&basicAcc!=null&&applyList.length>=4&&basicList.length>=4)
    ?basicAcc-applyAcc:null;

  /* ── 풀이 시간 추세 (절차 자동화) ── */
  const durs=graded.filter(a=>a.dur>0);
  const avg=(list)=>list.length?Math.round(list.reduce((s,a)=>s+a.dur,0)/list.length):null;
  const now=attempts.length?attempts[attempts.length-1].t:Date.now();
  const avgDur=avg(durs);
  const durRecent=avg(durs.filter(a=>now-a.t<28*DAY));
  const durPrev=avg(durs.filter(a=>now-a.t>=28*DAY&&now-a.t<56*DAY));
  const ocrRate=rate(study.filter(a=>(a.ocr||0)>0).length,study.length);

  return{n:graded.length,studyN:study.length,
    // ③ 도움 추구
    hintRate,hintN:withHint.length,hintCorrect,soloCorrect,
    // ① 시작·계획
    giveupRate,giveupN:giveups.length,skipRate,skipN:skips.length,setupShare,stagedN:staged.length,
    // ② 수행 조절
    medDur,rapidWrongRate,rapidN,wrongDN:wrongsD.length,fastSlipRate,slipN:slips.length,wheelNodes,
    // ④ 오답 성찰
    retryRate,wrongN:wrongs.length,retryWinRate,retriedN,followPerWrong,trapRepeatRate,trapKinds:lexN.length,
    // ⑤ 꾸준함·분산
    daysPerWeek,medGapDays,avgDur,durRecent,durPrev,ocrRate,
    // 🧩 지식 조합
    applyAcc,basicAcc,integGap,applyN:applyList.length,basicN:basicList.length};
}

/* 프로파일 → 상담용 해석 문장들 [{tone:'warn'|'good'|'info', text}] */
function habitInsights(h,t){
  t=t||((ko)=>ko);
  const out=[];
  const pc=(v)=>Math.round(v*100);
  // ① 시작·계획
  if(h.giveupRate!=null&&h.giveupRate>=0.2)
    out.push({tone:"warn",text:t("'모르겠어' 포기가 잦아요("+pc(h.giveupRate)+"%) — 난이도를 한 단계 낮춰 성공 경험부터 쌓는 게 좋아요.")});
  if(h.setupShare!=null&&h.stagedN>=6&&h.setupShare>=0.6)
    out.push({tone:"warn",text:t("오류의 "+pc(h.setupShare)+"%가 '식 세우기' 단계에서 나요 — 계산보다 문제→식 번역 훈련이 먼저예요.")});
  // ② 수행 조절
  if(h.rapidWrongRate!=null&&h.rapidN>=4&&h.rapidWrongRate>=0.2)
    out.push({tone:"warn",text:t("오답의 "+pc(h.rapidWrongRate)+"%가 평소보다 훨씬 빠른 풀이에서 나와요 — 찍기/서두름 패턴. 문제를 끝까지 읽는 습관부터.")});
  if(h.fastSlipRate!=null&&h.slipN>=6&&h.fastSlipRate>=0.35)
    out.push({tone:"warn",text:t("계산 실수의 "+pc(h.fastSlipRate)+"%가 빨리 푼 문제에 몰려요 — 개념이 아니라 '덤벙'이 병목. 속도를 조금 늦추고 마지막 검산 한 줄.")});
  if(h.wheelNodes&&h.wheelNodes.length>0){
    const names=h.wheelNodes.slice(0,2).map(id=>nodeById(id)?.name||id).join(", ");
    out.push({tone:"warn",text:t("헛바퀴 단원: "+names+" — 여러 번 시도해도 제자리예요. 같은 문제 반복 대신 선수 개념 보강이 먼저예요.")});
  }
  // ③ 도움 추구
  if(h.hintRate!=null&&h.studyN>=8){
    if(h.hintRate>=0.4)out.push({tone:"warn",text:t("힌트 의존도가 높아요 — 문제의 "+pc(h.hintRate)+"%에서 힌트를 찾았어요. 혼자 첫 발을 떼는 훈련이 필요해요.")});
    else if(h.hintRate<=0.1&&h.giveupRate!=null&&h.giveupRate<=0.1)out.push({tone:"good",text:t("혼자 힘으로 부딪히는 비율이 높아요 — 자기주도 신호가 좋아요.")});
  }
  if(h.hintCorrect!=null&&h.soloCorrect!=null&&h.hintN>=4&&h.hintCorrect-h.soloCorrect>=0.25)
    out.push({tone:"warn",text:t("힌트가 있으면 풀고(정답률 "+pc(h.hintCorrect)+"%) 없으면 막히는(정답률 "+pc(h.soloCorrect)+"%) 패턴 — 개념이 아니라 '시작 전략'이 병목이에요.")});
  // ④ 오답 성찰
  if(h.retryRate!=null&&h.wrongN>=5){
    if(h.retryRate>=0.6)out.push({tone:"good",text:t("틀린 문제의 "+pc(h.retryRate)+"%를 며칠 안에 다시 잡았어요 — 끈기가 자산이에요.")});
    else if(h.retryRate<=0.25)out.push({tone:"warn",text:t("틀린 문제를 다시 안 잡는 편이에요(재도전 "+pc(h.retryRate)+"%) — 오답 복습 루틴이 필요해요.")});
  }
  if(h.retryWinRate!=null&&h.retriedN>=4&&h.retryWinRate>=0.7)
    out.push({tone:"good",text:t("다시 잡은 문제의 "+pc(h.retryWinRate)+"%를 이겨냈어요 — 복습이 실제로 통하고 있어요.")});
  if(h.trapRepeatRate!=null&&h.trapRepeatRate>=0.6)
    out.push({tone:"warn",text:t("같은 함정에 반복해서 빠져요(오개념 재출현 "+pc(h.trapRepeatRate)+"%) — 틀릴 때마다 '함정 이름'을 소리 내 말하는 오답노트 습관이 필요해요.")});
  // ⑤ 꾸준함·분산
  if(h.daysPerWeek!=null&&h.n>=12){
    if(h.daysPerWeek>=4)out.push({tone:"good",text:t("주 "+Math.round(h.daysPerWeek)+"일 꾸준히 공부해요 — 분산 연습이 기억을 오래 가게 해요.")});
    else if(h.daysPerWeek<=1.5)out.push({tone:"warn",text:t("공부가 주 1~2일에 몰려 있어요 — 짧게라도 주 3일 이상으로 나누면 같은 시간에 더 오래 남아요.")});
  }
  if(h.durRecent!=null&&h.durPrev!=null&&h.durPrev>0){
    const d=(h.durRecent-h.durPrev)/h.durPrev;
    if(d<=-0.2)out.push({tone:"good",text:t("풀이 속도가 빨라지고 있어요 ("+h.durPrev+"초 → "+h.durRecent+"초) — 절차가 자동화되는 중.")});
  }
  // 🧩 지식 조합
  if(h.integGap!=null){
    if(h.integGap>=0.25)out.push({tone:"warn",text:t("개념을 '조합'하는 문제에서 무너져요 — 기본 정답률 "+pc(h.basicAcc)+"% vs 응용 "+pc(h.applyAcc)+"%. 아는 것끼리 섞은 2단원 융합 문제 훈련이 처방이에요.")});
    else if(h.integGap<=0.08&&h.applyAcc>=0.6)out.push({tone:"good",text:t("배운 개념을 섞어 쓰는 힘이 좋아요 — 응용·서술에서도 정확도가 유지돼요("+pc(h.applyAcc)+"%).")});
  }
  return out;
}

export { habitProfile, habitInsights };
