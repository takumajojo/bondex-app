import { rec } from "./state"
export const statusDataFromRow = (row: unknown) => row
export async function sendAgencyStatusEmail(kind: string, data: unknown) { rec("agencyEmail", kind, data); return true }
