/**
 * 入口の URL（/book/<token>・阪急交通社向けの限定 Beta）の token の形と期限（P0-2・2026-11-07）。
 *
 * - token は推測できない乱数（24バイト = base64url の 32文字）。DB には sha256 だけ（b2c_entry_links.token_hash）。
 * - 期限つきの token は先頭に `x<YYYYMMDD>_` を付ける（例: x20270331_<32文字>）。期限は日本時間のその日の終わりまで。
 *   期限は token の一部なのでハッシュに含まれ、書き換えると別の token（DB に無い → 無効）になる。新しい列・表は要らない。
 * - 期限の無い token（従来の形・dev / staging の種の token）もそのまま使える。
 * - 期限切れで止めるのは新しい予約だけ（入口の画面・ホテル検索・見積・下書き）。下書きの後のカード登録の照合は止めない
 *   （予約の途中で期限をまたいだ旅行者の登録を壊さない）。
 * - 旅行者の個人情報は URL に入れない（入口の token は紹介元ごとの 1つ。予約の確認は別の My Booking の token）。
 */
import crypto from "node:crypto"

export const ENTRY_TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/
const EXPIRY_RE = /^x(\d{4})(\d{2})(\d{2})_[A-Za-z0-9_-]{16,}$/
export const REFERRER_CODE_RE = /^[A-Z0-9]{3,16}$/

export type EntryTokenShape = { ok: true; expiresOn: string | null } | { ok: false }

/** token の形と、期限（あれば YYYY-MM-DD）。形が正しくなければ ok: false（DB に問い合わせない）。 */
export function parseEntryToken(token: unknown): EntryTokenShape {
  if (typeof token !== "string" || !ENTRY_TOKEN_RE.test(token)) return { ok: false }
  if (!token.startsWith("x")) return { ok: true, expiresOn: null }
  const m = EXPIRY_RE.exec(token)
  if (!m) return { ok: true, expiresOn: null } // x で始まるだけの従来の乱数の token
  const ymd = `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date(`${ymd}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== ymd) return { ok: false } // 2027-02-30 など
  return { ok: true, expiresOn: ymd }
}

/** 期限（日本時間のその日の 23:59:59.999 まで有効）を過ぎたか。 */
export function entryTokenExpired(expiresOn: string | null, now: Date = new Date()): boolean {
  if (!expiresOn) return false
  const endJst = Date.parse(`${expiresOn}T23:59:59.999+09:00`)
  return now.getTime() > endJst
}

/** 新しい入口の token。expiresOn（YYYY-MM-DD）を渡すと期限つき。 */
export function generateEntryToken(expiresOn?: string | null): string {
  const rand = crypto.randomBytes(24).toString("base64url")
  if (!expiresOn) return rand
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) throw new Error("expiresOn must be YYYY-MM-DD")
  const t = `x${expiresOn.replace(/-/g, "")}_${rand}`
  const p = parseEntryToken(t)
  if (!p.ok || p.expiresOn !== expiresOn) throw new Error(`invalid date: ${expiresOn}`)
  return t
}
