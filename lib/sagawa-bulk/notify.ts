/**
 * P1-B 大口集荷メール通知の「冪等クレーム判定」(純粋) と本文ビルダ。
 * 実際の送信・DB 更新は lib/sagawa-bulk/db.ts と cron が行う。宛先は opsRecipients()。
 */
import { stableHash, type NotifyKind } from "./core"

export interface NotifyRow {
  notify_state: "idle" | "pending" | "sent" | "failed"
  notify_key: string | null // = stableHash(notifyKey 文字列)
  notify_claimed_at: string | null // ISO
}

/**
 * この run がメール送信を claim してよいか (純粋判定・DB の条件付き UPDATE がこれをミラーする)。
 *  - キーが違う (構成変化=新バージョン) → claim 可 (再通知する)。
 *  - 同一キーで sent → 不可 (このバージョンは送信済み=重複防止)。
 *  - 同一キーで idle / failed → 可 (初回 / 失敗後の再試行)。
 *  - 同一キーで pending → lease が切れていれば可 (前の送信者がクラッシュ)、生きていれば不可 (同時実行防止)。
 */
export function canClaimNotify(row: NotifyRow, keyHash: string, nowMs: number, leaseMs: number): boolean {
  if (row.notify_key !== keyHash) return true
  if (row.notify_state === "sent") return false
  if (row.notify_state === "idle" || row.notify_state === "failed") return true
  if (row.notify_state === "pending") {
    if (!row.notify_claimed_at) return true
    return nowMs - Date.parse(row.notify_claimed_at) >= leaseMs
  }
  return false
}

export function notifyKeyHash(notifyKeyStr: string): string {
  return stableHash(notifyKeyStr)
}

export const NOTIFY_LEASE_MS = 10 * 60 * 1000 // 10分 (前送信者クラッシュ後の再claim余地)

/** 通知メールの件名・本文 (日本語・運用者向け)。sendOpsAlert({subject, lines}) にそのまま渡す。 */
export function buildBulkAlertEmail(input: {
  kind: NotifyKind
  pickupDate: string
  hotelLabel: string
  totalPieces: number
  legCount: number
  agencyCount: number
  confident: boolean
  changeDetail?: { increase?: boolean; pieceDelta?: number; added?: string[]; pickupTimeChanged?: boolean }
}): { subject: string; lines: string[] } {
  const head =
    input.kind === "initial" ? "大口集荷の事前連絡が必要です"
    : input.kind === "change" ? "大口集荷の内容に変更がありました（要再確認）"
    : input.kind === "eve" ? "【前日】大口集荷の事前連絡が未対応です"
    : "【当日・至急】大口集荷の事前連絡が未対応です"
  const subject = `【BondEx】佐川 大口集荷 ${input.kind === "day" ? "至急 " : ""}${input.pickupDate}｜${input.hotelLabel}（${input.totalPieces}個）`
  const lines = [
    `佐川急便｜${head}`,
    "",
    `集荷日：${input.pickupDate}`,
    `集荷元：${input.hotelLabel}${input.confident ? "" : "（※ホテル同一性は要確認）"}`,
    `合計：${input.totalPieces}個（対象予約 ${input.legCount}件 / 代理店 ${input.agencyCount}社）`,
  ]
  if (input.kind === "change" && input.changeDetail) {
    const d = input.changeDetail
    const parts: string[] = []
    if (d.increase && typeof d.pieceDelta === "number") parts.push(`個数 +${d.pieceDelta}個`)
    if (d.added && d.added.length) parts.push(`予約追加 ${d.added.length}件`)
    if (d.pickupTimeChanged) parts.push("集荷時間帯の変更")
    if (parts.length) lines.push(`変更内容：${parts.join(" / ")}`)
    lines.push("※佐川へ伝えた内容と異なります。再連絡の要否をご確認ください。")
  }
  lines.push(
    "",
    "対応：運営ダッシュボードの「大口集荷」から詳細確認・佐川へ連絡済み登録・履歴確認ができます。",
    "（これは BondEx 内部の運用連絡です。代理店・旅行者には通知されません。）",
  )
  return { subject, lines }
}
