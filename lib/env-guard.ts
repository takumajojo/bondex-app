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
// 本番に届くホスト (2026-11-06 監査): 独自ドメインに加えて、本番の配置に付く Vercel の別名
// (bondex-poc-main.vercel.app は bondex.express への転送・残りの 2つは本番の配置そのもの)。
const PROD_SITE_HOSTS = [
  "bondex.express",
  "www.bondex.express",
  "bondex-poc-main.vercel.app",
  "bondex-poc-main-saxphonebaby-2794s-projects.vercel.app",
  "bondex-poc-main-git-main-saxphonebaby-2794s-projects.vercel.app",
]

/** 本番に届くホストか。bondex.express の下の名前はすべて本番として扱う (www 以外も、知らない名前で本番に届かせない)。 */
export function isProductionSiteHost(host: string | null | undefined): boolean {
  if (!host) return false
  return PROD_SITE_HOSTS.includes(host) || host.endsWith(".bondex.express")
}

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
    // 末尾の点 (bondex.express.) は同じホストに届くので外して比べる
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/\.+$/, "")
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
    if (h && isProductionSiteHost(h)) v.push(`${k}: 本番のドメイン`)
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

/**
 * 本番の配置か (2026-11-07 改訂)。本番は「Vercel の Production の配置」だけ。Vercel が入れる 3つ (VERCEL=1・VERCEL_ENV=production・
 * VERCEL_URL) がそろい、BONDEX_ENV が staging など本番以外を言っていない時だけ本番。
 *   - 変数 1つ (BONDEX_ENV=production や VERCEL_ENV=production だけ) では本番にしない。手元の道具が 1つの宣言で本番の資格情報を
 *     使える形にしない (谷口さんの指示)。手元で本番を操作する管理の道具は、アプリとは別の承認・認証の経路で行う
 *   - BONDEX_ENV=production は、Production の配置での食い違いの確かめ (production か無しのどちらか) にだけ使う
 *   - Vercel のシステム環境変数の自動の公開を無効にすると本番も起動しない (止まる側に倒す。公開は既定で ON のまま保つ)
 * 注意: これは誤設定・誤操作の防止で、本番の鍵を持つ人の意図的な偽装を防ぐものではない。本番の鍵は本番の配置の外に置かない。
 */
export function isProductionDeployment(env: Env = process.env): boolean {
  const bondex = env.BONDEX_ENV ?? ""
  if (bondex !== "" && bondex !== "production") return false
  return env.VERCEL === "1" && env.VERCEL_ENV === "production" && !!(env.VERCEL_URL ?? "").trim()
}

/**
 * 本番以外の「配置」か (Vercel の上・または BONDEX_ENV がある)。外への実際の処理 (請求・送り状・佐川への依頼・メール・
 * Slack・WhatsApp・LINE・Drive) をしない。手元の開発・試験 (Vercel の変数も BONDEX_ENV も無い) は対象外で、
 * そこで本番の資格情報を持っていれば undeclaredProductionCredentials が止める。
 * Vercel の上かは VERCEL・VERCEL_ENV・VERCEL_URL のどれかで見る。値が無い・空・知らない値は本番ではないとみなす (安全側)。
 */
export function isNonProductionDeployment(env: Env = process.env): boolean {
  if (isProductionDeployment(env)) return false
  const onVercel = env.VERCEL === "1" || env.VERCEL_ENV !== undefined || !!env.VERCEL_URL
  return onVercel || !!env.BONDEX_ENV
}

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"]
const isRealHost = (h: string | null) => !!h && !LOCAL_HOSTS.includes(h) && !h.endsWith(".invalid") && !h.endsWith(".test") && !h.endsWith(".localhost")

/**
 * 本番と宣言されていないのに、本番の資格情報 (見分けられるもの) を持っていれば、その理由 (変数の名前だけ)。
 * 環境の名前ではなく、接続先と鍵そのもので見る: Vercel のシステム環境変数が無効にされて Preview が「手元」に見えても、
 * 本番の Supabase の ID・Stripe の本番の鍵・実際の送り状・佐川への実際の依頼のスイッチがあれば止める。
 * 手元で本番を操作する道具は、このアプリの守りを通さず、別の承認・認証の経路で行う (BONDEX_ENV=production だけでは動かない)。
 */
export function undeclaredProductionCredentials(env: Env = process.env): string[] {
  if (isProductionDeployment(env)) return []
  const v: string[] = []
  const tail = "（本番の配置ではない: 本番は Vercel の Production の配置だけ）"
  if ((env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(PROD_SUPABASE_REF)) v.push(`NEXT_PUBLIC_SUPABASE_URL: 本番の Supabase${tail}`)
  for (const k of ["SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) {
    const val = env[k] ?? ""
    if (val.includes(PROD_SUPABASE_REF) || jwtRef(val) === PROD_SUPABASE_REF) v.push(`${k}: 本番の鍵${tail}`)
  }
  if (/^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? "")) v.push(`STRIPE_SECRET_KEY: Stripe の本番の鍵${tail}`)
  if ((env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "").startsWith("pk_live_")) v.push(`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: Stripe の本番の鍵${tail}`)
  if (env.SHIPANDCO_LIVE === "true" && (env.SHIPANDCO_API_KEY ?? "").trim()) v.push(`SHIPANDCO_LIVE: 実際の送り状の発行${tail}`)
  if (env.BIZLOGI_LIVE === "true" && env.BIZLOGI_ENV === "production" && isRealHost(hostOf(env.BIZLOGI_BASE_URL))) v.push(`BIZLOGI_LIVE: 佐川への実際の依頼${tail}`)
  return v
}

/**
 * Preview・Development の配置の設定の違反 (2026-11-07)。本番の配置以外は、staging と同じ条件を満たさないと動かさない:
 *   - BONDEX_ENV=staging (メールの記録だけ・社内だけの送信などの staging の動きにする)
 *   - stagingGuardViolations の全部 (試験環境の Supabase・テストモードの Stripe・メールを送らない・Slack・WhatsApp・LINE・
 *     Ship&co・Biz-Logi・Google Drive の鍵が無い・本番のドメインを使わない)
 *   - APP_BASE_URL を必ず入れる (無いと自分自身を呼ぶ処理が本番のドメイン bondex.express を運営のパスワードつきで呼ぶ)
 * 環境の名前だけでなく、接続先 (Supabase の ID・Stripe の鍵の種類) と鍵の有無を照らし合わせる。値はエラーの文に出さない。
 */
export function previewEnvironmentViolations(env: Env = process.env): string[] {
  if (!isNonProductionDeployment(env)) return []
  const v: string[] = []
  if (env.BONDEX_ENV !== "staging") v.push("BONDEX_ENV: Preview・Development は staging にする（本番の設定のまま動かさない）")
  for (const x of stagingGuardViolations({ ...env, BONDEX_ENV: "staging" })) v.push(x)
  const base = hostOf(env.APP_BASE_URL)
  if (!base) v.push("APP_BASE_URL: Preview・Development では必ず入れる（無いと本番のドメインを呼ぶ）")
  return v
}

/**
 * 自分自身を呼ぶ時の公開の URL (運営のパスワードを Bearer で載せる呼び出し)。本番の配置は今までどおり APP_BASE_URL → bondex.express。
 * Preview・Development では本番のドメインを決して使わない (本番のパスワードで本番の送り状の発行・Drive の同期を動かさない)。
 */
export function selfBaseUrl(env: Env = process.env): string {
  const u = env.APP_BASE_URL?.trim().replace(/\/+$/, "")
  if (isNonProductionDeployment(env)) {
    const h = hostOf(u)
    if (!u || !h || isProductionSiteHost(h)) throw new Error("[env-guard] Preview・Development では本番のドメインを呼びません（APP_BASE_URL に本番以外の URL が要ります）")
    return u
  }
  return u || "https://bondex.express"
}

/**
 * お客さまに送るリンク (My Booking・フロント・支払い) の公開の URL (2026-11-06 監査)。本番の配置は今までどおり B2C_SITE_URL → bondex.express。
 * Preview・staging では本番のドメインのリンクを作らない: B2C_SITE_URL に本番以外の URL が無ければ例外 (送る側で止める)。
 */
export function b2cSiteBaseUrl(env: Env = process.env): string {
  const u = env.B2C_SITE_URL?.trim().replace(/\/+$/, "")
  if (isNonProductionDeployment(env)) {
    const h = hostOf(u)
    if (!u || !h || isProductionSiteHost(h)) throw new Error("[env-guard] Preview・staging では本番のドメインのリンクを作りません（B2C_SITE_URL に本番以外の URL が要ります）")
    return u
  }
  return u || "https://bondex.express"
}

/** 起動・実行を止める理由の全部 (変数の名前と理由だけ・重なりはまとめる)。空なら問題なし。 */
export function environmentViolations(env: Env = process.env): string[] {
  return [...new Set([...stagingGuardViolations(env), ...previewDatabaseViolations(env), ...previewEnvironmentViolations(env), ...undeclaredProductionCredentials(env)])]
}

/**
 * Preview・Development の配置が本番の Supabase に接続しようとしていれば、その理由 (変数の名前だけ)。
 * service_role の鍵は RLS を通らないので、Preview から本番の予約・集荷依頼・請求の行を書き換えられてしまう。
 * 本番の DB を読む・書く処理は、本番の配置 (VERCEL_ENV=production) だけに限る。
 */
export function previewDatabaseViolations(env: Env = process.env): string[] {
  if (!isNonProductionDeployment(env)) return []
  const v: string[] = []
  if ((env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(PROD_SUPABASE_REF)) v.push("NEXT_PUBLIC_SUPABASE_URL: 本番の Supabase")
  const ref = jwtRef(env.SUPABASE_SERVICE_ROLE_KEY)
  if ((env.SUPABASE_SERVICE_ROLE_KEY ?? "").includes(PROD_SUPABASE_REF) || ref === PROD_SUPABASE_REF) v.push("SUPABASE_SERVICE_ROLE_KEY: 本番の鍵")
  return v
}

/**
 * 外への実際の処理 (請求・送り状・佐川への依頼・メール・Slack・WhatsApp・LINE・Drive) を止めるか。
 * 本番以外の配置か、止める理由 (environmentViolations) が 1つでもある時。起動の守りを通り越しても、実行の時にここで止まる。
 */
export function externalEffectsBlocked(env: Env = process.env): boolean {
  return isNonProductionDeployment(env) || environmentViolations(env).length > 0
}

/** 違反があれば止める（エラーの文には変数の名前と理由だけを出す）。 */
export function assertEnvironmentSafe(env: Env = process.env): void {
  const v = environmentViolations(env)
  if (v.length > 0) {
    throw new Error(`[env-guard] 試験環境・Preview の設定に問題があるため止めます（${v.length}件）: ${v.join(" / ")}`)
  }
}
