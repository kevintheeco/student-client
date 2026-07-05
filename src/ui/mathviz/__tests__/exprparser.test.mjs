// exprparser 단위 테스트 — 화이트리스트·우선순위·NaN 안전성 검증
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileExpr, tryCompileExpr } from "../exprparser.js";

const near=(a,b,eps=1e-9)=>Math.abs(a-b)<eps; // 근사 비교

test("기본 사칙·괄호", () => {
  assert.equal(compileExpr("2+3*4")(0), 14);
  assert.equal(compileExpr("(2+3)*4")(0), 20);
  assert.equal(compileExpr("10/4")(0), 2.5);
});

test("^는 우결합: 2^3^2 = 512", () => {
  assert.equal(compileExpr("2^3^2")(0), 512);
});

test("단항 음수: -x^2 은 -(x^2)", () => {
  assert.equal(compileExpr("-x^2")(2), -4);
  assert.equal(compileExpr("2*-3")(0), -6);
});

test("함수·상수: sin(pi/2)=1, log(e)=1, ln=log(자연로그)", () => {
  assert.ok(near(compileExpr("sin(pi/2)")(0), 1));
  assert.ok(near(compileExpr("log(e)")(0), 1));
  assert.ok(near(compileExpr("ln(e)")(0), 1));
  assert.ok(near(compileExpr("sqrt(abs(-9))")(0), 3));
});

test("지시서 예시 식이 컴파일된다", () => {
  const f=compileExpr("exp(x)-2"), g=compileExpr("log(x+2)");
  assert.ok(near(f(0), -1));
  assert.ok(near(g(-1), 0));
});

test("정의역 밖·발산은 NaN (throw 금지)", () => {
  assert.ok(Number.isNaN(compileExpr("sqrt(-1)")(0)));
  assert.ok(Number.isNaN(compileExpr("log(x)")(0)));   // log(0)=-Inf → NaN
  assert.ok(Number.isNaN(compileExpr("1/x")(0)));      // Infinity → NaN
});

test("화이트리스트 밖은 전부 거부", () => {
  for(const bad of ["alert(1)", "x.constructor", "x;1", "y+1", "window", "x=>1", "f(x)", "2..3"]){
    assert.equal(tryCompileExpr(bad).f, null, bad+" 는 거부되어야 함");
  }
  assert.equal(tryCompileExpr("").f, null);
  assert.equal(tryCompileExpr("2+").f, null);
  assert.equal(tryCompileExpr("(2").f, null);
});
