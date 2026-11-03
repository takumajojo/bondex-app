/**
 * 画面の試験の道具（Stage 3）。この Mac の Google Chrome を画面なし（headless）で起動し、
 * Chrome DevTools Protocol で操作する。追加のソフトのダウンロードはしない。
 * Stripe のカード入力欄・3D セキュアの画面は別のドメインの iframe なので、iframe ごとに接続して操作する。
 * 接続先はローカルの開発サーバーだけ（呼び出し側で確かめる）。
 */
import { spawn } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launch({ port = 9333, mobile = true, lang = "ja-JP" } = {}) {
  const profile = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "b2c-ui-"))
  const proc = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    `--lang=${lang}`, "--window-size=1280,900", "about:blank",
  ], { stdio: "ignore" })
  let ver
  for (let i = 0; i < 50 && !ver; i++) {
    await sleep(200)
    ver = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null)
  }
  if (!ver) throw new Error("chrome did not start")
  const ws = new WebSocket(ver.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const pending = new Map()
  const frames = new Map() // sessionId -> url
  const listeners = []
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)
      return
    }
    if (msg.method === "Target.attachedToTarget") {
      const { sessionId, targetInfo } = msg.params
      frames.set(sessionId, targetInfo.url)
      // iframe の中の iframe（3D セキュアの画面）にも自動でつなぐ
      send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId).catch(() => {})
      send("Runtime.enable", {}, sessionId).catch(() => {})
    }
    if (msg.method === "Target.detachedFromTarget") frames.delete(msg.params.sessionId)
    if (msg.method === "Target.targetInfoChanged") {
      for (const [sid, _] of frames) if (sid && msg.params.targetInfo) { /* url は下の frameUrls で取り直す */ }
    }
    for (const l of listeners) l(msg)
  }
  function send(method, params = {}, sessionId) {
    const mid = ++id
    ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }))
    return new Promise((res, rej) => pending.set(mid, { res, rej }))
  }
  const { targetId } = await send("Target.createTarget", { url: "about:blank" })
  const { sessionId: page } = await send("Target.attachToTarget", { targetId, flatten: true })
  await send("Page.enable", {}, page)
  await send("Runtime.enable", {}, page)
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, page)
  const consoleErrors = []
  const dialogs = []
  // 「このページを離れますか？」などの確認は記録して OK を押す（止まらないように）
  listeners.push((m) => {
    if (m.method === "Page.javascriptDialogOpening") {
      dialogs.push(`${m.params.type}: ${m.params.message}`)
      send("Page.handleJavaScriptDialog", { accept: true }, m.sessionId).catch(() => {})
    }
  })
  listeners.push((m) => {
    if (m.method === "Runtime.exceptionThrown" && m.sessionId === page) consoleErrors.push(m.params.exceptionDetails?.exception?.description?.slice(0, 200))
  })

  async function setViewport(mobileView) {
    if (mobileView) {
      await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, page)
      await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", acceptLanguage: lang }, page)
    } else {
      await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, page)
    }
  }
  await setViewport(mobile)

  async function evaluate(expr, sessionId = page) {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval error")
    return r.result.value
  }
  async function waitFor(expr, { timeout = 20000, sessionId = page } = {}) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const v = await evaluate(expr, sessionId).catch(() => null)
      if (v) return v
      await sleep(250)
    }
    throw new Error(`timeout waiting for: ${expr.slice(0, 120)}`)
  }
  async function navigate(url) {
    await send("Page.navigate", { url }, page)
    await waitFor("document.readyState === 'complete'")
    // 画面の部品が動き始める（hydration）まで待つ
    await waitFor("[...document.querySelectorAll('button')].some(b => Object.keys(b).some(k => k.startsWith('__react')))", { timeout: 30000 })
  }
  async function clickSelector(js) {
    const rect = await waitFor(`(() => { const e = ${js}; if (!e) return null; e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return r.width ? {x: r.x + r.width/2, y: r.y + r.height/2} : null })()`)
    await sleep(150)
    for (const type of ["mousePressed", "mouseReleased"]) {
      await send("Input.dispatchMouseEvent", { type, x: rect.x, y: rect.y, button: "left", clickCount: 1 }, page)
    }
  }
  const byText = (t, tag = "button") => `[...document.querySelectorAll('${tag}')].find(e => e.textContent.trim().includes(${JSON.stringify(t)}))`
  // 閉じた iframe に問い合わせると返事が来ないので、3秒で見切る
  const evalQuick = (expr, sid) => Promise.race([evaluate(expr, sid), sleep(3000).then(() => { throw new Error("frame eval timeout") })])
  async function frameSession(urlPart, readyExpr = "true", timeout = 20000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      for (const [sid] of [...frames]) {
        const href = await evalQuick("location.href", sid).catch(() => { frames.delete(sid); return "" })
        if (href.includes(urlPart) && (await evalQuick(readyExpr, sid).catch(() => false))) return sid
      }
      await sleep(300)
    }
    throw new Error(`frame not found: ${urlPart}`)
  }
  /** Stripe の Payment Element の欄に入力する（iframe の中の input に focus してから文字を送る）。 */
  async function typeStripe(fields) {
    const sid = await frameSession("elements-inner-payment", "!!document.querySelector('input[name=number]')", 30000)
    for (const [name, text] of Object.entries(fields)) {
      await evaluate(`(() => { const e = document.querySelector('input[name=${name}]'); e.focus(); e.select && e.select(); return true })()`, sid)
      await sleep(100)
      for (const ch of text) {
        await send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch, unmodifiedText: ch }, sid)
        await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch }, sid)
      }
      await sleep(150)
    }
    return sid
  }
  async function clearStripe() {
    const sid = await frameSession("elements-inner-payment", "!!document.querySelector('input[name=number]')", 30000)
    for (const name of ["number", "expiry", "cvc"]) {
      await evaluate(`(() => { const e = document.querySelector('input[name=${name}]'); e.focus(); e.select(); return true })()`, sid)
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }, sid)
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }, sid)
    }
  }
  /** Stripe のテストの 3D セキュアの画面で「完了」または「失敗」を押す。 */
  async function threeDs(action) {
    const id = action === "complete" ? "test-source-authorize-3ds" : "test-source-fail-3ds"
    const sid = await frameSession("", `!!document.getElementById('${id}')`, 30000)
    await evalQuick(`document.getElementById('${id}').click(), true`, sid).catch(() => {}) // 押すと画面が閉じるので返事は待たない
  }
  async function screenshot(path) {
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, page)
    writeFileSync(path, Buffer.from(data, "base64"))
  }
  async function close() {
    try { ws.close() } catch {}
    proc.kill("SIGTERM")
  }
  return { dialogs, send, page, evaluate, waitFor, navigate, clickSelector, byText, typeStripe, clearStripe, threeDs, screenshot, setViewport, frameSession, consoleErrors, close, sleep }
}
