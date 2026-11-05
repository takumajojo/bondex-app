/**
 * B2C の規約の本文の読み込みと、版に残す形（本文・SHA-256）。サーバーだけで使う。
 * 版の名前・同意の文言は lib/b2c/legal-text.ts（画面と共通）。
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { B2C_LEGAL_DOC_KINDS, B2C_TERMS_VERSION, B2C_CARD_CONSENT_VERSION, B2C_BOOKING_CONSENT_TEXT, B2C_CARD_CHARGE_TERMS, B2C_CARD_CONSENT_TEXT, type B2cLegalDocKind, type B2cLegalKind, type B2cLegalLang } from "./legal-text"

export * from "./legal-text"

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex")
}

/**
 * 規約の正本（docs/b2c/legal/<kind>_<lang>.md）から、旅行者に見せる本文を取り出す。
 * 先頭の見出しの下の「> 」の行（社内の作成メモ）は本文に含めない。
 */
export function b2cLegalBodyFromSource(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n")
  // 本文が始まる（見出し・空行・「> 」以外の最初の行）までの「> 」の行を除く
  const start = lines.findIndex((l) => l.trim() !== "" && !l.startsWith("#") && !l.startsWith(">"))
  const head = (start < 0 ? lines : lines.slice(0, start)).filter((l) => !l.startsWith(">"))
  const body = start < 0 ? [] : lines.slice(start)
  return [...head, ...body].join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n"
}

/** 規約の正本のファイル（docs/b2c/legal/<kind>_<lang>.md）の本文。 */
export function b2cLegalDocBody(kind: B2cLegalDocKind, lang: B2cLegalLang): string {
  return b2cLegalBodyFromSource(readFileSync(path.join(process.cwd(), "docs/b2c/legal", `${kind}_${lang}.md`), "utf8"))
}

/** 同意の文言の本文（版に残す形）。 */
export function b2cConsentBody(kind: "booking_consent" | "card_consent", lang: B2cLegalLang): string {
  if (kind === "booking_consent") return B2C_BOOKING_CONSENT_TEXT[lang] + "\n"
  return `${B2C_CARD_CHARGE_TERMS[lang]}\n\n${B2C_CARD_CONSENT_TEXT[lang]}\n`
}

export interface B2cLegalDocument {
  version: string
  kind: B2cLegalKind
  lang: B2cLegalLang
  body: string
  sha256: string
}

/** 今の版の本文の一式（b2c_legal_documents に登録する行）。 */
export function currentB2cLegalDocuments(): B2cLegalDocument[] {
  const out: B2cLegalDocument[] = []
  for (const lang of ["ja", "en"] as const) {
    for (const kind of B2C_LEGAL_DOC_KINDS) {
      const body = b2cLegalDocBody(kind, lang)
      out.push({ version: B2C_TERMS_VERSION, kind, lang, body, sha256: sha256Hex(body) })
    }
    const bc = b2cConsentBody("booking_consent", lang)
    out.push({ version: B2C_TERMS_VERSION, kind: "booking_consent", lang, body: bc, sha256: sha256Hex(bc) })
    const cc = b2cConsentBody("card_consent", lang)
    out.push({ version: B2C_CARD_CONSENT_VERSION, kind: "card_consent", lang, body: cc, sha256: sha256Hex(cc) })
  }
  return out
}
