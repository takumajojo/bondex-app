// 配送プロバイダの選択 (Phase A・2026-09-14)。
//
// env SHIPMENT_PROVIDER でプロバイダを切り替える境界。Phase A では shipandco のみ
// 実装しており、未設定・未知値はすべて shipandco にフォールバックする (=現行挙動)。
// 佐川 Biz-Logi プロバイダ (Phase B) を追加する際は、下の switch に1行足すだけ。

import type { DispatchProvider } from "./types"
import { shipandcoDispatchProvider } from "./shipandco"

export function getDispatchProvider(): DispatchProvider {
  switch (process.env.SHIPMENT_PROVIDER) {
    // case "bizlogi": return bizlogiDispatchProvider  // Phase B: 佐川 Biz-Logi (集荷依頼)
    // case "csv":     return sagawaCsvDispatchProvider // Phase B: 暫定/障害時CSV
    case "shipandco":
    default:
      return shipandcoDispatchProvider
  }
}

export type { DispatchProvider, DispatchInput, DispatchResult, DispatchCapabilities } from "./types"
