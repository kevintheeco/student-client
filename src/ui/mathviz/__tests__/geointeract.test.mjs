// geointeract 단위 테스트 — PoC 검증 로직의 이식 정확성 (오탐·미탐 없음이 §7 요건)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hull, bestTriangle, isStraight, rdp,
  normalizeStrokes, recognize, recognizeQuad, compare, polygonCoverage,
} from "../../../core/geointeract.js";

// 두 점 사이를 n등분 샘플한 "손으로 그은 직선" 스트로크
const seg=(a,b,n=24)=>Array.from({length:n+1},(_,i)=>[a[0]+(b[0]-a[0])*i/n, a[1]+(b[1]-a[1])*i/n]);

const A=[400,150], B=[100,600], C=[700,600], H=[400,600]; // 밑변 BC(최장변 600), 높이 AH=450
const triStrokes=[seg(B,C),seg(C,A),seg(A,B)];

test("hull: 내부 점은 제외되고 꼭짓점만 남는다", () => {
  const h=hull([[0,0],[100,0],[100,100],[0,100],[50,50],[20,80]]);
  assert.equal(h.length, 4);
  for(const p of [[50,50],[20,80]])
    assert.ok(!h.some(q=>q[0]===p[0]&&q[1]===p[1]));
});

test("bestTriangle: 정사각형 hull에서 넓이 절반의 삼각형", () => {
  const {area}=bestTriangle([[0,0],[100,0],[100,100],[0,100]]);
  assert.equal(area, 5000);
});

test("isStraight: 직선은 통과, 짧은 선·굽은 선은 탈락", () => {
  assert.ok(isStraight(seg([0,0],[300,0])));
  assert.ok(!isStraight(seg([0,0],[30,0])));                       // L<40
  const bent=seg([0,0],[300,0]).map(([x,y],i)=>[x, y+60*Math.sin(i/24*Math.PI)]);
  assert.ok(!isStraight(bent));                                    // 이탈 60 > 0.12·300+8
});

test("rdp: 직선 스트로크는 끝점 2개로 줄어든다", () => {
  assert.equal(rdp(seg([0,0],[300,0]), 4).length, 2);
});

test("normalizeStrokes: PenPad dump 포맷과 배열 포맷 모두 수용", () => {
  const dump={pages:[[{pts:[{x:1,y:2,p:.5},{x:3,y:4,p:.5}],col:"#000",sz:1}]],w:800,h:340};
  assert.deepEqual(normalizeStrokes(dump), [[[1,2],[3,4]]]);
  assert.deepEqual(normalizeStrokes([[[1,2],[3,4]]]), [[[1,2],[3,4]]]);
});

test("recognize: 삼각형 3획 → 꼭짓점·밑변·수선의 발, 높이는 미작도", () => {
  const m=recognize(triStrokes);
  assert.ok(m.ok);
  assert.ok(m.area>8000);
  // A=최장변(BC)의 대각 → (400,150), H=(400,600)
  assert.ok(Math.hypot(m.vertices.A[0]-400, m.vertices.A[1]-150)<10);
  assert.ok(Math.hypot(m.foot[0]-400, m.foot[1]-600)<10);
  assert.equal(m.aux[0].drawn, false);
});

test("recognize: 높이 보조선을 그리면 drawn=true (미탐 없음)", () => {
  const m=recognize([...triStrokes, seg(A,H)]);
  assert.ok(m.ok);
  assert.equal(m.aux[0].drawn, true);
});

test("recognize: 삼각형 내부의 무관한 낙서는 높이로 오인하지 않는다 (오탐 없음)", () => {
  const doodle=seg([350,350],[430,420]);   // 직선이지만 A·H와 안 닿음
  const m=recognize([...triStrokes, doodle]);
  assert.equal(m.aux[0].drawn, false);
});

test("recognize: 너무 작은 그림은 인식 실패", () => {
  const tiny=[seg([0,0],[40,0]),seg([40,0],[20,30]),seg([20,30],[0,0])];
  assert.equal(recognize(tiny).ok, false);
});

/* ── 사각형+대각선 (고교수학 확장) ── */
const P=[150,150], Q=[650,180], R=[700,600], S=[120,560];   // 볼록 사각형
const quadStrokes=[seg(P,Q),seg(Q,R),seg(R,S),seg(S,P)];

test("사각형 인식: 4획 → 꼭짓점 4개, 대각선 미작도", () => {
  const m=recognizeQuad(quadStrokes);
  assert.ok(m.ok);
  assert.equal(m.kind, "quad");
  assert.equal(Object.keys(m.vertices).length, 4);
  assert.equal(m.aux[0].kind, "diagonal");
  assert.equal(m.aux[0].drawn, false);
  assert.ok(polygonCoverage(quadStrokes,[m.vertices.A,m.vertices.B,m.vertices.C,m.vertices.D])>=0.85);
});

test("사각형: 대각선(어느 쪽이든) 그리면 drawn=true", () => {
  const m1=recognizeQuad([...quadStrokes, seg(P,R)]);   // AC 방향
  assert.equal(m1.aux[0].drawn, true);
  const m2=recognizeQuad([...quadStrokes, seg(Q,S)]);   // BD 방향
  assert.equal(m2.aux[0].drawn, true);
  // 짧은 무관한 획은 오탐 없음
  const m3=recognizeQuad([...quadStrokes, seg([300,300],[380,340])]);
  assert.equal(m3.aux[0].drawn, false);
});

test("compare(quad): 대각선 누락 → missing, 그리면 correct 9개", () => {
  const miss=compare(recognizeQuad(quadStrokes));
  assert.equal(miss.missing.length, 1);
  assert.equal(miss.missing[0].label, "대각선");
  assert.equal(miss.correct.length, 8);          // 꼭짓점 4 + 변 4
  const okd=compare(recognizeQuad([...quadStrokes, seg(P,R)]));
  assert.equal(okd.missing.length, 0);
  assert.equal(okd.correct.length, 9);
});

test("compare: 높이 누락 → missing, 그리면 correct로 이동", () => {
  const without=compare(recognize(triStrokes));
  assert.equal(without.missing.length, 1);
  assert.equal(without.missing[0].kind, "auxline");
  assert.equal(without.correct.length, 6);          // 꼭짓점 3 + 변 3
  const withH=compare(recognize([...triStrokes, seg(A,H)]));
  assert.equal(withH.missing.length, 0);
  assert.equal(withH.correct.length, 7);
  const fail=compare({ok:false});
  assert.equal(fail.missing[0].kind, "shape");
});
