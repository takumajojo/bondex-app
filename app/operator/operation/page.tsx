// 運用ガイド｜佐川急便（2026-10 谷口さん）。
//
// 目的: 私(谷口)以外のオペレーション/カスタマーサクセス担当でも、配送当日の変更・トラブル時に
//       「誰に・何を・いつまでに・どう連絡するか」をこのページを見るだけで判断できる状態にする。
// 方針: 既存operatorページと同じ素のTailwind+セマンティックトークンで構成（新規ライブラリ不使用）。
//       DB/API/配送ロジックは一切変更しない（本ページは情報の掲載のみ）。
//
// ★更新のしかた: 連絡先・締め切り等は下記の定数(CONTACTS / DEADLINES / SAMEDAY)を直すだけ。
//   未確定の連絡先は pending:true のままにして、仮のメール/電話番号は絶対に入れない。

import Link from "next/link"
import {
  ArrowLeft, Phone, Mail, Clock, CheckCircle2, AlertTriangle, Truck,
  Building2, Settings, Ban, CircleDollarSign, Activity, ArrowRight,
} from "lucide-react"

export const metadata = {
  title: "運用ガイド｜佐川急便 | BondEx Operator",
}

const BRAND = "#C8102E"

// ── 連絡先（確定/未確定を明確に分ける。未確定は pending:true＝仮データを入れない） ──
const CONTACTS = {
  setagaya: {
    title: "佐川急便 世田谷営業所",
    role: "荷物・配送オペレーション関連の窓口",
    // 阿野様・課長・カスタマーサービスを含む共有MLを佐川側で準備中。確定まで Pending 表示。
    mailingList: { label: "共有メーリングリスト", status: "佐川側確認中", pending: true },
    contact: { label: "担当者連絡先", status: "共有待ち", pending: true },
    members: ["阿野様", "課長", "カスタマーサービス"],
  },
  sgsystems: {
    title: "SGシステムズ 池田様",
    role: "システム関連（佐川側システム）の窓口",
    contact: { label: "連絡先", status: "共有待ち", pending: true },
  },
}

// ── 当日変更の締め切り（内容・状況により可否は変わる＝「必ず変更できる」とは書かない） ──
const DEADLINES: { label: string; cutoff: string; note?: string }[] = [
  { label: "住所変更", cutoff: "原則、集荷前まで" },
  { label: "集荷時間変更", cutoff: "集荷後でも再調整可能" },
  { label: "緊急変更依頼", cutoff: "18:30 まで", note: "以降は通常対応時間外" },
  { label: "佐川カスタマーサービス", cutoff: "19:00 まで対応" },
]

// ── 当日配送オプション（現時点の可否。チャーター料金は参考価格＝固定ではない） ──
const SAMEDAY: { name: string; status: "available" | "unavailable"; detail: string; note?: string }[] = [
  {
    name: "チャーター便",
    status: "available",
    detail: "現時点で実現可能な当日配送手段。",
    note: "参考価格（今回確認条件）: 1〜100個 105,000円＋税 ／ 案件ごとに佐川へ確認（全国・全区間・全日程の固定料金ではありません）",
  },
  {
    name: "QRコードによる佐川カウンター集荷",
    status: "unavailable",
    detail: "現時点：利用不可",
    note: "理由: 佐川急便の既存サービスと競合するため",
  },
  {
    name: "新幹線輸送",
    status: "unavailable",
    detail: "現時点：利用不可",
    note: "理由: 荷物カートのキャパシティが7〜8個程度／佐川急便側で京都への輸送許可がない",
  },
]

function PendingBadge({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-300 px-2 py-0.5 text-[11px] font-semibold text-amber-800 whitespace-nowrap">
      <Clock className="w-3 h-3" strokeWidth={2} /> {text}
    </span>
  )
}

function SectionCard({
  icon, title, children,
}: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-white overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3">
        <span className="text-foreground">{icon}</span>
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </section>
  )
}

export default function OperationGuidePage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-border bg-white">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-3">
          <Link href="/operator/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" strokeWidth={1.6} /> ダッシュボード
          </Link>
          <h1 className="text-base font-bold text-foreground">運用ガイド｜佐川急便</h1>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-5 space-y-5">
        <p className="text-xs text-muted-foreground">
          配送当日の変更・トラブル時に「誰に・何を・いつまでに・どう連絡するか」をこのページで判断できます。
          未確定の連絡先は<span className="font-semibold text-amber-800">Pending</span>表示です（仮の連絡先は掲載しません）。
        </p>

        {/* ── 一目で分かる4点（誰に／何時まで／手段／完了条件） ── */}
        <section className="rounded-2xl border border-border bg-white p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl border border-border bg-slate-50 p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground"><Building2 className="w-3.5 h-3.5" /> 誰に</div>
              <div className="mt-1 text-sm font-semibold text-foreground">佐川急便 世田谷営業所（窓口）</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">各営業所・ドライバーへ直接連絡しない</div>
            </div>
            <div className="rounded-xl border border-border bg-slate-50 p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground"><Clock className="w-3.5 h-3.5" /> 何時まで</div>
              <div className="mt-1 text-sm font-semibold text-foreground">緊急変更 18:30 ／ CS 19:00</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">内容・状況により可否は変わる</div>
            </div>
            <div className="rounded-xl border border-border bg-slate-50 p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground"><Mail className="w-3.5 h-3.5" /> 手段</div>
              <div className="mt-1 text-sm font-semibold text-foreground">通常：メール</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">緊急：メール送信後に<span className="font-semibold text-foreground">電話</span>でフォロー</div>
            </div>
            <div className="rounded-xl border border-border bg-slate-50 p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground"><CheckCircle2 className="w-3.5 h-3.5" /> 完了条件</div>
              <div className="mt-1 text-sm font-semibold text-foreground">佐川からの反映確認で完了</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">メール送信“だけ”では完了にしない</div>
            </div>
          </div>
        </section>

        {/* ── 緊急対応（特に目立たせる） ── */}
        <section className="rounded-2xl border-2 border-[#C8102E]/30 bg-[#C8102E]/5 p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: BRAND }} strokeWidth={2} />
            <div className="space-y-1.5">
              <div className="text-sm font-bold" style={{ color: BRAND }}>緊急時は「メールだけ」で終わらせない</div>
              <p className="text-[13px] leading-relaxed text-foreground">
                緊急の変更依頼は、<span className="font-bold">メールを送信したうえで必ず電話でもフォロー</span>してください。
                そして<span className="font-bold">佐川側から変更反映の確認を受けて初めて「対応完了」</span>です（送信時点では完了扱いにしない）。
              </p>
              <p className="text-[13px] leading-relaxed text-foreground">
                <span className="font-bold">18:30 以降の緊急変更は通常対応可能時間外</span>として扱い、
                <span className="font-bold">個別判断・エスカレーションが必要</span>です。
              </p>
            </div>
          </div>
        </section>

        {/* ══ 1. 当日イレギュラー対応 ══ */}
        <SectionCard icon={<AlertTriangle className="w-4 h-4" />} title="当日イレギュラー対応">
          {/* 基本フロー */}
          <div>
            <div className="text-xs font-bold text-muted-foreground mb-2">基本フロー</div>
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              {["BondEx", "佐川急便 世田谷営業所", "担当営業所／集荷ドライバー", "変更反映", "佐川→BondEx 完了返信"].map((step, i, arr) => (
                <span key={step} className="flex items-center gap-2">
                  <span className={`rounded-lg border px-2.5 py-1 font-semibold ${i === 1 ? "border-[#C8102E]/40 bg-[#C8102E]/5 text-foreground" : "border-border bg-slate-50 text-foreground"}`}>{step}</span>
                  {i < arr.length - 1 && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" strokeWidth={2} />}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              原則、当日の配送変更・荷物に関する問い合わせは<span className="font-semibold text-foreground">「佐川急便 世田谷営業所」を窓口</span>とします。
              各地域の営業所やドライバーへ<span className="font-semibold text-foreground">直接連絡せず</span>、世田谷営業所を経由します。
              世田谷営業所側では社内システム「佐川メール」で担当営業所・ドライバーへ連携します。
            </p>
          </div>

          {/* 連絡方法 */}
          <div className="rounded-xl border border-border bg-slate-50 p-3 space-y-2">
            <div className="text-xs font-bold text-muted-foreground">連絡方法</div>
            <ul className="space-y-1.5 text-[13px] text-foreground">
              <li className="flex items-start gap-2"><Mail className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" /><span><span className="font-semibold">通常：</span>メールで変更内容を送信する。</span></li>
              <li className="flex items-start gap-2"><Phone className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" /><span><span className="font-semibold">緊急：</span>メール送信後、電話でフォローアップする。</span></li>
              <li className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" /><span><span className="font-semibold">変更反映後：</span>佐川側からメールで簡単な返信をもらい、BondEx側で「対応完了」とする。</span></li>
            </ul>
            <div className="flex items-start gap-2 rounded-lg bg-white border border-amber-300 px-3 py-2 text-[12px] text-amber-900">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-700" />
              <span><span className="font-bold">重要：</span>「メールを送信した時点」では完了扱いにしない。佐川側から<span className="font-bold">変更反映の確認を受けて初めて完了</span>とする。</span>
            </div>
          </div>

          {/* 連絡先 */}
          <div>
            <div className="text-xs font-bold text-muted-foreground mb-2">連絡先</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* 世田谷営業所 */}
              <div className="rounded-xl border border-border bg-white p-3">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><Building2 className="w-4 h-4 text-muted-foreground" />{CONTACTS.setagaya.title}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{CONTACTS.setagaya.role}</div>
                <div className="mt-2 space-y-1.5 text-[12px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">{CONTACTS.setagaya.mailingList.label}</span>
                    <PendingBadge text={CONTACTS.setagaya.mailingList.status} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">{CONTACTS.setagaya.contact.label}</span>
                    <PendingBadge text={CONTACTS.setagaya.contact.status} />
                  </div>
                  <div className="text-[11px] text-muted-foreground pt-1 border-t border-border">
                    共有ML（佐川側で準備中）に含まれる予定：{CONTACTS.setagaya.members.join("・")}
                  </div>
                </div>
              </div>
              {/* SGシステムズ */}
              <div className="rounded-xl border border-border bg-white p-3">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><Settings className="w-4 h-4 text-muted-foreground" />{CONTACTS.sgsystems.title}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{CONTACTS.sgsystems.role}</div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[12px]">
                  <span className="text-muted-foreground">{CONTACTS.sgsystems.contact.label}</span>
                  <PendingBadge text={CONTACTS.sgsystems.contact.status} />
                </div>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              ※ 正式な共有メールアドレス・担当者連絡先が確定するまで、仮の連絡先は掲載していません（確定後にこのページを更新します）。
            </p>
          </div>

          {/* 当日変更の締め切り */}
          <div>
            <div className="text-xs font-bold text-muted-foreground mb-2">当日変更の締め切り</div>
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-[13px]">
                <tbody>
                  {DEADLINES.map((d, i) => (
                    <tr key={d.label} className={i % 2 ? "bg-slate-50" : "bg-white"}>
                      <td className="px-3 py-2.5 font-semibold text-foreground align-top w-[46%] border-b border-border">{d.label}</td>
                      <td className="px-3 py-2.5 text-foreground border-b border-border">
                        <span className="inline-flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-muted-foreground" />{d.cutoff}</span>
                        {d.note && <span className="ml-2 text-[11px] text-muted-foreground">（{d.note}）</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              ※ 変更内容・荷物の状況によって対応可否が変わります。「必ず変更できる」ものではありません。
            </p>
          </div>
        </SectionCard>

        {/* ══ 2. 当日配送（Same-day Delivery） ══ */}
        <SectionCard icon={<Truck className="w-4 h-4" />} title="当日配送（Same-day Delivery）">
          <div className="grid grid-cols-1 gap-3">
            {SAMEDAY.map((o) => (
              <div key={o.name} className={`rounded-xl border p-3 ${o.status === "available" ? "border-emerald-300 bg-emerald-50/40" : "border-border bg-slate-50"}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    {o.status === "available" ? <CircleDollarSign className="w-4 h-4 text-emerald-600" /> : <Ban className="w-4 h-4 text-muted-foreground" />}
                    {o.name}
                  </div>
                  {o.status === "available" ? (
                    <span className="rounded-full bg-emerald-100 border border-emerald-300 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">対応可</span>
                  ) : (
                    <span className="rounded-full bg-slate-200 border border-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-600">利用不可</span>
                  )}
                </div>
                <div className="mt-1 text-[13px] text-foreground">{o.detail}</div>
                {o.note && <div className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{o.note}</div>}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            ※ チャーター料金は今回確認した条件に基づく<span className="font-semibold">参考価格</span>です。全国一律ではないため、案件ごとに佐川へ確認してください。
          </p>
        </SectionCard>

        {/* ══ 3. システム障害時のFallback ══ */}
        <SectionCard icon={<Activity className="w-4 h-4" />} title="システム障害時のFallback（追跡）">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-white p-3">
              <div className="text-xs font-bold text-muted-foreground">通常時</div>
              <div className="mt-1 text-[13px] text-foreground font-semibold">Ship&amp;co（追跡API）による自動ステータス取得</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">平常時の追跡はシステム（API）が担います。</div>
            </div>
            <div className="rounded-xl border border-amber-300 bg-amber-50/40 p-3">
              <div className="text-xs font-bold text-amber-800">障害時（Fallback）</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] font-semibold text-foreground">
                <span className="rounded-lg border border-border bg-white px-2 py-0.5">世田谷営業所へ確認</span>
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="rounded-lg border border-border bg-white px-2 py-0.5">手動でステータス取得</span>
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="rounded-lg border border-border bg-white px-2 py-0.5">BondEx へ反映</span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">佐川側のシステム障害等で追跡が利用できない場合の運用です。</div>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            ※ 手動確認は<span className="font-semibold">障害時のFallback</span>です。平常時の追跡はシステム（Ship&amp;co 追跡API）が担います。
          </p>
        </SectionCard>

        <div className="pt-1 pb-6 text-[11px] text-muted-foreground">
          BondEx Operator ／ 運用ガイド（佐川急便）。確定事項とPending事項を分けて記載しています。内容の更新が必要な場合は運用担当までご連絡ください。
        </div>
      </div>
    </main>
  )
}
