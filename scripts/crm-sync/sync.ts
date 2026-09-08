/**
 * BondEx CRM Sync — 営業メモを HubSpot へ同期する中核ロジック。
 *
 * 処理順:
 *   1. Company 検索 -> 無ければ Create / あれば Update
 *   2. Contact 検索 -> 同上 (Company に関連付け)
 *   3. Deal 検索    -> 同上 (Company / Contact に関連付け)
 *   4. Meeting (商談メモ) 追加
 *   5. Task 追加
 *
 * 重複防止は 3 段構え:
 *   a. ローカル台帳 (logs/bondex-sync/ledger.json) — 同一 syncKey の再実行を検知
 *   b. カスタムプロパティ bondex_sync_key — ポータルに定義されていれば横断的に照合
 *   c. 自然キー検索 — domain / email / dealname+会社 / 件名+日時
 * 検索インデックスの遅延 (数秒) があるため a が最終防衛線になる。
 */

import {
  createHubSpotClient,
  isDryRunId,
  type HsObject,
  type HsObjectType,
  type HubSpotClient,
} from "../../lib/hubspot"
import type { ContactInput, SyncInput, TaskInput } from "./schema"
import { deriveSyncKey, getLedgerRecord, writeLedgerRecord, type LedgerRecord } from "./store"

/** ポータルに任意で定義できる冪等キー用のカスタムプロパティ名 */
export const SYNC_KEY_PROPERTY = "bondex_sync_key"

export type ObjectAction = "created" | "updated" | "reused"

export type SyncedObject = {
  id: string
  action: ObjectAction
  label: string
  url?: string
}

export type SyncReport = {
  syncKey: string
  dryRun: boolean
  portalId?: string
  company?: SyncedObject
  contacts: SyncedObject[]
  deal?: SyncedObject
  meeting?: SyncedObject
  note?: SyncedObject
  tasks: SyncedObject[]
  associations: number
  /** 前回同期時に張り済みで、今回スキップした関連付けの件数 */
  associationsSkipped: number
  /** action ("created"/"updated"/"reused") 別のオブジェクト数。要件10の集計出力の根拠 */
  counts: Record<ObjectAction, number>
  skipped: string[]
  errors: string[]
  startedAt: string
  finishedAt: string
}

function toEpochMs(value: string): string {
  return String(Date.parse(value))
}

/** 未指定タスクの既定期限 — 翌日 09:00 (実行環境のタイムゾーン) */
function defaultTaskDue(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return String(d.getTime())
}

function objectUrl(portalId: string | undefined, objectType: HsObjectType, id: string): string | undefined {
  if (!portalId || isDryRunId(id)) return undefined
  const typePath: Record<HsObjectType, string> = {
    companies: "company",
    contacts: "contact",
    deals: "deal",
    meetings: "record/0-47",
    tasks: "tasks",
    notes: "record/0-46",
  }
  if (objectType === "companies" || objectType === "contacts" || objectType === "deals") {
    return `https://app.hubspot.com/contacts/${portalId}/${typePath[objectType]}/${id}`
  }
  return undefined
}

/** undefined を落として HubSpot が受け付ける文字列マップにする */
function props(input: Record<string, string | number | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === "") continue
    out[k] = String(v)
  }
  return out
}

/** 差分のあるプロパティだけ返す。無駄な PATCH と履歴汚染を避ける */
function changedProps(existing: HsObject, desired: Record<string, string>): Record<string, string> {
  const diff: Record<string, string> = {}
  for (const [k, v] of Object.entries(desired)) {
    if ((existing.properties?.[k] ?? "") !== v) diff[k] = v
  }
  return diff
}

export type SyncOptions = {
  token: string
  dryRun: boolean
  /** 台帳に記録済みでも Meeting / Task を作り直す */
  force?: boolean
  portalId?: string
  onLog?: Parameters<typeof createHubSpotClient>[0]["onLog"]
}

export async function syncToHubSpot(input: SyncInput, options: SyncOptions): Promise<SyncReport> {
  const startedAt = new Date().toISOString()
  const client = createHubSpotClient({
    token: options.token,
    dryRun: options.dryRun,
    onLog: options.onLog,
  })

  const syncKey =
    input.syncKey ?? deriveSyncKey([input.company.name, input.deal?.dealname, input.meeting?.startTime])

  const report: SyncReport = {
    syncKey,
    dryRun: options.dryRun,
    portalId: options.portalId,
    contacts: [],
    tasks: [],
    associations: 0,
    associationsSkipped: 0,
    counts: { created: 0, updated: 0, reused: 0 },
    skipped: [],
    errors: [],
    startedAt,
    finishedAt: startedAt,
  }

  const ledger = getLedgerRecord(syncKey)
  const nextLedger: LedgerRecord = {
    syncKey,
    contactIds: [],
    taskIds: [],
    associations: [],
    firstSyncedAt: ledger?.firstSyncedAt ?? startedAt,
    lastSyncedAt: startedAt,
  }

  // bondex_sync_key がポータルに定義されているか (未定義ならこの層の重複防止は無効)
  const syncKeyProps = new Map<HsObjectType, boolean>()
  async function supportsSyncKey(objectType: HsObjectType): Promise<boolean> {
    const cached = syncKeyProps.get(objectType)
    if (cached !== undefined) return cached
    const has = await client.hasProperty(objectType, SYNC_KEY_PROPERTY)
    syncKeyProps.set(objectType, has)
    return has
  }

  /**
   * 検索の「失敗」と「該当なし」を区別して返す。
   * ここを undefined に潰すと、認証エラーや 5xx のときに「新規作成」へ倒れて
   * 重複レコードを作ってしまう (重複防止が破れる最大の穴)。
   */
  type Lookup = { obj?: HsObject; failed: boolean }

  async function findBySyncKey(objectType: HsObjectType, key: string): Promise<Lookup> {
    if (!(await supportsSyncKey(objectType))) return { failed: false }
    const res = await client.search(
      objectType,
      [{ filters: [{ propertyName: SYNC_KEY_PROPERTY, operator: "EQ", value: key }] }],
      [SYNC_KEY_PROPERTY],
      1,
    )
    if (!res.ok) return { failed: true }
    return { obj: res.data.results?.[0], failed: false }
  }

  /** 「重複確認できなかったので作らない」ときの共通メッセージ */
  function abortedByLookup(what: string): string {
    return `${what}: 重複確認の検索に失敗したため、二重登録を避けて作成を中止しました`
  }

  async function withSyncKey(objectType: HsObjectType, key: string, base: Record<string, string>) {
    return (await supportsSyncKey(objectType)) ? { ...base, [SYNC_KEY_PROPERTY]: key } : base
  }

  const priorAssociations = new Set(ledger?.associations ?? [])

  /**
   * 関連付けは HubSpot 側では冪等だが、毎回投げると API 回数を無駄に消費する。
   * 台帳に記録済みのペアは飛ばす (台帳が無い環境では従来どおり張り直す)。
   */
  async function link(fromType: HsObjectType, fromId: string, toType: HsObjectType, toId: string) {
    const key = `${fromType}#${fromId}->${toType}#${toId}`
    if (priorAssociations.has(key)) {
      report.associationsSkipped += 1
      nextLedger.associations.push(key)
      return
    }
    const res = await client.associate(fromType, fromId, toType, toId)
    if (res.ok) {
      report.associations += 1
      nextLedger.associations.push(key)
    } else {
      report.errors.push(`関連付け失敗 ${fromType}#${fromId} -> ${toType}#${toId}: ${res.error}`)
    }
  }

  // ---------------------------------------------------------------- 1. Company
  const companyDesired = props({
    name: input.company.name,
    domain: input.company.domain,
    phone: input.company.phone,
    city: input.company.city,
    country: input.company.country,
    industry: input.company.industry,
    description: input.company.description,
    website: input.company.website,
    ...(input.company.properties ?? {}),
  })

  let companyId: string | undefined
  let existingCompany: HsObject | undefined
  let companyLookupFailed = false

  if (ledger?.companyId && !isDryRunId(ledger.companyId)) {
    companyId = ledger.companyId
    // 台帳から ID を得た場合も現在値を読む。読まずに PATCH すると
    // 毎回全プロパティを書き戻し、HubSpot の変更履歴が同期のたびに汚れる
    const fetched = await client.get("companies", companyId, Object.keys(companyDesired))
    if (fetched.ok) existingCompany = fetched.data
  } else {
    const bySyncKey = await findBySyncKey("companies", `${syncKey}:company`)
    existingCompany = bySyncKey.obj
    companyLookupFailed = bySyncKey.failed

    if (!existingCompany && input.company.domain) {
      const byDomain = await client.search(
        "companies",
        [{ filters: [{ propertyName: "domain", operator: "EQ", value: input.company.domain }] }],
        ["name", "domain", ...Object.keys(companyDesired)],
        1,
      )
      if (byDomain.ok) existingCompany = byDomain.data.results?.[0]
      else {
        companyLookupFailed = true
        report.errors.push(`会社検索(domain)失敗: ${byDomain.error}`)
      }
    }
    if (!existingCompany) {
      const byName = await client.search(
        "companies",
        [{ filters: [{ propertyName: "name", operator: "EQ", value: input.company.name }] }],
        ["name", "domain", ...Object.keys(companyDesired)],
        1,
      )
      if (byName.ok) existingCompany = byName.data.results?.[0]
      else {
        companyLookupFailed = true
        report.errors.push(`会社検索(name)失敗: ${byName.error}`)
      }
    }
    companyId = existingCompany?.id
  }

  if (companyId) {
    const diff = existingCompany ? changedProps(existingCompany, companyDesired) : companyDesired
    if (Object.keys(diff).length > 0) {
      const res = await client.update("companies", companyId, diff)
      if (!res.ok) report.errors.push(`会社更新失敗: ${res.error}`)
      report.company = { id: companyId, action: "updated", label: input.company.name, url: objectUrl(options.portalId, "companies", companyId) }
    } else {
      report.company = { id: companyId, action: "reused", label: input.company.name, url: objectUrl(options.portalId, "companies", companyId) }
    }
  } else if (companyLookupFailed) {
    report.errors.push(abortedByLookup(`会社「${input.company.name}」`))
    report.finishedAt = new Date().toISOString()
    return report
  } else {
    const res = await client.create("companies", await withSyncKey("companies", `${syncKey}:company`, companyDesired))
    if (!res.ok) {
      report.errors.push(`会社作成失敗: ${res.error}`)
      report.finishedAt = new Date().toISOString()
      return report // 会社が作れないと以降の関連付けが成立しないため打ち切る
    }
    companyId = res.data.id
    report.company = { id: companyId, action: "created", label: input.company.name, url: objectUrl(options.portalId, "companies", companyId) }
  }
  nextLedger.companyId = companyId

  // ---------------------------------------------------------------- 2. Contacts
  for (const contact of input.contacts as ContactInput[]) {
    const label = contact.email || [contact.lastname, contact.firstname].filter(Boolean).join(" ") || "(名称不明)"
    const desired = props({
      email: contact.email,
      firstname: contact.firstname,
      lastname: contact.lastname,
      jobtitle: contact.jobtitle,
      phone: contact.phone,
      ...(contact.properties ?? {}),
    })

    let existing: HsObject | undefined
    let lookupFailed = false
    if (contact.email) {
      const byEmail = await client.search(
        "contacts",
        [{ filters: [{ propertyName: "email", operator: "EQ", value: contact.email }] }],
        ["email", "firstname", "lastname", ...Object.keys(desired)],
        1,
      )
      if (byEmail.ok) existing = byEmail.data.results?.[0]
      else {
        lookupFailed = true
        report.errors.push(`担当者検索(email)失敗: ${byEmail.error}`)
      }
    } else if (contact.lastname && companyId && !isDryRunId(companyId)) {
      // メール未取得の名刺情報など。同一会社内の同姓同名は同一人物とみなす
      const filters = [
        { propertyName: "lastname", operator: "EQ" as const, value: contact.lastname },
        { propertyName: "associatedcompanyid", operator: "EQ" as const, value: companyId },
      ]
      if (contact.firstname) filters.push({ propertyName: "firstname", operator: "EQ" as const, value: contact.firstname })
      const byName = await client.search("contacts", [{ filters }], ["email", "firstname", "lastname"], 1)
      if (byName.ok) existing = byName.data.results?.[0]
      else {
        lookupFailed = true
        report.errors.push(`担当者検索(氏名)失敗: ${byName.error}`)
      }
    }

    if (!existing && lookupFailed) {
      report.errors.push(abortedByLookup(`担当者「${label}」`))
      continue
    }

    let contactId: string
    if (existing) {
      const diff = changedProps(existing, desired)
      if (Object.keys(diff).length > 0) {
        const res = await client.update("contacts", existing.id, diff)
        if (!res.ok) report.errors.push(`担当者更新失敗 (${label}): ${res.error}`)
        report.contacts.push({ id: existing.id, action: "updated", label, url: objectUrl(options.portalId, "contacts", existing.id) })
      } else {
        report.contacts.push({ id: existing.id, action: "reused", label, url: objectUrl(options.portalId, "contacts", existing.id) })
      }
      contactId = existing.id
    } else {
      const res = await client.create("contacts", desired)
      if (!res.ok) {
        report.errors.push(`担当者作成失敗 (${label}): ${res.error}`)
        continue
      }
      contactId = res.data.id
      report.contacts.push({ id: contactId, action: "created", label, url: objectUrl(options.portalId, "contacts", contactId) })
    }

    nextLedger.contactIds.push(contactId)
    if (companyId) await link("contacts", contactId, "companies", companyId)
  }

  // ---------------------------------------------------------------- 3. Deal
  let dealId: string | undefined
  if (input.deal) {
    const deal = input.deal

    let pipeline = deal.pipeline
    let dealstage = deal.dealstage
    if (!pipeline || !dealstage) {
      const pipelines = await client.getDealPipelines()
      if (pipelines.ok && pipelines.data.results?.length) {
        const chosen =
          pipelines.data.results.find((p) => p.id === "default") ??
          [...pipelines.data.results].sort((a, b) => a.displayOrder - b.displayOrder)[0]
        const firstStage = [...(chosen.stages ?? [])].sort((a, b) => a.displayOrder - b.displayOrder)[0]
        pipeline = pipeline ?? chosen.id
        dealstage = dealstage ?? firstStage?.id
      } else if (!pipelines.ok) {
        report.errors.push(`パイプライン取得失敗: ${pipelines.error}`)
      }
    }

    const desired = props({
      dealname: deal.dealname,
      amount: deal.amount,
      closedate: deal.closedate ? toEpochMs(deal.closedate) : undefined,
      pipeline,
      dealstage,
      ...(deal.properties ?? {}),
    })

    let existing: HsObject | undefined
    let dealLookupFailed = false
    if (ledger?.dealId && !isDryRunId(ledger.dealId)) {
      dealId = ledger.dealId
      const fetched = await client.get("deals", dealId, Object.keys(desired))
      if (fetched.ok) existing = fetched.data
    } else {
      const bySyncKey = await findBySyncKey("deals", `${syncKey}:deal`)
      existing = bySyncKey.obj
      dealLookupFailed = bySyncKey.failed
      if (!existing) {
        const filters = [{ propertyName: "dealname", operator: "EQ" as const, value: deal.dealname }]
        if (companyId && !isDryRunId(companyId)) {
          filters.push({ propertyName: "associations.company", operator: "EQ" as const, value: companyId })
        }
        const found = await client.search("deals", [{ filters }], ["dealname", "amount", "dealstage", "pipeline", ...Object.keys(desired)], 1)
        if (found.ok) existing = found.data.results?.[0]
        else {
          dealLookupFailed = true
          report.errors.push(`取引検索失敗: ${found.error}`)
        }
      }
      dealId = existing?.id
    }

    if (dealId) {
      // 既存取引のステージは営業担当が動かしている可能性があるため、
      // 明示指定が無い限り pipeline / dealstage は上書きしない
      const updatable = { ...desired }
      if (!deal.pipeline) delete updatable.pipeline
      if (!deal.dealstage) delete updatable.dealstage
      const diff = existing ? changedProps(existing, updatable) : updatable
      if (Object.keys(diff).length > 0) {
        const res = await client.update("deals", dealId, diff)
        if (!res.ok) report.errors.push(`取引更新失敗: ${res.error}`)
        report.deal = { id: dealId, action: "updated", label: deal.dealname, url: objectUrl(options.portalId, "deals", dealId) }
      } else {
        report.deal = { id: dealId, action: "reused", label: deal.dealname, url: objectUrl(options.portalId, "deals", dealId) }
      }
    } else if (dealLookupFailed) {
      report.errors.push(abortedByLookup(`取引「${deal.dealname}」`))
    } else {
      const res = await client.create("deals", await withSyncKey("deals", `${syncKey}:deal`, desired))
      if (!res.ok) report.errors.push(`取引作成失敗: ${res.error}`)
      else {
        dealId = res.data.id
        report.deal = { id: dealId, action: "created", label: deal.dealname, url: objectUrl(options.portalId, "deals", dealId) }
      }
    }

    if (dealId) {
      nextLedger.dealId = dealId
      if (companyId) await link("deals", dealId, "companies", companyId)
      for (const c of report.contacts) await link("deals", dealId, "contacts", c.id)
    }
  }

  // ---------------------------------------------------------------- 4. Meeting
  if (input.meeting) {
    const meeting = input.meeting
    const startMs = toEpochMs(meeting.startTime)
    const endMs = meeting.endTime ? toEpochMs(meeting.endTime) : String(Number(startMs) + 60 * 60 * 1000)

    let meetingId = ledger?.meetingId && !isDryRunId(ledger.meetingId) ? ledger.meetingId : undefined

    if (meetingId && !options.force) {
      report.meeting = { id: meetingId, action: "reused", label: meeting.title }
      report.skipped.push(`商談メモは同期済みのため再作成しませんでした (--force で上書き作成)`)
    } else {
      // 台帳が無い環境 (別 PC 等) からの再実行に備え、件名＋開始時刻でも照合する
      const bySyncKey = await findBySyncKey("meetings", `${syncKey}:meeting`)
      let existing = bySyncKey.obj
      let meetingLookupFailed = bySyncKey.failed
      if (!existing) {
        const found = await client.search(
          "meetings",
          [
            {
              filters: [
                { propertyName: "hs_meeting_title", operator: "EQ", value: meeting.title },
                { propertyName: "hs_timestamp", operator: "EQ", value: startMs },
              ],
            },
          ],
          ["hs_meeting_title", "hs_timestamp"],
          1,
        )
        if (found.ok) existing = found.data.results?.[0]
        else {
          meetingLookupFailed = true
          report.errors.push(`商談メモ検索失敗: ${found.error}`)
        }
      }

      if (!existing && meetingLookupFailed) {
        report.errors.push(abortedByLookup(`商談メモ「${meeting.title}」`))
      } else if (existing && !options.force) {
        meetingId = existing.id
        report.meeting = { id: existing.id, action: "reused", label: meeting.title }
        report.skipped.push("同一件名・同一日時の商談メモが既にあるため作成を見送りました")
      } else {
        const desired = await withSyncKey(
          "meetings",
          `${syncKey}:meeting`,
          props({
            hs_timestamp: startMs,
            hs_meeting_title: meeting.title,
            hs_meeting_body: meeting.body,
            hs_meeting_start_time: startMs,
            hs_meeting_end_time: endMs,
            hs_meeting_outcome: meeting.outcome ?? "COMPLETED",
          }),
        )
        const res = await client.create("meetings", desired)
        if (!res.ok) report.errors.push(`商談メモ作成失敗: ${res.error}`)
        else {
          meetingId = res.data.id
          report.meeting = { id: meetingId, action: "created", label: meeting.title }
        }
      }
    }

    if (meetingId) {
      nextLedger.meetingId = meetingId
      if (companyId) await link("meetings", meetingId, "companies", companyId)
      if (dealId) await link("meetings", meetingId, "deals", dealId)
      for (const c of report.contacts) await link("meetings", meetingId, "contacts", c.id)
    }
  }

  // ---------------------------------------------------------------- 4b. Note
  // 商談内容・営業状況のメモ。Meeting (実際のカレンダー予定) と違い日時に厳密な意味を
  // 持たないため、自然キー検索は行わない (本文の完全一致検索は現実的でない)。
  // 重複防止は台帳 と bondex_sync_key に限られる — ポータルに同プロパティが無い環境で
  // 台帳も失った場合のみ、同一内容の Note が重複しうる (README に明記)。
  if (input.note) {
    const note = input.note
    const noteTimestamp = note.timestamp ? toEpochMs(note.timestamp) : String(Date.now())
    let noteId = ledger?.noteId && !isDryRunId(ledger.noteId) ? ledger.noteId : undefined

    if (noteId && !options.force) {
      report.note = { id: noteId, action: "reused", label: "Note" }
      report.skipped.push("Note は同期済みのため再作成しませんでした (--force で上書き作成)")
    } else {
      const bySyncKey = await findBySyncKey("notes", `${syncKey}:note`)
      if (bySyncKey.failed) {
        report.errors.push(abortedByLookup("Note"))
      } else if (bySyncKey.obj && !options.force) {
        noteId = bySyncKey.obj.id
        report.note = { id: noteId, action: "reused", label: "Note" }
        report.skipped.push("同一 syncKey の Note が既にあるため作成を見送りました")
      } else {
        const desired = await withSyncKey(
          "notes",
          `${syncKey}:note`,
          props({ hs_timestamp: noteTimestamp, hs_note_body: note.body }),
        )
        const res = await client.create("notes", desired)
        if (!res.ok) report.errors.push(`Note 作成失敗: ${res.error}`)
        else {
          noteId = res.data.id
          report.note = { id: noteId, action: "created", label: "Note" }
        }
      }
    }

    if (noteId) {
      nextLedger.noteId = noteId
      if (companyId) await link("notes", noteId, "companies", companyId)
      if (dealId) await link("notes", noteId, "deals", dealId)
      for (const c of report.contacts) await link("notes", noteId, "contacts", c.id)
    }
  }

  // ---------------------------------------------------------------- 5. Tasks
  for (const [index, task] of (input.tasks as TaskInput[]).entries()) {
    const dueMs = task.dueDate ? toEpochMs(task.dueDate) : defaultTaskDue()
    const taskSyncKey = `${syncKey}:task:${index}`

    const alreadyDone = ledger?.taskIds?.[index]
    if (alreadyDone && !isDryRunId(alreadyDone) && !options.force) {
      report.tasks.push({ id: alreadyDone, action: "reused", label: task.subject })
      nextLedger.taskIds.push(alreadyDone)
      continue
    }

    const bySyncKey = await findBySyncKey("tasks", taskSyncKey)
    let existing = bySyncKey.obj
    let taskLookupFailed = bySyncKey.failed
    if (!existing) {
      const found = await client.search(
        "tasks",
        [
          {
            filters: [
              { propertyName: "hs_task_subject", operator: "EQ", value: task.subject },
              { propertyName: "hs_timestamp", operator: "EQ", value: dueMs },
            ],
          },
        ],
        ["hs_task_subject", "hs_timestamp"],
        1,
      )
      if (found.ok) existing = found.data.results?.[0]
      else {
        taskLookupFailed = true
        report.errors.push(`タスク検索失敗: ${found.error}`)
      }
    }

    if (!existing && taskLookupFailed) {
      report.errors.push(abortedByLookup(`タスク「${task.subject}」`))
      continue
    }

    if (existing && !options.force) {
      report.tasks.push({ id: existing.id, action: "reused", label: task.subject })
      nextLedger.taskIds.push(existing.id)
      continue
    }

    const desired = await withSyncKey(
      "tasks",
      taskSyncKey,
      props({
        hs_timestamp: dueMs,
        hs_task_subject: task.subject,
        hs_task_body: task.body,
        hs_task_status: task.status,
        hs_task_priority: task.priority,
        hs_task_type: task.type,
      }),
    )
    const res = await client.create("tasks", desired)
    if (!res.ok) {
      report.errors.push(`タスク作成失敗 (${task.subject}): ${res.error}`)
      continue
    }
    const taskId = res.data.id
    report.tasks.push({ id: taskId, action: "created", label: task.subject })
    nextLedger.taskIds.push(taskId)

    if (companyId) await link("tasks", taskId, "companies", companyId)
    if (dealId) await link("tasks", taskId, "deals", dealId)
    for (const c of report.contacts) await link("tasks", taskId, "contacts", c.id)
  }

  // dry-run の結果を台帳に書くと次回の実書き込みが「同期済み」扱いになるため書かない
  if (!options.dryRun) {
    nextLedger.lastSyncedAt = new Date().toISOString()
    writeLedgerRecord(nextLedger)
  }

  for (const o of [report.company, ...report.contacts, report.deal, report.meeting, report.note, ...report.tasks]) {
    if (o) report.counts[o.action] += 1
  }

  report.finishedAt = new Date().toISOString()
  return report
}

export type { HubSpotClient }
