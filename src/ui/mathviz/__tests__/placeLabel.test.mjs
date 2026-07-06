// placeLabel 단위 테스트 — 8방향×여백 단계 첫 비충돌 배치의 결정성 검증
import { test } from "node:test";
import assert from "node:assert/strict";
import { placeLabel, estimateLabelBox } from "../placeLabel.js";

test("장애물이 없으면 첫 후보 UR·최소 여백", () => {
  const r=placeLabel({anchor:[100,100], w:40, h:18, obstacles:[], unit:60});
  assert.equal(r.dir, "UR");
  assert.ok(Math.abs(r.x-(100+0.13*60))<1e-9);        // x = anchor + buff0×unit
  assert.ok(Math.abs(r.y-(100-0.13*60-18))<1e-9);     // y = anchor − buff − h
});

test("UR이 막히면 다음 방향(UL)으로 밀려난다", () => {
  // UR 자리(오른쪽 위)를 점으로 도배
  const obstacles=[];
  for(let x=100;x<=200;x+=5)for(let y=20;y<=100;y+=5)obstacles.push([x,y]);
  const r=placeLabel({anchor:[100,100], w:40, h:18, obstacles, unit:60});
  assert.equal(r.dir, "UL");
});

test("전 방향이 막히면 UR 폴백", () => {
  const obstacles=[];
  for(let x=0;x<=220;x+=4)for(let y=0;y<=220;y+=4)obstacles.push([x,y]);
  const r=placeLabel({anchor:[110,110], w:30, h:16, obstacles, unit:60});
  assert.equal(r.dir, "UR");
});

test("결정적: 같은 입력 → 같은 출력", () => {
  const args={anchor:[50,80], w:36, h:18, obstacles:[[60,60],[90,95]], unit:68};
  const a=placeLabel(args), b=placeLabel(args);
  assert.deepEqual(a, b);
});

test("estimateLabelBox: 한글은 전각(1.0em), 라틴·숫자는 0.62em", () => {
  const ko=estimateLabelBox("극대", 15);
  const en=estimateLabelBox("ab", 15);
  assert.ok(Math.abs(ko.w-30)<1e-9);
  assert.ok(Math.abs(en.w-15*0.62*2)<1e-9);
  assert.ok(ko.h>15);
});
