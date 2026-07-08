// 복습 스케줄 핵심 로직 — 깨지면 학습 데이터(box·복습일)가 상한다 (ISSUES A3)
import { describe, test, expect } from "vitest";
import { schedule, INTERVALS, DAY } from "../srs.js";

describe("schedule", () => {
  test("correct → box+1, 해당 간격만큼 dueAt 미룸", () => {
    const r = schedule({ box: 2 }, "correct");
    expect(r.box).toBe(3);
    expect(r.dueAt).toBeGreaterThan(Date.now() + INTERVALS[3] * DAY - 5000);
    expect(r.reps).toBe(1);
    expect(r.lapses).toBe(0);
  });
  test("correct는 box 5에서 더 안 오름", () => {
    expect(schedule({ box: 5 }, "correct").box).toBe(5);
  });
  test("incorrect → box 1 리셋 + lapses 증가", () => {
    const r = schedule({ box: 4, lapses: 1 }, "incorrect");
    expect(r.box).toBe(1);
    expect(r.lapses).toBe(2);
  });
  test("partial → box 유지 (의도된 동작 — ISSUES #1)", () => {
    expect(schedule({ box: 3 }, "partial").box).toBe(3);
  });
  test("box 없는 신규 개념은 1로 시작", () => {
    expect(schedule({}, "partial").box).toBe(1);
  });
});
