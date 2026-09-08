import fs from "node:fs"

const QR   = fs.readFileSync("docs/collateral/assets/qr.txt", "utf8")
const LOGO = fs.readFileSync("docs/collateral/assets/logo.txt", "utf8")

const C = {
  ja: {
    lang: "ja",
    tt: "none", wrap: "auto-phrase",
    font: `"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif`,
    eyebrow: "ランドオペレーター様向け ご案内",
    h1: "訪日旅行者の手荷物を、<br>ホテルからホテルへ。",
    lead: "日本全国に対応した手荷物配送サービスです。FIT（1〜9名）も団体（10名以上）も、ご依頼は1件で完結します。",
    beforeTitle: "これまでの手配",
    before: [
      "ホテル1軒ずつに連絡し、集荷を依頼する",
      "ホテル側にも、チェックアウト後の荷物管理が発生する",
      "配送状況の確認は、出発元のホテル頼み",
      "ゲストからの問い合わせは、配送業者ではなく御社に戻ってくる",
    ],
    afterTitle: "BondEx をお使いの場合",
    after: [
      "旅程をお預けいただくだけ",
      "集荷・配送・追跡・問い合わせ対応まで BondEx が一括で担当",
      "すべての荷物の状況を、ひとつの画面で確認できる",
      "万一の紛失・破損への対応も BondEx が引き受ける",
    ],
    statement: "ホテルと1軒ずつ調整する作業が、なくなります。",
    p1note: "送り状（伝票）は BondEx が発行し、御社宛またはホテル宛にお送りします。ホテル側で新たにご契約やシステム連携をしていただく必要はありません。",
    howTitle: "ご利用の流れ",
    how: [
      ["フロントにお預けいただく", "ゲストはチェックアウトの際、フロントに荷物をお預けいただくだけです。"],
      ["BondEx がすべてを引き受けます", "集荷、配送、配送状況の管理、ゲストからのお問い合わせ対応まで担当します。"],
      ["次のホテルでお受け取り", "チェックインされる時には、荷物が先に届いています。"],
    ],
    coverage: [
      ["日本全国", "ホテルからホテルへ、全国に対応します"],
      ["FIT と団体", "1〜9名の個人手配から、10名以上の団体まで"],
      ["多言語対応", "英語・中国語・イタリア語・フランス語・スペイン語"],
    ],
    p2title: "御社での運用",
    p2lead: "手配から請求まで、御社の業務にそのまま組み込める形でご提供します。",
    ops: [
      ["ひとつの画面で、すべての荷物を",
       "全荷物の状況をリアルタイムで確認できます。旅程表や名簿は Excel・CSV のまま取り込めるため、複数件をまとめて登録いただけます。"],
      ["団体名簿から、荷物リストを自動生成",
       "団体名簿をアップロードいただくと、どなたがスーツケースを何個お預けかまでのリストを生成します。添乗員の方も、手元で管理しやすくなります。"],
      ["御社のブランドでご提供いただけます",
       "ゲストにお渡しするバウチャーには、御社のロゴとブランドカラーを反映できます。ゲストから見れば、御社のサービスとして完結します。"],
      ["ゲストご自身で配送状況を確認",
       "バウチャーの QR コードから、現在の配送状況をリアルタイムでご確認いただけます。多言語に対応しているため、ご案内の手間もかかりません。"],
      ["責任の所在と、お支払い",
       "万一の紛失・破損は BondEx が対応します。お支払いは月次でおまとめし、明細をダウンロードいただけます。個数は集荷時の実数で確定するため、旅程の途中で荷物が増えた場合も後から精算いただけます。"],
    ],
    calloutTitle: "送り状について",
    calloutBody: "送り状（伝票）は BondEx が発行します。御社宛、またはホテル宛に、旅行者様宛の伝票をお送りすることが可能です。ホテル側で新たにご契約やシステム連携をしていただく必要はありません。",
    priceTitle: "料金",
    priceBody: "送客の規模やご利用の形態に応じてご提案いたします。お見積りはお問い合わせください。",
    nextTitle: "次のステップ",
    nextBody: "トライアルはすぐに開始いただけます。対象の旅程をお送りいただければ、バウチャーを発行してご確認いただけます。",
    footerNote: "株式会社JOJO ／ BondEx",
    contactLabels: ["メール", "WhatsApp", "ウェブサイト"],
    pageLabel: (n) => `${n} / 2`,
  },
  en: {
    lang: "en",
    tt: "uppercase", wrap: "normal",
    font: `"Helvetica Neue",Helvetica,Arial,sans-serif`,
    eyebrow: "For Land Operators",
    h1: "Your travelers’ luggage,<br>hotel to hotel.",
    lead: "A luggage delivery service covering the whole of Japan. One request covers everything — FIT (1–9 pax) and groups (10+ pax) alike.",
    beforeTitle: "The current process",
    before: [
      "You contact each hotel individually to arrange pickup",
      "Each hotel has to handle luggage after checkout",
      "Tracking depends on the departing hotel",
      "Guest enquiries come back to you, not to the carrier",
    ],
    afterTitle: "With BondEx",
    after: [
      "You simply hand over the itinerary",
      "BondEx handles pickup, delivery, tracking and guest enquiries",
      "Every item visible on a single screen",
      "BondEx takes responsibility for loss or damage",
    ],
    statement: "The hotel-by-hotel coordination disappears.",
    p1note: "BondEx issues the waybill and sends it to your office or directly to the hotel. No new contract or system integration is required on the hotel’s side.",
    howTitle: "How it works",
    how: [
      ["Leave it at the front desk", "At checkout, guests simply leave their luggage with the front desk."],
      ["BondEx takes it from there", "Pickup, delivery, status tracking and guest enquiries — all handled by us."],
      ["Collect it at the next hotel", "The luggage is already waiting when guests check in."],
    ],
    coverage: [
      ["Nationwide", "Hotel to hotel, anywhere in Japan"],
      ["FIT and groups", "From 1–9 pax to groups of 10 and above"],
      ["Multilingual", "English, Chinese, Italian, French and Spanish"],
    ],
    p2title: "How you operate it",
    p2lead: "From booking through to invoicing, designed to fit into the way you already work.",
    ops: [
      ["Every item on one screen",
       "Track the status of all luggage in real time. Itineraries and name lists can be uploaded as Excel or CSV, so multiple bookings are registered at once."],
      ["A luggage list generated from your group manifest",
       "Upload your group name list and we generate a list showing exactly who has handed over how many suitcases — so your tour leader can keep track on the ground."],
      ["Offer it under your own brand",
       "The voucher handed to guests carries your logo and brand colours. To the guest, it is your service from start to finish."],
      ["Guests track their own luggage",
       "A QR code on the voucher shows the current delivery status in real time, in their own language — so you are not fielding the questions."],
      ["Liability and billing",
       "BondEx handles any loss or damage. Billing is consolidated monthly with downloadable statements. Piece counts are confirmed at pickup, so additional bags picked up mid-itinerary can be settled afterwards."],
    ],
    calloutTitle: "About the waybill",
    calloutBody: "BondEx issues the waybill. We can send it to your office or directly to the hotel, made out to the traveler. No new contract or system integration is required on the hotel’s side.",
    priceTitle: "Pricing",
    priceBody: "We propose rates according to your volume and how you intend to use the service. Please contact us for a quotation.",
    nextTitle: "Next step",
    nextBody: "A trial can start straight away. Send us an itinerary and we will issue the vouchers for you to review.",
    footerNote: "JOJO Inc. / BondEx",
    contactLabels: ["Email", "WhatsApp", "Website"],
    pageLabel: (n) => `${n} / 2`,
  },
}

const CONTACT = ["support@bondex.express", "+81 90-7005-4178", "bondex.express"]
const RED = "#D60F11", NAVY = "#14243F", INK = "#1A1A1A", MUTED = "#6B7280", LINE = "#E5E7EB"

const css = (t) => `
@page { size: A4; margin: 0; }
* { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
body { font-family:${t.font}; color:${INK}; font-size:10pt; line-height:1.65;
       font-feature-settings:"palt" 1; word-break:${t.wrap}; line-break:strict; }
.page { width:210mm; height:297mm; position:relative; overflow:hidden;
        display:flex; flex-direction:column; page-break-after:always; }
.page:last-child { page-break-after:auto; }
.pad { padding:0 16mm; }

/* header */
.top { display:flex; align-items:flex-end; justify-content:space-between;
       padding:11mm 16mm 6mm; }
.top img { height:8.5mm; display:block; }
.eyebrow { font-size:8pt; letter-spacing:.14em; color:${MUTED}; text-transform:${t.tt}; }

/* hero */
.hero { background:${NAVY}; color:#fff; padding:11mm 16mm 10mm; position:relative; }
.hero::after { content:""; position:absolute; left:0; bottom:0; width:100%; height:1.6mm; background:${RED}; }
.hero h1 { font-size:24pt; line-height:1.35; font-weight:600; letter-spacing:.01em; }
.hero p { margin-top:5mm; font-size:10.5pt; color:#C7D0DE; max-width:150mm; line-height:1.75; }

/* before / after */
.ba { display:grid; grid-template-columns:1fr 1fr; gap:7mm; margin-top:10mm; }
.noteline { margin-top:7mm; padding-left:2mm; font-size:9pt; color:#40474F; line-height:1.75;
            border-left:1px solid ${LINE}; padding:1mm 0 1mm 5mm; }
.col h3 { font-size:8pt; letter-spacing:.14em; text-transform:${t.tt}; margin-bottom:4mm;
          padding-bottom:2mm; border-bottom:1px solid ${LINE}; }
.col.b h3 { color:${MUTED}; }
.col.a h3 { color:${RED}; border-bottom-color:${RED}; }
.col ul { list-style:none; }
.col li { position:relative; padding-left:6mm; margin-bottom:4.2mm; font-size:9.5pt; line-height:1.7; }
.col.b li { color:${MUTED}; }
.col.b li::before { content:""; position:absolute; left:0; top:2.1mm; width:2.6mm; height:1px; background:#B9BFC9; }
.col.a li::before { content:""; position:absolute; left:0; top:1.5mm; width:2.2mm; height:2.2mm;
                    border-radius:50%; background:${RED}; }

.statement { margin-top:9mm; padding:6mm 7mm; background:#FBF2F2; border-left:2mm solid ${RED};
             font-size:13pt; font-weight:600; color:${NAVY}; line-height:1.5; }

/* how */
.how { background:${RED}; color:#fff; margin-top:auto; padding:8mm 16mm 8mm; }
.how h2 { font-size:8pt; letter-spacing:.16em; text-transform:${t.tt}; opacity:.9; margin-bottom:6mm; }
.steps { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8mm; }
.step .n { font-size:15pt; font-weight:600; opacity:.55; letter-spacing:.02em; }
.step h4 { font-size:10.5pt; font-weight:600; margin:1.5mm 0 2.5mm; line-height:1.45; }
.step p { font-size:8.8pt; line-height:1.65; color:#FFE2E2; }

/* coverage */
.cov { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8mm; padding:7mm 16mm; }
.cov div h5 { font-size:9.5pt; font-weight:600; color:${NAVY}; margin-bottom:1.5mm; }
.cov div p { font-size:8.6pt; color:${MUTED}; line-height:1.6; }

/* page 2 */
.sect { padding-top:7mm; }
.sect > h2 { font-size:16pt; font-weight:600; color:${NAVY}; }
.sect > .sub { font-size:9.5pt; color:${MUTED}; margin-top:2.5mm; }
.ops { margin-top:7mm; }
.op { display:grid; grid-template-columns:9mm 1fr; gap:0 4mm; padding:3.5mm 0;
      border-top:1px solid ${LINE}; }
.op:last-child { border-bottom:1px solid ${LINE}; }
.op .n { font-size:9pt; font-weight:600; color:${RED}; padding-top:.4mm; }
.op h4 { font-size:10.5pt; font-weight:600; color:${NAVY}; margin-bottom:1.6mm; }
.op p { font-size:9pt; color:#40474F; line-height:1.62; }

.callout { margin-top:5.5mm; background:${NAVY}; color:#fff; padding:6mm 7mm; }
.callout h4 { font-size:8pt; letter-spacing:.14em; text-transform:${t.tt}; color:#8FA3C4; margin-bottom:2.5mm; }
.callout p { font-size:9.5pt; line-height:1.75; }

.two { display:grid; grid-template-columns:1fr 1fr; gap:6mm; margin-top:5mm; }
.box { border:1px solid ${LINE}; padding:5.5mm 6mm; }
.box.accent { border-color:${RED}; }
.box h4 { font-size:8pt; letter-spacing:.14em; text-transform:${t.tt}; margin-bottom:2.5mm; color:${MUTED}; }
.box.accent h4 { color:${RED}; }
.box p { font-size:9pt; line-height:1.7; color:#40474F; }

/* footer */
.foot { margin-top:auto; background:${NAVY}; color:#fff; padding:6mm 16mm;
        display:flex; align-items:center; justify-content:space-between; gap:8mm; }
.foot .c { display:flex; gap:9mm; }
.foot .c div span { display:block; font-size:7.5pt; letter-spacing:.12em; text-transform:${t.tt};
                    color:#8FA3C4; margin-bottom:1mm; }
.foot .c div strong { font-size:9.5pt; font-weight:500; }
.foot img.qr { width:17mm; height:17mm; background:#fff; padding:1.2mm; }
.note { font-size:7.5pt; color:#8FA3C4; margin-top:2.5mm; }
.pnum { position:absolute; right:16mm; bottom:5mm; font-size:7.5pt; color:${MUTED}; }
.pnum.on-dark { color:#8FA3C4; right:auto; left:16mm; }
`

const page1 = (t) => `
<div class="page">
  <div class="top"><img src="${LOGO}" alt="BondEx"><div class="eyebrow">${t.eyebrow}</div></div>
  <div class="hero"><h1>${t.h1}</h1><p>${t.lead}</p></div>
  <div class="pad">
    <div class="ba">
      <div class="col b"><h3>${t.beforeTitle}</h3><ul>${t.before.map(x=>`<li>${x}</li>`).join("")}</ul></div>
      <div class="col a"><h3>${t.afterTitle}</h3><ul>${t.after.map(x=>`<li>${x}</li>`).join("")}</ul></div>
    </div>
    <div class="statement">${t.statement}</div>
    <div class="noteline">${t.p1note}</div>
  </div>
  <div class="how">
    <h2>${t.howTitle}</h2>
    <div class="steps">${t.how.map(([h,p],i)=>
      `<div class="step"><div class="n">0${i+1}</div><h4>${h}</h4><p>${p}</p></div>`).join("")}</div>
  </div>
  <div class="cov">${t.coverage.map(([h,p])=>`<div><h5>${h}</h5><p>${p}</p></div>`).join("")}</div>
</div>`

const page2 = (t) => `
<div class="page">
  <div class="top"><img src="${LOGO}" alt="BondEx"><div class="eyebrow">${t.eyebrow}</div></div>
  <div class="pad sect">
    <h2>${t.p2title}</h2><div class="sub">${t.p2lead}</div>
    <div class="ops">${t.ops.map(([h,p],i)=>
      `<div class="op"><div class="n">0${i+1}</div><div><h4>${h}</h4><p>${p}</p></div></div>`).join("")}</div>
    <div class="callout"><h4>${t.calloutTitle}</h4><p>${t.calloutBody}</p></div>
    <div class="two">
      <div class="box"><h4>${t.priceTitle}</h4><p>${t.priceBody}</p></div>
      <div class="box accent"><h4>${t.nextTitle}</h4><p>${t.nextBody}</p></div>
    </div>
  </div>
  <div class="foot">
    <div>
      <div class="c">${CONTACT.map((v,i)=>
        `<div><span>${t.contactLabels[i]}</span><strong>${v}</strong></div>`).join("")}</div>
      <div class="note">${t.footerNote}</div>
    </div>
    <img class="qr" src="${QR}" alt="bondex.express">
  </div>
</div>`

for (const key of ["ja", "en"]) {
  const t = C[key]
  const html = `<!doctype html><html lang="${t.lang}"><head><meta charset="utf-8">
<title>BondEx — ${t.eyebrow}</title><style>${css(t)}</style></head>
<body>${page1(t)}${page2(t)}</body></html>`
  fs.writeFileSync(`docs/collateral/bondex-landop-${key}.html`, html)
  console.log(`wrote docs/collateral/bondex-landop-${key}.html (${html.length} bytes)`)
}
