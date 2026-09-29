/**
 * 予約の訂正／代理店変更の共通ロジック (設計案A)。
 *
 * - どのカラムを訂正対象にするか (CORRECTION_FIELDS)
 * - 入力の正規化・検証 (normalizeCorrection): 日付は YYYY-MM-DD・JST 前提、個数 1〜50、
 *   文字列は前後空白除去。半角/全角は佐川Excel出力時 (lib/zenkaku.ts) に寄せるため
 *   ここでは保存値をそのまま扱う (表示・突合は元表記のほうが安全)。
 * - 変更前後の差分 (diffCorrection)
 * - 承認後にキャリアごとに必要な下流処理の判定 (postCorrectionAction)
 *
 * 実際の DB 反映と監査行の記録は API ルート側 (operator/correct・change-requests/decide・
 * agency PATCH) が行う。ここは純粋関数のみで副作用を持たない。
 */

import type { ShipmentRecord } from "./shipments-db"

/** 訂正で書き換えてよい shipments カラム。ホテルは既存の HotelChangeModal が担当するため含めない。 */
export const CORRECTION_FIELDS = [
  "shipment_date",
  "expected_arrival",
  "suitcase_count",
  "representative",
  "recipient",
] as const
export type CorrectionField = (typeof CORRECTION_FIELDS)[number]

/** 訂正の入力 (すべて任意・agency は別枠で全区間反映のため分離)。 */
export interface CorrectionInput {
  shipmentDate?: string
  expectedArrival?: string
  suitcaseCount?: number
  representative?: string
  recipient?: string
}

/** 正規化・検証の結果。ok=false のとき error に日本語メッセージ。 */
export type NormalizeResult =
  | { ok: true; patch: Partial<Record<CorrectionField, string | number>>; changes: string[] }
  | { ok: false; error: string }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 全角数字・全角ハイフンを半角へ寄せて日付入力の取りこぼしを防ぐ (2026-09-29 等)。 */
function toHalfwidthDate(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30))
    .replace(/[－ー―‐]/g, "-")
    .trim()
}

/**
 * 訂正入力を検証して patch (shipments へ渡す部分更新) と変更行ラベルを返す。
 * @param current 現在の shipment (差分ラベルと既定値の解決に使う)
 */
export function normalizeCorrection(
  input: CorrectionInput,
  current: Pick<
    ShipmentRecord,
    "shipment_date" | "expected_arrival" | "suitcase_count" | "representative" | "recipient"
  >,
): NormalizeResult {
  const patch: Partial<Record<CorrectionField, string | number>> = {}
  const changes: string[] = []

  const rawShip = typeof input.shipmentDate === "string" ? toHalfwidthDate(input.shipmentDate) : ""
  const rawArr = typeof input.expectedArrival === "string" ? toHalfwidthDate(input.expectedArrival) : ""

  if (rawShip || rawArr) {
    const newShip = rawShip || current.shipment_date
    const newArr = rawArr || current.expected_arrival || newShip
    if (!DATE_RE.test(newShip) || !DATE_RE.test(newArr)) {
      return { ok: false, error: "日付は YYYY-MM-DD 形式で入力してください。" }
    }
    if (newArr < newShip) {
      return { ok: false, error: "到着予定日は発送日以降にしてください。" }
    }
    if (rawShip && newShip !== current.shipment_date) {
      patch.shipment_date = newShip
      changes.push(`発送(集荷)日: ${current.shipment_date} → ${newShip}`)
    }
    if (newArr !== (current.expected_arrival || "")) {
      patch.expected_arrival = newArr
      changes.push(`到着予定日: ${current.expected_arrival || "—"} → ${newArr}`)
    }
  }

  if (input.suitcaseCount !== undefined) {
    const n = Math.floor(Number(input.suitcaseCount))
    if (!Number.isFinite(n) || n < 1 || n > 50) {
      return { ok: false, error: "個数は 1〜50 で入力してください。" }
    }
    if (n !== current.suitcase_count) {
      patch.suitcase_count = n
      changes.push(`個数: ${current.suitcase_count} → ${n}`)
    }
  }

  if (typeof input.representative === "string") {
    const v = input.representative.trim()
    if (!v) return { ok: false, error: "代表者名を入力してください。" }
    if (v !== current.representative) {
      patch.representative = v
      changes.push(`代表者: ${current.representative} → ${v}`)
    }
  }

  if (typeof input.recipient === "string") {
    const v = input.recipient.trim()
    if (!v) return { ok: false, error: "受取人名を入力してください。" }
    if (v !== current.recipient) {
      patch.recipient = v
      changes.push(`受取人: ${current.recipient} → ${v}`)
    }
  }

  return { ok: true, patch, changes }
}

/** patch に対応する before スナップショット (監査用) を current から作る。 */
export function snapshotBefore(
  patch: Partial<Record<CorrectionField, string | number>>,
  current: Pick<
    ShipmentRecord,
    "shipment_date" | "expected_arrival" | "suitcase_count" | "representative" | "recipient"
  >,
): Record<string, unknown> {
  const before: Record<string, unknown> = {}
  for (const k of Object.keys(patch) as CorrectionField[]) {
    before[k] = current[k]
  }
  return before
}

export type PostCorrectionAction = "sagawa_reexport" | "yamato_reissue" | "none"

/**
 * 承認/訂正の反映後、キャリアごとに必要な運用アクションを判定する。
 *  - 未発行 (requested/pending) は送り状も集荷依頼もまだ無いので none。
 *  - 発行済み以降で 発送日/個数 が変わった場合:
 *      佐川 → 集荷依頼(Excel)を作り直して世田谷へ再送 (sagawa_reexport)
 *      ヤマト → 送り状を再発行 (yamato_reissue)
 * 代表者/受取人/到着日だけの変更は送り状差し替え不要 (none) とする。
 */
export function postCorrectionAction(
  carrier: string,
  status: ShipmentRecord["status"],
  changedKeys: string[],
): PostCorrectionAction {
  const issued = !(status === "requested" || status === "pending")
  const impactful = changedKeys.some((k) => k === "shipment_date" || k === "suitcase_count")
  if (!issued || !impactful) return "none"
  return carrier === "yamato" ? "yamato_reissue" : "sagawa_reexport"
}

/** 下流アクションの日本語文言 (UI・通知の共通表現)。 */
export function postCorrectionLabel(action: PostCorrectionAction): string | null {
  switch (action) {
    case "sagawa_reexport":
      return "佐川の集荷依頼(Excel)を作り直し、世田谷営業所へ再送してください。"
    case "yamato_reissue":
      return "ヤマトの送り状を再発行してください。"
    default:
      return null
  }
}
