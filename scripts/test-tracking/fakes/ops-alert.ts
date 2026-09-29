import { rec } from "./state"
export async function sendOpsAlert(a: unknown) { rec("opsAlert", a) }
