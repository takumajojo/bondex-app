import type { NextRequest } from "next/server"
import { getSupabase } from "@/lib/supabase"

export interface AgencyRecord {
  id: string
  name: string
  contact_email: string | null
  status: string | null
  payment_method: string | null
  stripe_customer_id: string | null
  card_on_file: boolean | null
  is_domestic: boolean | null
}

/**
 * 代理店ユーザーのリクエストから、本人の agency レコードを解決する。
 *
 * クライアントは Authorization: Bearer <Supabase access token> を送る。
 * service_role クライアントで getUser(jwt) してトークンを検証 → user_agencies →
 * agencies を引く。認証・紐付けが無ければ null。
 *
 * 用途: 代理店本人のみが自社の Stripe カード登録を操作できるようにするゲート。
 */
export async function resolveAgencyFromRequest(
  req: NextRequest,
): Promise<{ userId: string; agency: AgencyRecord } | null> {
  const authHeader = req.headers.get("authorization") || ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
  if (!token) return null

  const sb = getSupabase()
  if (!sb) return null

  const { data: userData, error: userErr } = await sb.auth.getUser(token)
  if (userErr || !userData?.user) return null
  const userId = userData.user.id

  const { data: link } = await sb
    .from("user_agencies")
    .select("agency_id")
    .eq("user_id", userId)
    .maybeSingle()
  const agencyId = (link as { agency_id?: string } | null)?.agency_id
  if (!agencyId) return null

  const { data: agency } = await sb
    .from("agencies")
    .select("id, name, contact_email, status, payment_method, stripe_customer_id, card_on_file, is_domestic")
    .eq("id", agencyId)
    .maybeSingle()
  if (!agency) return null

  return { userId, agency: agency as AgencyRecord }
}
