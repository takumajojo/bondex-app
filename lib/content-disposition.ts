/**
 * Content-Disposition ヘッダ値を安全に組み立てる。
 *
 * HTTP ヘッダ値は Latin1 (ByteString) しか許容しないため、filename に日本語等の
 * 非ASCII文字が含まれると Response 構築時に throw して 500 になる
 * (例: 代理店名 "…株式会社" 入りの契約書 PDF のダウンロードが失敗する)。
 *
 * ASCII フォールバック (filename=) と RFC5987 (filename*) を併記し、非ASCIIの
 * ファイル名でも安全にダウンロードさせる。RFC5987 対応ブラウザは filename* を、
 * 非対応は ASCII フォールバックを使う。
 */
export function contentDisposition(type: "attachment" | "inline", fileName: string): string {
  // ASCII 化: 非ASCIIは "_"、quoted-string を壊す " と \ は "'" に置換。
  const asciiName = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "'")
  const encoded = encodeURIComponent(fileName)
  return `${type}; filename="${asciiName}"; filename*=UTF-8''${encoded}`
}
