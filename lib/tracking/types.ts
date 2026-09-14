// 追跡プロバイダの境界 (Phase A・2026-09-14)。
//
// 目的: 現在の Ship&co 追跡ポーリングの「HTTP取得 + ステータス正規化 + 異常検知」を
// プロバイダの背後に隠し、将来 佐川お荷物問い合わせAPI へ差し替え可能にする。
// Phase A では Ship&co の挙動を一切変えない。Biz-Logi/佐川固有の項目 (正式個数など) は
// ここには入れず、佐川プロバイダ実装時 (Phase B) に必要最小限で拡張する。

import type { ShipmentStatus } from "@/lib/shipments-db"

/**
 * 追跡番号1件の正規化済み現況。
 * cron 側の前進判定・詳細書込・異常アラートは、この形だけを見て動く
 * (キャリア固有の語彙は各プロバイダ内で吸収する)。
 */
export interface TrackingResult {
  number: string
  /** キャリアから有効な現況が得られなかった (無応答/ステータス無し)。 */
  noData: boolean
  /** キャリアが返した生ステータス文字列 (ログ/未マップ記録・異常アラート表示用)。 */
  rawStatus?: string
  /** 正規化済みステータス。異常時・未マップ時・noData時は null。 */
  status: ShipmentStatus | null
  /** 異常系ラベル (検知時)。異常時は status を前進に使わない。 */
  exception: string | null
  location?: string
  date?: string
}

export interface TrackingProvider {
  readonly name: string
  /**
   * 追跡番号1件の現況を取得し、正規化して返す。
   * carrier は shipments.carrier ('sagawa'/'yamato'/null)。プロバイダ内で自社の
   * 照会先へ対応付ける。認証情報はプロバイダが自身で解決する (env等)。
   */
  fetchOne(carrier: string | null | undefined, trackingNumber: string): Promise<TrackingResult>
}
