/**
 * B2C の予約の受付のサーバー側の処理（Stage 2）。docs/b2c/B2C_PHASE1A_BETA_PLAN.md・B2C_MVP_SCHEMA_v1.md。
 *
 * 画面から来た値は信用しない。ホテル（Google の place_id から郵便番号・住所を取り直す）・施設の確認の状態・
 * 佐川の日数・締切・宿泊日の整合・ホテルの受付の可否・受付の上限・料金を、すべてここで計算し直す。
 * B2B の表・処理には触れない（読むのは佐川の日数の表だけ。書くのは b2c_* だけ）。
 */
import crypto from "node:crypto"
import { getSupabase } from "@/lib/supabase"
import { fetchHotelPlaceDetailsJa, zipFromPlaceDetails, parseJpAddressString } from "@/lib/hotel-place"
import { isMockPlaceId, mockHotelById, placesMockEnabled } from "@/lib/places-mock"
import { resolveSagawaLeadTime, normalizeZip7 } from "@/lib/sagawa-lead-time"
import { quoteB2c, B2C_MAX_PIECES, type B2cQuote } from "./pricing"
import { judgeB2cBookability, jstYmd, b2cCardWindowFits, B2C_FALLBACK_TRANSIT_DAYS, type B2cBookabilityError } from "./bookability"
import { planB2cConfirmation, type B2cHotelStatus, type B2cConfirmationMode } from "./hotel-gate"
import { b2cLateBookingEnabled } from "./flags"
import { b2cAccessToken, b2cAccessTokenSecretConfigured } from "./access-token"
import { B2C_TERMS_VERSION } from "./legal-text"

/** Phase 1A の 1予約の個数の上限（Beta。全体の設計は 50個）。DB の CHECK と同じ値。 */
export const B2C_BETA_MAX_PIECES = 10
/** 価格の規則の版（予約の控えに保存）。 */
export const B2C_PRICE_RULE_VERSION = "2026-11-phase1a"

export function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex")
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------
export interface B2cEntry {
  id: string
  referrerCode: string
  referrerName: string
  referrerNameEn: string
}

/**
 * DB に届かない・時間切れ（B2C_DB_TIMEOUT_MS）。「見つからない」と分けて扱う。
 * 見つからないと答えると、画面が「もう一度ご予約ください」と案内し、二重の予約になりうるため。
 */
export class B2cDbUnavailable extends Error {
  constructor(what: string) {
    super(`b2c db unavailable: ${what}`)
    this.name = "B2cDbUnavailable"
  }
}
/** B2C の画面・Webhook が DB を待つ上限。超えたら B2cDbUnavailable（画面は照合を続け、Webhook は Stripe が再送する）。 */
export const B2C_DB_TIMEOUT_MS = 8000

export async function resolveEntry(token: unknown): Promise<B2cEntry | null> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null
  const sb = getSupabase()
  if (!sb) throw new B2cDbUnavailable("not configured")
  const { data, error } = await sb
    .from("b2c_entry_links")
    .select("id, referrer_code, referrer_name, referrer_name_en, status")
    .eq("token_hash", sha256Hex(token))
    .abortSignal(AbortSignal.timeout(B2C_DB_TIMEOUT_MS))
    .maybeSingle()
  if (error) throw new B2cDbUnavailable("entry")
  if (!data || data.status !== "active") return null
  return { id: data.id, referrerCode: data.referrer_code, referrerName: data.referrer_name, referrerNameEn: data.referrer_name_en || data.referrer_name }
}

// ---------------------------------------------------------------------------
// ホテル
// ---------------------------------------------------------------------------
export interface B2cHotel {
  placeId: string
  name: string
  address: string
  postalCode: string
  prefecture: string
  status: B2cHotelStatus
}

const hotelCache = new Map<string, { at: number; hotel: Omit<B2cHotel, "status"> }>()
const HOTEL_CACHE_MS = 6 * 3600 * 1000

async function placeDetails(placeId: string): Promise<Omit<B2cHotel, "status"> | null> {
  // 模擬の ID (lib/places-mock.ts) は、模擬が有効な staging の時だけ使える (控えに残っていても本番の予約に入れない)
  if (isMockPlaceId(placeId) && !placesMockEnabled()) return null
  const hit = hotelCache.get(placeId)
  if (hit && Date.now() - hit.at < HOTEL_CACHE_MS) return hit.hotel
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  // staging の架空のホテル (lib/places-mock.ts) は鍵なしで詳細を返す
  if (!apiKey && !placesMockEnabled()) return null
  const d = await fetchHotelPlaceDetailsJa("", apiKey ?? "", placeId).catch(() => null)
  if (!d) return null
  const zip = normalizeZip7(zipFromPlaceDetails(d))
  if (!zip) return null
  const pref = parseJpAddressString(d.formattedAddress).prefecture || ""
  const hotel = { placeId, name: d.name ?? "", address: d.formattedAddress, postalCode: zip, prefecture: pref }
  hotelCache.set(placeId, { at: Date.now(), hotel })
  return hotel
}

/**
 * 英語のホテル名と住所（英語の旅行者への通知・My Booking 用）。予約の下書きの時に 1回だけ取って控えに残す。
 * 取れなければ空（表示は日本語の名前に戻す）。B2B の lib/hotel-place.ts（日本語）は変えない。
 */
const hotelEnCache = new Map<string, { at: number; name: string; address: string }>()
async function placeNamesEn(placeId: string): Promise<{ name: string; address: string }> {
  const hit = hotelEnCache.get(placeId)
  if (hit && Date.now() - hit.at < HOTEL_CACHE_MS) return hit
  if (placesMockEnabled()) {
    const h = mockHotelById(placeId)
    return h ? { name: h.nameEn, address: h.addressEn } : { name: "", address: "" }
  }
  if (isMockPlaceId(placeId)) return { name: "", address: "" }
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return { name: "", address: "" }
  try {
    const u = new URL("https://maps.googleapis.com/maps/api/place/details/json")
    u.searchParams.set("place_id", placeId)
    u.searchParams.set("fields", "name,formatted_address")
    u.searchParams.set("language", "en")
    u.searchParams.set("key", apiKey)
    const r = await fetch(u.toString(), { signal: AbortSignal.timeout(8000) })
    const j = (await r.json()) as { result?: { name?: string; formatted_address?: string } }
    const v = { at: Date.now(), name: j.result?.name ?? "", address: j.result?.formatted_address ?? "" }
    hotelEnCache.set(placeId, v)
    return v
  } catch {
    return { name: "", address: "" }
  }
}

export async function facilityStatuses(placeIds: string[]): Promise<Map<string, B2cHotelStatus>> {
  const out = new Map<string, B2cHotelStatus>()
  const ids = placeIds.filter(Boolean)
  if (ids.length === 0) return out
  const sb = getSupabase()
  if (!sb) return out
  const { data } = await sb.from("b2c_facilities").select("place_id, status").in("place_id", ids)
  for (const r of data ?? []) out.set(r.place_id as string, r.status as B2cHotelStatus)
  return out
}

export async function resolveHotel(placeId: unknown): Promise<B2cHotel | null> {
  if (typeof placeId !== "string" || !/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) return null
  const d = await placeDetails(placeId)
  if (!d) return null
  const st = (await facilityStatuses([placeId])).get(placeId) ?? "unknown"
  return { ...d, status: st }
}

// ---------------------------------------------------------------------------
// 見積と、選べる日付（サーバーで計算）
// ---------------------------------------------------------------------------
export interface B2cStayInput {
  checkIn: string
  checkOut: string
}

export interface B2cQuoteInput {
  now: Date
  originPlaceId: string
  destPlaceId: string
  origin: B2cStayInput
  dest: B2cStayInput
  pieces: number
  pickupDate?: string
  deliveryDate?: string
}

export interface B2cDateOption {
  pickupDate: string
  deliveryDates: string[]
  earliestDelivery: string
  confirmationMode: B2cConfirmationMode
  confirmationDueAt: string | null
}

export type B2cQuoteError =
  | "hotel_not_found"
  | "same_hotel"
  | "invalid_pieces"
  | "invalid_stay"
  | "no_available_dates"
  | "date_not_available"
  | B2cBookabilityError

export interface B2cQuoteResult {
  ok: boolean
  errors: B2cQuoteError[]
  origin?: B2cHotel
  dest?: B2cHotel
  transitDays?: number
  usedFallbackTransit?: boolean
  price?: B2cQuote
  options: B2cDateOption[]
  /** pickupDate・deliveryDate を指定した時の、その組み合わせの判定 */
  selected?: B2cDateOption & { deliveryDate: string }
}

const YMD = /^\d{4}-\d{2}-\d{2}$/

function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

interface OpsDay {
  closed: boolean
  lateDutyStaff: string | null
  maxNewBookings: number
  maxPieces: number
}

async function opsDays(from: string, to: string): Promise<Map<string, OpsDay>> {
  const out = new Map<string, OpsDay>()
  const sb = getSupabase()
  if (!sb) return out
  const { data } = await sb
    .from("b2c_ops_days")
    .select("date, closed, late_duty_staff, max_new_bookings, max_pieces")
    .gte("date", from)
    .lte("date", to)
  for (const r of data ?? []) {
    out.set(r.date as string, {
      closed: !!r.closed,
      lateDutyStaff: (r.late_duty_staff as string | null) ?? null,
      maxNewBookings: r.max_new_bookings as number,
      maxPieces: r.max_pieces as number,
    })
  }
  return out
}

/** 受付の枠を使っている予約（集荷日ごとの件数と個数）。上限の最終の保証は DB のトリガー。 */
async function usedCapacity(from: string, to: string): Promise<Map<string, { orders: number; pieces: number }>> {
  const out = new Map<string, { orders: number; pieces: number }>()
  const sb = getSupabase()
  if (!sb) return out
  const { data } = await sb
    .from("b2c_orders")
    .select("pickup_date, pieces, status")
    .gte("pickup_date", from)
    .lte("pickup_date", to)
    .in("status", ["card_pending", "awaiting_hotel_confirmation", "confirmed", "completed"])
  for (const r of data ?? []) {
    const k = r.pickup_date as string
    const cur = out.get(k) ?? { orders: 0, pieces: 0 }
    cur.orders += 1
    cur.pieces += r.pieces as number
    out.set(k, cur)
  }
  return out
}

const DEFAULT_OPS: OpsDay = { closed: false, lateDutyStaff: null, maxNewBookings: 5, maxPieces: 19 }

export async function buildB2cQuote(input: B2cQuoteInput): Promise<B2cQuoteResult> {
  const errors: B2cQuoteError[] = []
  const empty = (e: B2cQuoteError[]): B2cQuoteResult => ({ ok: false, errors: e, options: [] })

  if (!Number.isInteger(input.pieces) || input.pieces < 1 || input.pieces > Math.min(B2C_BETA_MAX_PIECES, B2C_MAX_PIECES)) {
    return empty(["invalid_pieces"])
  }
  const stays = [input.origin.checkIn, input.origin.checkOut, input.dest.checkIn, input.dest.checkOut]
  if (!stays.every((s) => typeof s === "string" && YMD.test(s)) || input.origin.checkIn > input.origin.checkOut || input.dest.checkIn >= input.dest.checkOut) {
    return empty(["invalid_stay"])
  }
  if (input.originPlaceId === input.destPlaceId) return empty(["same_hotel"])

  const [origin, dest] = await Promise.all([resolveHotel(input.originPlaceId), resolveHotel(input.destPlaceId)])
  if (!origin || !dest) return empty(["hotel_not_found"])
  if (origin.postalCode === dest.postalCode && origin.placeId === dest.placeId) return empty(["same_hotel"])

  const lt = await resolveSagawaLeadTime(origin.postalCode, dest.postalCode).catch(() => null)
  const transitDays = lt?.days ?? null
  const price = quoteB2c(origin.postalCode, dest.postalCode, input.pieces)

  const today = jstYmd(input.now)
  const firstPickup = input.origin.checkIn > today ? input.origin.checkIn : addDaysYmd(today, 1)
  const lastPickup = input.origin.checkOut
  const [ops, used] = await Promise.all([opsDays(firstPickup, lastPickup), usedCapacity(firstPickup, lastPickup)])
  const lateEnabled = b2cLateBookingEnabled()

  const judge = (pickupDate: string, deliveryDate: string) => {
    const day = ops.get(pickupDate) ?? DEFAULT_OPS
    const plan = planB2cConfirmation({
      now: input.now,
      pickupDate,
      origin: origin.status,
      dest: dest.status,
      lateDutyStaffed: lateEnabled && !!day.lateDutyStaff,
    })
    const b = judgeB2cBookability({
      now: input.now,
      originFacilityId: origin.placeId,
      destFacilityId: dest.placeId,
      origin: input.origin,
      dest: input.dest,
      pickupDate,
      deliveryDate,
      transitDays,
      destAcceptsBeforeCheckIn: false,
    })
    const u = used.get(pickupDate) ?? { orders: 0, pieces: 0 }
    const full = day.closed || u.orders + 1 > day.maxNewBookings || u.pieces + input.pieces > day.maxPieces
    return { plan, b, full }
  }

  const options: B2cDateOption[] = []
  if (firstPickup <= lastPickup) {
    for (let p = firstPickup; p <= lastPickup; p = addDaysYmd(p, 1)) {
      const earliest = addDaysYmd(p, transitDays ?? B2C_FALLBACK_TRANSIT_DAYS)
      const firstDelivery = earliest > input.dest.checkIn ? earliest : input.dest.checkIn
      const deliveryDates: string[] = []
      let plan0: ReturnType<typeof judge>["plan"] | null = null
      for (let d = firstDelivery; d < input.dest.checkOut; d = addDaysYmd(d, 1)) {
        const r = judge(p, d)
        if (r.full || r.plan.errors.length > 0 || !r.b.ok) continue
        // カード登録（30分）が締切・確認の期限に間に合わない日は出さない（カード登録で断られる日を選ばせない）
        if (!b2cCardWindowFits(input.now, p, r.plan.confirmationDueAt)) continue
        deliveryDates.push(d)
        plan0 = r.plan
      }
      if (deliveryDates.length > 0 && plan0) {
        options.push({ pickupDate: p, deliveryDates, earliestDelivery: deliveryDates[0], confirmationMode: plan0.mode, confirmationDueAt: plan0.confirmationDueAt })
      }
    }
  }

  const result: B2cQuoteResult = {
    ok: options.length > 0,
    errors,
    origin,
    dest,
    transitDays: transitDays ?? B2C_FALLBACK_TRANSIT_DAYS,
    usedFallbackTransit: transitDays === null,
    price,
    options,
  }
  if (options.length === 0) result.errors.push("no_available_dates")

  if (input.pickupDate !== undefined || input.deliveryDate !== undefined) {
    const p = input.pickupDate ?? ""
    const d = input.deliveryDate ?? ""
    const opt = options.find((o) => o.pickupDate === p)
    if (!opt || !opt.deliveryDates.includes(d)) {
      result.ok = false
      if (YMD.test(p) && YMD.test(d)) {
        const r = judge(p, d)
        for (const e of r.b.errors) if (!result.errors.includes(e)) result.errors.push(e)
      }
      if (!result.errors.includes("date_not_available")) result.errors.push("date_not_available")
    } else {
      result.selected = { ...opt, deliveryDate: d }
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// 予約の下書きの作成（カード登録の前。Stage 3 でカード登録に進む）
// ---------------------------------------------------------------------------
export interface B2cGuestInput {
  name: string
  email: string
  whatsapp: string
  language: "ja" | "en"
  consent: boolean
}

export type B2cGuestError = "invalid_name" | "invalid_email" | "invalid_whatsapp" | "consent_required"

/** 予約の画面の同意の版（= 規約の版。lib/b2c/legal-text.ts）。consent_version にも同じ値を入れる（既存の判定が使う）。 */
export const B2C_CONSENT_VERSION = B2C_TERMS_VERSION

export function normalizeWhatsapp(raw: string): string | null {
  const s = (raw ?? "").replace(/[\s()-]/g, "")
  return /^\+[1-9][0-9]{6,14}$/.test(s) ? s : null
}

export function validateGuest(g: Partial<B2cGuestInput>): { errors: B2cGuestError[]; whatsapp: string | null } {
  const errors: B2cGuestError[] = []
  const name = (g.name ?? "").trim()
  if (name.length < 1 || name.length > 100) errors.push("invalid_name")
  const email = (g.email ?? "").trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) errors.push("invalid_email")
  const whatsapp = normalizeWhatsapp(g.whatsapp ?? "")
  if (!whatsapp) errors.push("invalid_whatsapp")
  if (g.consent !== true) errors.push("consent_required")
  return { errors, whatsapp }
}

export interface B2cDraftResult {
  ok: boolean
  errors: Array<B2cQuoteError | B2cGuestError | "server_error">
  orderNumber?: number
  accessToken?: string
  totalGrossYen?: number
  confirmationMode?: B2cConfirmationMode
  confirmationDueAt?: string | null
}

export async function createB2cDraftOrder(entry: B2cEntry, q: B2cQuoteInput, guest: Partial<B2cGuestInput>): Promise<B2cDraftResult> {
  const g = validateGuest(guest)
  const quote = await buildB2cQuote(q)
  const errors: B2cDraftResult["errors"] = [...g.errors]
  if (!quote.selected) errors.push(...quote.errors.filter((e) => e !== "no_available_dates" || quote.options.length === 0))
  if (errors.length > 0 || !quote.selected || !quote.origin || !quote.dest || !quote.price || !g.whatsapp) {
    return { ok: false, errors: errors.length ? errors : ["date_not_available"] }
  }
  const sb = getSupabase()
  if (!sb) return { ok: false, errors: ["server_error"] }

  // 施設の行が無いホテルは unknown として登録（運営が確認する）
  for (const h of [quote.origin, quote.dest]) {
    await sb
      .from("b2c_facilities")
      .upsert({ place_id: h.placeId, name: h.name, address: h.address, postal_code: h.postalCode, status: "unknown" }, { onConflict: "place_id", ignoreDuplicates: true })
  }

  if (!b2cAccessTokenSecretConfigured()) return { ok: false, errors: ["server_error"] }
  // 予約の ID をここで決め、秘密の token をそこから作る（後の通知にも My Booking のリンクを入れるため。lib/b2c/access-token.ts）
  const orderId = crypto.randomUUID()
  const accessToken = b2cAccessToken(orderId)
  const p = quote.price
  const [oEn, dEn] = await Promise.all([placeNamesEn(quote.origin.placeId), placeNamesEn(quote.dest.placeId)])
  const snap = (h: B2cHotel, stay: B2cStayInput, en: { name: string; address: string }) => ({
    name: h.name, address: h.address, name_en: en.name || null, address_en: en.address || null,
    postal_code: h.postalCode, prefecture: h.prefecture, check_in: stay.checkIn, check_out: stay.checkOut,
  })
  const consentedAt = new Date().toISOString()
  const { data, error } = await sb
    .from("b2c_orders")
    .insert({
      id: orderId,
      entry_link_id: entry.id,
      referrer_code: entry.referrerCode,
      guest_name: (guest.name ?? "").trim(),
      guest_email: (guest.email ?? "").trim().toLowerCase(),
      guest_whatsapp: g.whatsapp,
      language: guest.language === "ja" ? "ja" : "en",
      origin_place_id: quote.origin.placeId,
      dest_place_id: quote.dest.placeId,
      origin_snapshot: snap(quote.origin, q.origin, oEn),
      dest_snapshot: snap(quote.dest, q.dest, dEn),
      pickup_date: quote.selected.pickupDate,
      delivery_date: quote.selected.deliveryDate,
      pieces: p.pieces,
      route_class: p.routeClass,
      unit_net_yen: p.unitNetYen,
      subtotal_net_yen: p.subtotalNetYen,
      tax_yen: p.taxYen,
      total_gross_yen: p.totalGrossYen,
      price_rule_version: B2C_PRICE_RULE_VERSION,
      status: "draft",
      confirmation_mode: quote.selected.confirmationMode,
      confirmation_due_at: quote.selected.confirmationDueAt,
      // 予約の画面の同意（規約の版・言語・日時）。本文は b2c_legal_documents（sql/079）に版ごとに残る
      consent_version: B2C_CONSENT_VERSION,
      consented_at: consentedAt,
      terms_version: B2C_TERMS_VERSION,
      terms_lang: guest.language === "ja" ? "ja" : "en",
      terms_consented_at: consentedAt,
      access_token_hash: sha256Hex(accessToken),
    })
    .select("order_number")
    .single()
  if (error || !data) {
    console.error("[b2c] draft insert failed", error?.code)
    return { ok: false, errors: ["server_error"] }
  }
  return {
    ok: true,
    errors: [],
    orderNumber: data.order_number as number,
    accessToken,
    totalGrossYen: p.totalGrossYen,
    confirmationMode: quote.selected.confirmationMode,
    confirmationDueAt: quote.selected.confirmationDueAt,
  }
}
