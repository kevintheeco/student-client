// scenescript 단위 테스트 — 블록 파스 관대성 + validateScript 정밀 검증 (백테스트 관문과 동일 코드)
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSceneBlock, validateScript, isSceneScript } from "../scenescript.js";

const GOOD={version:1,theme:"algebra",view:{x:[-3,4.6],y:[-3,4.6]},steps:[
  {type:"axes",ticks:1},
  {type:"plot",id:"f",expr:"exp(x)-2",domain:[-3,1.85],color:"accent"},
  {type:"plot",id:"g",expr:"log(x+2)",domain:[-1.86,4.6],color:"chalk"},
  {type:"intersections",of:["f","g"]},
  {type:"area",between:["f","g"],range:"auto-intersections"},
  {type:"pill",text:"교점이 적분 한계"},
]};

test("정상 스크립트는 validateScript 통과", () => {
  const v=validateScript(GOOD);
  assert.deepEqual(v.errors, []);
  assert.ok(v.ok);
});

test("parseSceneBlock: 트레일링 콤마·주석·```json 라벨 복구", () => {
  const withComma='```mathviz\n{"view":{"x":[-2,2],"y":[-2,2]},"steps":[{"type":"axes","ticks":1},]}\n```';
  assert.ok(parseSceneBlock(withComma));
  const withComment='```mathviz\n{"view":{"x":[-2,2],"y":[-2,2]},\n// 축 먼저\n"steps":[{"type":"axes"}]}\n```';
  assert.ok(parseSceneBlock(withComment));
  const jsonFence='```json\n{"view":{"x":[-2,2],"y":[-2,2]},"steps":[{"type":"axes"}]}\n```';
  assert.ok(parseSceneBlock(jsonFence));
  assert.equal(parseSceneBlock("```mathviz\n{이건 JSON이 아님\n```"), null);
});

test("validateScript: 미정의 plot id 참조를 잡는다", () => {
  const bad={...GOOD,steps:[{type:"axes"},{type:"extrema",of:"f"}]};
  const v=validateScript(bad);
  assert.ok(!v.ok && v.errors[0].includes("plot id"));
});

test("validateScript: 알 수 없는 step type을 잡는다", () => {
  const bad={...GOOD,steps:[{type:"axes"},{type:"polygon",pts:[]}]};
  const v=validateScript(bad);
  assert.ok(!v.ok && v.errors[0].includes("알 수 없는 type"));
});

test("validateScript: 정의역 밖 domain(전부 NaN)을 잡는다", () => {
  const bad={version:1,view:{x:[-5,5],y:[-5,5]},steps:[
    {type:"plot",id:"f",expr:"log(x)",domain:[-4,-1]}]};   // log는 x>0
  const v=validateScript(bad);
  assert.ok(!v.ok && v.errors[0].includes("NaN"));
});

test("validateScript: expr 컴파일 실패를 잡는다 (y'같은 불허 문자)", () => {
  const bad={version:1,view:{x:[-2,2],y:[-2,2]},steps:[{type:"plot",id:"f",expr:"x'+2"}]};
  assert.ok(!validateScript(bad).ok);
});

test("validateScript: auto-intersections인데 교점 부족을 잡는다", () => {
  const bad={version:1,view:{x:[-5,5],y:[-5,5]},steps:[
    {type:"plot",id:"f",expr:"x^2+1"},
    {type:"area",between:["f"],range:"auto-intersections"}]};  // x축과 교점 0개
  const v=validateScript(bad);
  assert.ok(!v.ok && v.errors[0].includes("교점"));
});

test("validateScript: lines 6줄 초과·conic 파라미터 오류", () => {
  const longLines={version:1,view:{x:[-2,2],y:[-2,2]},steps:[
    {type:"lines",tex:["a","b","c","d","e","f","g"]}]};
  assert.ok(!validateScript(longLines).ok);
  const badConic={version:1,view:{x:[-2,2],y:[-2,2]},steps:[
    {type:"conic",kind:"circle",a:1,b:1}]};
  assert.ok(!validateScript(badConic).ok);
});

test("validateScript: 세로 장축 타원(b>a)은 이제 유효 (초점 y축)", async () => {
  const tall={version:1,view:{x:[-4,4],y:[-6,6]},steps:[{type:"conic",kind:"ellipse",a:3,b:5}]};
  assert.ok(validateScript(tall).ok);
  const { conicFoci }=await import("../mathcore.js");
  const f=conicFoci("ellipse",3,5);
  assert.ok(Math.abs(f[0][1]-4)<1e-9 && f[0][0]===0);   // c=√(25−9)=4, y축 위
});

test("validateScript: vector/angle 스텝 — 유효 통과, 좌표 누락 거부", () => {
  const good={version:1,view:{x:[-1,6],y:[-1,4]},steps:[
    {type:"vector",from:[0,0],to:[5,0],label:"\\vec{a}"},
    {type:"vector",from:[0,0],to:[3,2.4],label:"\\vec{b}"},
    {type:"angle",at:[0,0],from:[5,0],to:[3,2.4],label:"θ"}]};
  assert.deepEqual(validateScript(good).errors, []);
  const bad={version:1,view:{x:[-1,6],y:[-1,4]},steps:[
    {type:"vector",from:[0,0]},{type:"angle",at:[0,0],from:[5,0]}]};
  const v=validateScript(bad);
  assert.equal(v.errors.length, 2);
});

test("isSceneScript: 구조 위반 거부 (steps 41개·view 누락)", () => {
  assert.ok(!isSceneScript({view:{x:[0,1],y:[0,1]},steps:Array.from({length:41},()=>({type:"axes"}))}));
  assert.ok(!isSceneScript({steps:[{type:"axes"}]}));
});
