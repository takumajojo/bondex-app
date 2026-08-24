/* eslint-disable @next/next/no-img-element */
import React from "react"
import path from "path"
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  Font,
} from "@react-pdf/renderer"
import { buildArticles, contractPreamble } from "./contract-content"

// ---------------------------------------------------------------------------
// Fonts (voucher-pdf.tsx と同じ Noto Sans JP)
// ---------------------------------------------------------------------------

const FONT_DIR = path.join(process.cwd(), "public", "fonts")
const LOGO_PATH = path.join(process.cwd(), "public", "bondex-logo.png")
// 甲(株式会社JOJO)の社印。契約書に常備で押印する。
const BONDEX_SEAL_PATH = path.join(process.cwd(), "public", "jojo-seal.png")

try {
  Font.register({
    family: "NotoSansJP",
    fonts: [
      { src: path.join(FONT_DIR, "NotoSansJP-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "NotoSansJP-Medium.ttf"), fontWeight: 500 },
    ],
  })
  Font.registerHyphenationCallback((word: string) => Array.from(word))
} catch {
  // フォント未配置時は Helvetica fallback
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContractInput {
  contractNumber?: string      // BDX-CONTRACT-2026-001 形式
  locale?: "ja" | "en"          // 契約書の言語。既定 ja。en は参考訳(第17条で日本語版優先を明記)
  effectiveDate: string         // 2026年7月1日 (契約締結日)
  agency: {
    name: string                // 代理店名 (My Japan Planner 等)
    representativeTitle?: string // 代表者役職 (代表取締役)
    representativeName?: string  // 代表者氏名
    address?: string             // 代理店住所
  }
  bondex: {
    companyName: string         // 株式会社JOJO
    representativeTitle: string  // 代表取締役
    representativeName: string   // 谷口 琢真
    address: string              // 〒158-0092 東京都世田谷区野毛1-9-12
    email: string
    bankInfo: string             // 三菱UFJ銀行 田園調布駅前 普通 0145653 株式会社JOJO
  }
  pricePerSuitcaseYen?: number   // デフォルト 5,000
  serviceBrandName?: string      // デフォルト "BondEx"
  // 電子署名(手書きサイン+同意)。存在すると 乙 欄を署名者情報で埋め、署名画像と監査情報を印字する。
  signature?: {
    signerName: string           // 署名者氏名
    signerTitle?: string         // 署名者役職
    signedDate: string           // 2026年8月4日
    signatureImageDataUrl?: string // data:image/png;base64,...
    auditId?: string             // 監査ID (署名レコード id)
    docHashShort?: string        // 文書ハッシュ先頭
  }
}

// 条文・バージョンの唯一の情報源は lib/contract-content.ts。ここからは再エクスポートする。
export { CONTRACT_VERSION } from "./contract-content"

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const C_FG = "#0F0F0F"
const C_MUTED = "#7A7A7A"
const C_HAIRLINE = "#E5E5E5"

const styles = StyleSheet.create({
  page: {
    paddingTop: 50,
    paddingBottom: 60,
    paddingHorizontal: 56,
    fontFamily: "NotoSansJP",
    fontSize: 10,
    color: C_FG,
    backgroundColor: "#FFFFFF",
    lineHeight: 1.7,
  },
  // Cover header
  coverHeader: {
    alignItems: "center",
    marginBottom: 30,
  },
  coverLogo: { width: 140, height: 70, marginBottom: 14 },
  coverTitle: {
    fontSize: 24,
    fontWeight: 500,
    color: C_FG,
    letterSpacing: 5,
    lineHeight: 1.35,
    marginBottom: 12,
  },
  coverSubtitle: {
    fontSize: 9,
    color: C_MUTED,
    letterSpacing: 2,
    lineHeight: 1.4,
  },
  // Intro paragraph
  intro: {
    fontSize: 10,
    color: C_FG,
    lineHeight: 1.8,
    marginBottom: 14,
  },
  // Article
  article: {
    marginBottom: 12,
  },
  articleTitle: {
    fontSize: 11,
    fontWeight: 500,
    color: C_FG,
    marginBottom: 4,
  },
  articleBody: {
    fontSize: 9.5,
    color: C_FG,
    lineHeight: 1.75,
  },
  bullet: {
    flexDirection: "row",
    marginBottom: 2,
  },
  bulletNum: {
    width: 16,
    fontSize: 9.5,
  },
  bulletText: {
    flex: 1,
    fontSize: 9.5,
    lineHeight: 1.75,
  },
  // Section divider
  divider: {
    height: 0.5,
    backgroundColor: C_HAIRLINE,
    marginVertical: 14,
  },
  // Signature block
  signatureBlock: {
    marginTop: 14,
    flexDirection: "column",
  },
  signatureRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  signatureLabel: {
    width: 24,
    fontSize: 12,
    fontWeight: 500,
    color: C_FG,
  },
  signatureCol: {
    flex: 1,
    paddingLeft: 12,
  },
  signatureLine: {
    fontSize: 10,
    color: C_FG,
    marginBottom: 4,
  },
  signatureSeal: {
    marginTop: 12,
    alignSelf: "flex-end",
    width: 34,
    height: 34,
    borderWidth: 0.5,
    borderColor: C_HAIRLINE,
    borderRadius: 2,
    fontSize: 8,
    color: C_MUTED,
    textAlign: "center",
    paddingTop: 12,
  },
  bondexSeal: {
    marginTop: 8,
    alignSelf: "flex-end",
    width: 52,
    height: 52,
    objectFit: "contain",
  },
  signatureImageWrap: {
    marginTop: 8,
    alignSelf: "flex-end",
    alignItems: "center",
  },
  signatureImage: {
    width: 130,
    height: 46,
    objectFit: "contain",
  },
  signatureImageCaption: {
    fontSize: 7,
    color: C_MUTED,
    marginTop: 2,
  },
  auditNote: {
    marginTop: 18,
    fontSize: 8,
    color: C_MUTED,
    lineHeight: 1.6,
    borderTopWidth: 0.5,
    borderTopColor: C_HAIRLINE,
    paddingTop: 8,
  },
  effectiveDate: {
    fontSize: 11,
    color: C_FG,
    fontWeight: 500,
    textAlign: "center",
    marginBottom: 18,
  },
  // Footer
  footer: {
    position: "absolute",
    bottom: 24,
    left: 56,
    right: 56,
    borderTopWidth: 0.5,
    borderTopColor: C_HAIRLINE,
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: C_MUTED,
  },
})

// ---------------------------------------------------------------------------
// Article component
// ---------------------------------------------------------------------------

function Article({
  num,
  title,
  locale = "ja",
  children,
}: {
  num: number
  title: string
  locale?: "ja" | "en"
  children: React.ReactNode
}) {
  return (
    <View style={styles.article} wrap={false}>
      <Text style={styles.articleTitle}>
        {locale === "en" ? `Article ${num}. ${title}` : `第${num}条（${title}）`}
      </Text>
      {children}
    </View>
  )
}

function Item({ num, children }: { num: string; children: React.ReactNode }) {
  return (
    <View style={styles.bullet}>
      <Text style={styles.bulletNum}>{num}</Text>
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  )
}

function Para({ children }: { children: React.ReactNode }) {
  return <Text style={styles.articleBody}>{children}</Text>
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export function ContractDocument({ data }: { data: ContractInput }) {
  const price = data.pricePerSuitcaseYen ?? 5000
  const brand = data.serviceBrandName ?? "BondEx"
  const locale = data.locale === "en" ? "en" : "ja"
  const L =
    locale === "en"
      ? {
          witness:
            "IN WITNESS WHEREOF, to evidence the conclusion of this Agreement, two copies of this document are prepared; each party affixes its name and seal and retains one copy.",
          partyA: "Party A",
          partyB: "Party B",
          address: "Address: ",
          company: "Company: ",
          rep: "Representative: ",
          sigCaption: "Signature (electronic)",
          seal: "Seal",
          audit: (d: string, id?: string, h?: string) =>
            `This Agreement was concluded on ${d}, when the authorized representative of Party B above reviewed the contents on BondEx (bondex.express) and agreed to and signed it electronically.` +
            (id ? ` Audit ID: ${id}` : "") +
            (h ? ` / Document hash (SHA-256 prefix): ${h}` : ""),
        }
      : {
          witness:
            "以上、本契約の成立を証するため、本書2通を作成し、両当事者が記名押印の上、それぞれ1通を保有する。",
          partyA: "甲",
          partyB: "乙",
          address: "住所：",
          company: "会社名：",
          rep: "代表者：",
          sigCaption: "署名（電子）",
          seal: "印",
          audit: (d: string, id?: string, h?: string) =>
            `本契約は${d}に、上記乙の担当者が BondEx（bondex.express）上で契約内容を確認し、電子的に同意・署名して締結したものです。` +
            (id ? ` 監査ID: ${id}` : "") +
            (h ? ` ／ 文書ハッシュ(SHA-256先頭): ${h}` : ""),
        }

  return (
    <Document
      title={`BondEx Agency Contract ${data.contractNumber ?? ""}`}
      author={data.bondex.companyName}
      subject="Agency Service Agreement"
    >
      <Page size="A4" style={styles.page}>
        {/* Cover */}
        <View style={styles.coverHeader}>
          <Image src={LOGO_PATH} style={styles.coverLogo} />
          <Text style={styles.coverTitle}>
            {locale === "en" ? "AGENCY SERVICE AGREEMENT" : "業 務 委 託 契 約 書"}
          </Text>
          <Text style={styles.coverSubtitle}>
            {locale === "en"
              ? (data.contractNumber ?? "")
              : `AGENCY SERVICE AGREEMENT${data.contractNumber ? `  ·  ${data.contractNumber}` : ""}`}
          </Text>
        </View>

        <Text style={styles.intro}>
          {contractPreamble(
            data.bondex.companyName,
            data.agency.name?.trim() ? data.agency.name : "＿＿＿＿＿＿＿＿＿＿＿＿",
            brand,
            locale,
          )}
        </Text>

        {/* 各条文 (唯一の情報源 = lib/contract-content.ts。PDF/HTML双方がここから描画) */}
        {buildArticles(price, data.bondex.bankInfo, locale).map((a) => (
          <Article key={a.num} num={a.num} title={a.title} locale={locale}>
            {a.blocks.map((b, i) =>
              b.kind === "item" ? (
                <Item key={i} num={b.num ?? ""}>
                  {b.text}
                </Item>
              ) : (
                <Para key={i}>{b.text}</Para>
              ),
            )}
          </Article>
        ))}

        <View style={styles.divider} />

        {/* 契約成立文・締結日・署名欄はページ跨ぎで分断しない */}
        <View wrap={false}>
        <Text style={[styles.intro, { textAlign: "center" }]}>{L.witness}</Text>

        <Text style={styles.effectiveDate}>{data.effectiveDate}</Text>

        {/* 署名欄 — 甲(BondEx)は記入済み、乙(代理店)は署名・押印用に空欄 */}
        <View style={styles.signatureBlock}>
          <View style={styles.signatureRow}>
            <Text style={styles.signatureLabel}>{L.partyA}</Text>
            <View style={styles.signatureCol}>
              <Text style={styles.signatureLine}>{L.address}{data.bondex.address}</Text>
              <Text style={styles.signatureLine}>{L.company}{data.bondex.companyName}</Text>
              <Text style={styles.signatureLine}>
                {L.rep}{data.bondex.representativeTitle}　{data.bondex.representativeName}
              </Text>
              {/* 甲(株式会社JOJO)の社印を常備で押印 */}
              {/* eslint-disable-next-line jsx-a11y/alt-text */}
              <Image src={BONDEX_SEAL_PATH} style={styles.bondexSeal} />
            </View>
          </View>

          <View style={styles.signatureRow}>
            <Text style={styles.signatureLabel}>{L.partyB}</Text>
            <View style={styles.signatureCol}>
              <Text style={styles.signatureLine}>{L.address}{data.agency.address ?? ""}</Text>
              <Text style={styles.signatureLine}>{L.company}{data.agency.name ?? ""}</Text>
              <Text style={styles.signatureLine}>
                {L.rep}
                {data.signature
                  ? [data.signature.signerTitle, data.signature.signerName].filter(Boolean).join("　")
                  : [data.agency.representativeTitle, data.agency.representativeName].filter(Boolean).join("　")}
              </Text>
              {data.signature?.signatureImageDataUrl ? (
                <View style={styles.signatureImageWrap}>
                  {/* eslint-disable-next-line jsx-a11y/alt-text */}
                  <Image src={data.signature.signatureImageDataUrl} style={styles.signatureImage} />
                  <Text style={styles.signatureImageCaption}>{L.sigCaption}</Text>
                </View>
              ) : (
                <Text style={styles.signatureSeal}>{L.seal}</Text>
              )}
            </View>
          </View>
        </View>

        {data.signature && (
          <Text style={styles.auditNote}>
            {L.audit(data.signature.signedDate, data.signature.auditId, data.signature.docHashShort)}
          </Text>
        )}
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>
            {data.bondex.companyName} · {data.bondex.address.replace("〒158-0092 ", "")}
          </Text>
          <Text
            render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  )
}
