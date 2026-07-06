/* ── 2026수능 수학 예시 결과 — 개념지도(약점 노드 반짝임) 기능 시연용 ──
   실제 학생이 이 시험을 본 것처럼 결과를 미리 채워 Exam의 결과 화면(리포트+개념지도)을 바로 연다.
   문항 본문은 저작권(한국교육과정평가원) 때문에 원문을 재현하지 않고 단원명만 표기 —
   실제 46문항 전수 판독·개념매핑은 Obsidian Business vault
   (wiki/math-engine/2026수능수학-개념지도-사례.md)에 정밀판으로 보관돼 있다.
   여기서는 공통 22문항 + 선택과목(미적분) 8문항 = 30문항 구성으로, 정답/오답 패턴은
   실제 난이도 분포에 맞춘 예시(고난도 결합형 문항 위주로 오답)다. */

const ITEMS=[ // [번호, 단원, 배점, 정답여부]
  [1,"지수와 로그",2,true],[2,"미분계수와 도함수",2,true],[3,"수열의 합",3,true],
  [4,"함수의 연속",3,true],[5,"미분계수와 도함수",3,true],[6,"지수와 로그",3,true],
  [7,"정적분의 활용",3,true],[8,"삼각함수",3,true],[9,"도함수의 활용",4,true],
  [10,"지수함수와 로그함수",4,true],[11,"정적분의 활용",4,true],[12,"등차수열과 등비수열",4,true],
  [13,"도함수의 활용",4,true],[14,"사인법칙과 코사인법칙",4,false],[15,"정적분",4,false],
  [16,"수학적 귀납법",3,true],[17,"부정적분",3,true],[18,"사인법칙과 코사인법칙",3,true],
  [19,"도함수의 활용",3,true],[20,"수열의 합",4,false],[21,"함수의 연속",4,false],
  [22,"지수함수와 로그함수",4,true],
  [23,"여러 가지 함수의 미분",2,true],[24,"여러 가지 적분법",3,true],[25,"수열의 극한",3,true],
  [26,"정적분의 활용(미적분)",3,true],[27,"여러 가지 미분법",3,true],[28,"여러 가지 적분법",4,true],
  [29,"급수",4,false],[30,"여러 가지 미분법",4,false],
];

function buildDemoRecord(){
  const grades=ITEMS.map(([no,unit,points,ok])=>({
    unit,concept:unit,points,score:ok?points:0,verdict:ok?"correct":"incorrect",
    type:"short",question:"2026수능 수학 "+no+"번 ("+unit+")",
    gap:ok?undefined:"핵심 개념 결합 부족 — 오답노트에서 선행개념부터 다시 확인",
  }));
  const score=grades.reduce((s,g)=>s+g.score,0);
  const maxScore=grades.reduce((s,g)=>s+g.points,0);
  return{studentName:"윤도윤",examTitle:"2026학년도 수능 수학(공통+미적분) 예시",items:[],grades,score,maxScore,analysis:null};
}

export { buildDemoRecord };
