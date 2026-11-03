// Biz-Logi お客様テスト環境への接続試験 (Phase 1-b 用)。段階ごとに1つずつ実行する。
//
//   npx tsx scripts/bizlogi/test-env.ts --step=tls                 TLS ハンドシェイクのみ (API は呼ばない)
//   npx tsx scripts/bizlogi/test-env.ts --step=confirm --dry-run   電文を組むだけ (送信しない)
//   npx tsx scripts/bizlogi/test-env.ts --step=address             佐川急便マスタ参照API (住所チェック・登録なし)
//   npx tsx scripts/bizlogi/test-env.ts --step=confirm             送り状発行API 確認機能 (printOutFlg=0・採番なし)
//   npx tsx scripts/bizlogi/test-env.ts --step=issue --yes-issue-test-env
//                                                                  送り状発行API 発行依頼 (printOutFlg=1・N01)
//   npx tsx scripts/bizlogi/test-env.ts --step=usage               利用実績API (当月)
//
// 安全策:
//   - 読み込むのは .env.bizlogi-test.local だけ (本番の .env は読まない)。BIZLOGI_ENV=test とテスト環境ホスト以外は拒否
//   - 発行依頼は --yes-issue-test-env を付けたときだけ。そのときだけこのプロセス内で BIZLOGI_LIVE=true にする
//   - 送る住所は仕様書 Ver2.82 の I/F 例にある SGシステムの住所 (実在の旅行者・ホテル・BondEx の予約は使わない)
//   - パスワードは表示しない。結果はコード・番号・TLS バージョンだけを表示する
// テスト環境では従量課金は発生せず、実際の集荷も行われない (テスト環境シート Ver2.5・SG 2026-09-03 回答)。

import { readFileSync } from "node:fs"
import tls from "node:tls"
import { BizLogiClient, bizLogiConfigFromEnv, BIZLOGI_TEST_HOSTS } from "../../lib/bizlogi/client"
import { buildPickupDetail } from "../../lib/bizlogi/pickup"
import { pickupRequestClosed } from "../../lib/bizlogi/deadline"

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=")
    return [k, v ?? "true"] as [string, string]
  }),
)
const step = args.get("step") ?? ""
const dryRun = args.get("dry-run") === "true"

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

/** 仕様書 I/F 例の住所で組んだ、集荷依頼つきの出荷情報 1件。 */
function fixtureDetail(kokyakuCode: string) {
  let pickup = jstYmd(1)
  if (pickupRequestClosed(pickup)) pickup = jstYmd(2) // 20時を過ぎていたら翌々日
  const stamp = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace(/\D/g, "").slice(4, 14) // MMDDHHmmss
  const built = buildPickupDetail({
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
  })
  if (!built.ok) throw new Error(`電文を組めません: ${built.issues.map((i) => `${i.field} ${i.message}`).join(" / ")}`)
  return built.detail
}

async function tlsCheck(host: string) {
  for (const maxVersion of ["TLSv1.3", "TLSv1.2"] as const) {
    await new Promise<void>((resolve) => {
      const s = tls.connect({ host, port: 443, servername: host, minVersion: "TLSv1.2", maxVersion }, () => {
        console.log(`  上限 ${maxVersion}: 交渉結果 ${s.getProtocol()}・証明書 ${s.authorized ? "検証OK" : `NG (${s.authorizationError})`}`)
        s.end()
        resolve()
      })
      s.on("error", (e) => {
        console.log(`  上限 ${maxVersion}: 接続失敗 ${e.message}`)
        resolve()
      })
    })
  }
}

async function main() {
  const env = loadTestEnv()
  const host = new URL(env.BIZLOGI_BASE_URL).hostname
  if (!BIZLOGI_TEST_HOSTS.includes(host)) throw new Error(`接続先 ${host} はテスト環境ではありません`)
  console.log(`接続先: ${host} (テスト環境)・ステップ: ${step}${dryRun ? " (送信しない)" : ""}`)

  if (step === "tls") return tlsCheck(host)

  const issue = step === "issue"
  if (issue && args.get("yes-issue-test-env") !== "true") {
    throw new Error("発行依頼は --yes-issue-test-env を付けたときだけ実行します")
  }
  const cfg = bizLogiConfigFromEnv({ ...env, BIZLOGI_LIVE: issue ? "true" : "" })
  if (cfg.environment !== "test") throw new Error("テスト環境の設定ではありません")
  const client = new BizLogiClient(cfg)

  if (step === "address") {
    const r = await client.checkAddress("6018104", "京都府京都市南区上鳥羽角田町")
    console.log(`  結果 ${r.result.code} ${r.result.message}・一致 ${r.matched}・担当営業所 ${r.depot?.code ?? "-"} ${r.depot?.name ?? ""}`)
    return
  }
  if (step === "usage") {
    const ym = jstYmd(0).replace(/-/g, "")
    const r = await client.usage(`${ym.slice(0, 6)}01`, ym)
    console.log(`  結果 ${r.result.code} ${r.result.message}・当月の件数 ${r.count}`)
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
    console.log(`  全体 ${r.result.code} ${r.result.message}・ok=${r.ok}・発行受付ID ${r.printRequestId ?? "なし"}`)
    for (const d of r.details) {
      console.log(`  明細 ${d.userManageNumber}: ${d.resultCodes.map((c) => `${c.code}(${c.severity})`).join(", ")}・問合番号 ${d.shippingNumbers.join(", ") || "なし"}`)
    }
    return
  }
  throw new Error("--step=tls|address|confirm|issue|usage を指定してください")
}

main().catch((e) => {
  console.error(`中止: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
