// 発行 (/api/shipandco/create) を再度押されたとき、既存区間を上書きしてよいかの判定。
//
// 2026-11-03 監査で判明: 送り状を BondEx で作らない運用 (AUTO_ISSUE_ENABLED 未設定) では、
// 既存の冪等ガードが「issued かつ label_url あり」しか見ていなかったため、手入力の問合番号が
// 入った区間で発行を押し直すと saveShipment が問合番号を null で上書きしていた。
// 送り状 PDF の有無ではなく、問合番号・配送の進行で「手配済み」を判定する。

export interface ExistingLeg {
  status?: string | null
  label_url?: string | null
  tracking_numbers?: unknown
}

const PROGRESSED = new Set(["picked_up", "in_transit", "delivered"])

export function legTrackingNumbers(s: { tracking_numbers?: unknown }): string[] {
  return Array.isArray(s.tracking_numbers)
    ? (s.tracking_numbers as unknown[]).map((x) => String(x ?? "").trim()).filter(Boolean)
    : []
}

/**
 * 発行し直さずに既存の内容を返すべき区間か。
 *   - 集荷済み以降 (配送が進んでいる)
 *   - issued で、送り状 URL か問合番号がある (Ship&co 発行済み / 佐川の番号を手入力済み)
 * cancelled は対象外 (従来どおり。取消区間の扱いは呼び出し側の別ガードに任せる)。
 */
export function reissueBlocked(s: ExistingLeg | null | undefined): boolean {
  if (!s) return false
  const status = s.status ?? ""
  if (PROGRESSED.has(status)) return true
  if (status !== "issued") return false
  return !!s.label_url || legTrackingNumbers(s).length > 0
}
