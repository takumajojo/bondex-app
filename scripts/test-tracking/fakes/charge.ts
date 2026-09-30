import { rec } from "./state"
export async function chargeShipmentIfDue(id: string) { rec("charge", id); return { charged: true, amountYen: 11000 } }
