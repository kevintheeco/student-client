// placeLabel — 라벨 자동 배치 (겹침 회피, 벡터수학엔진 §1 "라벨 회피 규칙")
// 8방향(UR·UL·DR·DL·상·하·좌·우) × 여백 단계(0.13부터 +0.08씩)로 후보를 만들고,
// 장애물(곡선·축 샘플점)과 라벨 박스가 충돌하지 않는 첫 위치(=가장 가까운 자리)를 쓴다.
// DOM 측정 없는 순수 함수 — 스텝 플레이어에서 깜빡임 없이 결정적으로 동작, node 테스트 가능.

// 라벨 크기 추정: 한글·전각은 1.0em, 나머지는 0.62em 폭
function estimateLabelBox(text, fontSize=15){
  let w=0;
  for(const ch of String(text)){
    w += /[ᄀ-ᇿ㄰-㆏가-힯一-鿿]/.test(ch) ? fontSize : fontSize*0.62;
  }
  return { w, h: fontSize*1.25 };
}

// 방향 순서는 mathtools place_label과 동일: UR UL DR DL 상 하 좌 우
// (화면좌표: y는 아래로 증가 — U는 y−, D는 y+)
const DIRS=[
  { id:"UR", fx:(a,b,w,h)=>[a[0]+b,        a[1]-b-h]   },
  { id:"UL", fx:(a,b,w,h)=>[a[0]-b-w,      a[1]-b-h]   },
  { id:"DR", fx:(a,b,w)=>[a[0]+b,          a[1]+b]     },
  { id:"DL", fx:(a,b,w)=>[a[0]-b-w,        a[1]+b]     },
  { id:"U",  fx:(a,b,w,h)=>[a[0]-w/2,      a[1]-b-h]   },
  { id:"D",  fx:(a,b,w)=>[a[0]-w/2,        a[1]+b]     },
  { id:"L",  fx:(a,b,w,h)=>[a[0]-b-w,      a[1]-h/2]   },
  { id:"R",  fx:(a,b,w,h)=>[a[0]+b,        a[1]-h/2]   },
];

// 장애물 점이 하나라도 (margin 포함) 박스 안에 들어오면 충돌
function clearOf(x, y, w, h, obstacles, marginPx){
  const x0=x-marginPx, y0=y-marginPx, x1=x+w+marginPx, y1=y+h+marginPx;
  for(const p of obstacles){
    if(p[0]>=x0 && p[0]<=x1 && p[1]>=y0 && p[1]<=y1) return false;
  }
  return true;
}

// anchor: 라벨을 붙일 점 [px,py] / unit: 수학 1단위당 픽셀 수 (buff·margin 환산용)
// 반환: {x, y, dir} — 라벨 박스의 좌상단 픽셀 좌표
function placeLabel({anchor, w, h, obstacles=[], unit=60,
                     buff0=0.13, step=0.08, maxBuff=0.65, margin=0.05}){
  const marginPx=margin*unit;
  for(let b=buff0; b<=maxBuff+1e-9; b+=step){
    const bPx=b*unit;
    for(const d of DIRS){
      const [x,y]=d.fx(anchor,bPx,w,h);
      if(clearOf(x,y,w,h,obstacles,marginPx)) return {x,y,dir:d.id};
    }
  }
  const [x,y]=DIRS[0].fx(anchor,buff0*unit,w,h);   // 전부 실패 시 UR 폴백
  return {x,y,dir:"UR"};
}

export { placeLabel, estimateLabelBox };
