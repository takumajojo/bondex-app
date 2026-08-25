// 代理店へのプッシュ通知 (WhatsApp / LINE) — メールの補完。配達完了などを即時に届ける。
//
// 有効化条件 (どちらも谷口さん側の外部設定が必要):
//   WhatsApp: Meta WhatsApp Business Cloud API
//     - env WHATSAPP_CLOUD_TOKEN      (システムユーザートークン)
//     - env WHATSAPP_PHONE_NUMBER_ID  (送信元電話番号ID)
//     - agencies.notify_whatsapp      (宛先番号 E.164 例 +819012345678)
//   LINE: LINE公式アカウント + Messaging API
//     - env LINE_CHANNEL_ACCESS_TOKEN (チャネルアクセストークン)
//     - agencies.notify_line_user_id  (友だち追加後に webhook で取得した userId)
//
// env / 宛先が無ければ静かにスキップ ({sent:false})。絶対に throw しない (本処理を止めない)。

import { getSupabase } from "./supabase"

export interface AgencyPushResult {
  whatsapp: boolean
  line: boolean
}

async function sendWhatsApp(to: string, text: string): Promise<boolean> {
  const token = process.env.WHATSAPP_CLOUD_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
  if (!token || !phoneId) return false
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to.replace(/[^+\d]/g, ""),
        type: "text",
        text: { body: text },
      }),
    })
    if (!res.ok) {
      console.error("[agency-push] WhatsApp HTTP", res.status, (await res.text()).slice(0, 200))
      return false
    }
    return true
  } catch (e) {
    console.error("[agency-push] WhatsApp error:", e instanceof Error ? e.message : e)
    return false
  }
}

async function sendLine(userId: string, text: string): Promise<boolean> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) return false
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: userId, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
    })
    if (!res.ok) {
      console.error("[agency-push] LINE HTTP", res.status, (await res.text()).slice(0, 200))
      return false
    }
    return true
  } catch (e) {
    console.error("[agency-push] LINE error:", e instanceof Error ? e.message : e)
    return false
  }
}

/**
 * 代理店名で通知先を引いて WhatsApp / LINE にプッシュする (登録がある方すべて)。
 * 文面は代理店の locale で ja/en を出し分け。
 */
export async function pushToAgency(
  agencyName: string,
  textJa: string,
  textEn: string,
): Promise<AgencyPushResult> {
  const result: AgencyPushResult = { whatsapp: false, line: false }
  try {
    const sb = getSupabase()
    if (!sb) return result
    const { data: ag } = await sb
      .from("agencies")
      .select("locale, notify_whatsapp, notify_line_user_id")
      .eq("name", agencyName)
      .maybeSingle()
    if (!ag) return result
    const text = ag.locale === "en" ? textEn : textJa
    if (ag.notify_whatsapp) result.whatsapp = await sendWhatsApp(ag.notify_whatsapp as string, text)
    if (ag.notify_line_user_id) result.line = await sendLine(ag.notify_line_user_id as string, text)
  } catch (e) {
    console.error("[agency-push] unexpected:", e instanceof Error ? e.message : e)
  }
  return result
}
