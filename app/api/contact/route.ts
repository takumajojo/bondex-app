import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"

export const runtime = "nodejs"

const NOTIFY_TO = process.env.ALERT_EMAIL || "support@bondex.express"
const NOTIFY_FROM = process.env.ALERT_FROM_EMAIL || "BondEx <alerts@bondex.express>"

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

async function notifyViaResend(input: {
  company: string
  name: string
  email: string
  message: string
}): Promise<void> {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    // 未設定なら通知はスキップ (DB には保存済みなので取りこぼさない)
    console.log("[contact] Resend 未設定 — DB 保存のみ:", { email: input.email })
    return
  }
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: NOTIFY_FROM,
        to: [NOTIFY_TO],
        reply_to: input.email,
        subject: `[BondEx] 導入相談 — ${input.company || input.name || input.email}`,
        text: [
          `会社名: ${input.company || "—"}`,
          `お名前: ${input.name || "—"}`,
          `メール: ${input.email}`,
          "",
          "ご相談内容:",
          input.message,
        ].join("\n"),
      }),
    })
  } catch (err) {
    // 通知失敗は致命的でない (DB に残る)
    console.error("[contact] Resend 送信失敗:", err instanceof Error ? err.message : err)
  }
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
  await notifyViaResend({ company, name, email, message })

  return NextResponse.json({ ok: true })
}
