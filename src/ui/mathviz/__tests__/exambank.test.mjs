// 기출은행 figureScript 데이터 경로 — 출제 후보 필터·시험 문항 변환에서 벡터 그림이 살아남는지
import { test } from "node:test";
import assert from "node:assert/strict";
import { LS } from "../../../core/platform.js";
import { BANK_KEY, bankSearch, toExamItem } from "../../../core/examBank.js";

const FIG={version:1,theme:"geometry",view:{x:[-1,7],y:[-1,6]},
  steps:[{type:"segment",from:[1,1],to:[6,1]},{type:"point",at:[2.5,4.5],label:"A"}]};

test("figureScript만 있어도(PNG 없이) 출제 후보에 든다 — 그림 없는 그림필수 문항은 제외", () => {
  LS.set(BANK_KEY,[
    {id:"vec",verified:true,hasFigure:true,figureScript:FIG,unit:"평면도형",qtype:"short",question:"Q벡터",answer:"1"},
    {id:"none",verified:true,hasFigure:true,unit:"평면도형",qtype:"short",question:"Q그림없음",answer:"2"},
    {id:"png",verified:true,hasFigure:true,figure:"data:image/jpeg;base64,xx",unit:"평면도형",qtype:"short",question:"QPNG",answer:"3"},
  ]);
  const ids=bankSearch({unit:"평면도형"}).map(it=>it.id);
  assert.ok(ids.includes("vec") && ids.includes("png"));
  assert.ok(!ids.includes("none"));
});

test("toExamItem: figureScript가 시험 문항으로 복사된다 (PNG 폴백 별개 유지)", () => {
  const ex=toExamItem({id:"vec",qtype:"short",unit:"평면도형",question:"Q",answer:"1",figureScript:FIG},()=>"x1");
  assert.deepEqual(ex.figureScript, FIG);
  assert.equal(ex.figure, null);
  const both=toExamItem({id:"b",qtype:"essay",unit:"평면도형",question:"Q",figure:"data:image/jpeg;base64,xx",figureScript:FIG},()=>"x2");
  assert.deepEqual(both.figureScript, FIG);
  assert.equal(both.figure, "data:image/jpeg;base64,xx");
});
