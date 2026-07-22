import crypto from "crypto"

/**
 * Google Drive 連携 (依存ゼロ実装)。
 *
 * サービスアカウントの JSON 鍵で JWT を自前署名 → アクセストークンを取得 → Drive REST v3
 * を fetch で叩く。googleapis パッケージ (巨大) を入れずに済ませ、Vercel の関数サイズを
 * 抑える。
 *
 * 必須 env:
 *   GOOGLE_DRIVE_SA_KEY   … サービスアカウントの JSON 鍵 (生 JSON か base64)。
 *   GOOGLE_DRIVE_ROOT_ID  … 格納先「共有ドライブ」の ID (0A で始まる)。
 *
 * 共有ドライブ必須: サービスアカウントは自前のマイドライブ容量を持たないため、通常フォルダ
 * には保存できない (storageQuotaExceeded)。共有ドライブなら所有者がドライブ側になり回避できる。
 * すべての呼び出しで supportsAllDrives=true を付ける。
 */

interface ServiceAccount {
  client_email: string
  private_key: string
}

const ROOT_ID = process.env.GOOGLE_DRIVE_ROOT_ID?.trim() || ""
const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files"
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"
const TOKEN_URL = "https://oauth2.googleapis.com/token"

export function isDriveConfigured(): boolean {
  return !!(process.env.GOOGLE_DRIVE_SA_KEY?.trim() && ROOT_ID)
}

function loadCredentials(): ServiceAccount | null {
  const raw = process.env.GOOGLE_DRIVE_SA_KEY?.trim()
  if (!raw) return null
  let jsonStr = raw
  if (!raw.startsWith("{")) {
    // base64 で渡された場合はデコード
    try {
      jsonStr = Buffer.from(raw, "base64").toString("utf8")
    } catch {
      return null
    }
  }
  try {
    const parsed = JSON.parse(jsonStr) as Partial<ServiceAccount>
    if (!parsed.client_email || !parsed.private_key) return null
    return { client_email: parsed.client_email, private_key: parsed.private_key }
  } catch {
    return null
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

// アクセストークンを ~55 分キャッシュ (毎回署名しない)
let tokenCache: { token: string; exp: number } | null = null

async function getAccessToken(creds: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (tokenCache && tokenCache.exp - 60 > now) return tokenCache.token

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const claim = base64url(
    JSON.stringify({
      iss: creds.client_email,
      scope: "https://www.googleapis.com/auth/drive",
      aud: TOKEN_URL,
      exp: now + 3600,
      iat: now,
    }),
  )
  const signingInput = `${header}.${claim}`
  const signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(creds.private_key)
  const assertion = `${signingInput}.${base64url(signature)}`

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  })
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string }
  if (!res.ok || !data.access_token) {
    throw new Error(`Drive token error: ${data.error_description || res.status}`)
  }
  tokenCache = { token: data.access_token, exp: now + 3600 }
  return data.access_token
}

// クエリ文字列内のシングルクォートをエスケープ (Drive q 構文)
function q(value: string): string {
  return value.replace(/'/g, "\\'")
}

/**
 * parentId 直下に name のフォルダを find-or-create し、{id, webViewLink} を返す。
 * parentId は共有ドライブ ID (直下) か、その中のフォルダ ID (入れ子) を渡す。
 */
async function ensureFolder(
  token: string,
  name: string,
  parentId: string,
): Promise<{ id: string; webViewLink: string }> {
  const query = [
    `name='${q(name)}'`,
    "mimeType='application/vnd.google-apps.folder'",
    `'${parentId}' in parents`,
    "trashed=false",
  ].join(" and ")
  const listUrl = new URL(DRIVE_FILES)
  listUrl.searchParams.set("q", query)
  listUrl.searchParams.set("fields", "files(id,webViewLink)")
  listUrl.searchParams.set("supportsAllDrives", "true")
  listUrl.searchParams.set("includeItemsFromAllDrives", "true")
  listUrl.searchParams.set("corpora", "drive")
  listUrl.searchParams.set("driveId", ROOT_ID)

  const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } })
  const listData = (await listRes.json().catch(() => ({}))) as {
    files?: Array<{ id: string; webViewLink: string }>
    error?: { message?: string }
  }
  if (!listRes.ok) throw new Error(`Drive list error: ${listData.error?.message || listRes.status}`)
  if (listData.files && listData.files.length > 0) {
    return { id: listData.files[0].id, webViewLink: listData.files[0].webViewLink }
  }

  const createUrl = new URL(DRIVE_FILES)
  createUrl.searchParams.set("fields", "id,webViewLink")
  createUrl.searchParams.set("supportsAllDrives", "true")
  const createRes = await fetch(createUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  })
  const created = (await createRes.json().catch(() => ({}))) as {
    id?: string
    webViewLink?: string
    error?: { message?: string }
  }
  if (!createRes.ok || !created.id) {
    throw new Error(`Drive folder create error: ${created.error?.message || createRes.status}`)
  }
  return { id: created.id, webViewLink: created.webViewLink || "" }
}

/**
 * folderId 内に fileName で PDF を保存。同名があれば内容を更新 (multipart create / media update)。
 */
async function uploadPdf(
  token: string,
  folderId: string,
  fileName: string,
  buffer: Buffer,
): Promise<void> {
  // 既存ファイル検索
  const query = [`name='${q(fileName)}'`, `'${folderId}' in parents`, "trashed=false"].join(" and ")
  const listUrl = new URL(DRIVE_FILES)
  listUrl.searchParams.set("q", query)
  listUrl.searchParams.set("fields", "files(id)")
  listUrl.searchParams.set("supportsAllDrives", "true")
  listUrl.searchParams.set("includeItemsFromAllDrives", "true")
  listUrl.searchParams.set("corpora", "drive")
  listUrl.searchParams.set("driveId", ROOT_ID)
  const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } })
  const listData = (await listRes.json().catch(() => ({}))) as {
    files?: Array<{ id: string }>
    error?: { message?: string }
  }
  if (!listRes.ok) throw new Error(`Drive list error: ${listData.error?.message || listRes.status}`)
  const existingId = listData.files?.[0]?.id

  if (existingId) {
    // 内容だけ差し替え (uploadType=media)
    const updUrl = new URL(`${DRIVE_UPLOAD}/${existingId}`)
    updUrl.searchParams.set("uploadType", "media")
    updUrl.searchParams.set("supportsAllDrives", "true")
    const updRes = await fetch(updUrl, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/pdf" },
      body: new Uint8Array(buffer),
    })
    if (!updRes.ok) {
      const e = await updRes.text().catch(() => "")
      throw new Error(`Drive update error: ${updRes.status} ${e.slice(0, 200)}`)
    }
    return
  }

  // 新規作成 (multipart/related: metadata + 本体)
  const boundary = `bondex_${crypto.randomUUID()}`
  const metadata = JSON.stringify({ name: fileName, parents: [folderId] })
  const pre = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
    "utf8",
  )
  const post = Buffer.from(`\r\n--${boundary}--`, "utf8")
  const body = Buffer.concat([pre, buffer, post])

  const createUrl = new URL(DRIVE_UPLOAD)
  createUrl.searchParams.set("uploadType", "multipart")
  createUrl.searchParams.set("supportsAllDrives", "true")
  createUrl.searchParams.set("fields", "id")
  const res = await fetch(createUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: new Uint8Array(body),
  })
  if (!res.ok) {
    const e = await res.text().catch(() => "")
    throw new Error(`Drive upload error: ${res.status} ${e.slice(0, 200)}`)
  }
}

export type DriveFile = { name: string; buffer: Buffer }

/**
 * 予約の書類を「共有ドライブ → 代理店フォルダ → 予約番号フォルダ」に保存する。
 * agencyName を渡すと代理店ごとに整理される (未指定なら共有ドライブ直下)。
 * 予約番号フォルダの webViewLink を返す。未設定・失敗は { ok:false }。
 */
export async function putBookingDocuments(
  bookingId: string,
  files: DriveFile[],
  agencyName?: string,
): Promise<{ ok: true; folderUrl: string } | { ok: false; error: string }> {
  const creds = loadCredentials()
  if (!creds || !ROOT_ID) return { ok: false, error: "Google Drive not configured" }
  try {
    const token = await getAccessToken(creds)
    // 代理店フォルダ (find-or-create) → 予約番号フォルダ (find-or-create)
    const parentId = agencyName?.trim()
      ? (await ensureFolder(token, agencyName.trim(), ROOT_ID)).id
      : ROOT_ID
    const folder = await ensureFolder(token, bookingId, parentId)
    for (const f of files) {
      await uploadPdf(token, folder.id, f.name, f.buffer)
    }
    return { ok: true, folderUrl: folder.webViewLink }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Drive error" }
  }
}

/**
 * 共有ドライブ直下に散らばった予約フォルダ (BDX-* が root 直下にあるもの) をゴミ箱へ移す。
 * 入れ子化する前の古い残骸の掃除用。代理店フォルダ (BondEx Test Agency 等) は
 * "BDX-" を含まないので対象外。ゴミ箱移動なので 30 日は復元可能。
 */
export async function cleanupRootBookingFolders(): Promise<{
  ok: boolean
  trashed: string[]
  error?: string
}> {
  const creds = loadCredentials()
  if (!creds || !ROOT_ID) return { ok: false, trashed: [], error: "Google Drive not configured" }
  try {
    const token = await getAccessToken(creds)
    const query = [
      "mimeType='application/vnd.google-apps.folder'",
      `'${ROOT_ID}' in parents`,
      "name contains 'BDX-'",
      "trashed=false",
    ].join(" and ")
    const url = new URL(DRIVE_FILES)
    url.searchParams.set("q", query)
    url.searchParams.set("fields", "files(id,name)")
    url.searchParams.set("supportsAllDrives", "true")
    url.searchParams.set("includeItemsFromAllDrives", "true")
    url.searchParams.set("corpora", "drive")
    url.searchParams.set("driveId", ROOT_ID)
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const data = (await res.json().catch(() => ({}))) as {
      files?: Array<{ id: string; name: string }>
      error?: { message?: string }
    }
    if (!res.ok) return { ok: false, trashed: [], error: data.error?.message || String(res.status) }
    const trashed: string[] = []
    for (const f of data.files ?? []) {
      const patchUrl = new URL(`${DRIVE_FILES}/${f.id}`)
      patchUrl.searchParams.set("supportsAllDrives", "true")
      const del = await fetch(patchUrl, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: true }),
      })
      if (del.ok) trashed.push(f.name)
    }
    return { ok: true, trashed }
  } catch (err) {
    return { ok: false, trashed: [], error: err instanceof Error ? err.message : "Drive error" }
  }
}

/**
 * 代理店フォルダ (共有ドライブ直下) を find-or-create する。
 * 新規代理店の追加時に呼び、予約が無くても代理店フォルダを先に用意しておく。
 */
export async function ensureAgencyFolder(
  agencyName: string,
): Promise<{ ok: true; folderUrl: string } | { ok: false; error: string }> {
  const creds = loadCredentials()
  if (!creds || !ROOT_ID || !agencyName.trim()) {
    return { ok: false, error: "Google Drive not configured" }
  }
  try {
    const token = await getAccessToken(creds)
    const f = await ensureFolder(token, agencyName.trim(), ROOT_ID)
    return { ok: true, folderUrl: f.webViewLink }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Drive error" }
  }
}
