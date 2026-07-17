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

// ---------------------------------------------------------------------------
// Fonts (voucher-pdf.tsx と同じ Noto Sans JP)
// ---------------------------------------------------------------------------

const FONT_DIR = path.join(process.cwd(), "public", "fonts")
const LOGO_PATH = path.join(process.cwd(), "public", "bondex-logo.png")

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
}

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
    fontSize: 26,
    fontWeight: 500,
    color: C_FG,
    letterSpacing: 6,
    marginBottom: 6,
  },
  coverSubtitle: {
    fontSize: 9,
    color: C_MUTED,
    letterSpacing: 2,
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
    marginTop: 30,
    flexDirection: "column",
  },
  signatureRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 24,
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
  signatureStamp: {
    fontSize: 9,
    color: C_MUTED,
    marginTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: C_HAIRLINE,
    paddingTop: 6,
  },
  effectiveDate: {
    fontSize: 11,
    color: C_FG,
    fontWeight: 500,
    textAlign: "center",
    marginBottom: 30,
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
  children,
}: {
  num: number
  title: string
  children: React.ReactNode
}) {
  return (
    <View style={styles.article}>
      <Text style={styles.articleTitle}>第{num}条（{title}）</Text>
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
          <Text style={styles.coverTitle}>業 務 委 託 契 約 書</Text>
          <Text style={styles.coverSubtitle}>
            AGENCY SERVICE AGREEMENT
            {data.contractNumber ? `  ·  ${data.contractNumber}` : ""}
          </Text>
        </View>

        <Text style={styles.intro}>
          {data.bondex.companyName}（以下「甲」という）と{data.agency.name}（以下「乙」という）は、
          甲が運営する荷物配送手配サービス「{brand}」（以下「本サービス」という）の利用に関し、
          以下のとおり契約（以下「本契約」という）を締結する。
        </Text>

        {/* 各条文 */}
        <Article num={1} title="目的">
          <Para>
            本契約は、乙が販売する旅行ツアー商品の付帯サービスとして、旅行者の手荷物を全国の宿泊施設間で配送する手配を甲が行うことに関し、両者間の権利義務関係を定めるものとする。
          </Para>
        </Article>

        <Article num={2} title="業務範囲">
          <Para>1. 甲は乙の依頼に基づき、以下の業務（以下「本業務」という）を行う。</Para>
          <Item num="(1)">旅行者の手荷物配送に関する集荷依頼の取次ぎ</Item>
          <Item num="(2)">佐川急便株式会社・ヤマト運輸株式会社等（以下「実運送人」という）宛の送り状の発行</Item>
          <Item num="(3)">旅行者向けのバウチャー（引換証）の発行</Item>
          <Item num="(4)">配送状況の確認窓口</Item>
          <Para>
            2. 実際の運送業務は実運送人が行い、甲は運送業務を行わない。甲は貨物利用運送事業者ではなく、業務取次として本業務を行う。
          </Para>
        </Article>

        <Article num={3} title="運送責任">
          <Para>
            1. 手荷物の運送に関する責任（運送遅延、紛失、毀損等）は、全て実運送人がその約款に基づき負担するものとする。
          </Para>
          <Para>
            2. 甲は、実運送人の運送約款に基づく補償について、乙及び旅行者に連絡及び案内を行う。
          </Para>
        </Article>

        <Article num={4} title="料金">
          <Para>
            1. 本業務の料金は、配送対象物1個あたり金{price.toLocaleString()}円（税別）とする。
          </Para>
          <Para>2. 上記料金は、実運送人の運賃及び甲の手配手数料を含む。</Para>
          <Para>
            3. 上記料金は乙の旅行商品の販売価格に含めて旅行者から徴収するものとし、旅行者から直接甲に支払いは行わない。
          </Para>
        </Article>

        <Article num={5} title="料金の精算・支払">
          <Para>
            1. 甲は毎月末日締めにより、当月発行した本業務の合計金額を計算し、翌月10日までに乙に請求書を発行する。
          </Para>
          <Para>
            2. 乙は当該請求書の記載に従い、対象月の翌々月20日までに、甲の指定する銀行口座に振込により支払うものとする。
          </Para>
          <Para>3. 振込手数料は乙の負担とする。</Para>
          <Para>
            4. 振込先：{data.bondex.bankInfo}
          </Para>
        </Article>

        <Article num={6} title="旅行者情報の取扱い">
          <Para>
            1. 乙は本業務遂行のため必要な範囲で、旅行者の氏名、宿泊先、配送情報等を甲に提供するものとする。
          </Para>
          <Para>
            2. 甲は前項に基づき提供を受けた個人情報を、本業務の遂行以外の目的で利用してはならない。
          </Para>
          <Para>
            3. 甲は個人情報の管理に関し、個人情報の保護に関する法律（個人情報保護法）その他の関連法令を遵守するものとする。
          </Para>
        </Article>

        <Article num={7} title="機密保持">
          <Para>
            両当事者は、本契約に関連して知り得た相手方の業務上、技術上又は営業上の秘密を、相手方の事前の書面による承諾なく第三者に開示又は本契約の目的以外に使用してはならない。本契約終了後も同様とする。
          </Para>
        </Article>

        <Article num={8} title="契約期間">
          <Para>
            1. 本契約の有効期間は、契約締結日から1年間とする。
          </Para>
          <Para>
            2. 期間満了の3ヶ月前までにいずれの当事者からも書面による異議がない場合は、本契約は同一条件で1年間自動更新されるものとし、以後も同様とする。
          </Para>
        </Article>

        <Article num={9} title="解約">
          <Para>
            1. いずれの当事者も、3ヶ月前までに書面で相手方に通知することにより、本契約を解約することができる。
          </Para>
          <Para>
            2. 一方当事者に以下のいずれかの事由が生じた場合、相手方は催告なく本契約を即時解除することができる。
          </Para>
          <Item num="(1)">本契約上の重大な義務違反があり、相当の期間を定めた催告後もなお是正されないとき</Item>
          <Item num="(2)">監督官庁から営業の停止、登録の取消し等の処分を受けたとき</Item>
          <Item num="(3)">破産手続開始、民事再生手続開始、会社更生手続開始その他の倒産手続の申立てを受け、又は自ら申し立てたとき</Item>
        </Article>

        <Article num={10} title="損害賠償">
          <Para>
            1. 一方当事者の故意又は重過失により相手方に損害を与えた場合、当該当事者は相手方に対し、現実に生じた直接損害の範囲内でこれを賠償する責任を負う。
          </Para>
          <Para>2. 前項にかかわらず、甲の責任は、原則として実運送人の補償範囲を超えない。</Para>
          <Para>3. 甲は逸失利益、間接損害、特別損害について一切責任を負わない。</Para>
        </Article>

        <Article num={11} title="合意管轄">
          <Para>
            本契約に関する紛争については、東京地方裁判所を第一審の専属的合意管轄裁判所とする。
          </Para>
        </Article>

        <Article num={12} title="準拠法">
          <Para>本契約は、日本法に準拠し、日本法に従って解釈されるものとする。</Para>
        </Article>

        <Article num={13} title="協議事項">
          <Para>
            本契約に定めのない事項又は本契約の条項の解釈について疑義が生じた場合は、両当事者が信義誠実の原則に従い協議のうえ、これを決定する。
          </Para>
        </Article>

        <View style={styles.divider} />

        <Text style={[styles.intro, { textAlign: "center" }]}>
          以上、本契約の成立を証するため、本書2通を作成し、両当事者が記名押印の上、それぞれ1通を保有する。
        </Text>

        <Text style={styles.effectiveDate}>{data.effectiveDate}</Text>

        {/* 署名欄 */}
        <View style={styles.signatureBlock}>
          <View style={styles.signatureRow}>
            <Text style={styles.signatureLabel}>甲</Text>
            <View style={styles.signatureCol}>
              <Text style={styles.signatureLine}>{data.bondex.address}</Text>
              <Text style={styles.signatureLine}>{data.bondex.companyName}</Text>
              <Text style={styles.signatureLine}>
                {data.bondex.representativeTitle}　{data.bondex.representativeName}
              </Text>
              <Text style={styles.signatureStamp}>　　　　　　　　　　　　　　　　　　　　　　　印</Text>
            </View>
          </View>

          <View style={styles.signatureRow}>
            <Text style={styles.signatureLabel}>乙</Text>
            <View style={styles.signatureCol}>
              <Text style={styles.signatureLine}>
                {data.agency.address || "　　　　　　　　　　　　　　　　　　　　"}
              </Text>
              <Text style={styles.signatureLine}>{data.agency.name}</Text>
              <Text style={styles.signatureLine}>
                {data.agency.representativeTitle || "代表者役職"}
                {data.agency.representativeName || "　　　　　　　　"}
              </Text>
              <Text style={styles.signatureStamp}>　　　　　　　　　　　　　　　　　　　　　　　印</Text>
            </View>
          </View>
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
