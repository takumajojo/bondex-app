"use client"

import { useEffect, useState } from "react"
import Script from "next/script"

// ConsentBanner と同じ同意フラグに連動させる。
// HubSpot もトラッキング Cookie を置くため、GA と同じく「同意後のみ」読み込む
// (既定 denied のポリシーと外部送信規律への配慮を GA と揃える)。
const STORAGE_KEY = "bondex_analytics_consent" // "granted" | "denied"

// HubSpot トラッキングコード (アカウント 247107122 / na2 リージョン)。
const HUBSPOT_SRC = "https://js-na2.hs-scripts.com/247107122.js"

/**
 * HubSpot トラッキングを「解析 Cookie 同意後のみ」読み込む。
 *  - 既に granted 保存済み → マウント時に読み込む
 *  - 未選択 → 何もしない。ConsentBanner の「同意する」で
 *    'bondex-consent-granted' イベントが飛んだら読み込む (再読込不要)
 *  - denied → 一切読み込まない
 */
export function HubSpotTracking() {
  const [load, setLoad] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "granted") setLoad(true)
    } catch {
      // localStorage 不可 (プライベートブラウズ等) → 既定 denied のまま読み込まない
    }
    const onGrant = () => setLoad(true)
    window.addEventListener("bondex-consent-granted", onGrant)
    return () => window.removeEventListener("bondex-consent-granted", onGrant)
  }, [])

  if (!load) return null

  return <Script id="hs-script-loader" strategy="afterInteractive" src={HUBSPOT_SRC} />
}
