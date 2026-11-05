/**
 * 試験環境（staging）の誤接続の防止。`BONDEX_ENV=staging` の時だけ働く（それ以外は何もしない = 本番の動きは変わらない）。
 *
 * staging のアプリが本番の接続先・鍵・外への送信の設定を 1つでも持っていたら、起動（instrumentation.ts）と
 * DB・Stripe のクライアントの作成（lib/supabase.ts・lib/b2c/stripe.ts）で止める。推測で続けない。
 * 確かめること（docs/release/b2c_go_live_audit_20261105.md の Track B）:
 *   - Supabase は試験環境（oeucjrmuigtfnwowvzwr）だけ。本番（dscxftwfspgihkszfakk）なら止める
 *   - Stripe はテストモードの鍵だけ（sk_test_ / rk_test_ / pk_test_）
 *   - サイトの URL が本番のドメイン（bondex.express）ではない
 *   - メールは実際に送らない（MAIL_TEST_CAPTURE=1）。WhatsApp・LINE・Slack の送信の設定が無い
 *   - Ship&co・Biz-Logi・Google Drive・自動の発行の設定が無い
 * 値そのものはエラーの文に出さない（変数の名前と理由だけ）。
 */

export const PROD_SUPABASE_REF = "dscxftwfspgihkszfakk"
export const STAGING_SUPABASE_REF = "oeucjrmuigtfnwowvzwr"
const PROD_SITE_HOSTS = ["bondex.express", "www.bondex.express"]

type Env = Record<string, string | undefined>

function jwtRef(key: string | undefined): string | null {
  if (!key || key.split(".").length !== 3) return null
  try {
    let b64 = key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")
    while (b64.length % 4) b64 += "="
    // atob は Node と Edge の両方にある（Buffer は Edge に無い）
    const payload = JSON.parse(decodeURIComponent(escape(atob(b64))))
    return typeof payload.ref === "string" ? payload.ref : null
  } catch {
    return null
  }
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** staging の時の違反の一覧（変数の名前と理由だけ）。staging でなければ空。 */
export function stagingGuardViolations(env: Env = process.env): string[] {
  if (env.BONDEX_ENV !== "staging") return []
  const v: string[] = []
  const has = (k: string) => !!(env[k] && env[k]!.trim())
  const isTrue = (k: string) => env[k] === "true"

  // Supabase: 試験環境だけ
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  if (url.includes(PROD_SUPABASE_REF)) v.push("NEXT_PUBLIC_SUPABASE_URL: 本番の Supabase")
  else if (hostOf(url) !== `${STAGING_SUPABASE_REF}.supabase.co`) v.push("NEXT_PUBLIC_SUPABASE_URL: 試験環境の Supabase ではない")
  for (const k of ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    const val = env[k] ?? ""
    if (val.includes(PROD_SUPABASE_REF)) v.push(`${k}: 本番の ID を含む`)
    const ref = jwtRef(val)
    if (ref && ref !== STAGING_SUPABASE_REF) v.push(`${k}: 試験環境の鍵ではない`)
  }
  if (env.STAGING_SUPABASE_REF !== STAGING_SUPABASE_REF) v.push("STAGING_SUPABASE_REF: 試験環境の ID と一致しない")

  // Stripe: テストモードだけ
  const sk = env.STRIPE_SECRET_KEY ?? ""
  const pk = env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""
  if (sk && !/^(sk|rk)_test_/.test(sk)) v.push("STRIPE_SECRET_KEY: テストモードの鍵ではない")
  if (pk && !pk.startsWith("pk_test_")) v.push("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: テストモードの鍵ではない")
  if (isTrue("B2C_STRIPE_ALLOW_LIVE")) v.push("B2C_STRIPE_ALLOW_LIVE: 本番の鍵の許可は使わない")

  // サイトの URL: 本番のドメインではない
  for (const k of ["APP_BASE_URL", "B2C_SITE_URL"]) {
    const h = hostOf(env[k])
    if (h && PROD_SITE_HOSTS.includes(h)) v.push(`${k}: 本番のドメイン`)
  }

  // 外への送信: メールは送らない（記録だけ）・WhatsApp・LINE・Slack は無し
  if (env.MAIL_TEST_CAPTURE !== "1") v.push("MAIL_TEST_CAPTURE: 1 にする（メールを実際に送らない）")
  for (const k of ["WHATSAPP_CLOUD_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "LINE_CHANNEL_ACCESS_TOKEN", "SLACK_WEBHOOK_URL"]) {
    if (has(k)) v.push(`${k}: 試験環境では設定しない`)
  }
  if (isTrue("B2C_WHATSAPP_LIVE")) v.push("B2C_WHATSAPP_LIVE: 試験環境では ON にしない")
  // メールの送信の鍵は、本番の名前（RESEND_API_KEY・SMTP_*）では入れない（本番の鍵の流用を防ぐ）。
  // 社内の宛先だけの実送信（2026-11-06・lib/mailer.ts stagingInternalSendAllowed）は、staging 専用の鍵 STAGING_RESEND_API_KEY だけで行う
  for (const k of ["RESEND_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) {
    if (has(k)) v.push(`${k}: 試験環境では設定しない（社内への送信は STAGING_RESEND_API_KEY）`)
  }
  if (has("STAGING_MAIL_SEND")) {
    if (env.STAGING_MAIL_SEND !== "internal") v.push("STAGING_MAIL_SEND: internal 以外は使わない")
    if (!/^re_[A-Za-z0-9_]{8,}$/.test(env.STAGING_RESEND_API_KEY ?? "")) v.push("STAGING_RESEND_API_KEY: Resend の staging 専用の鍵（re_…）が要る")
    const list = (env.OPERATOR_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean)
    if (list.length === 0) v.push("OPERATOR_EMAILS: 社内への送信の宛先を明示する（既定のアドレスには送らない）")
    else if (!list.every((e) => /^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/.test(e))) v.push("OPERATOR_EMAILS: メールアドレスの形でない値がある")
  }

  // 配送の外部: Ship&co・Biz-Logi・Google Drive・自動の発行は無し
  for (const k of ["SHIPANDCO_API_KEY", "GOOGLE_DRIVE_SA_KEY", "BIZLOGI_BASE_URL", "BIZLOGI_CUSTOMER_ID", "BIZLOGI_LOGIN_PASSWORD"]) {
    if (has(k)) v.push(`${k}: 試験環境では設定しない`)
  }
  for (const k of ["SHIPANDCO_LIVE", "BIZLOGI_LIVE", "AUTO_ISSUE_ENABLED"]) {
    if (isTrue(k)) v.push(`${k}: 試験環境では ON にしない`)
  }
  return v
}

/** 違反があれば止める（エラーの文には変数の名前と理由だけを出す）。 */
export function assertEnvironmentSafe(env: Env = process.env): void {
  const v = stagingGuardViolations(env)
  if (v.length > 0) {
    throw new Error(`[env-guard] 試験環境の設定に問題があるため止めます（${v.length}件）: ${v.join(" / ")}`)
  }
}
