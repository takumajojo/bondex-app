/* BondEx サービス資料 — 線画シーン集
   すべて手描きのSVG。写真・AI画像は不使用。人物は小さく、輪郭のシルエットで置く
   (棒人間・丸顔は使わない。建築パースの人物表現に近い扱い)。 */
export const RED="#D60F11", INK="#1F2124", NAVY="#17263F", GRAY="#6E7175",
             HAIR="#DCD9D4", WARM="#F7F5F1", FLOOR="#F1EDE6", LINE2="#D9D3C9"

/** 人物シルエット。s=倍率, f=向き(1:右向き / -1:左向き) */
export const fig=(x,y,s=1,f=1,op=1)=>`
<g transform="translate(${x} ${y}) scale(${f*s} ${s})" fill="${NAVY}" opacity="${op}">
  <circle cx="0" cy="-62" r="7.4"/>
  <path d="M-8.4 -51 q8.4 -3.4 16.8 0 l2.6 30 h-6.4 l-1.6 33 h-6 l-1.4 -24 l-1.6 24 h-6 l-1.4 -33 h-6.4 z"/>
</g>`
/** 歩く人物 (脚を開く) */
export const walk=(x,y,s=1,f=1,op=1)=>`
<g transform="translate(${x} ${y}) scale(${f*s} ${s})" fill="${NAVY}" opacity="${op}">
  <circle cx="0" cy="-62" r="7.4"/>
  <path d="M-8.4 -51 q8.4 -3.4 16.8 0 l3.4 29 l-4.6 1 l5.4 32 h-6.6 l-6.4 -26 l-7.4 26 h-6.6 l6.2 -33 l-4.6 -1 z"/>
</g>`
/** ハードシェルのスーツケース。w×h, r=リブ本数 */
export const bag=(x,y,w,h,sw=2.4,tag=false)=>{
  const rib=Array.from({length:5},(_,i)=>
    `<line x1="${x+w*(i+1)/6}" y1="${y+8}" x2="${x+w*(i+1)/6}" y2="${y+h-8}"/>`).join("")
  return `<g fill="none" stroke="${NAVY}" stroke-linecap="round" stroke-linejoin="round">
    <g stroke-width="${sw}">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w*0.11}"/>
      <path d="M${x+w*0.34} ${y} v${-h*0.11} h${w*0.32} v${h*0.11}"/>
      <path d="M${x+w*0.34} ${y-h*0.11} h${w*0.32}"/>
    </g>
    <g stroke-width="${sw*0.6}" opacity=".5">${rib}</g>
    <circle cx="${x+w*0.16}" cy="${y+h+w*0.07}" r="${w*0.07}" stroke-width="${sw*0.85}"/>
    <circle cx="${x+w*0.84}" cy="${y+h+w*0.07}" r="${w*0.07}" stroke-width="${sw*0.85}"/>
  </g>` + (tag ? `
  <g>
    <path d="M${x+w*0.62} ${y-h*0.09} C ${x+w*0.86} ${y+h*0.01}, ${x+w*0.92} ${y+h*0.09}, ${x+w*0.92} ${y+h*0.15}"
          stroke="${RED}" stroke-width="${sw}" fill="none" stroke-linecap="round"/>
    <rect x="${x+w*0.78}" y="${y+h*0.13}" width="${w*0.28}" height="${h*0.2}" rx="4"
          fill="#FFFFFF" stroke="${NAVY}" stroke-width="${sw*0.9}"/>
    <circle cx="${x+w*0.92}" cy="${y+h*0.17}" r="2.8" fill="none" stroke="${NAVY}" stroke-width="1.5"/>
  </g>` : "")
}
/** 室内の下地: 壁のルーバー・開口部・床 */
export const room=(W,H,fl=0.62,open=true)=>`
  <rect x="0" y="0" width="${W}" height="${H}" fill="${WARM}"/>
  <g stroke="${LINE2}" stroke-width="1.6">
    ${Array.from({length:Math.floor(W/48)},(_,i)=>
      `<line x1="${34+i*48}" y1="${H*0.08}" x2="${34+i*48}" y2="${H*fl-6}"/>`).join("")}
  </g>
  ${open?`<rect x="${W*0.56}" y="${H*0.11}" width="${W*0.33}" height="${H*fl-H*0.11-6}" fill="#FFF" opacity=".8"/>
   <rect x="${W*0.56}" y="${H*0.11}" width="${W*0.33}" height="${H*fl-H*0.11-6}" fill="none" stroke="${LINE2}" stroke-width="1.6"/>`:""}
  <rect x="0" y="${H*fl}" width="${W}" height="${H*(1-fl)}" fill="${FLOOR}"/>
  <line x1="0" y1="${H*fl}" x2="${W}" y2="${H*fl}" stroke="#D3CDC2" stroke-width="1.7"/>`
export const shadow=(cx,cy,rx)=>`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${rx*0.09}" fill="#E2DBD0" opacity=".8"/>`
