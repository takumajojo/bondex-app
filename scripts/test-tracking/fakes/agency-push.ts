import { rec } from "./state"
export async function pushToAgency(a: string, p: unknown) { rec("push", a, p) }
