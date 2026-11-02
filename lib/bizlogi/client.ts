// Biz-Logi API クライアント (SGシステム・仕様書 Ver.2.82)。
//
// 共通仕様 (3.3): HTTPS (TLS1.2/1.3)・UTF-8・Content-Type: application/xml・POST。
// 認証は電文ごとに customerAuth (カスタマーID / ログインパスワード) を載せる。
//
// 課金の安全弁: 送り状発行APIの「発行依頼」は発行受付IDが出た時点で問合番号単位に
// 課金され、取消APIも無い。BIZLOGI_LIVE が厳密に "true" のときだけ発行依頼を送る
// (SHIPANDCO_LIVE と同じ考え方)。確認機能・住所チェックはこのスイッチに関係なく使える。

import { buildXml, cdata, child, childText, children, parseXml, type XmlElement } from "./xml"
import { describeResultCode, isSuccess, type ResultCodeInfo } from "./codes"
import {
  buildShippingRequestXml,
  parseShippingResponse,
  type ShippingDetail,
  type ShippingResponse,
} from "./shipping"

export interface BizLogiConfig {
  /** 例: "https://<SGシステムから通知されたホスト>/rest/getxml" (末尾スラッシュ無し)。 */
  baseUrl: string
  customerId: string
  loginPassword: string
  /** 送り状コード (仕様書 5.1: A501/A401/L02/D03。JOJO は SGシステム指定の N01)。発行依頼で使う。 */
  okuriCode?: string
  /** true のときだけ発行依頼 (課金・集荷依頼の実送信) を許可する。 */
  live: boolean
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
  const missing = ["BIZLOGI_BASE_URL", "BIZLOGI_CUSTOMER_ID", "BIZLOGI_LOGIN_PASSWORD"].filter((k) => !env[k])
  if (missing.length) throw new BizLogiConfigError(`Biz-Logi の設定が不足しています: ${missing.join(", ")}`)
  const baseUrl = env.BIZLOGI_BASE_URL!.replace(/\/+$/, "")
  if (!/^https:\/\//.test(baseUrl)) throw new BizLogiConfigError("BIZLOGI_BASE_URL は https:// で始まる必要があります")
  // 仕様書の URL はダミー (dummy.sgsystems.co.jp)。写し間違いで実送信しないよう弾く。
  if (/\/\/dummy\./.test(baseUrl)) throw new BizLogiConfigError("BIZLOGI_BASE_URL が仕様書のダミーURLのままです")
  return {
    baseUrl,
    customerId: env.BIZLOGI_CUSTOMER_ID!,
    loginPassword: env.BIZLOGI_LOGIN_PASSWORD!,
    okuriCode: env.BIZLOGI_OKURI_CODE || undefined,
    live: env.BIZLOGI_LIVE === "true",
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

  /** 送り状発行API (確認機能)。エラー精査のみで、問合番号は採番されない。 */
  async checkShipping(details: ShippingDetail[], today?: string): Promise<ShippingResponse> {
    const xml = buildShippingRequestXml(
      { customerId: this.config.customerId, loginPassword: this.config.loginPassword, issue: false, okuriCode: this.config.okuriCode, details },
      today,
    )
    return parseShippingResponse(await this.post("shipping", xml))
  }

  /**
   * 送り状発行API (発行依頼)。集荷依頼情報を付けた出荷情報は佐川の基幹システムへ連携される。
   *
   * 注意: 成功すると課金され、取り消すAPIは無い。BizLogiTransportError (タイムアウト等) の
   * ときは「届いたかどうか不明」なので自動再送しない。同じ管理番号で送り直すと、先の電文が
   * 届いていれば E1-0002 (管理番号重複) が返るので、それで二重依頼を防げる。
   */
  async requestShipping(details: ShippingDetail[], today?: string): Promise<ShippingResponse> {
    if (!this.config.live) {
      throw new BizLogiConfigError("発行依頼は BIZLOGI_LIVE=true のときだけ送信できます (課金・集荷依頼が発生するため)")
    }
    const xml = buildShippingRequestXml(
      { customerId: this.config.customerId, loginPassword: this.config.loginPassword, issue: true, okuriCode: this.config.okuriCode, details },
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
