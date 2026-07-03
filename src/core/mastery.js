/* ── 숙련도·요인 추정 (시도 로그 → 통계) ──
   v1은 해석 가능한 투명한 모델을 쓴다:
   · 노드 숙련도: 시도 점수의 지수가중이동평균(EWMA, α=0.3) — 최근 수행에 민감
   · 요인 성장: 주 단위 버킷 평균 + 최소제곱 선형회귀 기울기(성장률)
   · 생산적 성향(pd): 행동 지표 — 오답 후 재도전율 + 후속질문(소크라테스 루프) 참여율
   로드맵: 데이터가 쌓이면 BKT(Corbett & Anderson 1994)·IRT로 교체 가능한 인터페이스. */

const DAY=864e5,WEEK=7*DAY;
const VSCORE={correct:1,partial:0.5,incorrect:0};
// 시도 1건의 0~1 점수: 시험이면 배점 비율, 아니면 verdict 매핑.
// 실수(slip)로 분류된 오답은 하한 0.6 — 개념은 아는 상태이므로 숙련도를 덜 깎는다(BKT slip의 근사).
function scoreOf(a){
  let s;
  if(typeof a.score==="number"&&typeof a.points==="number"&&a.points>0)
    s=Math.max(0,Math.min(1,a.score/a.points));
  else s=VSCORE[a.verdict]??0.5;
  if(a.err==="slip")s=Math.max(s,0.6);
  return s;
}

/* 노드(또는 전체)의 오류 유형 분포: {slip:n, concept:n, ...} + 평균 풀이 시간 */
function errBreakdown(attempts,nodeId){
  const out={n:0,err:{},durSum:0,durN:0};
  for(const a of attempts){
    if(nodeId&&a.nodeId!==nodeId)continue;
    if(a.src==="followup"||a.src==="skip")continue;
    out.n++;
    if(a.err&&a.err!=="none")out.err[a.err]=(out.err[a.err]||0)+1;
    if(a.dur){out.durSum+=a.dur;out.durN++;}
  }
  out.avgDur=out.durN?Math.round(out.durSum/out.durN):null;
  return out;
}

/* 시도 배열에서 오개념 라벨 빈도(데모 데이터도 동작): [{label,n}] 빈도순 */
function miscBreakdown(attempts,nodeId,minN){
  const m={};
  for(const a of attempts){
    if(nodeId&&a.nodeId!==nodeId)continue;
    if(!a.misc)continue;
    const k=String(a.misc).trim();
    (m[k]=m[k]||{label:k,n:0}).n++;
  }
  return Object.values(m).filter(e=>e.n>=(minN||1)).sort((a,b)=>b.n-a.n);
}

/* 노드별 숙련도: {nodeId:{m:EWMA 0~1, n, lastT, recent:[최근점수]}} */
function masteryByNode(attempts){
  const out={};
  for(const a of attempts){
    if(!a.nodeId)continue;
    const s=scoreOf(a);
    const cur=out[a.nodeId]||(out[a.nodeId]={m:null,n:0,lastT:0,recent:[]});
    cur.m=cur.m==null?s:cur.m*0.7+s*0.3;
    cur.n++;cur.lastT=a.t||0;
    cur.recent.push(s);if(cur.recent.length>10)cur.recent.shift();
  }
  return out;
}

/* 최소제곱 선형회귀: pts=[{x,y}] → {slope,intercept} */
function linreg(pts){
  const n=pts.length;
  if(n<2)return{slope:0,intercept:pts[0]?pts[0].y:0};
  let sx=0,sy=0,sxx=0,sxy=0;
  for(const p of pts){sx+=p.x;sy+=p.y;sxx+=p.x*p.x;sxy+=p.x*p.y;}
  const d=n*sxx-sx*sx;
  const slope=d?(n*sxy-sx*sy)/d:0;
  return{slope,intercept:(sy-slope*sx)/n};
}

/* 주 단위 버킷: 각 요인의 {t(주 시작), avg 0~1, n} 시계열.
   cu·pf·sc·ar는 AI 요인 평가에서, pd는 행동 지표에서 계산. */
function factorSeries(attempts,weeks=12){
  const now=Date.now();
  const start=now-weeks*WEEK;
  const buckets=[];   // [{t, sums:{cu:[..]}, wrong:[], retried, followups}]
  for(let i=0;i<weeks;i++)buckets.push({t:start+i*WEEK,sums:{cu:[],pf:[],sc:[],ar:[]},wrongKeys:[],followN:0,gradedN:0});
  const idxOf=(t)=>{const i=Math.floor((t-start)/WEEK);return(i>=0&&i<weeks)?i:-1;};
  // 오답 후 재도전 판정용: 개념별 시도 시각 목록
  const byConcept={};
  for(const a of attempts){const k=a.deckId?a.deckId+"|"+a.concept:a.nodeId||a.concept;(byConcept[k]=byConcept[k]||[]).push(a.t);}
  for(const a of attempts){
    const i=idxOf(a.t);if(i<0)continue;
    const b=buckets[i];
    if(a.src==="skip")continue;   // 스킵은 습관 지표(habits.js)에서만 다룸
    if(a.factors)for(const f of ["cu","pf","sc","ar"])if(typeof a.factors[f]==="number")b.sums[f].push(a.factors[f]);
    if(a.src!=="followup"){
      b.gradedN++;
      if(scoreOf(a)<1){
        const k=a.deckId?a.deckId+"|"+a.concept:a.nodeId||a.concept;
        const retried=(byConcept[k]||[]).some(t2=>t2>a.t&&t2-a.t<4*DAY);
        b.wrongKeys.push(retried?1:0);
      }
    }else b.followN++;
  }
  const avg=(arr)=>arr.length?arr.reduce((s,v)=>s+v,0)/arr.length:null;
  const out={cu:[],pf:[],sc:[],ar:[],pd:[]};
  buckets.forEach((b,i)=>{
    for(const f of ["cu","pf","sc","ar"])out[f].push({t:b.t,i,avg:avg(b.sums[f]),n:b.sums[f].length});
    // pd(끈기): 오답 재도전율 70% + 후속질문 참여율 30%
    let pd=null;
    if(b.wrongKeys.length){
      const retry=avg(b.wrongKeys);
      const follow=b.gradedN?Math.min(1,b.followN/Math.max(1,b.wrongKeys.length)):0;
      pd=retry*0.7+follow*0.3;
    }else if(b.followN>0)pd=1;
    out.pd.push({t:b.t,i,avg:pd,n:b.wrongKeys.length+b.followN});
  });
  return out;
}

/* 요인 요약: {cu:{cur,prev,delta,slope,n}, ...}
   cur=최근 4주 평균, prev=그 이전 4주, slope=주당 변화량(회귀) */
function factorSummary(attempts,weeks=12){
  const series=factorSeries(attempts,weeks);
  const out={};
  for(const f in series){
    const pts=series[f].filter(p=>p.avg!=null);
    const cur=avgOf(pts.filter(p=>p.i>=weeks-4));
    const prev=avgOf(pts.filter(p=>p.i>=weeks-8&&p.i<weeks-4));
    const{slope}=linreg(pts.map(p=>({x:p.i,y:p.avg})));
    out[f]={cur,prev,delta:(cur!=null&&prev!=null)?cur-prev:null,
      slope:pts.length>=2?slope:null,n:pts.reduce((s,p)=>s+p.n,0)};
  }
  return out;
}
function avgOf(pts){
  if(!pts.length)return null;
  return pts.reduce((s,p)=>s+p.avg,0)/pts.length;
}

/* 노드별 성장 추세: 시도 4회 이상 노드의 점수 vs 시간 회귀 기울기(일당) */
function nodeTrends(attempts){
  const by={};
  for(const a of attempts){if(a.nodeId&&a.src!=="skip")(by[a.nodeId]=by[a.nodeId]||[]).push(a);}
  const out=[];
  for(const id in by){
    const list=by[id];if(list.length<4)continue;
    const t0=list[0].t;
    const{slope}=linreg(list.map(a=>({x:(a.t-t0)/WEEK,y:scoreOf(a)})));
    out.push({id,n:list.length,slope});   // slope = 주당 숙련도 변화
  }
  return out.sort((a,b)=>b.slope-a.slope);
}

export { DAY, WEEK, scoreOf, errBreakdown, miscBreakdown, masteryByNode, linreg, factorSeries, factorSummary, nodeTrends };
