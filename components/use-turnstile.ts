"use client"

import { useEffect, useRef, useState } from "react"

// Cloudflare Turnstile のサイトキー。未設定なら CAPTCHA を出さず、フォームは従来通り動く。
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string
      reset: (id?: string) => void
    }
  }
}

/**
 * Cloudflare Turnstile をフォームに組み込む共有フック(contact / signup 等で共用)。
 *   enabled     : サイトキー設定時のみ true
 *   ref         : ウィジェットを描画する <div> に付ける
 *   token       : 検証トークン。送信 body に turnstileToken として載せる
 *   blockSubmit : 送信ボタンを無効化すべきか (enabled かつ 未検証 かつ 失敗もしていない)
 * フェイルセーフ: 描画失敗 / スクリプト遮断 / 8秒でトークン未取得 の場合は failed=true にし、
 * 送信をブロックしない(第三者ウィジェットの不調でフォームを詰まらせない)。
 */
export function useTurnstile() {
  const [token, setToken] = useState("")
  const [failed, setFailed] = useState(false)
  const tokenRef = useRef("")
  const ref = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  const enabled = !!TURNSTILE_SITE_KEY

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return
    const setTok = (v: string) => {
      tokenRef.current = v
      setToken(v)
    }
    const render = () => {
      if (!window.turnstile || !ref.current || widgetId.current) return
      try {
        widgetId.current = window.turnstile.render(ref.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (t: string) => setTok(t),
          "expired-callback": () => setTok(""),
          "error-callback": () => setFailed(true),
        })
      } catch {
        setFailed(true)
      }
    }
    if (window.turnstile) {
      render()
    } else {
      const id = "cf-turnstile-script"
      let script = document.getElementById(id) as HTMLScriptElement | null
      if (!script) {
        script = document.createElement("script")
        script.id = id
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        script.async = true
        script.defer = true
        script.addEventListener("error", () => setFailed(true))
        document.head.appendChild(script)
      }
      script.addEventListener("load", render)
    }
    // 保険: 8秒たってもトークンが取れなければ CAPTCHA 無しとして送信を許可。
    const failTimer = setTimeout(() => {
      if (!tokenRef.current) setFailed(true)
    }, 8000)
    return () => clearTimeout(failTimer)
  }, [])

  return { enabled, ref, token, failed, blockSubmit: enabled && !token && !failed }
}
