/**
 * 送り状 (伝票) を BondEx 側で発行するかどうかの単一スイッチ。
 *
 * 2026-09-24 谷口さん決定: 送り状の作成は今後不要。BondEx が佐川へ情報提供 (当面はメール + CSV、
 * API 連携後は自動) し、佐川側が伝票を作成して集荷する運用に変わった。代理店へ渡す書類は
 * バウチャーと HOW TO SHIP のみ。
 *
 * そのため Ship&co による発行 (30日前の自動発行 cron・依頼時の即発行) と、紙の送り状の
 * 郵送アラートは既定で止める。従来運用へ戻すときだけ AUTO_ISSUE_ENABLED="true" を設定する
 * (以前は "false" で止める安全弁だったが、意味を反転させた)。
 * 運用画面からの手動発行 (/api/shipandco/create) はこのスイッチの対象外 (必要時の逃げ道)。
 */
export function waybillIssuanceEnabled(): boolean {
  return process.env.AUTO_ISSUE_ENABLED === "true"
}
