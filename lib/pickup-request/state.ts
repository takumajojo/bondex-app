// 佐川への集荷依頼の状態 (sql/067_pickup_requests.sql と同じ定義)。
//
// 配送状態 (shipments.status) とは別物。status='requested' は「佐川へ依頼済み」を意味しない。
// 1区間に「有効な依頼」は1件まで (DB の部分一意インデックスで強制)。有効な依頼が無い区間が「未依頼」。

export type PickupChannel = "manual" | "bizlogi"

export type PickupRequestState =
  | "sending"
  | "accepted"
  | "unknown"
  | "failed"
  | "needs_review"
  | "change_pending"
  | "cancelled"
  | "void"

export const LIVE_STATES: readonly PickupRequestState[] = ["sending", "accepted", "unknown", "needs_review", "change_pending"]

export const STATE_LABEL_JA: Record<PickupRequestState, string> = {
  sending: "送信中",
  accepted: "依頼受付済み",
  unknown: "依頼結果不明",
  failed: "依頼失敗",
  needs_review: "依頼済みか不明 (要確認)",
  change_pending: "キャンセル・変更対応中",
  cancelled: "佐川で取消済み",
  void: "無効 (依頼なしを確認)",
}

export const CHANNEL_LABEL_JA: Record<PickupChannel, string> = {
  manual: "手動 (佐川指定Excel)",
  bizlogi: "Biz-Logi API",
}

export interface PickupRequestRow {
  id: string
  shipment_id: string
  booking_id: string
  leg_index: number
  channel: PickupChannel
  state: PickupRequestState
  environment: "test" | "production" | null
  user_manage_number: string | null
  shipping_number: string | null
  print_request_id: string | null
  piece_count: number | null
  pickup_date: string | null
  result_codes: unknown
  error: string | null
  note: string | null
  requested_by: string | null
  resolved_by: string | null
  created_at: string
  sent_at: string | null
  resolved_at: string | null
  updated_at: string
  request_snapshot?: unknown
  stale_alerted_at?: string | null
}

export function isLive(state: string): boolean {
  return (LIVE_STATES as readonly string[]).includes(state)
}

/**
 * 運営が画面から行える状態変更。送信結果の保存 (sending → accepted/failed/unknown) は
 * サーバの送信処理だけが行い、ここには含めない。
 *   confirm_accepted : 佐川側で受付済みと確認した (問合番号を入力)
 *   confirm_none     : 佐川側に依頼は無いと確認した (この記録を無効にする)
 *   start_change / change_done / cancel_done : 旧操作。2026-11-04 段階C で「変更申請」(sql/068) に置き換えた。
 *     依頼記録だけを動かすと区間の情報 (取消など) と食い違うため、resolvePickupRequest は受け付けない。
 */
export type ResolveAction = "confirm_accepted" | "confirm_none" | "start_change" | "change_done" | "cancel_done"

export const RESOLVE_TRANSITIONS: Record<ResolveAction, { from: PickupRequestState[]; to: PickupRequestState }> = {
  // sending は「送信中のまま止まった」(STALE_SENDING_MS 経過) ときだけ運営が確定できる
  confirm_accepted: { from: ["sending", "unknown", "needs_review"], to: "accepted" },
  confirm_none: { from: ["sending", "unknown", "needs_review", "accepted"], to: "void" },
  start_change: { from: ["accepted"], to: "change_pending" },
  change_done: { from: ["change_pending"], to: "accepted" },
  cancel_done: { from: ["change_pending"], to: "cancelled" },
}

/** 「送信中」のまま残っている (処理の異常終了) とみなす経過時間。自動で解放はせず要確認に出す。 */
export const STALE_SENDING_MS = 5 * 60 * 1000
