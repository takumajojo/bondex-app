import { S } from "./state"
export function getTrackingProvider() {
  return {
    fetchOne: async (_carrier: string | null, number: string) =>
      S.trackingResults[number] ?? { number, noData: true, status: null, exception: null },
  }
}
