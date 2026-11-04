// Biz-Logi お客様テスト環境への接続試験 (Phase 1-b)。段階ごとに1つずつ実行する。
//
//   npx tsx scripts/bizlogi/test-env.ts --step=tls                 TLS ハンドシェイクのみ (API は呼ばない)
//   npx tsx scripts/bizlogi/test-env.ts --step=confirm --dry-run   電文を組むだけ (送信しない)
//   npx tsx scripts/bizlogi/test-env.ts --step=address             佐川急便マスタ参照API (住所チェック・登録なし)
//   npx tsx scripts/bizlogi/test-env.ts --step=confirm [--pieces=40]  送り状発行API 確認機能 (printOutFlg=0・採番なし)
//   npx tsx scripts/bizlogi/test-env.ts --step=issue --yes-issue-test-env [--pieces=40]
//                                                                  送り状発行API 発行依頼 (printOutFlg=1・N01)
//   npx tsx scripts/bizlogi/test-env.ts --step=checkfile --id=<発行受付ID>   ファイル存在確認API (PDF の有無だけ見る)
//   npx tsx scripts/bizlogi/test-env.ts --step=usage               利用実績API (当月)
//   npx tsx scripts/bizlogi/test-env.ts --step=errors              エラー処理 (すべて確認機能 printOutFlg=0・採番なし)
//
// 安全策:
//   - 読み込むのは .env.bizlogi-test.local だけ (本番の .env は読まない)。BIZLOGI_ENV=test とテスト環境ホスト以外は拒否
//   - 発行依頼は --yes-issue-test-env を付けたときだけ。そのときだけこのプロセス内で BIZLOGI_LIVE=true にする
//   - 送る住所は仕様書 Ver2.82 の I/F 例にある SGシステムの住所 (実在の旅行者・ホテル・BondEx の予約は使わない)
//   - パスワードは表示も記録もしない。結果はコード・番号・TLS バージョンだけを表示し、
//     運用フォルダ (~/JOJO/ops/bizlogi-test-log/) に JSON Lines で残す (リポジトリには残さない)
//   - 失敗しても自動では再送しない
// テスト環境では従量課金は発生せず、実際の集荷も行われない (テスト環境シート Ver2.5・SG 2026-09-03 回答)。

import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import tls from "node:tls"
import { BizLogiClient, BizLogiTransportError, bizLogiConfigFromEnv, BIZLOGI_TEST_HOSTS, type BizLogiConfig } from "../../lib/bizlogi/client"
import { buildPickupDetail, type PickupLegInput } from "../../lib/bizlogi/pickup"
import { pickupRequestClosed } from "../../lib/bizlogi/deadline"
import { buildShippingRequestXml, parseShippingResponse, type ShippingResponse } from "../../lib/bizlogi/shipping"

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=")
    return [k, v ?? "true"] as [string, string]
  }),
)
const step = args.get("step") ?? ""
const dryRun = args.get("dry-run") === "true"

const LOG_DIR = `${homedir()}/JOJO/ops/bizlogi-test-log`
function log(entry: Record<string, unknown>) {
  mkdirSync(LOG_DIR, { recursive: true })
  const day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
  appendFileSync(`${LOG_DIR}/${day}.jsonl`, JSON.stringify({ at: new Date().toISOString(), step, ...entry }) + "\n")
}

function loadTestEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  const text = readFileSync(new URL("../../.env.bizlogi-test.local", import.meta.url), "utf8")
  for (const line of text.split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m) env[m[1]] = m[2]
  }
  if (env.BIZLOGI_ENV !== "test") throw new Error("BIZLOGI_ENV=test ではありません。テスト環境以外には接続しません")
  return env
}

const jstYmd = (offsetDays: number) =>
  new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86_400_000).toISOString().slice(0, 10)

/** 仕様書 I/F 例の住所で組んだ、集荷依頼つきの出荷情報の入力。 */
function fixtureInput(kokyakuCode: string, over: Partial<PickupLegInput> = {}): PickupLegInput {
  let pickup = jstYmd(1)
  if (pickupRequestClosed(pickup)) pickup = jstYmd(2) // 20時を過ぎていたら翌々日
  const stamp = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace(/\D/g, "").slice(4, 14) // MMDDHHmmss
  return {
    legRef: `BDXT${stamp}`,
    kokyakuCode,
    // 依頼主 (= 集荷先) と届け先は、仕様書 4.1 の I/F 例にある SGシステムの住所
    origin: { name: "ＳＧシステム株式会社", postalCode: "6018104", address: "京都府京都市南区上鳥羽角田町25", tel: "00-0000-0000" },
    destination: { name: "ＳＧシステム株式会社", postalCode: "5540024", address: "大阪府大阪市此花区島屋4-4-51", tel: "00-0000-0000" },
    guestName: "テスト",
    suitcaseCount: Number(args.get("pieces") ?? "1"),
    pickupDate: pickup,
    pickupTimeCode: "00",
    notes: ["BondEx接続試験", "テスト環境"],
    weight: null,
    ...over,
  }
}
function fixtureDetail(kokyakuCode: string, over: Partial<PickupLegInput> = {}) {
  const built = buildPickupDetail(fixtureInput(kokyakuCode, over))
  if (!built.ok) throw new Error(`電文を組めません: ${built.issues.map((i) => `${i.field} ${i.message}`).join(" / ")}`)
  return built.detail
}

function summarize(r: ShippingResponse) {
  return {
    result: r.result.code,
    ok: r.ok,
    printRequestId: r.printRequestId,
    details: r.details.map((d) => ({
      userManageNumber: d.userManageNumber,
      codes: d.resultCodes.map((c) => `${c.code}(${c.severity})`),
      shippingNumbers: d.shippingNumbers,
      depot: d.depot?.code ?? null,
    })),
  }
}
function printShipping(r: ShippingResponse) {
  console.log(`  全体 ${r.result.code} ${r.result.message}・ok=${r.ok}・発行受付ID ${r.printRequestId ?? "なし"}`)
  for (const d of r.details) {
    console.log(
      `  明細 ${d.userManageNumber}: ${d.resultCodes.map((c) => `${c.code}(${c.severity}) ${c.message}`).join(", ")}・問合番号 ${d.shippingNumbers.join(", ") || "なし"}・営業所 ${d.depot?.code ?? "-"}`,
    )
  }
}

async function tlsCheck(host: string) {
  const out: Record<string, unknown> = {}
  for (const maxVersion of ["TLSv1.3", "TLSv1.2"] as const) {
    await new Promise<void>((resolve) => {
      const s = tls.connect({ host, port: 443, servername: host, minVersion: "TLSv1.2", maxVersion }, () => {
        console.log(`  上限 ${maxVersion}: 交渉結果 ${s.getProtocol()}・証明書 ${s.authorized ? "検証OK" : `NG (${s.authorizationError})`}`)
        out[maxVersion] = { negotiated: s.getProtocol(), authorized: s.authorized }
        s.end()
        resolve()
      })
      s.on("error", (e) => {
        console.log(`  上限 ${maxVersion}: 接続失敗 ${e.message}`)
        out[maxVersion] = { error: e.message }
        resolve()
      })
    })
  }
  log({ tls: out })
}

/** 確認機能 (printOutFlg=0) の電文を、壊してから直接送る (クライアントの事前検証を通らない入力を API がどう返すか)。 */
async function rawConfirm(cfg: BizLogiConfig, kokyaku: string, mutate: (xml: string) => string): Promise<{ http: number; parsed: ShippingResponse | null; body: string }> {
  const detail = fixtureDetail(kokyaku)
  const xml = mutate(buildShippingRequestXml({ customerId: cfg.customerId, loginPassword: cfg.loginPassword, issue: false, okuriCode: cfg.okuriCode, details: [detail] }))
  const res = await fetch(`${cfg.baseUrl}/shipping`, { method: "POST", headers: { "Content-Type": "application/xml" }, body: xml, signal: AbortSignal.timeout(20_000) })
  const body = await res.text()
  let parsed: ShippingResponse | null = null
  try {
    parsed = parseShippingResponse(body)
  } catch {
    parsed = null
  }
  return { http: res.status, parsed, body: parsed ? "" : body.slice(0, 200) }
}

async function errorsStep(env: Record<string, string>, cfg: BizLogiConfig) {
  const client = new BizLogiClient(cfg)
  const cases: Array<[string, () => Promise<unknown>]> = [
    ["必須項目不足 (届先氏名1を削除)", async () => rawConfirm(cfg, env.BIZLOGI_KOKYAKU_CODE, (x) => x.replace(/<otodokeNm1>[\s\S]*?<\/otodokeNm1>/, ""))],
    ["不正な入力値 (届先郵便番号を6桁)", async () => rawConfirm(cfg, env.BIZLOGI_KOKYAKU_CODE, (x) => x.replace(/<otodokeYubin>\d+<\/otodokeYubin>/, "<otodokeYubin>554002</otodokeYubin>"))],
    ["郵便番号と住所の不一致 (届先を京都の郵便番号に)", async () => client.checkShipping([fixtureDetail(env.BIZLOGI_KOKYAKU_CODE, { destination: { name: "ＳＧシステム株式会社", postalCode: "6018104", address: "大阪府大阪市此花区島屋4-4-51", tel: "00-0000-0000" } })])],
    ["XML の特殊文字 (& < > \" ' を記事・氏名に)", async () => client.checkShipping([fixtureDetail(env.BIZLOGI_KOKYAKU_CODE, { guestName: `A&B<C>"D'E`, notes: [`記事&<>"'テスト`] })])],
    ["認証エラー (誤ったパスワード)", async () => new BizLogiClient({ ...cfg, loginPassword: "wrong-password-for-test==" }).checkShipping([fixtureDetail(env.BIZLOGI_KOKYAKU_CODE)])],
    ["タイムアウト (確認機能・1ミリ秒で打ち切り)", async () => new BizLogiClient({ ...cfg, timeoutMs: 1 }).checkShipping([fixtureDetail(env.BIZLOGI_KOKYAKU_CODE)])],
  ]
  for (const [name, fn] of cases) {
    console.log(`■ ${name}`)
    try {
      const r = (await fn()) as ShippingResponse | { http: number; parsed: ShippingResponse | null; body: string }
      if ("http" in r) {
        console.log(`  HTTP ${r.http}`)
        if (r.parsed) printShipping(r.parsed)
        else console.log(`  解析できない応答: ${r.body}`)
        log({ case: name, http: r.http, response: r.parsed ? summarize(r.parsed) : null, raw: r.parsed ? null : r.body })
      } else {
        printShipping(r)
        log({ case: name, response: summarize(r) })
      }
    } catch (e) {
      const kind = e instanceof BizLogiTransportError ? `通信エラー (status ${e.status})` : e instanceof Error ? e.name : "error"
      console.log(`  例外 ${kind}: ${e instanceof Error ? e.message : String(e)}`)
      log({ case: name, error: kind, message: e instanceof Error ? e.message : String(e) })
    }
  }
}

async function main() {
  const env = loadTestEnv()
  const host = new URL(env.BIZLOGI_BASE_URL).hostname
  if (!BIZLOGI_TEST_HOSTS.includes(host)) throw new Error(`接続先 ${host} はテスト環境ではありません`)
  console.log(`接続先: ${host} (テスト環境)・ステップ: ${step}${dryRun ? " (送信しない)" : ""}`)

  if (step === "tls") return tlsCheck(host)

  const issue = step === "issue"
  // 発行はシステム採番 (Biz-Logi が番号を決める・標準・2026-11-04 谷口さん決定)。--yes-issue-test-env のときだけ、
  // このプロセス内でだけ BIZLOGI_LIVE=true にする (テスト環境は課金・集荷なし)。結果が分からなくても自動で再送しない。
  if (issue && args.get("yes-issue-test-env") !== "true") {
    throw new Error("発行依頼は --yes-issue-test-env を付けたときだけ実行します")
  }
  const cfg = bizLogiConfigFromEnv({ ...env, BIZLOGI_LIVE: issue ? "true" : "", BIZLOGI_NUMBERING: "" })
  if (cfg.environment !== "test") throw new Error("テスト環境の設定ではありません")
  const client = new BizLogiClient(cfg)

  if (step === "errors") return errorsStep(env, cfg)
  if (step === "address") {
    const r = await client.checkAddress("6018104", "京都府京都市南区上鳥羽角田町")
    console.log(`  結果 ${r.result.code} ${r.result.message}・一致 ${r.matched}・担当営業所 ${r.depot?.code ?? "-"} ${r.depot?.name ?? ""}`)
    log({ result: r.result.code, matched: r.matched, depot: r.depot?.code ?? null })
    return
  }
  if (step === "usage") {
    const ym = jstYmd(0).replace(/-/g, "")
    const r = await client.usage(`${ym.slice(0, 6)}01`, ym)
    console.log(`  結果 ${r.result.code} ${r.result.message}・当月の件数 ${r.count}`)
    log({ result: r.result.code, count: r.count })
    return
  }
  if (step === "checkfile") {
    const id = args.get("id") ?? ""
    if (!id) throw new Error("--id=<発行受付ID> を指定してください")
    const r = await client.checkFile([id])
    console.log(`  結果 ${r.result.code} ${r.result.message}`)
    for (const f of r.files) console.log(`  発行受付ID ${f.printRequestId}: ${f.result.code} ${f.result.message}・作成日時 ${f.createDate || "-"}・PDF URL ${f.url ? "あり" : "なし"}`)
    // URL 自体は記録しない (24時間有効のダウンロード先)
    log({ result: r.result.code, files: r.files.map((f) => ({ id: f.printRequestId, code: f.result.code, hasUrl: !!f.url })) })
    return
  }
  if (step === "confirm" || issue) {
    const detail = fixtureDetail(env.BIZLOGI_KOKYAKU_CODE)
    console.log(`  管理番号 ${detail.userManageNumber}・個数 ${detail.haisoKosu}・集荷日 ${detail.shukaIrai?.shukaIraiShiteiDate}・送り状コード ${cfg.okuriCode}`)
    if (dryRun) {
      console.log("  --dry-run: 送信していません")
      return
    }
    const r = issue ? await client.requestShipping([detail]) : await client.checkShipping([detail])
    printShipping(r)
    log({ pieces: detail.haisoKosu, userManageNumber: detail.userManageNumber, response: summarize(r) })
    return
  }
  throw new Error("--step=tls|address|confirm|issue|checkfile|usage|errors を指定してください")
}

main().catch((e) => {
  console.error(`中止: ${e instanceof Error ? e.message : String(e)}`)
  try {
    log({ aborted: e instanceof Error ? e.message : String(e) })
  } catch {
    /* noop */
  }
  process.exit(1)
})
