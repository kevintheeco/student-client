/* ════════════════════════════════════════════════════════════════
   수학 교육과정 옵시디언 볼트 생성기 (Karpathy LLM-wiki + Graphify 방식)
   실행: node scripts/gen-curriculum-vault.mjs
   원천(불변): src/core/curriculum.js(목차) + src/core/knowledgeGraph.js(선수관계)
   산출: docs/math-curriculum/ — 단원 엔티티 노트 + 과목 MOC + INDEX/SCHEMA/LOG/GRAPH_REPORT
   규약은 SCHEMA.md에 — 목차 수정은 curriculum.js에서 하고 이 스크립트로 재생성.
════════════════════════════════════════════════════════════════ */
import { LEVELS } from "../src/core/curriculum.js";
import { GRAPH_NODES, GRAPH_EDGES, STRANDS } from "../src/core/knowledgeGraph.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs", "math-curriculum");
const TODAY = new Date().toISOString().slice(0, 10);

/* ── 1. 단원(대단원) 사전: 이름 → {topics, 소속 과목들, 영역} ── */
const units = new Map();           // name → {topics, subjects:[{name,level,levelId}], strand}
const subjectsAll = [];            // {name, level, levelId, chapters}
for (const lv of LEVELS) {
  for (const s of lv.subjects) {
    subjectsAll.push({ name: s.name, level: lv.level, levelId: lv.levelId, chapters: s.chapters });
    for (const ch of s.chapters) {
      if (!units.has(ch.name)) units.set(ch.name, { topics: ch.topics, subjects: [], strand: null, kw: [] });
      units.get(ch.name).subjects.push({ name: s.name, level: lv.level, levelId: lv.levelId });
    }
  }
}

/* ── 2. 지식그래프 매핑: 노드 이름 = 단원 이름 (1:1 규약) ── */
const nodeByName = new Map(GRAPH_NODES.map(n => [n.name, n]));
const nodeById = new Map(GRAPH_NODES.map(n => [n.id, n]));
for (const [name, u] of units) {
  const n = nodeByName.get(name);
  if (n) { u.strand = n.strand; u.kw = n.kw || []; }
}
// 그래프 노드가 없는 단원(확통·미적분Ⅱ·기하)의 영역 지정
const STRAND_FALLBACK = { high22_prob: "sta" };
for (const [name, u] of units) {
  if (u.strand) continue;
  const subj = u.subjects[0].name;
  u.strand = /확률|통계|순열|조합|이항/.test(subj + name) ? "sta"
    : /미적분|극한|급수|미분|적분/.test(subj + name) ? "cal"
    : "geo";
}
const strandName = id => (STRANDS.find(s => s.id === id) || {}).name || id;

/* ── 3. 엣지 통합: 그래프 엣지(id 기반) + 보강 엣지(그래프 미커버 단원, 이름 기반) ── */
const SUPPLEMENT = [
  // [선수, 후속, 의존도, 왜]
  ["순열과 조합","여러 가지 순열",0.9,"순열·조합의 기본 계산 위에 원순열·중복순열이 선다"],
  ["순열과 조합","중복조합과 이항정리",0.8,"조합 개념 없이는 중복조합·이항계수를 정의할 수 없다"],
  ["다항식의 연산","중복조합과 이항정리",0.5,"이항정리는 다항식 전개의 일반화"],
  ["경우의 수와 확률","확률의 뜻과 활용",0.8,"중2 확률의 뜻·계산이 고교 확률의 출발점"],
  ["순열과 조합","확률의 뜻과 활용",0.7,"수학적 확률 계산은 결국 경우의 수 세기"],
  ["집합","확률의 뜻과 활용",0.6,"사건 = 표본공간의 부분집합, 덧셈정리는 집합 연산"],
  ["확률의 뜻과 활용","조건부확률",0.9,"확률의 덧셈·곱셈 위에 조건부 개념이 선다"],
  ["조건부확률","이산확률변수의 확률분포",0.6,"독립시행의 확률이 이항분포의 뼈대"],
  ["대푯값과 산포도","이산확률변수의 확률분포",0.6,"평균·분산·표준편차 개념의 확률변수 버전"],
  ["이산확률변수의 확률분포","연속확률변수와 정규분포",0.8,"이산 분포 이해 위에 밀도함수·정규분포"],
  ["연속확률변수와 정규분포","통계적 추정",0.9,"표본평균의 분포가 정규분포로 귀결된다"],
  ["등차수열과 등비수열","수열의 극한",0.8,"극한을 취하는 대상이 수열, 특히 등비수열"],
  ["함수의 극한","수열의 극한",0.6,"극한의 성질·계산 감각을 공유"],
  ["수열의 극한","급수",0.9,"급수의 수렴 = 부분합 수열의 극한"],
  ["수열의 합","급수",0.6,"부분합 계산은 Σ 조작"],
  ["지수함수와 로그함수","여러 가지 함수의 미분",0.8,"지수·로그함수를 알아야 그 미분이 가능"],
  ["삼각함수","여러 가지 함수의 미분",0.8,"삼각함수의 정의·그래프 위에 덧셈정리와 미분"],
  ["미분계수와 도함수","여러 가지 함수의 미분",0.9,"미분의 정의·기본 미분법이 전제"],
  ["여러 가지 함수의 미분","여러 가지 미분법",0.9,"초월함수 미분 위에 합성·매개변수·음함수 미분"],
  ["여러 가지 미분법","도함수의 활용(미적분)",0.9,"복잡한 함수의 그래프 분석은 미분법이 도구"],
  ["도함수의 활용","도함수의 활용(미적분)",0.7,"다항함수에서 익힌 그래프 분석 틀의 확장"],
  ["여러 가지 미분법","여러 가지 적분법",0.8,"치환·부분적분은 미분법의 역과정"],
  ["정적분","여러 가지 적분법",0.7,"정적분의 정의·기본정리가 전제"],
  ["여러 가지 적분법","정적분의 활용(미적분)",0.9,"넓이·부피 계산은 적분 기술 그 자체"],
  ["정적분의 활용","정적분의 활용(미적분)",0.6,"넓이 계산 틀의 초월함수 확장"],
  ["이차방정식과 이차함수","이차곡선",0.6,"포물선은 이차함수 그래프의 기하적 재해석"],
  ["원의 방정식","이차곡선",0.7,"곡선의 방정식·접선을 다루는 틀을 공유"],
  ["평면좌표와 직선의 방정식","평면벡터",0.7,"성분·내분점·직선이 벡터 표현의 밑바탕"],
  ["사인법칙과 코사인법칙","평면벡터",0.5,"내적의 정의는 코사인"],
  ["평면도형의 성질","입체도형의 성질",0.7,"원의 둘레·넓이가 기둥·뿔·구의 겉넓이·부피 계산의 기초"],
  ["입체도형의 성질","공간도형",0.4,"다면체·회전체 감각이 공간 위치 관계의 밑그림"],
  ["기본 도형","공간도형",0.6,"위치 관계 논리의 3차원 확장"],
  ["피타고라스 정리","공간도형",0.6,"공간에서의 거리·정사영 계산의 기본"],
  ["평면좌표와 직선의 방정식","공간좌표",0.7,"좌표 개념의 3차원 확장"],
  ["공간도형","공간좌표",0.6,"공간 감각 위에 좌표를 얹는다"],
  ["원의 방정식","공간좌표",0.5,"구의 방정식은 원의 방정식의 확장"],
  ["평면벡터","공간벡터(2022)",0.9,"평면벡터 연산·내적의 3차원 확장"],
  ["공간좌표","공간벡터(2022)",0.7,"성분 표현은 공간좌표로 한다"],
];
const edges = []; // {from, to, w, why} — 이름 기반
for (const e of GRAPH_EDGES) {
  const f = nodeById.get(e.from), t = nodeById.get(e.to);
  if (f && t && units.has(f.name) && units.has(t.name)) edges.push({ from: f.name, to: t.name, w: e.w, why: e.why });
}
for (const [from, to, w, why] of SUPPLEMENT) edges.push({ from, to, w, why });

const prereqsOf = name => edges.filter(e => e.to === name);
const nextOf = name => edges.filter(e => e.from === name);
function impactOf(name) { // 전이적 후속 단원 수 — "지금 안 잡으면 몇 단원이 무너지나"
  const seen = new Set(); const stack = [name];
  while (stack.length) { for (const e of nextOf(stack.pop())) if (!seen.has(e.to)) { seen.add(e.to); stack.push(e.to); } }
  return seen.size;
}

/* ── 4. 볼트 초기화 ── */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "단원"), { recursive: true });
fs.mkdirSync(path.join(OUT, "과목"), { recursive: true });
const write = (rel, lines) => fs.writeFileSync(path.join(OUT, rel), lines.join("\n") + "\n", "utf8");
const pct = w => Math.round(w * 100) + "%";

/* ── 5. 단원 엔티티 노트 (Graphify: 노드 1개 = 노트 1개) ── */
for (const [name, u] of units) {
  const pre = prereqsOf(name).sort((a, b) => b.w - a.w);
  const nxt = nextOf(name).sort((a, b) => b.w - a.w);
  const imp = impactOf(name);
  const L = [];
  L.push("---");
  L.push("type: 단원");
  L.push(`과목: [${u.subjects.map(s => `"[[${s.name}]]"`).join(", ")}]`);
  L.push(`영역: ${strandName(u.strand)}`);
  L.push(`소단원수: ${u.topics.length}`);
  L.push(`선수단원수: ${pre.length}`);
  L.push(`영향력: ${imp}`);
  if (u.kw.length) L.push(`키워드: [${u.kw.map(k => `"${k}"`).join(", ")}]`);
  L.push(`tags: [수학/단원, 영역/${strandName(u.strand).replace(/[·()\s]/g, "")}]`);
  L.push("---");
  L.push("");
  L.push(`# ${name}`);
  L.push("");
  L.push(`> [!info] 위치와 무게`);
  L.push(`> ${u.subjects.map(s => `[[${s.name}]]`).join(" · ")} — **${strandName(u.strand)}** 영역`);
  if (imp > 0) L.push(`> 이 단원이 흔들리면 이후 **${imp}개 단원**이 함께 흔들린다.`);
  else L.push(`> 이 교육과정 안에서는 마지막 잎 단원 — 여기가 목적지다.`);
  L.push("");
  L.push("## 소단원");
  L.push("");
  for (const t of u.topics) L.push(`- [ ] ${t}`);
  L.push("");
  if (pre.length) {
    L.push("## ⬅ 선수 단원 — 여기가 비면 이 단원에서 막힌다");
    L.push("");
    L.push("| 단원 | 의존도 | 왜 필요한가 |");
    L.push("| --- | --- | --- |");
    for (const e of pre) L.push(`| [[${e.from}]] | ${pct(e.w)} | ${e.why} |`);
    L.push("");
  }
  if (nxt.length) {
    L.push("## ➡ 후속 단원 — 이 단원이 열어주는 문");
    L.push("");
    L.push("| 단원 | 의존도 | 무엇을 받쳐주나 |");
    L.push("| --- | --- | --- |");
    for (const e of nxt) L.push(`| [[${e.to}]] | ${pct(e.w)} | ${e.why} |`);
    L.push("");
  }
  write(path.join("단원", `${name}.md`), L);
}

/* ── 6. 과목 MOC (Map of Content) ── */
for (const s of subjectsAll) {
  const L = [];
  const nTopics = s.chapters.reduce((a, c) => a + c.topics.length, 0);
  L.push("---");
  L.push("type: 과목");
  L.push(`과정: "${s.level}"`);
  L.push(`단원수: ${s.chapters.length}`);
  L.push(`소단원수: ${nTopics}`);
  L.push("tags: [수학/과목]");
  L.push("---");
  L.push("");
  L.push(`# ${s.name}`);
  L.push("");
  L.push(`> [!abstract] ${s.level} · 대단원 ${s.chapters.length}개 · 소단원 ${nTopics}개`);
  L.push("");
  L.push("## 학습 순서 (교과서 흐름)");
  L.push("");
  L.push("```mermaid");
  L.push("flowchart TD");
  s.chapters.forEach((c, i) => { L.push(`  c${i}["${i + 1}. ${c.name}"]`); if (i > 0) L.push(`  c${i - 1} --> c${i}`); });
  L.push("```");
  L.push("");
  L.push("## 단원 한눈에");
  L.push("");
  L.push("| # | 단원 | 소단원 | 선수 | 영향력 |");
  L.push("| --- | --- | --- | --- | --- |");
  s.chapters.forEach((c, i) => {
    L.push(`| ${i + 1} | [[${c.name}]] | ${c.topics.length} | ${prereqsOf(c.name).length} | ${impactOf(c.name)} |`);
  });
  L.push("");
  write(path.join("과목", `${s.name}.md`), L);
}

/* ── 7. HOME 대시보드 ── */
{
  const L = [];
  L.push("---");
  L.push("type: 홈");
  L.push("tags: [수학]");
  L.push("---");
  L.push("");
  L.push("# 🏠 수학 지식그래프");
  L.push("");
  L.push("대한민국 중·고등 수학 전체를 **단원 = 노트, 선수관계 = 링크**로 구운 지식그래프.");
  L.push(`단원 노트 ${units.size}개 · 선수관계 ${edges.length}개 · 과목 ${subjectsAll.length}개. 니가교수 앱의 진단 엔진과 같은 그래프를 쓴다.`);
  L.push("");
  L.push("## 과정 지도");
  L.push("");
  L.push("```mermaid");
  L.push("flowchart LR");
  L.push('  m1["중1"] --> m2["중2"] --> m3["중3"] --> cm1["공통수학1"] --> cm2["공통수학2"]');
  L.push('  cm2 --> alg["대수"] --> c1["미적분Ⅰ"] --> c2["미적분Ⅱ"]');
  L.push('  cm1 --> prob["확률과 통계"]');
  L.push('  cm2 --> geo["기하"]');
  L.push('  c1 --> geo');
  L.push('  alg -. 고3(2015)은 수학Ⅰ·Ⅱ 명칭 .-> c1');
  L.push("```");
  L.push("");
  L.push("## 들어가기");
  L.push("");
  for (const lv of LEVELS) {
    L.push(`### ${lv.level}`);
    L.push("");
    L.push(lv.subjects.map(s => `[[${s.name}]]`).join(" · "));
    L.push("");
  }
  L.push("## 이 볼트 100% 활용법");
  L.push("");
  L.push("> [!tip] 지도가 본체다");
  L.push("> 1. **[[🗺️ 전체 지도.canvas|🗺️ 전체 지도]]** 를 열어라 — 과목이 학습 순서대로 늘어서고 단원 카드 사이에 선수관계 화살표가 흐른다. **카드를 클릭하고 Ctrl+스크롤로 확대하면 그 단원의 소단원·선수관계 표가 카드 안에 그대로 펼쳐진다.** 빨간 화살표 = 의존도 80% 이상의 핵심 경로.");
  L.push("> 2. **그래프 뷰**(Ctrl+G) Groups에 `tag:#영역/함수`, `tag:#영역/기하`, `tag:#영역/확률통계`, `tag:#영역/문자와식`, `tag:#영역/수와연산`, `tag:#영역/해석미적분` 색을 넣으면 영역별 커뮤니티가 보인다.");
  L.push("> 3. **약점 역추적**: 학생이 막힌 단원 노트를 열고 ⬅ 선수 단원을 의존도 순으로 거슬러 올라간다 — 앱의 오답 근본원인 추적과 같은 경로.");
  L.push("> 4. **로컬 그래프**(단원 노트에서 Ctrl+Shift+G): 그 단원의 앞뒤 생태계만 본다.");
  L.push("> 5. 소단원 체크박스는 검수·진도 표시용.");
  L.push("");
  L.push(`전체 목록은 [[INDEX]] · 허브 단원 랭킹은 [[GRAPH_REPORT]] · 유지보수 규약은 [[SCHEMA]]`);
  write("🏠 HOME.md", L);
}

/* ── 8. GRAPH_REPORT (Graphify식: 허브 노드·커뮤니티) ── */
{
  const ranked = [...units.keys()].map(n => ({ n, imp: impactOf(n), deg: prereqsOf(n).length + nextOf(n).length }))
    .sort((a, b) => b.imp - a.imp);
  const orphans = ranked.filter(r => r.deg === 0);
  const L = [];
  L.push("---\ntype: 리포트\ntags: [수학]\n---");
  L.push("");
  L.push("# 📊 GRAPH REPORT");
  L.push("");
  L.push(`단원 ${units.size} · 선수관계 엣지 ${edges.length} · 생성일 ${TODAY}`);
  L.push("");
  L.push("## 허브 단원 TOP 15 — 여기가 뚫리면 가장 많이 무너진다");
  L.push("");
  L.push("| 순위 | 단원 | 직접 연결 | 전이 영향력 |");
  L.push("| --- | --- | --- | --- |");
  ranked.slice(0, 15).forEach((r, i) => L.push(`| ${i + 1} | [[${r.n}]] | ${r.deg} | ${r.imp} |`));
  L.push("");
  L.push("## 영역(커뮤니티) 구성");
  L.push("");
  L.push("| 영역 | 단원 수 |");
  L.push("| --- | --- |");
  for (const st of STRANDS) {
    const cnt = [...units.values()].filter(u => u.strand === st.id).length;
    if (cnt) L.push(`| ${st.name} | ${cnt} |`);
  }
  L.push("");
  if (orphans.length) {
    L.push("## ⚠️ 고아 단원 (링크 0개 — lint 대상)");
    L.push("");
    for (const o of orphans) L.push(`- [[${o.n}]]`);
  } else {
    L.push("고아 단원 없음 — 모든 단원이 그래프에 연결되어 있다. ✅");
  }
  write("GRAPH_REPORT.md", L);
}

/* ── 9. INDEX (Karpathy: 전체 카탈로그, 한 줄 요약) ── */
{
  const L = [];
  L.push("---\ntype: 인덱스\ntags: [수학]\n---");
  L.push("");
  L.push("# INDEX — 볼트의 모든 페이지");
  L.push("");
  L.push(`- [[🏠 HOME]] — 대시보드, 과정 지도, 활용법`);
  L.push(`- [[🗺️ 전체 지도.canvas|🗺️ 전체 지도]] — 캔버스: 전 과정 단원 카드 + 선수관계 화살표, 클릭·확대 탐색`);
  L.push(`- [[GRAPH_REPORT]] — 허브 단원 랭킹, 영역 구성, lint 결과`);
  L.push(`- [[SCHEMA]] — 이 볼트의 규약과 유지보수 방법`);
  L.push(`- [[LOG]] — 생성·수정 기록`);
  L.push("");
  L.push("## 과목");
  L.push("");
  for (const s of subjectsAll) L.push(`- [[${s.name}]] — ${s.level}, 대단원 ${s.chapters.length} · 소단원 ${s.chapters.reduce((a, c) => a + c.topics.length, 0)}`);
  L.push("");
  L.push("## 단원");
  L.push("");
  for (const [name, u] of units) L.push(`- [[${name}]] — ${u.subjects.map(s => s.name).join("·")} / ${strandName(u.strand)} / 소단원 ${u.topics.length} / ${u.topics.slice(0, 3).join(", ")}${u.topics.length > 3 ? " …" : ""}`);
  write("INDEX.md", L);
}

/* ── 10. SCHEMA (Karpathy: 규약 문서 — 사람과 LLM이 함께 지키는 계약) ── */
write("SCHEMA.md", [
  "---\ntype: 스키마\ntags: [수학]\n---",
  "",
  "# SCHEMA — 이 볼트의 규약",
  "",
  "> Karpathy LLM-wiki 3층 구조를 따른다: **원천(불변) → 위키(생성물) → 스키마(이 문서)**.",
  "",
  "## 3층 구조",
  "",
  "| 층 | 위치 | 규칙 |",
  "| --- | --- | --- |",
  "| 원천 | `src/core/curriculum.js`(목차) · `src/core/knowledgeGraph.js`(선수관계) | 유일한 진실. 내용 수정은 여기서만 |",
  "| 위키 | `docs/math-curriculum/` (이 폴더) | 전부 생성물. 손으로 고치지 말 것 — 재생성하면 사라진다 |",
  "| 스키마 | 이 문서 | 규약 변경은 생성기와 함께 |",
  "",
  "## 페이지 규약",
  "",
  "- **단원 노트** (`단원/`): frontmatter(type·과목·영역·영향력·키워드) + 소단원 체크리스트 + ⬅선수/➡후속 표(의존도·이유). 노트 이름 = 대단원 이름 = 앱 지식그래프 노드 이름 (1:1, 절대 불일치 금지).",
  "- **과목 노트** (`과목/`): MOC. Mermaid 학습 흐름 + 단원 표.",
  "- 링크는 대단원명 그대로의 위키링크만 사용. 태그는 `수학/단원`, `영역/*` 2차원.",
  "",
  "## 운영 (ingest / query / lint)",
  "",
  "- **ingest**: 목차·선수관계를 고치면 → `node scripts/gen-curriculum-vault.mjs` → 볼트 전체 재생성 → [[LOG]]에 한 줄 추가 → commit.",
  "- **query**: 질문은 [[INDEX]]나 [[GRAPH_REPORT]]에서 시작하면 원본 코드를 읽지 않아도 된다 (Graphify 원칙: 지도를 읽지, 원문을 다시 읽지 않는다).",
  "- **lint**: 생성기가 자동 수행 — 깨진 위키링크 0, 고아 단원 0 유지. 결과는 [[GRAPH_REPORT]] 하단.",
]);

/* ── 11. LOG (append-only) ── */
{
  const logPath = path.join(OUT, "LOG.md");
  write("LOG.md", [
    "---\ntype: 로그\ntags: [수학]\n---",
    "",
    "# LOG (append-only)",
    "",
    "- 2026-07-05 v1 — 과목 단위 15노트 초판 생성 (curriculum.js 신설과 함께)",
    `- ${TODAY} v2 — 지식그래프 통합 재설계: 단원 엔티티 노트 ${units.size}개, 선수관계 엣지 ${edges.length}개(앱 그래프 ${edges.length - SUPPLEMENT.length} + 보강 ${SUPPLEMENT.length}), HOME/INDEX/SCHEMA/GRAPH_REPORT 도입 (Karpathy LLM-wiki + Graphify 방식)`,
    `- ${TODAY} v3 — 🗺️ 전체 지도.canvas 추가: 과목 그룹 × 단원 카드 × 선수관계 화살표, 클릭·확대 탐색 (Graphify graph.canvas 방식)`,
  ]);
}

/* ── 12. 🗺️ 전체 지도.canvas (Graphify graph.canvas 방식) ──
   과목 = 그룹 상자(학습 순서대로 왼→오), 단원 = 파일 카드(노트가 카드 안에 렌더됨),
   선수관계 = 화살표. 카드 클릭·확대(Ctrl+스크롤)하면 소단원·선수표가 그대로 보인다. */
{
  const STRAND_COLOR = { num: "3", alg: "6", fun: "5", geo: "4", sta: "2", cal: "1" }; // canvas 팔레트
  const FLOW = subjectsAll.filter(s => s.levelId !== "high15"); // 고3(2015)은 대수·미적분Ⅰ과 동일 단원이라 지도에선 생략
  const CARD_W = 300, CARD_H = 76, GAP_Y = 26, COL_GAP = 150, PAD = 34;
  const nodes = [], cEdges = [], pos = new Map(); // 단원명 → {id,x,y,col}
  let x = 0;
  FLOW.forEach((s, si) => {
    const colH = s.chapters.length * (CARD_H + GAP_Y) - GAP_Y;
    const y0 = -Math.round(colH / 2); // 세로 중앙 정렬
    nodes.push({ id: `g${si}`, type: "group", x: x - PAD, y: y0 - PAD - 44, width: CARD_W + PAD * 2, height: colH + PAD * 2 + 44, label: `${s.name}` });
    s.chapters.forEach((ch, ci) => {
      const id = `u${si}_${ci}`, y = y0 + ci * (CARD_H + GAP_Y);
      nodes.push({ id, type: "file", file: `단원/${ch.name}.md`, x, y, width: CARD_W, height: CARD_H, color: STRAND_COLOR[units.get(ch.name).strand] || "6" });
      if (!pos.has(ch.name)) pos.set(ch.name, { id, x, y, col: si });
    });
    x += CARD_W + PAD * 2 + COL_GAP;
  });
  edges.forEach((e, i) => {
    const f = pos.get(e.from), t = pos.get(e.to);
    if (!f || !t) return;
    const sides = f.col < t.col ? ["right", "left"] : f.col > t.col ? ["left", "right"] : (f.y < t.y ? ["bottom", "top"] : ["top", "bottom"]);
    cEdges.push({ id: `e${i}`, fromNode: f.id, fromSide: sides[0], toNode: t.id, toSide: sides[1], color: e.w >= 0.8 ? "1" : "0" });
  });
  fs.writeFileSync(path.join(OUT, "🗺️ 전체 지도.canvas"), JSON.stringify({ nodes, edges: cEdges }, null, 1), "utf8");
}

/* ── 13. lint: 깨진 링크·고아 검사 ── */
const allNotes = new Set([...units.keys(), ...subjectsAll.map(s => s.name), "🏠 HOME", "INDEX", "SCHEMA", "LOG", "GRAPH_REPORT", "🗺️ 전체 지도.canvas"]);
let broken = 0;
for (const dir of ["", "단원", "과목"]) {
  const d = path.join(OUT, dir);
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith(".md")) continue;
    const body = fs.readFileSync(path.join(d, f), "utf8");
    for (const m of body.matchAll(/\[\[([^\]|]+)\]\]/g)) {
      if (!allNotes.has(m[1])) { console.error("깨진 링크:", f, "→", m[1]); broken++; }
    }
  }
}
const orphanNames = [...units.keys()].filter(n => prereqsOf(n).length + nextOf(n).length === 0);
if (orphanNames.length) console.warn("고아 단원:", orphanNames.join(", "));
console.log(`생성 완료 — 단원 ${units.size} · 과목 ${subjectsAll.length} · 엣지 ${edges.length} · 깨진 링크 ${broken} · 고아 단원 ${orphanNames.length}`);
if (broken) process.exit(1);
