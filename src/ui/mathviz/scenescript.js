// scenescript — 장면 스크립트(§2-1)의 공용 계약: 검증기 + AI 프롬프트 스키마.
// AI 그림 변환(ExamBank)·AI 비전 인식(geointeract)·해설 그래프 생성(RICH_FMT)이 전부 이 하나를 쓴다.
// 의존성 0(React·DOM 무관) — core에서도 안전하게 import 가능.

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
'{"type":"segment","from":[x,y],"to":[x,y],"color":"chalk|fix","dash":true여부}\n'+
'{"type":"conic","kind":"ellipse|hyperbola|parabola","a":수,"b":수,"p":수,"show":["asymptotes","foci","vertices"]}\n'+
'{"type":"formula","tex":"결론 수식","box":true} {"type":"lines","tex":["유도1","결론"],"mutedExceptLast":true}\n'+
'{"type":"chip","text":"용어"} {"type":"pill","text":"한 줄 요약"}\n'+
'규칙: ① expr는 사칙·^·sin·cos·tan·exp·log·ln·sqrt·abs·pi·e·x만 ② 교점·절편·극점·변곡점·초점 좌표를 직접 쓰지 말고 intercepts/intersections/extrema/inflections/conic 스텝으로 자동 계산시켜라 ③ plot의 domain은 정의역 안으로(log 등) ④ lines는 6줄 이하 ⑤ tex 안 백슬래시는 \\\\로 이스케이프.';

export { isSceneScript, SCENE_SCHEMA_PROMPT };
