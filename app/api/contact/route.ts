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
}

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

// 簡易メール形式チェック (RFC 完全準拠は不要 — 明らかな不正のみ弾く)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "有効なメールアドレスをご入力ください。" }, { status: 400 })
  }
  if (!message) {
    return NextResponse.json({ error: "ご相談内容をご入力ください。" }, { status: 400 })
  }
  if (message.length > 5000) {
    return NextResponse.json({ error: "ご相談内容が長すぎます。" }, { status: 400 })
  }

  // 1) DB 保存 (best-effort — 未設定でも通知は試みる)
  const sb = getSupabase()
  if (sb) {
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
