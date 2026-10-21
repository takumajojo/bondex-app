// BondEx 講演スライド ビルド（HTML → PDF / PNG、PPTX 用レイアウト計測）
//
//   node docs/collateral/seminar-luggage/build.mjs           写真あり版（不足分はプレースホルダー＝Draft）
//   node docs/collateral/seminar-luggage/build.mjs --type    写真なしのタイポグラフィ版
//
// 写真は photos/ に slides.json の file 名で置く。全写真が揃い解像度チェックを通った時だけ
// BondEx_Seminar_Final.pdf を出力する。足りない場合は BondEx_Seminar_Draft.pdf になる。
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
const SPEC = JSON.parse(fs.readFileSync(path.join(DIR, "slides.json"), "utf8"))
const TYPE_ONLY = process.argv.includes("--type")
const { w: W, h: H } = SPEC.canvas
const C = SPEC.colors
const M = SPEC.margin
const BUILD = path.join(DIR, "build", TYPE_ONLY ? "type" : "photo")
const OUT = path.join(DIR, "out")
fs.mkdirSync(path.join(BUILD, "png"), { recursive: true })
fs.mkdirSync(path.join(BUILD, "placeholders"), { recursive: true })
fs.mkdirSync(OUT, { recursive: true })

const SPLIT = { gap: 8, h: 640 }
const TYPE_SCALE = 1.14
const SCRIMS = {
  bottom: { css: "linear-gradient(180deg, rgba(0,0,0,0) 36%, rgba(0,0,0,.42) 60%, rgba(0,0,0,.84) 100%)", ang: 90, stops: [[0, 0], [36, 0], [60, .42], [100, .84]] },
  top: { css: "linear-gradient(0deg, rgba(0,0,0,0) 44%, rgba(0,0,0,.42) 68%, rgba(0,0,0,.82) 100%)", ang: 270, stops: [[0, 0], [44, 0], [68, .42], [100, .82]] },
  left: { css: "linear-gradient(270deg, rgba(0,0,0,0) 30%, rgba(0,0,0,.55) 62%, rgba(0,0,0,.86) 100%)", ang: 180, stops: [[0, 0], [30, 0], [62, .55], [100, .86]] },
}
const font = (k) => SPEC.fonts[k]
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
const fileUrl = (p) => "file://" + p

function imageSize(p) {
  const [w, h] = execFileSync("identify", ["-format", "%w %h", p + "[0]"]).toString().trim().split(" ").map(Number)
  return { w, h }
}

// object-fit: cover + object-position の切り抜き範囲（PPTX の crop にもそのまま使う）
function coverCrop(img, box, focal) {
  const [fx, fy] = focal.split(" ").map((v) => parseFloat(v) / 100)
  const scale = Math.max(box.w / img.w, box.h / img.h)
  const vw = box.w / scale, vh = box.h / scale
  const x = (img.w - vw) * fx, y = (img.h - vh) * fy
  return { l: x / img.w, t: y / img.h, r: (img.w - x - vw) / img.w, b: (img.h - y - vh) / img.h, upscale: scale }
}

const problems = []
const warnings = []
// ChatGPT 画像（横 1672px）は 1.15 倍の拡大になる。1.2 倍までは警告にとどめて Final を出す
const MAX_UPSCALE = 1.2

function resolvePhoto(slide, key, box) {
  const ph = slide[key]
  if (!ph || TYPE_ONLY) return null
  const p = path.join(DIR, "photos", ph.file)
  if (fs.existsSync(p)) {
    const size = imageSize(p)
    const crop = coverCrop(size, box, ph.focal)
    const msg = `slide ${slide.n}: ${ph.file} が ${size.w}×${size.h}px（${box.w}×${box.h} に ${crop.upscale.toFixed(2)} 倍拡大）`
    if (crop.upscale > MAX_UPSCALE) problems.push(msg + " → 解像度不足")
    else if (crop.upscale > 1.0001) warnings.push(msg)
    return { path: p, crop, box, placeholder: false, opacity: ph.opacity ?? 1, focal: ph.focal }
  }
  if (ph.optional) return null
  problems.push(`slide ${slide.n}: photos/${ph.file} が未配置`)
  return { path: path.join(BUILD, "placeholders", ph.file.replace(/\.\w+$/, ".png")), crop: { l: 0, t: 0, r: 0, b: 0 }, box, placeholder: true, opacity: 1, focal: "50% 50%", file: ph.file }
}

function placeholderHtml(slide, ph, box) {
  const b = slide.brief
  const half = box.w < W
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${box.w}px;height:${box.h}px;background:#141414;overflow:hidden}
  .f{position:absolute;inset:${half ? 28 : 44}px;border:2px dashed #3a3a3a;border-radius:6px}
  .l{position:absolute;right:${half ? 56 : 80}px;${slide.anchor === "top" ? "bottom" : "top"}:${half ? 52 : 76}px;width:${half ? 560 : 760}px;text-align:right;
     font-family:"Inter","Noto Sans JP";color:#8a8a8a;font-size:${half ? 20 : 24}px;line-height:1.55}
  .k{font-weight:600;letter-spacing:.12em;color:#c8c8c8;font-size:${half ? 18 : 22}px}
  .t{font-family:"Noto Sans JP";font-weight:500;color:#d4d4d4;font-size:${half ? 24 : 30}px;margin:10px 0 6px}
  </style></head><body><div class="f"></div><div class="l">
  <div class="k">PHOTO SLOT · ${String(slide.n).padStart(2, "0")} · NOT PLACED</div>
  <div class="t">${esc(half && ph.file.endsWith("b.jpg") ? b.title.split("／")[1] ?? b.title : half ? b.title.split("／")[0] : b.title)}</div>
  <div>photos/${ph.file} ・ ${box.w}×${box.h}px 以上</div></div></body></html>`
}

function textBlockHtml(slide) {
  const t = slide.text
  const f = font(t.font)
  const fixed = slide.layout === "diagram" // 図のスライドは両版とも同じ位置・大きさ
  const size = TYPE_ONLY && !fixed && t.font !== "en" ? Math.round(t.size * TYPE_SCALE) : t.size
  const pos = TYPE_ONLY && !fixed ? `top:${Math.round((H - t.lines.length * size * t.lh) / 2)}px` : slide.anchor === "top" ? `top:${M.y}px` : `bottom:${M.y}px`
  // 行頭の「は約物の半角分だけ左へぶら下げ、文字の縦ラインを揃える
  const lines = t.lines.map((runs) =>
    `<div class="ln"${runs[0].t.startsWith("「") ? ' style="margin-left:-0.5em"' : ""}>${runs.map((r) => `<span style="color:${r.c ? C[r.c] : C.fg}">${esc(r.t)}</span>`).join("")}</div>`).join("")
  return `<div id="txt" class="txt" style="${pos};left:${M.x}px;font-family:'${f.family}';font-weight:${f.weight};font-size:${size}px;line-height:${t.lh};letter-spacing:${t.track}em">${lines}</div>`
}

function numberHtml(slide) {
  const t = slide.text
  const ja = font("ja"), jr = font("jaRegular")
  const num = t.num.map((r) => {
    const f = font(r.font)
    return `<span class="nr" style="font-family:'${f.family}';font-weight:${f.weight};font-size:${r.size}px;letter-spacing:${r.font === "en" ? -0.04 : -0.02}em">${esc(r.t)}<i class="bl"></i></span>`
  }).join("")
  return `<div class="numwrap">
    <div id="pre" class="sm" style="font-family:'${ja.family}';font-weight:${ja.weight};font-size:${t.small}px">${esc(t.pre)}</div>
    <div id="num" class="num">${num}</div>
    <div id="post" class="sm" style="font-family:'${ja.family}';font-weight:${ja.weight};font-size:${t.small}px">${esc(t.post)}</div>
  </div>
  <div id="note" class="note" style="font-family:'${jr.family}';font-weight:${jr.weight}">${esc(t.note)}</div>`
}

// 2次ベジェを折れ線に分解（PPTX 側も同じ分割数で描く）
export function qpts([[x0, y0], [cx, cy], [x1, y1]], n = 64) {
  return Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1] })
}

function diagramHtml(slide) {
  const g = slide.diagram
  const col = (k) => C[k]
  const paths = g.paths.map((p) => {
    const pts = p.q ? qpts(p.q) : p.pts
    const d = "M" + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L")
    const dash = p.dash ? `stroke-dasharray="${p.dash.join(" ")}"` : ""
    return `<path d="${d}" fill="none" stroke="${col(p.c)}" stroke-opacity="${p.alpha ?? 1}" stroke-width="${p.w}" stroke-linecap="round" stroke-linejoin="round" ${dash}/>`
  }).join("")
  const dots = g.dots.map((o) => `<circle cx="${o.x}" cy="${o.y}" r="${o.r}" fill="${col(o.c)}"/>`).join("")
  const labels = g.labels.map((l) => {
    const f = font(l.font)
    const box = l.align === "center" ? `left:${l.x - 900}px;width:1800px` : l.align === "right" ? `left:${l.x - 1800}px;width:1800px` : `left:${l.x}px`
    return `<div class="lab" style="${box};top:${l.y}px;text-align:${l.align};font-family:'${f.family}';font-weight:${f.weight};font-size:${l.size}px;color:${col(l.c)}">${esc(l.t)}</div>`
  }).join("")
  return `<svg class="dg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${paths}${dots}</svg>${labels}`
}

function imgTag(ph, style) {
  return `<img src="${fileUrl(ph.path)}" style="position:absolute;${style};object-fit:cover;object-position:${ph.focal};opacity:${ph.opacity}">`
}

function slideHtml(slide, res) {
  let body = ""
  if (slide.layout === "full") {
    if (res.photo) body += imgTag(res.photo, `inset:0;width:${W}px;height:${H}px`)
    if (res.photo && slide.scrim) body += `<div style="position:absolute;inset:0;background:${SCRIMS[slide.scrim].css}"></div>`
    body += textBlockHtml(slide)
  } else if (slide.layout === "split") {
    const hw = (W - SPLIT.gap) / 2
    if (res.photo) body += imgTag(res.photo, `left:0;top:0;width:${hw}px;height:${SPLIT.h}px`)
    if (res.photo2) body += imgTag(res.photo2, `left:${hw + SPLIT.gap}px;top:0;width:${hw}px;height:${SPLIT.h}px`)
    body += textBlockHtml(slide)
  } else if (slide.layout === "diagram") {
    body += diagramHtml(slide) + textBlockHtml(slide)
  } else if (slide.layout === "number") {
    if (res.photo) body += imgTag(res.photo, `inset:0;width:${W}px;height:${H}px`)
    body += numberHtml(slide)
  }
  if (slide.logo) body += `<img id="logo" src="${fileUrl(path.join(DIR, "assets/bondex-logo-white.png"))}" style="position:absolute;right:${M.x}px;bottom:${M.y + 22}px;height:40px;opacity:.92">`
  return `<section class="s">${body}</section>`
}

const FONT_DIR = path.join(DIR, "assets/fonts")
// Inter は TrueType アウトライン版（fontsource）を使う。CFF 版だと PDF に Type 3 で埋め込まれるため
const CSS = `
${[400, 500, 600].map((w) => `@font-face{font-family:"Inter";font-weight:${w};src:url("${fileUrl(path.join(FONT_DIR, `inter-latin-${w}-normal.woff2`))}") format("woff2")}`).join("\n")}
@page{size:${W}px ${H}px;margin:0}
html,body{margin:0;padding:0;background:${C.bg}}
.s{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${C.bg};color:${C.fg};break-after:page;
   -webkit-font-smoothing:antialiased;font-kerning:normal;font-feature-settings:"kern" 1}
.txt{position:absolute;white-space:nowrap}
.ln{display:block}
.bl{display:inline-block;width:0;height:0;vertical-align:baseline}
.numwrap{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;white-space:nowrap}
.sm{color:${C.fg};opacity:.78;line-height:1.3;letter-spacing:-0.01em}
.num{line-height:1;color:${C.accent};margin:26px 0 30px}
.dg{position:absolute;left:0;top:0}
.lab{position:absolute;white-space:nowrap;line-height:1.42;letter-spacing:-0.01em}
.note{position:absolute;left:${M.x}px;bottom:${M.y - 40}px;font-size:22px;color:${C.muted};letter-spacing:.01em}
`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: W, height: H } })

// 1) プレースホルダー画像（写真が未配置のスロット）
const resolved = SPEC.slides.map((s) => {
  const full = { w: W, h: H }
  const half = { w: (W - SPLIT.gap) / 2, h: SPLIT.h }
  if (s.layout === "split") return { photo: resolvePhoto(s, "photo", half), photo2: resolvePhoto(s, "photo2", half) }
  return { photo: resolvePhoto(s, "photo", full) }
})
for (const [i, s] of SPEC.slides.entries()) {
  for (const key of ["photo", "photo2"]) {
    const ph = resolved[i][key]
    if (!ph?.placeholder) continue
    const p2 = await browser.newPage({ viewport: { width: ph.box.w, height: ph.box.h } })
    await p2.setContent(placeholderHtml(s, ph, ph.box))
    await p2.evaluate(() => document.fonts.ready)
    await p2.screenshot({ path: ph.path })
    await p2.close()
  }
}

// 2) スライド本体
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${CSS}</style></head><body>
${SPEC.slides.map((s, i) => slideHtml(s, resolved[i])).join("\n")}</body></html>`
const htmlPath = path.join(BUILD, "deck.html")
fs.writeFileSync(htmlPath, html)
await page.goto(fileUrl(htmlPath))
await page.evaluate(() => document.fonts.ready)

// フォント実体の確認（代替フォントで描画されていないか）
const fontsUsed = await page.evaluate(async () => {
  const out = []
  for (const f of document.fonts) out.push(`${f.family} ${f.weight} ${f.status}`)
  return out
})

// 3) PPTX 用にテキスト配置を計測
const layout = await page.evaluate(() => {
  return [...document.querySelectorAll("section.s")].map((sec) => {
    const o = sec.getBoundingClientRect()
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height } }
    return {
      txt: box(sec.querySelector("#txt")), pre: box(sec.querySelector("#pre")), num: box(sec.querySelector("#num")),
      post: box(sec.querySelector("#post")),
      // 数字行は 1 文字列ずつ：PPTX で和欧間の自動スペースが入らないよう別ボックスにする
      numRuns: [...sec.querySelectorAll(".nr")].map((el) => ({ ...box(el), baseline: el.querySelector(".bl").getBoundingClientRect().top - o.top })), note: box(sec.querySelector("#note")), logo: box(sec.querySelector("#logo")),
    }
  })
})

// 4) PNG（1枚ずつ）と PDF
for (let i = 0; i < SPEC.slides.length; i++) {
  const el = (await page.$$("section.s"))[i]
  await el.screenshot({ path: path.join(BUILD, "png", `slide-${String(i + 1).padStart(2, "0")}.png`) })
}
const complete = !TYPE_ONLY && problems.length === 0
const pdfName = TYPE_ONLY ? "BondEx_Seminar_TypeOnly.pdf" : complete ? "BondEx_Seminar_Final.pdf" : "BondEx_Seminar_Draft.pdf"
await page.pdf({ path: path.join(OUT, pdfName), width: `${W}px`, height: `${H}px`, printBackground: true, preferCSSPageSize: true })
await browser.close()

fs.writeFileSync(path.join(BUILD, "manifest.json"), JSON.stringify({
  typeOnly: TYPE_ONLY, complete, pdfName, split: SPLIT, scrims: SCRIMS,
  slides: SPEC.slides.map((s, i) => ({ n: s.n, layout: s.layout, ...resolved[i], measured: layout[i] })),
}, null, 2))

console.log(`PDF: out/${pdfName}`)
console.log("fonts:", [...new Set(fontsUsed)].join(", ") || "(system fonts)")
if (warnings.length && !TYPE_ONLY) { console.log("警告（軽い拡大あり）:"); for (const w of warnings) console.log("  - " + w) }
if (problems.length && !TYPE_ONLY) { console.log("未完了の項目:"); for (const p of problems) console.log("  - " + p) }
