// exprparser — 장면 스크립트의 expr 문자열을 안전한 f(x)로 컴파일 (벡터수학엔진 §2-1)
// eval/new Function 금지: 화이트리스트 토크나이저 + 재귀 하강 파서만 사용.
// 지원: 사칙, ^(우결합), sin·cos·tan·exp·log·ln·sqrt·abs, pi·e, 변수 x — 그 외 전부 파스 에러.

const FN={sin:Math.sin,cos:Math.cos,tan:Math.tan,exp:Math.exp,log:Math.log,ln:Math.log,sqrt:Math.sqrt,abs:Math.abs};
const CONST={pi:Math.PI,e:Math.E};

// AI·사람이 실제로 쓰는 수학 표기를 표준형으로 정규화 (화이트리스트는 그대로 — 허용 문자만 늘림)
const SUPS={"⁰":"0","¹":"1","²":"2","³":"3","⁴":"4","⁵":"5","⁶":"6","⁷":"7","⁸":"8","⁹":"9"};
function _pre(src){
  let s=String(src)
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g,(m)=>"^"+[...m].map(c=>SUPS[c]).join(""))  // x² → x^2
    .replace(/\*\*/g,"^")                    // 파이썬식 거듭제곱
    .replace(/[−–]/g,"-")                    // 유니코드 마이너스·대시
    .replace(/[×·⋅]/g,"*").replace(/÷/g,"/")
    .replace(/π/g,"pi")
    .replace(/√\s*\(/g,"sqrt(").replace(/√\s*([\w.]+)/g,"sqrt($1)");
  const m=s.match(/^\s*[a-zA-Z]\w*\s*(\(\s*[a-zA-Z]\s*\))?\s*=\s*/);     // "y=" / "f(x)=" 접두 → 우변만
  if(m)s=s.slice(m[0].length);
  return s;
}

function tokenize(src){
  const toks=[];let i=0;
  while(i<src.length){
    const c=src[i];
    if(c===" "||c==="\t"||c==="\n"||c==="\r"){i++;continue;}
    if(/[0-9.]/.test(c)){
      let j=i;while(j<src.length&&/[0-9.]/.test(src[j]))j++;
      // 과학적 표기(1e-5)는 e 뒤에 숫자가 올 때만 — "2e"는 2×자연상수로 남긴다
      if(j<src.length&&(src[j]==="e"||src[j]==="E")){
        let k=j+1;if(k<src.length&&(src[k]==="+"||src[k]==="-"))k++;
        if(k<src.length&&/[0-9]/.test(src[k])){while(k<src.length&&/[0-9]/.test(src[k]))k++;j=k;}
      }
      const s=src.slice(i,j),v=Number(s);
      if(!Number.isFinite(v))throw new Error("expr: 숫자 오류 '"+s+"'");
      toks.push({t:"num",v});i=j;continue;
    }
    if(/[a-zA-Z_]/.test(c)){
      let j=i;while(j<src.length&&/[a-zA-Z_]/.test(src[j]))j++;
      toks.push({t:"id",v:src.slice(i,j)});i=j;continue;
    }
    if("+-*/^()".includes(c)){toks.push({t:c});i++;continue;}
    throw new Error("expr: 허용되지 않는 문자 '"+c+"'");
  }
  return _implicitMul(toks);
}

// 암시적 곱셈: 2x·2sin(x)·x(x-1)·(x-1)(x+2)·2pi 등 표준 수학 표기 (함수 호출 sin( 은 예외)
function _implicitMul(toks){
  const isValueEnd=(t)=>t.t==="num"||t.t===")"||(t.t==="id"&&!(t.v in FN));
  const isValueStart=(t)=>t.t==="num"||t.t==="("||t.t==="id";
  const out=[];
  for(const t of toks){
    const prev=out[out.length-1];
    if(prev&&isValueEnd(prev)&&isValueStart(t))out.push({t:"*"});
    out.push(t);
  }
  return out;
}

// 재귀 하강: expr → term → unary → power → atom. -x^2 = -(x^2), 2^3^2 = 2^(3^2) = 512.
function parse(toks){
  let p=0;
  const peek=()=>toks[p];
  const eat=(t)=>{const k=toks[p];if(!k||k.t!==t)throw new Error("expr: '"+t+"' 필요");p++;return k;};
  function expr(){
    let l=term();
    while(peek()&&(peek().t==="+"||peek().t==="-")){
      const op=toks[p++].t,a=l,b=term();
      l=op==="+"?(x)=>a(x)+b(x):(x)=>a(x)-b(x);
    }
    return l;
  }
  function term(){
    let l=unary();
    while(peek()&&(peek().t==="*"||peek().t==="/")){
      const op=toks[p++].t,a=l,b=unary();
      l=op==="*"?(x)=>a(x)*b(x):(x)=>a(x)/b(x);
    }
    return l;
  }
  function unary(){
    if(peek()&&peek().t==="-"){p++;const a=unary();return (x)=>-a(x);}
    if(peek()&&peek().t==="+"){p++;return unary();}
    return power();
  }
  function power(){
    const base=atom();
    if(peek()&&peek().t==="^"){p++;const ex=unary();return (x)=>Math.pow(base(x),ex(x));}
    return base;
  }
  function atom(){
    const k=peek();
    if(!k)throw new Error("expr: 식이 일찍 끝났습니다");
    if(k.t==="num"){p++;const v=k.v;return ()=>v;}
    if(k.t==="("){p++;const e=expr();eat(")");return e;}
    if(k.t==="id"){
      p++;
      if(peek()&&peek().t==="("){
        const f=FN[k.v];
        if(!f)throw new Error("expr: 허용되지 않는 함수 '"+k.v+"'");
        p++;const arg=expr();eat(")");
        return (x)=>f(arg(x));
      }
      if(k.v==="x"||k.v==="X")return (x)=>x;
      if(Object.prototype.hasOwnProperty.call(CONST,k.v)){const v=CONST[k.v];return ()=>v;}
      throw new Error("expr: 알 수 없는 이름 '"+k.v+"'");
    }
    throw new Error("expr: 예상 못 한 토큰 '"+k.t+"'");
  }
  const f=expr();
  if(p<toks.length)throw new Error("expr: 남은 토큰 '"+(toks[p].v??toks[p].t)+"'");
  return f;
}

// 컴파일 결과 f는 NaN-safe: 정의역 밖·오버플로는 전부 NaN (mathtools _safe 등가)
function compileExpr(src){
  if(typeof src!=="string"||!src.trim())throw new Error("expr: 빈 식");
  const raw=parse(tokenize(_pre(src)));
  return (x)=>{
    let v;
    try{v=raw(x);}catch{return NaN;}
    return Number.isFinite(v)?v:NaN;
  };
}
function tryCompileExpr(src){
  try{return{f:compileExpr(src),error:null};}
  catch(e){return{f:null,error:(e&&e.message)||String(e)};}
}

export { tokenize, compileExpr, tryCompileExpr };
