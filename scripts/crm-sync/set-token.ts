/**
 * クリップボードの HubSpot トークンを .env.local に書き込む。
 *
 *   npm run crm:token
 *
 * 手でファイルを編集すると、コピー範囲のずれ (先頭の pat- が欠ける等) に
 * 気づけないまま 401 で詰まる。ここで形式を検証してから書くことで、
 * 「貼れているのに通らない」状態を作らない。
 *
 * トークンは画面にもログにも出さない。標準出力に出るのは判定結果だけ。
 */

import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { inspectTokenShape } from "../../lib/hubspot"

const ENV_PATH = path.resolve(process.cwd(), ".env.local")
const KEY = "HUBSPOT_PRIVATE_APP_TOKEN"

function readClipboard(): string {
  if (process.platform !== "darwin") {
    throw new Error("このスクリプトは macOS (pbpaste) 前提です")
  }
  return execFileSync("pbpaste", { encoding: "utf8" })
}

/** 見えない文字を除く。全角ハイフンや非改行スペースが紛れることがある */
function normalize(raw: string): string {
  return raw
    .replace(/ /g, " ")
    .replace(/[‐-―－]/g, "-")
    .trim()
}

function main(): number {
  let clipboard: string
  try {
    clipboard = normalize(readClipboard())
  } catch (err) {
    console.error(`[失敗] クリップボードを読めませんでした: ${err instanceof Error ? err.message : err}`)
    return 1
  }

  console.log("")
  if (!clipboard) {
    console.log("  ✗ クリップボードが空です")
    console.log("")
    return 1
  }

  // 形式が想定と違っても書き込みは行う。有効かどうかを決めるのは HubSpot 側で、
  // こちらの正規表現ではない (--check で実際に叩いて確かめる)。
  const problem = inspectTokenShape(clipboard)
  if (problem) {
    console.log("  ⚠ 想定と違う形式です")
    console.log(`     ${problem}`)
    console.log("     欠けている可能性がありますが、判断は HubSpot に任せて書き込みます。")
    console.log("")
  }

  if (!fs.existsSync(ENV_PATH)) {
    console.error(`[失敗] ${ENV_PATH} がありません`)
    return 1
  }

  const original = fs.readFileSync(ENV_PATH, "utf8")
  const lines = original.split("\n")
  const index = lines.findIndex((l) => l.startsWith(`${KEY}=`))
  const nextLine = `${KEY}=${clipboard}`

  if (index >= 0) {
    if (lines[index] === nextLine) {
      console.log("  · 同じ値が既に入っています (変更なし)")
      console.log("")
      return 0
    }
    lines[index] = nextLine
  } else {
    lines.push(nextLine)
  }

  // 元ファイルを退避してから書く。取り違えても戻せるようにする
  fs.copyFileSync(ENV_PATH, `${ENV_PATH}.bak`)
  fs.writeFileSync(ENV_PATH, lines.join("\n"), "utf8")

  if (!problem) console.log("  ✓ 形式は想定どおりです (pat-<地域>-<UUID> / 44文字)")
  console.log(`  ✓ ${KEY} を .env.local に${index >= 0 ? "上書き" : "追加"}しました`)
  console.log(`     退避: .env.local.bak`)
  console.log("")
  console.log("  次: npm run crm:sync -- --check")
  console.log("")
  return 0
}

process.exit(main())
