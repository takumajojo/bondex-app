// Biz-Logi の結果不明 (unknown) の復旧の手がかり (2026-11-04 SG 正式回答)。
// 自動では再送も状態の確定もしない。運営が下の手がかりと世田谷営業所・SG への確認で判断し、画面から記録する。
//   1. 利用実績参照 API (仕様書 4.3): 期間中の問合番号の発行数だけが返る (番号ごとの明細は無い)。
//      その日の佐川の発行数を、BondEx の記録 (受付済み・結果不明) と比べる
//   2. 番号ごと: 顧客側採番なら送った番号が分かる → インターネット貨物 (お荷物問い合わせ) API・世田谷営業所で確かめる
//      (集荷の前は佐川の追跡にデータが無いことがある。その場合は世田谷営業所・SG に番号で確認する)

export interface UsageCheckInput {
  /** 佐川 (利用実績参照 API) の、その日の問合番号の発行数 */
  sagawaCount: number
  /** BondEx の記録で、その日に Biz-Logi で受付済みになった数 (同じ接続先) */
  localAccepted: number
  /** BondEx の記録で、その日に送って結果不明・送信中のままの数 (この依頼を含む) */
  localUnknown: number
}

export type UsageVerdict = "likely_not_issued" | "likely_all_issued" | "ambiguous" | "mismatch"

export function judgeUsage(i: UsageCheckInput): { verdict: UsageVerdict; message: string } {
  const diff = i.sagawaCount - i.localAccepted
  if (diff === 0) {
    return { verdict: "likely_not_issued", message: `佐川の発行数 (${i.sagawaCount}) は BondEx の受付済み (${i.localAccepted}) と同じです。結果不明の依頼は発行されていない可能性が高いですが、確定は世田谷営業所・SG への番号の確認の後にしてください` }
  }
  if (diff === i.localUnknown) {
    return { verdict: "likely_all_issued", message: `佐川の発行数 (${i.sagawaCount}) は 受付済み ${i.localAccepted} + 結果不明 ${i.localUnknown} と同じです。結果不明の依頼は発行されている可能性が高いです。番号で佐川の登録を確かめてから「依頼済み」と記録してください` }
  }
  if (diff > 0 && diff < i.localUnknown) {
    return { verdict: "ambiguous", message: `結果不明 ${i.localUnknown}件のうち ${diff}件だけが発行されている計算です。どれが発行されたかは件数では分かりません。番号ごとに世田谷営業所・SG に確かめてください` }
  }
  return { verdict: "mismatch", message: `件数が合いません (佐川 ${i.sagawaCount} / BondEx 受付済み ${i.localAccepted} / 結果不明 ${i.localUnknown})。BondEx 以外の発行や記録漏れの可能性があります。世田谷営業所・SG に確かめてください` }
}
