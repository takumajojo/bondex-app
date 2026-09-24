/**
 * バウチャー表示用の「エリア名」(例: 東京 / TOKYO) を住所から導く。
 *
 * デザイン上、区間は「TOKYO → HIDA TAKAYAMA ／ 東京 → 飛騨高山」のように旅行者が
 * 認識している地名で見せる。予約データが持つのは住所と市区町村 (例: 新宿区) だけなので、
 *   1. 観光地として通称のある市町 (高山市 → 飛騨高山 など) を優先
 *   2. 無ければ都道府県名
 * の順で解決する。どちらにも当たらない (海外住所・表記ゆれ) 場合は null を返し、
 * 呼び出し側はホテル名にフォールバックする。
 */
export type VoucherArea = { ja: string; en: string }

// 通称のある主要観光地。住所の部分一致で判定するため、より具体的なものを先に置く。
const CITY_AREAS: Array<[match: string, area: VoucherArea]> = [
  ["高山市", { ja: "飛騨高山", en: "HIDA TAKAYAMA" }],
  ["白川村", { ja: "白川郷", en: "SHIRAKAWA-GO" }],
  ["箱根町", { ja: "箱根", en: "HAKONE" }],
  ["日光市", { ja: "日光", en: "NIKKO" }],
  ["鎌倉市", { ja: "鎌倉", en: "KAMAKURA" }],
  ["横浜市", { ja: "横浜", en: "YOKOHAMA" }],
  ["富士河口湖町", { ja: "河口湖", en: "KAWAGUCHIKO" }],
  ["軽井沢町", { ja: "軽井沢", en: "KARUIZAWA" }],
  ["松本市", { ja: "松本", en: "MATSUMOTO" }],
  ["金沢市", { ja: "金沢", en: "KANAZAWA" }],
  ["名古屋市", { ja: "名古屋", en: "NAGOYA" }],
  ["伊勢市", { ja: "伊勢", en: "ISE" }],
  ["神戸市", { ja: "神戸", en: "KOBE" }],
  ["姫路市", { ja: "姫路", en: "HIMEJI" }],
  ["高野町", { ja: "高野山", en: "KOYASAN" }],
  ["倉敷市", { ja: "倉敷", en: "KURASHIKI" }],
  ["廿日市市", { ja: "宮島", en: "MIYAJIMA" }],
  ["直島町", { ja: "直島", en: "NAOSHIMA" }],
  ["別府市", { ja: "別府", en: "BEPPU" }],
  ["由布市", { ja: "由布院", en: "YUFUIN" }],
  ["札幌市", { ja: "札幌", en: "SAPPORO" }],
  ["函館市", { ja: "函館", en: "HAKODATE" }],
  ["仙台市", { ja: "仙台", en: "SENDAI" }],
  ["那覇市", { ja: "那覇", en: "NAHA" }],
]

const PREFECTURES: Array<[match: string, area: VoucherArea]> = [
  ["北海道", { ja: "北海道", en: "HOKKAIDO" }], ["青森県", { ja: "青森", en: "AOMORI" }],
  ["岩手県", { ja: "岩手", en: "IWATE" }], ["宮城県", { ja: "宮城", en: "MIYAGI" }],
  ["秋田県", { ja: "秋田", en: "AKITA" }], ["山形県", { ja: "山形", en: "YAMAGATA" }],
  ["福島県", { ja: "福島", en: "FUKUSHIMA" }], ["茨城県", { ja: "茨城", en: "IBARAKI" }],
  ["栃木県", { ja: "栃木", en: "TOCHIGI" }], ["群馬県", { ja: "群馬", en: "GUNMA" }],
  ["埼玉県", { ja: "埼玉", en: "SAITAMA" }], ["千葉県", { ja: "千葉", en: "CHIBA" }],
  ["東京都", { ja: "東京", en: "TOKYO" }], ["神奈川県", { ja: "神奈川", en: "KANAGAWA" }],
  ["新潟県", { ja: "新潟", en: "NIIGATA" }], ["富山県", { ja: "富山", en: "TOYAMA" }],
  ["石川県", { ja: "石川", en: "ISHIKAWA" }], ["福井県", { ja: "福井", en: "FUKUI" }],
  ["山梨県", { ja: "山梨", en: "YAMANASHI" }], ["長野県", { ja: "長野", en: "NAGANO" }],
  ["岐阜県", { ja: "岐阜", en: "GIFU" }], ["静岡県", { ja: "静岡", en: "SHIZUOKA" }],
  ["愛知県", { ja: "愛知", en: "AICHI" }], ["三重県", { ja: "三重", en: "MIE" }],
  ["滋賀県", { ja: "滋賀", en: "SHIGA" }], ["京都府", { ja: "京都", en: "KYOTO" }],
  ["大阪府", { ja: "大阪", en: "OSAKA" }], ["兵庫県", { ja: "兵庫", en: "HYOGO" }],
  ["奈良県", { ja: "奈良", en: "NARA" }], ["和歌山県", { ja: "和歌山", en: "WAKAYAMA" }],
  ["鳥取県", { ja: "鳥取", en: "TOTTORI" }], ["島根県", { ja: "島根", en: "SHIMANE" }],
  ["岡山県", { ja: "岡山", en: "OKAYAMA" }], ["広島県", { ja: "広島", en: "HIROSHIMA" }],
  ["山口県", { ja: "山口", en: "YAMAGUCHI" }], ["徳島県", { ja: "徳島", en: "TOKUSHIMA" }],
  ["香川県", { ja: "香川", en: "KAGAWA" }], ["愛媛県", { ja: "愛媛", en: "EHIME" }],
  ["高知県", { ja: "高知", en: "KOCHI" }], ["福岡県", { ja: "福岡", en: "FUKUOKA" }],
  ["佐賀県", { ja: "佐賀", en: "SAGA" }], ["長崎県", { ja: "長崎", en: "NAGASAKI" }],
  ["熊本県", { ja: "熊本", en: "KUMAMOTO" }], ["大分県", { ja: "大分", en: "OITA" }],
  ["宮崎県", { ja: "宮崎", en: "MIYAZAKI" }], ["鹿児島県", { ja: "鹿児島", en: "KAGOSHIMA" }],
  ["沖縄県", { ja: "沖縄", en: "OKINAWA" }],
]

// 東京23区・政令市の区名など、都道府県名を含まない市区町村表記 (予約データの city はこの粒度が多い)
const WARD_AREAS: Array<[match: string, area: VoucherArea]> = [
  // 政令市を先に判定する (「大阪市北区」が東京の「北区」に当たらないように)
  ["京都市", { ja: "京都", en: "KYOTO" }],
  ["大阪市", { ja: "大阪", en: "OSAKA" }],
  ["名古屋市", { ja: "名古屋", en: "NAGOYA" }],
  ["横浜市", { ja: "横浜", en: "YOKOHAMA" }],
  ["神戸市", { ja: "神戸", en: "KOBE" }],
  ["札幌市", { ja: "札幌", en: "SAPPORO" }],
  ["福岡市", { ja: "福岡", en: "FUKUOKA" }],
  ["広島市", { ja: "広島", en: "HIROSHIMA" }],
  ["仙台市", { ja: "仙台", en: "SENDAI" }],
  ...["千代田区", "中央区", "港区", "新宿区", "文京区", "台東区", "墨田区", "江東区", "品川区", "目黒区", "大田区", "世田谷区", "渋谷区", "中野区", "杉並区", "豊島区", "北区", "荒川区", "板橋区", "練馬区", "足立区", "葛飾区", "江戸川区"].map((w): [string, VoucherArea] => [w, { ja: "東京", en: "TOKYO" }]),
  ["羽田", { ja: "羽田", en: "HANEDA" }],
  ["成田", { ja: "成田", en: "NARITA" }],
  ["奈良市", { ja: "奈良", en: "NARA" }],
  ["長崎市", { ja: "長崎", en: "NAGASAKI" }],
  ["熱海市", { ja: "熱海", en: "ATAMI" }],
  ["豊岡市", { ja: "城崎", en: "KINOSAKI" }],
  ["長野市", { ja: "長野", en: "NAGANO" }],
]

// 英語表記 (city や英語ホテル名) からの解決。単語境界で一致させる。具体的な地名を先に置く。
const EN_AREAS: Array<[keyword: string, area: VoucherArea]> = [
  ["hida takayama", { ja: "飛騨高山", en: "HIDA TAKAYAMA" }], ["takayama", { ja: "飛騨高山", en: "HIDA TAKAYAMA" }],
  ["shirakawa", { ja: "白川郷", en: "SHIRAKAWA-GO" }], ["kawaguchiko", { ja: "河口湖", en: "KAWAGUCHIKO" }],
  ["haneda", { ja: "羽田", en: "HANEDA" }], ["narita", { ja: "成田", en: "NARITA" }],
  ["shinjuku", { ja: "東京", en: "TOKYO" }], ["shibuya", { ja: "東京", en: "TOKYO" }], ["ginza", { ja: "東京", en: "TOKYO" }],
  ["asakusa", { ja: "東京", en: "TOKYO" }], ["ueno", { ja: "東京", en: "TOKYO" }], ["roppongi", { ja: "東京", en: "TOKYO" }],
  ["shinagawa", { ja: "東京", en: "TOKYO" }], ["ikebukuro", { ja: "東京", en: "TOKYO" }], ["akasaka", { ja: "東京", en: "TOKYO" }],
  ["marunouchi", { ja: "東京", en: "TOKYO" }], ["tokyo", { ja: "東京", en: "TOKYO" }],
  ["kyoto", { ja: "京都", en: "KYOTO" }], ["osaka", { ja: "大阪", en: "OSAKA" }], ["nara", { ja: "奈良", en: "NARA" }],
  ["kobe", { ja: "神戸", en: "KOBE" }], ["hakone", { ja: "箱根", en: "HAKONE" }], ["kanazawa", { ja: "金沢", en: "KANAZAWA" }],
  ["hiroshima", { ja: "広島", en: "HIROSHIMA" }], ["miyajima", { ja: "宮島", en: "MIYAJIMA" }], ["nikko", { ja: "日光", en: "NIKKO" }],
  ["kamakura", { ja: "鎌倉", en: "KAMAKURA" }], ["yokohama", { ja: "横浜", en: "YOKOHAMA" }], ["nagoya", { ja: "名古屋", en: "NAGOYA" }],
  ["sapporo", { ja: "札幌", en: "SAPPORO" }], ["hakodate", { ja: "函館", en: "HAKODATE" }], ["fukuoka", { ja: "福岡", en: "FUKUOKA" }],
  ["nagasaki", { ja: "長崎", en: "NAGASAKI" }], ["naha", { ja: "那覇", en: "NAHA" }], ["okinawa", { ja: "沖縄", en: "OKINAWA" }],
  ["sendai", { ja: "仙台", en: "SENDAI" }], ["matsumoto", { ja: "松本", en: "MATSUMOTO" }], ["karuizawa", { ja: "軽井沢", en: "KARUIZAWA" }],
  ["ise", { ja: "伊勢", en: "ISE" }], ["himeji", { ja: "姫路", en: "HIMEJI" }], ["koyasan", { ja: "高野山", en: "KOYASAN" }],
  ["beppu", { ja: "別府", en: "BEPPU" }], ["yufuin", { ja: "由布院", en: "YUFUIN" }], ["kurashiki", { ja: "倉敷", en: "KURASHIKI" }],
  ["naoshima", { ja: "直島", en: "NAOSHIMA" }], ["kinosaki", { ja: "城崎", en: "KINOSAKI" }], ["atami", { ja: "熱海", en: "ATAMI" }],
  ["niseko", { ja: "ニセコ", en: "NISEKO" }], ["otaru", { ja: "小樽", en: "OTARU" }], ["nagano", { ja: "長野", en: "NAGANO" }],
  ["fuji", { ja: "富士", en: "MT. FUJI" }],
]

/**
 * 住所・市区町村・ホテル名 (日英) から地名を解決する。日本語の手がかりを先に、次に英語の手がかりを見る。
 * どれにも当たらなければ null (呼び出し側が短い代替表記を決める)。
 */
export function voucherAreaOf(address?: string | null, city?: string | null, ...names: Array<string | null | undefined>): VoucherArea | null {
  const ja = [address, city, ...names].filter(Boolean).join(" ")
  if (ja.trim()) {
    for (const [m, a] of CITY_AREAS) if (ja.includes(m)) return a
    for (const [m, a] of WARD_AREAS) if (ja.includes(m)) return a
    for (const [m, a] of PREFECTURES) if (ja.includes(m)) return a
  }
  const en = ` ${[city, ...names].filter(Boolean).join(" ").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `
  if (en.trim()) {
    for (const [k, a] of EN_AREAS) if (en.includes(` ${k} `)) return a
  }
  return null
}

/** 地名が引けないときの短い代替: city があればそれ、無ければホテル名を先頭 18 文字に詰める。 */
export function voucherAreaFallback(city: string | null | undefined, hotelJa: string, hotelEn?: string | null): VoucherArea {
  const c = (city ?? "").trim()
  if (c) return { ja: c, en: c.toUpperCase() }
  const short = (s: string) => (s.length > 18 ? s.slice(0, 17).trimEnd() + "…" : s)
  return { ja: short(hotelJa), en: short(hotelEn?.trim() || hotelJa).toUpperCase() }
}
