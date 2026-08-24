// 団体ダッシュボードの期限付き共有リンク (添乗員用)。
// トークンは URL に載る秘密 — 推測不能なランダム値のみ。サーバー(service_role)専用。
import { randomBytes } from "node:crypto"
import { getSupabase } from "./supabase"

export interface GroupShare {
  token: string
  booking_id: string
  expires_at: string
  created_by: string
  revoked_at: string | null
  created_at: string
}

export function newShareToken(): string {
  return randomBytes(24).toString("base64url") // 32文字・URLセーフ
}

export async function createGroupShare(
  bookingId: string,
  days: number,
  createdBy: string,
): Promise<{ ok: boolean; token?: string; expiresAt?: string; error?: string }> {
  const sb = getSupabase()
  if (!sb) return { ok: false, error: "Supabase not configured" }
  const token = newShareToken()
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString()
  const { error } = await sb.from("group_shares").insert({
    token,
    booking_id: bookingId,
    expires_at: expiresAt,
    created_by: createdBy,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, token, expiresAt }
}

/** token を検証して booking_id を返す (無効/期限切れ/失効は null)。 */
export async function resolveShareToken(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null
  const sb = getSupabase()
  if (!sb) return null
  const { data } = await sb
    .from("group_shares")
    .select("booking_id, expires_at, revoked_at")
    .eq("token", token)
    .maybeSingle()
  if (!data) return null
  if (data.revoked_at) return null
  if (new Date(data.expires_at).getTime() < Date.now()) return null
  return data.booking_id as string
}
