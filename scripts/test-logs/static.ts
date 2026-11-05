/**
 * ログに件名・本文・宛先・秘密を出すコードが、もう一度入っていないかの確認（2026-11-06・CI の npm test から）。
 * 実際のログの試験は scripts/test-logs/pii.ts。ここは、書き方の再発を早く止めるための補助。
 *   実行: npx tsx scripts/test-logs/static.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/** console.* の行に、この形があれば失敗（件名・本文・宛先・招待リンク・送るデータ・応答の本文・問い合わせ番号） */
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\$\{[^}]*\bsubject\b[^}]*\}/, "件名"],
  [/\.lines\.join|\blines\.join/, "通知の本文"],
  [/\bopts\.to\b|\btgt\.to\b/, "宛先のアドレス"],
  [/\bactionLink\b|action_link/, "招待リンク"],
  [/\bpayload\b/, "送るデータ"],
  [/\.text\(\)/, "外部の応答の本文"],
  [/\bbody\.slice\b/, "外部の応答の本文"],
  [/\bnormalizedEmail\b|\bemail\b\s*[,})]/, "メールアドレス"],
  [/\btrackingNumber\b/, "問い合わせ番号"],
  [/\b(representative|guest_name|from_hotel|to_hotel|formattedAddress|hotelName)\b/, "名前・ホテル・住所"],
  // error.code のような「エラーの番号」は許す（. の後ろ）。変数そのものの code・token は止める
  [/(?<![.?\w])(code|accessToken|token)\b\s*[,)]/, "認証コード・秘密"],
]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

const problems: string[] = []
let checked = 0
for (const file of [...walk("lib"), ...walk("app"), "instrumentation.ts"]) {
  const lines = readFileSync(file, "utf8").split("\n")
  lines.forEach((line, i) => {
    if (!/console\.(log|info|warn|error|debug)\(/.test(line)) return
    // 1つの呼び出しが複数の行にまたがる時は、閉じるかっこまでを見る
    let stmt = line
    for (let k = i + 1; k < Math.min(lines.length, i + 8) && (stmt.match(/\(/g) ?? []).length > (stmt.match(/\)/g) ?? []).length; k++) stmt += " " + lines[k].trim()
    checked++
    for (const [re, what] of FORBIDDEN) if (re.test(stmt)) problems.push(`${file}:${i + 1}  ${what}: ${stmt.trim().slice(0, 140)}`)
  })
}

if (problems.length) {
  console.log(`ログに出してはいけない値を出す書き方があります（lib/safe-log.ts を使う）:\n${problems.map((p) => "  " + p).join("\n")}\n\n${checked} 行を確認・${problems.length} failed`)
  process.exit(1)
}
console.log(`console の ${checked} 行を確認: 件名・本文・宛先・秘密を出す書き方は無し\n1 passed, 0 failed`)
