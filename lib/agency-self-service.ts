/**
 * 代理店セルフサービス (日程・個数・代表者名の変更、区間の取り消し) の可否判定。
 *
 * 2026-09-24 運用変更 (送り状は佐川が作成) により、依頼直後から status="issued" (手配済) になる。
 * 従来の「requested / pending のみ変更可」のままだと全予約がロックされてしまうため、
 * ロック条件を「送り状 (Ship&co ラベル) が実在する / 追跡番号が入っている / 集荷済み以降」に改める。
 *
 * 締切: 代理店へは「修正は配送前日の 17:00 まで」と案内している (予約完了画面・受付メール)。
 * BondEx はその後に佐川へ集荷情報を渡すため、日程・個数・代表者名の変更はこの時刻で締める。
 * (ホテル変更はホテルへの連絡が要るので、従来どおり change_deadline_at = 発送2営業日前 18:00。)
 *
 * サーバ (API) とクライアント (ポータル) の両方から使う純粋関数のみ。
 */

const EDITABLE_STATUSES = new Set(["requested", "pending", "issued"])

export interface LockInput {
  status: string | null | undefined
  yamato_label_url?: string | null
  yamato_tracking?: string[] | null
}

/** 代理店がこの区間を自分で変更できないなら true。 */
export function legLockedForAgency(s: LockInput): boolean {
  if (!EDITABLE_STATUSES.has(s.status || "")) return true
  if (s.yamato_label_url) return true
  if ((s.yamato_tracking?.length ?? 0) > 0) return true
  return false
}

/** 修正締切 (配送前日 17:00 JST) を ISO(UTC) で返す。17:00 JST = 08:00Z。 */
export function selfServiceCutoffAt(shipmentDate: string | null | undefined): string | null {
  const ymd = (shipmentDate || "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  const t = Date.parse(`${ymd}T00:00:00Z`)
  if (Number.isNaN(t)) return null
  const prev = new Date(t - 86_400_000)
  return `${prev.toISOString().slice(0, 10)}T08:00:00.000Z`
}

/** 修正締切 (配送前日 17:00 JST) を過ぎているか。発送日不明なら false (既存ゲートに委ねる)。 */
export function isSelfServiceCutoffPassed(
  shipmentDate: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const at = selfServiceCutoffAt(shipmentDate)
  if (!at) return false
  return now.getTime() > Date.parse(at)
}

/** 代表者名の正規化と検証。空・長すぎ (80文字超) は null。 */
export function normalizeRepresentative(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const v = raw.replace(/\s+/g, " ").trim()
  if (!v || v.length > 80) return null
  return v
}
