// geointeract — 기하 상호작용 엔진: 손글씨 스트로크 → 도형 인식 → 정답 모델 비교 (§4)
// 1차: 규칙 기반(오프라인, 즉시) — 검증된 브라우저 PoC 로직 이식. node --test로 단위 테스트.
// 2차: recognizeAI — 스트로크 이미지+지오메트리 요약을 AI 비전에 보내 장면 스크립트로 재구성
//      (ai.js는 함수 안에서 동적 import — 규칙 기반 경로는 브라우저 의존성 0 유지)
import { projectFoot } from "../ui/mathviz/mathcore.js";
import { validateScript, SCENE_SCHEMA_PROMPT } from "../ui/mathviz/scenescript.js";

const dist=(a,b)=>Math.hypot(a[0]-b[0], a[1]-b[1]);

// 점 p에서 직선 ab까지 거리 (PoC distToSeg — 수선의 발 기준, 비클램프)
const distToLine=(p,a,b)=>dist(p, projectFoot(p,a,b));

// Ramer–Douglas–Peucker 단순화 — AI 인식 경로의 지오메트리 요약용(5단계)에도 공용
function rdp(pts, eps=4){
  if(pts.length<3)return pts.slice();
  const a=pts[0], b=pts[pts.length-1];
  let idx=-1, dmax=-1;
  for(let i=1;i<pts.length-1;i++){
    const d=distToLine(pts[i],a,b);
    if(d>dmax){dmax=d;idx=i;}
  }
  if(dmax<=eps)return[a,b];
  const l=rdp(pts.slice(0,idx+1),eps), r=rdp(pts.slice(idx),eps);
  return l.slice(0,-1).concat(r);
}

// convex hull — monotone chain (PoC 이식)
function hull(pts){
  if(pts.length<3)return pts.slice();
  const P=[...pts].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lo=[],hi=[];
  for(const p of P){while(lo.length>1&&cross(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop();lo.push(p);}
  for(const p of P.reverse()){while(hi.length>1&&cross(hi[hi.length-2],hi[hi.length-1],p)<=0)hi.pop();hi.push(p);}
  return lo.slice(0,-1).concat(hi.slice(0,-1));
}

// hull에서 넓이 최대 3점 = 삼각형 꼭짓점 (PoC 이식 — hull이 작아 O(n³) 무해)
function bestTriangle(h){
  let best=null, ba=-1;
  for(let i=0;i<h.length;i++)for(let j=i+1;j<h.length;j++)for(let k=j+1;k<h.length;k++){
    const a=Math.abs((h[j][0]-h[i][0])*(h[k][1]-h[i][1])-(h[k][0]-h[i][0])*(h[j][1]-h[i][1]))/2;
    if(a>ba){ba=a;best=[h[i],h[j],h[k]];}
  }
  return {tri:best, area:ba};
}

// 스트로크 직선성 — 끝점 직선 대비 최대 이탈 < 12%·길이 + 8px (PoC 이식)
function isStraight(s){
  if(!s||s.length<2)return false;
  const a=s[0], b=s[s.length-1], L=dist(a,b);
  if(L<40)return false;
  return s.every(p=>distToLine(p,a,b)<0.12*L+8);
}

// PenPad dump({pages:[[{pts:[{x,y,p}],col,sz}]],w,h}) 또는 [[x,y]...] 배열 → [[[x,y],...],...]
function normalizeStrokes(dump){
  if(Array.isArray(dump))return dump.filter(s=>s&&s.length>1);
  const pg=(dump&&Array.isArray(dump.pages)&&dump.pages[0])||[];
  return pg.map(s=>(s.pts||[]).map(p=>[p.x,p.y])).filter(s=>s.length>1);
}

/* 1차 인식(규칙 기반, 오프라인): 스트로크 → 기하 모델
   삼각형: 전체 점 convex hull → 넓이 최대 3점 = 꼭짓점, 밑변 = 최장변, A = 그 대각.
   보조선(높이): 끝점이 A·H 반경 0.28√area 안에 드는 직선 스트로크가 있으면 drawn. */
function recognize(strokes,{kind="triangle",minArea=8000}={}){
  if(kind!=="triangle")return{ok:false,reason:"unsupported-kind"};
  const all=strokes.flat();
  if(all.length<6)return{ok:false,reason:"empty"};
  const {tri,area}=bestTriangle(hull(all));
  if(!tri||area<minArea)return{ok:false,reason:"too-small"};
  const sides=[[tri[0],tri[1],tri[2]],[tri[1],tri[2],tri[0]],[tri[2],tri[0],tri[1]]]
    .map(([a,b,c])=>({a,b,c,len:dist(a,b)}));
  const base=sides.reduce((x,y)=>x.len>y.len?x:y);
  const A=base.c, B=base.a, C=base.b;          // A=꼭짓점, BC=밑변
  const H=projectFoot(A,B,C);
  const r=0.28*Math.sqrt(area);
  const near=(p,q)=>dist(p,q)<r;
  const heightDrawn=strokes.some(s=>{
    if(!isStraight(s))return false;
    const e1=s[0], e2=s[s.length-1];
    return (near(e1,A)&&near(e2,H))||(near(e2,A)&&near(e1,H));
  });
  return {
    ok:true, kind:"triangle", area,
    vertices:{A,B,C}, foot:H,
    aux:[{kind:"height", from:"A", to:"H", drawn:heightDrawn}],
  };
}

// hull에서 넓이 최대 4점 = 사각형 꼭짓점 (hull 순서 유지 → 둘레 순서 그대로)
function bestQuad(h){
  if(h.length<4)return{quad:null,area:0};
  const tri=(p,q,r)=>Math.abs((q[0]-p[0])*(r[1]-p[1])-(r[0]-p[0])*(q[1]-p[1]))/2;
  let best=null,ba=-1;
  for(let i=0;i<h.length;i++)for(let j=i+1;j<h.length;j++)
    for(let k=j+1;k<h.length;k++)for(let l=k+1;l<h.length;l++){
      const a=tri(h[i],h[j],h[k])+tri(h[i],h[k],h[l]);
      if(a>ba){ba=a;best=[h[i],h[j],h[k],h[l]];}
    }
  return {quad:best,area:ba};
}

/* 사각형 인식: 꼭짓점 4개(hull 최대넓이) + 보조선(대각선 AC 또는 BD) 작도 여부.
   시나리오: 사각형 넓이 → 대각선을 그어 삼각형 2개로 분할 */
function recognizeQuad(strokes,{minArea=8000}={}){
  const all=strokes.flat();
  if(all.length<8)return{ok:false,reason:"empty"};
  const {quad,area}=bestQuad(hull(all));
  if(!quad||area<minArea)return{ok:false,reason:"too-small"};
  const [A,B,C,D]=quad;
  const r=0.28*Math.sqrt(area);
  const near=(p,q)=>dist(p,q)<r;
  let drawn=false,pair="AC";
  for(const s of strokes){
    if(!isStraight(s))continue;
    const e1=s[0],e2=s[s.length-1];
    if((near(e1,A)&&near(e2,C))||(near(e2,A)&&near(e1,C))){drawn=true;pair="AC";break;}
    if((near(e1,B)&&near(e2,D))||(near(e2,B)&&near(e1,D))){drawn=true;pair="BD";break;}
  }
  return {
    ok:true, kind:"quad", area,
    vertices:{A,B,C,D},
    aux:[{kind:"diagonal", pair, drawn}],
  };
}

/* 다각형 변 커버리지 (0~1, 최소 변 기준) — 글씨 hull 가짜 도형 차단 게이트 공용 */
function polygonCoverage(strokes, pts, tol=16, n=14){
  if(!pts||pts.length<3)return 0;
  const all=strokes.flat();
  let worst=1;
  for(let i=0;i<pts.length;i++){
    const p=pts[i], q=pts[(i+1)%pts.length];
    let hit=0;
    for(let k=0;k<=n;k++){
      const s=[p[0]+(q[0]-p[0])*k/n, p[1]+(q[1]-p[1])*k/n];
      if(all.some(pt=>dist(pt,s)<tol))hit++;
    }
    worst=Math.min(worst,hit/(n+1));
  }
  return worst;
}

/* 변 커버리지: 인식된 삼각형의 세 변이 실제 획으로 얼마나 덮였는지 (0~1, 최소값).
   일반 풀이 패드의 '글씨' hull에서 나오는 가짜 삼각형을 걸러낸다 —
   글씨 뭉치는 hull 가장자리를 획이 따라가지 않으므로 커버리지가 낮다. */
function triangleCoverage(strokes, model, tol=16, n=14){
  if(!model||!model.ok)return 0;
  const all=strokes.flat();
  const {A,B,C}=model.vertices;
  let worst=1;
  for(const [p,q] of [[A,B],[B,C],[C,A]]){
    let hit=0;
    for(let k=0;k<=n;k++){
      const s=[p[0]+(q[0]-p[0])*k/n, p[1]+(q[1]-p[1])*k/n];
      if(all.some(pt=>dist(pt,s)<tol))hit++;
    }
    worst=Math.min(worst,hit/(n+1));
  }
  return worst;
}

/* 비교(diff): 학생 모델 vs 요구사항 → {correct, missing, wrong, extra}
   requirements.aux: 필요한 보조선 목록 (기본: 높이). 5단계 기출은행 정답 모델도 이 계약 사용 */
const AUX_LABEL={height:"높이 AH", diagonal:"대각선"};
function compare(model, requirements){
  const isQuad=model&&model.kind==="quad";
  const req=requirements||{aux:[isQuad?"diagonal":"height"]};
  const out={correct:[], missing:[], wrong:[], extra:[]};
  if(!model||!model.ok){
    out.missing.push({kind:"shape",label:isQuad?"사각형":"삼각형"});
    return out;
  }
  const verts=isQuad?["A","B","C","D"]:["A","B","C"];
  const sides=isQuad?["AB","BC","CD","DA"]:["AB","BC","CA"];
  for(const v of verts)out.correct.push({kind:"vertex",label:v});
  for(const s of sides)out.correct.push({kind:"side",label:s});
  for(const auxKind of (req.aux||[])){
    const found=(model.aux||[]).find(a=>a.kind===auxKind);
    const item={kind:"auxline",label:AUX_LABEL[auxKind]||auxKind,aux:auxKind};
    if(found&&found.drawn)out.correct.push(item);
    else out.missing.push(item);
  }
  return out;
}

/* ── 2차 인식: AI 비전 (§4-1-2) ──
   스트로크를 RDP로 요약한 지오메트리 텍스트 + (선택) 렌더 이미지로 AI에 보내
   장면 스크립트 JSON을 받는다. 실패·형식 불일치면 null — 호출부는 규칙 기반으로 폴백. */
function strokeSummary(strokes){
  const all=strokes.flat();
  const h=hull(all).map(p=>[Math.round(p[0]),Math.round(p[1])]);
  const {area}=h.length>=3?bestTriangle(h):{area:0};
  return JSON.stringify({
    strokeCount:strokes.length,
    strokes:strokes.map(s=>({
      points:s.length,
      simplified:rdp(s,6).map(p=>[Math.round(p[0]),Math.round(p[1])]),
      straight:isStraight(s),
    })),
    convexHull:h,
    maxTriangleArea:Math.round(area||0),
  });
}

async function recognizeAI(strokes, pngBase64, opts={}, signal){
  const { callAI }=await import("./ai.js");   // 동적 import — 순수 함수 경로와 분리
  const sys="너는 학생이 손으로 그린 수학 그림(그래프·도형)을 벡터 장면 스크립트로 재구성하는 도구야. "+
    "지오메트리 요약의 좌표(픽셀, y는 아래로 증가)를 근거로 하되 손떨림은 정규화하고, 실제로 그려진 요소만 옮겨. "+
    "view는 그림 전체가 들어가게 잡아. 반드시 JSON만 출력해(코드블록·설명 금지).\n"+SCENE_SCHEMA_PROMPT;
  const blocks=[];
  if(pngBase64)blocks.push({type:"image",source:{type:"base64",media_type:"image/png",data:pngBase64}});
  blocks.push({type:"text",text:"[스트로크 지오메트리 요약]\n"+strokeSummary(strokes)+
    "\n\n학생이 그린 도형을 장면 스크립트 JSON으로 재구성해."+(opts.hint?"\n[문항 맥락] "+opts.hint:"")});
  try{
    const r=await callAI(sys,blocks,true,{maxTok:1600},signal);
    return validateScript(r).ok?r:null;
  }catch(e){
    if(e&&e.name!=="AbortError")console.warn("[geointeract] AI 인식 실패 — 규칙 기반 폴백",e);
    return null;
  }
}

export {
  dist, distToLine, rdp, hull, bestTriangle, bestQuad, isStraight,
  normalizeStrokes, recognize, recognizeQuad, compare,
  triangleCoverage, polygonCoverage, strokeSummary, recognizeAI,
};
