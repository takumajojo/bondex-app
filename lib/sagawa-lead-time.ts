/**
 * 佐川 配達日数 (リードタイム) の解決。
 *
 * 出典: 佐川「配達日数検索」(郵便番号検索)。POST /send/days/result/ に zip_from / zip_to を送ると
 *   「担当営業所」と「発送日+N日」が返る (2026-10-30 調査で確認・sql/058_sagawa_lead_times.sql)。
 *
 * 解決順 (resolveSagawaLeadTime):
 *   0. 発送元かお届け先が沖縄県 (90x) … 飛脚航空便の別ルール (OKINAWA_AIR_DAYS)。DB・佐川は見ない
 *   1. sagawa_lead_times     … 郵便番号ペア完全一致
 *   2. sagawa_office_lead_times … 両郵便番号の担当営業所 (sagawa_zip_offices) から営業所ペアで引く
 *   3. 佐川サイトへその場で照会 → 結果を 3 テーブルへ保存 (source='live')
 *   4. それでも取れなければ null (呼び出し側は従来ルール = 発送翌日〜 にフォールバック)
 *
 * 重要:
 *   - サーバー専用 (getSupabase は service_role)。クライアントから import しないこと。
 *   - 行きと帰りで日数が違うルートがある (約17%)。from/to を入れ替えて使い回さないこと。
 *   - 佐川サイトが落ちていても予約・発行を止めない。照会失敗は null を返すだけ (タイムアウト 8秒)。
 *   - days は「発送日 + days 日」= 最短お届け日。集荷が営業所の締めに間に合わない場合や
 *     離島・繁忙期はさらに遅れる (補正は呼び出し側のルール)。
 */
import { getSupabase } from "@/lib/supabase"

export type LeadTimeSource = "zip_pair" | "office_pair" | "live" | "okinawa_air"

/**
 * 沖縄県 (郵便番号 90x) 発着の区間は「飛脚航空便」で送る運用 (2026-10-30 谷口さん確定)。
 * 配達日数検索の結果 (通常便=本州⇔沖縄 3日) は使わず、この日数を最短お届け日に使う。
 * 地域により翌日に届かないことがある (離島など) が、画面・ガイドは「最短翌日」とする。
 */
export const OKINAWA_AIR_DAYS = 1

export function isOkinawaZip(zip7: string): boolean {
  return /^90\d{5}$/.test(zip7)
}

export interface SagawaLeadTime {
  fromZip: string
  toZip: string
  fromOffice: string | null
  toOffice: string | null
  /** 発送日 + days 日でお届け (佐川の検索結果そのまま) */
  days: number
  source: LeadTimeSource
  fetchedAt: string
}

const SAGAWA_DAYS_URL = "https://www2.sagawa-exp.co.jp/send/days/result/"
const LIVE_TIMEOUT_MS = 8_000

export function normalizeZip7(z: string | null | undefined): string | null {
  const d = (z ?? "").replace(/[０-９]/g, (c) => String("０１２３４５６７８９".indexOf(c))).replace(/\D/g, "")
  return /^\d{7}$/.test(d) && d !== "0000000" ? d : null
}

/** 佐川の結果HTMLから 担当営業所 と 日数 を抜く。純粋関数 (テスト用に export)。 */
export function parseSagawaDaysHtml(raw: string): {
  fromOffice: string | null
  toOffice: string | null
  days: number | null
  error: string | null
} {
  const html = raw.replace(/<!--[\s\S]*?-->/g, "")
  const offices = [...html.matchAll(/担当営業所：\s*(?:<[^>]+>\s*)*([^<\s]+?(?:営業所|店|センター))/g)].map((m) => m[1])
  const d = html.match(/発送日\+\s*(?:<[^>]+>\s*)*([0-9０-９]+)\s*(?:<[^>]+>\s*)*日/)
  const days = d ? parseInt(d[1].replace(/[０-９]/g, (c) => String("０１２３４５６７８９".indexOf(c))), 10) : null
  let error: string | null = null
  if (days === null) {
    const e = html.replace(/<[^>]+>/g, " ").match(/(該当[^。]*。|見つかりません[^。]*。)/)
    error = e ? e[1] : "parse_fail" // parse_fail = 佐川のページ構造が変わった可能性
  }
  return { fromOffice: offices[0] ?? null, toOffice: offices[1] ?? null, days, error }
}

/** 佐川サイトへその場で照会する。失敗時は null (例外を投げない)。 */
export async function fetchSagawaLeadTimeLive(fromZip: string, toZip: string) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), LIVE_TIMEOUT_MS)
  try {
    const res = await fetch(SAGAWA_DAYS_URL, {
      method: "POST",
      body: new URLSearchParams({ type: "ZipCodeSearch", zip_from: fromZip, zip_to: toZip }),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 BondEx-leadtime-check (support@bondex.express)",
      },
      cache: "no-store",
      signal: ctrl.signal,
    })
    if (!res.ok) return null
    return parseSagawaDaysHtml(await res.text())
  } catch (err) {
    console.error("[sagawa-lead-time] live fetch failed", { fromZip, toZip, err: err instanceof Error ? err.message : err })
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function resolveSagawaLeadTime(
  fromZipRaw: string | null | undefined,
  toZipRaw: string | null | undefined,
  opts: { allowLive?: boolean } = {},
): Promise<SagawaLeadTime | null> {
  const fromZip = normalizeZip7(fromZipRaw)
  const toZip = normalizeZip7(toZipRaw)
  if (!fromZip || !toZip) return null

  // 0. 沖縄県発着は飛脚航空便 (通常便の日数データは使わない)
  if (isOkinawaZip(fromZip) || isOkinawaZip(toZip)) {
    return { fromZip, toZip, fromOffice: null, toOffice: null, days: OKINAWA_AIR_DAYS, source: "okinawa_air", fetchedAt: new Date().toISOString() }
  }

  const sb = getSupabase()

  if (sb) {
    // 1. 郵便番号ペア完全一致
    const { data: exact } = await sb
      .from("sagawa_lead_times")
      .select("from_office, to_office, days, fetched_at")
      .eq("from_zip", fromZip)
      .eq("to_zip", toZip)
      .maybeSingle()
    if (exact) {
      return { fromZip, toZip, fromOffice: exact.from_office, toOffice: exact.to_office, days: exact.days, source: "zip_pair", fetchedAt: exact.fetched_at }
    }

    // 2. 担当営業所ペア
    const { data: offs } = await sb.from("sagawa_zip_offices").select("zip, office").in("zip", [fromZip, toZip])
    const fo = offs?.find((o) => o.zip === fromZip)?.office
    const to = offs?.find((o) => o.zip === toZip)?.office
    if (fo && to) {
      const { data: op } = await sb
        .from("sagawa_office_lead_times")
        .select("days, fetched_at")
        .eq("from_office", fo)
        .eq("to_office", to)
        .maybeSingle()
      if (op) return { fromZip, toZip, fromOffice: fo, toOffice: to, days: op.days, source: "office_pair", fetchedAt: op.fetched_at }
    }
  }

  // 3. その場で照会 → 保存
  if (opts.allowLive === false) return null
  const live = await fetchSagawaLeadTimeLive(fromZip, toZip)
  if (!live || live.days === null) {
    if (live?.error) console.warn("[sagawa-lead-time] no result", { fromZip, toZip, error: live.error })
    return null
  }
  const now = new Date().toISOString()
  if (sb) {
    const writes = [
      sb.from("sagawa_lead_times").upsert({ from_zip: fromZip, to_zip: toZip, from_office: live.fromOffice, to_office: live.toOffice, days: live.days, source: "live", fetched_at: now }),
    ]
    if (live.fromOffice) writes.push(sb.from("sagawa_zip_offices").upsert({ zip: fromZip, office: live.fromOffice, fetched_at: now }))
    if (live.toOffice) writes.push(sb.from("sagawa_zip_offices").upsert({ zip: toZip, office: live.toOffice, fetched_at: now }))
    if (live.fromOffice && live.toOffice) {
      writes.push(
        sb.from("sagawa_office_lead_times").upsert({ from_office: live.fromOffice, to_office: live.toOffice, days: live.days, sample_from_zip: fromZip, sample_to_zip: toZip, fetched_at: now }),
      )
    }
    const results = await Promise.all(writes)
    for (const r of results) if (r.error) console.error("[sagawa-lead-time] save failed", r.error.message)
  }
  return { fromZip, toZip, fromOffice: live.fromOffice, toOffice: live.toOffice, days: live.days, source: "live", fetchedAt: now }
}

/** 最短お届け日 = 発送日 + days (暦日。佐川は土日祝も配達するため営業日ではなく暦日で数える)。 */
export function earliestArrivalYmd(shipmentDateYmd: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(shipmentDateYmd)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
