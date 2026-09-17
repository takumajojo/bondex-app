// 名前の「読み方」を概算でカタカナに変換する (管理者画面の補助表示用)。
//
// 訪日客の氏名はローマ字/英語が多いため、完全な発音再現は不可能。あくまで日本人スタッフが
// 口頭確認するときの目安 (概算) として、ローマ字を音節単位でカタカナへ写す。
//  - すでにカタカナ/漢字などの非ASCIIを含む場合は、ひらがな→カタカナのみ行い他はそのまま返す
//    (漢字の読みは辞書が無いと出せないため無理に変換しない)。
//  - 記号・数字・不明な綴りはそのまま残す (概算なので欠落させない)。

// 2文字以上の綴り (母音結合・拗音・英語二重字) を優先的に照合する。
const MULTI: Record<string, string> = {
  // 拗音・二重字
  kya: "キャ", kyu: "キュ", kyo: "キョ", sha: "シャ", shi: "シ", shu: "シュ", sho: "ショ",
  cha: "チャ", chi: "チ", chu: "チュ", cho: "チョ", tsu: "ツ",
  nya: "ニャ", nyu: "ニュ", nyo: "ニョ", hya: "ヒャ", hyu: "ヒュ", hyo: "ヒョ",
  mya: "ミャ", myu: "ミュ", myo: "ミョ", rya: "リャ", ryu: "リュ", ryo: "リョ",
  gya: "ギャ", gyu: "ギュ", gyo: "ギョ", ja: "ジャ", ju: "ジュ", jo: "ジョ", ji: "ジ",
  bya: "ビャ", byu: "ビュ", byo: "ビョ", pya: "ピャ", pyu: "ピュ", pyo: "ピョ",
  // 英語二重字の近似
  th: "ス", ph: "フ", ck: "ック", ng: "ング", qu: "ク", wh: "ホ",
  che: "チェ", she: "シェ", tche: "チェ",
  // 母音の伸ばし
  ou: "オー", oo: "ウー", ee: "イー", ai: "アイ", ei: "エイ", au: "アウ",
}

const SINGLE_CV: Record<string, string> = {
  ka: "カ", ki: "キ", ku: "ク", ke: "ケ", ko: "コ",
  sa: "サ", si: "シ", su: "ス", se: "セ", so: "ソ",
  ta: "タ", ti: "ティ", tu: "トゥ", te: "テ", to: "ト",
  na: "ナ", ni: "ニ", nu: "ヌ", ne: "ネ", no: "ノ",
  ha: "ハ", hi: "ヒ", hu: "フ", fu: "フ", he: "ヘ", ho: "ホ",
  ma: "マ", mi: "ミ", mu: "ム", me: "メ", mo: "モ",
  ya: "ヤ", yu: "ユ", yo: "ヨ",
  ra: "ラ", ri: "リ", ru: "ル", re: "レ", ro: "ロ",
  la: "ラ", li: "リ", lu: "ル", le: "レ", lo: "ロ",
  wa: "ワ", wo: "ヲ", wi: "ウィ", we: "ウェ",
  ga: "ガ", gi: "ギ", gu: "グ", ge: "ゲ", go: "ゴ",
  za: "ザ", zi: "ジ", zu: "ズ", ze: "ゼ", zo: "ゾ",
  da: "ダ", di: "ディ", du: "ドゥ", de: "デ", do: "ド",
  ba: "バ", bi: "ビ", bu: "ブ", be: "ベ", bo: "ボ",
  pa: "パ", pi: "ピ", pu: "プ", pe: "ペ", po: "ポ",
  fa: "ファ", fi: "フィ", fe: "フェ", fo: "フォ",
  va: "ヴァ", vi: "ヴィ", vu: "ヴ", ve: "ヴェ", vo: "ヴォ",
  ja: "ジャ", ju: "ジュ", je: "ジェ", jo: "ジョ",
  ca: "カ", ci: "シ", cu: "ク", ce: "セ", co: "コ",
}

const VOWEL: Record<string, string> = { a: "ア", i: "イ", u: "ウ", e: "エ", o: "オ" }
// 語末・母音が続かない子音の補助 (概算): 子音＋ウ段で近似。
const CONSONANT_ALONE: Record<string, string> = {
  b: "ブ", c: "ク", d: "ド", f: "フ", g: "グ", h: "フ", j: "ジュ", k: "ク", l: "ル",
  m: "ム", p: "プ", q: "ク", r: "ル", s: "ス", t: "ト", v: "ヴ", w: "ウ", x: "クス", z: "ズ", y: "イ",
}
const VOWELS = new Set(["a", "i", "u", "e", "o"])

function isAsciiLetters(s: string): boolean {
  return /^[A-Za-z]+$/.test(s)
}

// ひらがな → カタカナ
function hiraToKata(s: string): string {
  return s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
}

// 1 トークン (空白・記号で区切られた語) をカタカナ概算に変換する。
function tokenToKana(tokenRaw: string): string {
  const token = tokenRaw.toLowerCase()
  if (!isAsciiLetters(token)) {
    // 非ASCII: ひらがなだけカタカナ化し、他 (漢字等) はそのまま。
    return hiraToKata(tokenRaw)
  }
  let out = ""
  let i = 0
  const n = token.length
  while (i < n) {
    const c = token[i]
    // 促音: 同じ子音の連続 (母音・n を除く) → ッ
    if (c === token[i + 1] && !VOWELS.has(c) && c !== "n") {
      out += "ッ"
      i += 1
      continue
    }
    // 3文字一致 (拗音)
    const three = token.slice(i, i + 3)
    if (MULTI[three]) { out += MULTI[three]; i += 3; continue }
    // 2文字一致 (二重字・母音結合)
    const two = token.slice(i, i + 2)
    if (MULTI[two]) { out += MULTI[two]; i += 2; continue }
    if (SINGLE_CV[two]) { out += SINGLE_CV[two]; i += 2; continue }
    // 母音の後などで子音に続く 'h' は英語では無音になりやすい (john→ジョン)。母音が続く ha/hi.. は
    // 上の SINGLE_CV で処理済みなので、ここに来る 'h' (次が非母音) は概算として黙字化する。
    if (c === "h" && !VOWELS.has(token[i + 1] ?? "")) { i += 1; continue }
    // 'n' は次が母音/ y でなければ撥音 ン
    if (c === "n") {
      const next = token[i + 1]
      if (!next || (!VOWELS.has(next) && next !== "y")) { out += "ン"; i += 1; continue }
    }
    // 単母音
    if (VOWEL[c]) { out += VOWEL[c]; i += 1; continue }
    // 単独子音 (概算)
    if (CONSONANT_ALONE[c]) { out += CONSONANT_ALONE[c]; i += 1; continue }
    // 不明: そのまま
    out += tokenRaw[i] ?? c
    i += 1
  }
  return out
}

/**
 * 氏名を概算カタカナ読みに変換する。空白区切りは「・」で連結 (foreign name 慣習)。
 * 返り値が入力と実質同じ (変換されなかった) 場合は空文字を返し、呼び出し側で非表示にできる。
 */
export function toKatakanaReading(name: string | null | undefined): string {
  const src = (name ?? "").trim()
  if (!src) return ""
  const tokens = src.split(/[\s　]+/).filter(Boolean)
  const kana = tokens.map(tokenToKana).join("・")
  // 変換結果が元と同じ (ASCIIが1文字も無い等) なら目安として無意味なので空に。
  if (!kana || kana === src) return ""
  return kana
}
