// 代理店へのプッシュ通知 (WhatsApp / LINE) — メールの補完。配達完了などを即時に届ける。
//
// 有効化条件 (どちらも谷口さん側の外部設定が必要):
//   WhatsApp: Meta WhatsApp Business Cloud API
//     - env WHATSAPP_CLOUD_TOKEN      (システムユーザーの永続トークン)
//     - env WHATSAPP_PHONE_NUMBER_ID  (送信元電話番号ID)
//     - agencies.notify_whatsapp      (宛先番号 E.164 例 +819012345678)
//     ※ こちら起点のプッシュは「承認済みテンプレート」でのみ送れる (24h枠外は自由文不可)。
//        テンプレ名は WA_TEMPLATES。本文パラメータは承認済みテンプレの {{1}}{{2}}… と順序一致させる。
//   LINE: LINE公式アカウント + Messaging API (自由文でよい)
//     - env LINE_CHANNEL_ACCESS_TOKEN (チャネルアクセストークン)
//     - agencies.notify_line_user_id  (友だち追加後に webhook で取得した userId)
//
// env / 宛先が無ければ静かにスキップ ({sent:false})。絶対に throw しない (本処理を止めない)。

import { getSupabase } from "./supabase"

export interface AgencyPushResult {
  whatsapp: boolean
  line: boolean
}

/** WhatsApp プッシュの種類。種類ごとに承認済みテンプレートを対応させる。 */
export type AgencyPushKind = "delivered"

/** 種類 → WhatsApp 承認済みテンプレート名。WhatsApp Manager で作成した名前と一致させること。 */
const WA_TEMPLATES: Record<AgencyPushKind, string> = {
  delivered: "bondex_delivered",
}

export interface AgencyPushInput {
  kind: AgencyPushKind
  /** WhatsApp テンプレ本文の差し込み値 (承認済みテンプレの {{1}}{{2}}… の順に一致)。 */
  templateParams: string[]
  /** LINE 用の自由文 (locale で出し分け)。 */
  textJa: string
  textEn: string
}

/** テンプレパラメータの禁則 (改行・タブ・連続空白) を除去する。WhatsApp が弾くため。 */
function cleanParam(v: string): string {
  return (v ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, 256) || "-"
}

/** WhatsApp 承認済みテンプレートを送る (こちら起点のプッシュ用)。 */
async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  langCode: "ja" | "en_US",
  bodyParams: string[],
): Promise<boolean> {
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
        type: "template",
        template: {
          name: templateName,
          language: { code: langCode },
          components: bodyParams.length
            ? [{ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: cleanParam(t) })) }]
            : [],
        },
      }),
    })
    if (!res.ok) {
      console.error("[agency-push] WhatsApp HTTP", res.status, (await res.text()).slice(0, 300))
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
 * 代理店名で通知先を引いて WhatsApp (テンプレ) / LINE (自由文) にプッシュする。
 * 言語は代理店の locale で ja/en を出し分け。登録がある手段すべてに送る。best-effort。
 */
export async function pushToAgency(
  agencyName: string,
  input: AgencyPushInput,
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
    const en = ag.locale === "en"
    if (ag.notify_whatsapp) {
      result.whatsapp = await sendWhatsAppTemplate(
        ag.notify_whatsapp as string,
        WA_TEMPLATES[input.kind],
        en ? "en_US" : "ja",
        input.templateParams,
      )
    }
    if (ag.notify_line_user_id) {
      result.line = await sendLine(ag.notify_line_user_id as string, en ? input.textEn : input.textJa)
    }
  } catch (e) {
    console.error("[agency-push] unexpected:", e instanceof Error ? e.message : e)
  }
  return result
}
