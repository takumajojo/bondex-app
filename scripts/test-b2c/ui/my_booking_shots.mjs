/**
 * My Booking・フロント向けの案内・カード登録の結果の画面の写真（Stage 4 の報告用）。画面なしの Chrome・ローカルだけ・ダミーのデータ。
 * 実行: set -a; . ./.env.local; set +a; BASE=http://localhost:3210 SHOTS=<保存先> node scripts/test-b2c/ui/my_booking_shots.mjs
 */
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import Stripe from "stripe"
import { launch } from "./cdp.mjs"

const BASE = process.env.BASE ?? "http://localhost:3210"
if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(BASE)) throw new Error("refusing: local only")
if (!(process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_")) throw new Error("refusing: sk_test_ only")
const SHOTS = process.env.SHOTS ?? "/tmp/b2c-my"
mkdirSync(SHOTS, { recursive: true })
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const TOK = "dev-hnk-local-token-0001"
const sql = (q) => execFileSync("docker", ["exec", "-i", "supabase_db_supa-local", "psql", "-U", "postgres", "-d", "postgres", "-qtA", "-c", q], { encoding: "utf8" }).trim()
let ip = Math.floor(Math.random() * 60000)
const post = async (p, b) => (await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": `10.5.${(++ip >> 8) % 250}.${(ip % 250) + 1}` }, body: JSON.stringify(b) })).json()
const place = async (q) => (await post("/api/b2c/places", { token: TOK, query: q, lang: "en" })).candidates[0].placeId
const tk = await place("Keio Plaza Hotel Tokyo"), ky = await place("Hotel Granvia Kyoto"), nh = await place("Hotel Collective Naha")
for (const [pid, nm] of [[tk, "Keio Plaza Hotel Tokyo"], [ky, "Hotel Granvia Kyoto"]]) sql(`insert into b2c_facilities(place_id, name, status, checked_by, last_verified_at) values ('${pid}', '${nm}', 'verified', 'e2e@example.invalid', now()) on conflict (place_id) do update set status='verified', checked_by='e2e@example.invalid', last_verified_at=now()`)
sql(`insert into b2c_facilities(place_id, name, status) values ('${nh}', 'Hotel Collective Naha', 'unknown') on conflict (place_id) do update set status='unknown', checked_by=null, last_verified_at=null`)
const STAY = { origin: { checkIn: "2026-11-10", checkOut: "2026-11-12" }, dest: { checkIn: "2026-11-12", checkOut: "2026-11-15" } }
async function booked(lang, dest, delivery, name) {
  const d = await post("/api/b2c/orders", { token: TOK, originPlaceId: tk, destPlaceId: dest, ...STAY, pieces: 2, pickupDate: "2026-11-10", deliveryDate: delivery, name, email: "guest@example.invalid", whatsapp: "+81 90 1234 5678", language: lang, consent: true })
  const s = await post("/api/b2c/card/start", { token: TOK, orderNumber: d.orderNumber, accessToken: d.accessToken, cardConsent: true })
  await stripe.setupIntents.confirm(s.clientSecret.split("_secret_")[0], { payment_method: "pm_card_visa" })
  await post("/api/b2c/card/status", { token: TOK, orderNumber: d.orderNumber, accessToken: d.accessToken })
  return d
}
const naDelivery = (await post("/api/b2c/quote", { token: TOK, originPlaceId: tk, destPlaceId: nh, ...STAY, pieces: 2 })).options[0].earliestDelivery
const ja = await booked("ja", ky, "2026-11-12", "山田 花子")
const en = await booked("en", ky, "2026-11-12", "Emma Smith")
const wait = await booked("en", nh, naDelivery, "Liam Brown")
const cxl = await booked("ja", ky, "2026-11-13", "鈴木 一郎")
await post("/api/b2c/my/cancel", { token: cxl.accessToken })

const b = await launch({ port: 9450 })
const shot = async (path, name, full = false) => {
  await b.navigate(`${BASE}${path}`, { hydrate: !path.includes("/frontdesk") })
  const rej = await b.evaluate(`!!(${b.byText("拒否する")} || ${b.byText("Decline")})`)
  if (rej) await b.clickSelector(`(${b.byText("拒否する")} || ${b.byText("Decline")})`)
  if (full) {
    const h = await b.evaluate("Math.ceil(document.documentElement.scrollHeight)")
    await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: Math.min(h, 2400), deviceScaleFactor: 2, mobile: true }, b.page)
  }
  await b.sleep(400)
  await b.screenshot(`${SHOTS}/${name}.png`)
  if (full) await b.setViewport(true)
}
await shot(`/my/${ja.accessToken}?lang=ja`, "m01_my_booking_confirmed_ja", true)
await shot(`/my/${en.accessToken}`, "m02_my_booking_confirmed_en", true)
await shot(`/my/${wait.accessToken}`, "m03_my_booking_awaiting_en", true)
await shot(`/my/${cxl.accessToken}?lang=ja`, "m04_my_booking_cancelled_ja", true)
await shot(`/my/${ja.accessToken}/frontdesk`, "m05_frontdesk_confirmed", true)
await shot(`/my/${wait.accessToken}/frontdesk`, "m06_frontdesk_not_confirmed")
await b.setViewport(false)
await shot(`/my/${ja.accessToken}?lang=ja`, "m07_my_booking_pc_ja")
await b.close()
console.log("saved to", SHOTS)
