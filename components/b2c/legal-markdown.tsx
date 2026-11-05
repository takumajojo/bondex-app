/**
 * 規約の本文（docs/b2c/legal/*.md）を表示する、ごく小さな Markdown の表示（見出し・段落・箇条書き・番号付き・表・太字）。
 * 本文は当社が書いた固定のファイルだけ（利用者の入力は表示しない）。HTML は解釈せず、文字としてそのまま出す。
 * 「第7条」「Article 7」の見出しには id="article-7" を付ける（予約の画面の「送れない物の一覧」のリンク先）。
 */
import type { ReactNode } from "react"

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, i) =>
    part.startsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : part,
  )
}

function articleId(heading: string): string | undefined {
  const m = /^第(\d+)条/.exec(heading) ?? /^Article (\d+)/.exec(heading)
  return m ? `article-${m[1]}` : undefined
}

export function LegalMarkdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n")
  const out: ReactNode[] = []
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === "") { i++; continue }
    if (line.startsWith("# ")) { out.push(<h1 key={key++} className="text-2xl font-bold leading-tight">{inline(line.slice(2))}</h1>); i++; continue }
    if (line.startsWith("## ")) {
      const h = line.slice(3)
      out.push(<h2 key={key++} id={articleId(h)} className="mt-8 scroll-mt-4 text-lg font-semibold">{inline(h)}</h2>)
      i++
      continue
    }
    if (line.startsWith("|")) {
      const rows: string[][] = []
      while (i < lines.length && lines[i].startsWith("|")) {
        if (!/^\|[\s|:-]+\|$/.test(lines[i].trim())) rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()))
        i++
      }
      const [head, ...body] = rows
      out.push(
        // 3列以上の表はスマホで列が潰れないよう、表の中だけ横に動かす（ページ全体は横に動かない）
        <div key={key++} className="mt-3 overflow-x-auto">
          <table className={`w-full border-collapse text-sm ${head.length >= 3 ? "min-w-[34rem]" : ""}`}>
            <thead><tr>{head.map((c, j) => <th key={j} className="border px-2 py-1.5 text-left align-top font-semibold">{inline(c)}</th>)}</tr></thead>
            <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} className="border px-2 py-1.5 align-top">{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      )
      continue
    }
    if (/^\d+\.\s/.test(line)) {
      const items: { text: string; sub: string[] }[] = []
      while (i < lines.length && (/^\d+\.\s/.test(lines[i]) || /^\s+-\s/.test(lines[i]))) {
        if (/^\d+\.\s/.test(lines[i])) items.push({ text: lines[i].replace(/^\d+\.\s/, ""), sub: [] })
        else items[items.length - 1]?.sub.push(lines[i].replace(/^\s+-\s/, ""))
        i++
      }
      out.push(
        <ol key={key++} className="mt-3 list-decimal space-y-1.5 pl-6">
          {items.map((it, j) => (
            <li key={j}>{inline(it.text)}{it.sub.length ? <ul className="mt-1 list-disc space-y-1 pl-5">{it.sub.map((s, k) => <li key={k}>{inline(s)}</li>)}</ul> : null}</li>
          ))}
        </ol>,
      )
      continue
    }
    if (/^-\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^-\s/.test(lines[i])) { items.push(lines[i].slice(2)); i++ }
      out.push(<ul key={key++} className="mt-3 list-disc space-y-1 pl-6">{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>)
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() !== "" && !/^(#|\||\d+\.\s|-\s)/.test(lines[i])) { para.push(lines[i]); i++ }
    out.push(<p key={key++} className="mt-3 whitespace-pre-line">{inline(para.join("\n"))}</p>)
  }
  return <div className="text-[15px] leading-relaxed">{out}</div>
}
