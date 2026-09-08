/**
 * HubSpot CRM API client (server / CLI 専用。ブラウザから import しないこと)
 *
 * 設計方針:
 *  - v3 objects API (search/create/update) + v4 associations API を薄くラップする
 *  - 429 / 5xx は Retry-After を尊重して指数バックオフで再試行
 *  - dryRun フラグを client 側で持つ。呼び出し側は同じコードパスのまま
 *    「実書き込みするか否か」を切り替えられる (誤爆防止の要)
 *  - すべての API 呼び出しは onLog コールバックへ流し、監査ログに残す
 *
 * トークンは Private App の HUBSPOT_PRIVATE_APP_TOKEN。値はコード/ログに出さない。
 */

const HS_BASE = "https://api.hubapi.com"

export type HsResult<T> = { ok: true; data: T; status: number } | { ok: false; status: number; error: string }

/** HubSpot の標準オブジェクト種別 (このツールで扱う範囲) */
export type HsObjectType = "companies" | "contacts" | "deals" | "meetings" | "tasks" | "notes"

export type HsObject = {
  id: string
  properties: Record<string, string | null>
  createdAt?: string
  updatedAt?: string
}

export type HsSearchFilter = {
  propertyName: string
  operator: "EQ" | "NEQ" | "CONTAINS_TOKEN" | "HAS_PROPERTY" | "GT" | "LT"
  value?: string
}

export type HsLogEntry = {
  at: string
  method: string
  path: string
  status: number
  ok: boolean
  dryRun: boolean
  /** 書き込み系のみ。トークン等の秘密は含めない */
  summary?: string
  error?: string
}

export type HubSpotClientOptions = {
  token: string
  /** true の間は POST/PATCH/PUT/DELETE を実行せず、擬似 ID を返す */
  dryRun: boolean
  /** 監査ログ用フック */
  onLog?: (entry: HsLogEntry) => void
  /** 429/5xx の最大再試行回数 (既定 4) */
  maxRetries?: number
}

export type HubSpotClient = ReturnType<typeof createHubSpotClient>

/** dry-run 時に返す擬似 ID。実 ID (数値文字列) と区別できる形にする */
export function isDryRunId(id: string): boolean {
  return id.startsWith("dryrun-")
}

/** HubSpot 非公開アプリのトークン形式: pat-<地域>-<UUID(8-4-4-4-12)> */
export const HS_TOKEN_PATTERN = /^pat-(na1|na2|eu1|ap1)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * トークンの見た目を検査し、問題があれば日本語で理由を返す (正常なら undefined)。
 * 値そのものは決して返さない。API を叩く前にコピー事故を切り分けるために使う。
 */
export function inspectTokenShape(token: string): string | undefined {
  const t = token.trim()
  if (!t) return "値が空です。"
  if (HS_TOKEN_PATTERN.test(t)) return undefined
  if (/[•●*]/.test(t)) return "伏せ字 (●) が混ざっています。「トークンを表示」してからコピーしてください。"
  if (/\s/.test(t)) return "空白か改行が混ざっています。"

  const hasPrefix = t.startsWith("pat-")
  const hasRegion = /^(pat-)?(na1|na2|eu1|ap1)-/.test(t)
  if (!hasRegion) {
    return "`pat-<地域>-` で始まっていません。非公開アプリ(Private App)のトークンではない可能性があります。"
  }

  // 地域コードより後ろ (UUID であるべき部分) の区画を数える
  const uuidPart = t.replace(/^(pat-)?(na1|na2|eu1|ap1)-/, "")
  const shape = uuidPart.split("-").map((x) => x.length).join("-")
  const shapeOk = shape === "8-4-4-4-12"

  const faults: string[] = []
  if (!hasPrefix) faults.push("先頭の `pat-` が欠けている")
  if (!shapeOk) faults.push(`UUID 部分の区画が ${shape} (正しくは 8-4-4-4-12)`)

  const short = 44 - t.length
  const lengthNote = short > 0 ? `${short} 文字足りません` : short < 0 ? `${-short} 文字多いです` : "文字数は合っています"
  return `${faults.join("、")}。現在 ${t.length} 文字で、${lengthNote} (正しくは 44 文字)。`
}

let dryRunCounter = 0
function nextDryRunId(objectType: string): string {
  dryRunCounter += 1
  return `dryrun-${objectType}-${dryRunCounter}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createHubSpotClient(opts: HubSpotClientOptions) {
  const { token, dryRun } = opts
  const maxRetries = opts.maxRetries ?? 4
  const log = opts.onLog ?? (() => {})

  async function request<T>(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    meta?: { summary?: string; forceReal?: boolean },
  ): Promise<HsResult<T>> {
    const isWrite = method !== "GET"

    // dry-run: 読み取りは実行し、書き込みだけ握りつぶす (検索結果は本物である必要があるため)
    if (isWrite && dryRun && !meta?.forceReal) {
      log({
        at: new Date().toISOString(),
        method,
        path,
        status: 0,
        ok: true,
        dryRun: true,
        summary: meta?.summary,
      })
      return { ok: true, status: 0, data: undefined as unknown as T }
    }

    let lastError = "unknown error"
    let lastStatus = 0

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const res = await fetch(`${HS_BASE}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        })

        const text = await res.text()
        let parsed: unknown
        try {
          if (text) parsed = JSON.parse(text)
        } catch {
          // HubSpot がまれに非 JSON を返す (502 等)
        }

        if (res.ok) {
          log({
            at: new Date().toISOString(),
            method,
            path,
            status: res.status,
            ok: true,
            dryRun: false,
            summary: meta?.summary,
          })
          return { ok: true, status: res.status, data: (parsed ?? {}) as T }
        }

        lastStatus = res.status
        const errObj = parsed as { message?: string; errors?: unknown } | undefined
        lastError = errObj?.message || text || res.statusText

        // 429 (レート制限) と 5xx のみ再試行。4xx は即座に諦める (リトライしても直らない)
        const retryable = res.status === 429 || res.status >= 500
        if (!retryable || attempt === maxRetries) break

        const retryAfterHeader = res.headers.get("Retry-After")
        const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 0
        const backoffMs = Math.max(retryAfterMs, 500 * 2 ** attempt)
        await sleep(backoffMs)
      } catch (err) {
        lastStatus = 0
        lastError = err instanceof Error ? err.message : "network error"
        if (attempt === maxRetries) break
        await sleep(500 * 2 ** attempt)
      }
    }

    log({
      at: new Date().toISOString(),
      method,
      path,
      status: lastStatus,
      ok: false,
      dryRun: false,
      summary: meta?.summary,
      error: lastError,
    })
    return { ok: false, status: lastStatus, error: lastError }
  }

  return {
    dryRun,

    /** 疎通確認。トークンとスコープが有効かを最小コストで確かめる */
    async ping(): Promise<HsResult<{ total: number }>> {
      return request<{ total: number }>("GET", "/crm/v3/objects/companies?limit=1")
    },

    /**
     * CRM Search API。filterGroups は OR、その中の filters は AND。
     * 検索インデックスの反映が数秒遅れることがあるため、
     * 同一実行内で作ったオブジェクトを検索で拾い直さないこと。
     */
    async search(
      objectType: HsObjectType,
      filterGroups: { filters: HsSearchFilter[] }[],
      properties: string[],
      limit = 10,
    ): Promise<HsResult<{ total: number; results: HsObject[] }>> {
      return request("POST", `/crm/v3/objects/${objectType}/search`, { filterGroups, properties, limit }, {
        summary: `search ${objectType}`,
        forceReal: true, // 検索は読み取り。dry-run でも実行する
      })
    },

    /** ID 指定の単体取得。差分更新のために現在値を読むのに使う */
    async get(objectType: HsObjectType, id: string, properties: string[]): Promise<HsResult<HsObject>> {
      if (isDryRunId(id)) return { ok: false, status: 0, error: "dry-run id" }
      const query = properties.length ? `?properties=${encodeURIComponent(properties.join(","))}` : ""
      return request<HsObject>("GET", `/crm/v3/objects/${objectType}/${id}${query}`)
    },

    async create(objectType: HsObjectType, properties: Record<string, string>): Promise<HsResult<HsObject>> {
      const res = await request<HsObject>("POST", `/crm/v3/objects/${objectType}`, { properties }, {
        summary: `create ${objectType}: ${properties.name || properties.dealname || properties.email || properties.hs_meeting_title || properties.hs_task_subject || ""}`,
      })
      if (res.ok && !res.data?.id) {
        // dry-run 経路: 擬似 ID を返して後続の関連付けを通す
        return { ok: true, status: 0, data: { id: nextDryRunId(objectType), properties } }
      }
      return res
    },

    async update(
      objectType: HsObjectType,
      id: string,
      properties: Record<string, string>,
    ): Promise<HsResult<HsObject>> {
      if (isDryRunId(id)) return { ok: true, status: 0, data: { id, properties } }
      const res = await request<HsObject>("PATCH", `/crm/v3/objects/${objectType}/${id}`, { properties }, {
        summary: `update ${objectType}#${id}`,
      })
      if (res.ok && !res.data?.id) return { ok: true, status: 0, data: { id, properties } }
      return res
    },

    /**
     * v4 の既定 (default) 関連付け。associationTypeId を自前で持たなくて済むため、
     * ポータルごとの ID 差異に影響されない。
     */
    async associate(
      fromType: HsObjectType,
      fromId: string,
      toType: HsObjectType,
      toId: string,
    ): Promise<HsResult<unknown>> {
      if (isDryRunId(fromId) || isDryRunId(toId)) {
        log({
          at: new Date().toISOString(),
          method: "PUT",
          path: `/crm/v4/objects/${fromType}/${fromId}/associations/default/${toType}/${toId}`,
          status: 0,
          ok: true,
          dryRun: true,
          summary: `associate ${fromType} -> ${toType}`,
        })
        return { ok: true, status: 0, data: {} }
      }
      return request("PUT", `/crm/v4/objects/${fromType}/${fromId}/associations/default/${toType}/${toId}`, undefined, {
        summary: `associate ${fromType}#${fromId} -> ${toType}#${toId}`,
      })
    },

    /**
     * 非公開アプリのトークン情報 (付与スコープ・ポータルID) を取得する。
     * トークンはリクエストボディでのみ送られ、ログにはパスしか残らない。
     */
    async getTokenInfo(): Promise<HsResult<{ hubId?: number; userId?: number; scopes?: string[]; appId?: number }>> {
      return request("POST", "/oauth/v2/private-apps/get/access-token-info", { tokenKey: token }, {
        summary: "token info",
        forceReal: true, // 読み取り相当。dry-run でも実行する
      })
    },

    /** deals の既定パイプラインと先頭ステージを引く */
    async getDealPipelines(): Promise<
      HsResult<{ results: { id: string; label: string; displayOrder: number; stages: { id: string; label: string; displayOrder: number }[] }[] }>
    > {
      return request("GET", "/crm/v3/pipelines/deals")
    },

    /**
     * カスタムプロパティの存在確認。
     * 404 ならそのポータルに未定義 = 同期キー方式は使えない、と判定する。
     */
    async hasProperty(objectType: HsObjectType, propertyName: string): Promise<boolean> {
      const res = await request<{ name: string }>("GET", `/crm/v3/properties/${objectType}/${propertyName}`)
      return res.ok
    },
  }
}
