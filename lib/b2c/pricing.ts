/**
 * B2C の料金（MVP）。docs/b2c/B2C_PLATFORM_AUDIT_v1.md 16.2。
 *
 * - すべての B2C 予約に BondEx の標準価格を使う（パートナー別価格は別フェーズ・12章）。
 * - 単価はすべて **税抜**（D01・D02 確定 2026-11-02）。消費税は lib/tax.ts で加算する。
 * - 予約時に区間の種類・単価・税を控え（b2c_order_pricing）に固定し、後から変えない。
 *
 * B2B の料金（lib/pricing.ts・agencies.unit_price_yen）とは独立。B2B 側からは参照しない。
 */
import { grossOf, taxOf } from "@/lib/tax"
import { isOkinawaZip, normalizeZip7 } from "@/lib/sagawa-lead-time"

/** 標準単価（税抜・1個）。 */
export const B2C_STANDARD_UNIT_NET_YEN = 4980
/** 沖縄の区間の単価（税抜・1個）。 */
export const B2C_OKINAWA_UNIT_NET_YEN = 13000

export type B2cRouteClass = "standard" | "okinawa"

/**
 * 区間の種類。
 * - 沖縄県内どうし → standard（2026-10-30 確定）
 * - 片方だけ沖縄 → okinawa。沖縄から本土の向きも 13,000円（M01 確定 2026-11-02）
 * - 離島は県単位の通常料金（別料金なし・2026-10-30 確定）
 */
export function b2cRouteClass(originZip: string, destZip: string): B2cRouteClass {
  const o = normalizeZip7(originZip)
  const d = normalizeZip7(destZip)
  if (!o || !d) throw new Error("b2cRouteClass: invalid zip")
  return isOkinawaZip(o) !== isOkinawaZip(d) ? "okinawa" : "standard"
}

export interface B2cQuote {
  routeClass: B2cRouteClass
  pieces: number
  unitNetYen: number
  subtotalNetYen: number
  taxYen: number
  totalGrossYen: number
}

/** 1予約の最大個数（M02 確定 2026-11-02: 団体でなくても 50個まで）。 */
export const B2C_MAX_PIECES = 50

export function quoteB2c(originZip: string, destZip: string, pieces: number): B2cQuote {
  if (!Number.isInteger(pieces) || pieces < 1 || pieces > B2C_MAX_PIECES) {
    throw new Error(`quoteB2c: pieces must be 1..${B2C_MAX_PIECES}`)
  }
  const routeClass = b2cRouteClass(originZip, destZip)
  const unitNetYen = routeClass === "okinawa" ? B2C_OKINAWA_UNIT_NET_YEN : B2C_STANDARD_UNIT_NET_YEN
  const subtotalNetYen = unitNetYen * pieces
  return {
    routeClass,
    pieces,
    unitNetYen,
    subtotalNetYen,
    taxYen: taxOf(subtotalNetYen),
    totalGrossYen: grossOf(subtotalNetYen),
  }
}
