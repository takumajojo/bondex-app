// 配送キャリアの追跡リンクと進捗ステッパー。
// track ページ（旅行者向け公開ページ）と代理店ダッシュボードで共用する。
// クライアント専用APIを使わない純表示コンポーネントなので Server / Client 双方から利用可。

export const TRACK_STEPS = ["issued", "picked_up", "in_transit", "delivered"] as const

/**
 * キャリアの追跡ページへの直リンク。
 * 佐川は okurijosearch.do（送り状Noで直接照会）。okurijoinput.do は入力画面用で
 * 追跡番号付きで開くと404になるため使わない。
 */
export function carrierTrackUrl(carrier: string, num: string): string {
  return carrier === "yamato"
    ? `https://toi.kuronekoyamato.co.jp/cgi-bin/tneko?init=on&number00=1&number01=${num}`
    : `https://k2k.sagawa-exp.co.jp/p/web/okurijosearch.do?okurijoNo=${num}`
}

/**
 * Issued → Picked up → In transit → Delivered の4段ステッパー。
 * status に応じて到達段階まで緑チェックで塗る。compact=true でドットを一回り小さく。
 */
export function TrackingStepper({
  status,
  steps,
  compact = false,
}: {
  status: string | null
  steps: [string, string, string, string]
  compact?: boolean
}) {
  const idx = TRACK_STEPS.findIndex((s) => s === status)
  const activeIndex = idx === -1 ? 0 : idx
  const dot = compact ? "w-3 h-3" : "w-4 h-4"
  const label = compact ? "text-[8px]" : "text-[9px]"
  return (
    <div>
      <div className="flex items-center">
        {steps.map((_, i) => (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div
              className={`${dot} shrink-0 rounded-full border-2 flex items-center justify-center ${
                i <= activeIndex ? "bg-emerald-500 border-emerald-500" : "bg-white border-border"
              }`}
            >
              {i <= activeIndex && (
                <svg viewBox="0 0 10 10" className="w-2 h-2" fill="none">
                  <path
                    d="M2 5.2 L4.2 7.4 L8 3"
                    stroke="white"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mx-0.5 ${i < activeIndex ? "bg-emerald-500" : "bg-border"}`} />
            )}
          </div>
        ))}
      </div>
      <div className="flex mt-1">
        {steps.map((s, i) => (
          <p
            key={i}
            className={`flex-1 ${label} leading-tight ${
              i === 0 ? "text-left" : i === steps.length - 1 ? "text-right" : "text-center"
            } ${i === activeIndex ? "font-semibold text-foreground" : "text-muted-foreground"}`}
          >
            {s}
          </p>
        ))}
      </div>
    </div>
  )
}
