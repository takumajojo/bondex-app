/**
 * 営業日（土日・日本の祝日を除く平日）の計算。
 *
 * 送り状(紙)の郵送は「発送日の5営業日前までに投函」を守る必要がある。
 * 佐川・郵便は土日祝に配達が動かない日があり、暦日で数えると間に合わないため
 * 営業日で数える。
 *
 * 祝日は内閣府の「国民の祝日」CSV に基づき 2026–2028 分を直接持つ。
 * 外部APIに依存させないのは、期限計算が通信失敗で狂うと発送事故に直結するため。
 * 年が進んだら JP_HOLIDAYS に追記すること（不足しても土日は必ず除外される）。
 */

/** YYYY-MM-DD 形式の祝日。振替休日を含む。 */
const JP_HOLIDAYS = new Set<string>([
  // 2026
  "2026-01-01", "2026-01-12", "2026-02-11", "2026-02-23", "2026-03-20",
  "2026-04-29", "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06",
  "2026-07-20", "2026-08-11", "2026-09-21", "2026-09-22", "2026-09-23",
  "2026-10-12", "2026-11-03", "2026-11-23",
  // 2027
  "2027-01-01", "2027-01-11", "2027-02-11", "2027-02-23", "2027-03-21",
  "2027-03-22", "2027-04-29", "2027-05-03", "2027-05-04", "2027-05-05",
  "2027-07-19", "2027-08-11", "2027-09-20", "2027-09-23", "2027-10-11",
  "2027-11-03", "2027-11-23",
  // 2028
  "2028-01-01", "2028-01-03", "2028-01-10", "2028-02-11", "2028-02-23",
  "2028-03-20", "2028-04-29", "2028-05-03", "2028-05-04", "2028-05-05",
  "2028-07-17", "2028-08-11", "2028-09-18", "2028-09-22", "2028-10-09",
  "2028-11-03", "2028-11-23",
])

/** YYYY-MM-DD をローカル日付として解釈する（タイムゾーンずれを避けるため UTC 正午で持つ）。 */
function parseYmd(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim())
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
  return Number.isNaN(d.getTime()) ? null : d
}

export function toYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`
}

/** 土日でも祝日でもない日か。 */
export function isBusinessDay(d: Date): boolean {
  const dow = d.getUTCDay()
  if (dow === 0 || dow === 6) return false
  return !JP_HOLIDAYS.has(toYmd(d))
}

/**
 * 基準日から n 営業日「前」の日付を返す。基準日自体は数えない。
 * 例: 金曜から3営業日前 → 火曜（土日を飛ばす）。
 */
export function businessDaysBefore(ymd: string, n: number): string | null {
  const base = parseYmd(ymd)
  if (!base) return null
  const d = new Date(base.getTime())
  let left = Math.max(0, n)
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() - 1)
    if (isBusinessDay(d)) left--
  }
  return toYmd(d)
}

/**
 * from から to までの営業日数。to が from より前なら負数。
 * from 自体は数えず、to を数える（「あと何営業日か」の直感に合わせる）。
 */
export function businessDaysBetween(fromYmd: string, toYmd_: string): number | null {
  const a = parseYmd(fromYmd)
  const b = parseYmd(toYmd_)
  if (!a || !b) return null
  const sign = b.getTime() >= a.getTime() ? 1 : -1
  const d = new Date(a.getTime())
  let count = 0
  while (toYmd(d) !== toYmd_) {
    d.setUTCDate(d.getUTCDate() + sign)
    if (isBusinessDay(d)) count++
  }
  return count * sign
}
