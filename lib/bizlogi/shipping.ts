// 送り状発行API (仕様書 4.1) のリクエスト構築・事前検証・レスポンス解析。
//
// BondEx の使い方: 送り状は佐川が作りドライバーが持参する運用のため、このAPIは
// 「集荷依頼情報 (shukaIraiData) を付けて佐川の基幹システムへ集荷依頼を届け、
// 問合番号を受け取る」目的で使う。納品書・コンビニ受取・代引・重量確定は扱わない。
//
// 事前検証 (validateShippingDetail) は、佐川側で弾かれる内容を送信前に日本語で返す。
// 発行依頼は問合番号単位で課金されるため、通らないと分かっている電文は送らない。

import { buildXml, cdata, child, childText, children, parseXml, type XmlElement } from "./xml"
import { charLength, isDigits, isHankaku, todayJstYmd, toYmd, ymdDiffDays } from "./text"
import { describeResultCode, isSuccess, type ResultCodeInfo } from "./codes"

/** 便種コード (5.1)。BondEx は陸便のみ使う。 */
export const BINSYU_RIKUBIN = "000"

/** 配達時間指定コード (5.1)。 */
export const SHITEI_TIME_CODES = ["00", "01", "12", "14", "16", "18", "19", "04"] as const
export type ShiteiTimeCode = (typeof SHITEI_TIME_CODES)[number]

/** 集荷依頼時間指定コード (5.1): 00=指定なし 09=9-12時 12=12-15時 15=15-18時 18=18-21時。 */
export const SHUKA_TIME_CODES = ["00", "09", "12", "15", "18"] as const
export type ShukaTimeCode = (typeof SHUKA_TIME_CODES)[number]

/** 重量コード (5.1): サイズ60〜160。スーツケースは 160 (30kg)。 */
export const WEIGHT_CODES = ["60", "80", "100", "140", "160"] as const
export type WeightCode = (typeof WEIGHT_CODES)[number]

/** BondEx の配達時間帯 (lib/carrier.ts の佐川 timeSlots) → Biz-Logi 配達時間指定コード。 */
export const BONDEX_SLOT_TO_SHITEI_TIME: Record<string, ShiteiTimeCode> = {
  "not-specified": "00",
  "before-noon": "01",
  "12-14": "12",
  "14-16": "14",
  "16-18": "16",
  "18-20": "18",
  "18-21": "04",
  "19-21": "19",
}

export interface ShukaIraiData {
  /** 集荷依頼主コード = 集荷依頼を利用する佐川との契約コード (12桁・チェックデジット込み)。 */
  shukaIraiCode: string
  /** 集荷依頼指定日 (yyyyMMdd)。翌日以降・30日以内。 */
  shukaIraiShiteiDate: string
  shukaIraiShiteiTimeCode: ShukaTimeCode
  /** 伝票印字区分1〜3。意味は佐川の別途資料 (未受領) による。未指定なら佐川側の登録値。 */
  denpyoInjiKbn1?: string
  denpyoInjiKbn2?: string
  denpyoInjiKbn3?: string
  /** 送り状お届日 (yyyyMMdd)。指定するなら 送信日 < 送り状お届日 < 集荷依頼指定日。 */
  denpyoOtodokeDate?: string
}

export interface ShippingDetail {
  /** 配送個口数 (1〜99)。 */
  haisoKosu: number
  /** 管理番号: 利用者側で一意な半角英数字16桁以内。集荷依頼時は左15桁が佐川基幹へ連携される。 */
  userManageNumber: string
  /** 顧客コード = 佐川との契約コード (12桁・チェックデジット込み)。 */
  kokyakuCode: string
  /** 届先住所1〜3 (各25文字)。 */
  otodokeAdd: string[]
  /** 届先氏名1〜2 (各25文字)。 */
  otodokeNm: string[]
  otodokeYubin: string
  otodokeTel: string
  /**
   * 依頼主 (集荷依頼では実際の集荷先 = 発送元ホテル)。指定すると iraiPrintFlg=1 で送る。
   * 省略時は iraiPrintFlg=0 (顧客コードに紐づく出荷場) になる。
   */
  irai?: { add: string[]; nm: string[]; yubin: string; tel: string }
  /** 発送日 (yyyyMMdd)。 */
  shippingDate?: string
  /** 記事1〜6 (各32文字。集荷依頼では17文字までが佐川基幹へ連携される)。 */
  kiji?: string[]
  binsyuCode?: string
  /** 配達指定日 (yyyyMMdd)。 */
  shiteiDate?: string
  shiteiTimeCode?: ShiteiTimeCode
  weight1?: WeightCode
  /** 元着コード: 0=元払い (既定) / 1=着払い。 */
  motoChakuCode?: "0" | "1"
  shukaIrai?: ShukaIraiData
  /**
   * 顧客指定問合番号 (仕様書 p.35 1-9-1-49 shippingNumber・12桁・チェックデジット込み)。
   * 問合番号採番区分 (shippingNumberType) が 1 のとき必須。BondEx が SG 指定の範囲から採番した番号 (sql/078)。
   */
  shippingNumber?: string
}

export interface ShippingRequestOptions {
  customerId: string
  loginPassword: string
  /** false=確認機能 (エラー精査のみ) / true=発行依頼 (問合番号が採番され課金対象)。 */
  issue: boolean
  /** 送り状コード (仕様書 5.1: A501/A401/L02/D03。JOJO は SGシステム指定の N01)。発行依頼では必須。 */
  okuriCode?: string
  /** 出力レベル: "000"=エラー＆ワーニング精査 (既定) / "900"=エラーのみ。 */
  outputLevel?: "000" | "900"
  /** 下敷画像表示フラグ: 1=表示 (既定・導入チェックシートの指定) / 0=非表示。省略すると佐川側は非表示扱い。 */
  backLayerFlg?: 0 | 1
  /**
   * 問合番号採番区分 (仕様書 p.28 1-7 shippingNumberType): 0/省略=システム採番 / 1=顧客指定採番 (2026-11-04 SG 回答・BondEx の基本)。
   * 1 のときは全明細に shippingNumber が必要。2 (発行済み番号で再発行) は使わない。
   */
  shippingNumberType?: 0 | 1
  details: ShippingDetail[]
}

/** 佐川の12桁の問合番号のチェックデジット (先頭11桁を 7 で割った余り)。sql/078 sagawa_check_digit_ok と同じ。 */
export function sagawaCheckDigitOk(n: string): boolean {
  if (!/^\d{12}$/.test(n)) return false
  return Number(BigInt(n.slice(0, 11)) % BigInt(7)) === Number(n[11])
}

export interface ValidationIssue {
  /** 対象のタグ名 (例: "otodokeAdd2")。 */
  field: string
  message: string
}

const ADDR_LEN = 25
const NAME_LEN = 25
const KIJI_LEN = 32
const KIJI_LEN_PICKUP = 17
const MAX_LEAD_DAYS = 30

function checkLines(issues: ValidationIssue[], tag: string, label: string, lines: string[], maxLines: number, width: number, required: boolean) {
  if (required && !lines[0]?.trim()) issues.push({ field: `${tag}1`, message: `${label}1 が空です` })
  if (lines.length > maxLines) issues.push({ field: `${tag}${maxLines + 1}`, message: `${label} は ${maxLines} 行までです` })
  lines.slice(0, maxLines).forEach((l, idx) => {
    if (charLength(l) > width) {
      issues.push({ field: `${tag}${idx + 1}`, message: `${label}${idx + 1} が ${width} 文字を超えています (${charLength(l)} 文字)` })
    }
  })
}

function checkCode12(issues: ValidationIssue[], field: string, label: string, v: string) {
  if (!isDigits(v) || v.length !== 12) {
    issues.push({ field, message: `${label} は半角数字12桁 (チェックデジット込み) で指定します (現在: ${v.length} 桁)` })
  }
}

/**
 * 1件の出荷情報を佐川へ送る前に検証する。空配列なら送ってよい。
 * today は日本時間の yyyyMMdd (テスト用に差し替え可能)。
 */
export function validateShippingDetail(d: ShippingDetail, today: string = todayJstYmd()): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const pickup = !!d.shukaIrai

  if (!Number.isInteger(d.haisoKosu) || d.haisoKosu < 1 || d.haisoKosu > 99) {
    issues.push({ field: "haisoKosu", message: "配送個口数は 1〜99 の整数で指定します" })
  }

  // 集荷依頼時は左15桁しか佐川基幹へ連携されない。16桁目で別予約と衝突しないよう15桁に制限する。
  const manageMax = pickup ? 15 : 16
  if (!d.userManageNumber || !/^[0-9A-Za-z]+$/.test(d.userManageNumber)) {
    issues.push({ field: "userManageNumber", message: "管理番号は半角英数字のみで指定します (ハイフン等の記号は不可)" })
  } else if (d.userManageNumber.length > manageMax) {
    issues.push({ field: "userManageNumber", message: `管理番号は ${manageMax} 桁以内で指定します` })
  }

  checkCode12(issues, "kokyakuCode", "顧客コード", d.kokyakuCode)

  checkLines(issues, "otodokeAdd", "届先住所", d.otodokeAdd, 3, ADDR_LEN, true)
  checkLines(issues, "otodokeNm", "届先氏名", d.otodokeNm, 2, NAME_LEN, true)
  if (!isDigits(d.otodokeYubin) || d.otodokeYubin.length !== 7) {
    issues.push({ field: "otodokeYubin", message: "届先郵便番号はハイフン無しの半角数字7桁で指定します" })
  }
  if (!/^[0-9-]{1,20}$/.test(d.otodokeTel)) {
    issues.push({ field: "otodokeTel", message: "届先電話番号は半角の数字とハイフンのみ・20桁以内で指定します" })
  }

  if (d.irai) {
    checkLines(issues, "iraiAdd", "依頼主住所", d.irai.add, 3, ADDR_LEN, true)
    checkLines(issues, "iraiNm", "依頼主氏名", d.irai.nm, 2, NAME_LEN, true)
    if (!isDigits(d.irai.yubin) || d.irai.yubin.length !== 7) {
      issues.push({ field: "iraiYubin", message: "依頼主郵便番号はハイフン無しの半角数字7桁で指定します" })
    }
    if (!/^[0-9-]{1,20}$/.test(d.irai.tel)) {
      issues.push({ field: "iraiTel", message: "依頼主電話番号は半角の数字とハイフンのみ・20桁以内で指定します" })
    }
  } else if (pickup) {
    issues.push({ field: "iraiPrintFlg", message: "集荷依頼では依頼主 (実際の集荷先) の住所・氏名・郵便番号・電話が必要です" })
  }

  const kiji = d.kiji ?? []
  if (kiji.length > 6) issues.push({ field: "kiji7", message: "記事は6行までです" })
  const kijiMax = pickup ? KIJI_LEN_PICKUP : KIJI_LEN
  kiji.slice(0, 6).forEach((k, idx) => {
    if (charLength(k) > kijiMax) {
      issues.push({
        field: `kiji${idx + 1}`,
        message: pickup
          ? `記事${idx + 1} が ${kijiMax} 文字を超えています (集荷依頼で佐川へ連携されるのは ${kijiMax} 文字まで)`
          : `記事${idx + 1} が ${kijiMax} 文字を超えています`,
      })
    }
  })

  if (d.binsyuCode !== undefined && !/^\d{3}$/.test(d.binsyuCode)) {
    issues.push({ field: "binsyuCode", message: "便種コードは半角数字3桁で指定します" })
  }
  if (d.shiteiTimeCode !== undefined && !SHITEI_TIME_CODES.includes(d.shiteiTimeCode)) {
    issues.push({ field: "shiteiTimeCode", message: "配達時間指定コードが定義外です" })
  }
  if (d.weight1 !== undefined && !WEIGHT_CODES.includes(d.weight1)) {
    issues.push({ field: "weight1", message: "重量コードが定義外です" })
  }

  const dateField = (field: string, label: string, v: string | undefined): string | null => {
    if (v === undefined) return null
    if (!toYmd(v) || v.length !== 8) {
      issues.push({ field, message: `${label} は yyyyMMdd で指定します` })
      return null
    }
    return v
  }

  const shippingDate = dateField("shippingDate", "発送日", d.shippingDate)
  if (shippingDate) {
    const diff = ymdDiffDays(today, shippingDate)
    if (diff < 0) issues.push({ field: "shippingDate", message: "発送日が過去日付です" })
    if (diff > MAX_LEAD_DAYS) issues.push({ field: "shippingDate", message: `発送日が ${MAX_LEAD_DAYS} 日を超える未来日付です` })
  }

  const shiteiDate = dateField("shiteiDate", "配達指定日", d.shiteiDate)
  if (shiteiDate) {
    const base = shippingDate ?? today
    const diff = ymdDiffDays(base, shiteiDate)
    if (diff < 1) issues.push({ field: "shiteiDate", message: "配達指定日は発送日の翌日以降で指定します" })
    if (diff > MAX_LEAD_DAYS) issues.push({ field: "shiteiDate", message: `配達指定日が発送日から ${MAX_LEAD_DAYS} 日を超えています` })
  }

  if (d.shukaIrai) {
    const s = d.shukaIrai
    checkCode12(issues, "shukaIraiCode", "集荷依頼主コード", s.shukaIraiCode)
    if (!SHUKA_TIME_CODES.includes(s.shukaIraiShiteiTimeCode)) {
      issues.push({ field: "shukaIraiShiteiTimeCode", message: "集荷依頼時間指定コードが定義外です" })
    }
    const pickupDate = dateField("shukaIraiShiteiDate", "集荷依頼指定日", s.shukaIraiShiteiDate)
    if (pickupDate) {
      const diff = ymdDiffDays(today, pickupDate)
      if (diff < 1) issues.push({ field: "shukaIraiShiteiDate", message: "集荷依頼指定日は送信日の翌日以降で指定します (当日の集荷依頼は不可)" })
      if (diff > MAX_LEAD_DAYS) issues.push({ field: "shukaIraiShiteiDate", message: `集荷依頼指定日が ${MAX_LEAD_DAYS} 日を超える未来日付です` })
    }
    const otodoke = dateField("shukaIraiDenpyoOtodokeDate", "送り状お届日", s.denpyoOtodokeDate)
    if (otodoke) {
      if (ymdDiffDays(today, otodoke) < 1) {
        issues.push({ field: "shukaIraiDenpyoOtodokeDate", message: "送り状お届日は送信日より後の日付で指定します" })
      }
      if (pickupDate && ymdDiffDays(otodoke, pickupDate) < 1) {
        issues.push({ field: "shukaIraiDenpyoOtodokeDate", message: "送り状お届日は集荷依頼指定日より前の日付で指定します" })
      }
    }
    for (const [field, v] of [
      ["shukaIraiDenpyoInjiKbn1", s.denpyoInjiKbn1],
      ["shukaIraiDenpyoInjiKbn2", s.denpyoInjiKbn2],
      ["shukaIraiDenpyoInjiKbn3", s.denpyoInjiKbn3],
    ] as const) {
      if (v !== undefined && !(isHankaku(v) && v.length === 1)) {
        issues.push({ field, message: "伝票印字区分は半角1桁で指定します" })
      }
    }
  }

  return issues
}

function numbered(tag: string, lines: string[], count: number): XmlElement[] {
  return Array.from({ length: count }, (_, i): XmlElement => [`${tag}${i + 1}`, lines[i]?.trim() || undefined])
}

function detailElement(d: ShippingDetail): XmlElement {
  const s = d.shukaIrai
  // 要素の並びは仕様書 4.1 の項番順 (1-9-1-1 〜 1-9-1-56)。
  return [
    "printDataDetail",
    [
      ["haisoKosu", d.haisoKosu],
      ["userManageNumber", d.userManageNumber],
      ["kokyakuCode", d.kokyakuCode],
      ...numbered("otodokeAdd", d.otodokeAdd, 3),
      ...numbered("otodokeNm", d.otodokeNm, 2),
      ["otodokeYubin", d.otodokeYubin],
      ["otodokeTel", d.otodokeTel],
      ["iraiPrintFlg", d.irai ? 1 : 0],
      ...(d.irai
        ? ([
            ...numbered("iraiAdd", d.irai.add, 3),
            ...numbered("iraiNm", d.irai.nm, 2),
            ["iraiYubin", d.irai.yubin],
            ["iraiTel", d.irai.tel],
          ] as XmlElement[])
        : []),
      ["shippingDate", d.shippingDate],
      ...numbered("kiji", d.kiji ?? [], 6),
      ["binsyuCode", d.binsyuCode ?? BINSYU_RIKUBIN],
      ["daibikiFlg", 0],
      ["shiteiDate", d.shiteiDate],
      ["shiteiTimeCode", d.shiteiTimeCode],
      ["weight1", d.weight1],
      ["motoChakuCode", d.motoChakuCode],
      [
        "shukaIraiData",
        s
          ? [
              ["shukaIraiCode", s.shukaIraiCode],
              ["shukaIraiShiteiDate", s.shukaIraiShiteiDate],
              ["shukaIraiShiteiTimeCode", s.shukaIraiShiteiTimeCode],
              ["shukaIraiDenpyoInjiKbn1", s.denpyoInjiKbn1],
              ["shukaIraiDenpyoInjiKbn2", s.denpyoInjiKbn2],
              ["shukaIraiDenpyoInjiKbn3", s.denpyoInjiKbn3],
              ["shukaIraiDenpyoOtodokeDate", s.denpyoOtodokeDate],
            ]
          : [],
      ],
      // 1-9-1-49 顧客指定問合番号 (集荷依頼情報 1-9-1-48 の後・配送コメント 1-9-1-50 の前)
      ["shippingNumber", d.shippingNumber],
    ],
  ]
}

export class BizLogiValidationError extends Error {
  constructor(public readonly issues: Array<ValidationIssue & { userManageNumber: string }>) {
    super(`Biz-Logi 送信前検証エラー: ${issues.map((i) => `[${i.userManageNumber}] ${i.field}: ${i.message}`).join(" / ")}`)
  }
}

/** 送り状発行リクエスト XML を構築する。事前検証に通らなければ BizLogiValidationError。 */
export function buildShippingRequestXml(o: ShippingRequestOptions, today: string = todayJstYmd()): string {
  const issues: Array<ValidationIssue & { userManageNumber: string }> = []
  if (!o.details.length) issues.push({ userManageNumber: "-", field: "printDataList", message: "出荷情報が1件もありません" })
  if (o.issue && !o.okuriCode) issues.push({ userManageNumber: "-", field: "okuriCode", message: "発行依頼では送り状コードが必須です" })
  const seen = new Set<string>()
  for (const d of o.details) {
    // 佐川側でも重複は E1-0002 で弾かれる。同一電文内の重複は送る前に止める。
    if (seen.has(d.userManageNumber)) {
      issues.push({ userManageNumber: d.userManageNumber, field: "userManageNumber", message: "同じ管理番号が電文内に複数あります" })
    }
    seen.add(d.userManageNumber)
    for (const i of validateShippingDetail(d, today)) issues.push({ ...i, userManageNumber: d.userManageNumber })
    // 顧客側採番: 区分 1 なら全明細に正しい12桁の番号が必要。区分 0 (システム採番) なら番号を送らない
    if (o.shippingNumberType === 1) {
      if (!d.shippingNumber) issues.push({ userManageNumber: d.userManageNumber, field: "shippingNumber", message: "顧客側採番では問合番号 (12桁) が必須です (SG 指定の範囲が未登録の可能性)" })
      else if (!/^\d{12}$/.test(d.shippingNumber)) issues.push({ userManageNumber: d.userManageNumber, field: "shippingNumber", message: "問合番号は12桁の数字です" })
      else if (!sagawaCheckDigitOk(d.shippingNumber)) issues.push({ userManageNumber: d.userManageNumber, field: "shippingNumber", message: "問合番号のチェックデジットが正しくありません" })
    } else if (d.shippingNumber) {
      issues.push({ userManageNumber: d.userManageNumber, field: "shippingNumber", message: "システム採番 (区分0) では問合番号を送りません" })
    }
  }
  if (o.shippingNumberType === 1) {
    const nums = o.details.map((d) => d.shippingNumber).filter(Boolean)
    if (new Set(nums).size !== nums.length) issues.push({ userManageNumber: "-", field: "shippingNumber", message: "同じ問合番号が電文内に複数あります" })
  }
  if (issues.length) throw new BizLogiValidationError(issues)

  return buildXml([
    "shippingRequest",
    [
      ["customerAuth", [["customerId", o.customerId], ["loginPassword", cdata(o.loginPassword)]]],
      ["deliveryCode", "0001"],
      ["printOutFlg", o.issue ? 1 : 0],
      ["okuriCode", o.okuriCode],
      ["outputLevel", o.outputLevel ?? "000"],
      ["backLayerFlg", o.backLayerFlg ?? 1],
      // 1-7 問合番号採番区分 (下敷画像表示フラグ 1-6 の後・印字開始位置 1-8 と出荷情報リスト 1-9 の前)
      ["shippingNumberType", o.shippingNumberType],
      ["printDataList", o.details.map(detailElement)],
    ],
  ])
}

export interface ShippingDetailResult {
  userManageNumber: string
  resultCodes: ResultCodeInfo[]
  /** エラーコードを1つも含まない (ワーニングのみは ok)。 */
  ok: boolean
  /** 問合番号 (発行依頼が全件正常のときのみ)。複数個口でも同一番号 (SG回答 2026-09-03) なので通常は1件。 */
  shippingNumbers: string[]
  depot?: { code: string; name: string; tel: string }
}

export interface ShippingResponse {
  /** リクエスト全体の処理結果コード。 */
  result: ResultCodeInfo
  ok: boolean
  /** 発行受付ID (発行依頼かつ全件正常のときのみ)。これが返った時点で課金対象。 */
  printRequestId: string | null
  details: ShippingDetailResult[]
}

export function parseShippingResponse(xml: string): ShippingResponse {
  const root = parseXml(xml)
  if (root.name !== "shippingResponse") throw new Error(`unexpected root <${root.name}>`)
  const resultCode = childText(root, "resultCode")
  const details = children(child(root, "printDataList"), "printDataDetail").map((d): ShippingDetailResult => {
    const resultCodes = children(child(d, "resultCodeList"), "resultCode").map((c) => describeResultCode(c.text))
    const depotNode = child(d, "depotInfo")
    const depotCode = childText(depotNode, "depotCode")
    return {
      userManageNumber: childText(d, "userManageNumber"),
      resultCodes,
      ok: !resultCodes.some((c) => c.severity === "error"),
      shippingNumbers: children(child(d, "shippingNumberList"), "shippingNumber").map((s) => s.text).filter(Boolean),
      depot: depotCode
        ? { code: depotCode, name: childText(depotNode, "depotName"), tel: childText(depotNode, "depotTel") }
        : undefined,
    }
  })
  const ok = isSuccess(resultCode) && details.every((d) => d.ok)
  return {
    result: describeResultCode(resultCode),
    ok,
    // 仕様書のエラー例には発行受付IDが残っているが、仕様上はエラー時に発行されない。
    // 失敗を「発行済み」と取り違えないよう、正常時だけ採用する。
    printRequestId: ok ? childText(root, "printRequestId") || null : null,
    details,
  }
}
