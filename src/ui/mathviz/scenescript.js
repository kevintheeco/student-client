// scenescript — 장면 스크립트(§2-1)의 공용 계약: 파서·검증기 + AI 프롬프트 스키마.
// AI 그림 변환(ExamBank)·AI 비전 인식(geointeract)·해설 렌더(MathText)·백테스트가 전부 이 하나를 쓴다.
// React·DOM 무관 — core에서도, node 테스트에서도 안전하게 import 가능.
import { tryCompileExpr } from "./exprparser.js";
import { findIntersections } from "./mathcore.js";

// AI 응답·JSON 가져오기가 장면 스크립트로 렌더 가능한 형태인지 (신뢰 불가 데이터의 관문)
function isSceneScript(o){
  return !!(o && typeof o==="object" && !Array.isArray(o)
    && o.view && Array.isArray(o.view.x) && o.view.x.length===2
    && Array.isArray(o.view.y) && o.view.y.length===2
    && o.view.x.every(Number.isFinite) && o.view.y.every(Number.isFinite)
    && Array.isArray(o.steps) && o.steps.length>0 && o.steps.length<=40
    && o.steps.every(s=>s && typeof s.type==="string"));
}

// AI에게 주는 스키마 계약 (컴팩트 — 프롬프트에 그대로 삽입)
const SCENE_SCHEMA_PROMPT=
'장면 스크립트 JSON 스키마:\n'+
'{"version":1,"theme":"algebra|geometry|sequence","view":{"x":[x0,x1],"y":[y0,y1]},"steps":[…]}\n'+
'step 종류(이것만 사용):\n'+
'{"type":"axes","ticks":1}\n'+
'{"type":"plot","id":"f","expr":"exp(x)-2","domain":[a,b],"color":"accent|chalk"}\n'+
'{"type":"asymptote","axis":"h|v","at":수,"label":"y=-2"}\n'+
'{"type":"intercepts","of":"f"} {"type":"intersections","of":["f","g"]} {"type":"extrema","of":"f"} {"type":"inflections","of":"f"}\n'+
'{"type":"tangent","of":"f","at":x0}\n'+
'{"type":"area","between":["f","g"],"range":"auto-intersections"}\n'+
'{"type":"point","at":[x,y],"label":"(1,\\\\,2)"} {"type":"guide","at":[x,y]}\n'+
'{"type":"segment","from":[x,y],"to":[x,y],"color":"chalk|fix","dash":true여부,"label":"선분 라벨"}\n'+
'{"type":"vector","from":[x,y],"to":[x,y],"label":"\\\\vec{a}","color":"accent|chalk|point"} — 벡터·투영 다이어그램은 반드시 이걸로(화살촉 자동)\n'+
'{"type":"angle","at":[꼭짓점],"from":[한 방향 위 점],"to":[다른 방향 위 점],"label":"θ"} — 각 표시 호 자동\n'+
'{"type":"conic","kind":"ellipse|hyperbola|parabola","a":수,"b":수,"p":수,"show":["asymptotes","foci","vertices"]}\n'+
'{"type":"formula","tex":"결론 수식","box":true} {"type":"lines","tex":["유도1","결론"],"mutedExceptLast":true}\n'+
'{"type":"chip","text":"용어"} {"type":"pill","text":"한 줄 요약"}\n'+
'규칙: ① expr는 사칙·^·sin·cos·tan·exp·log·ln·sqrt·abs·pi·e·x만 ② 교점·절편·극점·변곡점·초점 좌표를 직접 쓰지 말고 intercepts/intersections/extrema/inflections/conic 스텝으로 자동 계산시켜라 ③ plot의 domain은 정의역 안으로(log 등) ④ lines는 6줄 이하 ⑤ tex 안 백슬래시는 \\\\로 이스케이프 ⑥ 라벨에 유니코드 조합문자(b⃗의 ⃗ 등) 금지 — 벡터는 \\\\vec{b}로 쓰면 렌더러가 처리 ⑦ 축이 필요 없는 도형(벡터 다이어그램 등)은 axes 스텝을 생략해도 된다(view는 도형이 다 들어가게).';

// ── 관대한 JSON 파스: AI가 자주 내는 사소한 위반(트레일링 콤마·스마트따옴표·주석) 복구 ──
function _tolerantJson(s){
  try{return JSON.parse(s);}catch(_){/* 복구 시도 */}
  const t=String(s)
    .replace(/[“”]/g,'"').replace(/[‘’]/g,"'")
    .replace(/\/\*[\s\S]*?\*\//g,"")
    .replace(/^\s*\/\/.*$/gm,"")
    .replace(/,\s*([}\]])/g,"$1");
  try{return JSON.parse(t);}catch(_){return null;}
}

// ```mathviz(또는 ```json) 코드블록 텍스트 → 장면 스크립트 객체 | null
function parseSceneBlock(seg){
  const body=String(seg).replace(/^\s*```[a-z]*\s*/i,"").replace(/```\s*$/,"");
  const a=body.indexOf("{"),b=body.lastIndexOf("}");
  if(a<0||b<=a)return null;
  const o=_tolerantJson(body.slice(a,b+1));
  return isSceneScript(o)?o:null;
}

/* ── 정밀 검증: 렌더 가능성까지 검사 (expr 컴파일·plot id 참조·정의역 수치 샘플·교점 수) ──
   AI 산출물의 저장 관문(벡터로 변환·recognizeAI)과 백테스트가 사용. {ok, errors[]} */
const STEP_TYPES=new Set(["axes","plot","asymptote","intercepts","intersections","extrema",
  "inflections","tangent","area","point","guide","segment","vector","angle","conic","formula","lines","chip","pill"]);
function validateScript(script){
  const errors=[];
  if(!isSceneScript(script)){
    errors.push("구조: view{x:[a,b],y:[a,b]}·steps[1~40] 형식이 아님");
    return {ok:false,errors};
  }
  const err=(i,m)=>errors.push("step"+i+"("+(script.steps[i].type||"?")+"): "+m);
  const [vx0,vx1]=script.view.x,[vy0,vy1]=script.view.y;
  if(!(vx1>vx0&&vy1>vy0))errors.push("view: 범위가 역전됨");
  const plots={};
  const finiteN=(v)=>typeof v==="number"&&Number.isFinite(v);
  const finitePair=(p)=>Array.isArray(p)&&p.length===2&&p.every(finiteN);
  script.steps.forEach((s,i)=>{
    if(!STEP_TYPES.has(s.type)){err(i,"알 수 없는 type");return;}
    switch(s.type){
      case "plot":{
        if(typeof s.expr!=="string"){err(i,"expr 없음");return;}
        const {f,error}=tryCompileExpr(s.expr);
        if(!f){err(i,"expr 컴파일 실패 — "+error);return;}
        let d=[vx0,vx1];
        if(s.domain!=null){
          if(Array.isArray(s.domain)&&s.domain.length===2&&s.domain.every(finiteN)&&s.domain[1]>s.domain[0])d=s.domain;
          else{err(i,"domain은 [작은수,큰수]");return;}
        }
        const n=40;let fin=0;
        for(let k=0;k<=n;k++)if(Number.isFinite(f(d[0]+(d[1]-d[0])*k/n)))fin++;
        if(fin<(n+1)*0.5)err(i,"domain 절반 이상에서 정의되지 않음(NaN) — 정의역을 좁혀라");
        plots[s.id||("f"+i)]={f,domain:d};
        break;
      }
      case "intercepts": case "extrema": case "inflections":
        if(!plots[s.of])err(i,"of='"+s.of+"' — 앞선 plot id가 아님");
        break;
      case "tangent":
        if(!plots[s.of])err(i,"of='"+s.of+"' — 앞선 plot id가 아님");
        else if(!finiteN(s.at))err(i,"at은 숫자");
        break;
      case "intersections":{
        const o=s.of;
        if(!Array.isArray(o)||o.length!==2||!plots[o[0]]||!plots[o[1]])
          err(i,"of는 앞선 plot id 2개 배열");
        break;
      }
      case "area":{
        const b=s.between;
        if(!Array.isArray(b)||!plots[b[0]]||(b[1]!=null&&!plots[b[1]])){err(i,"between이 앞선 plot id가 아님");break;}
        if(s.range==null||s.range==="auto-intersections"){
          const A=plots[b[0]],B=b[1]!=null?plots[b[1]]:{f:()=>0,domain:[vx0,vx1]};
          const lo=Math.max(A.domain[0],B.domain[0]),hi=Math.min(A.domain[1],B.domain[1]);
          if(!(hi>lo)||findIntersections(A.f,B.f,lo,hi).length<2)
            err(i,"auto-intersections인데 공통 정의역에서 교점이 2개 미만");
        }else if(!(Array.isArray(s.range)&&s.range.length===2&&s.range.every(finiteN)))
          err(i,"range는 'auto-intersections' 또는 [x0,x1]");
        break;
      }
      case "asymptote":
        if(s.axis!=="h"&&s.axis!=="v")err(i,"axis는 h|v");
        if(!finiteN(s.at))err(i,"at은 숫자");
        break;
      case "point": case "guide":
        if(!finitePair(s.at))err(i,"at은 [x,y]");
        break;
      case "segment": case "vector":
        if(!finitePair(s.from)||!finitePair(s.to))err(i,"from/to는 [x,y]");
        break;
      case "angle":
        if(!finitePair(s.at)||!finitePair(s.from)||!finitePair(s.to))err(i,"at/from/to는 [x,y]");
        break;
      case "conic":
        if(s.kind==="ellipse"||s.kind==="hyperbola"){if(!(s.a>0&&s.b>0))err(i,s.kind+"는 a>0,b>0");}
        else if(s.kind==="parabola"){if(!finiteN(s.p)||s.p===0)err(i,"parabola는 p≠0");}
        else err(i,"kind는 ellipse|hyperbola|parabola");
        break;
      case "formula":
        if(typeof s.tex!=="string"||!s.tex.trim())err(i,"tex 필요");
        break;
      case "lines":{
        const arr=Array.isArray(s.tex)?s.tex:[s.tex];
        if(!arr.length||!arr.every(t=>typeof t==="string"))err(i,"tex는 문자열 배열");
        else if(arr.length>6)err(i,"유도 6줄 초과(§1-⑥ 금지)");
        break;
      }
      case "chip": case "pill":
        if(typeof s.text!=="string"||!s.text.trim())err(i,"text 필요");
        break;
    }
  });
  return {ok:errors.length===0,errors};
}

export { isSceneScript, parseSceneBlock, validateScript, SCENE_SCHEMA_PROMPT };
