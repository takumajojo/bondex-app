/**
 * B2C の手作業（集荷の確認と取り消し・返金・ホテルの確認と受入・追加の請求・取消の代行）を行う運営者の識別。
 * docs/b2c/B2C_MVP_SCHEMA_v1.md 7章。
 *
 * パスキーで入った v2 のセッション（lib/operator-session.ts）の credential_id から、
 * operator_passkeys.operator_email（登録の時にメールのワンタイムコードで確かめたアドレス）を引く。
 * v1 のセッション（共有パスワード・従来のパスキー）・サーバー間の Bearer・メールの無い登録は null（操作を拒否）。
 */
import type { NextRequest } from "next/server"
import { getSupabase } from "@/lib/supabase"
import { OPERATOR_SESSION_COOKIE, operatorSessionCredentialId } from "@/lib/operator-session"

export interface B2cOperator {
  operatorEmail: string
  credentialId: string
}

export async function resolveB2cOperator(req: Pick<NextRequest, "cookies">): Promise<B2cOperator | null> {
  const credentialId = await operatorSessionCredentialId(req.cookies.get(OPERATOR_SESSION_COOKIE)?.value)
  if (!credentialId) return null
  const sb = getSupabase()
  if (!sb) return null
  const { data, error } = await sb
    .from("operator_passkeys")
    .select("credential_id, operator_email")
    .eq("credential_id", credentialId)
    .maybeSingle()
  if (error || !data) return null
  const email = typeof data.operator_email === "string" ? data.operator_email.trim() : ""
  if (!email) return null
  return { operatorEmail: email, credentialId }
}
