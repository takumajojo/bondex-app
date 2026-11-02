// Biz-Logi の項目属性 (半角数字 / 半角文字 / 指定なし) と桁数に合わせる文字ユーティリティ。
//
// 佐川の集荷依頼CSVでは「全角欄に半角」「半角英数字欄にハイフン」で差し戻しが起きた。
// Biz-Logi は住所・氏名が「半角/全角問わず」だが、郵便番号・電話・管理番号は半角限定で
// 桁数も厳しいので、送信前にここで揃えて検証する。

/** 文字数 (サロゲートペアを1文字と数える)。Biz-Logi の桁数は半角/全角を問わない文字数。 */
export function charLength(s: string): number {
  return Array.from(s).length
}

/** 全角英数字・記号を半角へ (NFKC)。ダッシュ類は "-" に寄せる。 */
export function toHankaku(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‐‑‒–—―−ー－]/g, "-")
    .trim()
}

/** 半角数字のみか。 */
export function isDigits(s: string): boolean {
  return /^[0-9]+$/.test(s)
}

/** 半角文字 (ASCII 32〜126) のみか。 */
export function isHankaku(s: string): boolean {
  return /^[\x20-\x7e]*$/.test(s)
}

/** 郵便番号 → ハイフン無し7桁。7桁にならなければ null。 */
export function normalizeYubin(s: string): string | null {
  const d = toHankaku(s).replace(/[^0-9]/g, "")
  return d.length === 7 ? d : null
}

/** 電話番号 → 半角の数字とハイフンのみ (20桁以内)。不正なら null。 */
export function normalizeTel(s: string): string | null {
  const t = toHankaku(s).replace(/[()\s]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
  if (!/^[0-9-]+$/.test(t) || !/[0-9]/.test(t) || t.length > 20) return null
  return t
}

/**
 * 管理番号 → 半角英数字のみ (記号を除去)。例: "BDX-8QRV2Y-L1" → "BDX8QRV2YL1"。
 * 佐川から「ハイフンは入力NG」と指摘済みのため、Biz-Logi でも記号を入れない。
 */
export function normalizeManageNumber(s: string): string {
  return toHankaku(s).replace(/[^0-9A-Za-z]/g, "")
}

/** yyyy-MM-dd / yyyy/MM/dd / yyyyMMdd → yyyyMMdd。暦として不正なら null。 */
export function toYmd(s: string): string | null {
  const m = /^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/.exec(s.trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${m[1]}${m[2]}${m[3]}`
}

/** yyyyMMdd 同士の日数差 (b - a)。 */
export function ymdDiffDays(a: string, b: string): number {
  const t = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)))
  return Math.round((t(b) - t(a)) / 86400000)
}

/** 日本時間の今日 (yyyyMMdd)。Biz-Logi の日付判定は日本時間。 */
export function todayJstYmd(now: Date = new Date()): string {
  const j = new Date(now.getTime() + 9 * 3600 * 1000)
  const p = (v: number) => String(v).padStart(2, "0")
  return `${j.getUTCFullYear()}${p(j.getUTCMonth() + 1)}${p(j.getUTCDate())}`
}

/**
 * 長い文字列を width 文字ずつ maxLines 行に分ける (住所1〜3、氏名1〜2 用)。
 * 空白があればそこで折り、無ければ文字数で折る。収まらなければ null (切り捨てない)。
 */
export function splitLines(text: string, width: number, maxLines: number): string[] | null {
  const src = text.replace(/[\s　]+/g, " ").trim()
  if (!src) return []
  const lines: string[] = []
  let rest = Array.from(src)
  while (rest.length) {
    if (lines.length === maxLines) return null
    if (rest.length <= width) {
      lines.push(rest.join(""))
      break
    }
    // width 文字以内で最後の空白を探す (行頭側に寄りすぎる分割は避ける)
    let cut = -1
    for (let k = width; k >= Math.ceil(width / 2); k--) {
      if (rest[k] === " ") {
        cut = k
        break
      }
    }
    if (cut < 0) cut = width
    lines.push(rest.slice(0, cut).join("").trim())
    rest = Array.from(rest.slice(cut).join("").trim())
  }
  return lines
}
