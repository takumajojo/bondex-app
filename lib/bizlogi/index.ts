// 佐川 Biz-Logi API (SGシステム) クライアント。仕様書 Ver.2.82 準拠。
//
// 段階1 (2026-10-09): 電文の構築・送信前検証・レスポンス解析・結果コード辞書のみ。
// 運営画面や lib/dispatch のプロバイダ切替にはまだ繋いでいない (本番の挙動は不変)。
// 動作確認: npx tsx scripts/bizlogi/selftest.ts (実接続なし・課金なし)

export * from "./client"
export * from "./codes"
export * from "./pickup"
export * from "./shipping"
export { normalizeManageNumber, normalizeTel, normalizeYubin, splitLines, toHankaku, toYmd } from "./text"
