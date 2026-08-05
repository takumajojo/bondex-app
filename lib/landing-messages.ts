// ─────────────────────────────────────────────────────────────
// BondEx ランディングページ 多言語文言辞書 (i18n)
//
// PHASE 1: 日本語 (ja, 既定) + 英語 (en) のみ。
// Spanish / French / Chinese / Italian は Phase 2 で `Locale` と
// `messages` に追加するだけで拡張できるよう構造化してある。
//
// 方針:
//   - `ja` は app/page.tsx の現行日本語文言を「そのまま」複写 (最近の修正含む:
//     バウチャー多言語 = 英・中・伊・仏・西 / 支払い行のカード決済言及 /
//     フッター support@bondex.express)。
//   - `en` は訪日インバウンド旅行代理店・ランドオペレーター向け B2B の
//     プロフェッショナルな英訳。意味は変えない。
//   - 具体的な価格・¥ 表記は英語に一切入れない (JP は意図的に ¥5,000 を出さない)。
//     価格は契約時に確定する旨をそのまま訳す。
//   - コピーライト年など動的な値は辞書に入れず、コンポーネント側で生成する。
//   - <strong> を含む文はコンポーネントが両言語で太字レンダリングできるよう
//     { a, strong, b } の構造で保持する。
//   - SVG イラスト内の装飾ラベル (VOUCHER / 送り状 / HOTEL A / HOTEL B /
//     SHIPPING LABEL / 配送中 / 月次請求書 / 文字 B / ¥ など) は辞書に入れず、
//     コンポーネントにハードコードしたまま (イラストのアート要素)。
// ─────────────────────────────────────────────────────────────

export type Locale = "ja" | "en" | "es" | "fr" | "zh" | "it"

/** 太字語 (<strong>) を挟む文。a + <strong>strong</strong> + b でレンダリング。 */
export interface RichText {
  a: string
  strong: string
  b: string
}

/** ブランド語 (赤字 span) を挟む文。a + <span>brand</span> + b でレンダリング。 */
export interface RichBrand {
  a: string
  brand: string
  b: string
}

/** md 以上で <br> 改行する 2 分割見出し / 本文。 */
export interface TwoLine {
  first: string
  second: string
}

export interface LandingMessages {
  nav: {
    flow: string
    difference: string
    deliverables: string
    trust: string
    price: string
    faq: string
    tryDemo: string
    consult: string
    agencyLogin: string
    menuOpen: string
    menuClose: string
  }
  demo: {
    header: RichBrand
    sceneAria: string
    scenes: { step: string; title: string; body: string }[]
  }
  hero: {
    badgeMobile: string
    badgeDesktop: string
    titleMobile: string[]
    titleDesktop: TwoLine
    subtitleMobile: string
    subtitleDesktop: TwoLine
    bullets: string[]
    ctaConsult: string
    ctaSample: string
    replyNote: string
    seePricing: string
    stats: { k: string; v: string }[]
    photoTitle: string
    photoBody: string
    photoAlt: string
  }
  sample: {
    eyebrow: string
    heading: string
    openPdf: string
    altPrefix: string
    pageLabels: string[]
    caption: string
    openPdfMobile: string
  }
  value: {
    items: { title: string; body: string }[]
  }
  difference: {
    eyebrow: string
    heading: TwoLine
    intro: string
    conventionalHeading: string
    conventionalBody: string
    bondexHeading: string
    bondexBody: string
    cards: { title: string; body: string }[]
  }
  flow: {
    eyebrow: string
    heading: TwoLine
    steps: { title: string; desc: string }[]
  }
  deliverables: {
    eyebrow: string
    heading: TwoLine
    voucherHeading: string
    voucherBody: RichText
    waybillHeading: string
    waybillBody: RichText
  }
  trust: {
    eyebrow: string
    heading: TwoLine
    cards: { title: string; head: string; body: string }[]
  }
  price: {
    eyebrow: string
    heading: TwoLine
    intro: string
    billingKicker: string
    billingHeading: string
    billingBody: string
    rows: { term: string; desc: string }[]
    sizeNote: string
  }
  faq: {
    eyebrow: string
    heading: TwoLine
    callouts: { label: string; text: string }[]
    items: { q: string; a: string }[]
  }
  contact: {
    heading: string
    body: TwoLine
    cta: string
    replyNote: string
  }
  footer: {
    operatorPrefix: string
    operatorName: string
    operatorAddress: string
    tracking: string
    terms: string
    privacy: string
    commercial: string
    disclaimer: string
    copyrightSuffix: string
  }
}

const ja: LandingMessages = {
  nav: {
    flow: "流れ",
    difference: "違い",
    deliverables: "発行物",
    trust: "安心の理由",
    price: "料金",
    faq: "FAQ",
    tryDemo: "デモを試す",
    consult: "導入相談",
    agencyLogin: "代理店ログイン",
    menuOpen: "メニューを開く",
    menuClose: "メニューを閉じる",
  },
  demo: {
    header: { a: "すぐにわかる ", brand: "BondEx", b: " の仕組み" },
    sceneAria: "シーン",
    scenes: [
      {
        step: "STEP 1",
        title: "旅程と配送日を送る",
        body: "旅程 (PDF・Excel・画像) と「いつ・どこから送るか」を指定",
      },
      {
        step: "STEP 2",
        title: "BondEx が配送を手配",
        body: "バウチャーと送り状を発行してお渡し",
      },
      {
        step: "STEP 3",
        title: "ゲストは手ぶらで移動",
        body: "荷物はホテルからホテルへ、提携の物流会社が配送",
      },
      {
        step: "STEP 4",
        title: "追跡も請求もおまかせ",
        body: "QR で配送状況を確認、料金は月次まとめ請求",
      },
    ],
  },
  hero: {
    badgeMobile: "訪日旅行代理店・ランドオペレーター向け",
    badgeDesktop: "訪日旅行代理店様向け ・ 荷物配送手配代行",
    titleMobile: ["旅程と配送日を", "送るだけで、", "荷物配送手配が完了。"],
    titleDesktop: { first: "旅程と配送日を送るだけで、", second: "荷物配送手配が完了。" },
    subtitleMobile:
      "「いつ・どのホテルから送るか」をご指定いただければ、あとの面倒ごとは BondEx がまとめて代行します。",
    subtitleDesktop: {
      first: "「いつ・どのホテルから送るか」の指定だけで、バウチャー発行・送り状手配・",
      second: "月次請求・変更対応まで。BondEx が配送事業者との取次を担当します。",
    },
    bullets: [
      "バウチャー・送り状の作成はすべて BondEx",
      "配送費は月次でまとめて精算",
      "変更・問い合わせの窓口も BondEx に一本化",
    ],
    ctaConsult: "導入相談へ",
    ctaSample: "サンプル PDF を見る",
    replyNote: "通常 1 営業日以内にご連絡します。",
    seePricing: "料金を見る",
    stats: [
      { k: "初期費用", v: "0円" },
      { k: "利用単位", v: "1件から" },
      { k: "バウチャー", v: "即日発行" },
      { k: "お支払い", v: "月次 ／ カード" },
    ],
    photoTitle: "ゲストは手ぶらで、次の街へ。",
    photoBody: "お荷物はホテルからホテルへ、BondEx が配送手配",
    photoAlt: "スーツケースを持たずに日本を旅行する家族",
  },
  sample: {
    eyebrow: "実物イメージ",
    heading: "実際に発行されるバウチャー",
    openPdf: "PDF で開く",
    altPrefix: "バウチャー見本 — ",
    pageLabels: ["区間1 — 1枚に集約済み", "区間2 — 1枚に集約済み"],
    caption: "見本は架空データです。追跡 QR・区間表示・多区間の旅程一覧にも対応しています。",
    openPdfMobile: "サンプル PDF を開く",
  },
  value: {
    items: [
      {
        title: "旅程と配送日を送る",
        body: "旅程は PDF / Excel / 画像で。各区間の配送日をご指定ください。",
      },
      {
        title: "発行物一式が届く",
        body: "バウチャー・送り状を Google Drive で共有。",
      },
      {
        title: "月次まとめ請求",
        body: "月末締め・翌月末払いのまとめ精算。",
      },
    ],
  },
  difference: {
    eyebrow: "従来手配との違い",
    heading: { first: "荷物配送を、", second: "旅行商品の一部に。" },
    intro:
      "BondEx は、旅程データをもとに荷物配送の手配・発行物・月次請求まで代行します。旅行代理店様は、手ぶら観光やホテル間配送を旅行プランの付加価値として案内できます。",
    conventionalHeading: "従来の手配",
    conventionalBody:
      "旅行者自身が配送業者を探し、個別に申込・支払いを行います。バウチャーや送り状は旅程とは別に管理され、変更や遅延の問い合わせも旅行者本人が対応します。",
    bondexHeading: "弊社の手配",
    bondexBody:
      "代理店様が旅程データを送るだけで、バウチャー・送り状・追跡情報をまとめて準備します。配送費は旅行代金に含められ、手ぶら観光を旅行プランの一部としてご案内いただけます。",
    cards: [
      {
        title: "旅行商品に組み込める",
        body: "手ぶら観光・ホテル間配送を、旅程に含まれるサービスとして案内できます。",
      },
      {
        title: "手配が一本化される",
        body: "旅程データを送るだけで、バウチャー・送り状・追跡情報までまとめて準備します。",
      },
      {
        title: "まとめて請求・決済できる",
        body: "配送費は代理店様宛の月次まとめ請求、またはクレジットカード決済に対応します。",
      },
    ],
  },
  flow: {
    eyebrow: "流れ",
    heading: { first: "旅程を送ったら、", second: "受け取るだけ。" },
    steps: [
      { title: "旅程を送付", desc: "PDF / Excel / 画像" },
      { title: "AI が抽出", desc: "担当者が最終確認" },
      { title: "バウチャー即日", desc: "旅行者用引換証" },
      { title: "送り状発行", desc: "集荷 1ヶ月前から" },
      { title: "Drive で共有", desc: "Email / Slack で通知" },
    ],
  },
  deliverables: {
    eyebrow: "発行物",
    heading: { first: "必要な発行物を、", second: "まとめて用意。" },
    voucherHeading: "旅行者用バウチャー",
    voucherBody: {
      a: "旅程受領後、",
      strong: "即日発行",
      b: "。英語・中国語・イタリア語・フランス語・スペイン語の多言語に対応。ホテル担当者向けの一時預かり案内も同梱。",
    },
    waybillHeading: "物流業者の送り状",
    waybillBody: {
      a: "集荷日の ",
      strong: "1 ヶ月前",
      b: " に発行 (物流業者仕様)。追跡番号付き、大手宅配便ネットワークを利用。",
    },
  },
  trust: {
    eyebrow: "ご安心の理由",
    heading: { first: "代理店様が", second: "安心して任せられる理由。" },
    cards: [
      {
        title: "補償",
        head: "1 個あたり最大 30 万円",
        body: "配送は大手宅配便。運送約款に基づき、1 個あたり最大 30 万円まで補償されます。",
      },
      {
        title: "取次",
        head: "代理店様と配送事業者の間に立ちます",
        body: "BondEx は取次業者。代理店様に代わり配送事業者との手配・調整を担当し、業務を吸収します。",
      },
      {
        title: "個人情報",
        head: "SSL 通信・権限限定・目的外利用なし",
        body: "旅程データはすべて SSL 通信、アクセスは業務担当者のみに限定。目的外利用はいたしません。",
      },
    ],
  },
  price: {
    eyebrow: "料金",
    heading: { first: "1 件単価、", second: "月次まとめ請求。" },
    intro:
      "初期費用・月額費用はありません。送料は原則として均一単価でご案内し、正式な料金は取扱件数・配送条件を確認のうえ契約時に確定します。",
    billingKicker: "Billing / 請求条件",
    billingHeading: "請求条件",
    billingBody:
      "配送費は月次でまとめて精算。月末に当月分をまとめて集計します。翌月初に請求書を発行し、翌月末までにお支払いいただきます。クレジットカードでのお支払いにも対応しています。",
    rows: [
      { term: "締め日", desc: "月末" },
      { term: "請求書発行", desc: "翌月初" },
      { term: "支払期限", desc: "翌月末" },
      { term: "支払方法", desc: "銀行振込 ／ クレジットカード" },
      { term: "運賃", desc: "月次まとめ精算" },
      { term: "請求単位", desc: "月次まとめ請求" },
    ],
    sizeNote:
      "宅配便の受託限度 (3辺合計 160cm 以内・重量は配送業者の規定による) を超える荷物・離島や一部地域宛・冷蔵冷凍等の特殊配送は原則対象外となります。具体条件は個別にご相談ください。",
  },
  faq: {
    eyebrow: "よくあるご質問",
    heading: { first: "はじめての方の、", second: "よくあるご質問。" },
    callouts: [
      { label: "補償", text: "提携物流会社の約款で 1 個あたり最大 30 万円まで。" },
      { label: "締切", text: "旅程受領即日でバウチャー発行。送り状は集荷 1 ヶ月前。" },
      {
        label: "キャンセル",
        text: "集荷完了前のご連絡なら無償。集荷後は配送手続き開始のため不可。",
      },
    ],
    items: [
      {
        q: "旅程はどの形式で送れますか?",
        a: "Excel / PDF / 画像 / スクリーンショット、いずれも受け付けます。代理店様の使い慣れたフォーマットのままで結構です。",
      },
      {
        q: "バウチャーはすぐ発行できるのに、送り状はなぜ 1ヶ月前?",
        a: "物流業者の発行仕様上、集荷日から 30 日以内でないと送り状を発行できないためです。バウチャーは BondEx 発行のため即日対応可能です。",
      },
      {
        q: "料金の請求サイクルは?",
        a: "月末日締めで当月発行分を集計、翌月初に PDF 請求書を代理店様宛に送付。お支払期限は対象月の翌月末日です。物流業者への運賃は BondEx が立替払いします。",
      },
      {
        q: "補償の範囲は?",
        a: "実運送を担う物流業者の運送約款に完全に準じます。現在の提携宅配便で 1 個あたり上限 30 万円。BondEx 独自の追加補償はありません。",
      },
      {
        q: "運用中のサポート体制は?",
        a: "導入時のオンボーディング、運用中の変更・宛先変更対応、集荷遅延やクレーム時の一次対応まで、担当窓口が伴走します。代理店様の追加工数を最小化します。",
      },
      {
        q: "契約から運用開始まで、どのくらい?",
        a: "業務委託契約 (取次業として明記) の締結後、代理店ポータルのアカウントを発行して即日運用開始できます。初回旅程 PDF で当日中にテスト発行いただけます。",
      },
    ],
  },
  contact: {
    heading: "試験運用は 1 件から。",
    body: {
      first: "契約書・責任分界表・請求書サンプル・法務レビュー用パッケージを、",
      second: "打合せ日程調整とあわせてお送りいたします。",
    },
    cta: "導入相談フォームへ",
    replyNote: "通常 1 営業日以内にご連絡します。",
  },
  footer: {
    operatorPrefix: "運営: ",
    operatorName: "株式会社JOJO",
    operatorAddress: " / 東京都世田谷区野毛1-9-12",
    tracking: "トラッキング",
    terms: "利用規約",
    privacy: "プライバシー",
    commercial: "特定商取引法",
    disclaimer:
      "BondEx は運送人ではなく、旅程情報を受けて物流業者への発送を取り次ぐ取次サービスです。実運送・運送責任・補償は当社が利用する物流業者の運送約款に準じます。",
    copyrightSuffix: " / BondEx",
  },
}

const en: LandingMessages = {
  nav: {
    flow: "Flow",
    difference: "Difference",
    deliverables: "Deliverables",
    trust: "Why trust us",
    price: "Pricing",
    faq: "FAQ",
    tryDemo: "Try the demo",
    consult: "Get started",
    agencyLogin: "Agency login",
    menuOpen: "Open menu",
    menuClose: "Close menu",
  },
  demo: {
    header: { a: "How ", brand: "BondEx", b: " works, at a glance" },
    sceneAria: "Scene",
    scenes: [
      {
        step: "STEP 1",
        title: "Send the itinerary and delivery dates",
        body: "Share the itinerary (PDF, Excel, or image) and specify when and from where to ship",
      },
      {
        step: "STEP 2",
        title: "BondEx arranges the shipment",
        body: "We issue the voucher and shipping label and hand them over",
      },
      {
        step: "STEP 3",
        title: "Guests travel hands-free",
        body: "Luggage goes hotel to hotel, delivered by our partner carriers",
      },
      {
        step: "STEP 4",
        title: "Tracking and billing, handled",
        body: "Check delivery status by QR code; charges are consolidated into a monthly invoice",
      },
    ],
  },
  hero: {
    badgeMobile: "For inbound travel agencies and land operators",
    badgeDesktop: "For inbound travel agencies · Luggage forwarding, fully managed",
    titleMobile: ["Send the itinerary", "and delivery dates —", "forwarding is handled."],
    titleDesktop: {
      first: "Send the itinerary and delivery dates —",
      second: "luggage forwarding is handled.",
    },
    subtitleMobile:
      "Just tell us when and from which hotel to ship, and BondEx takes care of everything else.",
    subtitleDesktop: {
      first: "Just specify when and from which hotel to ship — voucher issuance, shipping labels,",
      second: "monthly billing, and change requests included. BondEx handles liaison with the carriers.",
    },
    bullets: [
      "BondEx creates every voucher and shipping label",
      "Shipping costs are settled together, monthly",
      "Changes and inquiries all go through a single BondEx contact",
    ],
    ctaConsult: "Get started",
    ctaSample: "View a sample PDF",
    replyNote: "We usually reply within one business day.",
    seePricing: "See pricing",
    stats: [
      { k: "Setup cost", v: "Free" },
      { k: "Minimum order", v: "From 1 shipment" },
      { k: "Voucher", v: "Same-day" },
      { k: "Payment", v: "Monthly / Card" },
    ],
    photoTitle: "Guests move on, hands-free.",
    photoBody: "BondEx forwards their luggage hotel to hotel.",
    photoAlt: "A family traveling in Japan without carrying suitcases",
  },
  sample: {
    eyebrow: "Real example",
    heading: "A voucher exactly as issued",
    openPdf: "Open PDF",
    altPrefix: "Sample voucher — ",
    pageLabels: ["Leg 1 — consolidated on one page", "Leg 2 — consolidated on one page"],
    caption:
      "The sample uses fictitious data. Tracking QR codes, per-leg display, and multi-leg itinerary lists are all supported.",
    openPdfMobile: "Open the sample PDF",
  },
  value: {
    items: [
      {
        title: "Send the itinerary and delivery dates",
        body: "Send the itinerary as a PDF, Excel file, or image, and specify the delivery date for each leg.",
      },
      {
        title: "Receive the full set of documents",
        body: "Vouchers and shipping labels are shared via Google Drive.",
      },
      {
        title: "One consolidated monthly invoice",
        body: "Closed at month-end, payable by the end of the following month.",
      },
    ],
  },
  difference: {
    eyebrow: "How it's different",
    heading: { first: "Turn luggage forwarding into", second: "part of the travel product." },
    intro:
      "From your itinerary data, BondEx handles the entire luggage forwarding process — arrangement, documents, and monthly billing. Travel agencies can present hands-free sightseeing and hotel-to-hotel delivery as added value within their travel plans.",
    conventionalHeading: "The conventional way",
    conventionalBody:
      "Travelers find a carrier themselves and book and pay for each shipment individually. Vouchers and shipping labels are managed separately from the itinerary, and travelers handle any change or delay inquiries on their own.",
    bondexHeading: "The BondEx way",
    bondexBody:
      "The agency simply sends the itinerary data, and we prepare the vouchers, shipping labels, and tracking together. Shipping costs can be included in the travel fee, so hands-free sightseeing becomes part of the travel plan.",
    cards: [
      {
        title: "Build it into your travel product",
        body: "Offer hands-free sightseeing and hotel-to-hotel delivery as a service included in the itinerary.",
      },
      {
        title: "Arrangements in one place",
        body: "Just send the itinerary data, and vouchers, shipping labels, and tracking are all prepared together.",
      },
      {
        title: "Consolidated billing and payment",
        body: "Shipping costs are billed to the agency in a consolidated monthly invoice, or can be paid by credit card.",
      },
    ],
  },
  flow: {
    eyebrow: "How it works",
    heading: { first: "Send the itinerary,", second: "then just receive." },
    steps: [
      { title: "Send the itinerary", desc: "PDF / Excel / image" },
      { title: "AI extracts the details", desc: "Reviewed by our staff" },
      { title: "Voucher, same day", desc: "Traveler's exchange slip" },
      { title: "Shipping label issued", desc: "From one month before pickup" },
      { title: "Shared via Drive", desc: "Notified by email / Slack" },
    ],
  },
  deliverables: {
    eyebrow: "Deliverables",
    heading: { first: "Every document you need,", second: "prepared together." },
    voucherHeading: "Traveler voucher",
    voucherBody: {
      a: "Issued ",
      strong: "the same day",
      b: " your itinerary arrives. Available in English, Chinese, Italian, French, and Spanish, and includes short-term storage guidance for hotel staff.",
    },
    waybillHeading: "Carrier shipping label",
    waybillBody: {
      a: "Issued up to ",
      strong: "one month",
      b: " before the pickup date (to carrier spec). Includes a tracking number and uses a major courier network.",
    },
  },
  trust: {
    eyebrow: "Why you can rely on us",
    heading: { first: "Why agencies can", second: "hand it over with confidence." },
    cards: [
      {
        title: "Compensation",
        head: "Up to ¥300,000 per item",
        body: "Delivery is handled by major couriers. Under the terms of carriage, each item is covered up to ¥300,000.",
      },
      {
        title: "Liaison",
        head: "We stand between you and the carriers",
        body: "BondEx acts as an intermediary, handling arrangements and coordination with carriers on your behalf and absorbing the operational work.",
      },
      {
        title: "Personal data",
        head: "SSL encryption, restricted access, no secondary use",
        body: "All itinerary data is transmitted over SSL and access is limited to assigned staff only. We never use it for any other purpose.",
      },
    ],
  },
  price: {
    eyebrow: "Pricing",
    heading: { first: "Per-shipment pricing,", second: "billed monthly." },
    intro:
      "There are no setup fees and no monthly fees. Shipping is generally quoted at a flat per-item rate, and the final pricing is confirmed at the time of contract after reviewing your volume and delivery conditions.",
    billingKicker: "Billing / Billing terms",
    billingHeading: "Billing terms",
    billingBody:
      "Shipping costs are settled together on a monthly basis. We total the month's shipments at month-end, issue an invoice at the start of the following month, and payment is due by the end of that month. Credit card payment is also accepted.",
    rows: [
      { term: "Closing date", desc: "Month-end" },
      { term: "Invoice issued", desc: "Start of the following month" },
      { term: "Payment due", desc: "End of the following month" },
      { term: "Payment method", desc: "Bank transfer / Credit card" },
      { term: "Freight", desc: "Settled monthly" },
      { term: "Billing unit", desc: "Consolidated monthly invoice" },
    ],
    sizeNote:
      "Items exceeding the courier's acceptance limit (up to 160 cm in total dimensions; weight per the carrier's rules), shipments to remote islands or certain areas, and special handling such as refrigerated or frozen delivery are generally out of scope. Please consult us on specific conditions.",
  },
  faq: {
    eyebrow: "Common questions",
    heading: { first: "For first-time partners,", second: "the questions we hear most." },
    callouts: [
      { label: "Compensation", text: "Up to ¥300,000 per item under our partner carrier's terms." },
      {
        label: "Deadlines",
        text: "Vouchers are issued the day the itinerary arrives; shipping labels one month before pickup.",
      },
      {
        label: "Cancellation",
        text: "Free if you tell us before pickup is completed. Not possible afterward, as delivery is already under way.",
      },
    ],
    items: [
      {
        q: "What formats can I send the itinerary in?",
        a: "Excel, PDF, images, and screenshots are all accepted. Whatever format your agency is used to is perfectly fine.",
      },
      {
        q: "If vouchers are issued right away, why are shipping labels only issued one month ahead?",
        a: "Because the carrier's issuing specifications only allow a shipping label to be created within 30 days of the pickup date. Vouchers are issued by BondEx, so they can be produced the same day.",
      },
      {
        q: "What is the billing cycle?",
        a: "We close at month-end, total the shipments issued that month, and send a PDF invoice to the agency at the start of the following month. Payment is due by the last day of the month after the billing month. BondEx advances the freight charges to the carrier.",
      },
      {
        q: "What does the compensation cover?",
        a: "It follows the terms of carriage of the logistics provider performing the actual transport in full. With our current partner courier, the limit is ¥300,000 per item. BondEx does not add any separate compensation of its own.",
      },
      {
        q: "What support do you provide during operation?",
        a: "A dedicated contact supports you throughout — onboarding at launch, changes and address updates during operation, and first-line response to pickup delays or complaints. We keep the extra workload on your side to a minimum.",
      },
      {
        q: "How long does it take from contract to going live?",
        a: "Once the service agreement (which clearly states our role as an intermediary) is signed, we issue your agency portal account and you can go live the same day. You can run a test issuance from your first itinerary PDF that same day.",
      },
    ],
  },
  contact: {
    heading: "Start a pilot with a single shipment.",
    body: {
      first: "We'll send the contract, responsibility matrix, sample invoice, and a legal-review package,",
      second: "along with options for scheduling a meeting.",
    },
    cta: "Go to the contact form",
    replyNote: "We usually reply within one business day.",
  },
  footer: {
    operatorPrefix: "Operated by ",
    operatorName: "JOJO Inc.",
    operatorAddress: " / 1-9-12 Noge, Setagaya-ku, Tokyo",
    tracking: "Tracking",
    terms: "Terms of Service",
    privacy: "Privacy",
    commercial: "Commercial Transactions Act",
    disclaimer:
      "BondEx is not a carrier; it is an intermediary service that receives itinerary information and arranges shipping with logistics providers. Actual transport, carriage liability, and compensation follow the terms of carriage of the logistics providers we use.",
    copyrightSuffix: " / BondEx",
  },
}

const es: LandingMessages = {
  nav: {
    flow: "Proceso",
    difference: "Diferencia",
    deliverables: "Documentos",
    trust: "Por qué confiar",
    price: "Precios",
    faq: "FAQ",
    tryDemo: "Ver la demo",
    consult: "Empezar",
    agencyLogin: "Acceso agencias",
    menuOpen: "Abrir menú",
    menuClose: "Cerrar menú",
  },
  demo: {
    header: { a: "Cómo funciona ", brand: "BondEx", b: ", de un vistazo" },
    sceneAria: "Escena",
    scenes: [
      {
        step: "STEP 1",
        title: "Envíe el itinerario y las fechas de entrega",
        body: "Comparta el itinerario (PDF, Excel o imagen) e indique cuándo y desde dónde enviar",
      },
      {
        step: "STEP 2",
        title: "BondEx organiza el envío",
        body: "Emitimos el voucher y la etiqueta de envío y se los entregamos",
      },
      {
        step: "STEP 3",
        title: "Los viajeros se mueven sin equipaje",
        body: "El equipaje va de hotel a hotel, entregado por nuestros transportistas asociados",
      },
      {
        step: "STEP 4",
        title: "Seguimiento y facturación, resueltos",
        body: "Consulte el estado de la entrega por código QR; los cargos se consolidan en una factura mensual",
      },
    ],
  },
  hero: {
    badgeMobile: "Para agencias de viajes receptivas y operadores terrestres",
    badgeDesktop: "Para agencias de viajes receptivas · Reenvío de equipaje, totalmente gestionado",
    titleMobile: ["Envíe el itinerario", "y las fechas de entrega,", "y el reenvío queda hecho."],
    titleDesktop: {
      first: "Envíe el itinerario y las fechas de entrega,",
      second: "y el reenvío de equipaje queda resuelto.",
    },
    subtitleMobile:
      "Solo díganos cuándo y desde qué hotel enviar, y BondEx se encarga de todo lo demás.",
    subtitleDesktop: {
      first: "Solo indique cuándo y desde qué hotel enviar: emisión de vouchers, etiquetas de envío,",
      second: "facturación mensual y cambios incluidos. BondEx gestiona el enlace con los transportistas.",
    },
    bullets: [
      "BondEx crea todos los vouchers y etiquetas de envío",
      "Los costes de envío se liquidan juntos, cada mes",
      "Cambios y consultas pasan por un único contacto en BondEx",
    ],
    ctaConsult: "Empezar",
    ctaSample: "Ver un PDF de muestra",
    replyNote: "Normalmente respondemos en un día hábil.",
    seePricing: "Ver precios",
    stats: [
      { k: "Coste inicial", v: "Gratis" },
      { k: "Pedido mínimo", v: "Desde 1 envío" },
      { k: "Voucher", v: "El mismo día" },
      { k: "Pago", v: "Mensual / Tarjeta" },
    ],
    photoTitle: "Los viajeros siguen su ruta, sin equipaje.",
    photoBody: "BondEx reenvía su equipaje de hotel a hotel.",
    photoAlt: "Una familia viajando por Japón sin cargar maletas",
  },
  sample: {
    eyebrow: "Ejemplo real",
    heading: "Un voucher tal y como se emite",
    openPdf: "Abrir PDF",
    altPrefix: "Voucher de muestra — ",
    pageLabels: ["Tramo 1 — consolidado en una página", "Tramo 2 — consolidado en una página"],
    caption:
      "La muestra usa datos ficticios. Se admiten códigos QR de seguimiento, visualización por tramo y listas de itinerarios de varios tramos.",
    openPdfMobile: "Abrir el PDF de muestra",
  },
  value: {
    items: [
      {
        title: "Envíe el itinerario y las fechas de entrega",
        body: "Envíe el itinerario en PDF, Excel o imagen, e indique la fecha de entrega de cada tramo.",
      },
      {
        title: "Reciba el conjunto completo de documentos",
        body: "Los vouchers y las etiquetas de envío se comparten por Google Drive.",
      },
      {
        title: "Una factura mensual consolidada",
        body: "Cierre a fin de mes, con pago hasta el final del mes siguiente.",
      },
    ],
  },
  difference: {
    eyebrow: "En qué se diferencia",
    heading: { first: "Convierta el reenvío de equipaje en", second: "parte del producto turístico." },
    intro:
      "A partir de los datos de su itinerario, BondEx gestiona todo el proceso de reenvío de equipaje: organización, documentos y facturación mensual. Las agencias pueden ofrecer el turismo sin equipaje y la entrega de hotel a hotel como valor añadido dentro de sus planes de viaje.",
    conventionalHeading: "El método convencional",
    conventionalBody:
      "Los viajeros buscan un transportista por su cuenta y reservan y pagan cada envío por separado. Los vouchers y las etiquetas de envío se gestionan aparte del itinerario, y los propios viajeros se ocupan de cualquier consulta por cambios o retrasos.",
    bondexHeading: "El método BondEx",
    bondexBody:
      "La agencia solo envía los datos del itinerario y nosotros preparamos los vouchers, las etiquetas de envío y el seguimiento en conjunto. Los costes de envío pueden incluirse en el precio del viaje, de modo que el turismo sin equipaje pasa a formar parte del plan de viaje.",
    cards: [
      {
        title: "Intégrelo en su producto turístico",
        body: "Ofrezca turismo sin equipaje y entrega de hotel a hotel como un servicio incluido en el itinerario.",
      },
      {
        title: "Gestión en un solo lugar",
        body: "Solo tiene que enviar los datos del itinerario y se preparan juntos los vouchers, las etiquetas de envío y el seguimiento.",
      },
      {
        title: "Facturación y pago consolidados",
        body: "Los costes de envío se facturan a la agencia en una factura mensual consolidada, o pueden pagarse con tarjeta de crédito.",
      },
    ],
  },
  flow: {
    eyebrow: "Cómo funciona",
    heading: { first: "Envíe el itinerario", second: "y ya solo queda recibir." },
    steps: [
      { title: "Envíe el itinerario", desc: "PDF / Excel / imagen" },
      { title: "La IA extrae los datos", desc: "Revisado por nuestro equipo" },
      { title: "Voucher, el mismo día", desc: "Comprobante para el viajero" },
      { title: "Etiqueta de envío emitida", desc: "Desde un mes antes de la recogida" },
      { title: "Compartido por Drive", desc: "Aviso por email / Slack" },
    ],
  },
  deliverables: {
    eyebrow: "Documentos",
    heading: { first: "Todos los documentos que necesita,", second: "preparados en conjunto." },
    voucherHeading: "Voucher para el viajero",
    voucherBody: {
      a: "Emitido ",
      strong: "el mismo día",
      b: " en que llega su itinerario. Disponible en inglés, chino, italiano, francés y español, e incluye instrucciones de custodia temporal para el personal del hotel.",
    },
    waybillHeading: "Etiqueta de envío del transportista",
    waybillBody: {
      a: "Emitida hasta ",
      strong: "un mes",
      b: " antes de la fecha de recogida (según especificación del transportista). Incluye número de seguimiento y utiliza una gran red de mensajería.",
    },
  },
  trust: {
    eyebrow: "Por qué puede confiar en nosotros",
    heading: { first: "Por qué las agencias pueden", second: "delegarlo con confianza." },
    cards: [
      {
        title: "Cobertura",
        head: "Hasta ¥300,000 por artículo",
        body: "La entrega corre a cargo de grandes empresas de mensajería. Según las condiciones de transporte, cada artículo está cubierto hasta ¥300,000.",
      },
      {
        title: "Intermediación",
        head: "Nos situamos entre usted y los transportistas",
        body: "BondEx actúa como intermediario, encargándose de la organización y la coordinación con los transportistas en su nombre y absorbiendo el trabajo operativo.",
      },
      {
        title: "Datos personales",
        head: "Cifrado SSL, acceso restringido, sin uso secundario",
        body: "Todos los datos del itinerario se transmiten mediante SSL y el acceso se limita únicamente al personal asignado. Nunca los usamos para ningún otro fin.",
      },
    ],
  },
  price: {
    eyebrow: "Precios",
    heading: { first: "Precio por envío,", second: "facturado mensualmente." },
    intro:
      "No hay costes de instalación ni cuotas mensuales. El envío se cotiza por lo general con una tarifa plana por artículo, y el precio final se confirma en el momento del contrato tras revisar su volumen y sus condiciones de entrega.",
    billingKicker: "Billing / Condiciones de facturación",
    billingHeading: "Condiciones de facturación",
    billingBody:
      "Los costes de envío se liquidan juntos con periodicidad mensual. Totalizamos los envíos del mes a fin de mes, emitimos una factura a principios del mes siguiente y el pago vence al final de ese mes. También se admite el pago con tarjeta de crédito.",
    rows: [
      { term: "Fecha de cierre", desc: "Fin de mes" },
      { term: "Emisión de la factura", desc: "Principios del mes siguiente" },
      { term: "Vencimiento del pago", desc: "Fin del mes siguiente" },
      { term: "Forma de pago", desc: "Transferencia bancaria / Tarjeta de crédito" },
      { term: "Flete", desc: "Liquidado mensualmente" },
      { term: "Unidad de facturación", desc: "Factura mensual consolidada" },
    ],
    sizeNote:
      "Los artículos que superen el límite de aceptación del transportista (hasta 160 cm de dimensiones totales; peso según las normas del transportista), los envíos a islas remotas o a determinadas zonas, y los envíos especiales como refrigerados o congelados quedan, por lo general, fuera del alcance. Consúltenos las condiciones concretas.",
  },
  faq: {
    eyebrow: "Preguntas frecuentes",
    heading: { first: "Para nuevos colaboradores,", second: "las preguntas más habituales." },
    callouts: [
      { label: "Cobertura", text: "Hasta ¥300,000 por artículo según las condiciones de nuestro transportista asociado." },
      {
        label: "Plazos",
        text: "Los vouchers se emiten el día en que llega el itinerario; las etiquetas de envío, un mes antes de la recogida.",
      },
      {
        label: "Cancelación",
        text: "Gratuita si nos avisa antes de completarse la recogida. Después no es posible, ya que la entrega está en marcha.",
      },
    ],
    items: [
      {
        q: "¿En qué formatos puedo enviar el itinerario?",
        a: "Se admiten Excel, PDF, imágenes y capturas de pantalla. El formato al que su agencia esté acostumbrada es perfectamente válido.",
      },
      {
        q: "Si los vouchers se emiten de inmediato, ¿por qué las etiquetas de envío solo se emiten un mes antes?",
        a: "Porque las especificaciones de emisión del transportista solo permiten crear una etiqueta de envío dentro de los 30 días previos a la fecha de recogida. Los vouchers los emite BondEx, por lo que pueden producirse el mismo día.",
      },
      {
        q: "¿Cuál es el ciclo de facturación?",
        a: "Cerramos a fin de mes, totalizamos los envíos emitidos ese mes y enviamos una factura en PDF a la agencia a principios del mes siguiente. El pago vence el último día del mes siguiente al de facturación. BondEx adelanta los gastos de flete al transportista.",
      },
      {
        q: "¿Qué cubre la cobertura?",
        a: "Se rige íntegramente por las condiciones de transporte del proveedor logístico que realiza el transporte real. Con nuestro transportista asociado actual, el límite es de ¥300,000 por artículo. BondEx no añade ninguna cobertura propia adicional.",
      },
      {
        q: "¿Qué soporte ofrecen durante la operación?",
        a: "Un contacto dedicado le acompaña en todo momento: incorporación al inicio, cambios y actualizaciones de destino durante la operación, y primera respuesta ante retrasos en la recogida o reclamaciones. Mantenemos al mínimo la carga de trabajo adicional para usted.",
      },
      {
        q: "¿Cuánto se tarda desde el contrato hasta la puesta en marcha?",
        a: "Una vez firmado el contrato de servicio (que indica claramente nuestro papel como intermediario), emitimos la cuenta de su portal de agencia y puede empezar a operar el mismo día. Puede hacer una emisión de prueba con su primer PDF de itinerario ese mismo día.",
      },
    ],
  },
  contact: {
    heading: "Empiece un piloto con un solo envío.",
    body: {
      first: "Le enviaremos el contrato, la matriz de responsabilidades, una factura de muestra y un paquete para revisión jurídica,",
      second: "junto con opciones para concertar una reunión.",
    },
    cta: "Ir al formulario de contacto",
    replyNote: "Normalmente respondemos en un día hábil.",
  },
  footer: {
    operatorPrefix: "Operado por ",
    operatorName: "JOJO Inc.",
    operatorAddress: " / 1-9-12 Noge, Setagaya-ku, Tokio",
    tracking: "Seguimiento",
    terms: "Términos del servicio",
    privacy: "Privacidad",
    commercial: "Ley de Transacciones Comerciales",
    disclaimer:
      "BondEx no es un transportista; es un servicio de intermediación que recibe la información del itinerario y organiza el envío con proveedores logísticos. El transporte real, la responsabilidad de transporte y la cobertura se rigen por las condiciones de transporte de los proveedores logísticos que utilizamos.",
    copyrightSuffix: " / BondEx",
  },
}

const fr: LandingMessages = {
  nav: {
    flow: "Déroulement",
    difference: "Différence",
    deliverables: "Documents",
    trust: "Pourquoi nous faire confiance",
    price: "Tarifs",
    faq: "FAQ",
    tryDemo: "Voir la démo",
    consult: "Commencer",
    agencyLogin: "Espace agence",
    menuOpen: "Ouvrir le menu",
    menuClose: "Fermer le menu",
  },
  demo: {
    header: { a: "Comment ", brand: "BondEx", b: " fonctionne, en un coup d'œil" },
    sceneAria: "Scène",
    scenes: [
      {
        step: "STEP 1",
        title: "Envoyez l'itinéraire et les dates de livraison",
        body: "Partagez l'itinéraire (PDF, Excel ou image) et précisez quand et depuis où expédier",
      },
      {
        step: "STEP 2",
        title: "BondEx organise l'expédition",
        body: "Nous émettons le bon et l'étiquette d'expédition et vous les remettons",
      },
      {
        step: "STEP 3",
        title: "Les voyageurs se déplacent les mains libres",
        body: "Les bagages vont d'hôtel en hôtel, livrés par nos transporteurs partenaires",
      },
      {
        step: "STEP 4",
        title: "Suivi et facturation, pris en charge",
        body: "Consultez l'état de la livraison par QR code ; les frais sont regroupés sur une facture mensuelle",
      },
    ],
  },
  hero: {
    badgeMobile: "Pour les agences de voyage réceptives et les tour-opérateurs terrestres",
    badgeDesktop: "Pour les agences de voyage réceptives · Réexpédition de bagages, entièrement gérée",
    titleMobile: ["Envoyez l'itinéraire", "et les dates de livraison :", "tout le reste est géré."],
    titleDesktop: {
      first: "Envoyez l'itinéraire et les dates de livraison,",
      second: "la réexpédition des bagages est prise en charge.",
    },
    subtitleMobile:
      "Dites-nous simplement quand et depuis quel hôtel expédier, et BondEx s'occupe de tout le reste.",
    subtitleDesktop: {
      first: "Précisez simplement quand et depuis quel hôtel expédier : émission des bons, étiquettes d'expédition,",
      second: "facturation mensuelle et demandes de modification incluses. BondEx assure la liaison avec les transporteurs.",
    },
    bullets: [
      "BondEx crée chaque bon et chaque étiquette d'expédition",
      "Les frais d'expédition sont réglés ensemble, chaque mois",
      "Modifications et questions passent par un interlocuteur BondEx unique",
    ],
    ctaConsult: "Commencer",
    ctaSample: "Voir un PDF d'exemple",
    replyNote: "Nous répondons généralement sous un jour ouvré.",
    seePricing: "Voir les tarifs",
    stats: [
      { k: "Frais de mise en place", v: "Gratuit" },
      { k: "Commande minimale", v: "À partir d'1 envoi" },
      { k: "Bon", v: "Le jour même" },
      { k: "Paiement", v: "Mensuel / Carte" },
    ],
    photoTitle: "Les voyageurs poursuivent leur route, les mains libres.",
    photoBody: "BondEx réexpédie leurs bagages d'hôtel en hôtel.",
    photoAlt: "Une famille voyageant au Japon sans porter de valises",
  },
  sample: {
    eyebrow: "Exemple réel",
    heading: "Un bon tel qu'il est émis",
    openPdf: "Ouvrir le PDF",
    altPrefix: "Bon d'exemple — ",
    pageLabels: ["Trajet 1 — regroupé sur une page", "Trajet 2 — regroupé sur une page"],
    caption:
      "L'exemple utilise des données fictives. Les QR codes de suivi, l'affichage par trajet et les listes d'itinéraires à plusieurs trajets sont tous pris en charge.",
    openPdfMobile: "Ouvrir le PDF d'exemple",
  },
  value: {
    items: [
      {
        title: "Envoyez l'itinéraire et les dates de livraison",
        body: "Envoyez l'itinéraire en PDF, Excel ou image, et précisez la date de livraison pour chaque trajet.",
      },
      {
        title: "Recevez l'ensemble complet des documents",
        body: "Les bons et les étiquettes d'expédition sont partagés via Google Drive.",
      },
      {
        title: "Une facture mensuelle unique",
        body: "Clôture en fin de mois, payable avant la fin du mois suivant.",
      },
    ],
  },
  difference: {
    eyebrow: "Ce qui change",
    heading: { first: "Faites de la réexpédition des bagages", second: "un élément du produit touristique." },
    intro:
      "À partir des données de votre itinéraire, BondEx prend en charge l'ensemble du processus de réexpédition des bagages : organisation, documents et facturation mensuelle. Les agences de voyage peuvent proposer le tourisme sans bagages et la livraison d'hôtel en hôtel comme valeur ajoutée de leurs offres.",
    conventionalHeading: "La méthode classique",
    conventionalBody:
      "Les voyageurs trouvent eux-mêmes un transporteur et réservent et paient chaque envoi individuellement. Les bons et les étiquettes d'expédition sont gérés séparément de l'itinéraire, et les voyageurs traitent eux-mêmes toute question liée à un changement ou à un retard.",
    bondexHeading: "La méthode BondEx",
    bondexBody:
      "L'agence envoie simplement les données de l'itinéraire et nous préparons ensemble les bons, les étiquettes d'expédition et le suivi. Les frais d'expédition peuvent être inclus dans le prix du voyage, si bien que le tourisme sans bagages devient partie intégrante de l'offre.",
    cards: [
      {
        title: "Intégrez-la à votre produit touristique",
        body: "Proposez le tourisme sans bagages et la livraison d'hôtel en hôtel comme un service inclus dans l'itinéraire.",
      },
      {
        title: "Une organisation centralisée",
        body: "Il suffit d'envoyer les données de l'itinéraire, et les bons, les étiquettes d'expédition et le suivi sont préparés ensemble.",
      },
      {
        title: "Facturation et paiement regroupés",
        body: "Les frais d'expédition sont facturés à l'agence sur une facture mensuelle unique, ou peuvent être réglés par carte bancaire.",
      },
    ],
  },
  flow: {
    eyebrow: "Comment ça marche",
    heading: { first: "Envoyez l'itinéraire,", second: "il ne reste qu'à recevoir." },
    steps: [
      { title: "Envoyez l'itinéraire", desc: "PDF / Excel / image" },
      { title: "L'IA extrait les détails", desc: "Vérifié par notre équipe" },
      { title: "Bon, le jour même", desc: "Justificatif pour le voyageur" },
      { title: "Étiquette d'expédition émise", desc: "Dès un mois avant l'enlèvement" },
      { title: "Partagé via Drive", desc: "Notifié par e-mail / Slack" },
    ],
  },
  deliverables: {
    eyebrow: "Documents",
    heading: { first: "Tous les documents nécessaires,", second: "préparés ensemble." },
    voucherHeading: "Bon voyageur",
    voucherBody: {
      a: "Émis ",
      strong: "le jour même",
      b: " de la réception de votre itinéraire. Disponible en anglais, chinois, italien, français et espagnol, et comprend des consignes de garde temporaire pour le personnel de l'hôtel.",
    },
    waybillHeading: "Étiquette d'expédition du transporteur",
    waybillBody: {
      a: "Émise jusqu'à ",
      strong: "un mois",
      b: " avant la date d'enlèvement (selon les spécifications du transporteur). Comprend un numéro de suivi et utilise un grand réseau de messagerie.",
    },
  },
  trust: {
    eyebrow: "Pourquoi vous pouvez compter sur nous",
    heading: { first: "Pourquoi les agences peuvent", second: "déléguer en toute confiance." },
    cards: [
      {
        title: "Indemnisation",
        head: "Jusqu'à ¥300,000 par article",
        body: "La livraison est assurée par de grands transporteurs. Selon les conditions de transport, chaque article est couvert jusqu'à ¥300,000.",
      },
      {
        title: "Intermédiation",
        head: "Nous nous plaçons entre vous et les transporteurs",
        body: "BondEx agit comme intermédiaire, prenant en charge l'organisation et la coordination avec les transporteurs pour votre compte et absorbant le travail opérationnel.",
      },
      {
        title: "Données personnelles",
        head: "Chiffrement SSL, accès restreint, aucune utilisation secondaire",
        body: "Toutes les données d'itinéraire sont transmises via SSL et l'accès est limité au seul personnel désigné. Nous ne les utilisons jamais à d'autres fins.",
      },
    ],
  },
  price: {
    eyebrow: "Tarifs",
    heading: { first: "Tarif par envoi,", second: "facturé mensuellement." },
    intro:
      "Il n'y a ni frais de mise en place ni frais mensuels. L'expédition est généralement facturée à un tarif forfaitaire par article, et le tarif final est confirmé au moment du contrat après examen de votre volume et de vos conditions de livraison.",
    billingKicker: "Billing / Conditions de facturation",
    billingHeading: "Conditions de facturation",
    billingBody:
      "Les frais d'expédition sont réglés ensemble sur une base mensuelle. Nous totalisons les envois du mois en fin de mois, émettons une facture au début du mois suivant, et le paiement est dû avant la fin de ce mois. Le paiement par carte bancaire est également accepté.",
    rows: [
      { term: "Date de clôture", desc: "Fin de mois" },
      { term: "Émission de la facture", desc: "Début du mois suivant" },
      { term: "Échéance de paiement", desc: "Fin du mois suivant" },
      { term: "Mode de paiement", desc: "Virement bancaire / Carte bancaire" },
      { term: "Fret", desc: "Réglé mensuellement" },
      { term: "Unité de facturation", desc: "Facture mensuelle unique" },
    ],
    sizeNote:
      "Les articles dépassant la limite d'acceptation du transporteur (jusqu'à 160 cm de dimensions totales ; poids selon les règles du transporteur), les envois vers des îles éloignées ou certaines régions, et les livraisons spéciales telles que réfrigérées ou congelées sont en principe hors périmètre. Consultez-nous pour les conditions précises.",
  },
  faq: {
    eyebrow: "Questions fréquentes",
    heading: { first: "Pour les nouveaux partenaires,", second: "les questions les plus courantes." },
    callouts: [
      { label: "Indemnisation", text: "Jusqu'à ¥300,000 par article selon les conditions de notre transporteur partenaire." },
      {
        label: "Délais",
        text: "Les bons sont émis le jour de la réception de l'itinéraire ; les étiquettes d'expédition, un mois avant l'enlèvement.",
      },
      {
        label: "Annulation",
        text: "Gratuite si vous nous prévenez avant la fin de l'enlèvement. Impossible ensuite, la livraison étant déjà en cours.",
      },
    ],
    items: [
      {
        q: "Sous quels formats puis-je envoyer l'itinéraire ?",
        a: "Excel, PDF, images et captures d'écran sont tous acceptés. Le format auquel votre agence est habituée convient parfaitement.",
      },
      {
        q: "Si les bons sont émis immédiatement, pourquoi les étiquettes d'expédition ne le sont-elles qu'un mois à l'avance ?",
        a: "Parce que les spécifications d'émission du transporteur ne permettent de créer une étiquette d'expédition que dans les 30 jours précédant la date d'enlèvement. Les bons sont émis par BondEx et peuvent donc être produits le jour même.",
      },
      {
        q: "Quel est le cycle de facturation ?",
        a: "Nous clôturons en fin de mois, totalisons les envois émis ce mois-là et adressons une facture PDF à l'agence au début du mois suivant. Le paiement est dû le dernier jour du mois suivant le mois de facturation. BondEx avance les frais de fret au transporteur.",
      },
      {
        q: "Que couvre l'indemnisation ?",
        a: "Elle suit intégralement les conditions de transport du prestataire logistique qui effectue le transport réel. Avec notre transporteur partenaire actuel, la limite est de ¥300,000 par article. BondEx n'ajoute aucune indemnisation propre.",
      },
      {
        q: "Quel accompagnement proposez-vous pendant l'exploitation ?",
        a: "Un interlocuteur dédié vous accompagne du début à la fin : intégration au lancement, modifications et changements d'adresse en cours d'exploitation, et première réponse en cas de retard d'enlèvement ou de réclamation. Nous réduisons au minimum la charge supplémentaire de votre côté.",
      },
      {
        q: "Combien de temps entre le contrat et le démarrage ?",
        a: "Une fois le contrat de service signé (indiquant clairement notre rôle d'intermédiaire), nous créons votre compte sur le portail agence et vous pouvez démarrer le jour même. Vous pouvez effectuer une émission de test à partir de votre premier PDF d'itinéraire le jour même.",
      },
    ],
  },
  contact: {
    heading: "Lancez un pilote avec un seul envoi.",
    body: {
      first: "Nous vous enverrons le contrat, la matrice des responsabilités, une facture d'exemple et un dossier pour revue juridique,",
      second: "ainsi que des options pour convenir d'un rendez-vous.",
    },
    cta: "Accéder au formulaire de contact",
    replyNote: "Nous répondons généralement sous un jour ouvré.",
  },
  footer: {
    operatorPrefix: "Exploité par ",
    operatorName: "JOJO Inc.",
    operatorAddress: " / 1-9-12 Noge, Setagaya-ku, Tokyo",
    tracking: "Suivi",
    terms: "Conditions d'utilisation",
    privacy: "Confidentialité",
    commercial: "Loi sur les transactions commerciales",
    disclaimer:
      "BondEx n'est pas un transporteur ; c'est un service d'intermédiation qui reçoit les informations d'itinéraire et organise l'expédition auprès de prestataires logistiques. Le transport réel, la responsabilité de transport et l'indemnisation relèvent des conditions de transport des prestataires logistiques que nous utilisons.",
    copyrightSuffix: " / BondEx",
  },
}

const zh: LandingMessages = {
  nav: {
    flow: "流程",
    difference: "区别",
    deliverables: "交付物",
    trust: "信赖理由",
    price: "价格",
    faq: "常见问题",
    tryDemo: "试用演示",
    consult: "开始使用",
    agencyLogin: "代理商登录",
    menuOpen: "打开菜单",
    menuClose: "关闭菜单",
  },
  demo: {
    header: { a: "一目了然，", brand: "BondEx", b: " 如何运作" },
    sceneAria: "场景",
    scenes: [
      {
        step: "STEP 1",
        title: "发送行程与配送日期",
        body: "提供行程（PDF、Excel 或图片），并指定何时、从何处发货",
      },
      {
        step: "STEP 2",
        title: "BondEx 安排配送",
        body: "我们开具兑换券和运单并交付给您",
      },
      {
        step: "STEP 3",
        title: "旅客轻装出行",
        body: "行李由我们的合作承运商在酒店之间配送",
      },
      {
        step: "STEP 4",
        title: "追踪与结算，全部搞定",
        body: "通过二维码查看配送状态；费用汇总为每月一张账单",
      },
    ],
  },
  hero: {
    badgeMobile: "面向入境旅行社与地接社",
    badgeDesktop: "面向入境旅行社 · 行李转运，全程托管",
    titleMobile: ["只需发送行程", "与配送日期，", "行李转运即告完成。"],
    titleDesktop: {
      first: "只需发送行程与配送日期，",
      second: "行李转运即告完成。",
    },
    subtitleMobile:
      "只需告诉我们何时、从哪家酒店发货，其余的一切都交给 BondEx。",
    subtitleDesktop: {
      first: "只需指定何时、从哪家酒店发货——兑换券开具、运单、",
      second: "每月结算与变更处理全部包含。BondEx 负责与承运商对接。",
    },
    bullets: [
      "每一张兑换券和运单都由 BondEx 制作",
      "配送费用按月汇总结算",
      "变更与咨询统一通过 BondEx 专属对接人",
    ],
    ctaConsult: "开始使用",
    ctaSample: "查看示例 PDF",
    replyNote: "我们通常在一个工作日内回复。",
    seePricing: "查看价格",
    stats: [
      { k: "初期费用", v: "免费" },
      { k: "最低起订", v: "1 件起" },
      { k: "兑换券", v: "当日开具" },
      { k: "付款方式", v: "每月 / 刷卡" },
    ],
    photoTitle: "旅客轻装上阵，前往下一站。",
    photoBody: "BondEx 将行李在酒店之间转运。",
    photoAlt: "一家人无需拖行李箱畅游日本",
  },
  sample: {
    eyebrow: "实物示例",
    heading: "与实际开具一致的兑换券",
    openPdf: "打开 PDF",
    altPrefix: "兑换券示例 — ",
    pageLabels: ["区间 1 — 已汇总于一页", "区间 2 — 已汇总于一页"],
    caption:
      "示例采用虚构数据。支持追踪二维码、分区间显示以及多区间行程列表。",
    openPdfMobile: "打开示例 PDF",
  },
  value: {
    items: [
      {
        title: "发送行程与配送日期",
        body: "以 PDF、Excel 或图片发送行程，并指定各区间的配送日期。",
      },
      {
        title: "收到全套文件",
        body: "兑换券与运单通过 Google Drive 共享。",
      },
      {
        title: "每月汇总一张账单",
        body: "月末结账，次月底前付款。",
      },
    ],
  },
  difference: {
    eyebrow: "有何不同",
    heading: { first: "让行李转运，", second: "成为旅行产品的一部分。" },
    intro:
      "BondEx 依据您的行程数据，全程处理行李转运——从安排、文件到每月结算。旅行社可将轻装观光与酒店间配送作为旅行方案中的增值服务加以呈现。",
    conventionalHeading: "传统方式",
    conventionalBody:
      "旅客需自行寻找承运商，并逐单预订、付款。兑换券与运单与行程分开管理，变更或延误的咨询也由旅客本人处理。",
    bondexHeading: "BondEx 方式",
    bondexBody:
      "代理商只需发送行程数据，我们即可将兑换券、运单与追踪信息一并备妥。配送费用可计入旅费，让轻装观光成为旅行方案的一部分。",
    cards: [
      {
        title: "可融入旅行产品",
        body: "将轻装观光与酒店间配送作为行程中包含的服务提供。",
      },
      {
        title: "手续一体化",
        body: "只需发送行程数据，兑换券、运单与追踪信息即一并备妥。",
      },
      {
        title: "汇总开票与付款",
        body: "配送费用以每月一张汇总账单向代理商开具，也可使用信用卡支付。",
      },
    ],
  },
  flow: {
    eyebrow: "运作方式",
    heading: { first: "发送行程后，", second: "只需坐等收件。" },
    steps: [
      { title: "发送行程", desc: "PDF / Excel / 图片" },
      { title: "AI 提取信息", desc: "由我方人员复核" },
      { title: "兑换券当日开具", desc: "旅客用兑换凭证" },
      { title: "开具运单", desc: "自取件前一个月起" },
      { title: "通过 Drive 共享", desc: "以邮件 / Slack 通知" },
    ],
  },
  deliverables: {
    eyebrow: "交付物",
    heading: { first: "所需的每份文件，", second: "一并备妥。" },
    voucherHeading: "旅客兑换券",
    voucherBody: {
      a: "行程送达后 ",
      strong: "当日开具",
      b: "。支持英语、中文、意大利语、法语和西班牙语，并附有面向酒店工作人员的临时寄存说明。",
    },
    waybillHeading: "承运商运单",
    waybillBody: {
      a: "最早于取件日前 ",
      strong: "一个月",
      b: " 开具（按承运商规格）。附带追踪号，采用大型快递网络。",
    },
  },
  trust: {
    eyebrow: "值得信赖的理由",
    heading: { first: "代理商为何能够", second: "放心托付。" },
    cards: [
      {
        title: "赔偿",
        head: "每件最高 ¥300,000",
        body: "配送由大型快递公司承担。依据运输条款，每件最高赔偿 ¥300,000。",
      },
      {
        title: "居间对接",
        head: "我们介于您与承运商之间",
        body: "BondEx 作为居间方，代您处理与承运商的安排与协调，承接相关运营工作。",
      },
      {
        title: "个人信息",
        head: "SSL 加密、权限受限、不作他用",
        body: "所有行程数据均通过 SSL 传输，访问权限仅限指定人员。我们绝不用于任何其他目的。",
      },
    ],
  },
  price: {
    eyebrow: "价格",
    heading: { first: "按件计价，", second: "每月汇总开票。" },
    intro:
      "无初期费用，无月度费用。运费原则上按统一的单件费率报价，正式价格在核对您的业务量与配送条件后于签约时确定。",
    billingKicker: "Billing / 结算条件",
    billingHeading: "结算条件",
    billingBody:
      "配送费用按月汇总结算。我们在月末合计当月的配送，次月初开具账单，款项须于当月底前支付。同时支持信用卡付款。",
    rows: [
      { term: "结账日", desc: "月末" },
      { term: "账单开具", desc: "次月初" },
      { term: "付款期限", desc: "次月底" },
      { term: "付款方式", desc: "银行转账 / 信用卡" },
      { term: "运费", desc: "按月汇总结算" },
      { term: "开票单位", desc: "每月汇总账单" },
    ],
    sizeNote:
      "超出快递受理限额（三边合计 160 厘米以内；重量以承运商规定为准）的物品、寄往离岛或部分地区的物品，以及冷藏冷冻等特殊配送，原则上不在服务范围内。具体条件请单独咨询。",
  },
  faq: {
    eyebrow: "常见问题",
    heading: { first: "初次合作者", second: "最常问到的问题。" },
    callouts: [
      { label: "赔偿", text: "依据合作物流公司的条款，每件最高 ¥300,000。" },
      {
        label: "时限",
        text: "行程送达当日开具兑换券；运单于取件前一个月开具。",
      },
      {
        label: "取消",
        text: "在取件完成前告知则免费。取件后因配送已启动，无法取消。",
      },
    ],
    items: [
      {
        q: "行程可以用哪些格式发送？",
        a: "Excel、PDF、图片、截图均可接受。沿用贵代理商惯用的格式即可。",
      },
      {
        q: "既然兑换券能立即开具，为何运单只能提前一个月开具？",
        a: "因为按承运商的开具规格，运单只能在取件日前 30 天以内创建。兑换券由 BondEx 开具，因此可当日完成。",
      },
      {
        q: "费用的结算周期如何？",
        a: "以月末结账，合计当月开具的配送，次月初向代理商发送 PDF 账单。付款期限为计费月次月的最后一天。运费由 BondEx 先行垫付给承运商。",
      },
      {
        q: "赔偿范围如何？",
        a: "完全依照实际承运的物流商的运输条款。以我方现有的合作快递，每件上限为 ¥300,000。BondEx 不另行提供额外赔偿。",
      },
      {
        q: "运营期间提供哪些支持？",
        a: "专属对接人全程陪伴——上线时的导入、运营中的变更与收件地址更新，以及取件延误或投诉时的一线响应。我们将贵方的额外工作量降至最低。",
      },
      {
        q: "从签约到正式上线需要多久？",
        a: "在签署业务委托合同（其中明确注明我方居间方身份）后，我们即开通您的代理商门户账户，可当日上线。您可用首份行程 PDF 于当日进行测试开具。",
      },
    ],
  },
  contact: {
    heading: "试运营，1 件起。",
    body: {
      first: "我们会将合同、责任划分表、账单样本以及供法务审阅的资料，",
      second: "连同会谈时间安排选项一并寄送。",
    },
    cta: "前往咨询表单",
    replyNote: "我们通常在一个工作日内回复。",
  },
  footer: {
    operatorPrefix: "运营方：",
    operatorName: "JOJO株式会社",
    operatorAddress: " / 东京都世田谷区野毛1-9-12",
    tracking: "追踪",
    terms: "服务条款",
    privacy: "隐私政策",
    commercial: "特定商业交易法",
    disclaimer:
      "BondEx 并非承运人，而是一项居间服务：接收行程信息并代为向物流商安排发货。实际运输、运输责任与赔偿均依照我们所使用物流商的运输条款。",
    copyrightSuffix: " / BondEx",
  },
}

const it: LandingMessages = {
  nav: {
    flow: "Processo",
    difference: "Differenza",
    deliverables: "Documenti",
    trust: "Perché fidarsi",
    price: "Prezzi",
    faq: "FAQ",
    tryDemo: "Prova la demo",
    consult: "Inizia",
    agencyLogin: "Accesso agenzie",
    menuOpen: "Apri il menu",
    menuClose: "Chiudi il menu",
  },
  demo: {
    header: { a: "Come funziona ", brand: "BondEx", b: ", in breve" },
    sceneAria: "Scena",
    scenes: [
      {
        step: "STEP 1",
        title: "Invia l'itinerario e le date di consegna",
        body: "Condividi l'itinerario (PDF, Excel o immagine) e indica quando e da dove spedire",
      },
      {
        step: "STEP 2",
        title: "BondEx organizza la spedizione",
        body: "Emettiamo il voucher e l'etichetta di spedizione e te li consegniamo",
      },
      {
        step: "STEP 3",
        title: "Gli ospiti viaggiano a mani libere",
        body: "I bagagli vanno di hotel in hotel, consegnati dai nostri corrieri partner",
      },
      {
        step: "STEP 4",
        title: "Tracciamento e fatturazione, gestiti",
        body: "Controlla lo stato della consegna tramite QR code; gli addebiti sono riuniti in un'unica fattura mensile",
      },
    ],
  },
  hero: {
    badgeMobile: "Per agenzie di viaggio incoming e tour operator locali",
    badgeDesktop: "Per agenzie di viaggio incoming · Inoltro bagagli, completamente gestito",
    titleMobile: ["Invia l'itinerario", "e le date di consegna:", "all'inoltro pensiamo noi."],
    titleDesktop: {
      first: "Invia l'itinerario e le date di consegna,",
      second: "all'inoltro dei bagagli pensiamo noi.",
    },
    subtitleMobile:
      "Basta dirci quando e da quale hotel spedire, e BondEx si occupa di tutto il resto.",
    subtitleDesktop: {
      first: "Basta indicare quando e da quale hotel spedire: emissione dei voucher, etichette di spedizione,",
      second: "fatturazione mensile e richieste di modifica incluse. BondEx cura i rapporti con i corrieri.",
    },
    bullets: [
      "BondEx crea ogni voucher e ogni etichetta di spedizione",
      "I costi di spedizione si saldano insieme, ogni mese",
      "Modifiche e domande passano da un unico referente BondEx",
    ],
    ctaConsult: "Inizia",
    ctaSample: "Guarda un PDF di esempio",
    replyNote: "Di norma rispondiamo entro un giorno lavorativo.",
    seePricing: "Vedi i prezzi",
    stats: [
      { k: "Costo iniziale", v: "Gratuito" },
      { k: "Ordine minimo", v: "Da 1 spedizione" },
      { k: "Voucher", v: "In giornata" },
      { k: "Pagamento", v: "Mensile / Carta" },
    ],
    photoTitle: "Gli ospiti proseguono, a mani libere.",
    photoBody: "BondEx inoltra i loro bagagli di hotel in hotel.",
    photoAlt: "Una famiglia in viaggio in Giappone senza portare valigie",
  },
  sample: {
    eyebrow: "Esempio reale",
    heading: "Un voucher esattamente come viene emesso",
    openPdf: "Apri PDF",
    altPrefix: "Voucher di esempio — ",
    pageLabels: ["Tratta 1 — riunita in una pagina", "Tratta 2 — riunita in una pagina"],
    caption:
      "L'esempio utilizza dati fittizi. Sono supportati QR code di tracciamento, visualizzazione per tratta ed elenchi di itinerari con più tratte.",
    openPdfMobile: "Apri il PDF di esempio",
  },
  value: {
    items: [
      {
        title: "Invia l'itinerario e le date di consegna",
        body: "Invia l'itinerario in PDF, Excel o immagine e indica la data di consegna per ciascuna tratta.",
      },
      {
        title: "Ricevi il set completo di documenti",
        body: "I voucher e le etichette di spedizione sono condivisi tramite Google Drive.",
      },
      {
        title: "Un'unica fattura mensile",
        body: "Chiusura a fine mese, con pagamento entro la fine del mese successivo.",
      },
    ],
  },
  difference: {
    eyebrow: "Cosa cambia",
    heading: { first: "Trasforma l'inoltro bagagli in", second: "parte del prodotto turistico." },
    intro:
      "Dai dati del tuo itinerario, BondEx gestisce l'intero processo di inoltro bagagli: organizzazione, documenti e fatturazione mensile. Le agenzie di viaggio possono proporre il turismo a mani libere e la consegna di hotel in hotel come valore aggiunto dei loro pacchetti.",
    conventionalHeading: "Il metodo tradizionale",
    conventionalBody:
      "I viaggiatori cercano da soli un corriere e prenotano e pagano ogni spedizione singolarmente. I voucher e le etichette di spedizione sono gestiti separatamente dall'itinerario, e sono i viaggiatori stessi a occuparsi di eventuali richieste per modifiche o ritardi.",
    bondexHeading: "Il metodo BondEx",
    bondexBody:
      "L'agenzia invia semplicemente i dati dell'itinerario e noi prepariamo insieme i voucher, le etichette di spedizione e il tracciamento. I costi di spedizione possono essere inclusi nel prezzo del viaggio, così il turismo a mani libere diventa parte del pacchetto.",
    cards: [
      {
        title: "Integralo nel tuo prodotto turistico",
        body: "Offri il turismo a mani libere e la consegna di hotel in hotel come servizio incluso nell'itinerario.",
      },
      {
        title: "Organizzazione in un unico punto",
        body: "Basta inviare i dati dell'itinerario e voucher, etichette di spedizione e tracciamento vengono preparati insieme.",
      },
      {
        title: "Fatturazione e pagamento riuniti",
        body: "I costi di spedizione sono fatturati all'agenzia in un'unica fattura mensile, oppure possono essere pagati con carta di credito.",
      },
    ],
  },
  flow: {
    eyebrow: "Come funziona",
    heading: { first: "Invia l'itinerario,", second: "poi basta ricevere." },
    steps: [
      { title: "Invia l'itinerario", desc: "PDF / Excel / immagine" },
      { title: "L'IA estrae i dettagli", desc: "Verificato dal nostro team" },
      { title: "Voucher, in giornata", desc: "Tagliando per il viaggiatore" },
      { title: "Etichetta di spedizione emessa", desc: "Da un mese prima del ritiro" },
      { title: "Condiviso via Drive", desc: "Notifica via e-mail / Slack" },
    ],
  },
  deliverables: {
    eyebrow: "Documenti",
    heading: { first: "Ogni documento necessario,", second: "preparato insieme." },
    voucherHeading: "Voucher per il viaggiatore",
    voucherBody: {
      a: "Emesso ",
      strong: "in giornata",
      b: " all'arrivo del tuo itinerario. Disponibile in inglese, cinese, italiano, francese e spagnolo, e include istruzioni di custodia temporanea per il personale dell'hotel.",
    },
    waybillHeading: "Etichetta di spedizione del corriere",
    waybillBody: {
      a: "Emessa fino a ",
      strong: "un mese",
      b: " prima della data di ritiro (secondo le specifiche del corriere). Include un numero di tracciamento e utilizza una grande rete di corrieri.",
    },
  },
  trust: {
    eyebrow: "Perché puoi contare su di noi",
    heading: { first: "Perché le agenzie possono", second: "affidarlo con fiducia." },
    cards: [
      {
        title: "Risarcimento",
        head: "Fino a ¥300,000 per collo",
        body: "La consegna è affidata a grandi corrieri. In base alle condizioni di trasporto, ogni collo è coperto fino a ¥300,000.",
      },
      {
        title: "Intermediazione",
        head: "Ci poniamo tra te e i corrieri",
        body: "BondEx agisce da intermediario, occupandosi dell'organizzazione e del coordinamento con i corrieri per tuo conto e assorbendo il lavoro operativo.",
      },
      {
        title: "Dati personali",
        head: "Cifratura SSL, accesso limitato, nessun uso secondario",
        body: "Tutti i dati dell'itinerario sono trasmessi tramite SSL e l'accesso è limitato al solo personale incaricato. Non li utilizziamo mai per altri scopi.",
      },
    ],
  },
  price: {
    eyebrow: "Prezzi",
    heading: { first: "Prezzo per spedizione,", second: "fatturato mensilmente." },
    intro:
      "Non ci sono costi di attivazione né canoni mensili. La spedizione è di norma quotata a una tariffa fissa per collo, e il prezzo finale viene confermato al momento del contratto dopo aver esaminato il tuo volume e le tue condizioni di consegna.",
    billingKicker: "Billing / Condizioni di fatturazione",
    billingHeading: "Condizioni di fatturazione",
    billingBody:
      "I costi di spedizione si saldano insieme su base mensile. Totalizziamo le spedizioni del mese a fine mese, emettiamo una fattura all'inizio del mese successivo e il pagamento è dovuto entro la fine di quel mese. È accettato anche il pagamento con carta di credito.",
    rows: [
      { term: "Data di chiusura", desc: "Fine mese" },
      { term: "Emissione fattura", desc: "Inizio del mese successivo" },
      { term: "Scadenza pagamento", desc: "Fine del mese successivo" },
      { term: "Metodo di pagamento", desc: "Bonifico bancario / Carta di credito" },
      { term: "Nolo", desc: "Saldato mensilmente" },
      { term: "Unità di fatturazione", desc: "Fattura mensile unica" },
    ],
    sizeNote:
      "I colli che superano il limite di accettazione del corriere (fino a 160 cm di dimensioni totali; peso secondo le regole del corriere), le spedizioni verso isole remote o determinate zone e le consegne speciali come refrigerate o surgelate sono di norma escluse. Contattaci per le condizioni specifiche.",
  },
  faq: {
    eyebrow: "Domande frequenti",
    heading: { first: "Per i nuovi partner,", second: "le domande più comuni." },
    callouts: [
      { label: "Risarcimento", text: "Fino a ¥300,000 per collo secondo le condizioni del nostro corriere partner." },
      {
        label: "Scadenze",
        text: "I voucher sono emessi il giorno in cui arriva l'itinerario; le etichette di spedizione un mese prima del ritiro.",
      },
      {
        label: "Annullamento",
        text: "Gratuito se ci avvisi prima del completamento del ritiro. Non più possibile dopo, poiché la consegna è già in corso.",
      },
    ],
    items: [
      {
        q: "In quali formati posso inviare l'itinerario?",
        a: "Sono accettati Excel, PDF, immagini e screenshot. Va benissimo il formato a cui la tua agenzia è abituata.",
      },
      {
        q: "Se i voucher sono emessi subito, perché le etichette di spedizione solo un mese prima?",
        a: "Perché le specifiche di emissione del corriere consentono di creare un'etichetta di spedizione solo entro 30 giorni dalla data di ritiro. I voucher sono emessi da BondEx, quindi possono essere prodotti in giornata.",
      },
      {
        q: "Qual è il ciclo di fatturazione?",
        a: "Chiudiamo a fine mese, totalizziamo le spedizioni emesse quel mese e inviamo una fattura in PDF all'agenzia all'inizio del mese successivo. Il pagamento è dovuto entro l'ultimo giorno del mese successivo a quello di fatturazione. BondEx anticipa le spese di nolo al corriere.",
      },
      {
        q: "Che cosa copre il risarcimento?",
        a: "Segue integralmente le condizioni di trasporto del fornitore logistico che effettua il trasporto reale. Con il nostro attuale corriere partner, il limite è di ¥300,000 per collo. BondEx non aggiunge alcun risarcimento proprio.",
      },
      {
        q: "Quale assistenza offrite durante l'operatività?",
        a: "Un referente dedicato ti affianca dall'inizio alla fine: onboarding al lancio, modifiche e aggiornamenti di indirizzo durante l'operatività e prima risposta in caso di ritardi nel ritiro o reclami. Manteniamo al minimo il carico di lavoro aggiuntivo dalla tua parte.",
      },
      {
        q: "Quanto tempo passa dal contratto all'avvio?",
        a: "Una volta firmato il contratto di servizio (che indica chiaramente il nostro ruolo di intermediario), emettiamo l'account del tuo portale agenzia e puoi partire in giornata. Puoi effettuare un'emissione di prova dal tuo primo PDF di itinerario lo stesso giorno.",
      },
    ],
  },
  contact: {
    heading: "Avvia un pilota con una sola spedizione.",
    body: {
      first: "Ti invieremo il contratto, la matrice delle responsabilità, una fattura di esempio e un pacchetto per la revisione legale,",
      second: "insieme alle opzioni per fissare un incontro.",
    },
    cta: "Vai al modulo di contatto",
    replyNote: "Di norma rispondiamo entro un giorno lavorativo.",
  },
  footer: {
    operatorPrefix: "Gestito da ",
    operatorName: "JOJO Inc.",
    operatorAddress: " / 1-9-12 Noge, Setagaya-ku, Tokyo",
    tracking: "Tracciamento",
    terms: "Termini di servizio",
    privacy: "Privacy",
    commercial: "Legge sulle transazioni commerciali",
    disclaimer:
      "BondEx non è un vettore; è un servizio di intermediazione che riceve le informazioni dell'itinerario e organizza la spedizione con i fornitori logistici. Il trasporto effettivo, la responsabilità di trasporto e il risarcimento seguono le condizioni di trasporto dei fornitori logistici che utilizziamo.",
    copyrightSuffix: " / BondEx",
  },
}

export const messages: Record<Locale, LandingMessages> = { ja, en, es, fr, zh, it }
