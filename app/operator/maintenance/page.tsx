"use client"

import { useState } from "react"

// 運用メンテナンス: 一度きりのバックフィル操作をまとめる operator 専用ページ。
// 認証は operator セッション Cookie(bondex_op_auth)で通る(middleware で /operator/* を保護)。

type ResyncItem = { id: string; ok: boolean; detail?: string; error?: string }
type ResyncResult = {
  ok: boolean
  summary?: { ok: number; failed: number; vouchers: number; contracts: number }
  vouchers?: ResyncItem[]
  contracts?: ResyncItem[]
  error?: string
}

export default function OperatorMaintenancePage() {
  const [running, setRunning] = useState<string | null>(null)
  const [result, setResult] = useState<ResyncResult | null>(null)

  async function run(only?: "vouchers" | "contracts") {
    const label =
      only === "vouchers" ? "バウチャー" : only === "contracts" ? "契約書" : "すべての書類"
    if (
      !window.confirm(
        `Drive 上の${label}を、最新版(印刷対応・PDF1.4)で再生成して同名で上書きします。\n` +
          `中身は変わりません(署名・条項・金額はそのまま)。実行しますか？`,
      )
    )
      return
    setRunning(only ?? "all")
    setResult(null)
    try {
      const res = await fetch("/api/operator/drive-resync-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(only ? { only } : {}),
      })
      const json = (await res.json()) as ResyncResult
      if (!res.ok) setResult({ ok: false, error: json.error || `HTTP ${res.status}` })
      else setResult(json)
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : "network error" })
    } finally {
      setRunning(null)
    }
  }

  const btn =
    "px-4 py-2 rounded-md text-sm font-medium border transition disabled:opacity-50 disabled:cursor-not-allowed"

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "32px 20px" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>運用メンテナンス</h1>
      <p style={{ fontSize: 13, color: "#555", lineHeight: 1.7, marginBottom: 20 }}>
        共有ドライブに保存済みの書類を、最新版（印刷しても画像が消えない PDF1.4）で再生成し、
        <b>同名で上書き</b>します。冪等（何度実行しても重複しません）。中身は変わりません
        （署名・条項・金額・元契約番号はそのまま）。
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
        <button
          className={btn}
          style={{ background: "#111", color: "#fff", borderColor: "#111" }}
          disabled={!!running}
          onClick={() => run()}
        >
          {running === "all" ? "実行中…" : "すべて再格納（バウチャー＋契約書）"}
        </button>
        <button
          className={btn}
          style={{ background: "#fff", color: "#111", borderColor: "#ccc" }}
          disabled={!!running}
          onClick={() => run("vouchers")}
        >
          {running === "vouchers" ? "実行中…" : "バウチャーのみ"}
        </button>
        <button
          className={btn}
          style={{ background: "#fff", color: "#111", borderColor: "#ccc" }}
          disabled={!!running}
          onClick={() => run("contracts")}
        >
          {running === "contracts" ? "実行中…" : "契約書のみ"}
        </button>
      </div>

      {running && (
        <p style={{ fontSize: 13, color: "#555" }}>
          再生成してアップロード中です。件数によっては数十秒かかります。完了までこの画面を閉じないでください。
        </p>
      )}

      {result && (
        <div style={{ marginTop: 8 }}>
          {result.error ? (
            <p style={{ color: "#b00020", fontSize: 14 }}>失敗: {result.error}</p>
          ) : (
            <>
              <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
                {result.ok ? "✅ 完了" : "⚠️ 一部失敗"} — 成功 {result.summary?.ok ?? 0} 件 / 失敗{" "}
                {result.summary?.failed ?? 0} 件
              </p>
              {[
                { title: "バウチャー", items: result.vouchers ?? [] },
                { title: "契約書", items: result.contracts ?? [] },
              ].map((sec) =>
                sec.items.length ? (
                  <div key={sec.title} style={{ marginBottom: 16 }}>
                    <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{sec.title}</h2>
                    <ul style={{ fontSize: 12, lineHeight: 1.8, paddingLeft: 0, listStyle: "none" }}>
                      {sec.items.map((it) => (
                        <li key={it.id}>
                          {it.ok ? "✅" : "❌"} <code>{it.id}</code>
                          {it.detail ? ` — ${it.detail}` : ""}
                          {it.error ? ` — ${it.error}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )}
            </>
          )}
        </div>
      )}
    </main>
  )
}
