// 配送(集荷/送り状発行)プロバイダの境界 (Phase A・2026-09-14)。
//
// 目的: 現在 create/route.ts にインラインで書かれている Ship&co の
// 「carrier_id 取得 + 送り状発行リクエスト構築 + POST + レスポンス解析」を
// プロバイダの背後に隠し、将来 佐川 Biz-Logi へ差し替え可能にする。
// Phase A では Ship&co の挙動を一切変えない。Biz-Logi固有仕様(XML・問合番号・
// ラベルURL不在など)は先回りして入れず、Biz-Logi実装時(Phase B)に拡張する。
//
// 注意: 住所解決(Google Places)・deferred・idempotency(issue_claimed_at)・
// live/test判定・DB保存・課金/通知の副作用は route 側に残す(この境界は
// 「キャリアへの発行リクエストと応答」だけを担う)。

/** Ship&co 送り状発行リクエストの構築に必要な入力 (route が解決して渡す)。 */
export interface DispatchInput {
  /** Ship&co の carrier_id (getCarrierId で取得した値)。 */
  carrierId: string
  /** carrier.shipandcoService (佐川=sagawa_regular / ヤマト=yamato_regular)。 */
  service: string
  /** carrier.packSize (荷物サイズ区分)。 */
  packSize: number
  /** 解決済み発送元/お届け先住所 (Ship&co 形式。route の住所マッピングが構築)。 */
  fromAddress: unknown
  toAddress: unknown
  /** 記事欄 (ref_number)。 */
  refNumber: string
  shipmentDate: string
  /** 配達希望日 (無ければ ""/undefined)。 */
  deliveryDate?: string
  deliveryTime: string
  suitcaseCount: number
  /** 品名 (productNameFull)。 */
  productName: string
  /** SHIPANDCO_LIVE===true。false のとき test ラベル。 */
  live: boolean
}

/** 送り状発行の正規化済み結果。route はこれを見て DB 保存・レスポンスを組む。 */
export interface DispatchResult {
  ok: boolean
  /** HTTP ステータス (ネットワーク例外時は 0)。 */
  status: number
  /** ネットワーク例外時のメッセージ (それ以外は undefined)。 */
  networkError?: string
  trackingNumbers: string[]
  labelUrl: string | null
  carrier: string
  method: string
  estimatedDeliveryDate: string
  id: string
  /** 失敗時のエラーコード (例: "SHIPANDCO_DATE_WINDOW")。 */
  errorCode?: string
  /** 失敗時の生 detail (レスポンス表示用)。 */
  errorDetail?: unknown
  /** 失敗時の detail を文字列化したもの (DB error_message 用)。 */
  errorDetailStr?: string
  /** 実際に送信したペイロード (route の失敗レスポンス sentPayload 用)。 */
  sentPayload: unknown
}

export interface DispatchCapabilities {
  createPickup: boolean
  cancelViaApi: boolean
  changeViaApi: boolean
  returnsLabelUrl: boolean
}

export interface DispatchProvider {
  readonly name: string
  readonly capabilities: DispatchCapabilities
  /** キャリアの carrier_id を取得 (未登録は null)。認証情報はプロバイダが自身で解決。 */
  getCarrierId(carrierType: string): Promise<string | null>
  /** 送り状発行リクエストを送り、正規化結果を返す。 */
  postLabel(input: DispatchInput): Promise<DispatchResult>
}
