/**
 * In-memory photo store shared between upload and read Route Handlers.
 *
 * 制約 (本番では外部ストレージに置き換える前提):
 *  - サーバープロセスが落ちると消える
 *  - dev (HMR) でファイル編集 → モジュール再評価で消える
 *  - Vercel Serverless では upload と GET が別 Lambda になり得るため不適
 *
 * 上限: 最大 100 件 (LRU)。1 件 5MB 上限なので最大 ~500MB。
 */

export interface StoredPhoto {
  buffer: Buffer
  mediaType: string
}

const MAX_ENTRIES = 100

const store = new Map<string, StoredPhoto>()

export function put(photoId: string, photo: StoredPhoto): void {
  // Map は挿入順を保つので、再 put 時は一度消してから入れ直して LRU 末尾に。
  if (store.has(photoId)) store.delete(photoId)
  store.set(photoId, photo)
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
}

export function get(photoId: string): StoredPhoto | undefined {
  return store.get(photoId)
}

export function size(): number {
  return store.size
}
