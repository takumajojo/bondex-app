// Biz-Logi API 用の最小 XML ユーティリティ。
//
// Biz-Logi の電文は「要素とテキストだけ」(属性・名前空間・混在内容なし) なので、
// 依存を増やさず自前で組み立て/解析する。対応範囲: XML宣言、要素、テキスト、
// CDATA、自己終了タグ、定義済み実体参照と数値文字参照。

export interface XmlNode {
  name: string
  /** 子要素を持たない要素のテキスト (前後の空白は除去)。子要素を持つ場合は ""。 */
  text: string
  children: XmlNode[]
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e === "amp") return "&"
    if (e === "lt") return "<"
    if (e === "gt") return ">"
    if (e === "quot") return '"'
    if (e === "apos") return "'"
    const cp = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
    return String.fromCodePoint(cp)
  })
}

/** CDATA で包む (仕様書の loginPassword の例に合わせる)。"]]>" を含んでも壊れないよう分割する。 */
export function cdata(s: string): RawXml {
  return { raw: `<![CDATA[${s.replace(/]]>/g, "]]]]><![CDATA[>")}]]>` }
}

export interface RawXml {
  raw: string
}

export type XmlValue = string | number | RawXml | XmlElement | XmlElement[] | null | undefined

/** [タグ名, 値]。値が null/undefined/"" の要素は出力しない (任意項目の省略)。 */
export type XmlElement = [name: string, value: XmlValue | XmlElement[]]

function isRaw(v: unknown): v is RawXml {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "raw" in v
}

function isElement(v: unknown): v is XmlElement {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === "string"
}

function renderElement([name, value]: XmlElement, depth: number): string {
  const pad = "  ".repeat(depth)
  if (value === null || value === undefined || value === "") return ""
  if (isRaw(value)) return `${pad}<${name}>${value.raw}</${name}>\n`
  if (typeof value === "string" || typeof value === "number") {
    return `${pad}<${name}>${escapeXml(String(value))}</${name}>\n`
  }
  const kids = isElement(value) ? [value] : (value as XmlElement[])
  const inner = kids.map((k) => renderElement(k, depth + 1)).join("")
  // 子が全て省略された親ノードは出さない (仕様: 親ノードは下位項目を設定する場合のみ必須)
  if (!inner) return ""
  return `${pad}<${name}>\n${inner}${pad}</${name}>\n`
}

export function buildXml(root: XmlElement): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${renderElement(root, 0)}`
}

export class XmlParseError extends Error {}

export function parseXml(src: string): XmlNode {
  let i = 0
  const n = src.length

  const skipMisc = () => {
    for (;;) {
      while (i < n && /\s/.test(src[i])) i++
      if (src.startsWith("<?", i)) {
        const e = src.indexOf("?>", i)
        if (e < 0) throw new XmlParseError("unterminated declaration")
        i = e + 2
      } else if (src.startsWith("<!--", i)) {
        const e = src.indexOf("-->", i)
        if (e < 0) throw new XmlParseError("unterminated comment")
        i = e + 3
      } else return
    }
  }

  const parseElement = (): XmlNode => {
    if (src[i] !== "<") throw new XmlParseError(`expected "<" at ${i}`)
    const close = src.indexOf(">", i)
    if (close < 0) throw new XmlParseError("unterminated tag")
    const selfClosing = src[close - 1] === "/"
    const name = src.slice(i + 1, selfClosing ? close - 1 : close).trim().split(/\s/)[0]
    if (!name) throw new XmlParseError(`empty tag name at ${i}`)
    i = close + 1
    const node: XmlNode = { name, text: "", children: [] }
    if (selfClosing) return node

    let text = ""
    for (;;) {
      if (i >= n) throw new XmlParseError(`unclosed <${name}>`)
      if (src.startsWith("<![CDATA[", i)) {
        const e = src.indexOf("]]>", i)
        if (e < 0) throw new XmlParseError("unterminated CDATA")
        text += src.slice(i + 9, e)
        i = e + 3
      } else if (src.startsWith("<!--", i)) {
        const e = src.indexOf("-->", i)
        if (e < 0) throw new XmlParseError("unterminated comment")
        i = e + 3
      } else if (src.startsWith("</", i)) {
        const e = src.indexOf(">", i)
        const closing = src.slice(i + 2, e).trim()
        if (closing !== name) throw new XmlParseError(`</${closing}> does not close <${name}>`)
        i = e + 1
        break
      } else if (src[i] === "<") {
        node.children.push(parseElement())
      } else {
        const e = src.indexOf("<", i)
        const end = e < 0 ? n : e
        text += unescapeXml(src.slice(i, end))
        i = end
      }
    }
    node.text = node.children.length ? "" : text.trim()
    return node
  }

  skipMisc()
  const root = parseElement()
  skipMisc()
  if (i < n) throw new XmlParseError(`unexpected content after root at ${i}`)
  return root
}

export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((c) => c.name === name)
}

export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node?.children.filter((c) => c.name === name) ?? []
}

/** 子要素のテキスト。要素が無い/空なら ""。 */
export function childText(node: XmlNode | undefined, name: string): string {
  return child(node, name)?.text ?? ""
}
