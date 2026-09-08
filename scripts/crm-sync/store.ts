/**
 * ローカル側の永続化 — 環境変数の読み込み / 監査ログ / 同期台帳。
 *
 * 台帳 (ledger) は「この syncKey で何を作ったか」を記録する。
 * HubSpot の検索インデックスは反映が数秒遅れるため、検索だけに頼ると
 * 連続実行で重複を作りうる。ローカル台帳を先に見ることでそれを塞ぐ。
 */

import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import type { HsLogEntry } from "../../lib/hubspot"

export const LOG_DIR = path.resolve(process.cwd(), "logs/bondex-sync")
const LEDGER_PATH = path.join(LOG_DIR, "ledger.json")

/**
 * .env.local -> .env の順に読み、既存の process.env を上書きしない。
 * Next.js のランタイム外 (素の node) で動かすため自前で最小実装する。
 */
export function loadEnvFiles(rootDir: string = process.cwd()): void {
  for (const file of [".env.local", ".env"]) {
    const full = path.join(rootDir, file)
    if (!fs.existsSync(full)) continue
    const text = fs.readFileSync(full, "utf8")
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith("#")) continue
      const eq = line.indexOf("=")
      if (eq === -1) continue
      const key = line.slice(0, eq).trim()
      let value = line.slice(eq + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (key && process.env[key] === undefined) process.env[key] = value
    }
  }
}

export type LedgerRecord = {
  syncKey: string
  companyId?: string
  contactIds: string[]
  dealId?: string
  meetingId?: string
  noteId?: string
  taskIds: string[]
  /** 張り済みの関連付け ("meetings#123->deals#456")。再実行時の無駄な PUT を省く */
  associations: string[]
  firstSyncedAt: string
  lastSyncedAt: string
}

type Ledger = Record<string, LedgerRecord>

function ensureLogDir(): void {
  fs.mkdirSync(LOG_DIR, { recursive: true })
}

export function readLedger(): Ledger {
  if (!fs.existsSync(LEDGER_PATH)) return {}
  try {
    return JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8")) as Ledger
  } catch {
    // 壊れていたら握りつぶさず退避する。台帳を黙って消すと重複の原因になる
    const backup = `${LEDGER_PATH}.corrupt-${Date.now()}`
    fs.renameSync(LEDGER_PATH, backup)
    console.warn(`[warn] 台帳が壊れていたため退避しました: ${backup}`)
    return {}
  }
}

export function getLedgerRecord(syncKey: string): LedgerRecord | undefined {
  return readLedger()[syncKey]
}

export function writeLedgerRecord(record: LedgerRecord): void {
  ensureLogDir()
  const ledger = readLedger()
  const existing = ledger[record.syncKey]
  ledger[record.syncKey] = {
    ...record,
    firstSyncedAt: existing?.firstSyncedAt ?? record.firstSyncedAt,
  }
  fs.writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`, "utf8")
}

/** 日次の JSONL ログ。1 行 1 API 呼び出し */
export function appendApiLog(entry: HsLogEntry): void {
  ensureLogDir()
  const day = entry.at.slice(0, 10)
  fs.appendFileSync(path.join(LOG_DIR, `${day}.jsonl`), `${JSON.stringify(entry)}\n`, "utf8")
}

/** 実行単位のサマリログ */
export function appendRunLog(record: unknown): void {
  ensureLogDir()
  const day = new Date().toISOString().slice(0, 10)
  fs.appendFileSync(path.join(LOG_DIR, `${day}.runs.jsonl`), `${JSON.stringify(record)}\n`, "utf8")
}

/** 会社名・取引名・商談日時から安定した冪等キーを作る */
export function deriveSyncKey(parts: (string | undefined)[]): string {
  const seed = parts.filter(Boolean).join("|").toLowerCase().replace(/\s+/g, " ").trim()
  return crypto.createHash("sha1").update(seed).digest("hex").slice(0, 16)
}
