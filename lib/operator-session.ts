/**
 * 運営セッショントークン (2026-08-31 パスキー導入と同時に刷新)。
 *
 * 旧方式は cookie に OPERATOR_PASSWORD の生値を無期限で保存していた
 * (漏れたらそのまま合鍵になる・失効手段はパスワード変更のみ)。
 * 新方式は HMAC-SHA256 署名つき・有効期限つきのトークンで、
 *   - cookie が漏れても12時間で失効する
 *   - パスワード文字列自体は cookie に載らない
 *   - 検証は Web Crypto のみ = Edge (middleware) でも DB なしで検証できる
 *
 * 形式: "v1.<expiresAtEpochSec>.<base64url(HMAC("v1.<exp>"))>"
 * 鍵  : OPERATOR_SESSION_SECRET (未設定なら OPERATOR_PASSWORD から導出)。
 *       パスワードを変えれば全セッションが即失効する。
 */

export const OPERATOR_SESSION_COOKIE = "bondex_op_session"
export const OPERATOR_SESSION_TTL_SEC = 12 * 60 * 60 // 12時間

function secretString(): string | null {
  const s = process.env.OPERATOR_SESSION_SECRET?.trim() || process.env.OPERATOR_PASSWORD?.trim()
  return s || null
}

async function hmacKey(): Promise<CryptoKey | null> {
  const secret = secretString()
  if (!secret) return null
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`bondex-op-session:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  )
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4))
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function b64url(buf: ArrayBuffer): string {
  let s = ""
  const bytes = new Uint8Array(buf)
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * 署名つきセッショントークンを発行する。
 * credentialId を渡すと (パスキーでの入場) "v2.<exp>.<credential_id>.<sig>" になり、どの端末 (=どの運営者) が
 * 入ったかを持つ (B2C の手作業の運営者の識別に使う。docs/b2c/B2C_MVP_SCHEMA_v1.md 7章)。
 * 渡さなければ従来どおり "v1.<exp>.<sig>"。B2B の画面はどちらも同じに扱う。
 */
export async function issueOperatorSession(credentialId?: string): Promise<string | null> {
  const key = await hmacKey()
  if (!key) return null
  const exp = Math.floor(Date.now() / 1000) + OPERATOR_SESSION_TTL_SEC
  const payload =
    credentialId && CREDENTIAL_ID_RE.test(credentialId) ? `v2.${exp}.${credentialId}` : `v1.${exp}`
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
  return `${payload}.${b64url(sig)}`
}

const CREDENTIAL_ID_RE = /^[A-Za-z0-9_-]{16,512}$/

/** 検証済みのセッションの中身。v1 は credentialId=null。 */
async function parseOperatorSession(
  token: string | undefined | null,
): Promise<{ credentialId: string | null } | null> {
  if (!token) return null
  const m1 = /^v1\.(\d{10,})\.([A-Za-z0-9_-]{20,})$/.exec(token)
  const m2 = m1 ? null : /^v2\.(\d{10,})\.([A-Za-z0-9_-]{16,512})\.([A-Za-z0-9_-]{20,})$/.exec(token)
  if (!m1 && !m2) return null
  const exp = Number(m1 ? m1[1] : m2![1])
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null
  const key = await hmacKey()
  if (!key) return null
  const payload = m1 ? `v1.${m1[1]}` : `v2.${m2![1]}.${m2![2]}`
  const got = m1 ? m1[2] : m2![3]
  const expected = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
  // 比較は固定時間でなくてよい (HMAC の偽造には鍵が必要で、タイミングで縮まる探索空間がない)
  if (b64url(expected) !== got) return null
  return { credentialId: m2 ? m2[2] : null }
}

/** トークンを検証する (署名一致 + 未失効)。middleware (Edge) から呼ばれる。v1・v2 とも有効。 */
export async function verifyOperatorSession(token: string | undefined | null): Promise<boolean> {
  return (await parseOperatorSession(token)) !== null
}

/** パスキーで入った v2 のセッションなら、その端末の credential_id を返す (それ以外は null)。 */
export async function operatorSessionCredentialId(token: string | undefined | null): Promise<string | null> {
  return (await parseOperatorSession(token))?.credentialId ?? null
}

/**
 * WebAuthn のチャレンジも同じ鍵で署名した短命 cookie に載せる (サーバー側ストレージ不要)。
 * 形式: "c1.<expEpochSec>.<challenge(base64url)>.<sig>"
 */
export const OPERATOR_CHALLENGE_COOKIE = "bondex_op_challenge"
const CHALLENGE_TTL_SEC = 5 * 60

export async function issueChallengeToken(challenge: string): Promise<string | null> {
  const key = await hmacKey()
  if (!key) return null
  const exp = Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SEC
  const payload = `c1.${exp}.${challenge}`
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
  return `${payload}.${b64url(sig)}`
}

/** チャレンジ cookie を検証し、有効なら challenge を返す。 */
export async function verifyChallengeToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null
  const m = /^c1\.(\d{10,})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{20,})$/.exec(token)
  if (!m) return null
  const exp = Number(m[1])
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null
  const key = await hmacKey()
  if (!key) return null
  const payload = `c1.${m[1]}.${m[2]}`
  const expected = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
  if (b64url(expected) !== m[3]) return null
  return m[2]
}

/**
 * メール認証コード (パスキー登録時の本人確認・2026-08-31)。
 * 運営パスワードは Vercel 環境変数で人間が覚えていないため、人間の登録フローは
 * 「許可されたメールアドレス + 6桁コード」に置き換える (谷口さん指示: メアドと指紋で)。
 * 2026-11-04（Stage 6 B2）から、コードの照合と試行の回数は DB（sql/077）で行う。cookie はコードの記録を指すだけ
 * （下の issueEmailChallengeCookie。旧形式 "e1.…" の cookie は受け付けない＝コードを送り直してもらう）。
 */
export const OPERATOR_EMAIL_CODE_COOKIE = "bondex_op_emailcode"
const EMAIL_CODE_TTL_SEC = 10 * 60

function b64urlStr(s: string): string {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * メール認証コードの記録（sql/077 の operator_email_challenges）を指す cookie（2026-11-04 Stage 6 B2）。
 * 形式: "e2.<exp>.<記録の ID>.<base64url(email)>.<sig>"。コードは入れない（コードの照合と試行の回数は DB）。
 */
export async function issueEmailChallengeCookie(challengeId: string, email: string): Promise<string | null> {
  const key = await hmacKey()
  if (!key) return null
  const exp = Math.floor(Date.now() / 1000) + EMAIL_CODE_TTL_SEC
  const payload = `e2.${exp}.${challengeId}.${b64urlStr(email.trim().toLowerCase())}`
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
  return `${payload}.${b64url(sig)}`
}

/** cookie の署名と期限を確かめ、記録の ID とメールを返す（コードの照合は DB の関数）。 */
export async function readEmailChallengeCookie(token: string | undefined | null): Promise<{ challengeId: string; emailB64: string } | null> {
  if (!token) return null
  const m = /^e2\.(\d{10,})\.([0-9a-f-]{36})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{20,})$/.exec(token)
  if (!m) return null
  if (Number(m[1]) * 1000 < Date.now()) return null
  const key = await hmacKey()
  if (!key) return null
  const payload = `e2.${m[1]}.${m[2]}.${m[3]}`
  const ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(m[4]), new TextEncoder().encode(payload))
  return ok ? { challengeId: m[2], emailB64: m[3] } : null
}

export function emailB64(email: string): string {
  return b64urlStr(email.trim().toLowerCase())
}

/** DB に保存するコードの HMAC（コードそのものは保存しない）。記録の ID を混ぜるので、同じコードでも記録ごとに違う値になる。 */
export async function emailCodeHash(challengeId: string, code: string): Promise<string | null> {
  const key = await hmacKey()
  if (!key) return null
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`email-code:${challengeId}:${code}`))
  return b64url(sig)
}

