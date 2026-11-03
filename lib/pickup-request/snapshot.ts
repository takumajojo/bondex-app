// 集荷依頼をした時点の内容 (pickup_requests.request_snapshot)。
// 依頼後に区間の発送元・到着先・日付・時間帯・個数が変わったら、佐川の依頼は古い内容のまま残る。
// 今の区間と比べて違いがあれば「世田谷へ変更連絡が必要」として TODO に出す (自動では状態を変えない)。
// sql/067 の移行 (jsonb_build_object) と同じキー・同じ形にそろえること。

export interface SnapshotSourceRow {
  from_hotel: string | null
  from_place_id: string | null
  from_residence: unknown
  to_hotel: string | null
  to_place_id: string | null
  to_residence: unknown
  shipment_date: string | null
  expected_arrival: string | null
  delivery_time: string | null
  suitcase_count: number | null
}

export const SNAPSHOT_COLUMNS =
  "from_hotel, from_place_id, from_residence, to_hotel, to_place_id, to_residence, shipment_date, expected_arrival, delivery_time, suitcase_count"

const FIELD_LABEL: Record<keyof SnapshotSourceRow, string> = {
  from_hotel: "発送元ホテル",
  from_place_id: "発送元ホテル",
  from_residence: "発送元の住所",
  to_hotel: "到着ホテル",
  to_place_id: "到着ホテル",
  to_residence: "到着先の住所",
  shipment_date: "集荷日",
  expected_arrival: "配達日",
  delivery_time: "配達時間帯",
  suitcase_count: "個数",
}
const KEYS = Object.keys(FIELD_LABEL) as Array<keyof SnapshotSourceRow>

export type PickupSnapshot = Record<keyof SnapshotSourceRow, unknown>

export function pickupSnapshot(row: SnapshotSourceRow): PickupSnapshot {
  const out = {} as PickupSnapshot
  for (const k of KEYS) out[k] = row[k] ?? null
  return out
}

/** キー順に依存しない比較用の文字列 (jsonb はキー順を並べ替えるため)。 */
function stable(v: unknown): string {
  if (v === undefined || v === null) return "null"
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`
  if (typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`
  }
  if (typeof v === "string") return JSON.stringify(v.trim())
  return JSON.stringify(v)
}

/** 依頼時点から変わった項目 (日本語ラベル・重複なし)。依頼内容が無い (null) 記録は比較しない。 */
export function snapshotChanges(snapshot: unknown, row: SnapshotSourceRow): string[] {
  if (!snapshot || typeof snapshot !== "object") return []
  const snap = snapshot as Record<string, unknown>
  const changed = new Set<string>()
  for (const k of KEYS) {
    if (!(k in snap)) continue
    if (stable(snap[k]) !== stable(row[k])) changed.add(FIELD_LABEL[k])
  }
  return [...changed]
}
