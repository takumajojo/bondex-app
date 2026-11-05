/**
 * 旅行者の予約（B2C）の個人情報を、運営の API の応答から外す（2026-11-05）。
 *
 * B2C の区間（shipments の channel='b2c' 等・lib/b2c/b2b-guard.ts）には旅行者の名前（representative・recipient）が入る。
 * 名前・連絡先・予約の詳細・支払の情報は、本人確認済みの個人のパスキーのセッション（lib/b2c/operator-identity.ts）にだけ返す。
 * 共有パスワード（v1）・Bearer・メールの無いパスキーには、配送の運用に要る項目（日付・ホテル・個数・状態・問い合わせ番号）だけを返す。
 * 画面で隠すのではなく、応答そのものから外す。判定ができない時（DB の障害など）は「見せない」側に倒す。
 */
import type { NextRequest } from "next/server"
import { resolveB2cOperator } from "@/lib/b2c/operator-identity"
import { isB2cShipmentRow } from "@/lib/b2c/b2b-guard"

/** 外した項目に入れる文字（画面にそのまま出る） */
export const B2C_PII_REDACTED = "（B2C・個人パスキーで表示）"

/**
 * B2C の区間で、個人のパスキーでない運営者にも返す項目（shipments の列名・これ以外は全部外す＝許す項目を列挙する方式）。
 * 2026-11-05 の追加の監査: 名前を外しても「予約番号 × ホテル × 宿泊日 × 個数 × 言語」の組み合わせや、
 * 問い合わせ番号（佐川の追跡のページで配達先の地域が分かる）から旅行者を特定できるおそれがあるため、
 * ホテル・宿泊日・配達日・問い合わせ番号・額・言語も外す。残すのは件数と状態を把握するための最小限。
 */
export const B2C_SHIPMENT_PUBLIC_FIELDS = [
  "id",
  "booking_id",
  "leg_index",
  "status",
  "shipment_date",
  "suitcase_count",
  "channel",
  "agency",
  "carrier",
  "created_at",
  "updated_at",
  // DB で NOT NULL の列（画面が値のある前提で表示する）。どれも単独・組み合わせで旅行者の特定にはつながらない
  // （配達日は集荷日からほぼ決まり、額は個数 × 公開の単価から分かる）
  "expected_arrival",
  "amount_yen",
  "traveler_count",
  "booking_type",
  "is_addition",
  "label_to",
  "label_split",
  "label_sender",
  "tracking_limit_reached",
] as const

/** 外す項目のうち、画面が文字として表示するもの（空にすると画面が崩れるので伏せ字にする） */
const TEXT_PLACEHOLDER_FIELDS = new Set<string>([
  "representative", "recipient", "booking_name",
  "from_hotel", "to_hotel", "from_hotel_ja", "to_hotel_ja", "from_hotel_en", "to_hotel_en",
])

/** 以前の方式（外す項目を列挙）で外していた項目。試験と文書のために残す（許す項目の方式では、これらは全部外れる） */
export const B2C_SHIPMENT_PII_FIELDS = [
  "representative", "recipient", "booking_name", "group_name", "notes", "addition_note",
  "tour_leader_name", "tour_leader_phone", "tour_leader_whatsapp", "label_to", "label_sender", "label_sender_info",
  "label_url", "drive_url", "error_message", "charge_error", "payment_failure_message",
  "stripe_payment_intent_id", "stripe_checkout_session_id", "stripe_checkout_url", "count_change_log",
  "from_hotel", "to_hotel", "from_check_in", "to_check_out", "origin_check_in",
  "tracking_numbers", "tracking_detail", "guest_language", "hotel_contact_info", "from_place_id", "to_place_id", "b2c_order_id",
] as const

/** 個人のパスキーの運営者か（B2C の個人情報を見てよいか）。確かめられない時は false。 */
export async function canSeeB2cPii(req: Pick<NextRequest, "cookies">): Promise<boolean> {
  try {
    return !!(await resolveB2cOperator(req))
  } catch {
    return false
  }
}

/** 1行を返す前に、B2C の区間なら個人情報を外す（B2B の行・見てよい運営者にはそのまま）。 */
export function redactB2cShipment<T>(row: T, canSee: boolean): T {
  if (canSee || !row || typeof row !== "object") return row
  const r = row as Record<string, unknown>
  if (!isB2cShipmentRow(r) && !isB2cBookingId(r.booking_id)) return row
  const keep = new Set<string>(B2C_SHIPMENT_PUBLIC_FIELDS)
  const out: Record<string, unknown> = { b2c_pii_hidden: true }
  for (const [k, v] of Object.entries(r)) {
    if (keep.has(k)) out[k] = v
    else if (TEXT_PLACEHOLDER_FIELDS.has(k)) out[k] = B2C_PII_REDACTED
    // 型を保つ（配列は空の配列・オブジェクトは空のオブジェクト・それ以外は null）。DB で NOT NULL の jsonb（count_change_log・hotel_contact_info）を画面が前提にするため
    else out[k] = Array.isArray(v) ? [] : v !== null && typeof v === "object" ? {} : null
  }
  return out as T
}

export function redactB2cShipments<T>(rows: T[], canSee: boolean): T[] {
  return canSee ? rows : rows.map((r) => redactB2cShipment(r, false))
}

/**
 * 文字の検索（名前・番号）の結果から、見てよくない運営者には B2C の区間を除く。
 * 名前を伏せても「その名前で当たった」こと自体が分かってしまうため（名前の照会に使われないように）。
 */
export function dropB2cRowsForSearch<T>(rows: T[], canSee: boolean, searched: boolean): T[] {
  if (canSee || !searched) return rows
  return rows.filter((r) => !isB2cShipmentRow(r as Record<string, unknown>) && !isB2cBookingId((r as Record<string, unknown>).booking_id))
}

/** B2C の予約番号か（B2C の区間の booking_id は必ず "B2C-" + 受付番号: sql/061・062・071 の b2c_confirm_order） */
export function isB2cBookingId(bookingId: unknown): boolean {
  return typeof bookingId === "string" && bookingId.startsWith("B2C-")
}

/**
 * 画面向けに組み立てた行（camelCase の bookingId・representative など）から、B2C の旅行者の名前を外す。
 * nameFields に名前の項目を渡す（既定は representative・recipient）。
 */
/** 画面向けの行（camelCase）で、B2C の時に伏せ字にする文字の項目と、null にする項目 */
const TASK_TEXT_FIELDS = ["representative", "recipient", "hotel", "fromHotel", "toHotel"]
const TASK_NULL_FIELDS = [
  "hotelJa", "fromHotelJa", "toHotelJa", "tourNumber", "shippingNumber", "trackingNumbers", "note", "memo", "value", "method",
  "error", "changes", "lastFailure", "expectedArrival", "checkIn", "checkOut", "amountYen", "language", "placeId", "fromPlaceId", "toPlaceId",
]

export function redactB2cTasks<T extends Record<string, unknown>>(rows: T[], canSee: boolean, nameFields: string[] = TASK_TEXT_FIELDS): T[] {
  if (canSee) return rows
  return rows.map((r) => {
    const id = r.bookingId ?? r.booking_id
    if (!isB2cBookingId(id) && !isB2cShipmentRow(r as Record<string, unknown>)) return r
    // snake_case の行（DB の行そのもの）は区間と同じ扱い
    if ("booking_id" in r) return redactB2cShipment(r, false)
    const out: Record<string, unknown> = { ...r, b2cPiiHidden: true }
    for (const f of nameFields) if (f in out && out[f] != null) out[f] = B2C_PII_REDACTED
    for (const f of TASK_NULL_FIELDS) if (f in out) out[f] = Array.isArray(out[f]) ? [] : null
    return out as T
  })
}
