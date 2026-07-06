// mathcore — 고교수학 특이점 자동 계산층 (검증된 mathtools.py 로직의 JS 포팅)
// 교점·절편·극점·변곡점·초점을 함수식에서 수치 탐색으로 자동 계산한다 — 좌표 하드코딩 금지(§8).
// 전부 순수 함수(React/DOM 무관) — node --test로 단위 테스트한다.

// 정의역 밖(log 등)·예외·무한대는 전부 NaN으로 (mathtools _safe 등가)
function safeFn(f){
  return (x)=>{let v;try{v=f(x);}catch{return NaN;}return Number.isFinite(v)?v:NaN;};
}

// 부호가 다른 [a,b]에서 이분법으로 근을 조인다 (brentq 대체, |b-a|<tol까지)
function bisect(f,a,b,tol=1e-9){
  let fa=f(a);
  const fb=f(b);
  if(fa===0)return a;
  if(fb===0)return b;
  for(let i=0;i<80&&(b-a)>tol;i++){
    const m=(a+b)/2,fm=f(m);
    if(fm===0)return m;
    if(fa*fm<0){b=m;}else{a=m;fa=fm;}
  }
  return (a+b)/2;
}

// f(x)=0 해 목록 — 부호 변화 구간을 이분법으로 정밀화 (절편·교점 공용)
function findRoots(f,xMin,xMax,n=800,tol=1e-9){
  const g=safeFn(f);
  const roots=[];
  const xs=new Array(n),ys=new Array(n);
  for(let i=0;i<n;i++){xs[i]=xMin+(xMax-xMin)*i/(n-1);ys[i]=g(xs[i]);}
  for(let i=0;i<n-1;i++){
    const a=ys[i],b=ys[i+1];
    if(Number.isNaN(a)||Number.isNaN(b))continue;
    if(a===0)roots.push(xs[i]);
    else if(a*b<0)roots.push(bisect(g,xs[i],xs[i+1],tol));
  }
  const out=[];   // 인접 중복 제거
  for(const r of roots)if(!out.length||Math.abs(r-out[out.length-1])>1e-6)out.push(r);
  return out;
}

// 두 그래프의 교점 [[x,y],...] — 접점(중근)도 포함.
// 접하는 경우(이차함수와 직선 y=x², y=2x-1 등)는 f-g가 부호를 안 바꿔 스캔이 놓치므로,
// (f-g)'=0인 극점에서 |f-g|≈0이면 접점으로 추가한다 (고교수학 단골 케이스).
function findIntersections(f,g,xMin,xMax,n=800){
  const sf=safeFn(f),sg=safeFn(g);
  const h=(t)=>sf(t)-sg(t);
  const xs=findRoots(h,xMin,xMax,n);
  for(const x of findRoots((t)=>d1(h,t),xMin,xMax,n)){
    const v=h(x);
    if(Number.isFinite(v)&&Math.abs(v)<1e-6&&!xs.some(r=>Math.abs(r-x)<1e-4))xs.push(x);
  }
  xs.sort((a,b)=>a-b);
  return xs.map((x)=>[x,sf(x)]);
}

// 중앙차분 수치미분
function d1(f,x,h=1e-5){return (f(x+h)-f(x-h))/(2*h);}
function d2(f,x,h=1e-4){return (f(x+h)-2*f(x)+f(x-h))/(h*h);}

// 극점 [{x,y,kind:'max'|'min'}] — f'=0을 찾아 f'' 부호로 분류
function findExtrema(f,xMin,xMax,n=800){
  const g=safeFn(f),out=[];
  for(const x of findRoots((t)=>d1(g,t),xMin,xMax,n)){
    const k=d2(g,x);
    if(Math.abs(k)>1e-7)out.push({x,y:g(x),kind:k<0?"max":"min"});
  }
  return out;
}

// 변곡점 [[x,y],...] — f''=0 + 좌우 부호 변화 검증
function findInflections(f,xMin,xMax,n=800){
  const g=safeFn(f),out=[];
  for(const x of findRoots((t)=>d2(g,t),xMin,xMax,n)){
    if(d2(g,x-1e-3)*d2(g,x+1e-3)<0)out.push([x,g(x)]);
  }
  return out;
}

// x절편 [[x,0],...] — 접하는 절편(중근, y=(x-1)² 등)도 포함 / y절편 [0,f(0)] — 정의 안 되면 null
function xIntercepts(f,xMin,xMax){
  const sf=safeFn(f);
  const xs=findRoots(sf,xMin,xMax);
  for(const x of findRoots((t)=>d1(sf,t),xMin,xMax)){
    const v=sf(x);
    if(Number.isFinite(v)&&Math.abs(v)<1e-6&&!xs.some(r=>Math.abs(r-x)<1e-4))xs.push(x);
  }
  xs.sort((a,b)=>a-b);
  return xs.map((x)=>[x,0]);
}
function yIntercept(f){
  const v=safeFn(f)(0);
  return Number.isNaN(v)?null:[0,v];
}

// 초점 자동 계산 — ellipse: c²=a²−b² / hyperbola: c²=a²+b² / parabola: (p,0)
function conicFoci(kind,a,b,p){
  if(kind==="ellipse"){
    if(b>a){const c=Math.sqrt(b*b-a*a);return[[0,c],[0,-c]];}   // 세로 장축(b>a)이면 초점은 y축 위
    const c=Math.sqrt(a*a-b*b);return[[c,0],[-c,0]];
  }
  if(kind==="hyperbola"){const c=Math.sqrt(a*a+b*b);return[[c,0],[-c,0]];}
  if(kind==="parabola")return[[p,0]];
  throw new Error("conicFoci: 알 수 없는 종류 '"+kind+"'");
}

// A에서 직선 BC로의 수선의 발 — 기하 상호작용 엔진 공용 (PoC foot 포팅)
function projectFoot(A,B,C){
  const bx=C[0]-B[0],by=C[1]-B[1];
  const L2=bx*bx+by*by;
  if(L2===0)return[B[0],B[1]];
  const t=((A[0]-B[0])*bx+(A[1]-B[1])*by)/L2;
  return[B[0]+t*bx,B[1]+t*by];
}

// ── 이차곡선 점열 샘플러 (렌더러용 — 수학은 여기서 끝내고 렌더러는 그리기만) ──
// 타원 x²/a²+y²/b²=1
function ellipsePoints(a,b,n=120){
  const pts=[];
  for(let i=0;i<=n;i++){const t=2*Math.PI*i/n;pts.push([a*Math.cos(t),b*Math.sin(t)]);}
  return pts;
}
// 쌍곡선 x²/a²−y²/b²=1 — 우·좌 branch 두 점열
function hyperbolaPoints(a,b,tMax,n=80){
  return [1,-1].map((s)=>{
    const pts=[];
    for(let i=0;i<=n;i++){const t=-tMax+2*tMax*i/n;pts.push([s*a*Math.cosh(t),b*Math.sinh(t)]);}
    return pts;
  });
}
// 포물선 y²=4px
function parabolaPoints(p,yMax,n=100){
  const pts=[];
  for(let i=0;i<=n;i++){const t=-yMax+2*yMax*i/n;pts.push([t*t/(4*p),t]);}
  return pts;
}

export {
  safeFn, findRoots, findIntersections, d1, d2,
  findExtrema, findInflections, xIntercepts, yIntercept,
  conicFoci, projectFoot,
  ellipsePoints, hyperbolaPoints, parabolaPoints,
};
