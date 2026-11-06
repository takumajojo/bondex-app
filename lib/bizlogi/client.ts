// Biz-Logi API クライアント (SGシステム・仕様書 Ver.2.82)。
//
// 共通仕様 (3.3): HTTPS (TLS1.2/1.3)・UTF-8・Content-Type: application/xml・POST。
// 認証は電文ごとに customerAuth (カスタマーID / ログインパスワード) を載せる。
//
// 課金の安全弁: 送り状発行APIの「発行依頼」は発行受付IDが出た時点で問合番号単位に
// 課金され、取消APIも無い。BIZLOGI_LIVE が厳密に "true" のときだけ発行依頼を送る
// (SHIPANDCO_LIVE と同じ考え方)。確認機能・住所チェックはこのスイッチに関係なく使える。

import { isNonProductionDeployment } from "@/lib/env-guard"
import { buildXml, cdata, child, childText, children, parseXml, type XmlElement } from "./xml"
import { describeResultCode, isSuccess, type ResultCodeInfo } from "./codes"
import {
  buildShippingRequestXml,
  parseShippingResponse,
  type ShippingDetail,
  type ShippingResponse,
} from "./shipping"

/** SGシステムが JOJO に指定した送り状コード (集荷依頼専用 白紙帳票・テスト環境シート Ver2.5)。これ以外は送らない。 */
export const ALLOWED_OKURI_CODES: readonly string[] = ["N01"]

/** SGシステムのお客様テスト環境の接続先ホスト (テスト環境シート Ver2.5)。 */
export const BIZLOGI_TEST_HOSTS: readonly string[] = ["beccl-st.biz-blue.net"]

export type BizLogiEnvironment = "test" | "production"

export interface BizLogiConfig {
  /** 例: "https://beccl-st.biz-blue.net/api" (末尾スラッシュ無し・各APIは /shipping 等を後ろに付ける)。 */
  baseUrl: string
  /** 接続先の宣言。baseUrl のホストと食い違えば設定エラーにする (テスト/本番の取り違え防止)。 */
  environment: BizLogiEnvironment
  customerId: string
  loginPassword: string
  /** 送り状コード (仕様書 5.1: A501/A401/L02/D03。JOJO は SGシステム指定の N01)。発行依頼で使う。 */
  okuriCode?: string
  /** true のときだけ発行依頼 (課金・集荷依頼の実送信) を許可する。 */
  live: boolean
  /**
   * 問合番号の採番方式 (2026-11-04 谷口さん決定): "system" = Biz-Logi が採番 (仕様書の既定・区分を送らない・標準) /
   * "customer" = BondEx が SG 指定の範囲から採番して送る (区分 1・オプション・sql/078)。
   * env BIZLOGI_NUMBERING が "customer" のときだけ顧客側採番 (未設定・それ以外は system)。
   */
  numbering: "customer" | "system"
  timeoutMs?: number
}

export class BizLogiConfigError extends Error {}

/** 送ったかどうかが確定できない失敗 (タイムアウト等)。発行依頼では自動で再送してはいけない。 */
export class BizLogiTransportError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

/** env から設定を読む。必須値が欠けていれば不足しているキー名を挙げて失敗する。 */
export function bizLogiConfigFromEnv(env: Record<string, string | undefined> = process.env): BizLogiConfig {
  const missing = ["BIZLOGI_BASE_URL", "BIZLOGI_CUSTOMER_ID", "BIZLOGI_LOGIN_PASSWORD", "BIZLOGI_ENV"].filter((k) => !env[k])
  if (missing.length) throw new BizLogiConfigError(`Biz-Logi の設定が不足しています: ${missing.join(", ")}`)
  const baseUrl = env.BIZLOGI_BASE_URL!.replace(/\/+$/, "")
  if (!/^https:\/\//.test(baseUrl)) throw new BizLogiConfigError("BIZLOGI_BASE_URL は https:// で始まる必要があります")
  // 仕様書の URL はダミー (dummy.sgsystems.co.jp)。写し間違いで実送信しないよう弾く。
  if (/\/\/dummy\./.test(baseUrl)) throw new BizLogiConfigError("BIZLOGI_BASE_URL が仕様書のダミーURLのままです")
  const environment = env.BIZLOGI_ENV
  if (environment !== "test" && environment !== "production") {
    throw new BizLogiConfigError('BIZLOGI_ENV は "test" か "production" を指定してください')
  }
  const host = new URL(baseUrl).hostname
  const isTestHost = BIZLOGI_TEST_HOSTS.includes(host)
  if (environment === "test" && !isTestHost) {
    throw new BizLogiConfigError(`BIZLOGI_ENV=test ですが接続先 ${host} はテスト環境ではありません`)
  }
  if (environment === "production" && isTestHost) {
    throw new BizLogiConfigError(`BIZLOGI_ENV=production ですが接続先 ${host} はテスト環境です`)
  }
  const okuriCode = env.BIZLOGI_OKURI_CODE || undefined
  if (okuriCode && !ALLOWED_OKURI_CODES.includes(okuriCode)) {
    throw new BizLogiConfigError(`送り状コード ${okuriCode} は使えません (許可: ${ALLOWED_OKURI_CODES.join(", ")})`)
  }
  return {
    baseUrl,
    environment,
    customerId: env.BIZLOGI_CUSTOMER_ID!,
    loginPassword: env.BIZLOGI_LOGIN_PASSWORD!,
    okuriCode,
    // Vercel の Preview・Development からは発行依頼を送らない (lib/env-guard.ts)
    live: env.BIZLOGI_LIVE === "true" && !isNonProductionDeployment(env),
    numbering: env.BIZLOGI_NUMBERING === "customer" ? "customer" : "system",
  }
}

/** ログ・エラー表示用にパスワードを伏せる。 */
export function maskSecrets(xml: string): string {
  return xml.replace(/<loginPassword>[\s\S]*?<\/loginPassword>/g, "<loginPassword>***</loginPassword>")
}

export interface AddressCheckResult {
  result: ResultCodeInfo
  /** 郵便番号と住所が一致し、担当営業所が特定できた。 */
  matched: boolean
  /** リクエスト郵便番号に該当する住所の候補。 */
  addresses: Array<{ todofuken: string; shikuchoson: string; choiki: string }>
  /** リクエスト住所に該当する郵便番号の候補。 */
  yubins: string[]
  depot?: { code: string; name: string; tel: string }
}

export interface FileCheckResult {
  result: ResultCodeInfo
  files: Array<{ printRequestId: string; createDate: string; result: ResultCodeInfo; url: string | null }>
}

export interface UsageResult {
  result: ResultCodeInfo
  /** 期間中の総利用実績件数 (= 課金対象の問合番号発行数)。 */
  count: number
}

export interface RetryPrintResult {
  result: ResultCodeInfo
  printRequestId: string | null
  errors: Array<{ shippingNumber: string; resultCodes: ResultCodeInfo[] }>
}

export class BizLogiClient {
  constructor(
    private readonly config: BizLogiConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private auth(): XmlElement {
    return ["customerAuth", [["customerId", this.config.customerId], ["loginPassword", cdata(this.config.loginPassword)]]]
  }

  private async post(path: string, xml: string): Promise<string> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.config.timeoutMs ?? 30000)
    try {
      const res = await this.fetchImpl(`${this.config.baseUrl}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/xml" },
        body: xml,
        signal: ctrl.signal,
      })
      const text = await res.text()
      if (!res.ok) throw new BizLogiTransportError(`Biz-Logi ${path} HTTP ${res.status}`, res.status)
      return text
    } catch (err) {
      if (err instanceof BizLogiTransportError) throw err
      const msg = err instanceof Error ? err.message : String(err)
      throw new BizLogiTransportError(`Biz-Logi ${path} 通信エラー: ${msg}`, 0)
    } finally {
      clearTimeout(timer)
    }
  }

  /** 問合番号採番区分 (1-7)。顧客側採番 (明示したときだけ) なら 1。システム採番は送らない (仕様書の既定 = 0/null)。 */
  private numberType(): 0 | 1 | undefined {
    return this.config.numbering === "customer" ? 1 : undefined
  }

  /** 送り状発行API (確認機能)。エラー精査のみで、問合番号は採番されない。 */
  async checkShipping(details: ShippingDetail[], today?: string): Promise<ShippingResponse> {
    const xml = buildShippingRequestXml(
      { customerId: this.config.customerId, loginPassword: this.config.loginPassword, issue: false, okuriCode: this.config.okuriCode, shippingNumberType: this.numberType(), details },
      today,
    )
    return parseShippingResponse(await this.post("shipping", xml))
  }

  /**
   * 送り状発行API (発行依頼)。集荷依頼情報を付けた出荷情報は佐川の基幹システムへ連携される。
   *
   * 注意: 成功すると課金され、取り消すAPIは無い。BizLogiTransportError (タイムアウト等) の
   * ときは「届いたかどうか不明」なので自動再送しない。過去に送った管理番号を佐川側が重複として
   * 弾くか (E1-0002 の範囲) は未確認 (SGへの質問 C-04)。それを前提にした再送はしないこと。
   */
  async requestShipping(details: ShippingDetail[], today?: string): Promise<ShippingResponse> {
    if (!this.config.live) {
      throw new BizLogiConfigError("発行依頼は BIZLOGI_LIVE=true のときだけ送信できます (課金・集荷依頼が発生するため)")
    }
    if (!this.config.okuriCode || !ALLOWED_OKURI_CODES.includes(this.config.okuriCode)) {
      throw new BizLogiConfigError(`発行依頼の送り状コードが許可されていません (許可: ${ALLOWED_OKURI_CODES.join(", ")})`)
    }
    const xml = buildShippingRequestXml(
      { customerId: this.config.customerId, loginPassword: this.config.loginPassword, issue: true, okuriCode: this.config.okuriCode, shippingNumberType: this.numberType(), details },
      today,
    )
    return parseShippingResponse(await this.post("shipping", xml))
  }

  /** 佐川急便マスタ参照API (4.5)。郵便番号と住所の整合と、配達担当営業所を返す。 */
  async checkAddress(yubin: string, address: string): Promise<AddressCheckResult> {
    const xml = buildXml([
      "checkAddressRequest",
      [this.auth(), ["requestYubin", yubin], ["requestAddress", address], ["deliveryCode", "0001"]],
    ])
    const root = parseXml(await this.post("checkaddress", xml))
    const resultCode = childText(root, "resultCode")
    const depotCode = childText(root, "depotCode")
    return {
      result: describeResultCode(resultCode),
      matched: isSuccess(resultCode) && !!depotCode,
      addresses: children(child(root, "addressList"), "addressInfo").map((a) => ({
        todofuken: childText(a, "todofukenName"),
        shikuchoson: childText(a, "shikuchosonName"),
        choiki: childText(a, "choikiName"),
      })),
      yubins: children(child(root, "yubinList"), "yubin").map((y) => y.text).filter(Boolean),
      depot: depotCode ? { code: depotCode, name: childText(root, "depotName"), tel: childText(root, "depotTel") } : undefined,
    }
  }

  /** ファイル存在確認API (4.2)。送り状PDFのダウンロードURL (生成後24時間有効) を返す。 */
  async checkFile(printRequestIds: string[]): Promise<FileCheckResult> {
    const xml = buildXml([
      "checkFileRequest",
      [this.auth(), ["printRequestIdList", printRequestIds.map((id): XmlElement => ["printRequestId", id])]],
    ])
    const root = parseXml(await this.post("checkfile", xml))
    return {
      result: describeResultCode(childText(root, "resultCode")),
      files: children(child(root, "printDataList"), "printDataDetail").map((d) => ({
        printRequestId: childText(d, "printRequestId"),
        createDate: childText(d, "createDate"),
        result: describeResultCode(childText(d, "resultCode")),
        url: childText(d, "url") || null,
      })),
    }
  }

  /** 利用実績API (4.3)。期間 (yyyyMMdd) 中の問合番号発行数。課金額の突き合わせに使う。 */
  async usage(startDate: string, endDate: string): Promise<UsageResult> {
    const xml = buildXml(["riyouJissekiRequest", [this.auth(), ["startDate", startDate], ["endDate", endDate]]])
    const root = parseXml(await this.post("riyoujisseki", xml))
    return {
      result: describeResultCode(childText(root, "resultCode")),
      count: Number(childText(root, "count") || 0),
    }
  }

  /** 送り状再発行依頼API (4.4)。初回発行から72時間以内、同じ問合番号で再作成する。 */
  async retryPrint(shippingNumbers: string[]): Promise<RetryPrintResult> {
    const xml = buildXml([
      "retryPrintRequest",
      [
        this.auth(),
        // 省略すると佐川側は非表示扱い。初回発行と同じく表示にそろえる。
        ["backLayerFlg", 1],
        ["shippingNumberList", shippingNumbers.map((n): XmlElement => ["shippingNumber", n])],
      ],
    ])
    const root = parseXml(await this.post("retryprint", xml))
    const resultCode = childText(root, "resultCode")
    return {
      result: describeResultCode(resultCode),
      printRequestId: isSuccess(resultCode) ? childText(root, "printRequestId") || null : null,
      errors: children(child(root, "errorShippingNumberList"), "errorShippingNumberDetail").map((e) => ({
        shippingNumber: childText(e, "shippingNumber"),
        resultCodes: children(child(e, "resultCodeList"), "resultCode").map((c) => describeResultCode(c.text)),
      })),
    }
  }
}
