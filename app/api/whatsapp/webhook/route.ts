import { NextRequest, NextResponse } from "next/server"
import { getSupabase } from "@/lib/supabase"
import { sendWhatsAppText, verifyWhatsAppSignature } from "@/lib/whatsapp"
import { extractQuery, lookupShipmentByQuery, buildTrackingReply } from "@/lib/whatsapp-tracking"
import { sendOpsAlert } from "@/lib/ops-alert"

export const runtime = "nodejs"
export const maxDuration = 20

/**
 * WhatsApp 自動応答 Webhook。
 *   GET  : Meta の Webhook 検証 (hub.challenge を返す)。
 *   POST : 顧客メッセージ受信 → 予約番号/追跡番号を抽出 → 配送状況を自由文で返信
 *          (顧客起点=24時間枠内なのでテンプレ不要)。
 *
 * 公開エンドポイント (middleware の PUBLIC_EXACT)。認証は
 *   - GET  : WHATSAPP_WEBHOOK_TOKEN 照合
 *   - POST : X-Hub-Signature-256 を WHATSAPP_APP_SECRET で署名検証
 * で担保する。返信送出は既存の WHATSAPP_CLOUD_TOKEN / WHATSAPP_PHONE_NUMBER_ID を流用。
 */

// 顧客向け返信文 (見つからない/エラー時)。言語不明なので日英併記。
const REPLY_NO_QUERY =
  "配送番号を送信してください（例: BDX-XXXXXX）。\nPlease send your booking number (e.g. BDX-XXXXXX)."
const REPLY_NOT_FOUND =
  "申し訳ございません。配送番号が見つかりません。もう一度ご確認ください。\nSorry, we couldn't find that number. Please double-check your booking number."
const REPLY_DB_ERROR =
  "申し訳ございません。一時的なエラーが発生しました。しばらく経ってからお試しください。\nSorry, a temporary error occurred. Please try again later."

const MAX_BODY_BYTES = 1_000_000

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const mode = p.get("hub.mode")
  const token = p.get("hub.verify_token")
  const challenge = p.get("hub.challenge")
  const expected = process.env.WHATSAPP_WEBHOOK_TOKEN
  if (mode === "subscribe" && expected && token === expected) {
    return new NextResponse(challenge ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    })
  }
  return new NextResponse("Forbidden", { status: 403 })
}

interface WaMessage {
  from?: string
  id?: string
  type?: string
  text?: { body?: string }
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 })
  }
  // 署名検証 (App Secret 設定時のみ。未設定=ローカルテスト用に検証しない)。
  const sig = verifyWhatsAppSignature(raw, req.headers.get("x-hub-signature-256"))
  if (sig === false) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }

  try {
    const sb = getSupabase()
    const entries = (payload as { entry?: unknown[] })?.entry ?? []
    for (const entry of entries) {
      const changes = (entry as { changes?: unknown[] })?.changes ?? []
      for (const change of changes) {
        const value = (change as { value?: Record<string, unknown> })?.value ?? {}
        const messages = (value.messages as WaMessage[] | undefined) ?? []
        const contactWaId = (value.contacts as Array<{ wa_id?: string }> | undefined)?.[0]?.wa_id
        for (const msg of messages) {
          // テキスト以外 (画像・音声等) は Phase 1 対象外。
          if (msg.type && msg.type !== "text") continue
          const from = msg.from ?? contactWaId
          const msgId = msg.id
          const text = msg.text?.body ?? ""
          if (!from) continue

          // べき等性: 同一 message_id は一度だけ処理 (WhatsApp は再送しうる)。
          if (sb && msgId) {
            const { error: dupErr } = await sb.from("whatsapp_processed").insert({ message_id: msgId })
            if (dupErr) {
              // 23505 = unique_violation = 既処理 → スキップ (二重返信を防ぐ)。
              if ((dupErr as { code?: string }).code === "23505") continue
              // それ以外のDBエラーは握って続行 (返信優先)。
            }
          }

          // 返信文を決定。
          let reply: string
          const query = extractQuery(text)
          if (!query) {
            reply = REPLY_NO_QUERY
          } else if (!sb) {
            reply = REPLY_DB_ERROR
          } else {
            try {
              const rows = await lookupShipmentByQuery(sb, query)
              reply = rows.length > 0 ? buildTrackingReply(rows) : REPLY_NOT_FOUND
            } catch (e) {
              console.error("[whatsapp-webhook] lookup failed:", e instanceof Error ? e.message : e)
              reply = REPLY_DB_ERROR
            }
          }

          const r = await sendWhatsAppText(from, reply)
          if (!r.ok) {
            console.error("[whatsapp-webhook] reply send failed:", r.error)
            // 送信失敗は Slack/メールへ通知 (best-effort)。
            await sendOpsAlert({
              subject: "【WhatsApp】自動返信の送信に失敗",
              lines: [`宛先: ${from}`, `本文: ${text.slice(0, 80)}`, `理由: ${r.error ?? "unknown"}`],
            }).catch(() => {})
          }
        }
      }
    }
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[whatsapp-webhook] error:", e instanceof Error ? e.message : e)
    // Meta の再送ストームを避けるため 200 で返す (処理側で握る)。
    return NextResponse.json({ success: false })
  }
}
