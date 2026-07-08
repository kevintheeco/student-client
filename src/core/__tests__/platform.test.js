// 스키마 마이그레이션 러너 — 깨지면 사용자 데이터가 잘못 변환된다 (ISSUES A1/A3)
import { describe, test, expect } from "vitest";
import { migrateSchema } from "../platform.js";

describe("migrateSchema", () => {
  test("from+1부터 to까지 순차 실행, 바뀐 키 수집", () => {
    const order = [];
    const cache = { "ng:a": 1 };
    const migrations = {
      2: (c) => { order.push(2); c["ng:a"] = 2; return ["ng:a"]; },
      3: (c) => { order.push(3); c["ng:b"] = 3; return ["ng:b"]; },
    };
    const changed = migrateSchema(cache, 1, 3, migrations);
    expect(order).toEqual([2, 3]);
    expect(changed).toEqual(["ng:a", "ng:b"]);
    expect(cache["ng:a"]).toBe(2);
    expect(cache["ng:b"]).toBe(3);
  });
  test("이미 최신이면 아무것도 안 함", () => {
    expect(migrateSchema({}, 3, 3, { 3: () => ["x"] })).toEqual([]);
  });
  test("중간 버전에 마이그레이션이 없어도 건너뛰고 진행", () => {
    const migrations = { 4: () => ["ng:c"] };
    expect(migrateSchema({}, 2, 4, migrations)).toEqual(["ng:c"]);
  });
});
