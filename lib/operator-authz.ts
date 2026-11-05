/**
 * 運営の API の、ハンドラーの中での認可（2026-11-05）。middleware（middleware.ts）の認証だけに頼らない。
 *
 * - requireOperator: middleware と同じ条件（運営のセッションの cookie〔v1・v2〕か Authorization: Bearer <OPERATOR_PASSWORD>）。
 *   B2B の今の操作（CLI・サーバー内の呼び出しを含む）はこれまでどおり通る。OPERATOR_PASSWORD が無い開発の環境では
 *   middleware と同じく通す（本番では middleware が 503 で止める）。
 * - requireB2cOperatorIf: 対象が旅行者の予約（B2C）の区間の時は、本人確認済みの個人のパスキーのセッション（v2・メールあり。
 *   lib/b2c/operator-identity.ts）だけを通す。共有パスワード（v1）・Bearer・代理店の JWT・未認証は 403。
 *   B2C の区間でなければ requireOperator と同じ。
 */
import { NextResponse, type NextRequest } from "next/server"
import { OPERATOR_SESSION_COOKIE, verifyOperatorSession } from "@/lib/operator-session"
import { resolveB2cOperator, type B2cOperator } from "@/lib/b2c/operator-identity"

type Req = Pick<NextRequest, "cookies" | "headers">

/** middleware と同じ条件で運営か。 */
export async function isOperatorRequest(req: Req): Promise<boolean> {
  const expected = process.env.OPERATOR_PASSWORD
  if (!expected) return process.env.NODE_ENV !== "production"
  if (await verifyOperatorSession(req.cookies.get(OPERATOR_SESSION_COOKIE)?.value)) return true
  return req.headers.get("authorization") === `Bearer ${expected}`
}

/** 運営でなければ 401 の応答を返す（運営なら null）。 */
export async function requireOperator(req: Req): Promise<NextResponse | null> {
  if (await isOperatorRequest(req)) return null
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}

/**
 * B2C の区間が対象なら個人のパスキーの運営者だけを通す。
 * 戻り値: deny（拒否の応答）か、op（B2C の区間の時の運営者。B2C でなければ null）。
 */
export async function requireB2cOperatorIf(req: Req, targetsB2c: boolean | null): Promise<{ deny: NextResponse | null; op: B2cOperator | null }> {
  const base = await requireOperator(req)
  if (base) return { deny: base, op: null }
  if (targetsB2c === false) return { deny: null, op: null }
  const op = await resolveB2cOperator(req)
  if (!op && targetsB2c === null) {
    // 区間を確かめられない（DB の障害など）: B2C かもしれないので、個人のパスキーの運営者以外は止める（理由をはっきり返す）
    return { deny: NextResponse.json({ error: "shipment_check_unavailable", message: "区間を確認できないため、操作できません。少し待ってからもう一度お試しください。" }, { status: 503 }), op: null }
  }
  if (!op) {
    return {
      deny: NextResponse.json(
        { error: "operator_passkey_required", message: "旅行者の予約（B2C）の区間の操作は、個人のパスキーでログインした運営者だけができます。" },
        { status: 403 },
      ),
      op: null,
    }
  }
  return { deny: null, op }
}

/**
 * 区間が旅行者の予約（B2C）のものか。true / false / null（確かめられない: DB の障害など）。
 * 行は全部の列で読む（B2C の列が無い古い DB でも、代理店名 BondEx Direct で判定できる・lib/b2c/b2b-guard.ts）。
 */
export async function shipmentIsB2c(shipmentId: string): Promise<boolean | null> {
  const { getSupabase } = await import("@/lib/supabase")
  const { isB2cShipmentRow } = await import("@/lib/b2c/b2b-guard")
  const sb = getSupabase()
  if (!sb) return null
  if (!shipmentId) return false
  const { data, error } = await sb.from("shipments").select("*").eq("id", shipmentId).maybeSingle()
  if (error) return null
  if (!data) return false
  return isB2cShipmentRow(data as { channel?: unknown; b2c_order_id?: unknown; agency?: unknown })
}
