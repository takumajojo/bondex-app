// 管理画面スクリーンショット (docs/collateral/service-overview/images) を LP 用に切り出す。
// portal-full の月別請求行 (旧価格 ¥5,000 表示) は使わず、予約一覧の帯だけを使う。
import sharp from "sharp"
const SRC = "docs/collateral/service-overview/images"
const OUT = "public/lp"
// Step 01: 代理店ポータル (新規発行ボタン + 状況カード) — 元が 1060x1327 ≒ 4:5
for (const w of [1060, 750, 500]) {
  const suffix = w === 1060 ? "" : `-${w}`
  await sharp(`${SRC}/portal-new.png`).extract({ left: 0, top: 0, width: 1060, height: 1325 })
    .resize({ width: w }).webp({ quality: 84 }).toFile(`${OUT}/portal-new${suffix}.webp`)
}
// 管理画面: 予約一覧の帯のみ (2566x1662 の y=940..1430)
for (const w of [2000, 1200, 800]) {
  const suffix = w === 2000 ? "" : `-${w}`
  await sharp(`${SRC}/portal-full.png`).extract({ left: 30, top: 940, width: 2506, height: 490 })
    .resize({ width: w }).webp({ quality: 84 }).toFile(`${OUT}/portal-list${suffix}.webp`)
}
for (const f of ["portal-new", "portal-list"]) {
  const m = await sharp(`${OUT}/${f}.webp`).metadata(); console.log(f, m.width, m.height)
}
