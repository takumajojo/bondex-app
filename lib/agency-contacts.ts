// 代理店の「通知メール(複数)」と「ログインユーザー(複数)」の管理ロジック。
//
// - 通知メール: agencies.contact_email(主) + agency_emails(追加)。通知はこの重複排除セットへ送る。
// - ユーザー:   user_agencies(user_id PK / agency_id 複数可) + Supabase Auth。
//              追加は招待リンク方式(generateLink 'invite' → アプリmailerで送信)。
//
// すべて service_role クライアント前提(RLSバイパス)。運営API・代理店セルフAPIの双方から使う。

import type { SupabaseClient } from "@supabase/supabase-js"
import { sendMail } from "@/lib/mailer"

const SITE_URL = "https://bondex.express"
const SUPPORT = "support@bondex.express"

export function normalizeEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : ""
}
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
}

// ── 通知メール ─────────────────────────────────────────────────────────────
export interface AgencyEmailRow {
  id: string
  email: string
  label: string | null
}

/** 代理店の主メール(contact_email)と追加メール一覧を返す。 */
export async function listAgencyEmails(
  sb: SupabaseClient,
  agencyId: string,
): Promise<{ primary: string | null; additional: AgencyEmailRow[] }> {
  const { data: ag } = await sb.from("agencies").select("contact_email").eq("id", agencyId).maybeSingle()
  const { data: rows } = await sb
    .from("agency_emails")
    .select("id, email, label")
    .eq("agency_id", agencyId)
    .order("created_at", { ascending: true })
  return {
    primary: (ag?.contact_email as string | null) ?? null,
    additional: (rows as AgencyEmailRow[] | null) ?? [],
  }
}

/** 追加メールを1件登録。主メールや既存追加との重複は弾く(成功時 duplicate=false)。 */
export async function addAgencyEmail(
  sb: SupabaseClient,
  agencyId: string,
  emailRaw: string,
  opts?: { label?: string | null; createdBy?: string | null },
): Promise<{ ok: boolean; error?: string; duplicate?: boolean }> {
  const email = normalizeEmail(emailRaw)
  if (!isValidEmail(email)) return { ok: false, error: "メールアドレスの形式が正しくありません" }

  const { primary, additional } = await listAgencyEmails(sb, agencyId)
  if (primary && normalizeEmail(primary) === email) return { ok: false, duplicate: true, error: "主メールと同じです" }
  if (additional.some((a) => normalizeEmail(a.email) === email)) return { ok: false, duplicate: true, error: "既に登録済みです" }

  const { error } = await sb
    .from("agency_emails")
    .insert({ agency_id: agencyId, email, label: opts?.label ?? null, created_by: opts?.createdBy ?? null })
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return { ok: false, duplicate: true, error: "既に登録済みです" }
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/** 追加メールを1件削除(その代理店のものだけ)。主メールは対象外。 */
export async function removeAgencyEmail(
  sb: SupabaseClient,
  agencyId: string,
  emailId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await sb.from("agency_emails").delete().eq("id", emailId).eq("agency_id", agencyId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** 通知の宛先(主+追加)を重複排除して返す。agency 名から解決。無ければ空配列。 */
export async function agencyRecipientEmails(sb: SupabaseClient, agencyName: string | null | undefined): Promise<string[]> {
  const name = (agencyName ?? "").trim()
  if (!name) return []
  const { data: ag } = await sb.from("agencies").select("id, contact_email").eq("name", name).maybeSingle()
  if (!ag) return []
  const { data: rows } = await sb.from("agency_emails").select("email").eq("agency_id", ag.id as string)
  const set = new Map<string, string>() // lower -> original(先勝ち)
  const push = (e?: string | null) => {
    const orig = (e ?? "").trim()
    const key = orig.toLowerCase()
    if (orig && !set.has(key)) set.set(key, orig)
  }
  push(ag.contact_email as string | null)
  for (const r of rows ?? []) push(r.email as string)
  return Array.from(set.values())
}

// ── ログインユーザー ────────────────────────────────────────────────────────
export interface AgencyUserRow {
  userId: string
  email: string | null
  createdAt: string | null
  lastSignInAt: string | null
}

/** email から Auth ユーザーを探す(小規模想定でページ走査)。無ければ null。 */
export async function findUserByEmail(sb: SupabaseClient, emailRaw: string): Promise<{ id: string; email: string | null } | null> {
  const email = normalizeEmail(emailRaw)
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 })
    if (error || !data?.users?.length) return null
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email)
    if (hit) return { id: hit.id, email: hit.email ?? null }
    if (data.users.length < 200) return null
  }
  return null
}

/** 代理店に紐づくログインユーザー一覧(email 付き)。 */
export async function listAgencyUsers(sb: SupabaseClient, agencyId: string): Promise<AgencyUserRow[]> {
  const { data: links } = await sb.from("user_agencies").select("user_id, created_at").eq("agency_id", agencyId)
  const out: AgencyUserRow[] = []
  for (const l of links ?? []) {
    const uid = l.user_id as string
    let email: string | null = null
    let lastSignInAt: string | null = null
    try {
      const { data } = await sb.auth.admin.getUserById(uid)
      email = data?.user?.email ?? null
      lastSignInAt = (data?.user?.last_sign_in_at as string | null) ?? null
    } catch {
      /* ユーザーが消えている等は無視 */
    }
    out.push({ userId: uid, email, createdAt: (l.created_at as string | null) ?? null, lastSignInAt })
  }
  return out
}

/**
 * 代理店へログインユーザーを1名招待する。
 *  - 新規メール: 'invite' リンクを発行し、アプリmailerで招待メール送信 → user_agencies 紐付け。
 *  - 既存メール: 既にアカウントがあれば user_agencies を紐付けるだけ(別代理店所属なら弾く)。
 */
export async function inviteAgencyUser(
  sb: SupabaseClient,
  agencyId: string,
  emailRaw: string,
  opts?: { agencyName?: string; locale?: "ja" | "en" },
): Promise<{ ok: boolean; error?: string; invited?: boolean; linkedExisting?: boolean }> {
  const email = normalizeEmail(emailRaw)
  if (!isValidEmail(email)) return { ok: false, error: "メールアドレスの形式が正しくありません" }

  const existing = await findUserByEmail(sb, email)
  if (existing) {
    // 既存アカウント: 所属を確認
    const { data: link } = await sb.from("user_agencies").select("agency_id").eq("user_id", existing.id).maybeSingle()
    if (link?.agency_id && link.agency_id !== agencyId) {
      return { ok: false, error: "このメールは既に別の代理店アカウントに紐づいています" }
    }
    if (!link) {
      const { error: linkErr } = await sb.from("user_agencies").insert({ user_id: existing.id, agency_id: agencyId })
      if (linkErr) return { ok: false, error: linkErr.message }
    }
    // 既存ユーザーには「追加された」通知のみ(パスワードは既存のまま)
    await sendMail({
      to: email,
      subject: "【BondEx】代理店ポータルにアクセスできるようになりました",
      text: [
        "BondEx 代理店ポータルへのアクセスが有効になりました。",
        "既存のパスワードでログインできます:",
        `${SITE_URL}/agency/login`,
        "",
        `パスワードが不明な場合は「パスワードをお忘れですか？」から再設定してください。`,
        "",
        `— BondEx / ${SUPPORT}`,
      ].join("\n"),
      replyTo: SUPPORT,
    }).catch(() => {})
    return { ok: true, linkedExisting: true }
  }

  // 新規: 招待リンクを発行(このAPIではメール送信はしない=リンクを取得してアプリmailerで送る)
  const { data, error } = await sb.auth.admin.generateLink({
    type: "invite",
    email,
    options: {
      data: { agency_name: opts?.agencyName ?? "" },
      redirectTo: `${SITE_URL}/agency/reset-password`,
    },
  })
  if (error || !data?.user) {
    const msg = error?.message || "invite link generation failed"
    if (/already|registered|exist/i.test(msg)) return { ok: false, error: "このメールは既に登録されています" }
    return { ok: false, error: msg }
  }
  const userId = data.user.id
  const actionLink = (data.properties as { action_link?: string } | null)?.action_link || `${SITE_URL}/agency/login`

  const { error: linkErr } = await sb.from("user_agencies").insert({ user_id: userId, agency_id: agencyId })
  if (linkErr) {
    // 紐付け失敗時は招待ユーザーを掃除(孤児防止)
    try { await sb.auth.admin.deleteUser(userId) } catch { /* best-effort */ }
    return { ok: false, error: linkErr.message }
  }

  const en = opts?.locale === "en"
  const sent = await sendMail({
    to: email,
    subject: en ? "[BondEx] You've been invited to the agency portal" : "【BondEx】代理店ポータルへの招待",
    text: en
      ? [
          `You have been invited to the BondEx agency portal${opts?.agencyName ? ` (${opts.agencyName})` : ""}.`,
          "Set your password using the link below (valid for a limited time):",
          actionLink,
          "",
          `After setting your password, sign in at ${SITE_URL}/agency/login`,
          "",
          `— BondEx / ${SUPPORT}`,
        ].join("\n")
      : [
          `BondEx 代理店ポータル${opts?.agencyName ? `（${opts.agencyName}）` : ""}へ招待されました。`,
          "下記リンクからパスワードを設定してください（有効期限があります）:",
          actionLink,
          "",
          `設定後は ${SITE_URL}/agency/login からログインできます。`,
          "",
          `— BondEx / ${SUPPORT}`,
        ].join("\n"),
    replyTo: SUPPORT,
  })
  if (!sent.sent) {
    // メールが送れない場合でもユーザー/紐付けは作成済み。運営がリンクを別途共有できるよう action_link を返す。
    return { ok: true, invited: true, error: `招待メール送信に失敗しました(${sent.error})。招待リンク: ${actionLink}` }
  }
  return { ok: true, invited: true }
}

/** 代理店からユーザーを外す(紐付け削除)。他代理店に紐づかない孤立ユーザーは Auth からも削除。 */
export async function removeAgencyUser(
  sb: SupabaseClient,
  agencyId: string,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await sb.from("user_agencies").delete().eq("user_id", userId).eq("agency_id", agencyId)
  if (error) return { ok: false, error: error.message }
  // どの代理店にも紐づかなくなったら Auth ユーザーも削除(孤児防止・best-effort)
  const { data: still } = await sb.from("user_agencies").select("user_id").eq("user_id", userId).maybeSingle()
  if (!still) {
    try { await sb.auth.admin.deleteUser(userId) } catch { /* best-effort */ }
  }
  return { ok: true }
}
