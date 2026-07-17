import React from "react"

export const dynamic = 'force-dynamic'

export const metadata = {
  title: '特定商取引法に基づく表記 | BondEx',
  robots: { index: false },
}

const rows: Array<{ k: string; v: React.ReactNode }> = [
  { k: '販売事業者', v: '株式会社JOJO' },
  { k: '運営責任者', v: '谷口 琢真' },
  { k: '所在地', v: '〒158-0092 東京都世田谷区野毛1-9-12' },
  {
    k: '電話番号',
    v: 'お問い合わせはメール（support@bondex.express）にて承ります。電話番号は、お客様からのご請求があれば遅滞なく開示いたします。',
  },
  { k: 'メールアドレス', v: 'support@bondex.express' },
  {
    k: '販売価格 / 役務の対価',
    v: '荷物1個あたりの定額制です。金額は代理店さまとの契約・お見積りに基づき、発行前にご提示します（税込表示）。',
  },
  {
    k: '対価以外の必要料金',
    v: '離島・一部地域・大型サイズ等で配送業者の追加料金が生じる場合は、事前にご案内します。',
  },
  {
    k: 'お支払い方法',
    v: (
      <>
        海外・法人のお客様: クレジットカード決済（Stripe）を1件ごとに承ります。
        <br />
        国内のお客様: 月次のご請求書払いにも対応します。
      </>
    ),
  },
  {
    k: 'お支払い時期',
    v: (
      <>
        クレジットカード: 配送業者による集荷が完了した時点で決済を確定します。
        <br />
        月次請求書払い: 当月ご利用分を月末で締め、翌月にご請求します。
      </>
    ),
  },
  {
    k: '役務の提供時期',
    v: 'ご指定の配送日に合わせ、佐川急便・ヤマト運輸等の宅配便にて配送を手配します。天候・交通事情等により前後する場合があります。',
  },
  {
    k: 'キャンセル',
    v: (
      <>
        集荷完了前のキャンセルは無償で承ります（クレジットカード決済は集荷完了時に確定するため、集荷前のキャンセルは課金されません）。
        <br />
        集荷完了後は配送手続きが開始されるため、キャンセルはできません。
      </>
    ),
  },
  {
    k: '返品・交換',
    v: '配送手配（役務）の提供のため、返品・交換の対象外です。',
  },
]

export default function CommercialTransactionsPage() {
  return (
    <div className="min-h-screen bg-background max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold text-foreground mb-2">
        特定商取引法に基づく表記
      </h1>
      <p className="text-xs text-muted-foreground mb-8">
        Notation Based on the Specified Commercial Transactions Act
      </p>

      <div className="border-t border-border text-sm">
        {rows.map((r) => (
          <div key={r.k} className="grid grid-cols-[130px_1fr] border-b border-border">
            <div className="py-3 pr-4 font-semibold text-foreground">{r.k}</div>
            <div className="py-3 pl-4 text-foreground/80 leading-relaxed">{r.v}</div>
          </div>
        ))}
      </div>

      <p className="mt-8 text-xs text-muted-foreground leading-relaxed">
        BondEx（ボンデックス）は、株式会社JOJO が提供する、訪日旅行代理店・ランドオペレーターさま向けの荷物配送手配（取次）サービスです。
        配送そのものは佐川急便・ヤマト運輸等の宅配事業者が行います。
      </p>

      <div className="mt-12 pt-6 border-t border-border">
        <a href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          &larr; トップへ戻る
        </a>
      </div>
    </div>
  )
}
