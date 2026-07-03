/* ── 학습 습관(행동) 지표 — 손글씨 학습 앱만이 가진 신호 ──
   점수·숙련도가 "무엇을 아는가"라면, 습관 지표는 "어떻게 공부하는가"다.
   힌트 의존성·포기·재도전·풀이 시간은 답안지가 아니라 풀이 '과정'에서만 나온다.
   학원 연동 시 상담의 핵심 재료: "혼자서는 시작을 못 하고 힌트가 있어야 푼다" 등. */

const DAY=864e5;

/* attempts → 습관 프로파일.
   반환 값의 비율은 0~1 (데이터 없으면 null), n은 근거 표본 수. */
function habitProfile(attempts){
  const study=attempts.filter(a=>a.src==="study");
  const graded=attempts.filter(a=>a.src==="study"||a.src==="quiz"||a.src==="exam");
  const giveups=attempts.filter(a=>a.src==="dontknow");
  const skips=attempts.filter(a=>a.src==="skip");
  const rate=(num,den)=>den>0?num/den:null;

  // 힌트 의존성: '한계야' 힌트를 얼마나 자주 찾고, 힌트 없이는 어떤가
  const withHint=study.filter(a=>(a.hint||0)>0);
  const noHint=study.filter(a=>!(a.hint>0));
  const correct=(list)=>rate(list.filter(a=>a.verdict==="correct").length,list.length);
  const hintRate=rate(withHint.length,study.length);
  const hintCorrect=correct(withHint);   // 힌트 받고 정답률
  const soloCorrect=correct(noHint);     // 혼자 정답률

  // 포기('모르겠어')·넘어가기(스킵) 빈도
  const giveupRate=rate(giveups.length,study.length+giveups.length);
  const skipRate=rate(skips.length,study.length+skips.length);

  // 재도전율: 오답 후 4일 내 같은 개념을 다시 잡았는가 (끈기의 행동 정의)
  const byConcept={};
  for(const a of attempts){const k=(a.deckId||"")+"|"+(a.concept||a.nodeId||"");(byConcept[k]=byConcept[k]||[]).push(a.t);}
  const wrongs=graded.filter(a=>a.verdict!=="correct");
  const retried=wrongs.filter(a=>{
    const k=(a.deckId||"")+"|"+(a.concept||a.nodeId||"");
    return(byConcept[k]||[]).some(t2=>t2>a.t&&t2-a.t<4*DAY);
  });
  const retryRate=rate(retried.length,wrongs.length);

  // 풀이 시간: 평균 + 최근 4주 vs 이전 (빨라지고 있는가)
  const durs=graded.filter(a=>a.dur>0);
  const avg=(list)=>list.length?Math.round(list.reduce((s,a)=>s+a.dur,0)/list.length):null;
  const now=attempts.length?attempts[attempts.length-1].t:Date.now();
  const avgDur=avg(durs);
  const durRecent=avg(durs.filter(a=>now-a.t<28*DAY));
  const durPrev=avg(durs.filter(a=>now-a.t>=28*DAY&&now-a.t<56*DAY));

  // OCR 재작성(필기 명료성) 빈도
  const ocrRate=rate(study.filter(a=>(a.ocr||0)>0).length,study.length);

  return{n:graded.length,studyN:study.length,
    hintRate,hintN:withHint.length,hintCorrect,soloCorrect,
    giveupRate,giveupN:giveups.length,skipRate,skipN:skips.length,
    retryRate,wrongN:wrongs.length,avgDur,durRecent,durPrev,ocrRate};
}

/* 프로파일 → 상담용 해석 문장들 [{tone:'warn'|'good'|'info', text}] */
function habitInsights(h,t){
  t=t||((ko)=>ko);
  const out=[];
  if(h.hintRate!=null&&h.studyN>=8){
    if(h.hintRate>=0.4)out.push({tone:"warn",text:t("힌트 의존도가 높아요 — 문제의 "+Math.round(h.hintRate*100)+"%에서 힌트를 찾았어요. 혼자 첫 발을 떼는 훈련이 필요해요.")});
    else if(h.hintRate<=0.1&&h.giveupRate!=null&&h.giveupRate<=0.1)out.push({tone:"good",text:t("혼자 힘으로 부딪히는 비율이 높아요 — 자기주도 신호가 좋아요.")});
  }
  if(h.hintCorrect!=null&&h.soloCorrect!=null&&h.hintN>=4&&h.hintCorrect-h.soloCorrect>=0.25)
    out.push({tone:"warn",text:t("힌트가 있으면 풀고(정답률 "+Math.round(h.hintCorrect*100)+"%) 없으면 막히는(정답률 "+Math.round(h.soloCorrect*100)+"%) 패턴 — 개념이 아니라 '시작 전략'이 병목이에요.")});
  if(h.giveupRate!=null&&h.giveupRate>=0.2)
    out.push({tone:"warn",text:t("'모르겠어' 포기가 잦아요("+Math.round(h.giveupRate*100)+"%) — 문제 난이도를 한 단계 낮춰 성공 경험부터 쌓는 게 좋아요.")});
  if(h.retryRate!=null&&h.wrongN>=5){
    if(h.retryRate>=0.6)out.push({tone:"good",text:t("틀린 문제의 "+Math.round(h.retryRate*100)+"%를 며칠 안에 다시 잡았어요 — 끈기가 자산이에요.")});
    else if(h.retryRate<=0.25)out.push({tone:"warn",text:t("틀린 문제를 다시 안 잡는 편이에요(재도전 "+Math.round(h.retryRate*100)+"%) — 오답 복습 루틴이 필요해요.")});
  }
  if(h.durRecent!=null&&h.durPrev!=null&&h.durPrev>0){
    const d=(h.durRecent-h.durPrev)/h.durPrev;
    if(d<=-0.2)out.push({tone:"good",text:t("풀이 속도가 빨라지고 있어요 ("+h.durPrev+"초 → "+h.durRecent+"초) — 절차가 자동화되는 중.")});
  }
  return out;
}

export { habitProfile, habitInsights };
