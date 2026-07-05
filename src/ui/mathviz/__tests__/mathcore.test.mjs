// mathcore 단위 테스트 — 교점·극점·변곡점·절편·초점을 알려진 답과 대조 (지시서 §6-1)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findRoots, findIntersections, findExtrema, findInflections,
  xIntercepts, yIntercept, conicFoci, projectFoot,
} from "../mathcore.js";
import { compileExpr } from "../exprparser.js";

const near=(a,b,eps=1e-6)=>Math.abs(a-b)<eps;

test("근: x²−4 → ±2", () => {
  const r=findRoots((x)=>x*x-4, -5, 5);
  assert.equal(r.length, 2);
  assert.ok(near(r[0], -2) && near(r[1], 2));
});

test("근: NaN 정의역 건너뛰기 — log(x+2)의 근 x=−1", () => {
  const r=findRoots(compileExpr("log(x+2)"), -3, 4.6);
  assert.equal(r.length, 1);
  assert.ok(near(r[0], -1));
});

test("교점: x² ∩ 2x → (0,0), (2,4)", () => {
  const pts=findIntersections((x)=>x*x, (x)=>2*x, -3, 5);
  assert.equal(pts.length, 2);
  assert.ok(near(pts[0][0], 0) && near(pts[0][1], 0));
  assert.ok(near(pts[1][0], 2) && near(pts[1][1], 4));
});

test("교점: 지시서 예시 exp(x)−2 ∩ log(x+2)", () => {
  const pts=findIntersections(compileExpr("exp(x)-2"), compileExpr("log(x+2)"), -1.9, 4.6);
  assert.equal(pts.length, 2);       // y=x 대칭쌍이라 교점 2개
  for(const [x,y] of pts) assert.ok(near(Math.exp(x)-2, y, 1e-5));
});

test("극점: x³−3x → 극대(−1,2)·극소(1,−2)", () => {
  const ex=findExtrema((x)=>x*x*x-3*x, -3, 3);
  assert.equal(ex.length, 2);
  const mx=ex.find((e)=>e.kind==="max"), mn=ex.find((e)=>e.kind==="min");
  assert.ok(near(mx.x, -1, 1e-4) && near(mx.y, 2, 1e-4));
  assert.ok(near(mn.x, 1, 1e-4) && near(mn.y, -2, 1e-4));
});

test("변곡점: x³ → (0,0), x⁴ → 없음(부호 변화 없음)", () => {
  const inf=findInflections((x)=>x*x*x, -2, 2);
  assert.equal(inf.length, 1);
  assert.ok(near(inf[0][0], 0, 1e-4) && near(inf[0][1], 0, 1e-4));
  assert.equal(findInflections((x)=>x*x*x*x, -2, 2).length, 0);
});

test("절편: log(x+2)의 x절편 −1 / log(x)의 y절편 null", () => {
  const xi=xIntercepts(compileExpr("log(x+2)"), -1.9, 4.6);
  assert.equal(xi.length, 1);
  assert.ok(near(xi[0][0], -1) && xi[0][1]===0);
  assert.equal(yIntercept(compileExpr("log(x)")), null);
  const yi=yIntercept(compileExpr("exp(x)-2"));
  assert.ok(near(yi[0], 0) && near(yi[1], -1));
});

test("초점: 타원 a=5,b=3 → ±4 / 쌍곡선 a=2,b=√2 → ±√6 / 포물선 p=2 → (2,0)", () => {
  const e=conicFoci("ellipse", 5, 3);
  assert.ok(near(e[0][0], 4) && near(e[1][0], -4));
  const h=conicFoci("hyperbola", 2, Math.sqrt(2));
  assert.ok(near(h[0][0], Math.sqrt(6)) && near(h[1][0], -Math.sqrt(6)));
  const p=conicFoci("parabola", 0, 0, 2);
  assert.ok(near(p[0][0], 2) && near(p[0][1], 0));
  assert.throws(()=>conicFoci("circle", 1, 1));
});

test("수선의 발: A(3,4)에서 BC(0,0)-(10,0) → (3,0)", () => {
  const H=projectFoot([3,4],[0,0],[10,0]);
  assert.ok(near(H[0], 3) && near(H[1], 0));
  // 퇴화(B=C)여도 터지지 않음
  const D=projectFoot([1,1],[2,2],[2,2]);
  assert.ok(near(D[0], 2) && near(D[1], 2));
});
