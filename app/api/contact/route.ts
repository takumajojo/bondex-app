import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"
import { sendMail } from "@/lib/mailer"
import { notifyBondEx } from "@/lib/notify"

export const runtime = "nodejs"

const NOTIFY_TO = process.env.ALERT_EMAIL || "support@bondex.express"

interface Body {
  company?: unknown
  name?: unknown
  email?: unknown
  message?: unknown
  // ── スパム対策フィールド ──
  website?: unknown // ハニーポット (人間は空。ボットが埋めたら破棄)
  elapsedMs?: unknown // フォーム表示から送信までの経過ms (速すぎる=ボット)
  turnstileToken?: unknown // Cloudflare Turnstile トークン (キー設定時のみ検証)
}

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

// 簡易メール形式チェック (RFC 完全準拠は不要 — 明らかな不正のみ弾く)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// フォーム入力に人が要する最小時間。これ未満での送信は自動投稿とみなす。
const MIN_FILL_MS = 2500
// 同一人物(正規化メール)の連投とみなす間隔。ドット違いの連続スパム対策。
const DEDUP_WINDOW_MIN = 10

/**
 * メール正規化。Gmail は local 部のドットを無視し "+タグ" も同一アカウントに届くため、
 * "frs.i.s..lau.r.a@gmail.com" と "frsislaura@gmail.com" を同一として扱えるようにする
 * (ボットがドット違いで重複判定を回避してくるのを潰す)。
 */
function normalizeEmail(email: string): string {
  const lower = email.toLowerCase()
  const at = lower.lastIndexOf("@")
  if (at < 0) return lower
  let local = lower.slice(0, at)
  const domain = lower.slice(at + 1)
  local = local.split("+")[0]
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return `${local.replace(/\./g, "")}@gmail.com`
  }
  return `${local}@${domain}`
}

/**
 * Cloudflare Turnstile 検証。TURNSTILE_SECRET_KEY 未設定なら null を返して素通し
 * (キーを入れるまで既存動作を壊さない)。設定済みなら true/false を返す。
 */
async function verifyTurnstile(token: string, ip: string | null): Promise<boolean | null> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return null // 未設定 = 検証しない
  if (!token) return false
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

async function notify(input: {
  company: string
  name: string
  email: string
  message: string
}): Promise<void> {
  // SMTP優先 / Resendフォールバック。未設定なら送らない (DBには保存済み)。
  const r = await sendMail({
    to: NOTIFY_TO,
    replyTo: input.email,
    subject: `【BondEx】新規お問い合わせ（${input.company || input.name || input.email}）`,
    text: [
      `会社名: ${input.company || "—"}`,
      `お名前: ${input.name || "—"}`,
      `メール: ${input.email}`,
      "",
      "ご相談内容:",
      input.message,
    ].join("\n"),
  })
  if (!r.sent) console.log("[contact] 通知メール未送信:", r.error, "(DB保存済み)")

  // 社内通知(Slack集約)
  await notifyBondEx({
    kind: "contact",
    title: input.company || input.name || input.email,
    lines: [
      input.name ? `お名前: ${input.name}` : "",
      `メール: ${input.email}`,
      `内容: ${input.message.length > 200 ? input.message.slice(0, 200) + "…" : input.message}`,
    ],
  })
}

export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "contact")
  if (!limit.ok) return limit.response

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const company = s(body.company)
  const name = s(body.name)
  const email = s(body.email)
  const message = s(body.message)

  // ── スパム破棄はすべて「成功」を装って静かに捨てる (ボットに検知させない) ──
  const dropSilently = () => NextResponse.json({ ok: true })

  // 1) ハニーポット: 隠しフィールドに値が入っていたら自動投稿。
  if (s(body.website)) {
    console.log("[contact] honeypot に反応 — 破棄")
    return dropSilently()
  }

  // 2) 送信タイマー: フォーム表示から極端に早い送信は自動投稿。
  const elapsedMs = typeof body.elapsedMs === "number" ? body.elapsedMs : Number(body.elapsedMs)
  if (Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs < MIN_FILL_MS) {
    console.log("[contact] 送信が速すぎ (", elapsedMs, "ms) — 破棄")
    return dropSilently()
  }

  // 3) Cloudflare Turnstile (キー設定時のみ)。
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null
  const turnstile = await verifyTurnstile(s(body.turnstileToken), ip)
  if (turnstile === false) {
    return NextResponse.json({ error: "認証に失敗しました。ページを再読み込みしてお試しください。" }, { status: 400 })
  }

  // ── 通常のバリデーション ──
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "有効なメールアドレスをご入力ください。" }, { status: 400 })
  }
  if (!message) {
    return NextResponse.json({ error: "ご相談内容をご入力ください。" }, { status: 400 })
  }
  if (message.length > 5000) {
    return NextResponse.json({ error: "ご相談内容が長すぎます。" }, { status: 400 })
  }

  const normalizedEmail = normalizeEmail(email)

  // 1) DB 保存 (best-effort — 未設定でも通知は試みる)
  const sb = getSupabase()
  if (sb) {
    // 4) 連投ブロック: 同一(正規化)メールが直近に投稿していれば静かに破棄。
    //    Gmail のドット違いを使った反復スパムをここで潰す。
    try {
      const since = new Date(Date.now() - DEDUP_WINDOW_MIN * 60_000).toISOString()
      const { data: recent } = await sb
        .from("contact_inquiries")
        .select("email")
        .gte("created_at", since)
        .limit(100)
      if (Array.isArray(recent) && recent.some((r) => normalizeEmail(s((r as { email?: string }).email)) === normalizedEmail)) {
        console.log("[contact] 直近の連投 (正規化メール一致) — 破棄:", normalizedEmail)
        return dropSilently()
      }
    } catch {
      /* 重複チェック失敗は通常フローを止めない */
    }

    const { error } = await sb.from("contact_inquiries").insert({
      company: company || null,
      name: name || null,
      email,
      message,
      source: "lp",
      user_agent: req.headers.get("user-agent")?.slice(0, 400) ?? null,
    })
    if (error) {
      console.error("[contact] Supabase insert 失敗:", error.message)
    }
  } else {
    console.log("[contact] Supabase 未設定 — 受信内容:", { company, name, email })
  }

  // 2) 通知メール (best-effort)
  await notify({ company, name, email, message })

  return NextResponse.json({ ok: true })
}
