// LP イラスト (design/lp-illustrations/final) を public/lp の WebP に変換する。
// 使い方: node scripts/build-lp-images.mjs  (最終画像を差し替えたら再実行)

import sharp from "sharp"
import fs from "node:fs"
import path from "node:path"
const ROOT = process.cwd()
const FINAL = path.join(ROOT, "design/lp-illustrations/final")
const PH = path.join(ROOT, "design/lp-illustrations/placeholder")
const OUT = path.join(ROOT, "public/lp")
// [name, source, {crop aspect w:h | null}, widths, quality?]
// ロゴ (public/lp/bondex-logo.webp) は public/bondex-logo.png から幅480で別途生成 (LP専用・PDF等は PNG のまま)
const jobs = [
  ["hero-desktop", `${FINAL}/hero-desktop.png`, null, [1672, 1200, 900]],
  ["hero-mobile", `${FINAL}/hero-mobile.png`, null, [1122, 750], 52], // 白72%を重ねるため低画質で可 (LCP対策)
  ["pain-street", `${FINAL}/pain-street.png`, null, [1536, 900, 600]],
  ["pain-station", `${FINAL}/pain-station.png`, null, [1536, 900, 600]],
  ["concept-family", `${FINAL}/concept-family.png`, null, [1122, 750, 500]],
  ["flow-02-handover", `${FINAL}/flow-02-handover.png`, null, [1122, 750, 500]],
  ["flow-03-truck", `${FINAL}/flow-03-truck.png`, [4, 5], [1003, 750, 500]],
  ["flow-04-receive", `${FINAL}/flow-04-receive.png`, null, [1122, 750, 500]],
  ["flow-05-mail", `${FINAL}/flow-05-mail.png`, null, [1122, 750, 500]],
  ["group-lobby", `${FINAL}/group-lobby.png`, null, [1122, 750, 500]],
  ["closing-handshake", `${FINAL}/closing-handshake.png`, null, [1122, 750, 500]],
  ["fit-couple", `${FINAL}/fit-couple.png`, null, [1122, 750, 500]],
  ["support-operator", `${FINAL}/support-operator.png`, null, [1122, 750, 500]],
  ["japan-map", `${ROOT}/docs/collateral/assets/japan.png`, null, [1294, 800]],
]
for (const [name, src, aspect, widths, quality = 82] of jobs) {
  const img = sharp(src)
  const meta = await img.metadata()
  let base = img
  if (aspect) {
    const [aw, ah] = aspect
    let w = meta.width, h = Math.round((meta.width * ah) / aw)
    if (h > meta.height) { h = meta.height; w = Math.round((meta.height * aw) / ah) }
    const left = Math.round((meta.width - w) / 2)
    const top = Math.round((meta.height - h) / 2)
    base = img.extract({ left, top, width: w, height: h })
  }
  const buf = await base.toBuffer()
  for (const w of widths) {
    const suffix = w === widths[0] ? "" : `-${w}`
    const out = path.join(OUT, `${name}${suffix}.webp`)
    await sharp(buf).resize({ width: w, withoutEnlargement: true }).webp({ quality, effort: 5 }).toFile(out)
    const st = fs.statSync(out)
    const m = await sharp(out).metadata()
    console.log(`${path.basename(out).padEnd(28)} ${m.width}x${m.height}  ${(st.size / 1024).toFixed(0)}KB`)
  }
}
