// 원 인식 — 최소제곱 피팅(지시서 §4-1)·반지름/지름 감지·게이트 검증
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitCircle, recognizeCircle, compare } from "../../../core/geointeract.js";

const seg=(a,b,n=24)=>Array.from({length:n+1},(_,i)=>[a[0]+(b[0]-a[0])*i/n, a[1]+(b[1]-a[1])*i/n]);
// 손으로 그린 원 흉내: 중심 (400,400), r=200, 흔들림 ±4px
const circleStroke=(cx=400,cy=400,r=200,n=48,span=2*Math.PI)=>
  Array.from({length:n+1},(_,i)=>{
    const a=span*i/n, wob=((i*7)%9-4);
    return [cx+(r+wob)*Math.cos(a), cy+(r+wob)*Math.sin(a)];
  });

test("fitCircle: 노이즈 낀 원 점열에서 중심·반지름 정확 복원", () => {
  const f=fitCircle(circleStroke());
  assert.ok(Math.abs(f.center[0]-400)<4 && Math.abs(f.center[1]-400)<4);
  assert.ok(Math.abs(f.r-200)<5);
});

test("recognizeCircle: 원만 그림 → 인식 성공, 반지름 미작도", () => {
  const m=recognizeCircle([circleStroke()]);
  assert.ok(m.ok);
  assert.equal(m.kind, "circle");
  assert.equal(m.aux[0].drawn, false);
});

test("recognizeCircle: 반지름 선분 또는 지름을 그리면 drawn=true", () => {
  const withRadius=recognizeCircle([circleStroke(), seg([400,400],[598,400])]);
  assert.equal(withRadius.aux[0].drawn, true);
  const withDiameter=recognizeCircle([circleStroke(), seg([202,400],[598,400])]);
  assert.equal(withDiameter.aux[0].drawn, true);
  // 중심을 안 지나는 현(chord)은 반지름이 아님
  const withChord=recognizeCircle([circleStroke(), seg([400,205],[598,395])]);
  assert.equal(withChord.aux[0].drawn, false);
});

test("게이트: 호 조각(120°)·삼각형·글씨 뭉치는 원으로 오인하지 않음", () => {
  assert.equal(recognizeCircle([circleStroke(400,400,200,20,2*Math.PI/3)]).ok, false);  // 열린 호
  assert.equal(recognizeCircle([seg([100,600],[700,600]),seg([700,600],[400,150]),seg([400,150],[100,600])]).ok, false);
  const scribble=[];
  for(let r=0;r<5;r++)scribble.push(seg([150,200+r*80],[650,215+r*80],10).map(([x,y],i)=>[x,y+((i*5)%7)]));
  assert.equal(recognizeCircle(scribble).ok, false);
});

test("compare(circle): 반지름 누락 → missing '반지름 r', 그리면 correct", () => {
  const miss=compare(recognizeCircle([circleStroke()]));
  assert.equal(miss.missing.length, 1);
  assert.equal(miss.missing[0].label, "반지름 r");
  const okd=compare(recognizeCircle([circleStroke(), seg([400,400],[598,400])]));
  assert.equal(okd.missing.length, 0);
});
