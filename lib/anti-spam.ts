// 公開フォームの自動投稿(ボット)対策の共通ヘルパー。contact / signup 等で共用する。
// 多層防御: ①honeypot(隠しフィールド) ②送信タイマー ③Cloudflare Turnstile。

// 人がフォーム入力に要する最小時間(ms)。これ未満での送信は自動投稿とみなす。
export const MIN_FILL_MS = 2500

/**
 * honeypot(隠しフィールド website)が埋まっている、または送信が速すぎる場合は
 * 自動投稿(ボット)とみなす。true のとき、呼び出し側は「成功を装って静かに破棄」する
 * (ボットに検知させないため、エラーではなく成功レスポンスを返すのが定石)。
 */
export function looksAutomated(body: { website?: unknown; elapsedMs?: unknown }): boolean {
  const website = typeof body.website === "string" ? body.website.trim() : ""
  if (website) return true
  const elapsed = typeof body.elapsedMs === "number" ? body.elapsedMs : Number(body.elapsedMs)
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_FILL_MS) return true
  return false
}

/**
 * Cloudflare Turnstile 検証。
 *   null  = 検証しない (TURNSTILE_SECRET_KEY 未設定、またはトークン無し=ウィジェット未描画/失敗)
 *   true  = 検証成功
 *   false = トークンはあるが無効 → 呼び出し側で拒否する
 * トークン無しを null にするフェイルセーフにより、ウィジェット不調でもフォームを詰まらせない
 * (その場合も honeypot / 送信タイマーは有効)。
 */
export async function verifyTurnstile(token: string, ip: string | null): Promise<boolean | null> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return null
  if (!token) return null
  try {
    const form = new URLSearchParams()
    form.set("secret", secret)
    form.set("response", token)
    if (ip) form.set("remoteip", ip)
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    })
    const data = (await res.json().catch(() => ({}))) as { success?: boolean }
    return data.success === true
  } catch {
    return false
  }
}

/** リクエストヘッダーからクライアント IP を推定 (Turnstile の remoteip 用・best-effort)。 */
export function clientIp(req: { headers: { get(name: string): string | null } }): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null
}
