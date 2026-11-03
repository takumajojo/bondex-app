// 課金の偽物: Stripe には行かず、呼ばれたことだけ記録する (集荷確認後に課金処理へ進むかの確認用)。
export const chargeCalls: string[] = []
export async function chargeShipmentIfDue(shipmentId: string) {
  chargeCalls.push(shipmentId)
  return { charged: false, skipped: true, reason: "test-spy" }
}
