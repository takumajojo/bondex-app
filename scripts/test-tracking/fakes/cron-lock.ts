import { S, rec } from "./state"
export async function acquireCronLock(name: string) {
  rec("lock.acquire", name)
  if (S.lockHeld.has(name)) return { ok: false, reason: "already running" }
  S.lockHeld.add(name)
  return { ok: true }
}
export async function releaseCronLock(name: string) {
  rec("lock.release", name)
  S.lockHeld.delete(name)
}
