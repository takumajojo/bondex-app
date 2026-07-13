import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * Supabase クライアント (server-side only).
 *
 * service_role キーを使うので **絶対にクライアント側で import しないこと**.
 * API route (Node runtime) 内でのみ使用する. service_role は RLS を bypass する。
 *
 * 重要: 代理店ポータル (shipments/agencies/user_agencies) の RLS は **本番で有効** に
 * なっている (sql/002_agencies_auth.sql)。代理店の分離はこの RLS + 各 API の所有権チェックで
 * 担保している。ブラウザ側は anon key + JWT でアクセスし RLS が効く (lib/supabase-browser)。
 * → shipments/agencies/user_agencies の RLS を無効化しないこと (無効化=全代理店データ漏洩)。
 */

let _client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient | null {
  if (_client) return _client

  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!rawUrl || !serviceKey) return null

  // URL を normalize — 末尾の / や /rest/v1 を除去し、http(s):// が無ければ補完
  let url = rawUrl.trim().replace(/\/+$/, "")  // 末尾 / 除去
  url = url.replace(/\/rest\/v1\/?$/, "")       // /rest/v1 除去
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`
  }

  try {
    _client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    return _client
  } catch (err) {
    console.error("[supabase] createClient failed:", err instanceof Error ? err.message : err)
    return null
  }
}

/** Supabase 設定の有無を返す (UI の表示分岐用) */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  )
}
