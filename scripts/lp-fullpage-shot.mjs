// LP のフルページ PNG を headless Chrome (CDP) で撮る。ローカル確認・レビュー共有用。
// 使い方: node scripts/lp-fullpage-shot.mjs <url> <out.png> <width> <dpr> <mobile:0|1>
//   例: node scripts/lp-fullpage-shot.mjs http://localhost:3000/ /tmp/lp-desktop.png 1440 1 0
//       node scripts/lp-fullpage-shot.mjs http://localhost:3000/ /tmp/lp-mobile.png 375 2 1
// 巨大な1枚を一度に受け取ると WebSocket が切れるため、2000px ずつタイル撮影して sharp で結合する。
import { spawn } from "node:child_process"
import fs from "node:fs"
import sharp from "sharp"
const [,, url, out, w, dpr, mobile] = process.argv
const TILE = 2000
const port = 9600 + Math.floor(Math.random() * 100), prof = `/tmp/claude-cdp-${port}`
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
let targets
for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break } catch {} await sleep(250) }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id) } }
ws.onclose = () => log("WS CLOSED")
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value
const metrics = (height) => send("Emulation.setDeviceMetricsOverride", { width: +w, height, deviceScaleFactor: +dpr, mobile: mobile === "1" })
await send("Page.enable")
await metrics(TILE)
await send("Page.navigate", { url })
await sleep(5000)
const H0 = await ev("document.documentElement.scrollHeight")
for (let y = 0; y < H0; y += TILE) { await ev(`window.scrollTo(0,${y}); 1`); await sleep(350) }
await ev("window.scrollTo(0,0); 1"); await sleep(800)
await ev("Promise.all([...document.images].map(i=>i.complete?1:new Promise(r=>{i.onload=i.onerror=r}))).then(()=>1)")
// sticky ヘッダーを通常配置に、固定要素 (Cookie バナー等) は非表示にしてタイルの重複を防ぐ
await ev(`(()=>{const h=document.querySelector('header');if(h)h.style.position='static';for(const el of document.querySelectorAll('body *')){const p=getComputedStyle(el).position;if(p==='fixed'&&el!==h)el.style.display='none'}return 1})()`)
await sleep(300)
const fullH = await ev("document.documentElement.scrollHeight")
log("fullH", fullH)
const tiles = []
for (let y = 0; y < fullH; y += TILE) {
  const th = Math.min(TILE, fullH - y)
  await metrics(th)
  await ev(`window.scrollTo(0,${y}); 1`); await sleep(500)
  const actualY = await ev("window.scrollY")
  const shot = await send("Page.captureScreenshot", { format: "png" })
  const buf = Buffer.from(shot.result.data, "base64")
  // 末尾で scrollY が y に届かない場合は上端のズレ分を切り落とす
  const offset = Math.round((y - actualY) * +dpr)
  tiles.push(offset > 0 ? await sharp(buf).extract({ left: 0, top: offset, width: Math.round(+w * +dpr), height: Math.round(th * +dpr) }).png().toBuffer() : buf)
  log("tile", y, th, "scrollY", actualY)
}
const W = Math.round(+w * +dpr)
const composites = []
let top = 0
for (const t of tiles) { const m = await sharp(t).metadata(); composites.push({ input: t, top, left: 0 }); top += m.height }
await sharp({ create: { width: W, height: top, channels: 3, background: "#ffffff" } }).composite(composites).png({ compressionLevel: 9 }).toFile(out)
log("saved", out, W, "x", top)
ws.close(); chrome.kill("SIGKILL"); fs.rmSync(prof, { recursive: true, force: true }); process.exit(0)
