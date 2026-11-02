// BondEx の1区間 (発送元ホテル → 到着ホテル) を、Biz-Logi の集荷依頼つき出荷情報へ変換する。
//
// 現行の佐川「集荷依頼エントリーCSV」(F-CUBE・39列) と同じ内容を Biz-Logi の項目へ載せ替える:
//   荷送人 = 発送元ホテル「ホテル名 気付 / ゲスト名様」 → 依頼主 (iraiPrintFlg=1 = 実集荷先)
//   荷受人 = 到着ホテル 同様                          → 届先
//   顧客管理番号 (ハイフン無し)                        → 管理番号
//   記事欄1〜5                                        → 記事1〜5 (17文字まで)
// CSV は住所・名称が全角48文字だったが、Biz-Logi は各25文字 × 住所3行 / 氏名2行。
// 収まらないものは切り捨てず、エラーとして運営に返す (誤配送防止)。

import { normalizeManageNumber, normalizeTel, normalizeYubin, splitLines, toYmd } from "./text"
import {
  BONDEX_SLOT_TO_SHITEI_TIME,
  type ShippingDetail,
  type ShukaTimeCode,
  type ValidationIssue,
  type WeightCode,
} from "./shipping"

export interface PickupHotel {
  /** ホテル名 (日本語表記)。 */
  name: string
  /** 郵便番号 (ハイフン有無どちらでも可)。 */
  postalCode: string
  /** 都道府県からの住所 (建物名まで)。 */
  address: string
  /** 送り状に載せる電話番号。 */
  tel: string
}

export interface PickupLegInput {
  /** 区間の参照番号 (例: "BDX-8QRV2Y-L1")。記号は自動で除去して管理番号にする。 */
  legRef: string
  /** 佐川との契約コード (12桁)。顧客コードと集荷依頼主コードに使う。 */
  kokyakuCode: string
  origin: PickupHotel
  destination: PickupHotel
  /** 宛名に載せるゲスト名 (敬称なし)。 */
  guestName: string
  suitcaseCount: number
  /** 集荷日 (yyyy-MM-dd または yyyyMMdd)。 */
  pickupDate: string
  pickupTimeCode?: ShukaTimeCode
  /** 配達希望日。 */
  deliveryDate?: string
  /** BondEx の配達時間帯 (lib/carrier.ts の佐川 timeSlots)。 */
  deliverySlot?: string
  /** 記事欄 (最大6行・各17文字)。 */
  notes?: string[]
  weight?: WeightCode
}

export type PickupBuildResult =
  | { ok: true; detail: ShippingDetail }
  | { ok: false; issues: ValidationIssue[] }

const KIZUKE = "気付"

/** 「ホテル名 気付」「ゲスト名様」を氏名1/氏名2 (各25文字) に収める。 */
function addressee(hotelName: string, guestName: string): string[] | null {
  const line1 = `${hotelName.trim()} ${KIZUKE}`
  const line2 = `${guestName.trim()}様`
  const l1 = splitLines(line1, 25, 1)
  const l2 = splitLines(line2, 25, 1)
  if (l1 && l2) return [l1[0], l2[0]]
  // 1行ずつに収まらない場合は、全体を2行に流し込めるか試す
  return splitLines(`${line1} ${line2}`, 25, 2)
}

export function buildPickupDetail(i: PickupLegInput): PickupBuildResult {
  const issues: ValidationIssue[] = []

  const party = (h: PickupHotel, tag: "irai" | "otodoke", label: string) => {
    const add = splitLines(h.address, 25, 3)
    if (!add || !add.length) issues.push({ field: `${tag}Add1`, message: `${label}の住所が25文字×3行に収まりません: ${h.address}` })
    const nm = addressee(h.name, i.guestName)
    if (!nm) issues.push({ field: `${tag}Nm1`, message: `${label}の宛名 (ホテル名 気付 ゲスト名様) が25文字×2行に収まりません` })
    const yubin = normalizeYubin(h.postalCode)
    if (!yubin) issues.push({ field: `${tag}Yubin`, message: `${label}の郵便番号が7桁ではありません: ${h.postalCode}` })
    const tel = normalizeTel(h.tel)
    if (!tel) issues.push({ field: `${tag}Tel`, message: `${label}の電話番号が不正です` })
    return { add: add ?? [], nm: nm ?? [], yubin: yubin ?? "", tel: tel ?? "" }
  }

  const origin = party(i.origin, "irai", "発送元ホテル")
  const dest = party(i.destination, "otodoke", "到着ホテル")

  const pickupDate = toYmd(i.pickupDate)
  if (!pickupDate) issues.push({ field: "shukaIraiShiteiDate", message: `集荷日の形式が不正です: ${i.pickupDate}` })
  const deliveryDate = i.deliveryDate ? toYmd(i.deliveryDate) : undefined
  if (i.deliveryDate && !deliveryDate) issues.push({ field: "shiteiDate", message: `配達希望日の形式が不正です: ${i.deliveryDate}` })

  let shiteiTimeCode: ShippingDetail["shiteiTimeCode"]
  if (i.deliverySlot) {
    shiteiTimeCode = BONDEX_SLOT_TO_SHITEI_TIME[i.deliverySlot]
    if (!shiteiTimeCode) issues.push({ field: "shiteiTimeCode", message: `配達時間帯を佐川のコードへ変換できません: ${i.deliverySlot}` })
  }

  if (issues.length) return { ok: false, issues }

  return {
    ok: true,
    detail: {
      haisoKosu: i.suitcaseCount,
      userManageNumber: normalizeManageNumber(i.legRef),
      kokyakuCode: i.kokyakuCode,
      otodokeAdd: dest.add,
      otodokeNm: dest.nm,
      otodokeYubin: dest.yubin,
      otodokeTel: dest.tel,
      irai: origin,
      shippingDate: pickupDate!,
      kiji: i.notes,
      shiteiDate: deliveryDate ?? undefined,
      shiteiTimeCode,
      weight1: i.weight ?? "160",
      motoChakuCode: "0",
      shukaIrai: {
        shukaIraiCode: i.kokyakuCode,
        shukaIraiShiteiDate: pickupDate!,
        shukaIraiShiteiTimeCode: i.pickupTimeCode ?? "00",
      },
    },
  }
}
