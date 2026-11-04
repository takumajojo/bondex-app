/**
 * 運営のパスキーの登録の本人確認（メールの 6桁のコード）の発行と照合（Stage 6 の Blocker B2・sql/077）。
 *
 * - 試行の回数・無効化・1回限りは DB の関数（operator_email_challenge_issue / _attempt）が行をロックして決める。
 *   端末・IP の回数の制限（lib/rate-limit.ts）はその前の補助。
 * - cookie にはコードの記録の ID とメールの署名だけを入れる。コードは cookie にも DB にも入れない（DB は HMAC だけ）。
 * - 記録の表が無い DB（sql/077 の適用前）では、メールのコードでの登録はできない（安全側）。運営のパスワードでの登録・
 *   登録済みのパスキーのログインには関係しない。
 */
import { getSupabase } from "@/lib/supabase"
import { emailB64, emailCodeHash, issueEmailChallengeCookie, readEmailChallengeCookie } from "@/lib/operator-session"

export type IssueResult = { ok: true; cookie: string } | { ok: false; reason: "locked_out" | "rate_limited" | "unavailable" }
export type AttemptResult = "ok" | "wrong" | "locked" | "used" | "superseded" | "expired" | "not_found" | "unavailable"

/** DB の関数を呼ぶ口（試験では独立した DB に差し替える） */
export type ChallengeRpc = (fn: "operator_email_challenge_issue" | "operator_email_challenge_attempt", args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>

const supabaseRpc: ChallengeRpc = async (fn, args) => {
  const sb = getSupabase()
  if (!sb) return { data: null, error: "not_configured" }
  const { data, error } = await sb.rpc(fn, args)
  return { data, error }
}

/** 6桁のコード（暗号乱数） */
export function newEmailCode(): string {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return String(buf[0] % 1_000_000).padStart(6, "0")
}

export async function issueEmailChallenge(email: string, code: string, rpc: ChallengeRpc = supabaseRpc, now: Date = new Date()): Promise<IssueResult> {
  const id = crypto.randomUUID()
  const hash = await emailCodeHash(id, code)
  if (!hash) return { ok: false, reason: "unavailable" }
  const { data, error } = await rpc("operator_email_challenge_issue", { p_id: id, p_email: email.trim().toLowerCase(), p_code_hash: hash, p_now: now.toISOString() })
  if (error) return { ok: false, reason: "unavailable" }
  if (data === "locked_out" || data === "rate_limited") return { ok: false, reason: data }
  if (data !== "issued") return { ok: false, reason: "unavailable" }
  const cookie = await issueEmailChallengeCookie(id, email)
  return cookie ? { ok: true, cookie } : { ok: false, reason: "unavailable" }
}

/**
 * コードを照合する。consume=false は登録の第1段（確認だけ）、true は第2段（使い切る）。
 * cookie の署名・メールの一致を確かめてから DB の関数で数える（失敗は 5回まで・成功の後は使えない）。
 */
export async function attemptEmailCode(cookie: string | undefined | null, email: string, code: string, consume: boolean, rpc: ChallengeRpc = supabaseRpc, now: Date = new Date()): Promise<AttemptResult> {
  const c = await readEmailChallengeCookie(cookie)
  if (!c || c.emailB64 !== emailB64(email)) return "not_found"
  if (!/^\d{6}$/.test(code)) return "wrong"
  const hash = await emailCodeHash(c.challengeId, code)
  if (!hash) return "unavailable"
  const { data, error } = await rpc("operator_email_challenge_attempt", { p_id: c.challengeId, p_email: email.trim().toLowerCase(), p_code_hash: hash, p_consume: consume, p_now: now.toISOString() })
  if (error) return "unavailable"
  return (["ok", "wrong", "locked", "used", "superseded", "expired", "not_found"].includes(String(data)) ? data : "unavailable") as AttemptResult
}

/** 画面に出す文（コードの正誤以外は区別しすぎない） */
export function attemptMessage(r: AttemptResult): string {
  switch (r) {
    case "locked":
      return "認証コードを 5回間違えたため、このコードは使えなくなりました。しばらく時間をおいてから、もう一度コードを送信してください。"
    case "used":
      return "この認証コードは使用済みです。もう一度コードを送信してください。"
    case "unavailable":
      return "認証の処理ができませんでした。時間をおいてから、もう一度お試しください。"
    default:
      return "認証コードが正しくないか、有効期限が切れています。もう一度コードを送信してください。"
  }
}
