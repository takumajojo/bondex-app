/**
 * 運営パスキー (WebAuthn) のサーバー側共通処理。
 *
 * rpID / origin はリクエストの Host から導出する (本番 = bondex.express、開発 = localhost)。
 * チャレンジは署名付き短命 cookie で往復させるため、サーバー側の一時ストレージは不要
 * (serverless でもインスタンスをまたいで検証できる)。
 */
import type { NextRequest } from "next/server"
import { getSupabase } from "./supabase"

export function rpFrom(req: NextRequest): { rpID: string; origin: string } {
  const host = req.headers.get("host") || "localhost:3000"
  const rpID = host.split(":")[0]
  const proto = req.headers.get("x-forwarded-proto") || (rpID === "localhost" ? "http" : "https")
  return { rpID, origin: `${proto}://${host}` }
}

export type PasskeyRow = {
  credential_id: string
  public_key: string // bytea は PostgREST 経由だと \x 付き hex 文字列で返る
  counter: number
  transports: string[] | null
  label: string | null
}

export function decodePublicKey(byteaHex: string): Uint8Array<ArrayBuffer> {
  const hex = byteaHex.startsWith("\\x") ? byteaHex.slice(2) : byteaHex
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2))
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function encodePublicKey(bytes: Uint8Array): string {
  let hex = "\\x"
  for (const b of bytes) hex += b.toString(16).padStart(2, "0")
  return hex
}

export async function listPasskeys(): Promise<PasskeyRow[]> {
  const sb = getSupabase()
  if (!sb) return []
  const { data, error } = await sb
    .from("operator_passkeys")
    .select("credential_id, public_key, counter, transports, label")
  if (error) {
    console.error("[operator-webauthn] list failed:", error.message)
    return []
  }
  return (data ?? []) as PasskeyRow[]
}

export function operatorPasswordOk(input: unknown): boolean {
  const expected = process.env.OPERATOR_PASSWORD
  return Boolean(expected) && typeof input === "string" && input === expected
}
