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

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return null

  _client = createClient(url, anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
  return _client
}

export function isBrowserSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
}
