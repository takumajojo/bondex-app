import fs from "node:fs"
const LOGO = fs.readFileSync("docs/collateral/assets/logo.txt","utf8")
const JOJO = fs.readFileSync("docs/collateral/assets/jojo.txt","utf8")
const RED="#D60F11", INK="#222222", GRAY="#777777", FAINT="#C9CDD1", LINE="#E8EAEC", TINT="#FDF5F5"

/* ---- line icons (Lucide 系・線画のみ) ---- */
const P={
 building:`<rect x="4.5" y="3" width="15" height="18" rx="1.2"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10.5 21v-3h3v3"/>`,
 hotel:`<rect x="3.5" y="7" width="17" height="14" rx="1.2"/><path d="M7 11h2.5M14.5 11h2.5M7 15h2.5M14.5 15h2.5M10 21v-3h4v3M8.5 7V3.5h7V7"/>`,
 truck:`<rect x="2" y="7" width="11" height="9" rx="1"/><path d="M13 10h4l3 3v3h-7z"/><circle cx="6.5" cy="18" r="1.7"/><circle cx="16.5" cy="18" r="1.7"/>`,
 user:`<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/>`,
 doc:`<path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M8 12h8M8 15h8M8 18h5"/>`,
 chat:`<path d="M20.5 12.2a7.7 7.7 0 0 1-8.3 7.6L5 21.5l1.7-6.8A7.7 7.7 0 1 1 20.5 12.2z"/><path d="M9 12h.01M12 12h.01M15 12h.01"/>`,
 yen:`<circle cx="12" cy="12" r="9"/><path d="M8.4 7.6L12 12.4l3.6-4.8M8.6 13h6.8M8.6 15.6h6.8M12 12.4V17.2"/>`,
 send:`<path d="M21 3L10.5 13.5M21 3l-6.8 18-3.7-7.5L3 9.8z"/>`,
 file:`<path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9 16l2 2 4-4.5"/>`,
 check:`<circle cx="12" cy="12" r="9"/><path d="M7.8 12.3l2.9 2.9 5.6-6"/>`,
}
const ic=(k,s=22,sw=1.4,c="currentColor")=>`<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${P[k]}</svg>`

/* ---- 比較表の記号 ---- */
const MK={
 o:`<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="${RED}" stroke-width="2.2"><circle cx="12" cy="12" r="8.2"/></svg>`,
 t:`<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="${GRAY}" stroke-width="1.8" stroke-linejoin="round"><path d="M12 4.4L20.2 19H3.8z"/></svg>`,
 x:`<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="${FAINT}" stroke-width="1.9" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>`,
}
const cell=(v)=> MK[v] ? `<span class="mk">${MK[v]}</span>`
  : v==="B" ? `<span class="bx">BondEx</span>` : `<span class="tx">${v}</span>`

/* ---- 従来の運用：横チェーン ---- */
const chain=(L)=>{
  const N=L.chain, step=110, x0=40, cy=48, r=27
  let a="", s=`<svg viewBox="0 0 520 116" width="100%">`
  N.forEach(([k,lab],i)=>{
    const cx=x0+i*step
    s+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" stroke="#E1E4E7" stroke-width="1.3"/>
        <g transform="translate(${cx-12},${cy-12})" color="${GRAY}">${ic(k,24,1.3)}</g>
        <text x="${cx}" y="${cy+r+20}" text-anchor="middle" font-size="16" fill="${GRAY}">${lab}</text>`
    if(i<N.length-1){
      const a1=cx+r+9, a2=cx+step-r-9
      a+=`<path d="M${a1} ${cy} H${a2}" stroke="#C9CDD1" stroke-width="1.4" stroke-dasharray="4 3"/>
          <path d="M${a2} ${cy} l-5.5 -3.6 v7.2 z" fill="#C9CDD1"/>
          <path d="M${a1} ${cy} l5.5 -3.6 v7.2 z" fill="#C9CDD1"/>`
    }
  })
  return s+a+`</svg>`
}
/* ---- BondEx：ハブ（中央の赤い円を最も目立たせる） ---- */
const hub=(L)=>{
  const cx=260, cy=62, R=46, r=25, nx=[92,428], ny=[28,100]
  const pos=[[nx[0],ny[0]],[nx[1],ny[0]],[nx[0],ny[1]],[nx[1],ny[1]]]
  let s=`<svg viewBox="0 0 520 148" width="100%">
   <defs><filter id="wh"><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0"/></filter></defs>`
  pos.forEach(([px,py])=>{
    const dx=px-cx, dy=py-cy, d=Math.hypot(dx,dy), ux=dx/d, uy=dy/d
    const sx=cx+ux*(R+7), sy=cy+uy*(R+7), ex=px-ux*(r+9), ey=py-uy*(r+9)
    const ang=Math.atan2(ey-sy,ex-sx)
    const h=6.5, a1x=ex-h*Math.cos(ang-0.42), a1y=ey-h*Math.sin(ang-0.42)
    const a2x=ex-h*Math.cos(ang+0.42), a2y=ey-h*Math.sin(ang+0.42)
    s+=`<path d="M${sx} ${sy} L${ex} ${ey}" stroke="${RED}" stroke-width="1.8"/>
        <path d="M${ex} ${ey} L${a1x} ${a1y} L${a2x} ${a2y} z" fill="${RED}"/>`
  })
  pos.forEach(([px,py],i)=>{
    const [k,lab]=L.hub[i]
    s+=`<circle cx="${px}" cy="${py}" r="${r}" fill="#fff" stroke="#F0D6D7" stroke-width="1.3"/>
        <g transform="translate(${px-11},${py-11})" color="${RED}">${ic(k,22,1.3)}</g>
        <text x="${px}" y="${py+r+18}" text-anchor="middle" font-size="15" fill="${INK}">${lab}</text>`
  })
  return s+`<circle cx="${cx}" cy="${cy}" r="${R}" fill="${RED}"/>
    <image href="${LOGO}" x="${cx-34}" y="${cy-8}" width="68" height="16" filter="url(#wh)" preserveAspectRatio="xMidYMid meet"/>
  </svg>`
}
/* ---- 文末ブロックの小さなハブ ---- */
const miniHub=(L)=>{
  const cx=131, top=24, R=22, xs=[34,131,228]
  let s=`<svg viewBox="0 0 262 124" width="100%">
   <defs><filter id="wh2"><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0"/></filter></defs>`
  xs.forEach((x,i)=>{
    const [k,lab]=L.mini[i]
    s+=`<circle cx="${x}" cy="${top}" r="18" fill="#fff" stroke="#E1E4E7" stroke-width="1.3"/>
        <g transform="translate(${x-9},${top-9})" color="${GRAY}">${ic(k,18,1.3)}</g>
        <text x="${x}" y="${top+34}" text-anchor="middle" font-size="14" fill="${GRAY}">${lab}</text>`
    if(i<2) s+=`<path d="M${x+23} ${top} H${xs[i+1]-23}" stroke="#D4D8DC" stroke-width="1.2" stroke-dasharray="3 3"/>`
  })
  xs.forEach(x=>{ s+=`<path d="M${x} ${top+42} L${cx} ${98-R}" stroke="${RED}" stroke-width="1.1" stroke-dasharray="3 3" opacity=".55"/>` })
  return s+`<circle cx="${cx}" cy="98" r="${R}" fill="${RED}"/>
    <image href="${LOGO}" x="${cx-19}" y="93.5" width="38" height="9" filter="url(#wh2)"/></svg>`
}
const japan=()=>`<img src="assets/japan.png" alt="Japan">`

const C={
ja:{lang:"ja",font:`"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif`,wrap:"auto-phrase",
 h1:"なぜ BondEx が選ばれるのか",
 sub:"配送会社ではなく、ホテル間配送オペレーションを支援するプラットフォームです。",
 dL:"従来の運用", dLn:"関係者それぞれとのやり取りが発生します。",
 dR:"BondEx", dRn:"BondEx がハブとなり、すべての調整を引き受けます。",
 chain:[["building","旅行会社"],["hotel","ホテル"],["truck","配送会社"],["hotel","ホテル"],["building","旅行会社"]],
 hub:[["building","旅行会社"],["truck","配送会社"],["hotel","ホテル"],["user","ゲスト"]],
 mini:[["building","旅行会社"],["hotel","ホテル"],["truck","配送会社"]],
 cols:["ランドオペレーターの業務","従来の運用","BondEx"],
 rows:[["ホテルへの発送依頼","必要","必要"],["配送会社の手配","自社対応","B"],["ホテルとの調整","自社対応","B"],
  ["送り状の発行","自社対応","B"],["配送状況の確認","自社対応","B"],["ゲスト対応","自社対応","B"],
  ["トラブル一次対応","自社対応","B"],["リアルタイム追跡","t","o"],["多言語サポート","t","o"],
  ["団体旅行対応","t","o"],["ランドオペレーター専用管理画面","x","o"]],
 stH:"BondEx は配送会社ではありません。",
 stB:"配送会社・ホテル・旅行会社をつなぎ、<br>ホテル間配送オペレーション全体を支援するプラットフォームです。",
 cards:[["hotel","ホテルの負担を軽減","ホテルは通常の荷物としてお預かりいただくだけ。<br>配送会社との調整は BondEx が担当します。"],
  ["doc","ランドオペレーターの手間を削減","旅程をご登録いただくだけで、送り状・バウチャーの<br>発行から配送状況の管理まで対応します。"],
  ["chat","ゲスト対応も BondEx","配送状況の確認からお問い合わせまで、<br>多言語で対応します。"]],
 priceT:"ご利用料金",
 priceB:"料金は配送件数・運用内容に応じて<br>個別にご提案いたします。<br>スーツケースのサイズ・重量に関わらず<br>一律料金でご利用いただけます。",
 flowT:"導入までの流れ",
 flow:[["send","STEP 01","旅程のご送付","旅程表 (Excel / CSV / PDF) をお送りください。"],
  ["file","STEP 02","バウチャー発行","BondEx が送り状・バウチャーを発行します。"],
  ["check","STEP 03","配送完了","BondEx より配送完了をご案内。ゲストは次のホテルで荷物を受け取ります。"]],
 areaT:"対応エリア", areaB:"日本全国の主要都市から地方まで、<br>全国のホテルへお届けします。",
 operated:"株式会社JOJO が運営しています"},
en:{lang:"en",font:`"Helvetica Neue",Helvetica,Arial,sans-serif`,wrap:"normal",
 h1:"Why land operators choose BondEx",
 sub:"Not a delivery company — a platform that supports your hotel-to-hotel delivery operations.",
 dL:"How it works today", dLn:"You deal with every party separately.",
 dR:"BondEx", dRn:"BondEx becomes the hub and takes on every hand-off.",
 chain:[["building","Travel co."],["hotel","Hotel"],["truck","Delivery co."],["hotel","Hotel"],["building","Travel co."]],
 hub:[["building","Travel company"],["truck","Delivery company"],["hotel","Hotel"],["user","Guest"]],
 mini:[["building","Travel co."],["hotel","Hotel"],["truck","Delivery co."]],
 cols:["What the land operator does","Today","BondEx"],
 rows:[["Request to the hotel","Required","Required"],["Arranging the delivery company","Your team","B"],
  ["Coordinating with hotels","Your team","B"],["Issuing the waybill","Your team","B"],
  ["Checking delivery status","Your team","B"],["Guest enquiries","Your team","B"],
  ["First response to problems","Your team","B"],["Real-time tracking","t","o"],["Multilingual support","t","o"],
  ["Group travel","t","o"],["Dedicated console for land operators","x","o"]],
 stH:"BondEx is not a delivery company.",
 stB:"It connects delivery companies, hotels and travel companies —<br>a platform supporting the whole hotel-to-hotel delivery operation.",
 cards:[["hotel","Less burden on hotels","Hotels simply accept the luggage as usual.<br>BondEx handles coordination with the carrier."],
  ["doc","Less work for land operators","Register the itinerary and we handle everything<br>from waybills and vouchers through to tracking."],
  ["chat","Guest support by BondEx","From delivery status checks to enquiries,<br>handled in multiple languages."]],
 priceT:"Pricing",
 priceB:"Rates are proposed individually, based on your<br>volume and how you use the service.<br>One flat rate per piece — regardless of<br>suitcase size or weight.",
 flowT:"Getting started",
 flow:[["send","STEP 01","Send the itinerary","Excel, CSV or PDF — whatever you already use."],
  ["file","STEP 02","Vouchers issued","BondEx issues the waybills and vouchers."],
  ["check","STEP 03","Delivered","BondEx confirms the delivery. Guests collect their luggage at the next hotel."]],
 areaT:"Coverage", areaB:"From major cities to regional areas,<br>we deliver to hotels across Japan.",
 operated:"Operated by JOJO Inc."}}

const css=(t)=>`
@page{size:A4 landscape;margin:0}
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:${t.font};color:${INK};word-break:${t.wrap};line-break:strict;font-weight:400;
     font-feature-settings:"palt" 1;-webkit-font-smoothing:antialiased;background:#fff}
.sheet{width:297mm;height:210mm;display:flex;flex-direction:column;overflow:hidden;padding:0 13mm}
h1,h2,h3,h4,.bx,b{font-weight:700}

.head{display:flex;align-items:flex-end;justify-content:space-between;padding:7mm 0 0;flex:none}
.head img{height:6mm;width:auto;display:block}
.head .pg{font-size:8pt;color:#C9CDD1;letter-spacing:.16em;font-weight:500}
.title{padding:4mm 0 0;flex:none}
.title h1{font-size:19pt;letter-spacing:-.01em}
.title p{font-size:8.6pt;color:${INK};margin-top:2.2mm;font-weight:500}

.body{display:grid;grid-template-columns:1fr 88mm;gap:6mm;padding:5mm 0 0;flex:1;min-height:0}
.main{display:flex;flex-direction:column;gap:4mm;min-width:0;min-height:0}
.side{display:grid;grid-template-rows:repeat(3,1fr) auto auto auto;gap:2mm;min-width:0;min-height:0}

.pnl{border:1px solid ${LINE};border-radius:4.2mm;background:#fff;box-shadow:0 1px 1px rgba(34,34,34,.02)}
.pnl.r{border-color:#F3D3D4}
.dia{display:grid;grid-template-columns:1fr 1.06fr;gap:4mm;flex:none}
.dbox{padding:3.6mm 4.5mm 1.6mm}
.dbox h3{font-size:9pt}
.dbox.r h3{color:${RED}}
.dbox .n{font-size:6.8pt;color:${GRAY};margin-top:1.2mm;font-weight:400}
.dbox .g{margin-top:1mm}

.tbl{padding:0 1mm;flex:none}
table{width:100%;border-collapse:collapse;table-layout:fixed}
col.k{width:46%}col.g{width:27%}col.b{width:27%}
thead th{font-size:8pt;font-weight:700;padding:2.4mm 0;text-align:center}
thead th.k{text-align:left;padding-left:3.5mm}
thead th.b{color:${RED};background:${TINT};border-radius:3mm 3mm 0 0}
tbody td{padding:1.2mm 0;border-top:1px solid ${LINE};font-size:8pt;line-height:1.3;text-align:center}
tbody td.k{text-align:left;padding-left:3.5mm}
tbody td.b{background:${TINT}}
tbody tr:last-child td.b{border-radius:0 0 3mm 3mm}
.mk{display:inline-flex;line-height:1}
.tx{color:${GRAY};font-size:8pt;font-weight:500}
.bx{color:${RED};font-size:8pt}

.stmt{display:grid;grid-template-columns:1fr 46mm;gap:4mm;align-items:center;padding:4.5mm 5mm;flex:1;min-height:0}
.stmt .l{display:flex;gap:4mm}
.stmt .bar{width:1.4mm;background:${RED};border-radius:1mm;flex:none}
.stmt h2{font-size:14.5pt;letter-spacing:-.02em;line-height:1.4}
.stmt p{font-size:7.6pt;color:${GRAY};line-height:1.8;margin-top:2.6mm;font-weight:400}

.sc{display:grid;grid-template-columns:10mm 1fr;gap:3.4mm;padding:3mm 4mm;align-items:center}
.sc .i{color:${RED};padding-top:.4mm}
.sc h4{font-size:8.6pt;margin-bottom:1.4mm}
.sc h4 em{font-style:normal;color:${RED};font-weight:700;margin-right:1.6mm}
.sc p{font-size:6.9pt;color:${GRAY};line-height:1.42}

.price{padding:3mm 4mm;display:grid;grid-template-columns:10mm 1fr;gap:3.4mm;align-items:center}
.price h4{font-size:8.6pt;color:${RED};margin-bottom:1.6mm}
.price p{font-size:6.9pt;color:${INK};line-height:1.42;font-weight:400}
.price .i{color:${RED}}

.flow{padding:3mm 4mm}
.flow h4{font-size:8.2pt;margin-bottom:2.2mm}
.flow .g{display:grid;grid-template-columns:1fr 5mm 1fr 5mm 1fr;align-items:start;gap:0}
.flow .s{text-align:center}
.flow .s .i{color:${RED};margin-bottom:1.4mm}
.flow .s .l{font-size:6pt;color:${RED};font-weight:700;letter-spacing:.08em}
.flow .s b{display:block;font-size:7.4pt;margin:.8mm 0 1mm}
.flow .s p{font-size:5.2pt;color:${GRAY};line-height:1.38}
.flow .a{color:${RED};text-align:center;padding-top:4mm;font-size:8pt}

.area{padding:3mm 4mm;display:grid;grid-template-columns:1fr 44mm;gap:3mm;align-items:center;min-height:0}
.area h4{font-size:8.2pt;margin-bottom:1.8mm}
.area p{font-size:6.9pt;color:${GRAY};line-height:1.5}
.area .m{display:flex;align-items:center;justify-content:center}
.area .m img{height:30mm;width:auto;display:block}

.foot{display:flex;align-items:center;justify-content:center;gap:5mm;padding:5mm 0 6mm;flex:none}
.foot img.j{height:4.6mm;opacity:.85}
.foot img.b{height:4.6mm}
.foot span{font-size:6.6pt;color:${GRAY}}
`

const doc=(t)=>{
  const rows=t.rows.map(([k,g,b])=>
    `<tr><td class="k">${k}</td><td>${cell(g)}</td><td class="b">${cell(b)}</td></tr>`).join("")
  const sc=t.cards.map(([k,h,p],i)=>
    `<div class="pnl sc"><div class="i">${ic(k,20,1.3)}</div>
     <div><h4><em>0${i+1}</em>${h}</h4><p>${p}</p></div></div>`).join("")
  const fl=t.flow.map(([k,l,b,p])=>
    `<div class="s"><div class="i">${ic(k,19,1.3)}</div><div class="l">${l}</div><b>${b}</b><p>${p}</p></div>`)
  return `<!doctype html><html lang="${t.lang}"><head><meta charset="utf-8">
<title>BondEx — ${t.lang==="ja"?"なぜ BondEx が選ばれるのか":"Why BondEx"}</title>
<style>${css(t)}</style></head><body><div class="sheet">
  <div class="head"><img src="${LOGO}" alt="BondEx"><div class="pg">02</div></div>
  <div class="title"><h1>${t.h1}</h1><p>${t.sub}</p></div>

  <div class="body">
    <div class="main">
      <div class="dia">
        <div class="pnl dbox"><h3>${t.dL}</h3><div class="n">${t.dLn}</div><div class="g">${chain(t)}</div></div>
        <div class="pnl r dbox"><h3>${t.dR}</h3><div class="n">${t.dRn}</div><div class="g">${hub(t)}</div></div>
      </div>
      <div class="pnl tbl">
        <table><colgroup><col class="k"><col class="g"><col class="b"></colgroup>
          <thead><tr><th class="k">${t.cols[0]}</th><th>${t.cols[1]}</th><th class="b">${t.cols[2]}</th></tr></thead>
          <tbody>${rows}</tbody></table>
      </div>
      <div class="pnl stmt">
        <div class="l"><div class="bar"></div><div><h2>${t.stH}</h2><p>${t.stB}</p></div></div>
        <div>${miniHub(t)}</div>
      </div>
    </div>

    <div class="side">
      ${sc}
      <div class="pnl r price"><div class="i">${ic("yen",20,1.3)}</div><div><h4>${t.priceT}</h4><p>${t.priceB}</p></div></div>
      <div class="pnl flow"><h4>${t.flowT}</h4>
        <div class="g">${fl[0]}<div class="a">&rarr;</div>${fl[1]}<div class="a">&rarr;</div>${fl[2]}</div></div>
      <div class="pnl area"><div><h4>${t.areaT}</h4><p>${t.areaB}</p></div><div class="m">${japan()}</div></div>
    </div>
  </div>

  <div class="foot"><img class="j" src="${JOJO}" alt="JOJO"><span>${t.operated}</span><img class="b" src="${LOGO}" alt="BondEx"></div>
</div></body></html>`
}
for(const k of ["ja","en"]){
  fs.writeFileSync(`docs/collateral/bondex-brochure-p2-${k}.html`, doc(C[k]))
  console.log("wrote bondex-brochure-p2-"+k+".html")
}
