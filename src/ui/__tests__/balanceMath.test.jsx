// _balanceMath 통화 $ 보호 — ISSUES #0: 이스케이프 안 된 $500이 뒤 수식을 삼키는 버그의 회귀 방지
import { describe, test, expect } from "vitest";
import { _balanceMath } from "../math.jsx";

describe("_balanceMath 통화 판정", () => {
  test("닫는 $ 없는 통화는 리터럴 보호", () => {
    expect(_balanceMath("가격은 $500 이다")).toBe("가격은 \\$500 이다");
  });
  test("통화 뒤 디스플레이 수식($$)을 삼키지 않음", () => {
    expect(_balanceMath("가격 $500이고 $$x=1$$ 이다")).toBe("가격 \\$500이고 $$x=1$$ 이다");
  });
  test("금액 나열($500와 $600) 둘 다 보호", () => {
    expect(_balanceMath("$500와 $600 사이")).toBe("\\$500와 \\$600 사이");
  });
  test("숫자로 시작하는 진짜 수식($5$·$5x+3=0$)은 유지", () => {
    expect(_balanceMath("$5$는 소수")).toBe("$5$는 소수");
    expect(_balanceMath("방정식 $5x+3=0$의 해")).toBe("방정식 $5x+3=0$의 해");
  });
  test("이미 이스케이프된 \\$는 그대로", () => {
    expect(_balanceMath("\\$10 지불 후 $x+1$ 계산")).toBe("\\$10 지불 후 $x+1$ 계산");
  });
  test("안 닫힌 인라인 수식은 줄 끝에서 닫음(기존 동작 유지)", () => {
    expect(_balanceMath("식 $x+1")).toBe("식 $x+1$");
  });
  test("안 닫힌 $$는 끝에서 닫음(기존 동작 유지)", () => {
    expect(_balanceMath("$$x=1")).toBe("$$x=1$$");
  });
});
