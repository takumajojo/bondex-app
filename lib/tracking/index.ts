// 追跡プロバイダの選択 (Phase A・2026-09-14)。
//
// env TRACKING_PROVIDER でプロバイダを切り替える境界。Phase A では shipandco のみ
// 実装しており、未設定・未知値はすべて shipandco にフォールバックする (=現行挙動)。
// 佐川お荷物問い合わせAPI プロバイダ (Phase B) を追加する際は、下の switch に1行足すだけ。

import type { TrackingProvider } from "./types"
import { shipandcoTrackingProvider } from "./shipandco"

export function getTrackingProvider(): TrackingProvider {
  switch (process.env.TRACKING_PROVIDER) {
    // case "sagawa": return sagawaTrackingProvider  // Phase B: 佐川お荷物問い合わせAPI
    case "shipandco":
    default:
      return shipandcoTrackingProvider
  }
}

export type { TrackingProvider, TrackingResult } from "./types"
