// 偽物どうしで共有する呼び出し回数と、偽 DB が返す区間・代理店。
export const calls = {
  getShipment: 0,
  recordError: 0,
  recordCharge: 0,
  customerRetrieve: 0,
  piCreate: 0,
  opsAlert: 0,
  mail: 0,
}

export const db: {
  shipments: Record<string, Record<string, unknown>>
  agency: Record<string, unknown> | null
  defaultPm: string
} = { shipments: {}, agency: null, defaultPm: "pm_card_a" }

export function reset(): void {
  for (const k of Object.keys(calls) as Array<keyof typeof calls>) calls[k] = 0
  db.shipments = {}
  db.agency = null
  db.defaultPm = "pm_card_a"
}
