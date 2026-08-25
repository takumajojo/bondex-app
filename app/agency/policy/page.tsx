"use client"

// ご利用ルール / Service rules — 「いつまで変更できるか」「いつ課金されるか」を
// ポータル内に常設する (谷口さん指示・必須)。内容はシステムの実挙動と一致させること。
// ※期限・料金など新ルールを足すときは必ず実装と同期させる。
import Link from "next/link"
import { ArrowLeft, CalendarClock, FileText, PencilLine, CreditCard, ShieldCheck, MessageCircle } from "lucide-react"
import { useAgencyLocale, AgencyLocaleToggle } from "@/lib/agency-i18n"
import { WHATSAPP_URL, LINE_URL, SUPPORT_EMAIL } from "@/lib/contact-links"

const M = {
  ja: {
    title: "ご利用ルール",
    back: "ポータルへ",
    lead: "変更・キャンセルの期限と料金の仕組みです。迷ったらいつでもご連絡ください。",
    s1t: "ご予約の受付",
    s1: [
      "発行依頼はいつでも登録できます（何ヶ月先の旅程でも OK）。",
      "発送日が 30 日以内の依頼は、送り状をその場で発行します。",
      "発送日が 1 ヶ月以上先の依頼は、発送 1 ヶ月前に BondEx が発行し、ご連絡します（バウチャーは登録時点で発行されます）。",
    ],
    s2t: "変更・キャンセル",
    s2: [
      "送り状の発行前（ステータス「依頼中」）は、ポータルの一覧から日程変更・個数変更・取り消しがいつでも無料でできます。",
      "発行後の変更・取り消しは、送り状の差し替えが必要なため BondEx にご連絡ください（お問い合わせボタン / WhatsApp / LINE）。",
      "集荷が完了したあとの取り消しはできません（料金が発生します）。",
      "団体予約の個数は、団体ダッシュボードの荷物リストで管理します。",
    ],
    s3t: "料金とご請求",
    s3: [
      "料金は 1 個 ¥5,000（税抜）の均一料金です。距離・サイズは問いません。",
      "金額は送り状の発行時に「個数 × ¥5,000」で確定します。",
      "カード払い: 集荷が完了したタイミングで決済されます（ご予約時点では課金されません）。決済後、請求書兼領収書（適格請求書）をメールでお送りします。",
      "請求書払い（国内のみ）: 月末締めで翌月に月次請求書をお送りします。ポータルの「月別ご利用状況」からもダウンロードできます。",
    ],
    s4t: "補償",
    s4: [
      "万一の紛失・破損は、提携配送業者の運送約款に基づき 1 個あたり最大 ¥300,000 まで補償されます。",
      "異常（遅延・調査中など）を検知した場合は、BondEx から自動でご連絡します。",
    ],
    s5t: "お急ぎの連絡先",
    s5wa: "WhatsApp（緊急時はこちらが最速）",
    s5line: "LINE",
    s5mail: "メール",
  },
  en: {
    title: "Service rules",
    back: "Back to portal",
    lead: "When you can change or cancel, and how billing works. Contact us anytime if unsure.",
    s1t: "Booking",
    s1: [
      "You can register an issuance request anytime — even months ahead.",
      "Requests shipping within 30 days are issued on the spot.",
      "Requests shipping more than a month ahead are issued by BondEx one month before the ship date, and we'll notify you (the voucher is issued immediately at registration).",
    ],
    s2t: "Changes & cancellation",
    s2: [
      "Before the label is issued (status “Requested”), you can change dates/pieces or cancel anytime, free, right from the portal list.",
      "After issuance, contact BondEx for any change or cancellation (Contact button / WhatsApp / LINE) — the label must be reissued.",
      "After pickup is completed, cancellation is no longer possible (the fee applies).",
      "For group bookings, manage pieces on the group dashboard's luggage list.",
    ],
    s3t: "Fees & billing",
    s3: [
      "Flat fee: ¥5,000 (excl. tax) per piece, regardless of distance or size.",
      "The amount is fixed at label issuance: pieces × ¥5,000.",
      "Card payment: charged when pickup is completed (never at booking). A combined invoice/receipt (Japanese qualified invoice) is emailed after the charge.",
      "Monthly invoice (domestic only): closed at month-end and invoiced the following month. Also downloadable from “Monthly usage” in the portal.",
    ],
    s4t: "Compensation",
    s4: [
      "Loss or damage is covered up to ¥300,000 per piece under the partner carrier's terms of carriage.",
      "If we detect an issue (delay, investigation, etc.), BondEx notifies you automatically.",
    ],
    s5t: "Urgent contact",
    s5wa: "WhatsApp (fastest in an emergency)",
    s5line: "LINE",
    s5mail: "Email",
  },
} as const

export default function AgencyPolicyPage() {
  const { locale, setLocale } = useAgencyLocale()
  const t = M[locale]
  const sections = [
    { icon: CalendarClock, title: t.s1t, items: t.s1 },
    { icon: PencilLine, title: t.s2t, items: t.s2 },
    { icon: CreditCard, title: t.s3t, items: t.s3 },
    { icon: ShieldCheck, title: t.s4t, items: t.s4 },
  ] as const

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-border bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-medium">
              BondEx Agency
            </p>
            <h1 className="text-lg font-semibold text-foreground mt-0.5 flex items-center gap-2">
              <FileText className="w-4 h-4" strokeWidth={1.8} />
              {t.title}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <AgencyLocaleToggle locale={locale} onChange={setLocale} />
            <Link href="/agency" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
              {t.back}
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-4">
        <p className="text-sm text-muted-foreground">{t.lead}</p>

        {sections.map((s) => (
          <section key={s.title} className="rounded-2xl border border-border bg-white p-5">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-foreground mb-3">
              <s.icon className="w-4 h-4 text-[#C8102E]" strokeWidth={1.9} />
              {s.title}
            </h2>
            <ul className="space-y-2">
              {s.items.map((line, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-foreground leading-relaxed">
                  <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-[#C8102E]/60 shrink-0" />
                  {line}
                </li>
              ))}
            </ul>
          </section>
        ))}

        {/* 緊急連絡先 */}
        <section className="rounded-2xl border border-border bg-white p-5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-foreground mb-3">
            <MessageCircle className="w-4 h-4 text-[#C8102E]" strokeWidth={1.9} />
            {t.s5t}
          </h2>
          <div className="flex flex-col sm:flex-row gap-2">
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center gap-2 rounded-xl bg-[#25D366] text-white px-4 py-3 text-sm font-semibold hover:opacity-90"
            >
              <MessageCircle className="w-4 h-4" strokeWidth={2} />
              {t.s5wa}
            </a>
            <a
              href={LINE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center gap-2 rounded-xl bg-[#06C755] text-white px-4 py-3 text-sm font-semibold hover:opacity-90"
            >
              <MessageCircle className="w-4 h-4" strokeWidth={2} />
              {t.s5line}
            </a>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="flex-1 flex items-center gap-2 rounded-xl border border-border bg-white px-4 py-3 text-sm font-medium text-foreground hover:bg-slate-50"
            >
              {t.s5mail}: {SUPPORT_EMAIL}
            </a>
          </div>
        </section>
      </div>
    </main>
  )
}
