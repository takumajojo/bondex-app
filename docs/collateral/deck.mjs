import fs from "node:fs"
const LOGO = fs.readFileSync("docs/collateral/assets/logo.txt","utf8")
const JOJO = fs.readFileSync("docs/collateral/assets/jojo.txt","utf8")
const RED="#D60F11", INK="#222222", GRAY="#777777", FAINT="#C9CDD1", LINE="#E8EAEC", TINT="#FDF5F5", SOFT="#F7F8F9"

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
 pen:`<path d="M4 20l1-4.2L16.2 4.6a2 2 0 0 1 2.8 2.8L7.8 18.6z"/><path d="M14.4 6.4l3.2 3.2M4 20l4.2-1"/>`,
 shield:`<path d="M12 2.5l8 3v6c0 5-3.4 8.8-8 10-4.6-1.2-8-5-8-10v-6z"/><path d="M8.7 12l2.3 2.3 4.3-4.6"/>`,
 list:`<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>`,
 monitor:`<rect x="2.5" y="4" width="19" height="13" rx="1.5"/><path d="M9 21h6M12 17v4M6.5 13l3.5-3.5 2.5 2.5L17 7M17 10V7h-3"/>`,
 qr:`<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h3M20.5 14v3M14 17.5v3M17.5 20.5h3"/>`,
 bell:`<path d="M18 9a6 6 0 0 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9z"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/>`,
 pin:`<path d="M12 22s7-6.2 7-11.5A7 7 0 0 0 5 10.5C5 15.8 12 22 12 22z"/><circle cx="12" cy="10.3" r="2.7"/>`,
 clock:`<circle cx="12" cy="12" r="9"/><path d="M12 6.8V12l3.4 2"/>`,
 swap:`<path d="M4 8h13l-3.4-3.4M20 16H7l3.4 3.4"/>`,
 alert:`<path d="M12 3.6l9 15.8H3z"/><path d="M12 9.6v4M12 16.4v.6"/>`,
}
const ic=(k,s=22,sw=1.4)=>`<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${P[k]}</svg>`
const MK={
 o:`<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="${RED}" stroke-width="2.2"><circle cx="12" cy="12" r="8.2"/></svg>`,
 t:`<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="${GRAY}" stroke-width="1.8" stroke-linejoin="round"><path d="M12 4.4L20.2 19H3.8z"/></svg>`,
 x:`<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="${FAINT}" stroke-width="1.9" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>`,
}
const cell=(v)=> MK[v] ? `<span class="mk">${MK[v]}</span>`
  : v==="B" ? `<span class="bx">BondEx</span>` : `<span class="tx">${v}</span>`

const hub=()=>{
  const cx=260, cy=62, R=46, r=25, nx=[92,428], ny=[28,100]
  const pos=[[nx[0],ny[0]],[nx[1],ny[0]],[nx[0],ny[1]],[nx[1],ny[1]]]
  const lab=[["building","旅行会社"],["truck","物流会社"],["hotel","ホテル"],["user","ゲスト"]]
  let s=`<svg viewBox="0 0 520 148" width="100%">
   <defs><filter id="wh"><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0"/></filter></defs>`
  pos.forEach(([px,py])=>{
    const dx=px-cx, dy=py-cy, d=Math.hypot(dx,dy), ux=dx/d, uy=dy/d
    const sx=cx+ux*(R+7), sy=cy+uy*(R+7), ex=px-ux*(r+9), ey=py-uy*(r+9)
    const a=Math.atan2(ey-sy,ex-sx), h=6.5
    s+=`<path d="M${sx} ${sy} L${ex} ${ey}" stroke="${RED}" stroke-width="1.8"/>
        <path d="M${ex} ${ey} L${ex-h*Math.cos(a-.42)} ${ey-h*Math.sin(a-.42)} L${ex-h*Math.cos(a+.42)} ${ey-h*Math.sin(a+.42)} z" fill="${RED}"/>`
  })
  pos.forEach(([px,py],i)=>{
    s+=`<circle cx="${px}" cy="${py}" r="${r}" fill="#fff" stroke="#F0D6D7" stroke-width="1.3"/>
        <g transform="translate(${px-11},${py-11})" color="${RED}">${ic(lab[i][0],22,1.3)}</g>
        <text x="${px}" y="${py+r+18}" text-anchor="middle" font-size="15" fill="${INK}">${lab[i][1]}</text>`
  })
  return s+`<circle cx="${cx}" cy="${cy}" r="${R}" fill="${RED}"/>
    <image href="${LOGO}" x="${cx-34}" y="${cy-8}" width="68" height="16" filter="url(#wh)"/></svg>`
}

const CMP=[["ホテルへの発送依頼","必要","必要"],["配送会社の手配","自社対応","B"],["ホテルとの調整","自社対応","B"],
 ["送り状の発行","自社対応","B"],["配送状況の確認","自社対応","B"],["ゲスト対応","自社対応","B"],
 ["トラブル一次対応","自社対応","B"],["リアルタイム追跡","t","o"],["多言語サポート","t","o"],
 ["団体旅行対応","t","o"],["ランドオペレーター専用管理画面","x","o"]]

const IRR=[
 ["swap","集荷時に個数が違う","集荷の現場で確認","実個数に修正し、変更内容をメールでご報告します。ご請求も調整します","なし"],
 ["alert","荷物を預けられなかった","集荷の現場で確認","その区間を取り消してメールでご報告します。ご請求はいたしません","なし"],
 ["bell","集荷が行われていない","システムが自動で検知","物流会社へ確認し、状況をご連絡します","なし"],
 ["clock","配送の遅延・調査中・持ち戻り","追跡を1時間ごとに自動監視","状況を確認し、ご連絡します","なし"],
 ["shield","紛失・破損・誤配","ご申告または検知","窓口となり、物流会社への申請から解決まで進行管理します","状況のご連絡のみ"],
 ["chat","ゲストからのお問い合わせ","ゲストから直接","多言語で BondEx が一次対応します","なし"],
 ["pen","旅程の変更・取り消し","ポータルからご操作","送り状の再発行・取り消しを手配します","ポータルで操作"],
]

const css=`
@page{size:A4 landscape;margin:0}
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;color:${INK};
     word-break:auto-phrase;line-break:strict;font-weight:400;font-feature-settings:"palt" 1;
     -webkit-font-smoothing:antialiased;background:#fff}
h1,h2,h3,h4,b,strong,.bx{font-weight:700}
.sheet{width:297mm;height:210mm;page-break-after:always;overflow:hidden;display:flex;flex-direction:column;padding:0 16mm}
.sheet:last-child{page-break-after:auto}
.sheet.cover{padding:0;flex-direction:row}

/* cover */
.cv{flex:1;padding:26mm 0 0 20mm;display:flex;flex-direction:column}
.cv img.l{height:9mm;width:auto;display:block}
.cv h1{font-size:26pt;line-height:1.45;margin-top:14mm;letter-spacing:-.01em}
.cv .s{font-size:11pt;color:${GRAY};margin-top:6mm;line-height:1.8}
.cv .m{margin-top:auto;padding-bottom:20mm;font-size:8.4pt;color:${GRAY};line-height:1.9}
.cv .bar{width:24mm;height:1.6mm;background:${RED};border-radius:1mm;margin-top:9mm}
.cvp{width:40%;background:#eee center 40%/cover no-repeat;background-image:url("assets/hero.jpg")}

/* page chrome */
.hd{display:flex;align-items:flex-end;justify-content:space-between;padding:11mm 0 0;flex:none}
.hd img{height:5.4mm;width:auto;display:block}
.hd .pg{font-size:7.5pt;color:#C9CDD1;letter-spacing:.16em;font-weight:500}
.ti{padding:6mm 0 0;flex:none}
.ti h2{font-size:19pt;letter-spacing:-.01em}
.ti p{font-size:9pt;color:${GRAY};margin-top:2.6mm;line-height:1.7}
.bd{flex:1;min-height:0;padding:7mm 0 0;display:flex;flex-direction:column}
.fill{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center}
.ill{width:100%;display:block;border-radius:2.6mm;border:1px solid ${LINE}}
.ba2{display:grid;grid-template-columns:1fr 34mm;gap:5mm;align-items:center}
.strip{display:grid;grid-template-columns:repeat(4,1fr);gap:5mm;flex:none;margin-bottom:5mm}
.strip .c{display:flex;flex-direction:column}
.strip .c img{width:100%;height:25mm;object-fit:cover;display:block;border-radius:2.6mm;border:1px solid ${LINE}}
.strip .c .n{display:none}
.strip .c b{font-size:9pt;margin-top:2.6mm}
.strip .c p{font-size:7pt;color:${GRAY};line-height:1.55;margin-top:1mm}
.ft{display:flex;align-items:center;justify-content:center;gap:5mm;padding:4mm 0 7mm;flex:none}
.ft img.j{height:4.4mm;opacity:.85}.ft img.b{height:4.4mm}
.ft span{font-size:6.4pt;color:${GRAY}}

/* parts */
.pnl{border:1px solid ${LINE};border-radius:4.2mm;background:#fff}
.pnl.r{border-color:#F3D3D4;background:#FEFBFB}
.note{display:flex;gap:3mm;align-items:flex-start;font-size:8pt;color:${GRAY};line-height:1.75}
.note .i{color:${RED};flex:none;padding-top:.4mm}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:7mm}
.g3{display:grid;grid-template-columns:repeat(3,1fr);gap:6mm}
.card{padding:6mm 6.5mm;display:flex;flex-direction:column}
.card .i{color:${RED};margin-bottom:4mm}
.card h4{font-size:10.5pt;margin-bottom:2.6mm}
.card p{font-size:8.2pt;color:${GRAY};line-height:1.8}

table{width:100%;border-collapse:collapse;table-layout:fixed}
thead th{font-size:8.4pt;font-weight:700;padding:2.8mm 0;text-align:center}
thead th.k{text-align:left}
thead th.b{color:${RED};background:${TINT};border-radius:3mm 3mm 0 0}
tbody td{padding:1.5mm 0;border-top:1px solid ${LINE};font-size:8.4pt;text-align:center;line-height:1.4}
tbody td.k{text-align:left}
tbody td.b{background:${TINT}}
tbody tr:last-child td.b{border-radius:0 0 3mm 3mm}
.mk{display:inline-flex;line-height:1}
.tx{color:${GRAY};font-size:8.2pt;font-weight:500}
.bx{color:${RED};font-size:8.2pt}

/* step flow */
.steps{display:grid;gap:4mm}
.step{display:grid;grid-template-columns:13mm 1fr;gap:4.5mm;align-items:center;padding:6.5mm 7mm}
.step .n{font-size:8pt;font-weight:700;color:${RED};letter-spacing:.06em}
.step .n i{display:block;font-style:normal;color:${RED};margin-top:2mm}
.step h4{font-size:11pt;margin-bottom:2mm}
.step p{font-size:8.4pt;color:${GRAY};line-height:1.8}

/* lane timeline */
.lane{display:grid;grid-template-columns:22mm repeat(5,1fr);gap:0;align-items:stretch}
.lane .lb{font-size:7.4pt;color:${GRAY};display:flex;align-items:center;padding-right:3mm;font-weight:500}
.lane .h{text-align:center;padding-bottom:3mm}
.lane .h .n{font-size:7pt;color:${RED};font-weight:700;letter-spacing:.08em}
.lane .h b{display:block;font-size:9.6pt;margin-top:1.4mm}
.lane .c{border:1px solid ${LINE};border-radius:2.6mm;margin:0 1.4mm 2.4mm;padding:3.4mm 3mm;
         font-size:7.6pt;line-height:1.7;color:${GRAY};min-height:19mm;display:flex;align-items:center}
.lane .c.a{background:${SOFT}}
.lane .c.b{background:${TINT};border-color:#F3D3D4;color:${INK}}
.lane .c.none{color:${FAINT}}

/* irregular table */
.irr{width:100%;border-collapse:collapse;table-layout:fixed}
.irr th{font-size:7.6pt;color:${GRAY};font-weight:500;text-align:left;padding:0 2.5mm 2.6mm;letter-spacing:.04em}
.irr th.b{color:${RED};font-weight:700}
.irr td{border-top:1px solid ${LINE};padding:4.2mm 2.5mm;font-size:8.2pt;line-height:1.55;vertical-align:middle}
.irr td.h{font-weight:700;color:${INK}}
.irr td.d{color:${GRAY};font-size:7.6pt}
.irr td.b{background:${TINT};color:${INK}}
.irr td.n{text-align:center;font-weight:700;color:${RED};font-size:8.4pt}
.irr tr:last-child td.b{border-radius:0 0 2.6mm 2.6mm}
.irr .ico{display:inline-flex;vertical-align:-1mm;margin-right:2mm;color:${RED}}

/* responsibility */
.resp{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5mm}
.resp .c{padding:6.5mm}
.resp .c h4{font-size:10pt;margin-bottom:1.4mm}
.resp .c .r{font-size:7pt;color:${GRAY};letter-spacing:.1em;margin-bottom:3.5mm}
.resp .c.b{border-color:${RED};background:${TINT}}
.resp .c.b h4{color:${RED}}
.resp ul{list-style:none}
.resp li{position:relative;padding-left:4.5mm;margin-bottom:2.4mm;font-size:8pt;line-height:1.65;color:${GRAY}}
.resp li::before{content:"";position:absolute;left:0;top:1.9mm;width:1.8mm;height:1.8mm;border-radius:50%;background:${FAINT}}
.resp .c.b li{color:${INK}}
.resp .c.b li::before{background:${RED}}

/* price */
.pr{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5mm}
.pr .c{padding:6mm;text-align:center}
.pr .c .l{font-size:8.4pt;color:${GRAY};margin-bottom:3mm}
.pr .c .v{font-size:22pt;font-weight:700;letter-spacing:-.02em}
.pr .c .v small{font-size:9pt;font-weight:400;color:${GRAY};margin-left:1.5mm}
.pr .c.b{border-color:${RED};background:${TINT}}
.pr .c.b .v{color:${RED}}
.pr .c .n{font-size:7.4pt;color:${GRAY};margin-top:2.6mm;line-height:1.6}
`

const page = (n, title, sub, body, opts={}) => `
<div class="sheet">
  <div class="hd"><img src="${LOGO}" alt="BondEx"><div class="pg">${String(n).padStart(2,"0")}</div></div>
  <div class="ti"><h2>${title}</h2>${sub?`<p>${sub}</p>`:""}</div>
  <div class="bd">${body}</div>
  <div class="ft"><img class="j" src="${JOJO}" alt="JOJO"><span>株式会社JOJO が運営しています</span><img class="b" src="${LOGO}" alt="BondEx"></div>
</div>`

/* ------------ pages ------------ */
const p1 = `
<div class="sheet cover">
  <div class="cv">
    <img class="l" src="${LOGO}" alt="BondEx">
    <div class="bar"></div>
    <h1>ホテル間配送の手配を、<br>まるごと代行します。</h1>
    <div class="s">ランドオペレーター・旅行会社さま向け ご提案資料</div>
    <div class="m">株式会社JOJO<br>bondex.express</div>
  </div>
  <div class="cvp"></div>
</div>`

const p2 = page(2, "BondEx とは", "訪日旅行者の手荷物を、ホテルからホテルへ。その手配と調整を代行するサービスです。", `
  <div style="display:grid;grid-template-columns:1fr 1.15fr;gap:9mm;flex:1;min-height:0;align-items:stretch">
    <div style="display:flex;flex-direction:column;justify-content:center">
      <div class="pnl card" style="margin-bottom:5mm;padding:7mm 6.5mm">
        <div class="i">${ic("list",22,1.3)}</div>
        <h4>BondEx は運送会社ではありません</h4>
        <p>実際の輸送は大手物流会社の全国配送網を利用します。BondEx は、その集荷の取次と送り状の作成を代行し、ホテル・物流会社・ゲストとの調整を引き受けます。</p>
      </div>
      <div class="g2" style="gap:5mm;flex:none">
        <div class="pnl card" style="padding:5mm"><div class="i">${ic("pin",20,1.3)}</div><h4 style="font-size:9.6pt">日本全国に対応</h4><p style="font-size:7.8pt">主要都市から地方まで、全国のホテルへお届けします。</p></div>
        <div class="pnl card" style="padding:5mm"><div class="i">${ic("user",20,1.3)}</div><h4 style="font-size:9.6pt">FIT と団体の両方</h4><p style="font-size:7.8pt">1〜9名の個人手配から、10名以上の団体まで。</p></div>
      </div>
    </div>
    <div class="pnl r" style="padding:6mm 6mm 3mm;display:flex;flex-direction:column;justify-content:center">
      <div style="font-size:9.4pt;font-weight:700;color:${RED}">BondEx がハブとなり、すべての調整を引き受けます</div>
      <div style="margin-top:4mm">${hub()}</div>
    </div>
  </div>`)

const p3 = page(3, "導入すると、何が変わるか", "ランドオペレーターの業務が、7工程から1工程になります。", `
  <div style="display:grid;grid-template-columns:1fr 1.5fr;gap:9mm;flex:1;min-height:0">
    <div style="display:flex;flex-direction:column;gap:4mm">
      <div class="pnl" style="padding:5.5mm 6mm;flex:1;display:flex;flex-direction:column;justify-content:center">
        <div class="ba2"><div>
        <div style="font-size:7.4pt;color:${GRAY};letter-spacing:.14em;margin-bottom:3mm">BEFORE</div>
        <div style="display:flex;align-items:baseline;gap:3mm"><div style="font-size:30pt;font-weight:700;line-height:.9">7</div><div style="font-size:9.6pt;color:${GRAY}">工程すべてを自社で対応</div></div>
        <div style="font-size:7.6pt;color:${GRAY};line-height:1.85;margin-top:3mm">
          ホテルへ連絡 ／ 配送会社を探す ／ 集荷依頼 ／ 送り状作成 ／ 配送状況確認 ／ ゲスト対応 ／ トラブル対応</div>
        </div><img class="ill" src="assets/before.png" alt=""></div>
      </div>
      <div class="pnl r" style="padding:5.5mm 6mm;flex:1;display:flex;flex-direction:column;justify-content:center">
        <div class="ba2"><div>
        <div style="font-size:7.4pt;color:${RED};letter-spacing:.14em;margin-bottom:3mm">AFTER</div>
        <div style="display:flex;align-items:baseline;gap:3mm"><div style="font-size:30pt;font-weight:700;line-height:.9;color:${RED}">1</div><div style="font-size:9.6pt;color:${RED}">旅程を登録するだけ</div></div>
        <div style="font-size:7.6pt;color:${INK};line-height:1.85;margin-top:3mm">残りの業務は、すべて BondEx が担当します。</div>
        </div><img class="ill" src="assets/after.png" alt=""></div>
      </div>
    </div>
    <div class="pnl" style="padding:0 2mm">
      <table><colgroup><col style="width:46%"><col style="width:27%"><col style="width:27%"></colgroup>
        <thead><tr><th class="k" style="padding-left:4mm">ランドオペレーターの業務</th><th>従来の運用</th><th class="b">BondEx</th></tr></thead>
        <tbody>${CMP.map(([k,g,b])=>`<tr><td class="k" style="padding-left:4mm">${k}</td><td>${cell(g)}</td><td class="b">${cell(b)}</td></tr>`).join("")}</tbody></table>
    </div>
  </div>`)

const p4 = page(4, "ご利用開始までの流れ", "最初の一度だけ、次の4ステップをお願いします。以降は旅程を登録いただくだけです。", `
  <div class="fill"><div class="steps" style="grid-template-columns:1fr 1fr;gap:5mm">
    <div class="pnl step"><div class="n">STEP 01<i>${ic("building",22,1.3)}</i></div>
      <div><h4>アカウントのご登録</h4><p>会社情報とご担当者さまをご登録ください。ウェブ上で完結します。</p></div></div>
    <div class="pnl step"><div class="n">STEP 02<i>${ic("check",22,1.3)}</i></div>
      <div><h4>BondEx による承認</h4><p>内容を確認のうえ、ご利用開始の承認をご連絡します。</p></div></div>
    <div class="pnl step"><div class="n">STEP 03<i>${ic("pen",22,1.3)}</i></div>
      <div><h4>契約書へのご署名</h4><p>画面上で契約内容をご確認いただき、そのまま署名して締結します。郵送は不要です。</p></div></div>
    <div class="pnl step"><div class="n">STEP 04<i>${ic("send",22,1.3)}</i></div>
      <div><h4>ご利用開始</h4><p>専用の管理画面から、旅程のご登録が可能になります。</p></div></div>
  </div></div>
  <div class="pnl" style="margin-top:auto;padding:4.5mm 6mm;background:${SOFT};border:0">
    <div class="note"><div class="i">${ic("alert",16,1.5)}</div>
      <div>ご署名が完了するまでは、発行のご依頼を受け付けない仕様になっています。契約内容にご同意いただいたうえでの運用開始を、システム側で担保するためです。</div></div>
  </div>`)

const p5 = page(5, "1件あたりの依頼の流れ", "代理店さまの作業は、最初の「旅程を登録する」だけです。", `
  <div class="strip">
    ${[["flow-01","STEP 01","旅程を登録","旅程表をお送りいただきます"],
       ["flow-02","STEP 03","集荷","ホテルから物流会社へお渡しします"],
       ["flow-03","STEP 04","配達","次のホテルへお届けします"],
       ["flow-04","—","お受け取り","ゲストは手ぶらでチェックイン"]]
      .map(([f,n,b,p])=>`<div class="c"><img src="assets/${f}.png" alt=""><div class="n">${n}</div><b>${b}</b><p>${p}</p></div>`).join("")}
  </div>
  <div class="fill"><div class="lane">
    <div></div>
    ${[["STEP 01","旅程を登録"],["STEP 02","発行"],["STEP 03","集荷"],["STEP 04","配達"],["STEP 05","ご請求"]]
      .map(([n,b])=>`<div class="h"><div class="n">${n}</div><b>${b}</b></div>`).join("")}
    <div class="lb">代理店さま</div>
    <div class="c a">旅程表をアップロード<br>（Excel / CSV / PDF）</div>
    <div class="c none">作業はありません</div>
    <div class="c none">作業はありません</div>
    <div class="c none">作業はありません</div>
    <div class="c a">明細をご確認<br>（ポータルからDL可）</div>
    <div class="lb">BondEx</div>
    <div class="c b">AI が旅程を自動で読み取り、ホテル名から住所を解決します</div>
    <div class="c b">送り状とバウチャーを発行し、すぐにダウンロードいただけます</div>
    <div class="c b">物流会社へ集荷を取次ぎ、実個数を確認して確定します</div>
    <div class="c b">配達状況を監視し、完了をご連絡します</div>
    <div class="c b">月次でおまとめし、請求書を発行します</div>
  </div></div>
  <div class="g3" style="margin-top:0;gap:5mm;flex:none">
    <div class="pnl" style="padding:4.2mm 5mm"><div class="note"><div class="i">${ic("clock",16,1.5)}</div>
      <div><b style="color:${INK}">発送30日前から発行できます</b><br>それより先のご予約はお預かりし、発行可能になり次第 BondEx が発行します。</div></div></div>
    <div class="pnl" style="padding:4.2mm 5mm"><div class="note"><div class="i">${ic("bell",16,1.5)}</div>
      <div><b style="color:${INK}">発行漏れを自動で防ぎます</b><br>未発行の案件を毎朝システムが点検し、BondEx 側で確認しています。</div></div></div>
    <div class="pnl" style="padding:4.2mm 5mm"><div class="note"><div class="i">${ic("qr",16,1.5)}</div>
      <div><b style="color:${INK}">ゲストはQRで追跡できます</b><br>バウチャーのQRコードから、配送状況を多言語でご確認いただけます。</div></div></div>
  </div>`)

const p6 = page(6, "代理店さま専用の管理画面", "ご登録から請求書の受け取りまで、ひとつの画面で完結します。", `
  <div style="display:grid;grid-template-columns:1fr 62mm;gap:8mm;flex:1;min-height:0">
  <div class="g2" style="grid-template-rows:repeat(3,1fr);gap:5mm">
    ${[["monitor","全案件をリアルタイムで確認","お預かり中の荷物の状況を、一覧で確認いただけます。"],
       ["doc","送り状・バウチャーの再発行","発行済みの書類は、いつでも再ダウンロードできます。"],
       ["swap","日程変更・個数変更・取り消し","画面から操作でき、いずれも確認画面を経由します。"],
       ["list","団体名簿から荷物リストを生成","どなたが何個お預けかまで、自動でリスト化します。"],
       ["qr","ゲスト向けの追跡ページ","QRコードから、多言語でリアルタイムに確認できます。"],
       ["yen","月次サマリと請求書のダウンロード","ご利用実績と請求書を、PDFでいつでも取得できます。"]]
      .map(([k,h,p])=>`<div class="pnl card" style="padding:4.5mm 5mm"><div class="i">${ic(k,20,1.3)}</div><h4 style="font-size:9.6pt">${h}</h4><p style="font-size:7.6pt">${p}</p></div>`).join("")}
  </div>
  <div class="pnl" style="padding:4.5mm;display:flex;flex-direction:column">
    <div style="font-size:8.6pt;font-weight:700;margin-bottom:1.4mm">ゲストにお渡しするバウチャー</div>
    <div style="font-size:7pt;color:${GRAY};line-height:1.6;margin-bottom:3mm">御社のロゴとブランドカラーを反映できます。QRコードから配送状況を多言語で確認いただけます。</div>
    <img src="assets/voucher.png" alt="" style="width:100%;display:block;border:1px solid ${LINE};border-radius:2mm">
  </div>
  </div>`)

const p7 = page(7, "イレギュラーが起きたときの対応", "起こりうることと、そのときBondExが何をするかを、あらかじめお示しします。", `
  <div class="fill"><table class="irr">
    <colgroup><col style="width:27%"><col style="width:20%"><col style="width:35%"><col style="width:18%"></colgroup>
    <thead><tr><th>起こりうること</th><th>検知の方法</th><th class="b">BondEx の対応</th><th style="text-align:center">代理店さまの作業</th></tr></thead>
    <tbody>${IRR.map(([k,w,d,b,a])=>`<tr>
      <td class="h"><span class="ico">${ic(k,14,1.5)}</span>${w}</td>
      <td class="d">${d}</td><td class="b">${b}</td>
      <td class="n" style="${a==="なし"?"":"color:"+GRAY+";font-weight:400;font-size:7.6pt"}">${a}</td></tr>`).join("")}</tbody>
  </table></div>
  <div class="pnl r" style="margin-top:0;flex:none;padding:4.5mm 6mm;display:flex;align-items:center;gap:6mm">
    <img src="assets/support.png" alt="" style="width:21mm;height:23mm;object-fit:cover;object-position:50% 12%;border-radius:2.4mm;flex:none">
    <div style="flex:1;text-align:center">
    <div style="font-size:11pt;font-weight:700;color:${RED}">イレギュラー時も、代理店さまの作業はほとんど発生しません。</div>
    <div style="font-size:7.4pt;color:${GRAY};margin-top:2.6mm">いずれの場合も、対応の内容と結果は BondEx からメールでご報告します。ご確認のみお願いいたします。</div>
    </div>
  </div>`)

const p8 = page(8, "責任範囲と、万一のときの補償", "誰が何を担当するのかを、あらかじめ明確にしています。", `
  <div class="fill"><div class="resp">
    <div class="pnl c"><div class="r">旅行会社・ランドオペレーターさま</div><h4>旅程をご登録いただく</h4>
      <ul><li>旅程表のご提供</li><li>変更・取り消しのご連絡</li><li>ホテルへの発送のご依頼</li></ul></div>
    <div class="pnl c b"><div class="r">BONDEX</div><h4>手配・調整・窓口</h4>
      <ul><li>物流会社の手配と集荷の取次</li><li>送り状・バウチャーの発行</li><li>配送状況の監視とご連絡</li><li>ゲストからのお問い合わせ対応</li><li>トラブル時の申請代行と進行管理</li></ul></div>
    <div class="pnl c"><div class="r">物流会社</div><h4>実際の輸送</h4>
      <ul><li>集荷・輸送・配達</li><li>運送約款にもとづく補償</li></ul></div>
  </div></div>
  <div class="g2" style="margin-top:6mm;gap:6mm;flex:none">
    <div class="pnl" style="padding:5mm 6mm"><div class="note"><div class="i">${ic("chat",18,1.4)}</div>
      <div><b style="color:${INK};font-size:9pt">窓口は、常に BondEx です</b><br>
      旅行会社さま・ホテル・ゲストのいずれも、BondEx にご連絡いただくだけで済みます。物流会社とのやり取りは BondEx が行います。</div></div></div>
    <div class="pnl" style="padding:5mm 6mm"><div class="note"><div class="i">${ic("shield",18,1.4)}</div>
      <div><b style="color:${INK};font-size:9pt">補償は運送約款にもとづきます</b><br>
      実際の輸送は物流会社が行うため、万一の損害の補償は運送約款の定めによります。BondEx は申請の代行と、解決までの進行管理を担当します。</div></div></div>
  </div>`)

const p9 = page(9, "対応エリア・料金・お支払い", "スーツケースのサイズや重量にかかわらず、1個あたりの一律料金です。", `
  <div style="display:grid;grid-template-columns:1.25fr 1fr;gap:9mm;flex:1;min-height:0;align-items:center">
    <div>
      <div class="pr">
        <div class="pnl c b"><div class="l">全国一律</div><div class="v">¥5,000<small>／個・税抜</small></div><div class="n">沖縄・離島を除く<br>日本全国</div></div>
        <div class="pnl c"><div class="l">沖縄</div><div class="v">¥8,000<small>／個・税抜</small></div><div class="n">沖縄本島<br>宛て・発</div></div>
        <div class="pnl c"><div class="l">その他の離島</div><div class="v" style="font-size:13pt">お見積もり</div><div class="n">個別にご提案<br>いたします</div></div>
      </div>
      <div class="g2" style="margin-top:6mm;gap:6mm">
        <div class="pnl" style="padding:4.5mm 5.5mm"><div class="note"><div class="i">${ic("check",16,1.5)}</div>
          <div><b style="color:${INK}">サイズ・重量は問いません</b><br>大きさや重さで料金は変わりません。距離による加算もありません。</div></div></div>
        <div class="pnl" style="padding:4.5mm 5.5mm"><div class="note"><div class="i">${ic("yen",16,1.5)}</div>
          <div><b style="color:${INK}">お支払い方法</b><br>月末締め・翌月末払い（請求書）、またはクレジットカード。請求書はPDFでダウンロードいただけます。</div></div></div>
      </div>
      <div style="font-size:7.2pt;color:${GRAY};margin-top:5mm;line-height:1.7">
        表示価格はすべて税抜です。別途消費税を申し受けます。ご利用件数・運用内容に応じて個別のご提案も承ります。</div>
    </div>
    <div class="pnl" style="padding:5mm;display:flex;flex-direction:column;align-items:center;justify-content:center">
      <img src="assets/japan.png" alt="対応エリア" style="width:100%;display:block">
      <div style="font-size:8pt;color:${GRAY};margin-top:3mm">主要都市から地方まで、全国のホテルへお届けします</div>
    </div>
  </div>`)

const p10 = page(10, "導入までのスケジュールと次のステップ", "トライアルはすぐに開始いただけます。", `
  <div class="fill"><div class="steps" style="grid-template-columns:1fr 1fr 1fr;gap:5mm">
    <div class="pnl step" style="grid-template-columns:1fr"><div class="n">STEP 01</div>
      <div><h4 style="margin-top:2mm">旅程表をお送りください</h4><p>Excel・CSV・PDF のいずれでも、いまお使いの形式のままで構いません。</p></div></div>
    <div class="pnl step" style="grid-template-columns:1fr"><div class="n">STEP 02</div>
      <div><h4 style="margin-top:2mm">バウチャーを発行します</h4><p>実際にゲストへお渡しする形のバウチャーを発行し、ご確認いただきます。</p></div></div>
    <div class="pnl step" style="grid-template-columns:1fr"><div class="n">STEP 03</div>
      <div><h4 style="margin-top:2mm">1〜2件から試験運用</h4><p>実際の案件で運用し、貴社の業務にどう組み込めるかをご確認ください。</p></div></div>
  </div></div>
  <div class="pnl r" style="margin-top:auto;padding:8mm 9mm;display:flex;align-items:center;justify-content:space-between;gap:9mm">
    <div>
      <div style="font-size:14pt;font-weight:700;color:${RED};margin-bottom:2.6mm">まずは1件、お試しください。</div>
      <div style="font-size:8.6pt;color:${INK};line-height:1.8">対象の旅程をお送りいただければ、バウチャーを発行してご確認いただけます。<br>ご不明な点も、下記までお気軽にお問い合わせください。</div>
    </div>
    <img src="assets/closing.png" alt="" style="width:34mm;border-radius:3mm;flex:none">
    <div style="text-align:right;flex:none">
      <div style="font-size:7pt;color:${GRAY};letter-spacing:.1em;margin-bottom:1.6mm">お問い合わせ</div>
      <div style="font-size:12pt;font-weight:700">support@bondex.express</div>
      <div style="font-size:8pt;color:${GRAY};margin-top:2mm">bondex.express</div>
    </div>
  </div>`)

const html=`<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>BondEx サービスのご案内</title><style>${css}</style></head><body>
${p1}${p2}${p3}${p4}${p5}${p6}${p7}${p8}${p9}${p10}
</body></html>`
fs.writeFileSync("docs/collateral/bondex-deck-ja.html", html)
console.log("wrote bondex-deck-ja.html", (html.length/1024).toFixed(0)+"KB")
