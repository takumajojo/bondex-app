// 業務委託契約書の本文(条文)の唯一の情報源。PDF(lib/contract-pdf.tsx)と
// 画面表示用HTML(components/contract-html.tsx)の両方がここから描画する。
// 条文を変更したら CONTRACT_VERSION を必ず更新すること(署名がどの版への同意か特定するため)。
//
// 言語対応: 代理店の locale(ja|en) で日/英を出し分ける。日本法の契約のため、英語版は
// 参考訳とし、末尾に「疑義時は日本語版を優先する」旨の言語条項(第17条・en のみ)を付す。

// 日本語の条文内容は不変（英語=参考訳を追加しただけ）のため版は据え置き。
// 既存の署名済み代理店に不要な再署名を促さないよう、CONTRACT_VERSION は変更しない。
export const CONTRACT_VERSION = "2026-08-04-v1"

export type ContractLocale = "ja" | "en"

export const BONDEX_PARTY = {
  companyName: "株式会社JOJO",
  representativeTitle: "代表取締役",
  representativeName: "谷口 琢真",
  address: "〒158-0092 東京都世田谷区野毛1-9-12",
  email: "support@bondex.express",
  bankInfo: "三菱UFJ銀行 田園調布駅前支店 普通 0145653 株式会社JOJO",
}

export const CONTRACT_PRICE_YEN = 5000

export interface ContractBlock {
  kind: "para" | "item"
  num?: string // item のときの番号 ("(1)" や "1." など)
  text: string
}
export interface ContractArticle {
  num: number
  title: string
  blocks: ContractBlock[]
}

const P = (text: string): ContractBlock => ({ kind: "para", text })
const I = (num: string, text: string): ContractBlock => ({ kind: "item", num, text })

/** 頭書(前文)の全文。agencyLabel は代理店名、未確定なら下線プレースホルダを渡す。 */
export function contractPreamble(
  companyName: string,
  agencyLabel: string,
  brand: string,
  locale: ContractLocale = "ja",
): string {
  if (locale === "en") {
    return `${companyName} (hereinafter "Party A") and ${agencyLabel} (hereinafter "Party B") hereby enter into this agreement (hereinafter this "Agreement") regarding the use of the luggage-forwarding coordination service "${brand}" (hereinafter the "Service") operated by Party A, as set forth below.`
  }
  return `${companyName}（以下「甲」という）と${agencyLabel}（以下「乙」という）は、甲が運営する荷物配送手配サービス「${brand}」（以下「本サービス」という）の利用に関し、以下のとおり契約（以下「本契約」という）を締結する。`
}

/** 全条文。price(税込) と bankInfo は差し込む。locale で日/英を出し分ける。 */
export function buildArticles(
  price: number,
  bankInfo: string,
  locale: ContractLocale = "ja",
): ContractArticle[] {
  return locale === "en" ? articlesEn(price, bankInfo) : articlesJa(price, bankInfo)
}

function articlesJa(price: number, bankInfo: string): ContractArticle[] {
  return [
    {
      num: 1,
      title: "目的",
      blocks: [
        P("本契約は、乙が販売する旅行ツアー商品の付帯サービスとして、旅行者の手荷物を全国の宿泊施設間で配送する手配を甲が行うことに関し、両者間の権利義務関係を定めるものとする。"),
      ],
    },
    {
      num: 2,
      title: "業務範囲",
      blocks: [
        P("1. 甲は乙の依頼に基づき、以下の業務（以下「本業務」という）を行う。"),
        I("(1)", "旅行者の手荷物配送に関する集荷依頼の取次ぎ"),
        I("(2)", "佐川急便株式会社・ヤマト運輸株式会社等（以下「実運送人」という）宛の送り状の発行"),
        I("(3)", "旅行者向けのバウチャー（引換証）の発行"),
        I("(4)", "配送状況の確認窓口"),
        P("2. 実際の運送業務は実運送人が行い、甲は運送業務を行わない。甲は貨物利用運送事業者ではなく、業務取次として本業務を行う。"),
        P("3. 手荷物の運送に係る送り状上の荷送人は旅行者とし、甲は旅行者のために集荷の手配及び送り状の作成を代行する。甲は自己の名をもって運送契約の当事者とならない。"),
      ],
    },
    {
      num: 3,
      title: "運送責任及びクレーム対応",
      blocks: [
        P("1. 手荷物の運送に関する責任（運送遅延、紛失、毀損等）は、全て実運送人がその約款に基づき負担するものとする。"),
        P("2. 甲は、実運送人の運送約款に基づく補償について、乙及び旅行者に連絡及び案内を行う。"),
        P("3. 旅行者からの本業務に関する問い合わせ及びクレーム（配送状況、遅延、紛失、毀損等）の一次窓口は甲とし、甲がこれを受付け、記録するものとする。"),
        P("4. 運送事故（紛失、毀損、遅延等）が生じた場合、甲は速やかに実運送人に照会のうえ、実運送人の約款に基づく調査及び補償手続の案内・連絡を乙及び旅行者に対して行う。"),
        P("5. 前項の補償手続における当事者は実運送人及び荷送人であり、甲はその取次ぎ及び連絡調整を行う。"),
        P("6. 実運送人の約款に基づく補償の範囲を超える請求については、甲及び乙は誠実に協議のうえ、対応方針及び費用負担を定めるものとする。"),
      ],
    },
    {
      num: 4,
      title: "料金",
      blocks: [
        P(`1. 本業務の料金は、配送対象物1個あたり金${price.toLocaleString()}円（消費税込）とする。`),
        P("2. 上記料金は、消費税、実運送人の運賃及び甲の手配手数料を含む。"),
        P("3. 上記料金は乙の旅行商品の販売価格に含めて旅行者から徴収するものとし、旅行者から直接甲に支払いは行わない。"),
      ],
    },
    {
      num: 5,
      title: "料金の精算・支払",
      blocks: [
        P("1. 甲は毎月末日締めにより、当月発行した本業務の合計金額を計算し、翌月10日までに乙に請求書を発行する。"),
        P("2. 乙は当該請求書の記載に従い、対象月の翌月末日までに、甲の指定する銀行口座に振込により支払うものとする（月末締め・翌月払い）。"),
        P("3. 振込手数料は乙の負担とする。"),
        P(`4. 振込先：${bankInfo}`),
      ],
    },
    {
      num: 6,
      title: "旅行者情報の取扱い",
      blocks: [
        P("1. 乙は本業務遂行のため必要な範囲で、旅行者の氏名、宿泊先、配送情報等を甲に提供するものとする。"),
        P("2. 甲は前項に基づき提供を受けた個人情報を、本業務の遂行以外の目的で利用してはならない。"),
        P("3. 甲は個人情報の管理に関し、個人情報の保護に関する法律（個人情報保護法）その他の関連法令を遵守するものとする。"),
      ],
    },
    {
      num: 7,
      title: "機密保持",
      blocks: [
        P("両当事者は、本契約に関連して知り得た相手方の業務上、技術上又は営業上の秘密を、相手方の事前の書面による承諾なく第三者に開示又は本契約の目的以外に使用してはならない。本契約終了後も同様とする。"),
      ],
    },
    {
      num: 8,
      title: "契約期間",
      blocks: [
        P("1. 本契約の有効期間は、契約締結日から1年間とする。"),
        P("2. 期間満了の3ヶ月前までにいずれの当事者からも書面による異議がない場合は、本契約は同一条件で1年間自動更新されるものとし、以後も同様とする。"),
      ],
    },
    {
      num: 9,
      title: "解約",
      blocks: [
        P("1. いずれの当事者も、3ヶ月前までに書面で相手方に通知することにより、本契約を解約することができる。"),
        P("2. 一方当事者に以下のいずれかの事由が生じた場合、相手方は催告なく本契約を即時解除することができる。"),
        I("(1)", "本契約上の重大な義務違反があり、相当の期間を定めた催告後もなお是正されないとき"),
        I("(2)", "監督官庁から営業の停止、登録の取消し等の処分を受けたとき"),
        I("(3)", "破産手続開始、民事再生手続開始、会社更生手続開始その他の倒産手続の申立てを受け、又は自ら申し立てたとき"),
      ],
    },
    {
      num: 10,
      title: "損害賠償",
      blocks: [
        P("1. 一方当事者の故意又は重過失により相手方に損害を与えた場合、当該当事者は相手方に対し、現実に生じた直接損害の範囲内でこれを賠償する責任を負う。"),
        P("2. 前項にかかわらず、甲の責任は、原則として実運送人の補償範囲を超えない。"),
        P("3. 甲は逸失利益、間接損害、特別損害について一切責任を負わない。"),
      ],
    },
    {
      num: 11,
      title: "不可抗力",
      blocks: [
        I("1.", "天災地変、悪天候、地震、火災、戦争、暴動、疫病の蔓延、法令の制定・改廃、公権力による命令・処分、輸送機関の事故・遅延その他甲乙の責めに帰すことのできない事由により、本契約上の義務の履行が遅延し又は不能となった場合、当該当事者はその責任を負わない。"),
        I("2.", "前項の事由により手荷物の運送に遅延、紛失又は毀損等が生じた場合の取扱いは、実運送人の運送約款によるものとする。"),
      ],
    },
    {
      num: 12,
      title: "反社会的勢力の排除",
      blocks: [
        I("1.", "甲及び乙は、自己及び自己の役員が、暴力団、暴力団員、暴力団準構成員、暴力団関係企業、総会屋その他これらに準ずる反社会的勢力（以下「反社会的勢力」という）に該当せず、かつ反社会的勢力と社会的に非難されるべき関係を有しないことを表明し、保証する。"),
        I("2.", "甲又は乙は、相手方が前項に違反した場合、何らの催告を要することなく直ちに本契約を解除することができる。この場合、解除された当事者は、解除により生じた損害の賠償を相手方に対して請求することができない。"),
      ],
    },
    {
      num: 13,
      title: "権利義務の譲渡禁止",
      blocks: [
        P("甲及び乙は、相手方の書面による事前の承諾なく、本契約上の地位を第三者に承継させ、又は本契約から生じる権利義務の全部若しくは一部を第三者に譲渡し、引き受けさせ、若しくは担保に供してはならない。"),
      ],
    },
    {
      num: 14,
      title: "合意管轄",
      blocks: [P("本契約に関する紛争については、東京地方裁判所を第一審の専属的合意管轄裁判所とする。")],
    },
    {
      num: 15,
      title: "準拠法",
      blocks: [P("本契約は、日本法に準拠し、日本法に従って解釈されるものとする。")],
    },
    {
      num: 16,
      title: "協議事項",
      blocks: [
        P("本契約に定めのない事項又は本契約の条項の解釈について疑義が生じた場合は、両当事者が信義誠実の原則に従い協議のうえ、これを決定する。"),
      ],
    },
  ]
}

// 英語版（参考訳）。第17条(言語)で「日本語版を正・疑義時は日本語版を優先」を明記する。
function articlesEn(price: number, bankInfo: string): ContractArticle[] {
  return [
    {
      num: 1,
      title: "Purpose",
      blocks: [
        P("This Agreement sets forth the rights and obligations between the parties with respect to Party A's coordination — as an ancillary service to the travel tour products sold by Party B — of the forwarding of travelers' luggage between accommodation facilities throughout Japan."),
      ],
    },
    {
      num: 2,
      title: "Scope of Services",
      blocks: [
        P("1. Upon Party B's request, Party A shall perform the following services (the \"Services\"):"),
        I("(1)", "Acting as intermediary for pickup requests relating to the forwarding of travelers' luggage;"),
        I("(2)", "Issuing waybills addressed to actual carriers such as Sagawa Express Co., Ltd. and Yamato Transport Co., Ltd. (the \"Actual Carriers\");"),
        I("(3)", "Issuing vouchers (exchange slips) for travelers; and"),
        I("(4)", "Serving as a point of contact for delivery-status inquiries."),
        P("2. The actual transport is performed by the Actual Carriers; Party A does not perform transport. Party A is not a freight-forwarding business operator and performs the Services as an intermediary."),
        P("3. The consignor on the waybill for luggage transport shall be the traveler, and Party A arranges pickup and prepares the waybill on behalf of the traveler. Party A does not become a party to the transport contract in its own name."),
      ],
    },
    {
      num: 3,
      title: "Transport Liability and Claims Handling",
      blocks: [
        P("1. All liability relating to luggage transport (transport delay, loss, damage, etc.) shall be borne by the Actual Carriers in accordance with their terms and conditions."),
        P("2. Party A shall notify and inform Party B and travelers of the compensation available under the Actual Carriers' transport terms."),
        P("3. Party A shall serve as the primary point of contact for inquiries and claims from travelers regarding the Services (delivery status, delay, loss, damage, etc.), and shall receive and record them."),
        P("4. If a transport incident (loss, damage, delay, etc.) occurs, Party A shall promptly inquire with the Actual Carrier and inform Party B and travelers of the investigation and compensation procedures under the Actual Carrier's terms."),
        P("5. The parties to the compensation procedure under the preceding paragraph are the Actual Carrier and the consignor; Party A performs the intermediation and liaison."),
        P("6. For claims exceeding the scope of compensation under the Actual Carriers' terms, Party A and Party B shall determine the response policy and cost allocation through good-faith consultation."),
      ],
    },
    {
      num: 4,
      title: "Fees",
      blocks: [
        P(`1. The fee for the Services is JPY ${price.toLocaleString()} (tax included) per item to be forwarded.`),
        P("2. The above fee includes consumption tax, the Actual Carriers' freight charges, and Party A's coordination fee."),
        P("3. The above fee shall be collected from travelers as part of Party B's travel-product price; travelers do not pay Party A directly."),
      ],
    },
    {
      num: 5,
      title: "Settlement and Payment of Fees",
      blocks: [
        P("1. Party A shall, on a month-end closing basis, calculate the total amount of the Services issued during that month and issue an invoice to Party B by the 10th day of the following month."),
        P("2. In accordance with the invoice, Party B shall pay by bank transfer to the account designated by Party A by the end of the month following the target month (month-end closing, payment the following month)."),
        P("3. Bank transfer fees shall be borne by Party B."),
        P(`4. Remittance account: ${bankInfo}`),
      ],
    },
    {
      num: 6,
      title: "Handling of Traveler Information",
      blocks: [
        P("1. Party B shall provide Party A with travelers' names, accommodation details, delivery information, and the like, to the extent necessary to perform the Services."),
        P("2. Party A shall not use the personal information provided under the preceding paragraph for any purpose other than performing the Services."),
        P("3. Party A shall comply with the Act on the Protection of Personal Information and other relevant laws and regulations in managing personal information."),
      ],
    },
    {
      num: 7,
      title: "Confidentiality",
      blocks: [
        P("Neither party shall, without the prior written consent of the other party, disclose to any third party or use for any purpose other than this Agreement any business, technical, or commercial secret of the other party learned in connection with this Agreement. The same shall apply after the termination of this Agreement."),
      ],
    },
    {
      num: 8,
      title: "Term",
      blocks: [
        P("1. The term of this Agreement shall be one year from the date of execution."),
        P("2. Unless either party gives written objection at least three months before expiry, this Agreement shall be automatically renewed for one year on the same terms, and the same shall apply thereafter."),
      ],
    },
    {
      num: 9,
      title: "Termination",
      blocks: [
        P("1. Either party may terminate this Agreement by giving written notice to the other party at least three months in advance."),
        P("2. If any of the following occurs with respect to a party, the other party may immediately terminate this Agreement without notice:"),
        I("(1)", "A material breach of an obligation under this Agreement that remains uncured after a demand specifying a reasonable period;"),
        I("(2)", "Receiving a disposition such as business suspension or revocation of registration from a supervisory authority; or"),
        I("(3)", "Being subject to, or itself filing, a petition for bankruptcy, civil rehabilitation, corporate reorganization, or other insolvency proceedings."),
      ],
    },
    {
      num: 10,
      title: "Damages",
      blocks: [
        P("1. If a party causes damage to the other party through willful misconduct or gross negligence, that party shall be liable to compensate the other party within the scope of the actual direct damages incurred."),
        P("2. Notwithstanding the preceding paragraph, Party A's liability shall, in principle, not exceed the scope of the Actual Carriers' compensation."),
        P("3. Party A shall bear no liability for lost profits, indirect damages, or special damages."),
      ],
    },
    {
      num: 11,
      title: "Force Majeure",
      blocks: [
        I("1.", "If performance of an obligation under this Agreement is delayed or rendered impossible due to causes not attributable to either party — such as natural disasters, severe weather, earthquakes, fire, war, riots, the spread of epidemics, the enactment or amendment of laws, orders or dispositions by public authorities, or accidents or delays of transport carriers — that party shall not be liable therefor."),
        I("2.", "The handling of any delay, loss, or damage to luggage transport arising from the causes in the preceding paragraph shall be governed by the Actual Carriers' transport terms."),
      ],
    },
    {
      num: 12,
      title: "Exclusion of Anti-Social Forces",
      blocks: [
        I("1.", "Party A and Party B each represent and warrant that neither they nor their officers are organized crime groups, their members or quasi-members, affiliated enterprises, corporate racketeers, or other equivalent anti-social forces (the \"Anti-Social Forces\"), and that they have no socially reprehensible relationship with Anti-Social Forces."),
        I("2.", "If the other party breaches the preceding paragraph, Party A or Party B may immediately terminate this Agreement without any notice. In such case, the terminated party may not claim compensation from the other party for damages arising from the termination."),
      ],
    },
    {
      num: 13,
      title: "No Assignment of Rights and Obligations",
      blocks: [
        P("Neither Party A nor Party B shall, without the prior written consent of the other party, cause a third party to succeed to its status under this Agreement, or assign, transfer, or pledge as security all or part of the rights and obligations arising from this Agreement."),
      ],
    },
    {
      num: 14,
      title: "Jurisdiction",
      blocks: [
        P("The Tokyo District Court shall have exclusive jurisdiction as the court of first instance over any dispute relating to this Agreement."),
      ],
    },
    {
      num: 15,
      title: "Governing Law",
      blocks: [P("This Agreement shall be governed by and construed in accordance with the laws of Japan.")],
    },
    {
      num: 16,
      title: "Consultation",
      blocks: [
        P("Any matter not provided for in this Agreement, or any doubt arising as to the interpretation of its provisions, shall be determined by the parties through consultation in accordance with the principle of good faith."),
      ],
    },
    {
      num: 17,
      title: "Language",
      blocks: [
        P("This Agreement is executed in the Japanese language as the authoritative original. This English text is a reference translation provided for convenience only. In the event of any discrepancy or inconsistency between the Japanese and English versions, the Japanese version shall prevail."),
      ],
    },
  ]
}
