// lib/supabase の偽物。代理店の1行だけを返す。
import { db } from "./state"

export function getSupabase() {
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: db.agency, error: null }),
  }
  return { from: () => q }
}
