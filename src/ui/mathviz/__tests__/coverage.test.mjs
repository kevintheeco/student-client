// triangleCoverage — 자연 통합 오탐 방지 게이트: 진짜 삼각형만 통과, 글씨 뭉치는 차단
import { test } from "node:test";
import assert from "node:assert/strict";
import { recognize, triangleCoverage } from "../../../core/geointeract.js";

const seg=(a,b,n=24)=>Array.from({length:n+1},(_,i)=>[a[0]+(b[0]-a[0])*i/n, a[1]+(b[1]-a[1])*i/n]);
const A=[400,150], B=[100,600], C=[700,600];

test("진짜 삼각형: 변 커버리지 높음 → 통과", () => {
  const strokes=[seg(B,C),seg(C,A),seg(A,B)];
  const m=recognize(strokes);
  assert.ok(m.ok);
  assert.ok(triangleCoverage(strokes,m)>=0.9);
});

test("글씨 뭉치(수식 풀이 흉내): hull 삼각형은 나와도 커버리지 낮음 → 차단", () => {
  // 넓게 흩어진 짧은 획들 — 손글씨 텍스트처럼 hull 내부만 채움
  const strokes=[];
  for(let r=0;r<6;r++)for(let c=0;c<5;c++){
    const x=150+c*110, y=200+r*70;
    strokes.push(seg([x,y],[x+60,y+8],6));   // 글자 획 흉내
  }
  const m=recognize(strokes);
  assert.ok(m.ok);                            // hull에선 큰 삼각형이 '인식'되지만
  assert.ok(triangleCoverage(strokes,m)<0.75, "커버리지="+triangleCoverage(strokes,m));  // 게이트가 걸러냄
});
