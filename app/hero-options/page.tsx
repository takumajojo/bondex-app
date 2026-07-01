// 一時プレビューページ: ヒーロー SVG 3 案を横並びで比較。
// 谷口さんが A/B/C から選んだら、その SVG を app/page.tsx の Hero に組み込み、
// このファイルは削除する。

export const dynamic = "force-static"

export default function HeroOptionsPage() {
  return (
    <main className="min-h-screen bg-[#FAF7F2] text-[#111] py-12">
      <div className="max-w-5xl mx-auto px-6 mb-12">
        <h1 className="text-3xl font-semibold mb-3">Hero SVG 3 案</h1>
        <p className="text-sm text-[#111]/70 leading-relaxed">
          クリーム背景・墨インク色で統一。A/B/C 好きなものを選んでください。
          この URL は一時的なものです。選んだあとメインの LP に組み込んで、このページは消します。
        </p>
      </div>

      {/* ─────── A: 浮世絵風・大波 + スーツケース ─────── */}
      <section className="max-w-5xl mx-auto px-6 mb-16">
        <div className="mb-4 flex items-baseline gap-3">
          <span className="text-3xl font-bold tracking-tight">A.</span>
          <div>
            <h2 className="text-xl font-semibold">大波を渡る荷物</h2>
            <p className="text-sm text-[#111]/60 mt-1">
              浮世絵 (葛飾北斎「神奈川沖浪裏」) からの引用。BondEx ロゴの江戸系トーンに直結、
              日本らしさ + 「荷物が旅をする」メタファ。
            </p>
          </div>
        </div>
        <div className="bg-white rounded border border-[#111]/10 p-8">
          <svg viewBox="0 0 720 300" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto">
            {/* Cream sky area (transparent) */}
            {/* Sun/moon disc */}
            <circle cx="600" cy="70" r="34" fill="#111" opacity="0.12" />
            {/* Distant land silhouette (Mt Fuji hint) */}
            <path
              d="M 470 210 L 540 130 L 570 155 L 600 130 L 660 210 Z"
              fill="#111"
              opacity="0.18"
            />

            {/* Main wave */}
            <path
              d="M 0 240 C 80 200, 140 200, 200 220 C 240 230, 260 210, 280 190 C 300 160, 340 130, 400 130 C 450 130, 480 170, 500 200 C 530 240, 600 250, 720 220 L 720 300 L 0 300 Z"
              fill="#111"
            />
            {/* Foam curls at wave crest */}
            <path
              d="M 260 190 C 265 178, 275 178, 280 190"
              stroke="#FAF7F2"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M 300 172 C 305 158, 320 158, 328 170"
              stroke="#FAF7F2"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M 348 155 C 355 140, 375 140, 385 155"
              stroke="#FAF7F2"
              strokeWidth="2.5"
              fill="none"
              strokeLinecap="round"
            />
            <circle cx="245" cy="220" r="2.5" fill="#FAF7F2" />
            <circle cx="220" cy="230" r="2" fill="#FAF7F2" />
            <circle cx="405" cy="180" r="2.5" fill="#FAF7F2" />

            {/* Suitcase riding wave */}
            <g transform="translate(350,105)">
              <rect
                x="0"
                y="18"
                width="70"
                height="55"
                rx="3"
                fill="#FAF7F2"
                stroke="#111"
                strokeWidth="3"
              />
              <rect
                x="22"
                y="4"
                width="26"
                height="16"
                rx="3"
                fill="none"
                stroke="#111"
                strokeWidth="3"
              />
              <line x1="8" y1="35" x2="62" y2="35" stroke="#111" strokeWidth="1.8" />
              <line x1="8" y1="55" x2="62" y2="55" stroke="#111" strokeWidth="1.8" />
              <circle cx="14" cy="45" r="2" fill="#111" />
              <circle cx="56" cy="45" r="2" fill="#111" />
            </g>
          </svg>
        </div>
      </section>

      {/* ─────── B: 日本地図 + 都市を結ぶライン ─────── */}
      <section className="max-w-5xl mx-auto px-6 mb-16">
        <div className="mb-4 flex items-baseline gap-3">
          <span className="text-3xl font-bold tracking-tight">B.</span>
          <div>
            <h2 className="text-xl font-semibold">日本の全ホテルを結ぶ</h2>
            <p className="text-sm text-[#111]/60 mt-1">
              簡略化した日本地図に主要都市 (東京・京都・大阪など) をプロット、
              点線で連結。BondEx が全国のホテル間物流を支える視覚化。
            </p>
          </div>
        </div>
        <div className="bg-white rounded border border-[#111]/10 p-8">
          <svg viewBox="0 0 720 320" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto">
            {/* Simplified Japan silhouette (Honshu focus, Hokkaido + Kyushu hint) */}
            {/* Hokkaido */}
            <path
              d="M 545 55 Q 580 40 615 55 Q 635 75 620 95 Q 590 110 555 100 Q 535 80 545 55 Z"
              fill="none"
              stroke="#111"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            {/* Honshu (main island, elongated diagonal) */}
            <path
              d="M 180 265 Q 200 240 240 235 Q 290 230 340 215 Q 400 195 450 180 Q 500 160 540 145 Q 555 140 555 155 Q 550 175 510 195 Q 460 220 400 240 Q 340 260 285 280 Q 240 295 205 290 Q 180 285 180 265 Z"
              fill="none"
              stroke="#111"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            {/* Kyushu */}
            <path
              d="M 115 265 Q 145 250 165 265 Q 175 290 160 305 Q 130 315 110 300 Q 100 280 115 265 Z"
              fill="none"
              stroke="#111"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            {/* Shikoku */}
            <path
              d="M 195 270 Q 220 265 235 275 Q 240 290 225 295 Q 200 292 190 285 Z"
              fill="none"
              stroke="#111"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />

            {/* Travel lines connecting cities */}
            <path
              d="M 430 210 Q 350 170 300 220 Q 260 260 155 285"
              stroke="#111"
              strokeWidth="1.5"
              fill="none"
              strokeDasharray="3 5"
              opacity="0.55"
            />
            <path
              d="M 430 210 Q 500 180 585 78"
              stroke="#111"
              strokeWidth="1.5"
              fill="none"
              strokeDasharray="3 5"
              opacity="0.55"
            />

            {/* City nodes with labels */}
            {[
              { x: 430, y: 210, label: "TOKYO" },
              { x: 300, y: 220, label: "KYOTO" },
              { x: 270, y: 232, label: "OSAKA", offsetY: 14 },
              { x: 155, y: 285, label: "FUKUOKA" },
              { x: 585, y: 78, label: "SAPPORO" },
            ].map((c) => (
              <g key={c.label}>
                <circle cx={c.x} cy={c.y} r="6" fill="#111" />
                <circle cx={c.x} cy={c.y} r="12" fill="none" stroke="#111" strokeWidth="1" opacity="0.3" />
                <text
                  x={c.x}
                  y={c.y - 12 + (c.offsetY || 0)}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#111"
                  fontFamily="serif"
                  letterSpacing="2"
                >
                  {c.label}
                </text>
              </g>
            ))}

            {/* Suitcase icon in transit — moving between Kyoto and Tokyo */}
            <g transform="translate(355,180)">
              <rect x="0" y="6" width="20" height="24" rx="2" fill="#111" />
              <rect x="5" y="0" width="10" height="7" rx="2" fill="none" stroke="#111" strokeWidth="1.5" />
              <line x1="3" y1="15" x2="17" y2="15" stroke="#FAF7F2" strokeWidth="1" />
            </g>
          </svg>
        </div>
      </section>

      {/* ─────── C: 青海波パターン + 大きな一文字「託」 ─────── */}
      <section className="max-w-5xl mx-auto px-6 mb-16">
        <div className="mb-4 flex items-baseline gap-3">
          <span className="text-3xl font-bold tracking-tight">C.</span>
          <div>
            <h2 className="text-xl font-semibold">青海波 × 「託」</h2>
            <p className="text-sm text-[#111]/60 mt-1">
              和柄「青海波」を背景に、大きな漢字一文字「託」(あずける・たくす)。
              エディトリアル / ミニマル、他社にほぼ真似できない差別化。
            </p>
          </div>
        </div>
        <div className="bg-white rounded border border-[#111]/10 p-8 overflow-hidden">
          <svg viewBox="0 0 720 280" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto">
            <defs>
              {/* Seigaiha wave pattern */}
              <pattern id="seigaiha" x="0" y="0" width="40" height="20" patternUnits="userSpaceOnUse">
                <circle cx="20" cy="20" r="18" fill="none" stroke="#111" strokeWidth="0.7" opacity="0.25" />
                <circle cx="20" cy="20" r="12" fill="none" stroke="#111" strokeWidth="0.7" opacity="0.25" />
                <circle cx="20" cy="20" r="6" fill="none" stroke="#111" strokeWidth="0.7" opacity="0.25" />
                <circle cx="0" cy="20" r="18" fill="none" stroke="#111" strokeWidth="0.7" opacity="0.25" />
                <circle cx="40" cy="20" r="18" fill="none" stroke="#111" strokeWidth="0.7" opacity="0.25" />
              </pattern>
            </defs>

            {/* Pattern background */}
            <rect x="0" y="0" width="720" height="280" fill="url(#seigaiha)" />

            {/* Big center kanji "託" — 意味: あずける・たくす */}
            <text
              x="360"
              y="205"
              textAnchor="middle"
              fontSize="240"
              fill="#111"
              fontFamily="'Yu Mincho', 'Hiragino Mincho ProN', 'Noto Serif JP', serif"
              fontWeight="500"
            >
              託
            </text>

            {/* Small subtitle below */}
            <text
              x="360"
              y="245"
              textAnchor="middle"
              fontSize="10"
              fill="#111"
              opacity="0.6"
              fontFamily="serif"
              letterSpacing="6"
            >
              ENTRUST YOUR LUGGAGE
            </text>
          </svg>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-6 pt-8 pb-16 border-t border-[#111]/10">
        <p className="text-sm text-[#111]/60 leading-relaxed">
          <strong>選び方:</strong> チャットに「A で」「B と C の間くらい」「A の波をもう少し弱く」など、
          率直に感想を送ってください。組み込み後、このプレビューページ (
          <code className="text-[11px] bg-[#111]/5 px-1.5 py-0.5 rounded">/hero-options</code>) は削除します。
        </p>
      </div>
    </main>
  )
}
