import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * Supabase クライアント (server-side only).
 *
 * service_role キーを使うので **絶対にクライアント側で import しないこと**.
 * API route (Node runtime) 内でのみ使用する.
 *
 * RLS は当面 OFF にしているため (middleware 認証で守られている), service_role で全権限.
 * Phase B (代理店別ログイン) で RLS 有効化したら anon key + JWT に切り替える.
 */

let _client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient | null {
  if (_client) return _client

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null

  _client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _client
}

/** Supabase 設定の有無を返す (UI の表示分岐用) */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  )
}
