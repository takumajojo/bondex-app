"use client"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * クライアントサイド Supabase クライアント (anon key + Auth JWT).
 * RLS が effective なので、代理店 user は自社データのみ閲覧可能.
 *
 * 注意: service_role キーはここで絶対に使わない (公開バンドルに混入する).
 */

let _client: SupabaseClient | null = null

export function getBrowserSupabase(): SupabaseClient | null {
  if (typeof window === "undefined") return null
  if (_client) return _client

  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!rawUrl || !anon) return null

  // URL を normalize (server-side と同じ処理)
  let url = rawUrl.trim().replace(/\/+$/, "")
  url = url.replace(/\/rest\/v1\/?$/, "")
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`
  }

  try {
    _client = createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
    return _client
  } catch (err) {
    console.error("[supabase-browser] createClient failed:", err instanceof Error ? err.message : err)
    return null
  }
}

export function isBrowserSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
}
