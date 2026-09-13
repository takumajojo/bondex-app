/**
 * ホテル連絡情報 (shipments.hotel_contact_info jsonb / migration 032) の型とヘルパー。
 *
 * 発送元(pickup)・お届け先(guest) の各ルートについて、運用担当がホテルに連絡する際の
 * 実務情報を保持する:
 *   - method/value: 今回の連絡方法(電話/メール)と連絡先
 *   - memo:         申し送りや「断られた」等の運用メモ
 *   - officialWebsite/officialPhone/officialPhoneSource:
 *                   ホテル公式サイトから取得した電話番号 (Googleの電話データは使わない)。
 *                   憶測で確定せず、抽出元URLと一緒に「候補」として持つ。
 *   - futureEmailOk/futureEmail:
 *                   新規ホテルに電話した後で「今後の受け取り依頼をメールで受け付けてよいか」を
 *                   確認し、担当者から聞いたメールアドレスを登録する。次回以降の同一ホテルへ
 *                   引き継ぐ (lib/hotel-history.ts)。
 *   - introEmailSentAt:
 *                   ホテルへ「今後はこのメールへご連絡します」の紹介メールを送った日時。
 *
 * 「連絡済み」の状態自体は既存の shipments.pickup_hotel_notified_at /
 * guest_hotel_notified_at (タイムスタンプ) を継続利用する。ここには持たない。
 */

export type HotelContactMethod = "" | "phone" | "email"
export type FutureEmailOk = "unknown" | "yes" | "no"

export interface HotelContactRoute {
  method: HotelContactMethod
  value: string
  memo: string
  officialWebsite: string
  officialPhone: string
  officialPhoneSource: string
  futureEmailOk: FutureEmailOk
  futureEmail: string
  introEmailSentAt: string | null
}

export interface HotelContactInfo {
  pickup: HotelContactRoute
  guest: HotelContactRoute
}

export type HotelRoute = "pickup" | "guest"

export function emptyHotelRoute(): HotelContactRoute {
  return {
    method: "",
    value: "",
    memo: "",
    officialWebsite: "",
    officialPhone: "",
    officialPhoneSource: "",
    futureEmailOk: "unknown",
    futureEmail: "",
    introEmailSentAt: null,
  }
}

export function emptyHotelContactInfo(): HotelContactInfo {
  return { pickup: emptyHotelRoute(), guest: emptyHotelRoute() }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : ""
}

function parseRoute(raw: unknown): HotelContactRoute {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const method = r.method === "phone" || r.method === "email" ? r.method : ""
  const futureEmailOk = r.futureEmailOk === "yes" || r.futureEmailOk === "no" ? r.futureEmailOk : "unknown"
  return {
    method,
    value: str(r.value),
    memo: str(r.memo),
    officialWebsite: str(r.officialWebsite),
    officialPhone: str(r.officialPhone),
    officialPhoneSource: str(r.officialPhoneSource),
    futureEmailOk,
    futureEmail: str(r.futureEmail),
    introEmailSentAt: typeof r.introEmailSentAt === "string" ? r.introEmailSentAt : null,
  }
}

/** DB の jsonb (null / {} / 途中まで) を安全に正規化して返す。 */
export function parseHotelContactInfo(raw: unknown): HotelContactInfo {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  return { pickup: parseRoute(o.pickup), guest: parseRoute(o.guest) }
}

/** 詳細ページ/APIから受け取る、1ルートへの部分更新。すべて任意。 */
export type HotelContactRoutePatch = Partial<
  Pick<
    HotelContactRoute,
    | "method"
    | "value"
    | "memo"
    | "officialWebsite"
    | "officialPhone"
    | "officialPhoneSource"
    | "futureEmailOk"
    | "futureEmail"
    | "introEmailSentAt"
  >
>

/** patch 内の値だけを検証してクリーンな部分更新に整える (過長・型不正を弾く)。 */
export function sanitizeRoutePatch(input: unknown): HotelContactRoutePatch {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>
  const out: HotelContactRoutePatch = {}
  if (r.method !== undefined) out.method = r.method === "phone" || r.method === "email" ? r.method : ""
  if (r.value !== undefined) out.value = str(r.value).slice(0, 200)
  if (r.memo !== undefined) out.memo = str(r.memo).slice(0, 1000)
  if (r.officialWebsite !== undefined) out.officialWebsite = str(r.officialWebsite).slice(0, 500)
  if (r.officialPhone !== undefined) out.officialPhone = str(r.officialPhone).slice(0, 60)
  if (r.officialPhoneSource !== undefined) out.officialPhoneSource = str(r.officialPhoneSource).slice(0, 500)
  if (r.futureEmailOk !== undefined)
    out.futureEmailOk = r.futureEmailOk === "yes" || r.futureEmailOk === "no" ? r.futureEmailOk : "unknown"
  if (r.futureEmail !== undefined) out.futureEmail = str(r.futureEmail).slice(0, 200)
  if (r.introEmailSentAt !== undefined)
    out.introEmailSentAt = typeof r.introEmailSentAt === "string" ? r.introEmailSentAt : null
  return out
}
