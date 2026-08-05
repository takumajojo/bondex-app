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

export type Locale = "ja" | "en"

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

export const messages: Record<Locale, LandingMessages> = { ja, en }
