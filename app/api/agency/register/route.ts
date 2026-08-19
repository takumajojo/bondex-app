import { NextRequest, NextResponse } from "next/server"
import { rateLimit } from "@/lib/rate-limit"
import { getSupabase } from "@/lib/supabase"
import { ensureAgencyFolder } from "@/lib/google-drive"
import { sendMail } from "@/lib/mailer"
import { notifyBondEx } from "@/lib/notify"

export const runtime = "nodejs"

/**
 * 代理店セルフ会員登録 (公開)。
 *   POST /api/agency/register
 *   body: { email, password, agencyName, contactPerson?, country?, isDomestic, paymentMethod, phone? }
 *
 * service_role で以下を作成する:
 *   1. Supabase Auth ユーザー (email_confirm=true → すぐログイン可)
 *   2. agencies 行 (status='pending', created_via='self_signup')
 *   3. user_agencies 紐付け
 *
 * ゲート方針:
 *   - 誰でも登録できるが status='pending' で作成 → BondEx が /operator で承認するまで
 *     バウチャー発行はできない (無審査発行の防止)。
 *   - 海外 (isDomestic=false) は paymentMethod='card' のみ許可。
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

export async function POST(req: NextRequest) {
  const limit = rateLimit(req, "agency-register")
  if (!limit.ok) return limit.response

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const email = s(body.email).toLowerCase()
  const password = typeof body.password === "string" ? body.password : ""
  const agencyName = s(body.agencyName)
  const contactPerson = s(body.contactPerson)
  const country = s(body.country)
  const phone = s(body.phone)
  const isDomestic = body.isDomestic !== false // 明示 false 以外は国内扱い
  const rawPayment = s(body.paymentMethod)
  const paymentMethod = rawPayment === "card" ? "card" : rawPayment === "invoice" ? "invoice" : ""

  // --- バリデーション ---
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "有効なメールアドレスをご入力ください。" }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "パスワードは 8 文字以上でご設定ください。" }, { status: 400 })
  }
  if (!agencyName) {
    return NextResponse.json({ error: "貴社名をご入力ください。" }, { status: 400 })
  }
  if (!paymentMethod) {
    return NextResponse.json({ error: "お支払い方法をお選びください。" }, { status: 400 })
  }
  // 地域ルール: 海外は card のみ
  if (!isDomestic && paymentMethod === "invoice") {
    return NextResponse.json(
      { error: "海外のお客様は請求書払いをご選択いただけません。カード払いをお選びください。" },
      { status: 400 },
    )
  }

  const sb = getSupabase()
  if (!sb) {
    return NextResponse.json(
      { error: "登録機能は現在準備中です。BondEx サポートまでご連絡ください。" },
      { status: 503 },
    )
  }

  // 会社名の重複チェック (agencies.name は unique)
  const { data: existing } = await sb
    .from("agencies")
    .select("id")
    .eq("name", agencyName)
    .maybeSingle()
  if (existing) {
    return NextResponse.json(
      { error: "同名の代理店が既に登録されています。別の表記か BondEx サポートにご確認ください。" },
      { status: 409 },
    )
  }

  // 1) Auth ユーザー作成
  const { data: created, error: authErr } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { agency_name: agencyName },
  })
  if (authErr || !created?.user) {
    const msg = authErr?.message || "アカウント作成に失敗しました。"
    // メール重複などは 409 相当
    const status = /already|exist|registered/i.test(msg) ? 409 : 400
    const friendly = status === 409 ? "このメールアドレスは既に登録されています。" : msg
    return NextResponse.json({ error: friendly }, { status })
  }
  const userId = created.user.id

  // 2) agencies 行
  const { data: agency, error: agErr } = await sb
    .from("agencies")
    .insert({
      name: agencyName,
      contact_email: email,
      contact_person: contactPerson || null,
      contact_phone: phone || null,
      country: country || (isDomestic ? "JP" : null),
      is_domestic: isDomestic,
      payment_method: paymentMethod,
      status: "pending",
      created_via: "self_signup",
    })
    .select("id")
    .single()

  if (agErr || !agency) {
    // 作成した auth ユーザーを掃除 (孤児防止)
    try { await sb.auth.admin.deleteUser(userId) } catch { /* best-effort */ }
    return NextResponse.json(
      { error: `代理店情報の登録に失敗しました (${agErr?.message ?? "unknown"})` },
      { status: 500 },
    )
  }

  // 3) user_agencies 紐付け
  const { error: linkErr } = await sb
    .from("user_agencies")
    .insert({ user_id: userId, agency_id: agency.id })
  if (linkErr) {
    // 掃除 (agency + auth user)
    try { await sb.from("agencies").delete().eq("id", agency.id) } catch { /* best-effort */ }
    try { await sb.auth.admin.deleteUser(userId) } catch { /* best-effort */ }
    return NextResponse.json(
      { error: `アカウントの紐付けに失敗しました (${linkErr.message})` },
      { status: 500 },
    )
  }

  // 4) 共有ドライブに代理店フォルダを用意 (best-effort・失敗しても登録は成功させる)
  try {
    await ensureAgencyFolder(agencyName)
  } catch {
    /* Drive 未設定・失敗は無視 */
  }

  // 5) 通知メール (best-effort・失敗しても登録は成功させる)。
  //    ① BondEx 運用へ「承認待ちの新規代理店」通知（承認漏れ防止）
  //    ② 代理店へ受付確認（承認をお待ちいただく案内）
  try {
    const opsTo = process.env.ALERT_EMAIL || "support@bondex.express"
    await sendMail({
      to: opsTo,
      replyTo: email,
      subject: `【BondEx】新規代理店の登録（承認待ち）: ${agencyName}`,
      text: [
        "新しい代理店がセルフ登録しました。運営画面で承認してください。",
        "",
        `代理店名　：${agencyName}`,
        `連絡先　　：${email}`,
        contactPerson ? `ご担当者　：${contactPerson}` : "",
        phone ? `電話　　　：${phone}` : "",
        `区分　　　：${isDomestic ? "国内" : "海外"} ／ 決済：${paymentMethod}`,
        "",
        "▼ 承認はこちら",
        "https://bondex.express/operator/agencies",
      ]
        .filter(Boolean)
        .join("\n"),
    })
    await sendMail({
      to: email,
      replyTo: opsTo,
      subject: "【BondEx】ご登録ありがとうございます（承認をお待ちください）",
      text: [
        `${agencyName} 御中`,
        "",
        "平素より大変お世話になっております。BondEx（株式会社JOJO）でございます。",
        "このたびはBondExへのご登録、誠にありがとうございます。",
        "",
        "内容を確認のうえ、担当者が承認いたします。承認完了後、ログインして発行依頼をご利用いただけます。",
        "（初回のご利用前に、契約書へのご署名をお願いしております。）",
        "",
        "ご不明な点は support@bondex.express までお気軽にお問い合わせください。",
        "",
        "━━━━━━━━━━━━━━━━━━",
        "BondEx（手荷物配送手配サービス）／ 株式会社JOJO",
        "Web  : https://bondex.express",
        "Mail : support@bondex.express",
        "━━━━━━━━━━━━━━━━━━",
      ].join("\n"),
    })
  } catch (e) {
    console.error("[agency/register] 通知メール失敗:", e instanceof Error ? e.message : e)
  }

  // 社内通知(Slack集約) — 承認待ちの新規代理店を1部屋に流す(承認漏れ防止)。
  await notifyBondEx({
    kind: "agency",
    title: `${agencyName}（承認待ち）`,
    lines: [
      `連絡先: ${email}`,
      contactPerson ? `ご担当者: ${contactPerson}` : "",
      `区分: ${isDomestic ? "国内" : "海外"} ／ 決済: ${paymentMethod}`,
    ],
    link: `/operator/agencies`,
    linkLabel: "承認画面を開く",
  })

  return NextResponse.json({ ok: true, paymentMethod, status: "pending" })
}
