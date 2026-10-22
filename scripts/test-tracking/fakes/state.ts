// テスト全体で共有する記録・設定。各テストの頭で reset() する。
export type Call = { name: string; args: unknown[] }
export const S = {
  calls: [] as Call[],
  shipments: [] as Record<string, unknown>[],
  // update の直前に呼ばれる。並走した別の実行が先に行を進めた状況の再現に使う。
  beforeUpdate: null as null | (() => void),
  trackingResults: {} as Record<string, unknown>,
  lockHeld: new Set<string>(),
  lastShipmentQuery: [] as Array<[string, ...unknown[]]>,
}
export function reset() {
  S.calls = []
  S.shipments = []
  S.beforeUpdate = null
  S.trackingResults = {}
  S.lockHeld = new Set()
  S.lastShipmentQuery = []
}
export function rec(name: string, ...args: unknown[]) {
  S.calls.push({ name, args })
}
export const called = (name: string) => S.calls.filter((c) => c.name === name)
