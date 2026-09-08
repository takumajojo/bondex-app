import fs from "node:fs"
const LOGO = fs.readFileSync("docs/collateral/assets/logo.txt","utf8")
const JOJO = fs.readFileSync("docs/collateral/assets/jojo.txt","utf8")
const QRSVG= fs.readFileSync("docs/collateral/assets/qr.svg","utf8").replace(/<\?xml.*?\?>/,"")

const RED="#D60F11", INK="#1A1A1A", NAVY="#14243F", MUTED="#6B7280", LINE="#E7E9EC", SOFT="#F5F6F7"

/* ---- inline icons (stroke 1.5, currentColor) ---- */
const I = {
  guest:`<circle cx="8" cy="4.6" r="2.1"/><path d="M8 7v6M8 9.5l-2 4M8 9.5l2 4"/><rect x="13" y="9" width="7" height="8" rx="1"/><path d="M15 9V7.6h3V9"/>`,
  office:`<rect x="4" y="4" width="9" height="16" rx="1"/><rect x="13" y="9" width="7" height="11" rx="1"/><path d="M7 8h3M7 11h3M7 14h3M16 12h1M16 15h1"/>`,
  truck:`<rect x="2" y="7" width="11" height="9" rx="1"/><path d="M13 10h4l3 3v3h-7z"/><circle cx="6.5" cy="18" r="1.8"/><circle cx="16.5" cy="18" r="1.8"/>`,
  hotel:`<rect x="4" y="6" width="16" height="14" rx="1"/><path d="M8 10h2M14 10h2M8 14h2M14 14h2M10 20v-3h4v3"/><path d="M9 6V4h6v2"/>`,
  free:`<circle cx="12.5" cy="4.4" r="2"/><path d="M11 7l-1.5 5 2.5 3v5M9.5 12L6 15M14 9l3 2.5"/><rect x="17" y="13" width="5" height="6" rx=".8"/>`,
  doc:`<path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M8 12h8M8 15h8M8 18h5"/>`,
  monitor:`<rect x="2.5" y="4" width="19" height="13" rx="1.5"/><path d="M9 21h6M12 17v4"/><path d="M6.5 13l3.5-3.5 2.5 2.5L17 7"/><path d="M17 10V7h-3"/>`,
  headset:`<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="2.5" y="12.5" width="4" height="6" rx="1.6"/><rect x="17.5" y="12.5" width="4" height="6" rx="1.6"/><path d="M19.5 18.5V20a2 2 0 0 1-2 2h-3"/>`,
  pin:`<path d="M12 22s7-6.2 7-11.5A7 7 0 0 0 5 10.5C5 15.8 12 22 12 22z"/><circle cx="12" cy="10.3" r="2.7"/>`,
  users:`<circle cx="8.5" cy="7.5" r="3"/><path d="M2.5 19a6 6 0 0 1 12 0"/><circle cx="17" cy="8.5" r="2.4"/><path d="M15 14.4a5.4 5.4 0 0 1 6.5 4.6"/>`,
  phone:`<rect x="6" y="2.5" width="12" height="19" rx="2"/><path d="M10.5 5h3"/><rect x="9" y="9" width="6" height="6" rx=".7"/><path d="M11 11h.8M13.2 13H14"/>`,
  globe:`<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18"/>`,
  shield:`<path d="M12 2.5l8 3v6c0 5-3.4 8.8-8 10-4.6-1.2-8-5-8-10v-6z"/><path d="M8.7 12l2.3 2.3 4.3-4.6"/>`,
}
const ic=(k,c=24)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="${c}" height="${c}">${I[k]}</svg>`

const C = {
  ja:{
    lang:"ja", font:`"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif`,
    wrap:"auto-phrase", tt:"none",
    lead:"ホテルへの発送依頼のみで完了。",
    h1:`配送会社の手配・調整は<br><span class="r">BondEx</span>が担当します。`,
    body:"配送会社の選定・手配・調整から、配送状況の管理、ゲストからのお問い合わせ対応まで、すべて BondEx にお任せください。",
    flowTitle:"旅程をお預けいただくだけで、次のホテルへお届けします。",
    flow:[["guest","ゲストが<br>ホテルに荷物を預ける"],["office","BondEx が<br>集荷手配"],["truck","配送会社が<br>安全に輸送"],["hotel","次のホテルに<br>お届け"],["free","ゲストは手ぶらで<br>チェックイン"]],
    feats:[["doc","ホテルへの依頼は最小限","ホテルへの発送依頼のみで完了。配送会社との調整は BondEx が担当します。"],
           ["monitor","すべての状況を一元管理","集荷から配達完了まで、リアルタイムでひとつの画面で確認できます。"],
           ["headset","ゲスト対応もお任せ","配送に関するお問い合わせは BondEx が多言語で対応します。"],
           ["pin","日本全国に対応","主要都市から地方まで、全国のホテルへお届けします。"]],
    p2h:`ランドオペレーターの<br>業務を、もっとスマートに。`,
    p2sub:"すべてが、ひとつのプラットフォームで完結。",
    cards:[["monitor","全荷物を一画面で管理","リアルタイムでステータスを確認。旅程の変更にもすぐに対応。"],
           ["users","FIT も団体も対応","1〜9名の個人手配から、10名以上の団体まで対応。"],
           ["doc","送り状・バウチャーを発行","BondEx が送り状を発行し、御社宛またはホテル宛にお送りします。ホテル側の契約や連携は不要です。"],
           ["phone","QR で配送状況を確認","ゲストご自身で配送状況を多言語でリアルタイム確認。"],
           ["globe","多言語で安心サポート","日本語・英語・中国語・イタリア語・フランス語・スペイン語に対応。"],
           ["shield","紛失・破損もお任せ","万一の紛失・破損は BondEx が窓口となって対応します（補償は運送約款の定めによります）。"]],
    ctaH:"トライアルはすぐに開始できます。",
    ctaB:"旅程をお送りいただければ、バウチャーを発行してご確認いただけます。",
    contactLabels:["メール","WhatsApp","ウェブサイト"],
    operated:"株式会社JOJO が運営しています",
    ui:{kpi:["総件数","輸送中","配達済","要対応"],
        cols:["予約ID","ゲスト","発送元","お届け先","状況","個数","集荷日"],
        nav:["ダッシュボード","荷物","予約","団体","バウチャー","レポート","設定"],
        exportL:"書き出し", track:"配送状況",
        st:{t:"輸送中",d:"配達済"},
        tl:[["集荷完了","東京","5月1日 10:30"],["輸送中","","5月1日 14:20"],["配達完了","京都","5月1日 16:45"]]},
  },
  en:{
    lang:"en", font:`"Helvetica Neue",Helvetica,Arial,sans-serif`,
    wrap:"normal", tt:"none",
    lead:"Only a request to the hotel is required.",
    h1:`<span class="r">BondEx</span> handles all<br>arrangements with<br>the delivery company.`,
    body:"From selecting and arranging the delivery company to tracking shipments and handling guest inquiries, BondEx takes care of everything.",
    flowTitle:"From luggage drop-off to delivery at the next hotel.",
    flow:[["guest","Guest drops off<br>luggage at the hotel"],["office","BondEx arranges<br>pickup"],["truck","Safely delivered<br>by our partners"],["hotel","Delivered to<br>the next hotel"],["free","Guest checks in<br>hands-free"]],
    feats:[["doc","Minimal hotel request","Arrangements with the delivery company are handled by BondEx."],
           ["monitor","All in one dashboard","Monitor all shipments in real time on a single dashboard."],
           ["headset","Guest support by BondEx","Guest inquiries are handled by BondEx, not by you or the hotel."],
           ["pin","Nationwide coverage","From major cities to regional areas, we deliver to hotels across Japan."]],
    p2h:`Smarter operations<br>for land operators.`,
    p2sub:"One platform. Everything you need.",
    cards:[["monitor","All shipments in one place","Check real-time status and respond to itinerary changes instantly."],
           ["users","FIT &amp; Group ready","Supports individual travelers (1–9 pax) and groups (10+ pax)."],
           ["doc","Vouchers &amp; labels issued for you","BondEx issues the waybill and sends it to your office or to the hotel. No contract or system integration needed at hotels."],
           ["phone","QR tracking for guests","Guests can check delivery status in real time in their own language."],
           ["globe","Multilingual support","Available in Japanese, English, Chinese, Italian, French and Spanish."],
           ["shield","Loss &amp; damage handled","BondEx acts as your single point of contact for loss or damage (compensation is subject to our terms of carriage)."]],
    ctaH:"Trials can be started immediately.",
    ctaB:"Send us your itinerary and we will issue a voucher for you to review.",
    contactLabels:["Email","WhatsApp","Website"],
    operated:"Operated by JOJO Inc.",
    ui:{kpi:["All shipments","In transit","Delivered","Needs action"],
        cols:["Booking ID","Guest","From","To","Status","Pieces","Pickup date"],
        nav:["Dashboard","Shipments","Bookings","Groups","Vouchers","Reports","Settings"],
        exportL:"Export", track:"Tracking",
        st:{t:"In transit",d:"Delivered"},
        tl:[["Picked up","Tokyo","May 1, 10:30"],["In transit","","May 1, 14:20"],["Delivered","Kyoto","May 1, 16:45"]]},
  },
}
const CONTACT=["support@bondex.express","+81 90-7005-4178","bondex.express"]
/* 実在ホテル名は使わない（提携誤認・商標リスクのため都市名に置換） */
const ROWS=[["BX260901-001","Mr. Tanaka","Tokyo","Kyoto","t","2","09/01"],
            ["BX260901-002","Mr. Lee","Tokyo","Osaka","d","1","09/01"],
            ["BX260901-003","Ms. Kim","Sapporo","Nagoya","d","3","09/01"],
            ["BX260901-004","Mr. Wong","Tokyo","Hakone","d","2","09/01"]].slice(0,3)

const css=(t)=>`
@page{size:A4 landscape;margin:0}
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:${t.font};color:${INK};word-break:${t.wrap};line-break:strict;
     font-feature-settings:"palt" 1;-webkit-font-smoothing:antialiased}
.sheet{width:297mm;height:210mm;display:flex;flex-direction:column;overflow:hidden}
.rule{height:1.8mm;background:${RED};flex:none}
.panel{height:92mm;display:flex;min-height:0;position:relative;flex:none}
.brand{height:6.2mm;width:auto;display:block;align-self:flex-start;flex:none}
.r{color:${RED}}

/* ===== panel 1 ===== */
.p1l{width:27%;padding:7mm 0 6mm 9mm;display:flex;flex-direction:column;flex:none}
.p1l .lead{font-size:9.5pt;font-weight:500;margin-top:6mm;line-height:1.5}
.p1l h1{font-size:18pt;font-weight:700;line-height:1.38;margin-top:2mm;letter-spacing:-.01em}
.p1l .body{font-size:7.6pt;color:#3E464F;line-height:1.85;margin-top:5mm;max-width:72mm}
.p1photo{width:25%;flex:none;background:#eee center 42%/cover no-repeat;background-image:url("assets/hero.jpg")}
.p1r{flex:1;padding:7mm 9mm 6mm 8mm;display:flex;flex-direction:column;min-width:0}
.p1r h2{font-size:10.5pt;font-weight:600;color:${INK};margin-bottom:5mm}
.flow{display:flex;align-items:flex-start;gap:1.5mm}
.fstep{flex:1;text-align:center;min-width:0}
.fstep .bub{width:13mm;height:13mm;border-radius:50%;background:${SOFT};margin:0 auto 2.5mm;
            display:flex;align-items:center;justify-content:center;color:${INK}}
.fstep.hot .bub{background:#FCEDED;color:${RED}}
.fstep p{font-size:6.8pt;line-height:1.55;color:#3E464F}
.arw{color:#C4C9D0;font-size:8pt;padding-top:5.5mm;flex:none}
.hr{height:1px;background:${LINE};margin:5mm 0 4.5mm}
.feats{display:flex;gap:0;flex:1;min-height:0;overflow:hidden}
.feat{flex:1;padding:0 3mm;border-left:1px solid ${LINE};text-align:center}
.feat:first-child{border-left:0;padding-left:0}
.feat .ic{color:${RED};margin-bottom:2.5mm}
.feat h4{font-size:7.8pt;font-weight:600;margin-bottom:2mm}
.feat p{font-size:6.3pt;line-height:1.55;color:${MUTED}}

/* ===== panel 2 ===== */
.p2{flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden}
.p2top{flex:1;display:flex;min-height:0;padding:5mm 9mm 0;overflow:hidden}
.p2l{width:44%;flex:none;padding-right:7mm;display:flex;flex-direction:column;min-width:0}
.p2l h2{font-size:14pt;font-weight:700;line-height:1.4;margin:3.5mm 0 3.5mm;letter-spacing:-.01em}
.mock{flex:1;display:flex;align-items:stretch;gap:3mm;min-height:0;overflow:hidden}
.tab{flex:1;border:.8mm solid #14181D;border-radius:2.4mm;background:#fff;padding:2.2mm;min-width:0;overflow:hidden}
.tabin{display:flex;gap:2mm;height:100%}
.nav{width:16mm;flex:none}
.nav div{font-size:5pt;color:${MUTED};padding:1mm 1.4mm;border-radius:1mm;white-space:nowrap;overflow:hidden}
.nav div.on{background:#FCEDED;color:${RED};font-weight:600}
.main{flex:1;min-width:0}
.exp{text-align:right;font-size:4.6pt;color:${MUTED};margin-bottom:1.4mm}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:1.4mm;margin-bottom:1.8mm}
.kpi{border:1px solid ${LINE};border-radius:1.2mm;padding:1.4mm}
.kpi span{display:block;font-size:4.4pt;color:${MUTED};margin-bottom:.4mm}
.kpi strong{font-size:9pt;font-weight:700;letter-spacing:-.02em}
table{width:100%;border-collapse:collapse;table-layout:fixed}
col.c0{width:21%}col.c1{width:15%}col.c2{width:12%}col.c3{width:12%}col.c4{width:15%}col.c5{width:9%}col.c6{width:16%}
th{font-size:4.2pt;color:${MUTED};font-weight:500;text-align:left;padding:1mm .6mm;border-bottom:1px solid ${LINE}}
td{font-size:4.4pt;padding:1.1mm .4mm;border-bottom:1px solid #F1F2F4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pill{display:inline-block;font-size:4.2pt;padding:.3mm 1mm;border-radius:.8mm;font-weight:600}
.pill.t{background:#FEF0E2;color:#B26A16}.pill.d{background:#E7F6EC;color:#1E7A42}
.ph{width:24mm;flex:none;border:.8mm solid #14181D;border-radius:2.6mm;background:#fff;padding:2mm 1.6mm}
.ph .lbl{font-size:4.4pt;color:${MUTED}}
.ph .id{font-size:6.4pt;font-weight:700;margin:.4mm 0 1.8mm;letter-spacing:-.02em}
.tl{border-left:.4mm solid #2FA35E;margin-left:1mm;padding-left:2mm}
.tl .e{position:relative;margin-bottom:1.8mm}
.tl .e::before{content:"";position:absolute;left:-3.1mm;top:.6mm;width:1.4mm;height:1.4mm;border-radius:50%;background:#2FA35E}
.tl .e b{display:block;font-size:4.8pt;font-weight:600}
.tl .e span{display:block;font-size:4.3pt;color:${MUTED};line-height:1.5}
.p2r{flex:1;min-width:0}
.p2r h3{font-size:10.5pt;font-weight:600;margin:5.5mm 0 3.5mm}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:2.6mm}
.card{border:1px solid ${LINE};border-radius:1.6mm;padding:2.8mm 3mm}
.card .ic{color:${RED};margin-bottom:1.8mm}
.card h4{font-size:7.4pt;font-weight:600;margin-bottom:1.6mm;line-height:1.35}
.card p{font-size:6.1pt;line-height:1.55;color:${MUTED}}

/* footer */
.cta{margin:3mm 9mm 3mm;background:${SOFT};border-radius:2mm;padding:3.4mm 6mm;
     display:flex;align-items:center;justify-content:space-between;gap:6mm;flex:none}
.cta .l h4{font-size:8.6pt;font-weight:700;color:${RED};margin-bottom:1.2mm}
.cta .l p{font-size:6.6pt;color:#3E464F;line-height:1.6}
.cta .c{display:flex;gap:6mm;align-items:center}
.cta .c .it{display:flex;gap:2.2mm;align-items:center;padding-left:6mm;border-left:1px solid #DDE0E4}
.cta .c .it:first-child{border-left:0;padding-left:0}
.cta .c .it .ic{color:${RED}}
.cta .c .it span{display:block;font-size:5.6pt;color:${MUTED};letter-spacing:.06em;margin-bottom:.4mm}
.cta .c .it strong{display:block;font-size:7pt;font-weight:600}
.cta .qr{width:14mm;height:14mm}
.cta .qr svg{width:100%;height:100%;display:block}
.sig{display:flex;align-items:center;justify-content:center;gap:4mm;padding-bottom:3.5mm;flex:none}
.sig img.j{height:4.4mm;opacity:.85}
.sig img.b{height:4.4mm}
.sig span{font-size:5.6pt;color:${MUTED}}
`

const doc=(t)=>{
  const flow=t.flow.map(([k,txt],i)=>
    `<div class="fstep${k==="truck"?" hot":""}"><div class="bub">${ic(k,26)}</div><p>${txt}</p></div>`
    +(i<t.flow.length-1?`<div class="arw">&rarr;</div>`:"")).join("")
  const feats=t.feats.map(([k,h,p])=>
    `<div class="feat"><div class="ic">${ic(k,22)}</div><h4>${h}</h4><p>${p}</p></div>`).join("")
  const cards=t.cards.map(([k,h,p])=>
    `<div class="card"><div class="ic">${ic(k,20)}</div><h4>${h}</h4><p>${p}</p></div>`).join("")
  const u=t.ui
  const rows=ROWS.map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td>
    <td><span class="pill ${r[4]}">${r[4]==="t"?u.st.t:u.st.d}</span></td><td>${r[5]}</td><td>${r[6]}</td></tr>`).join("")
  return `<!doctype html><html lang="${t.lang}"><head><meta charset="utf-8">
<title>BondEx — ${t.lang==="ja"?"ランドオペレーター様向け":"For Land Operators"}</title>
<style>${css(t)}</style></head><body><div class="sheet">

  <div class="panel">
    <div class="p1l">
      <img class="brand" src="${LOGO}" alt="BondEx">
      <div class="lead">${t.lead}</div>
      <h1>${t.h1}</h1>
      <div class="body">${t.body}</div>
    </div>
    <div class="p1photo"></div>
    <div class="p1r">
      <h2>${t.flowTitle}</h2>
      <div class="flow">${flow}</div>
      <div class="hr"></div>
      <div class="feats">${feats}</div>
    </div>
  </div>

  <div class="rule"></div>

  <div class="p2">
    <div class="p2top">
      <div class="p2l">
        <img class="brand" src="${LOGO}" alt="BondEx">
        <h2>${t.p2h}</h2>
        <div class="mock">
          <div class="tab"><div class="tabin">
            <div class="nav">${u.nav.map((n,i)=>`<div${i===1?' class="on"':""}>${n}</div>`).join("")}</div>
            <div class="main">
              <div class="exp">${u.exportL}</div>
              <div class="kpis">
                ${u.kpi.map((k,i)=>`<div class="kpi"><span>${k}</span><strong>${[128,42,86,0][i]}</strong></div>`).join("")}
              </div>
              <table><colgroup><col class="c0"><col class="c1"><col class="c2"><col class="c3"><col class="c4"><col class="c5"><col class="c6"></colgroup><thead><tr>${u.cols.map(c=>`<th>${c}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
            </div>
          </div></div>
          <div class="ph">
            <div class="lbl">${u.track}</div><div class="id">BX260901-001</div>
            <div class="tl">${u.tl.map(([b,pl,tm])=>
              `<div class="e"><b>${b}</b>${pl?`<span>${pl}</span>`:""}<span>${tm}</span></div>`).join("")}</div>
          </div>
        </div>
      </div>
      <div class="p2r"><h3>${t.p2sub}</h3><div class="cards">${cards}</div></div>
    </div>

    <div class="cta">
      <div class="l"><h4>${t.ctaH}</h4><p>${t.ctaB}</p></div>
      <div class="c">
        ${CONTACT.map((v,i)=>`<div class="it"><div><span>${t.contactLabels[i]}</span><strong>${v}</strong></div></div>`).join("")}
        <div class="qr">${QRSVG}</div>
      </div>
    </div>
    <div class="sig"><img class="j" src="${JOJO}" alt="JOJO"><span>${t.operated}</span><img class="b" src="${LOGO}" alt="BondEx"></div>
  </div>

</div></body></html>`
}

for(const k of ["ja","en"]){
  fs.writeFileSync(`docs/collateral/bondex-brochure-${k}.html`, doc(C[k]))
  console.log("wrote", `docs/collateral/bondex-brochure-${k}.html`)
}
