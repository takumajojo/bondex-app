/**
 * 手元で動かす運用の道具 (scripts/*) が本番の DB に触れる時の守り (2026-11-07・谷口さんの指示)。アプリ (lib/env-guard.ts) とは別。
 *
 *   - 本番への書き込み (scripts/sagawa-leadtime/import.ts): 既定は書かない (計画の表示だけ)。本番へは `--write` と、その日・その本番・
 *     その中身に結びついた承認の文字列 `--approve-prod-write=<文字列>` の両方がコマンドの引数にある時だけ。環境変数の鍵があるだけでは書かない。
 *     承認の文字列は環境変数・.env からは読まない (ファイルに置いた承認が毎回効く形にしない)。
 *   - 本番の読み取りの照合 (scripts/pickup-request/check-excel-rows.ts): 本番へは運営の照合のモード `--ops-mode=excel-check` の時だけ。
 *     どの接続も読み取りの要求 (GET・HEAD) しか送れないクライアントで作る (service_role の鍵でも書き込めない)。
 *   - Vercel (Production・Preview)・CI の上では、どちらの道具も動かさない。
 * 鍵の値はエラーの文に出さない (変数の名前と理由だけ)。
 */
import { createHash } from "node:crypto"
import { PROD_SUPABASE_REF, STAGING_SUPABASE_REF } from "../env-guard"

type Env = Record<string, string | undefined>

export type DbTarget = "production" | "staging" | "local"

export class ScriptGuardError extends Error {}

export function jwtPayload(key: string | undefined): Record<string, unknown> | null {
  if (!key || key.split(".").length !== 3) return null
  try {
    return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"))
  } catch {
    return null
  }
}

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"]

/** Vercel・CI の上なら、その理由。手元の端末だけで動かす。 */
export function hostedRuntimeReasons(env: Env = process.env): string[] {
  const r: string[] = []
  for (const k of ["VERCEL", "VERCEL_ENV", "VERCEL_URL"]) if (env[k] !== undefined) r.push(`${k}: Vercel の上では動かさない（手元の運営の端末だけ）`)
  for (const k of ["CI", "GITHUB_ACTIONS"]) if (env[k] !== undefined) r.push(`${k}: CI の上では動かさない`)
  return r
}

/**
 * 接続先 (URL) と鍵がどの DB か。URL と鍵の食い違い・知らない接続先は止める (推測で続けない)。
 * 手元 (localhost) は試験の DB。本番・staging は Supabase の ID で見る。
 */
export function classifyDbTarget(url: string | undefined, key: string | undefined): DbTarget {
  if (!url || !key) throw new ScriptGuardError("Supabase の接続情報 (URL と鍵) がありません")
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    throw new ScriptGuardError("Supabase の URL の形が正しくありません")
  }
  const keyRef = jwtPayload(key)?.ref
  const urlTarget: DbTarget | null =
    host === `${PROD_SUPABASE_REF}.supabase.co` ? "production"
    : host === `${STAGING_SUPABASE_REF}.supabase.co` ? "staging"
    : LOCAL_HOSTS.includes(host) ? "local"
    : null
  if (!urlTarget) throw new ScriptGuardError("Supabase の URL が本番・staging・手元のどれでもありません（知らない接続先には触れない）")
  const keyTarget = keyRef === PROD_SUPABASE_REF ? "production" : keyRef === STAGING_SUPABASE_REF ? "staging" : keyRef ? "other" : null
  if (urlTarget !== "local" && keyTarget !== urlTarget) throw new ScriptGuardError("Supabase の URL と鍵の接続先が一致しません")
  if (urlTarget === "local" && (keyTarget === "production" || keyTarget === "staging")) throw new ScriptGuardError("手元の URL に本番・staging の鍵が入っています")
  return urlTarget
}

/** 鍵の役割 (JWT の role)。service_role・anon・読み取り専用の役割 (bondex_excel_reader) など。分からなければ null。 */
export function keyRole(key: string | undefined): string | null {
  const role = jwtPayload(key)?.role
  return typeof role === "string" ? role : null
}

/** 読み取り (GET・HEAD) しか送らない fetch。書き込み・関数の呼び出し (POST・PATCH・PUT・DELETE) は送る前に止める。 */
export function readOnlyFetch(base: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()
    if (method !== "GET" && method !== "HEAD") throw new ScriptGuardError(`読み取り専用の接続で ${method} は送りません`)
    return base(input, init)
  }) as typeof fetch
}

/** 日本時間の日付 (YYYYMMDD)。承認の文字列はその日だけ効く。 */
export function jstDate(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, "")
}

/** 書き込む中身 (ファイルの内容) の要約。中身が変われば承認の文字列も変わる。 */
export function contentDigest(parts: string[]): string {
  const h = createHash("sha256")
  for (const p of parts) h.update(String(p.length)).update(":").update(p)
  return h.digest("hex").slice(0, 12)
}

/** 本番への書き込みの承認の文字列: 道具の名前・日本時間の日付・本番の ID・中身の要約。秘密は含まない (表示・共有してよい)。 */
export function prodWriteApprovalCode(tool: string, digest: string, now: Date = new Date()): string {
  return `PRODWRITE-${tool}-${jstDate(now)}-${PROD_SUPABASE_REF}-${digest}`
}

/** `--name=value` か `--name value` の引数。無ければ undefined。 */
export function argValue(argv: string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) return argv[i + 1]
    if (argv[i].startsWith(`${name}=`)) return argv[i].slice(name.length + 1)
  }
  return undefined
}

export const OPS_MODE_EXCEL_CHECK = "excel-check"

/**
 * Excel の照合の接続を許すか。本番へは運営の照合のモードの時だけ。staging の宣言 (BONDEX_ENV=staging) のまま本番は読まない。
 * 不正なモードの値は止める (打ち間違いを「モードなし」として扱わない)。
 */
export function assertExcelCheckAllowed(target: DbTarget, argv: string[], env: Env = process.env): void {
  const hosted = hostedRuntimeReasons(env)
  if (hosted.length) throw new ScriptGuardError(hosted.join(" / "))
  const mode = argValue(argv, "--ops-mode")
  if (mode !== undefined && mode !== OPS_MODE_EXCEL_CHECK) throw new ScriptGuardError(`--ops-mode の値が正しくありません（使えるのは ${OPS_MODE_EXCEL_CHECK} だけ）`)
  if (target !== "production") return
  if (env.BONDEX_ENV && env.BONDEX_ENV !== "production") throw new ScriptGuardError(`BONDEX_ENV=${env.BONDEX_ENV} のまま本番の DB は読みません`)
  if (mode !== OPS_MODE_EXCEL_CHECK) {
    throw new ScriptGuardError(`本番の DB の照合は運営の照合のモードだけで行います（build_sheet.py から実行する。手で流す時は --ops-mode=${OPS_MODE_EXCEL_CHECK}）`)
  }
}

/**
 * 書き込みを許すか。既定は書かない (計画の表示だけ)。`--write` で書く。本番は加えて、今日・本番・この中身の承認の文字列が引数に要る。
 * 戻り値: "plan" (書かない) か "write"。
 */
export function assertWriteAllowed(tool: string, target: DbTarget, digest: string, argv: string[], env: Env = process.env, now: Date = new Date()): "plan" | "write" {
  const hosted = hostedRuntimeReasons(env)
  if (hosted.length) throw new ScriptGuardError(hosted.join(" / "))
  for (const a of argv) {
    if (a.startsWith("--") && !["--write"].includes(a) && !a.startsWith("--approve-prod-write")) throw new ScriptGuardError(`知らない指定です: ${a.split("=")[0]}`)
  }
  const approval = argValue(argv, "--approve-prod-write")
  if (!argv.includes("--write")) {
    if (approval !== undefined) throw new ScriptGuardError("--approve-prod-write は --write と一緒の時だけ使います")
    return "plan"
  }
  if (target !== "production") {
    if (approval !== undefined) throw new ScriptGuardError("本番以外への書き込みに --approve-prod-write は使いません")
    return "write"
  }
  if (env.BONDEX_ENV && env.BONDEX_ENV !== "production") throw new ScriptGuardError(`BONDEX_ENV=${env.BONDEX_ENV} のまま本番の DB には書きません`)
  if (!approval) throw new ScriptGuardError("本番の DB への書き込みには、谷口さんの承認の文字列 (--approve-prod-write=…) が要ります。まず --write なしで流して計画と文字列を確かめてください")
  if (approval !== prodWriteApprovalCode(tool, digest, now)) {
    throw new ScriptGuardError("承認の文字列が、今日・本番・この中身のものと一致しません（日付が変わった・データが変わった・別の道具のもの）。--write なしで流して計画を確かめ直してください")
  }
  return "write"
}
