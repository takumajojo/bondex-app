import fs from "node:fs"
import { RED, INK, NAVY, GRAY, HAIR, WARM } from "./scenes.mjs"
const LOGO = fs.readFileSync("docs/collateral/service-overview/images/logo.txt","utf8")
const WHITE="#FFFFFF"

/* ══ P01 表紙 ══ 静物に「手ぶらで先へ進む人」を遠景に置き、物語を足す */
/* ══ P02 手配の煩雑さ ══ 中央に担当者、周囲に同時発生する用件 */
/* ══ P04 フローの4シーン ══ */
/* ══ P06 監視 ══ 夜の運用デスク (人物なし) */
/* ══ P07 クロージング ══ 手ぶらで歩く二人 */
/* ══ P03 図解 ══ */
const hub=()=>{
  const cx=576, cy=150, R=58
  const right=[[830,22,"ホテル"],[830,116,"物流会社"],[830,210,"ゲスト"]]
  let s=`<svg viewBox="0 0 1000 296">
   <defs><filter id="w"><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0"/></filter></defs>
   <rect x="10" y="117" width="164" height="66" rx="8" fill="#fff" stroke="${NAVY}" stroke-width="2"/>
   <text x="92" y="146" text-anchor="middle" font-size="19" font-weight="700" fill="${NAVY}">旅行会社</text>
   <text x="92" y="168" text-anchor="middle" font-size="12" fill="${GRAY}">ランドオペレーター</text>

   <path d="M180 150 H222" stroke="${RED}" stroke-width="3.4"/>
   <path d="M222 150 l-11 -7 v14 z" fill="${RED}"/>

   <rect x="230" y="108" width="256" height="84" rx="10" fill="#FEF7F7" stroke="${RED}" stroke-width="2"/>
   <g transform="translate(252 132)" fill="none" stroke="${RED}" stroke-width="2.2"
      stroke-linecap="round" stroke-linejoin="round">
     <rect x="0" y="0" width="34" height="26" rx="3"/><path d="M0 8h34M5 4h.01M9 4h.01"/>
   </g>
   <text x="300" y="142" font-size="12" fill="${RED}" letter-spacing="1.6">BONDEX</text>
   <text x="300" y="168" font-size="19" font-weight="700" fill="${INK}">専用Web管理画面</text>
   <text x="358" y="98" text-anchor="middle" font-size="13" fill="${RED}" font-weight="700">旅程を登録</text>

   <path d="M492 150 H${cx-R-14}" stroke="${RED}" stroke-width="3.4"/>
   <path d="M${cx-R-14} 150 l-11 -7 v14 z" fill="${RED}"/>`
  right.forEach(([x,y,lab])=>{
    const dx=x-cx, dy=y+33-cy, d=Math.hypot(dx,dy), ux=dx/d, uy=dy/d
    s+=`<path d="M${cx+ux*(R+12)} ${cy+uy*(R+12)} L${x-14} ${y+33}" stroke="${NAVY}" stroke-width="1.7" opacity=".4"/>
        <rect x="${x}" y="${y}" width="150" height="66" rx="8" fill="#fff" stroke="${HAIR}" stroke-width="1.8"/>
        <text x="${x+75}" y="${y+41}" text-anchor="middle" font-size="18" fill="${NAVY}">${lab}</text>`
  })
  return s+`<circle cx="${cx}" cy="${cy}" r="${R}" fill="${RED}"/>
    <image href="${LOGO}" x="${cx-43}" y="${cy-11}" width="86" height="21" filter="url(#w)"/>
    <text x="${cx}" y="${cy+R+26}" text-anchor="middle" font-size="13" fill="${GRAY}">連絡・調整・監視を一元管理</text></svg>`
}

const css = `
@page{size:A4 landscape;margin:0}
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;color:${INK};
     background:${WHITE};font-weight:400;word-break:auto-phrase;line-break:strict;
     font-feature-settings:"palt" 1;-webkit-font-smoothing:antialiased}
.sheet{width:297mm;height:210mm;page-break-after:always;overflow:hidden;display:flex}
.sheet:last-child{page-break-after:auto}
h1,h2,h3,b{font-weight:700}

/* cover */
.cv{flex:1;display:flex;flex-direction:column;padding:24mm 0 16mm 20mm}
.cv .logo{height:8.6mm;width:auto;align-self:flex-start;flex:none;display:block}
.cv .rule{width:18mm;height:.9mm;background:${RED};margin:30mm 0 9mm}
.cv h1{font-size:31pt;line-height:1.62}
.cv .sub{margin-top:10mm;font-size:10.5pt;line-height:2.05;color:${GRAY};max-width:116mm}
.cv .aud{margin-top:auto;font-size:8.4pt;color:${GRAY};letter-spacing:.05em}
.cv .op{margin-top:4mm;font-size:7.4pt;color:#9C9E9F;letter-spacing:.12em}
.cvArt{width:45%;flex:none;display:flex;align-items:center;justify-content:center;padding:0 14mm 0 4mm}
.cvArt img{max-width:100%;max-height:142mm;display:block}
.artFit{display:flex;align-items:center;justify-content:center;min-height:0}
.artFit img{max-width:100%;max-height:132mm;display:block}

/* inner */
.pg{flex:1;display:flex;flex-direction:column;padding:0 20mm}
.hd{display:flex;align-items:flex-end;justify-content:space-between;padding:14mm 0 0;flex:none}
.hd img{height:5.2mm;width:auto;display:block}
.hd .no{font-size:7.6pt;color:#B9BBBD;letter-spacing:.22em}
.lead{padding:12mm 0 0;flex:none}
.lead h2{font-size:24pt;line-height:1.58}
.lead h2.xl{font-size:29pt;line-height:1.55}
.lead p{margin-top:5mm;font-size:9.5pt;color:${GRAY};line-height:1.9}
.body{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center}
.foot{flex:none;padding:0 0 12mm;display:flex;align-items:flex-end;justify-content:space-between;gap:12mm}
.foot .note{font-size:7.8pt;color:${GRAY};line-height:1.85;max-width:170mm}
.foot .op{font-size:7pt;color:#B9BBBD;letter-spacing:.12em;white-space:nowrap}

/* P07 料金 */
.pr{display:flex;flex-direction:column;flex:1;min-height:0;justify-content:center}
.prTop{display:grid;grid-template-columns:1.3fr .7fr;gap:12mm;align-items:end;padding-bottom:6.5mm;border-bottom:1px solid ${HAIR}}
.prTop .lab{font-size:8pt;letter-spacing:.2em;color:${GRAY};margin-bottom:5mm}
.prTop .big{font-size:54pt;font-weight:700;letter-spacing:-.035em;line-height:.92;color:${INK}}
.prTop .big small{font-size:15pt;font-weight:400;color:${GRAY};margin-left:4mm;letter-spacing:0}
.prTop .tax{font-size:8.4pt;color:${GRAY};margin-top:5mm}
.prSub{display:grid;grid-template-columns:1fr 1fr;gap:9mm}
.prSub .lab{font-size:8pt;letter-spacing:.16em;color:${GRAY};margin-bottom:3mm}
.prSub b{font-size:19pt;font-weight:700;letter-spacing:-.02em}
.prSub b small{font-size:10pt;font-weight:400;color:${GRAY};margin-left:2mm;letter-spacing:0}
.prNote{font-size:9pt;color:${INK};line-height:1.9;padding-top:6mm}
.prNote span{display:block;margin-top:3mm;font-size:7.6pt;color:${GRAY}}
.grp7{margin-top:7mm;background:${WARM};padding:6mm 8mm;display:grid;grid-template-columns:auto 1fr;
      gap:0 9mm;align-items:center}
.grp7 .k{font-size:7.4pt;letter-spacing:.2em;color:${RED};white-space:nowrap}
.grp7 h3{font-size:13pt;line-height:1.7}
.grp7 p{font-size:8.8pt;color:${GRAY};line-height:1.85;margin-top:2.5mm}
.ask{display:grid;grid-template-columns:1fr auto;gap:12mm;align-items:end;margin-top:auto;
     padding-top:5.5mm;margin-bottom:5mm;border-top:1px solid ${HAIR};flex:none}
.ask .h{font-size:12pt;font-weight:700;line-height:1.7}
.ask .p{font-size:8.6pt;color:${GRAY};line-height:1.85;margin-top:3mm}
.ask .c{text-align:right;white-space:nowrap}
.ask .c .m{font-size:11.5pt;font-weight:700}
.ask .c .s{font-size:8.4pt;color:${GRAY};margin-top:2mm}

/* P08 配送日数 */
.days{display:flex;flex-direction:column;flex:1;min-height:0;justify-content:center}
.day{display:grid;grid-template-columns:50mm 1fr;gap:9mm;align-items:center;
     padding:6mm 0;border-top:1px solid ${HAIR}}
.day:first-child{border-top:0;padding-top:2mm}
.day .d{font-size:23pt;font-weight:700;letter-spacing:-.02em;line-height:1.2;color:${INK}}
.day.hi .d{color:${RED}}
.day .d em{display:block;font-style:normal;font-size:7.4pt;font-weight:400;color:${GRAY};
           letter-spacing:.18em;margin-top:3mm}
.day .r{font-size:11.5pt;line-height:1.95;color:${INK}}
.day .r b{font-weight:700}
.day .r i{font-style:normal;color:#C3C5C7;margin:0 4mm}
.d8note{margin-top:6mm;font-size:9pt;color:${INK};line-height:1.85;padding-top:5.5mm;border-top:1px solid ${HAIR}}
.d8note span{display:block;margin-top:3mm;color:${GRAY};font-size:8.4pt}
/* P03 3グループ */
.grp{display:grid;grid-template-columns:auto 1fr 1fr 1fr;gap:0 11mm;padding-top:8mm;flex:none;align-items:start}
.grp .lbl{font-size:7.6pt;letter-spacing:.2em;color:${GRAY};padding-bottom:3.5mm;
          border-bottom:1px solid ${HAIR};margin-bottom:5mm}
.grp .lbl.r{color:${RED};border-bottom-color:${RED}}
.grp .one{font-size:13.5pt;font-weight:700;color:${NAVY};line-height:1.65;padding-right:9mm;
          border-right:1px solid ${HAIR};margin-right:2mm}
.grp li{list-style:none;font-size:9pt;line-height:1.5;margin-bottom:3.2mm;position:relative;padding-left:4.6mm}
.grp li::before{content:"";position:absolute;left:0;top:1.6mm;width:1.5mm;height:1.5mm;background:${RED}}

/* P02 */
.p2{display:grid;grid-template-columns:1fr .92fr;gap:14mm;align-items:center;flex:1;min-height:0}
.p2 .say{font-size:14pt;font-weight:700;line-height:1.75;color:${NAVY}}
.p2 .say em{font-style:normal;color:${RED}}
.p2 .sub{margin-top:7mm;font-size:9.5pt;color:${GRAY};line-height:1.95}

/* P04 */
.flow{display:grid;grid-template-columns:repeat(4,1fr);gap:6mm;flex:none}
.flow .c img{width:100%;aspect-ratio:4/5;object-fit:cover;display:block}
.flow .c img.ui{border:1px solid ${HAIR};border-radius:1.6mm;object-position:top left}
.flow .c .n{font-size:7.2pt;font-weight:700;color:${RED};letter-spacing:.14em;margin:4mm 0 1.6mm}
.flow .c b{font-size:11pt}
.flow .c p{font-size:8.4pt;color:${GRAY};line-height:1.75;margin-top:2mm}

/* P05 */
.shot{width:100%;display:block;border:1px solid ${HAIR};border-radius:2.4mm}
.p5lead{font-size:9.4pt;font-weight:700;color:${INK};margin-bottom:4.5mm;line-height:1.7}
.p5{display:grid;grid-template-columns:.66fr 1.34fr;gap:12mm;flex:1;min-height:0;align-items:center}
.grpv .g{margin-bottom:8mm}
.grpv .g:last-child{margin-bottom:0}
.grpv .k{font-size:7.4pt;letter-spacing:.18em;color:${RED};margin-bottom:3.4mm}
.grpv li{list-style:none;font-size:9.2pt;line-height:1.55;margin-bottom:2.6mm;position:relative;padding-left:4.6mm}
.grpv li::before{content:"";position:absolute;left:0;top:1.8mm;width:1.5mm;height:1.5mm;background:${HAIR}}
.ui{border:1px solid ${HAIR};border-radius:3mm;overflow:hidden;background:#fff}
.uibar{display:flex;align-items:center;gap:1.8mm;padding:3mm 4mm;border-bottom:1px solid ${HAIR};background:#FCFBF9}
.uibar i{width:1.7mm;height:1.7mm;border-radius:50%;background:#DDD9D3}
.uibar span{font-size:7.6pt;color:${GRAY};margin-left:2mm}
.uibody{padding:4.5mm 5mm 5mm}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;margin-bottom:4.5mm}
.kpis div{border:1px solid ${HAIR};border-radius:2mm;padding:2.6mm 3mm}
.kpis span{display:block;font-size:6.4pt;color:${GRAY};margin-bottom:.8mm}
.kpis b{font-size:12pt;letter-spacing:-.02em}
.ui table{width:100%;border-collapse:collapse;table-layout:fixed}
.ui th{font-size:6.4pt;color:${GRAY};font-weight:400;text-align:left;padding:0 1mm 2mm;border-bottom:1px solid ${HAIR}}
.ui td{font-size:7pt;padding:2.4mm 1mm;border-bottom:1px solid #F2EFEA;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.st{font-size:6.2pt;padding:.5mm 1.8mm;border-radius:3mm}
.st.t{background:#FCF0E6;color:#A9661E}.st.d{background:#EAF3EC;color:#2A6E42}.st.p{background:#EEF1F6;color:#3B5075}

/* P06 */
.p6{display:grid;grid-template-columns:.56fr 1.44fr;gap:12mm;flex:1;min-height:0;align-items:center}
.p6 .art{display:flex;align-items:center;justify-content:center;min-height:0}
.p6 .art img{max-width:100%;max-height:126mm;display:block}
.p6 .col{display:flex;flex-direction:column;justify-content:center}
.cases{display:grid;grid-template-columns:1fr 1fr;gap:7mm 10mm;align-content:center}
.case .n{font-size:7pt;letter-spacing:.16em;color:${RED};font-weight:700}
.case b{display:block;font-size:11pt;margin:1.8mm 0 2.6mm}
.case p{font-size:8.6pt;color:${GRAY};line-height:1.8}
.p6 .big{margin-top:9mm;font-size:12.5pt;font-weight:700;color:${NAVY};line-height:1.7;
         padding-left:5mm;border-left:1.4mm solid ${RED}}

/* P07 */
.p7{display:grid;grid-template-columns:1.15fr .85fr;gap:14mm;flex:1;min-height:0;align-items:center}
.price .lab{font-size:8pt;letter-spacing:.2em;color:${GRAY};margin-bottom:4mm}
.price .big{font-size:52pt;font-weight:700;letter-spacing:-.03em;line-height:1;color:${INK}}
.price .big small{font-size:14pt;font-weight:400;color:${GRAY};margin-left:3mm;letter-spacing:0}
.price .tax{font-size:8.4pt;color:${GRAY};margin-top:4mm}
.price .subs{display:flex;gap:11mm;margin-top:9mm;padding-top:7mm;border-top:1px solid ${HAIR}}
.price .subs div span{display:block;font-size:8pt;color:${GRAY};margin-bottom:2mm}
.price .subs div b{font-size:15pt}
.price .subs div b small{font-size:9pt;font-weight:400;color:${GRAY};margin-left:1.5mm}
.price .notes{margin-top:8mm;font-size:8.2pt;color:${GRAY};line-height:1.9}
.cta img{width:100%;max-height:76mm;object-fit:contain;display:block;margin-bottom:6mm}
.cta .h{font-size:19pt;font-weight:700;line-height:1.55}
.cta .p{margin-top:4mm;font-size:9pt;color:${GRAY};line-height:1.9}
.cta .mail{margin-top:6mm;font-size:13.5pt;font-weight:700}
.cta .site{margin-top:2.5mm;font-size:9pt;color:${GRAY}}
`

const page=(no,title,sub,body,note,cls="")=>`
<div class="sheet"><div class="pg">
  <div class="hd"><img src="images/logo.png" alt="BondEx"><div class="no">${no}</div></div>
  <div class="lead"><h2 class="${cls}">${title}</h2>${sub?`<p>${sub}</p>`:""}</div>
  ${body}
  <div class="foot"><div class="note">${note||""}</div><div class="op">OPERATED BY JOJO</div></div>
</div></div>`

const P1=`<div class="sheet">
  <div class="cv">
    <img class="logo" src="images/logo.png" alt="BondEx"><div class="rule"></div>
    <h1>ホテル間の荷物配送を、<br>旅行会社の仕事からなくす。</h1>
    <div class="sub">専用管理画面から、旅程を登録するだけ。<br>ホテルとの調整から集荷手配、送り状、追跡、ゲスト対応まで、BondEx が引き受けます。</div>
    <div class="aud">ランドオペレーター・旅行会社向け</div>
    <div class="op">OPERATED BY JOJO</div>
  </div>
  <div class="cvArt"><img src="images/cover.jpg" alt=""></div>
</div>`

const P2=page("02","配送そのものより、<br>手配のほうが面倒です。","",
`<div class="body"><div class="p2">
  <div>
    <div class="say">配送会社を探すことが、<br><em>旅行会社の仕事ではありません。</em></div>
    <div class="sub">ホテルへの連絡、集荷手配、送り状、配送確認、ゲスト対応、トラブル対応。<br>ホテル間配送には、多くの調整業務が発生します。<br><br>本来時間を使うべきなのは、旅行そのものの手配です。</div>
  </div>
  <div class="artFit"><img src="images/problem.jpg" alt=""></div>
</div></div>`,"")

const P3=page("03","専用管理画面から旅程を登録する。<br>あとは、配送完了の通知を待つだけ。","",
`<div class="body">${hub()}</div>
 <div class="grp">
   <div><div class="lbl">旅行会社</div><div class="one">専用管理画面から、<br>旅程を登録するだけ。</div></div>
   <div><div class="lbl r">BEFORE DELIVERY</div>
     <li>ホテルへの連絡と発送調整</li><li>物流会社への集荷手配</li><li>送り状・バウチャーの発行</li></div>
   <div><div class="lbl r">DURING DELIVERY</div>
     <li>配送状況の監視</li><li>物流会社との調整</li></div>
   <div><div class="lbl r">SUPPORT</div>
     <li>ゲスト対応</li><li>イレギュラー対応</li></div>
 </div>`,
"BondEx は運送会社ではありません。実際の輸送は物流会社が行い、BondEx は配送に必要な手配・調整・監視・窓口対応を担当します。","xl")

const P4=page("04","4ステップで、次のホテルへ。","",
`<div class="body"><div class="flow">
  ${[["portal-new.png","STEP 01","専用管理画面から旅程を登録","BondEx の Web 管理画面、左上の「＋ 新規発行」から、ゲスト情報・ホテル・配送日程を登録します。"],
     ["flow-02.jpg","STEP 02","集荷","BondEx がホテルと物流会社を調整します。"],
     ["flow-03.jpg","STEP 03","配達","荷物が次のホテルへ先に到着します。"],
     ["flow-04.jpg","STEP 04","受け取り","ゲストは手ぶらで移動し、次のホテルで荷物を受け取ります。"]]
   .map(([f,n,b,p])=>`<div class="c"><img class="${f.startsWith("portal")?"ui":""}" src="images/${f}" alt=""><div class="n">${n}</div><b>${b}</b><p>${p}</p></div>`).join("")}
</div></div>`,
"通常の配送では、旅行会社さまの作業は STEP 01 のみ。以降の配送オペレーションは BondEx が担当します。")

const P5=page("05","配送に必要な仕事を、<br>BondEx がまとめて引き受けます。","",
`<div class="body"><div class="p5">
  <div class="grpv">
    <div class="g"><div class="k">BEFORE DELIVERY</div>
      <li>ホテルへの連絡・発送調整</li><li>物流会社への集荷手配</li><li>送り状・バウチャーの発行</li></div>
    <div class="g"><div class="k">DURING DELIVERY</div>
      <li>配送状況の監視</li><li>ステータスの確認</li><li>遅延の確認と連絡</li></div>
    <div class="g"><div class="k">GUEST SUPPORT</div>
      <li>多言語での問い合わせ対応</li><li>トラブル一次対応</li><li>日程・個数の変更対応</li></div>
  </div>
  <div><div class="p5lead">登録した配送案件は、専用管理画面からいつでも確認できます。</div><img class="shot" src="images/portal-full.png" alt="BondEx Agency Portal"></div>
</div></div>`,
"専用の管理画面から、全案件の状況確認、送り状・バウチャーの再取得、日程や個数の変更、団体旅行の荷物管理、QR による追跡、請求書の確認まで行えます。")

const P6=page("06","何も起きないことだけを、<br>前提にしません。","",
`<div class="body"><div class="p6">
  <div class="art"><img src="images/watch.png" alt=""></div>
  <div class="col">
    <div class="cases">
      ${[["CASE 01","集荷されていない","配送会社へ確認し、状況を把握したうえで旅行会社さまへご連絡します。"],
         ["CASE 02","配送が遅れている","配送状況と原因を確認し、到着の見込みをご案内します。"],
         ["CASE 03","紛失・破損・誤配","BondEx が窓口となり、物流会社への申請から解決まで進行を管理します。"],
         ["CASE 04","ゲストからの問い合わせ","多言語で BondEx が一次対応します。"]]
       .map(([n,b,p])=>`<div class="case"><div class="n">${n}</div><b>${b}</b><p>${p}</p></div>`).join("")}
    </div>
    <div class="big">トラブル時も、旅行会社が<br>配送会社と直接やり取りする必要はありません。</div>
  </div>
</div></div>`,
"実際の輸送に関する補償は、各物流会社の運送約款に基づきます。BondEx は申請および解決までの進行管理を行います。")

const P7=page("07","全国どこへでも、<br>わかりやすい一律料金で。","",
`<div class="body"><div class="pr">
  <div class="prTop">
    <div>
      <div class="lab">全国一律 ／ 沖縄・離島を除く</div>
      <div class="big">5,000<small>円 ／ 個</small></div>
      <div class="tax">税抜。別途消費税を申し受けます。</div>
    </div>
    <div class="prSub">
      <div><div class="lab">沖縄</div><b>8,000<small>円 ／ 個</small></b></div>
      <div><div class="lab">その他の離島</div><b>個別見積</b></div>
    </div>
  </div>
  <div class="prNote">距離による追加料金はありません。スーツケースのサイズ・重量による追加料金もありません。
    <span>※ 物流会社が定めるサイズ・重量の受付範囲内でのご利用となります。</span></div>
  <div class="grp7">
    <div class="k">GROUP</div>
    <div><h3>団体旅行は、個数に応じた割引料金をご案内します。</h3>
      <p>荷物の個数・旅程を確認のうえ、個別にお見積もりいたします。</p></div>
  </div>
</div>
<div class="ask">
  <div><div class="h">団体旅行・特殊な旅程もご相談ください。</div>
    <div class="p">通常のホテル間配送から団体旅行まで、旅程に合わせた配送方法をご案内します。</div></div>
  <div class="c"><div class="m">support@bondex.express</div><div class="s">bondex.express</div></div>
</div></div>`,"")

const P8=page("08","主要都市間のお届け目安",
"午前中の集荷を前提とした、佐川急便の配送基準に準じるお届け目安です。",
`<div class="body"><div class="days">
  <div class="day hi"><div class="d">翌日<em>NEXT DAY</em></div>
    <div class="r"><b>東京</b><i>&rarr;</i>名古屋・金沢・飛騨高山・京都・大阪<br>
                   <b>京都・大阪</b><i>&rarr;</i>東京・名古屋・広島</div></div>
  <div class="day"><div class="d">翌々日<em>2 DAYS</em></div>
    <div class="r"><b>東京</b><i>&rarr;</i>福岡・北海道</div></div>
  <div class="day"><div class="d">翌々日以降<em>2 DAYS OR MORE</em></div>
    <div class="r"><b>本州</b><i>&rarr;</i>沖縄</div></div>
  <div class="d8note">その他のルートも全国対応。旅程をご共有いただければ、BondEx が配送可能日と到着予定日を確認します。
    <span>午後・夜間の集荷についても、旅程に合わせて到着予定日をご案内します。</span></div>
</div>
<div class="ask">
  <div><div class="h">旅程に合わせた配送方法をご案内します。</div></div>
  <div class="c"><div class="m">support@bondex.express</div><div class="s">bondex.express</div></div>
</div></div>`,
"※ 午前中の集荷を前提とした目安です。集荷場所・お届け先・集荷時間・交通状況・天候等により、お届け日数が異なる場合があります。実際のお届け予定日は旅程ごとにご案内します。")

const html=`<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>BondEx サービスのご案内</title><style>${css}</style></head><body>
${P1}${P2}${P3}${P4}${P5}${P6}${P7}${P8}</body></html>`
fs.writeFileSync("docs/collateral/service-overview/deck.html", html)
console.log("wrote deck.html (8 pages)")
