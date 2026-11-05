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

/** B2C の区間で、個人のパスキーの運営者にだけ返す項目（shipments の列名）。文字の項目は上の文字に、それ以外は null にする。 */
export const B2C_SHIPMENT_PII_FIELDS = [
  "representative",
  "recipient",
  "booking_name",
  "group_name",
  "notes",
  "addition_note",
  "tour_leader_name",
  "tour_leader_phone",
  "tour_leader_whatsapp",
  "label_to",
  "label_sender",
  "label_sender_info",
  "label_url", // 送り状（名前が載る）
  "drive_url",
  "error_message",
  "charge_error",
  "payment_failure_message",
  "stripe_payment_intent_id",
  "stripe_checkout_session_id",
  "stripe_checkout_url",
  "count_change_log",
] as const

/** 文字のまま置き換える項目（一覧の表示で名前の欄が空にならないように） */
const TEXT_PLACEHOLDER_FIELDS = new Set<string>(["representative", "recipient", "booking_name"])

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
  const out: Record<string, unknown> = { ...r, b2c_pii_hidden: true }
  for (const f of B2C_SHIPMENT_PII_FIELDS) {
    if (!(f in out)) continue
    out[f] = TEXT_PLACEHOLDER_FIELDS.has(f) ? B2C_PII_REDACTED : null
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
export function redactB2cTasks<T extends Record<string, unknown>>(rows: T[], canSee: boolean, nameFields: string[] = ["representative", "recipient"]): T[] {
  if (canSee) return rows
  return rows.map((r) => {
    const id = r.bookingId ?? r.booking_id
    if (!isB2cBookingId(id) && !isB2cShipmentRow(r as Record<string, unknown>)) return r
    const out: Record<string, unknown> = { ...r, b2cPiiHidden: true }
    for (const f of nameFields) if (f in out && out[f] != null) out[f] = B2C_PII_REDACTED
    return out as T
  })
}
