/**
 * 自己テスト — HubSpot API をモックして同期ロジックを検証する。
 *
 *   npx tsx scripts/crm-sync/selftest.ts
 *
 * 実トークン不要。検証するのは以下:
 *   1. 初回同期で Company/Contact/Deal/Meeting/Task が作られ、関連付けされる
 *   2. 同じ入力で再実行しても新規作成が 0 件 (重複防止が効いている)
 *   3. 別 PC 想定 (台帳なし) の再実行でも自然キー検索で重複を作らない
 *   4. 検索が失敗したときは作成せず中止する (二重登録の防止)
 *   5. dry-run では一切書き込まない
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

type MockObject = { id: string; properties: Record<string, string> }

type Portal = {
  objects: Record<string, MockObject[]>
  associations: string[]
  writes: number
  /** true の間、検索 API は 500 を返す */
  failSearches: boolean
}

function newPortal(): Portal {
  return {
    objects: { companies: [], contacts: [], deals: [], meetings: [], tasks: [] },
    associations: [],
    writes: 0,
    failSearches: false,
  }
}

let idSeq = 1000

/** HubSpot の最小モック。fetch を差し替えて使う */
function installMockFetch(portal: Portal): () => void {
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString()
    const pathname = href.replace("https://api.hubapi.com", "")
    const method = (init?.method ?? "GET").toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : undefined

    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } })

    // カスタムプロパティ bondex_sync_key は未定義のポータルを想定 (自然キー経路を検証する)
    if (method === "GET" && pathname.startsWith("/crm/v3/properties/")) {
      return json(404, { message: "property not found" })
    }

    if (method === "GET" && pathname === "/crm/v3/pipelines/deals") {
      return json(200, {
        results: [
          {
            id: "default",
            label: "営業パイプライン",
            displayOrder: 0,
            stages: [
              { id: "appointmentscheduled", label: "アポ設定", displayOrder: 0 },
              { id: "qualifiedtobuy", label: "検討中", displayOrder: 1 },
            ],
          },
        ],
      })
    }

    const searchMatch = pathname.match(/^\/crm\/v3\/objects\/(\w+)\/search$/)
    if (method === "POST" && searchMatch) {
      if (portal.failSearches) return json(500, { message: "internal error (mock)" })
      const type = searchMatch[1]
      const pool = portal.objects[type] ?? []
      const groups = body.filterGroups as { filters: { propertyName: string; operator: string; value: string }[] }[]
      const results = pool.filter((o) =>
        groups.some((g) =>
          g.filters.every((f) => {
            if (f.propertyName === "associations.company") {
              return portal.associations.includes(`deals#${o.id}->companies#${f.value}`)
            }
            if (f.propertyName === "associatedcompanyid") {
              return portal.associations.includes(`contacts#${o.id}->companies#${f.value}`)
            }
            return (o.properties[f.propertyName] ?? "") === f.value
          }),
        ),
      )
      return json(200, { total: results.length, results })
    }

    const getMatch = pathname.match(/^\/crm\/v3\/objects\/(\w+)\/(\d+)(\?.*)?$/)
    if (method === "GET" && getMatch) {
      const [, type, id] = getMatch
      const obj = (portal.objects[type] ?? []).find((o) => o.id === id)
      return obj ? json(200, obj) : json(404, { message: "not found" })
    }

    const createMatch = pathname.match(/^\/crm\/v3\/objects\/(\w+)$/)
    if (method === "POST" && createMatch) {
      const type = createMatch[1]
      idSeq += 1
      const obj: MockObject = { id: String(idSeq), properties: { ...body.properties } }
      portal.objects[type] = [...(portal.objects[type] ?? []), obj]
      portal.writes += 1
      return json(201, obj)
    }

    const updateMatch = pathname.match(/^\/crm\/v3\/objects\/(\w+)\/(\d+)$/)
    if (method === "PATCH" && updateMatch) {
      const [, type, id] = updateMatch
      const obj = (portal.objects[type] ?? []).find((o) => o.id === id)
      if (!obj) return json(404, { message: "not found" })
      Object.assign(obj.properties, body.properties)
      portal.writes += 1
      return json(200, obj)
    }

    const assocMatch = pathname.match(/^\/crm\/v4\/objects\/(\w+)\/(\d+)\/associations\/default\/(\w+)\/(\d+)$/)
    if (method === "PUT" && assocMatch) {
      const [, fromType, fromId, toType, toId] = assocMatch
      const key = `${fromType}#${fromId}->${toType}#${toId}`
      if (!portal.associations.includes(key)) portal.associations.push(key)
      // HubSpot の関連付けは双方向に張られる
      const reverse = `${toType}#${toId}->${fromType}#${fromId}`
      if (!portal.associations.includes(reverse)) portal.associations.push(reverse)
      portal.writes += 1
      return json(200, {})
    }

    if (method === "GET" && pathname.startsWith("/crm/v3/objects/companies?")) {
      return json(200, { total: portal.objects.companies.length, results: [] })
    }

    return json(404, { message: `mock 未対応: ${method} ${pathname}` })
  }) as typeof fetch

  return () => {
    globalThis.fetch = original
  }
}

const failures: string[] = []
let checks = 0

function check(label: string, condition: boolean, detail?: string): void {
  checks += 1
  if (condition) {
    console.log(`  ✓ ${label}`)
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`)
    failures.push(label)
  }
}

async function main(): Promise<number> {
  // 台帳をユーザーの作業ディレクトリに書かないよう、一時ディレクトリへ移動してから読み込む
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bondex-crm-sync-test-"))
  const originalCwd = process.cwd()
  const inputPath = path.join(originalCwd, "scripts/crm-sync/example.input.json")
  const rawInput = fs.readFileSync(inputPath, "utf8")
  process.chdir(tmp)

  const { SyncInputSchema } = await import("./schema")
  const { syncToHubSpot } = await import("./sync")

  const input = SyncInputSchema.parse(JSON.parse(rawInput))
  const opts = { token: "mock-token", dryRun: false }

  console.log("\n[1] 初回同期 — 全オブジェクトが新規作成される")
  const portal = newPortal()
  let restore = installMockFetch(portal)
  const first = await syncToHubSpot(input, opts)
  restore()

  check("エラーなし", first.errors.length === 0, first.errors.join(" / "))
  check("会社を新規作成", first.company?.action === "created", first.company?.action)
  check("担当者を新規作成", first.contacts[0]?.action === "created", first.contacts[0]?.action)
  check("取引を新規作成", first.deal?.action === "created", first.deal?.action)
  check("既定パイプラインの先頭ステージに入る",
    portal.objects.deals[0]?.properties.dealstage === "appointmentscheduled",
    portal.objects.deals[0]?.properties.dealstage)
  check("商談メモを新規作成", first.meeting?.action === "created", first.meeting?.action)
  check("タスクを 2 件作成", first.tasks.filter((t) => t.action === "created").length === 2)
  check("商談メモが会社・取引・担当者に紐づく", first.associations >= 3, String(first.associations))
  check("HubSpot 上のオブジェクト総数が 6", 
    portal.objects.companies.length + portal.objects.contacts.length + portal.objects.deals.length +
    portal.objects.meetings.length + portal.objects.tasks.length === 6)

  console.log("\n[2] 同一入力で再実行 — 重複を作らない (台帳あり)")
  const writesBefore = portal.writes
  restore = installMockFetch(portal)
  const second = await syncToHubSpot(input, opts)
  restore()

  check("エラーなし", second.errors.length === 0, second.errors.join(" / "))
  check("会社が新規作成されない", second.company?.action !== "created", second.company?.action)
  check("取引が新規作成されない", second.deal?.action !== "created", second.deal?.action)
  check("商談メモが新規作成されない", second.meeting?.action !== "created", second.meeting?.action)
  check("タスクが新規作成されない", second.tasks.every((t) => t.action !== "created"))
  check("オブジェクト総数が 6 のまま",
    portal.objects.companies.length + portal.objects.contacts.length + portal.objects.deals.length +
    portal.objects.meetings.length + portal.objects.tasks.length === 6)
  check("同じ ID を再利用している", second.company?.id === first.company?.id)
  check("不要な書き込みが発生していない", portal.writes === writesBefore, `${writesBefore} -> ${portal.writes}`)

  console.log("\n[3] 台帳を失った状態で再実行 — 自然キー検索で重複を防ぐ (別PC想定)")
  fs.rmSync(path.join(tmp, "logs"), { recursive: true, force: true })
  restore = installMockFetch(portal)
  const third = await syncToHubSpot(input, opts)
  restore()

  check("エラーなし", third.errors.length === 0, third.errors.join(" / "))
  check("会社を検索で再発見", third.company?.id === first.company?.id, third.company?.action)
  check("取引を検索で再発見", third.deal?.id === first.deal?.id, third.deal?.action)
  check("商談メモを検索で再発見", third.meeting?.id === first.meeting?.id, third.meeting?.action)
  check("オブジェクト総数が 6 のまま",
    portal.objects.companies.length + portal.objects.contacts.length + portal.objects.deals.length +
    portal.objects.meetings.length + portal.objects.tasks.length === 6)

  console.log("\n[4] 検索が落ちているとき — 作成せず中止する")
  const brokenPortal = newPortal()
  brokenPortal.failSearches = true
  fs.rmSync(path.join(tmp, "logs"), { recursive: true, force: true })
  restore = installMockFetch(brokenPortal)
  const fourth = await syncToHubSpot(input, { ...opts, maxRetriesForTest: 0 } as never)
  restore()

  check("何も作成されない",
    brokenPortal.objects.companies.length + brokenPortal.objects.deals.length + brokenPortal.objects.meetings.length === 0)
  check("中止理由が報告される", fourth.errors.some((e) => e.includes("二重登録を避けて")), fourth.errors[0])

  console.log("\n[5] dry-run — 実書き込みが 0 件")
  const dryPortal = newPortal()
  fs.rmSync(path.join(tmp, "logs"), { recursive: true, force: true })
  restore = installMockFetch(dryPortal)
  const fifth = await syncToHubSpot(input, { token: "mock-token", dryRun: true })
  restore()

  check("HubSpot への書き込みが 0 件", dryPortal.writes === 0, String(dryPortal.writes))
  check("作成予定として報告される", fifth.company?.action === "created", fifth.company?.action)
  check("台帳を汚さない", !fs.existsSync(path.join(tmp, "logs/bondex-sync/ledger.json")))

  process.chdir(originalCwd)
  fs.rmSync(tmp, { recursive: true, force: true })

  console.log(`\n${failures.length === 0 ? "すべて成功" : "失敗あり"}: ${checks - failures.length}/${checks}`)
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`)
  }
  return failures.length === 0 ? 0 : 1
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
