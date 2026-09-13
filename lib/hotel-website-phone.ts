/**
 * ホテルの電話番号を「公式サイトから」取得する (Google の電話データは使わない)。
 *
 * 手順:
 *   1. place_id から Google Places Details の `website` フィールドで公式サイトURLだけ取得
 *      (URL探索にのみ Google を使う。電話番号は Google からは取らない)。
 *   2. その公式サイトのページHTMLを取得し、日本の電話番号を抽出する (best-effort)。
 *   3. 抽出できた番号と抽出元URLを「候補」として返す。運用担当が確認して確定する。
 *
 * 抽出は best-effort。番号がテキストで載っていれば拾えるが、画像化されている・
 * 問い合わせページの奥にある等では拾えない。その場合は phone:null + website だけ返し、
 * UI 側は公式サイトのリンクを出して手入力させる。
 */

const PLACES_BASE = "https://maps.googleapis.com/maps/api/place"
const FETCH_TIMEOUT_MS = 8000
const MAX_HTML_BYTES = 600_000

/** place_id からホテル公式サイトの URL を取得する (Google は URL 探索にのみ使用)。 */
export async function getOfficialWebsite(placeId: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey || !placeId) return null
  const url = `${PLACES_BASE}/details/json?place_id=${encodeURIComponent(placeId)}&fields=website&language=ja&key=${apiKey}`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer))
    if (!res.ok) return null
    const data = (await res.json()) as { result?: { website?: string } }
    const site = data.result?.website
    return typeof site === "string" && /^https?:\/\//i.test(site) ? site : null
  } catch (e) {
    console.error("[hotel-website-phone] getOfficialWebsite failed:", e instanceof Error ? e.message : e)
    return null
  }
}

/** 全角の数字・記号を半角へ寄せる (日本語サイトは全角電話が多い)。 */
function toHalfWidth(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[‐‑‒–—―ー－−]/g, "-")
    .replace(/[（(]/g, "(")
    .replace(/[）)]/g, ")")
}

/** 電話文字列を 0X-XXXX-XXXX 形へ正規化。妥当な桁(10-11桁・先頭0)でなければ null。 */
function normalizeJpPhone(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "")
  if (!/^0\d{9,10}$/.test(digits)) return null
  // 主要な区切りに整形 (0120/0800 は 4-3-3、携帯 090/080/070 は 3-4-4、その他は元表記優先)。
  return raw.replace(/\s+/g, "").replace(/[.(]/g, "-").replace(/\)/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
}

/**
 * HTML本文から日本の電話番号を抽出する。優先度:
 *   1) tel: リンク
 *   2) 「TEL/電話/ご予約」等のラベル近傍にある番号
 *   3) それ以外で最初に見つかった妥当な番号
 */
export function extractPhoneFromHtml(htmlRaw: string): { phone: string; raw: string } | null {
  const html = toHalfWidth(htmlRaw)

  // 1) tel: リンク
  const telLink = html.match(/tel:\s*([+]?[\d().\- ]{9,18})/i)
  if (telLink) {
    const norm = normalizeJpPhone(telLink[1].replace(/^\+81/, "0"))
    if (norm) return { phone: norm, raw: telLink[1].trim() }
  }

  // 妥当な JP 電話のパターン (先頭0・区切りあり)。市外局番1-4桁 - 1-4桁 - 4桁。
  const phoneRe = /0\d{1,4}-\d{1,4}-\d{3,4}/g

  // 2) ラベル近傍を優先
  const labelRe = /(?:TEL|Tel|tel|電話|お電話|ご予約|予約|Phone|PHONE)[^0-9]{0,12}(0\d{1,4}-\d{1,4}-\d{3,4})/g
  let m: RegExpExecArray | null
  while ((m = labelRe.exec(html)) !== null) {
    const norm = normalizeJpPhone(m[1])
    if (norm) return { phone: norm, raw: m[1] }
  }

  // 3) 最初の妥当な番号
  while ((m = phoneRe.exec(html)) !== null) {
    const norm = normalizeJpPhone(m[0])
    if (norm) return { phone: norm, raw: m[0] }
  }
  return null
}

export interface HotelPhoneLookup {
  website: string | null
  phone: string | null
  /** 電話を抽出したページのURL (根拠)。抽出できなければ null。 */
  source: string | null
  /** 抽出できなかった理由 (UI 補助)。 */
  note?: string
}

/** 与えられた URL のページを取得して電話番号を抽出する。 */
export async function fetchPhoneFromWebsite(website: string): Promise<{ phone: string | null; note?: string }> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(website, {
      signal: controller.signal,
      headers: {
        // 一般的なブラウザ相当。日本語ページを優先。
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
        "Accept-Language": "ja,en;q=0.8",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    }).finally(() => clearTimeout(timer))
    if (!res.ok) return { phone: null, note: `サイト取得に失敗 (HTTP ${res.status})` }
    const ct = res.headers.get("content-type") || ""
    if (!/html|text/i.test(ct)) return { phone: null, note: "HTMLページではありません" }
    const buf = await res.arrayBuffer()
    const html = new TextDecoder("utf-8").decode(buf.slice(0, MAX_HTML_BYTES))
    const found = extractPhoneFromHtml(html)
    if (!found) return { phone: null, note: "ページから電話番号を抽出できませんでした" }
    return { phone: found.phone }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { phone: null, note: `サイト取得エラー (${msg})` }
  }
}

/**
 * place_id (と任意で既知の website) から、公式サイト由来の電話番号を引く。
 * website 未指定なら place_id から公式サイトURLを取得してから読む。
 */
export async function lookupHotelPhone(params: {
  placeId?: string | null
  website?: string | null
}): Promise<HotelPhoneLookup> {
  let website = params.website && /^https?:\/\//i.test(params.website) ? params.website : null
  if (!website && params.placeId) {
    website = await getOfficialWebsite(params.placeId)
  }
  if (!website) {
    return { website: null, phone: null, source: null, note: "公式サイトのURLが見つかりませんでした" }
  }
  const { phone, note } = await fetchPhoneFromWebsite(website)
  return { website, phone, source: phone ? website : null, note: phone ? undefined : note }
}
