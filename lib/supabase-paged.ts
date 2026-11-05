// Supabase (PostgREST) の読み取りを、行数の上限 (既定 max_rows=1000) で黙って打ち切らせないための道具。
// PostgREST は上限を超えた行をエラーにせず捨てるので、件数が増えると一覧から行が消える (2026-11-07 監査 B-03)。
//   selectAllById : id の順に「前のページの最後の id より後」を読み続ける (キーセット)。途中で行が増減しても
//                   飛ばし・重複が起きにくく、サーバーの上限がいくつでも空のページまで読む。
//   chunk         : in (...) に渡す id の数を区切る (URL が長くなりすぎて失敗しないように)。

export const PAGE_SIZE = 1000
export const IN_CHUNK = 150
const MAX_PAGES = 1000 // 100万行。これを超えるのは想定外なので止めて知らせる

type PageResult = PromiseLike<{ data: unknown; error: { message: string } | null }>

/**
 * page(afterId, size) は「id > afterId (null なら条件なし)・id の昇順・size 件まで」の問い合わせを返す。
 * 全ページを読み、1件でも読めなければ例外 (途中までの結果で判断しない)。
 */
export async function selectAllById<T extends { id: string }>(
  page: (afterId: string | null, size: number) => PageResult,
  label: string,
): Promise<T[]> {
  const out: T[] = []
  let after: string | null = null
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await page(after, PAGE_SIZE)
    if (error) throw new Error(`${label}: ${error.message}`)
    const rows = (data ?? []) as T[]
    if (!rows.length) return out
    out.push(...rows)
    const last = rows[rows.length - 1].id
    if (after !== null && last <= after) throw new Error(`${label}: id の順に読めませんでした`)
    after = last
  }
  throw new Error(`${label}: 行が多すぎます (${MAX_PAGES} ページ)`)
}

export function chunk<T>(arr: readonly T[], size: number = IN_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
