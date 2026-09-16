import fs from "fs"
import path from "path"

/**
 * PDF 用の画像アセットをモジュール読み込み時に読み切って data URI 化する。
 *
 * react-pdf の `<Image src=ファイルパス>` は読み込み失敗を黙って無視して描画を続けるため、
 * パス参照のままだと本番(Vercel serverless)で「画像だけ消えた白いページ」が静かに配られる恐れがある
 * (社印なしの契約書・ロゴなしの請求書が無言で発行される)。
 * fs.readFileSync + 静的パスなら Vercel のファイルトレースに確実に含まれ、欠落時は即例外化して
 * 「PDF生成失敗」として表面化する。
 *
 * voucher-pdf.tsx で確立した方式を contract-pdf / invoice-pdf にも共有する
 * (この種のサイレント劣化は出さない・谷口さん 2026-08-31 方針)。
 */
export function loadImageDataUri(fileName: string, mime: string): string {
  const buf = fs.readFileSync(path.join(process.cwd(), "public", fileName))
  return `data:${mime};base64,${buf.toString("base64")}`
}
