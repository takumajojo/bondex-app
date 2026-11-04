// Biz-Logi (N01) で1区間の集荷依頼を送る。運営画面のボタンからだけ呼ぶ (Phase 1: 自動送信なし)。
//
// 二重依頼を防ぐ順序:
//   1. 送信前の判定 (締め時刻・取消・番号入力済み・内容が確認画面と同じか)
//   2. DB で依頼を確保 (claim_pickup_request)。区間に有効な依頼があれば送らない
//      (手動 Excel 依頼済み・Biz-Logi 依頼済み・結果不明・要確認・変更対応中のどれでも)
//   3. 確認機能 (printOutFlg=0・無課金) でエラーが無いことを確かめる
//   4. 発行依頼 (printOutFlg=1) を1回だけ送る
//   5. 結果を保存:
//        受付成功 = 処理結果が正常 かつ 発行受付IDあり かつ 問合番号あり (HTTP 200 だけでは成功にしない)
//        明確な失敗 = エラーコードが返った (発行受付IDなし = 課金なし・佐川に登録なし) → failed
//        それ以外 (通信断・タイムアウト・応答不正・保存失敗) → unknown。自動再送も CSV への切替もしない
// 送り状 PDF は取得しない (集荷依頼プランでは佐川が送り状を作る)。

import { createHash, randomUUID } from "node:crypto"
import { BizLogiConfigError, BizLogiTransportError, type BizLogiClient } from "@/lib/bizlogi/client"
import { pastRecommendedTime, pickupRequestClosed, pickupRequestCutoff } from "@/lib/bizlogi/deadline"
import { buildPickupDetail, type PickupLegInput } from "@/lib/bizlogi/pickup"
import { BizLogiValidationError, type ShippingDetail, type ShippingResponse } from "@/lib/bizlogi/shipping"
import { normalizeManageNumber } from "@/lib/bizlogi/text"
import type { OpsAlertInput } from "@/lib/ops-alert"
import { legTrackingNumbers } from "@/lib/shipment-reissue"
import { legRef, type PickupShipmentRow } from "./leg-input"
import { PickupStoreError, type PickupStore } from "./store"
import { bizlogiEligibility } from "./eligibility"
import { pickupSnapshot, snapshotChanges } from "./snapshot"

export interface BizLogiSendDeps {
  store: PickupStore
  client: Pick<BizLogiClient, "checkShipping" | "requestShipping">
  environment: "test" | "production"
  alert: (input: OpsAlertInput) => Promise<unknown>
  /**
   * 問合番号の採番方式 (2026-11-04 SG 正式回答): customer = BondEx が SG 指定の範囲から採番 (sql/078・基本) /
   * system = Biz-Logi が採番。省略は system (以前からの試験のため。アプリは設定 BIZLOGI_NUMBERING の値を渡す)。
   */
  numbering?: "customer" | "system"
  now?: () => Date
  newOwner?: () => string
}

export type PreviewResult =
  | {
      ok: true
      fingerprint: string
      detail: ShippingDetail
      warnings: string[]
      cutoffAt: string | null
    }
  | { ok: false; errors: string[] }

export type SendOutcome =
  | { outcome: "accepted"; requestId: string; shippingNumber: string; printRequestId: string }
  | { outcome: "failed"; requestId: string; errors: string[] }
  | { outcome: "unknown"; requestId: string; reason: string }
  | { outcome: "blocked"; reason: string }

/** 確認画面に出した内容と送信内容が同じかを確かめるための指紋。 */
export function detailFingerprint(detail: ShippingDetail): string {
  return createHash("sha256").update(JSON.stringify(detail)).digest("hex").slice(0, 32)
}

const ymd = (d: Date) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, "")

/** 送信前の判定。区間の状態とローカル検証だけで決まるもの (DB の依頼記録は claim で見る)。 */
function precheck(row: PickupShipmentRow, now: Date): string[] {
  const errors: string[] = []
  const elig = bizlogiEligibility(row)
  if (!elig.ok) errors.push(elig.reason)
  if (row.status === "cancelled") errors.push("この区間は取消済みです")
  if (legTrackingNumbers(row).length > 0) errors.push("佐川の問合番号が入力済みです (佐川側に依頼があります)")
  if (pickupRequestClosed(row.shipment_date, now)) {
    errors.push("集荷依頼の締め (集荷前日 20:00) を過ぎています。世田谷営業所へ相談してください")
  }
  return errors
}

function buildDetail(input: PickupLegInput): { detail?: ShippingDetail; errors: string[] } {
  const built = buildPickupDetail(input)
  if (!built.ok) return { errors: built.issues.map((i) => `${i.field}: ${i.message}`) }
  return { detail: built.detail, errors: [] }
}

function responseErrors(res: ShippingResponse): string[] {
  const all = [res.result, ...res.details.flatMap((d) => d.resultCodes)]
  return all.filter((c) => c.severity === "error").map((c) => `${c.code} ${c.message}`)
}

function responseCodes(res: ShippingResponse): string[] {
  return [res.result.code, ...res.details.flatMap((d) => d.resultCodes.map((c) => c.code))]
}

// ── 管理番号の重複 (E1-0002・採番方式によらない)
// 仕様書 5.2 は「管理番号が重複」とだけあり、過去の依頼まで見るのか (対象期間) は分からない。
// 二重依頼を防ぐ保証としては扱わない (防止は DB の一意制約・結果不明での停止・Excel との相互排他で行う)。
// 返ってきたら、前の依頼が佐川に届いている可能性があるので、失敗にして送り直さず「結果不明」で止める。
const MANAGE_NUMBER_DUPLICATE = "E1-0002"

// ── 顧客側採番 (オプション・sql/078・BIZLOGI_NUMBERING=customer のときだけ)
/** 佐川の応答のうち、顧客側採番の問合番号に関するコード (5.2 処理結果コード)。番号を送ったときだけ見る。 */
const NUMBER_DUPLICATE = ["E1-0206", "E2-0038"] // 番号の重複・90日以内の再利用 → 成功でも失敗でもない (結果不明として運営が確認)
const NUMBER_RETIRE = ["E1-0207", "E1-0204", "E1-0205"] // 範囲外・桁数・値なし → 佐川に登録なし。番号を使わなくして運営へ
const NUMBER_NOT_ENABLED = "E2-0036" // 顧客コードで顧客側採番が使えない → 設定の誤り (失敗・番号はそのまま)

/** 前の依頼が届いている可能性を示すコード (結果不明にする)。顧客側採番のコードは番号を送ったときだけ。 */
function duplicateHit(res: ShippingResponse, detail: ShippingDetail): string | null {
  const codes = codesOf(res)
  if (codes.includes(MANAGE_NUMBER_DUPLICATE)) return `${MANAGE_NUMBER_DUPLICATE} (管理番号の重複)`
  if (detail.shippingNumber) {
    const hit = codes.find((c) => NUMBER_DUPLICATE.includes(c))
    if (hit) return `${hit} (問合番号 ${detail.shippingNumber} の重複)`
  }
  return null
}

export function numberReasonJa(reason: string): string {
  switch (reason) {
    case "no_number_range":
      return "SG 指定の問合番号の範囲が未登録のため、Biz-Logi では送れません (範囲の受領後に登録します。推測の番号は使いません)"
    case "number_range_exhausted":
      return "SG 指定の問合番号の範囲を使い切りました。SG に新しい範囲を依頼して登録してください"
    case "leg_not_found":
      return "区間が見つかりません"
    default:
      return `問合番号を採番できませんでした (${reason})`
  }
}

/** 顧客側採番なら、区間の番号を電文に入れる。番号が取れなければ送らない (理由を返す)。 */
async function attachNumber(
  row: PickupShipmentRow,
  detail: ShippingDetail,
  deps: { numbering?: "customer" | "system"; environment?: "test" | "production"; store?: PickupStore },
): Promise<string | null> {
  if ((deps.numbering ?? "system") !== "customer") return null
  if (!deps.store?.legNumber || !deps.environment) return "顧客側採番の設定がありません (採番の仕組みに接続できません)"
  let r: { ok: boolean; number: string | null; reason: string }
  try {
    r = await deps.store.legNumber(row.id, deps.environment)
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
  if (!r.ok || !r.number) return numberReasonJa(r.reason)
  detail.shippingNumber = r.number
  return null
}

const codesOf = (res: ShippingResponse) => [res.result, ...res.details.flatMap((d) => d.resultCodes)].map((c) => c.code)

/** 確認機能 (無課金) で送信内容を検証し、運営に見せる。採番 (台帳への記録) のほか DB には何も書かない。 */
export async function previewBizLogiPickup(
  row: PickupShipmentRow,
  input: PickupLegInput,
  deps: Pick<BizLogiSendDeps, "client" | "now" | "numbering"> & { store?: PickupStore; environment?: "test" | "production" },
): Promise<PreviewResult> {
  const now = deps.now?.() ?? new Date()
  const errors = precheck(row, now)
  const { detail, errors: buildErrors } = buildDetail(input)
  errors.push(...buildErrors)
  if (errors.length || !detail) return { ok: false, errors }
  const numErr = await attachNumber(row, detail, deps)
  if (numErr) return { ok: false, errors: [numErr] }
  let res: ShippingResponse
  try {
    res = await deps.client.checkShipping([detail], ymd(now))
  } catch (e) {
    return { ok: false, errors: [`確認機能の通信に失敗しました (送信はしていません): ${e instanceof Error ? e.message : String(e)}`] }
  }
  const resErrors = responseErrors(res)
  const dupPreview = duplicateHit(res, detail)
  if (dupPreview) {
    return { ok: false, errors: [`${dupPreview}。前の依頼が佐川に届いている可能性があるため送りません。利用実績・追跡・世田谷営業所で確かめてください`] }
  }
  if (resErrors.length) return { ok: false, errors: resErrors }
  const warnings = [res.result, ...res.details.flatMap((d) => d.resultCodes)]
    .filter((c) => c.severity === "warning")
    .map((c) => `${c.code} ${c.message}`)
  // 19:00 (送信目標) 以降も送信はできる (正式な締めは 20:00)。結果不明時に確認が間に合わない恐れだけを知らせる。
  if (pastRecommendedTime(row.shipment_date, now)) {
    warnings.unshift(
      "社内の送信目標 (集荷前日 19:00) を過ぎています。送信はできますが、結果不明になった場合は締め (20:00) までに世田谷営業所へ確認できないことがあります (その場合は再依頼せず SOP に従う)",
    )
  }
  return { ok: true, fingerprint: detailFingerprint(detail), detail, warnings, cutoffAt: pickupRequestCutoff(row.shipment_date)?.toISOString() ?? null }
}

export async function sendBizLogiPickup(
  row: PickupShipmentRow,
  input: PickupLegInput,
  opts: { actor: string; expectedFingerprint: string; note?: string | null },
  deps: BizLogiSendDeps,
): Promise<SendOutcome> {
  const now = deps.now?.() ?? new Date()
  const ref = legRef(row)
  const pre = precheck(row, now)
  if (pre.length) return { outcome: "blocked", reason: pre.join(" / ") }
  const { detail, errors } = buildDetail(input)
  if (!detail) return { outcome: "blocked", reason: errors.join(" / ") }
  // 顧客側採番: 確認画面と同じ番号 (区間に割り当て済み) を入れる。取れなければ送らない
  const numErr = await attachNumber(row, detail, deps)
  if (numErr) return { outcome: "blocked", reason: numErr }
  if (detailFingerprint(detail) !== opts.expectedFingerprint) {
    return { outcome: "blocked", reason: "確認画面のあとで送信内容が変わりました。もう一度確認してから送信してください" }
  }

  const owner = deps.newOwner?.() ?? randomUUID()
  // 2. 確保。ここで失敗したら何も送らない。
  let claim
  try {
    claim = await deps.store.claim({
      shipmentId: row.id,
      channel: "bizlogi",
      environment: deps.environment,
      manageNumber: normalizeManageNumber(input.legRef),
      pieceCount: input.suitcaseCount,
      pickupDate: row.shipment_date,
      actor: opts.actor,
      owner,
      note: opts.note ?? null,
      snapshot: pickupSnapshot(row),
    })
  } catch (e) {
    return { outcome: "blocked", reason: e instanceof Error ? e.message : String(e) }
  }
  if (!claim.claimed || !claim.requestId) return { outcome: "blocked", reason: claimReasonJa(claim.reason) }
  const requestId = claim.requestId

  // 2b. 確保した時点の区間 (DB が行ロック中に作った依頼内容) と、電文の元にした内容が同じか。
  // 読み取りから確保までの間に変更が入っていたら送らない。確保の後は DB のトリガーが区間の書き換えを止めるので、
  // ここで一致すれば、佐川へ送る電文と DB の依頼内容は一致したままになる (2026-11-04 段階A)。
  const drift = snapshotChanges(claim.snapshot, row)
  if (claim.snapshot == null || drift.length > 0) {
    const why = claim.snapshot == null ? "確保した時点の依頼内容を確認できません" : `確認のあとで区間が変わりました (${drift.join("・")})`
    try {
      await deps.store.transition({ requestId, from: ["sending"], to: "void", owner, note: `送信前に中止: ${why}` })
    } catch {
      // 送信していないので、記録が残っても「送信中」の監視が拾う (外部へは何も送っていない)
    }
    return { outcome: "blocked", reason: `${why}。もう一度確認してから送信してください` }
  }

  // 2c. 顧客側採番: 送る番号を依頼の記録に書く (佐川へ送る前)。書けなければ送らない。
  //     システム採番では何も書かない (番号は佐川の正常応答から受け取って保存する)。
  if (detail.shippingNumber) {
    let set = false
    try {
      set = (await deps.store.setAssignedNumber?.(requestId, detail.shippingNumber)) === true
    } catch {
      set = false
    }
    if (!set) {
      try {
        await deps.store.transition({ requestId, from: ["sending"], to: "void", owner, note: "送信前に中止: 送る問合番号を記録できません" })
      } catch {
        // 送信していない。記録が残っても「送信中」の監視が拾う
      }
      return { outcome: "blocked", reason: "送る問合番号を記録できませんでした (佐川へは送っていません)。もう一度確認してから送信してください" }
    }
  }

  const finish = async (to: "failed" | "unknown", fields: { error: string; resultCodes?: string[] }) => {
    try {
      const t = await deps.store.transition({ requestId, from: ["sending"], to, owner, error: fields.error, resultCodes: fields.resultCodes ?? null })
      return t.applied
    } catch {
      return false
    }
  }

  // 3. 確認機能 (無課金・佐川に登録されない)。ここでの失敗は「送っていない」ので failed。
  let check: ShippingResponse
  try {
    check = await deps.client.checkShipping([detail], ymd(now))
  } catch (e) {
    const msg = `確認機能の通信に失敗 (発行依頼は未送信): ${e instanceof Error ? e.message : String(e)}`
    await finish("failed", { error: msg })
    return { outcome: "failed", requestId, errors: [msg] }
  }
  const checkErrors = responseErrors(check)
  // 重複 (E1-0002 管理番号 / 顧客側採番なら E1-0206・E2-0038 問合番号) = 前の依頼が届いていた可能性がある。
  // 失敗扱いで送り直すと二重の集荷になりうる。成功でも失敗でもなく「結果不明」にして運営が確かめる (自動で再送しない)。
  const dupCheck = duplicateHit(check, detail)
  if (dupCheck) {
    const reason = `確認機能で ${dupCheck}。前の依頼が届いている可能性があるため発行していません`
    await finish("unknown", { error: reason, resultCodes: responseCodes(check) })
    await alertUnknown(deps, ref, requestId, reason)
    return { outcome: "unknown", requestId, reason }
  }
  if (checkErrors.length) {
    await retireIfNumberRejected(deps, detail, check, "確認機能")
    await finish("failed", { error: checkErrors.join(" / "), resultCodes: responseCodes(check) })
    return { outcome: "failed", requestId, errors: checkErrors }
  }

  // 4. 発行依頼。1回だけ送る。
  let res: ShippingResponse
  try {
    res = await deps.client.requestShipping([detail], ymd(now))
  } catch (e) {
    if (e instanceof BizLogiConfigError || e instanceof BizLogiValidationError) {
      // 設定・電文の検証で送信前に止まった (通信していない)
      await finish("failed", { error: e.message })
      return { outcome: "failed", requestId, errors: [e.message] }
    }
    const reason =
      e instanceof BizLogiTransportError
        ? `発行依頼の通信が完了しませんでした (${e.message})`
        : `発行依頼の応答を処理できませんでした (${e instanceof Error ? e.message : String(e)})`
    await finish("unknown", { error: reason })
    await alertUnknown(deps, ref, requestId, reason)
    return { outcome: "unknown", requestId, reason }
  }

  const resErrors = responseErrors(res)
  const number = res.details[0]?.shippingNumbers[0] ?? null
  const dupIssue = duplicateHit(res, detail)
  if (dupIssue) {
    const reason = `発行依頼で ${dupIssue}。成功とは扱いません。前の依頼が届いている可能性があるので、利用実績・追跡・世田谷営業所で確かめてから記録してください`
    await finish("unknown", { error: reason, resultCodes: responseCodes(res) })
    await alertUnknown(deps, ref, requestId, reason)
    return { outcome: "unknown", requestId, reason }
  }
  // 顧客側採番: 佐川が返した番号が、送った番号と同じでなければ結果不明 (どちらの番号で登録されたか分からない)
  if (detail.shippingNumber && number && number !== detail.shippingNumber) {
    const reason = `佐川の応答の問合番号 (${number}) が送った番号 (${detail.shippingNumber}) と違います。どちらで登録されたか確かめてください`
    await finish("unknown", { error: reason, resultCodes: responseCodes(res) })
    await alertUnknown(deps, ref, requestId, reason)
    return { outcome: "unknown", requestId, reason }
  }
  if (res.ok && res.printRequestId && number) {
    try {
      const t = await deps.store.transition({
        requestId,
        from: ["sending"],
        to: "accepted",
        owner,
        shippingNumber: number,
        printRequestId: res.printRequestId,
        resultCodes: responseCodes(res),
      })
      if (t.applied) return { outcome: "accepted", requestId, shippingNumber: number, printRequestId: res.printRequestId }
      throw new PickupStoreError(`状態更新が適用されませんでした (${t.reason})`)
    } catch (e) {
      // 佐川は受け付けたが BondEx に保存できなかった。番号を必ず運営へ渡す。依頼は送信中のまま残り、再送できない。
      const reason = `佐川は受付済み (問合番号 ${number} / 発行受付ID ${res.printRequestId}) ですが、BondEx への保存に失敗しました: ${e instanceof Error ? e.message : String(e)}`
      await finish("unknown", { error: reason, resultCodes: responseCodes(res) })
      await alertUnknown(deps, ref, requestId, reason)
      return { outcome: "unknown", requestId, reason }
    }
  }
  if (resErrors.length && !res.printRequestId) {
    // 明確な失敗: エラーコードがあり発行受付IDが無い = 課金なし・佐川に登録なし
    await retireIfNumberRejected(deps, detail, res, "発行依頼")
    await finish("failed", { error: resErrors.join(" / "), resultCodes: responseCodes(res) })
    return { outcome: "failed", requestId, errors: resErrors }
  }
  const reason = `発行依頼の応答が想定外です (結果 ${res.result.code}・発行受付ID ${res.printRequestId ?? "なし"}・問合番号 ${number ?? "なし"})`
  await finish("unknown", { error: reason, resultCodes: responseCodes(res) })
  await alertUnknown(deps, ref, requestId, reason)
  return { outcome: "unknown", requestId, reason }
}

/** 範囲外・桁数・値なし (E1-0207/0204/0205) で佐川が番号を受け付けなかったら、その番号を使わなくして運営へ知らせる。 */
async function retireIfNumberRejected(deps: BizLogiSendDeps, detail: ShippingDetail, res: ShippingResponse, stage: string): Promise<void> {
  if (!detail.shippingNumber) return
  if (codesOf(res).includes(NUMBER_NOT_ENABLED)) {
    // 顧客コードで顧客側採番が使えない = 設定の誤り。番号は使わなくしない (佐川に登録なし・送れる状態になれば同じ番号で送る)
    try {
      await deps.alert({
        subject: `【要確認】Biz-Logi で顧客側採番が使えません (${NUMBER_NOT_ENABLED})`,
        lines: [
          `番号: ${detail.shippingNumber} (${stage})`,
          "この顧客コードでは顧客側採番が有効になっていません。SG に確かめるか、BIZLOGI_NUMBERING を外してシステム採番 (標準) に戻してください。",
        ],
      })
    } catch {
      /* 通知の失敗は送信の結果を変えない */
    }
    return
  }
  const hit = codesOf(res).find((c) => NUMBER_RETIRE.includes(c))
  if (!hit) return
  try {
    await deps.store.retireNumber?.(detail.shippingNumber, `${stage}で ${hit}`)
  } catch {
    // 使わなくする記録に失敗しても、送信は失敗として止まっている (次の送信の確認機能でまた止まる)
  }
  try {
    await deps.alert({
      subject: `【要確認】Biz-Logi の問合番号が受け付けられません (${hit})`,
      lines: [
        `番号: ${detail.shippingNumber} (${stage})`,
        `佐川の応答: ${hit}${hit === "E1-0207" ? " 利用可能問合番号範囲ではありません" : ""}`,
        "SG 指定の番号範囲の登録 (pickup_number_ranges) が正しいかを確かめてください。この番号は使わないようにしました。",
      ],
    })
  } catch {
    /* 通知の失敗は送信の結果を変えない */
  }
}

async function alertUnknown(deps: BizLogiSendDeps, ref: string, requestId: string, reason: string): Promise<void> {
  try {
    await deps.alert({
      subject: `【要確認】Biz-Logi 集荷依頼の結果不明: ${ref}`,
      lines: [
        `区間: ${ref}`,
        `接続先: ${deps.environment === "production" ? "本番" : "テスト環境"}`,
        `内容: ${reason}`,
        "",
        "佐川側で受け付けられたか分からないため、自動では再送していません。CSV への切り替えもしていません。",
        "世田谷営業所 (またはSGシステム) に受付の有無を確認し、運営画面の「佐川へ集荷依頼」から結果を記録してください。",
        `記録ID: ${requestId}`,
      ],
    })
  } catch (e) {
    console.error("[pickup-request] alert failed", e instanceof Error ? e.message : e)
  }
}

export function claimReasonJa(reason: string): string {
  switch (reason) {
    case "live_request_exists":
      return "この区間には既に有効な集荷依頼があります (依頼済み・送信中・結果不明・要確認・変更対応中のいずれか)"
    case "shipment_cancelled":
      return "この区間は取消済みです"
    case "tracking_number_exists":
      return "佐川の問合番号が入力済みです"
    case "too_many_pieces":
      return "20個以上のため Biz-Logi では送りません (BondEx の当面の運用ルール。佐川 API の上限ではありません)。佐川へ事前連絡のうえ手動 (Excel) で手配してください"
    case "group_booking":
      return "団体の予約は Biz-Logi では送りません。手動 (Excel) で手配してください"
    case "shipment_not_found":
      return "区間が見つかりません"
    case "claims_paused":
      return "集荷依頼の記録・送信は一時停止中です (本番移行中または緊急停止)。世田谷営業所への依頼は従来どおり手作業で行い、再開後に記録してください"
    case "pickup_lock_disabled":
      return "区間のロックが無効のため、集荷依頼の記録・送信を止めています。BondEx の管理者に連絡してください"
    default:
      return `集荷依頼を確保できませんでした (${reason})`
  }
}
