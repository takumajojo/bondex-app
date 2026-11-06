// 登壇用スピーカーノート（A4 縦）: node docs/collateral/seminar-luggage/notes.mjs
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const { chromium } = (() => {
  try { return require("playwright") } catch { return require(path.join(execFileSync("npm", ["root", "-g"]).toString().trim(), "playwright")) }
})()

const DIR = path.dirname(fileURLToPath(import.meta.url))
const N = JSON.parse(fs.readFileSync(path.join(DIR, "notes.json"), "utf8"))
const SPEC = JSON.parse(fs.readFileSync(path.join(DIR, "slides.json"), "utf8"))
// 写真版が完成していればその画像、未完成ならタイポグラフィ版をサムネイルに使う
const photoMan = path.join(DIR, "build/photo/manifest.json")
const usePhoto = fs.existsSync(photoMan) && JSON.parse(fs.readFileSync(photoMan, "utf8")).complete
const SRC = path.join(DIR, "build", usePhoto ? "photo" : "type", "png")
// サムネイルは 960px の JPEG に縮小して埋め込む（原寸 PNG だと PDF が 20MB を超えるため）
const THUMBS = path.join(DIR, "build", "thumbs")
fs.mkdirSync(THUMBS, { recursive: true })
for (const s of N.slides) {
  const name = `slide-${String(s.n).padStart(2, "0")}`
  execFileSync("convert", [path.join(SRC, `${name}.png`), "-resize", "960x", "-quality", "88", path.join(THUMBS, `${name}.jpg`)])
}
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
const A = SPEC.colors.accent

const secs = (t) => { const m = t.match(/(?:(\d+)分)?(?:(\d+)秒)?/); return (+(m[1] || 0)) * 60 + (+(m[2] || 0)) }
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
let acc = 0
const rows = N.slides.map((s) => { const st = acc; acc += secs(s.time); return { ...s, from: clock(st), to: clock(acc) } })

const script = (t) => t.split("\n\n").map((p) => {
  if (/^（.*）$/.test(p)) return `<p class="dir">${esc(p)}</p>`
  return `<p>${esc(p).replace(/（([^）]*)）/g, '<span class="dir">（$1）</span>')}</p>`
}).join("")

const cover = `<section class="pg cover">
  <div class="eyebrow">SPEAKER NOTES · BondEx</div>
  <h1>${esc(N.title)}</h1>
  <div class="meta">対象：${esc(N.audience)}　｜　所要：${esc(N.duration)}</div>
  <table class="plan">
    <thead><tr><th>#</th><th>表示メッセージ</th><th>時間</th><th>経過</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td class="n">${String(r.n).padStart(2, "0")}</td><td>${esc(r.message)}</td><td>${esc(r.time)}</td><td class="n">${r.from}–${r.to}</td></tr>`).join("")}</tbody>
  </table>
  <h2>登壇前に確認すること</h2>
  <ul class="caution">${N.cautions.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
  <div class="legend"><span class="dir">（グレーの括弧）</span>は動作・間の指示で、読み上げません。</div>
</section>`

const pages = rows.map((r) => `<section class="pg">
  <header>
    <div class="hl">
      <div class="num">${String(r.n).padStart(2, "0")}<span>/ ${String(N.slides.length).padStart(2, "0")}</span></div>
      <div class="msg">${esc(r.message)}</div>
      <div class="time"><b>${esc(r.time)}</b>　経過 ${r.from} → ${r.to}</div>
    </div>
    <img class="thumb" src="file://${path.join(THUMBS, `slide-${String(r.n).padStart(2, "0")}.jpg`)}">
  </header>
  <div class="lab">このページの目的</div>
  <div class="purpose">${esc(r.purpose)}</div>
  <div class="lab">話す内容</div>
  <div class="script">${script(r.script)}</div>
  <div class="emph"><div class="lab">特に強調する一言</div><div class="em">${esc(r.emphasis)}</div></div>
  <div class="next"><div class="lab">次のスライドへのつなぎ</div><div>${esc(r.transition)}</div></div>
</section>`).join("\n")

const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
${[400, 500, 600].map((w) => `@font-face{font-family:"Inter";font-weight:${w};src:url("file://${path.join(DIR, "assets/fonts", `inter-latin-${w}-normal.woff2`)}") format("woff2")}`).join("\n")}
@page{size:A4;margin:0}
*{box-sizing:border-box}
html,body{margin:0;background:#fff;color:#111;font-family:"Noto Sans JP";-webkit-font-smoothing:antialiased}
.pg{width:210mm;min-height:297mm;padding:13mm 17mm 9mm;break-after:page;position:relative}
.eyebrow{font-family:Inter;font-weight:600;letter-spacing:.16em;font-size:9pt;color:#777}
.cover h1{font-weight:500;font-size:22pt;line-height:1.45;margin:6mm 0 3mm;letter-spacing:-.01em}
.cover .meta{font-size:10pt;color:#555;margin-bottom:6mm}
table.plan{width:100%;border-collapse:collapse;font-size:10.5pt}
.plan th{font-weight:500;color:#777;text-align:left;font-size:8.5pt;letter-spacing:.06em;border-bottom:1px solid #111;padding:2mm 2mm}
.plan td{border-bottom:1px solid #e3e3e3;padding:2.2mm 2mm;vertical-align:top}
.plan td.n{font-family:Inter;font-variant-numeric:tabular-nums;white-space:nowrap;color:#444}
.cover h2{font-weight:500;font-size:12pt;margin:7mm 0 3mm}
ul.caution{margin:0;padding-left:5mm;font-size:9.5pt;line-height:1.65;color:#222}
ul.caution li{margin-bottom:1.2mm}
.legend{margin-top:6mm;font-size:9pt;color:#555}
header{display:flex;gap:6mm;align-items:flex-start;padding-bottom:5mm;border-bottom:1px solid #111;margin-bottom:5mm}
.hl{flex:1}
.num{font-family:Inter;font-weight:600;font-size:30pt;letter-spacing:-.02em;line-height:1}
.num span{font-size:10pt;color:#999;margin-left:2mm;letter-spacing:0;font-weight:500}
.msg{font-weight:500;font-size:14.5pt;line-height:1.45;margin-top:3mm}
.time{font-size:9.5pt;color:#555;margin-top:2.5mm;font-feature-settings:"tnum"}
.time b{font-weight:500;color:${A}}
.thumb{width:70mm;height:39.4mm;border-radius:1.5mm;object-fit:cover;background:#0a0a0a}
.lab{font-size:8pt;letter-spacing:.12em;color:#888;font-weight:500;margin:0 0 1.5mm}
.purpose{font-size:10pt;line-height:1.7;color:#333;margin-bottom:5mm;word-break:auto-phrase}
.script{font-size:12pt;line-height:1.74;color:#111;word-break:auto-phrase}
.script p{margin:0 0 2.6mm}
.dir{color:#9a9a9a;font-size:.86em}
p.dir{margin:1mm 0 2.6mm}
.emph{margin-top:4mm;border-left:3px solid ${A};padding:1mm 0 1mm 4mm}
.em{font-weight:500;font-size:13pt;line-height:1.6}
.next{margin-top:4mm;font-size:10pt;line-height:1.7;color:#444}
</style></head><body>${cover}${pages}</body></html>`

const BUILD = path.join(DIR, "build")
fs.writeFileSync(path.join(BUILD, "notes.html"), html)
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto("file://" + path.join(BUILD, "notes.html"))
await page.evaluate(() => document.fonts.ready)
const overflow = await page.evaluate(() => [...document.querySelectorAll(".pg")].map((p, i) => [i, Math.round(p.scrollHeight / 3.7795)]).filter(([, h]) => h > 297))
await page.pdf({ path: path.join(DIR, "out/BondEx_Seminar_Speaker_Notes_v2.pdf"), format: "A4", printBackground: true, preferCSSPageSize: true })
await browser.close()
console.log("PDF: out/BondEx_Seminar_Speaker_Notes_v2.pdf", usePhoto ? "(写真版サムネイル)" : "(タイポグラフィ版サムネイル)")
if (overflow.length) console.log("A4 を超えたページ（mm）:", JSON.stringify(overflow))
