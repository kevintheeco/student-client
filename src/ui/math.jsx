import React from "react";
const { useState, useEffect, useRef, useCallback } = React;

// MathViz는 지연 로딩 — math.jsx↔MathViz.jsx 정적 순환 import 방지 + 비수학 사용자 초기 번들 경량
const MathVizLazy=React.lazy(()=>import("./mathviz/MathViz.jsx").then(m=>({default:m.MathViz})));
// 블록 파스는 공용 계약(scenescript)의 관대한 파서 사용 — 트레일링 콤마 등 사소한 위반 복구, 실패 시 null
import { parseSceneBlock as _parseSceneBlock } from "./mathviz/scenescript.js";

function sanitizeSvg(s){
  return s
    .replace(/<!--[\s\S]*?-->/g,"")
    // 유니코드 조합문자(벡터 화살표 b⃗의 U+20D7, 오버라인 등)는 SVG 폰트가 못 그려 ▯로 깨짐 — 제거
    .replace(/[\u0300-\u036F\u20D0-\u20FF]/g,"")
    .replace(/<script[\s\S]*?<\/script>/gi,"")
    .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi,"")
    .replace(/javascript\s*:/gi,"")
    .replace(/data\s*:\s*text\/html/gi,"")
    .replace(/<a\s[^>]*href\s*=[^>]*>/gi,(m)=>m.replace(/href\s*=\s*["'][^"']*["']/gi,""));
}

/* ── 수식+그래프 렌더러 ──
   1단계: <svg>…</svg> 블록 → .graph-block 렌더
   2단계: 나머지 텍스트 → $…$/$$…$$ KaTeX 렌더
── */
// 수식 흔한 깨짐 방지: 수식 안 맨 % 는 LaTeX 주석이라 식이 잘림 → \% 로 이스케이프
function _fixLatex(s){
  if(!s)return s;
  return s.replace(/(^|[^\\])%/g,"$1\\%");
}
// 수식 깨짐 방지: 짝 안 맞는 $/$$(모델이 닫는 기호를 빼먹음)를 자동으로 닫아 raw LaTeX 노출을 막는다.
// 인라인 $…$는 줄 끝까지만 닫아(다음 줄 본문까지 수식으로 빨려들지 않게), 디스플레이 $$…$$는 끝까지 닫는다.
function _balanceMath(s){
  if(!s||s.indexOf("$")<0)return s;
  const D=String.fromCharCode(2);
  s=s.split("\\$").join(D);                                  // 통화 \$ 보호
  let out="",i=0;const n=s.length;
  while(i<n){
    if(s[i]==="$"&&s[i+1]==="$"){                            // 디스플레이 $$..$$
      const c=s.indexOf("$$",i+2);
      if(c<0){out+=s.slice(i).replace(/\s+$/,"")+"$$";i=n;}  // 안 닫힘 → 닫아줌
      else{out+=s.slice(i,c+2);i=c+2;}
      continue;
    }
    if(s[i]==="$"){                                          // 인라인 $..$
      const c=s.indexOf("$",i+1),nl=s.indexOf("\n",i+1);
      if(c>=0&&(nl<0||c<nl)){out+=s.slice(i,c+1);i=c+1;}     // 같은 줄에서 정상 닫힘
      else{const end=nl<0?n:nl;out+="$"+s.slice(i+1,end).replace(/\s+$/,"")+"$";i=end;}  // 안 닫힘 → 줄 끝에서 닫아줌
      continue;
    }
    out+=s[i];i++;
  }
  return out.split(D).join("\\$");
}
// 모델이 자주 내는 잘못된 LaTeX의 결정적 보정: 중괄호/ \left·\right 짝 맞추기, 끝에 매달린 ^·_ 제거.
function _repairLatex(s){
  if(!s)return s;
  let t=s.replace(/[_^]+\s*$/,"");                 // 인자 없는 위/아래첨자(x^ , a_) 제거
  let depth=0,extra=0;
  for(let i=0;i<t.length;i++){
    if(t[i]==="\\"){i++;continue;}                 // escaped 다음 글자 건너뜀
    if(t[i]==="{")depth++;
    else if(t[i]==="}"){depth>0?depth--:extra++;}
  }
  if(extra>0)t="{".repeat(extra)+t;                // 잉여 } → 앞에 { 보충
  if(depth>0)t=t+"}".repeat(depth);               // 안 닫힌 { → 뒤에 } 보충
  const L=(t.match(/\\left\b/g)||[]).length,R=(t.match(/\\right\b/g)||[]).length;
  if(L>R)t=t+" \\right.".repeat(L-R);
  else if(R>L)t="\\left.".repeat(R-L)+t;
  return t;
}
// 안전 렌더: _fixLatex→_repairLatex 후 KaTeX. 그래도 못 읽으면 null 반환(호출부에서 일반 텍스트로 폴백 → 빨간 에러 없음).
function _safeKatex(latex,displayMode){
  const tryRender=(s)=>{try{return window.katex?.renderToString(s,{displayMode,throwOnError:true,strict:false});}catch(e){return null;}};
  const base=_fixLatex(latex);
  return tryRender(base)||tryRender(_repairLatex(base))||null;
}
function _renderLatexInline(text,kp){
  if(!text)return[];
  const D=String.fromCharCode(1);            // 통화 달러($) 보호용 placeholder
  text=String(text).split("\\$").join(D);    // 이스케이프된 \$ (통화) 보호
  const nodes=[];
  const parts=text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/);
  parts.forEach((part,i)=>{
    if(!part)return;
    if(i%2===1){
      const disp=part.charAt(1)==='$';
      const latex=part.slice(disp?2:1,disp?-2:-1).trim();
      const html=_safeKatex(latex,disp);
      if(html){nodes.push(React.createElement('span',{key:kp+i,style:disp?{display:"block",textAlign:"center",overflowX:"auto",margin:"8px 0"}:undefined,dangerouslySetInnerHTML:{__html:html}}));return;}
      // KaTeX가 못 읽는 잘못된 수식 → 빨간 에러 대신 읽기 쉬운 일반 텍스트로
      nodes.push(React.createElement('span',{key:kp+i,style:{color:"var(--sub)"}},latex.split(D).join("$")));
    }else if(part){
      nodes.push(part.split(D).join("$"));
    }
  });
  return nodes;
}
/* ── 마크다운 표 ── */
const _splitRow=(l)=>l.trim().replace(/^\|/,"").replace(/\|$/,"").split("|").map(c=>c.trim());
const _isTableRow=(l)=>/^\s*\|.*\|\s*$/.test(l);
const _isTableSep=(l)=>/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(l)&&l.indexOf("-")>=0;
/* ── 블록 파서 (제목·목록·인용·표·문단) ── */
function _renderBlocks(seg,nodes,kr,kp){
  const lines=seg.split("\n");let i=0;
  while(i<lines.length){
    const line=lines[i];const k=kp+"_"+(kr.n++);
    // 표
    if(_isTableRow(line)&&i+1<lines.length&&_isTableSep(lines[i+1])){
      const header=_splitRow(line);
      const aligns=_splitRow(lines[i+1]).map(c=>{const L=c.startsWith(":"),R=c.endsWith(":");return(L&&R)?"center":R?"right":"left";});
      i+=2;const rows=[];
      while(i<lines.length&&_isTableRow(lines[i])){rows.push(_splitRow(lines[i]));i++;}
      const thS={padding:"7px 10px",border:"1px solid var(--line)",background:"var(--pri-s)",color:"var(--pri-d)",fontWeight:700,fontSize:12.5};
      const tdS=(a)=>({padding:"7px 10px",border:"1px solid var(--line)",fontSize:13,lineHeight:1.6,textAlign:a,verticalAlign:"top"});
      nodes.push(React.createElement("div",{key:k,style:{overflowX:"auto",margin:"10px 0"}},
        React.createElement("table",{style:{borderCollapse:"collapse",width:"100%",background:"var(--card)"}},
          React.createElement("thead",{key:"h"},React.createElement("tr",null,
            header.map((c,ci)=>React.createElement("th",{key:ci,style:{...thS,textAlign:aligns[ci]||"left"}},..._renderInline(c,k+"h"+ci))))),
          React.createElement("tbody",{key:"b"},rows.map((r,ri)=>React.createElement("tr",{key:ri,style:ri%2?{background:"var(--bg)"}:undefined},
            r.map((c,ci)=>React.createElement("td",{key:ci,style:tdS(aligns[ci]||"left")},..._renderInline(c,k+"r"+ri+"c"+ci))))))
        )
      ));
      continue;
    }
    if(/^###\s/.test(line)){
      nodes.push(React.createElement("div",{key:k,style:{fontFamily:"'Jua',sans-serif",fontSize:13.5,color:"var(--pri-d)",marginTop:10,marginBottom:2}},..._renderInline(line.slice(4),k)));
      i++;continue;
    }
    if(/^##\s/.test(line)){
      nodes.push(React.createElement("div",{key:k,style:{fontFamily:"'Jua',sans-serif",fontSize:15,color:"var(--ink)",marginTop:14,marginBottom:5,paddingBottom:4,borderBottom:"1.5px solid var(--line)"}},..._renderInline(line.slice(3),k)));
      i++;continue;
    }
    if(/^---+$/.test(line.trim())){
      nodes.push(React.createElement("hr",{key:k,style:{border:"none",borderTop:"1px solid var(--line)",margin:"8px 0"}}));
      i++;continue;
    }
    if(/^[-•]\s/.test(line)){
      const items=[];
      while(i<lines.length&&/^[-•]\s/.test(lines[i])){items.push(lines[i].replace(/^[-•]\s/,""));i++;}
      nodes.push(React.createElement("div",{key:k,style:{display:"flex",flexDirection:"column",gap:3,margin:"4px 0 8px"}},
        items.map((item,idx)=>React.createElement("div",{key:idx,style:{display:"flex",gap:7,alignItems:"flex-start"}},
          React.createElement("span",{style:{color:"var(--pri)",fontWeight:900,flexShrink:0,lineHeight:1.85,fontSize:11}},"•"),
          React.createElement("span",{style:{flex:1,lineHeight:1.78}},..._renderInline(item,k+"b"+idx))
        ))
      ));
      continue;
    }
    if(/^\d+\.\s/.test(line)){
      const items=[];let n=1;
      while(i<lines.length&&/^\d+\.\s/.test(lines[i])){items.push({n,t:lines[i].replace(/^\d+\.\s/,"")});n++;i++;}
      nodes.push(React.createElement("div",{key:k,style:{display:"flex",flexDirection:"column",gap:3,margin:"4px 0 8px"}},
        items.map((item,idx)=>React.createElement("div",{key:idx,style:{display:"flex",gap:7,alignItems:"flex-start"}},
          React.createElement("span",{style:{color:"var(--pri)",fontWeight:700,flexShrink:0,lineHeight:1.85,fontSize:12,minWidth:16,textAlign:"right"}},item.n+"."),
          React.createElement("span",{style:{flex:1,lineHeight:1.78}},..._renderInline(item.t,k+"n"+idx))
        ))
      ));
      continue;
    }
    if(/^>\s/.test(line)){
      nodes.push(React.createElement("div",{key:k,style:{borderLeft:"3px solid var(--pri)",background:"var(--pri-s)",borderRadius:"0 8px 8px 0",padding:"6px 12px",margin:"4px 0",lineHeight:1.75,color:"var(--ink)"}},..._renderInline(line.slice(2),k)));
      i++;continue;
    }
    if(!line.trim()){
      if(nodes.length>0)nodes.push(React.createElement("div",{key:k,style:{height:5}}));
      i++;continue;
    }
    nodes.push(React.createElement("div",{key:k,style:{lineHeight:1.85}},..._renderInline(line,k)));
    i++;
  }
}
function _renderInline(text,kp){
  if(!text)return[];
  // ★ 수식($$..$$, $..$)을 마크다운(*,**,`)보다 먼저 자리표시자로 보호한다.
  // 안 그러면 $c_1^*$ 처럼 별표(^*)로 끝나는 수식이 한 줄에 둘 이상 있을 때, 그 사이가
  // 마크다운 이탤릭 *...* 으로 묶여 수식이 깨지고 화면에 날 LaTeX($c_1^ 등)가 노출됨.
  const S=String.fromCharCode(0),C=String.fromCharCode(3);
  const store=[];
  const prot=String(text).split("\\$").join(C)                                  // 통화 \$ 보호
    .replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g,m=>{store.push(m);return S+(store.length-1)+S;});
  // 자리표시자 → 실제 수식 노드로 복원(사이 텍스트는 통화 $ 복원 후 그대로)
  const restore=(str,key)=>{
    const out=[];
    str.split(new RegExp(S+"(\\d+)"+S)).forEach((b,bi)=>{
      if(!b)return;
      if(bi%2===1)out.push(..._renderLatexInline(store[+b],key+'x'+bi));
      else out.push(b.split(C).join("$"));
    });
    return out;
  };
  const rawText=(str)=>str.replace(new RegExp(S+"(\\d+)"+S,"g"),(m,d)=>store[+d]).split(C).join("$"); // 코드용 리터럴 복원
  const nodes=[];
  prot.split(/(\*\*[^*\n]+?\*\*|\*[^*\n]+?\*|`[^`\n]+?`)/).forEach((seg,i)=>{
    if(!seg)return;
    const k=kp+'_i'+i;
    if(seg.startsWith('**')&&seg.endsWith('**')&&seg.length>4)
      nodes.push(React.createElement('strong',{key:k},...restore(seg.slice(2,-2),k)));
    else if(seg.startsWith('*')&&seg.endsWith('*')&&seg.length>2)
      nodes.push(React.createElement('em',{key:k},...restore(seg.slice(1,-1),k)));
    else if(seg.startsWith('`')&&seg.endsWith('`')&&seg.length>2)
      nodes.push(React.createElement('code',{key:k,style:{background:'#F0EDFF',borderRadius:4,padding:'0 5px',fontSize:'.88em',color:"var(--pri-d)"}},rawText(seg.slice(1,-1))));
    else
      nodes.push(...restore(seg,k));
  });
  return nodes;
}
/* ── 로딩 중 응원 문구 (회전) ── */

function MathText({text,tag:Tag="p",className,style}){
  if(!text)return React.createElement(Tag,{className,style});
  const cleaned=_balanceMath(String(text)
    .replace(/<!--[\s\S]*?-->/g,"")
    .replace(/```[\w]*\s*(<svg[\s\S]*?<\/svg>)\s*```/gi,"$1")
    .replace(/<svg(?![\s\S]*<\/svg>)[\s\S]*$/i,"")                      // 닫히지 않은(잘린) svg는 통째로 제거 — 날것 노출 방지
    .replace(/```mathviz(?![\s\S]*```)[\s\S]*$/i,"")                    // 스트리밍 중 잘린 mathviz 블록도 동일 처리
    .replace(/\\\[([\s\S]+?)\\\]/g,(m,p)=>"\n\n$$"+p.trim()+"$$\n\n")   // \[..\] → $$..$$
    .replace(/\\\(([\s\S]+?)\\\)/g,(m,p)=>"$"+p.trim()+"$"));           // \(..\) → $..$ → 마지막에 짝 안 맞는 $ 보정
  if(Tag==="span")return React.createElement("span",{className,style},..._renderInline(cleaned,"s"));
  const nodes=[];const kr={n:0};
  // 1) 벡터 장면 스크립트(```mathviz) 먼저 분리 — 데이터에서만 렌더(innerHTML 미사용), 실패 시 조용히 생략
  const vizSegs=cleaned.split(/(```mathviz[\s\S]*?```)/i);
  vizSegs.forEach((vseg,vi)=>{
    if(vi%2===1){
      const script=_parseSceneBlock(vseg);
      if(script)nodes.push(React.createElement("div",{key:"viz"+vi,className:"mathviz-block"},
        React.createElement(React.Suspense,{fallback:null},
          React.createElement(MathVizLazy,{script,controls:true,autoplay:false}))));
      return;
    }
    // 2) 기존 경로 그대로: <svg> 분리 → $$..$$ → 마크다운 (캐시된 옛 해설 렌더 불변)
    const svgSegs=vseg.split(/(<svg[\s\S]*?<\/svg>)/i);
    svgSegs.forEach((seg,si)=>{
      const sk=vi+"_"+si;
      if(si%2===1){nodes.push(React.createElement("div",{key:"svg"+sk,className:"graph-block",dangerouslySetInnerHTML:{__html:sanitizeSvg(seg)}}));return;}
      // 멀티라인 디스플레이 수식 $$...$$ 먼저 분리 (행렬·정렬식이 줄로 안 깨지게)
      const dispSegs=seg.split(/(\$\$[\s\S]+?\$\$)/);
      dispSegs.forEach((dseg,di)=>{
        if(!dseg)return;
        if(di%2===1){
          const latex=dseg.slice(2,-2).trim();const dkk="dm"+sk+"_"+di;
          const html=_safeKatex(latex,true);
          if(html){nodes.push(React.createElement("div",{key:dkk,style:{margin:"10px 0",overflowX:"auto"},dangerouslySetInnerHTML:{__html:html}}));return;}
          // 못 읽는 수식 → 빨간 에러 대신 일반 텍스트
          nodes.push(React.createElement("div",{key:dkk,style:{color:"var(--sub)"}},latex));return;
        }
        _renderBlocks(dseg,nodes,kr,sk+"_"+di);
      });
    });
  });
  return React.createElement("div",{className,style},...nodes);
}


export { sanitizeSvg, _fixLatex, _balanceMath, _repairLatex, _safeKatex, _renderLatexInline, _splitRow, _isTableRow, _isTableSep, _renderBlocks, _renderInline, MathText };
