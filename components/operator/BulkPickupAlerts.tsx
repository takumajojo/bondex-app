"use client"

import { useCallback, useEffect, useState } from "react"

/**
 * P1-B 大口集荷 事前連絡アラート (Operator ダッシュボード・既存 TodayTodo とは独立したセクション)。
 * feature flag OFF (enabled:false) の間は何も描画しない。通常の集荷依頼 TODO とは明確に分離している。
 * 代理店には表示されない (operator 専用 API)。
 */

type Group = {
  id: string
  pickup_date: string
  hotel_label: string | null
  hotel_key: string
  confident: boolean
  total_pieces: number
  leg_count: number
  agency_count: number
  booking_count: number
  is_bulk: boolean
  is_duplicate: boolean
  status: string
  urgency: "overdue" | "today" | "tomorrow" | "upcoming"
  notified_at: string | null
}

const URGENCY_RANK: Record<string, number> = { overdue: 0, today: 1, tomorrow: 2, upcoming: 3 }
const STATUS_LABEL: Record<string, string> = {
  pending: "未連絡",
  needs_reconfirm: "要再確認",
  notified: "連絡済み",
  stale: "未対応(期限超)",
}
const URGENCY_BADGE: Record<string, { label: string; cls: string }> = {
  overdue: { label: "期限超", cls: "bg-[#7F1D1D] text-white" },
  today: { label: "当日・緊急", cls: "bg-[#C8102E] text-white" },
  tomorrow: { label: "前日・優先", cls: "bg-[#B45309] text-white" },
  upcoming: { label: "通常", cls: "bg-[#E5E7EB] text-[#334155]" },
}

export default function BulkPickupAlerts() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ group: Record<string, unknown>; members: Record<string, unknown>[]; events: Record<string, unknown>[] } | null>(null)
  const [form, setForm] = useState<{ id: string; method: string; reply: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/operator/bulk-pickups")
      const data = await res.json()
      setEnabled(Boolean(data.enabled))
      setGroups(Array.isArray(data.groups) ? data.groups : [])
    } catch {
      setEnabled(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const action = useCallback(
    async (act: "undo" | "recompute", id?: string) => {
      setBusy(id ?? act)
      try {
        await fetch("/api/operator/bulk-pickups", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: act, id }),
        })
        await load()
      } finally {
        setBusy(null)
      }
    },
    [load],
  )

  // 「佐川へ連絡済み」: 連絡方法・佐川の回答を記録して確定 (§4 の対応履歴)。
  const submitNotify = useCallback(async () => {
    if (!form) return
    setBusy(form.id)
    try {
      await fetch("/api/operator/bulk-pickups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "notify", id: form.id, method: form.method, reply: form.reply }),
      })
      setForm(null)
      await load()
    } finally {
      setBusy(null)
    }
  }, [form, load])

  const openDetail = useCallback(async (id: string) => {
    if (openId === id) { setOpenId(null); setDetail(null); return }
    setOpenId(id)
    setDetail(null)
    const res = await fetch(`/api/operator/bulk-pickups?id=${encodeURIComponent(id)}`)
    const data = await res.json()
    setDetail({ group: data.group ?? {}, members: data.members ?? [], events: data.events ?? [] })
  }, [openId])

  // OFF または 0件 のときは何も出さない (既存画面に影響しない)。
  if (enabled === null || enabled === false) return null
  const sorted = [...groups].sort((a, b) =>
    (URGENCY_RANK[a.urgency] ?? 9) - (URGENCY_RANK[b.urgency] ?? 9) ||
    (a.pickup_date < b.pickup_date ? -1 : 1),
  )
  if (sorted.length === 0) return null

  return (
    <section className="rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] p-4 mt-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-[14px] font-bold text-[#7F1D1D]">🚚 佐川｜集荷の注意（大口・重複）</h2>
        <button
          onClick={() => action("recompute")}
          disabled={busy === "recompute"}
          className="text-[11px] px-2 py-1 rounded border border-[#CBD5E1] bg-white text-[#334155] disabled:opacity-50"
        >
          {busy === "recompute" ? "更新中…" : "再集計"}
        </button>
      </div>
      <p className="text-[11px] text-[#64748B] mt-1">
        同一ホテル・同一集荷日の集荷単位。<strong>大口</strong>（合計20個以上＝佐川・世田谷営業所へ事前連絡）と
        <strong>重複</strong>（複数予約が同じ集荷に重なる）を検知します。BondEx 内部の運用連絡です（代理店・旅行者には通知されません）。
      </p>

      <ul className="mt-3 space-y-2">
        {sorted.map((g) => {
          const badge = URGENCY_BADGE[g.urgency] ?? URGENCY_BADGE.upcoming
          return (
            <li key={g.id} className="rounded-lg border border-[#E5E7EB] bg-white p-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.label}</span>
                    {g.is_bulk && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#7F1D1D] text-white">大口 20個以上</span>
                    )}
                    {g.is_duplicate && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#1E3A8A] text-white">重複 予約{g.booking_count}件</span>
                    )}
                    <span className="text-[13px] font-bold text-[#0F172A]">{g.hotel_label || g.hotel_key}</span>
                    {!g.confident && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#92400E]">ホテル同一性 要確認</span>
                    )}
                  </div>
                  <div className="text-[12px] text-[#334155] mt-1">
                    集荷日 {g.pickup_date}｜合計 <strong>{g.total_pieces}個</strong>（予約 {g.booking_count}件 / 区間 {g.leg_count} / 代理店 {g.agency_count}社）
                  </div>
                  {g.is_duplicate && (
                    <div className="text-[11px] text-[#1E3A8A] mt-0.5">
                      ⚠ 同一ホテル・同日に複数予約。集荷の重複にご注意ください（1回の集荷にまとめられないかご確認を）。
                    </div>
                  )}
                  {g.is_bulk ? (
                    <div className="text-[11px] text-[#64748B] mt-0.5">
                      佐川連絡：{STATUS_LABEL[g.status] ?? g.status}
                      {g.notified_at ? `（${new Date(g.notified_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}）` : ""}
                    </div>
                  ) : (
                    <div className="text-[11px] text-[#94A3B8] mt-0.5">大口（20個以上）ではないため、佐川への大口事前連絡は不要です。</div>
                  )}
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  {g.is_bulk && (g.status !== "notified" ? (
                    <button
                      onClick={() => setForm(form?.id === g.id ? null : { id: g.id, method: "電話", reply: "" })}
                      disabled={busy === g.id}
                      className="text-[11px] px-2 py-1 rounded bg-[#166534] text-white disabled:opacity-50"
                    >
                      佐川へ連絡済みにする
                    </button>
                  ) : (
                    <button
                      onClick={() => action("undo", g.id)}
                      disabled={busy === g.id}
                      className="text-[11px] px-2 py-1 rounded border border-[#CBD5E1] bg-white text-[#334155] disabled:opacity-50"
                    >
                      連絡済みを取消
                    </button>
                  ))}
                  <button
                    onClick={() => openDetail(g.id)}
                    className="text-[11px] px-2 py-1 rounded border border-[#CBD5E1] bg-white text-[#334155]"
                  >
                    {openId === g.id ? "閉じる" : "詳細・履歴"}
                  </button>
                </div>
              </div>

              {form?.id === g.id && (
                <div className="mt-2 border-t border-[#F1F5F9] pt-2">
                  <div className="text-[11px] font-bold text-[#334155]">佐川への連絡内容を記録</div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <label className="text-[11px] text-[#64748B]">連絡方法</label>
                    <select
                      value={form.method}
                      onChange={(e) => setForm({ ...form, method: e.target.value })}
                      className="text-[11px] border border-[#CBD5E1] rounded px-1 py-0.5"
                    >
                      {["電話", "メール", "FAX", "その他"].map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <textarea
                    value={form.reply}
                    onChange={(e) => setForm({ ...form, reply: e.target.value })}
                    placeholder="佐川側の回答・確認内容（集荷可否・車両手配など）"
                    rows={2}
                    className="w-full mt-1 text-[11px] border border-[#CBD5E1] rounded px-2 py-1"
                  />
                  <div className="flex gap-2 mt-1">
                    <button onClick={submitNotify} disabled={busy === g.id}
                      className="text-[11px] px-2 py-1 rounded bg-[#166534] text-white disabled:opacity-50">
                      連絡済みとして確定
                    </button>
                    <button onClick={() => setForm(null)} className="text-[11px] px-2 py-1 rounded border border-[#CBD5E1] bg-white text-[#334155]">
                      取消
                    </button>
                  </div>
                </div>
              )}

              {openId === g.id && detail && (
                <div className="mt-2 border-t border-[#F1F5F9] pt-2 text-[11px] text-[#475569]">
                  {Boolean(detail.group.notified_method || detail.group.sagawa_reply) && (
                    <div className="mb-1 rounded bg-[#F0FDF4] p-2">
                      <div className="font-bold text-[#166534]">佐川への連絡記録</div>
                      {detail.group.notified_method ? <div>連絡方法：{String(detail.group.notified_method)}</div> : null}
                      {detail.group.sagawa_reply ? <div>佐川の回答：{String(detail.group.sagawa_reply)}</div> : null}
                    </div>
                  )}
                  <div className="font-bold text-[#334155]">対象予約（{detail.members.filter((m) => !m.removed_at).length}件）</div>
                  <ul className="mt-1 space-y-0.5">
                    {detail.members.map((m, i) => (
                      <li key={i} className={m.removed_at ? "line-through text-[#94A3B8]" : ""}>
                        {String(m.booking_id)}-L{Number(m.leg_index) + 1}｜{Number(m.pieces)}個
                        {m.pickup_time ? `｜集荷 ${String(m.pickup_time)}` : ""}
                        {m.removed_at ? "（離脱）" : ""}
                      </li>
                    ))}
                  </ul>
                  <div className="font-bold text-[#334155] mt-2">変更・連絡履歴</div>
                  <ul className="mt-1 space-y-0.5">
                    {detail.events.map((e, i) => (
                      <li key={i}>
                        {new Date(String(e.created_at)).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}｜{String(e.kind)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
