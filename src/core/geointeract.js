// geointeract — 기하 상호작용 엔진: 손글씨 스트로크 → 도형 인식 → 정답 모델 비교 (§4)
// 검증된 브라우저 PoC(geo-interaction-poc.html)의 규칙 기반 로직을 그대로 이식.
// 전부 순수 함수(DOM 무관) — node --test로 단위 테스트한다.
// 2차 인식(AI 비전 → 장면 스크립트)은 5단계에서 recognizeAI로 추가 예정.
import { projectFoot } from "../ui/mathviz/mathcore.js";

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

/* 비교(diff): 학생 모델 vs 요구사항 → {correct, missing, wrong, extra}
   requirements.aux: 필요한 보조선 목록 (기본: 높이). 5단계 기출은행 정답 모델도 이 계약 사용 */
const AUX_LABEL={height:"높이 AH"};
function compare(model, requirements){
  const req=requirements||{aux:["height"]};
  const out={correct:[], missing:[], wrong:[], extra:[]};
  if(!model||!model.ok){
    out.missing.push({kind:"shape",label:"삼각형"});
    return out;
  }
  for(const v of ["A","B","C"])out.correct.push({kind:"vertex",label:v});
  for(const s of ["AB","BC","CA"])out.correct.push({kind:"side",label:s});
  for(const auxKind of (req.aux||[])){
    const found=(model.aux||[]).find(a=>a.kind===auxKind);
    const item={kind:"auxline",label:AUX_LABEL[auxKind]||auxKind,aux:auxKind};
    if(found&&found.drawn)out.correct.push(item);
    else out.missing.push(item);
  }
  return out;
}

export {
  dist, distToLine, rdp, hull, bestTriangle, isStraight,
  normalizeStrokes, recognize, compare,
};
