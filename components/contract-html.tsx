// 契約書の画面表示用HTML。lib/contract-content.ts を唯一の情報源として PDF と同じ本文を描画する。
// PDF埋め込み(iframe)は Safari/iOS で表示できないため、内容確認はこのHTMLで行う。
import {
  buildArticles,
  contractPreamble,
  BONDEX_PARTY,
  CONTRACT_PRICE_YEN,
} from "@/lib/contract-content"

export function ContractHtml({
  agencyName,
  price = CONTRACT_PRICE_YEN,
  bankInfo = BONDEX_PARTY.bankInfo,
  companyName = BONDEX_PARTY.companyName,
  brand = "BondEx",
  locale = "ja",
}: {
  agencyName: string
  price?: number
  bankInfo?: string
  companyName?: string
  brand?: string
  locale?: "ja" | "en"
}) {
  const en = locale === "en"
  const articles = buildArticles(price, bankInfo, locale)
  const agencyLabel = agencyName?.trim() || "＿＿＿＿＿＿＿＿"

  return (
    <div className="text-[13px] leading-7 text-foreground">
      <div className="text-center mb-4">
        <p className="text-lg font-semibold tracking-[0.25em]">
          {en ? "AGENCY SERVICE AGREEMENT" : "業務委託契約書"}
        </p>
        {!en && (
          <p className="text-[10px] tracking-widest text-muted-foreground mt-1">AGENCY SERVICE AGREEMENT</p>
        )}
      </div>

      <p className="mb-4">{contractPreamble(companyName, agencyLabel, brand, locale)}</p>

      <div className="space-y-3">
        {articles.map((a) => (
          <section key={a.num}>
            <h3 className="font-semibold text-foreground">
              {en ? `Article ${a.num}. ${a.title}` : `第${a.num}条（${a.title}）`}
            </h3>
            <div className="mt-0.5 space-y-0.5">
              {a.blocks.map((b, i) =>
                b.kind === "item" ? (
                  <p key={i} className="pl-6 -indent-6">
                    <span className="inline-block min-w-[1.7em]">{b.num}</span>
                    {b.text}
                  </p>
                ) : (
                  <p key={i}>{b.text}</p>
                ),
              )}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-6 pt-3 border-t border-border text-[12px] text-muted-foreground space-y-0.5">
        <p>
          {en ? "Party A: " : "甲："}
          {companyName}（{BONDEX_PARTY.representativeTitle} {BONDEX_PARTY.representativeName}）／{" "}
          {BONDEX_PARTY.address}
        </p>
        <p>{en ? "Party B: " : "乙："}{agencyLabel}</p>
        <p className="pt-1">
          {en
            ? "This Agreement is concluded electronically by agreeing and signing in the field below."
            : "本契約は、下の欄で同意・署名することにより電子的に締結されます。"}
        </p>
      </div>
    </div>
  )
}
