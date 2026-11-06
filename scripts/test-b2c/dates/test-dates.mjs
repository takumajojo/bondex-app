// B2C の試験の日付を実際の今日から見て有効な日に動かす（2026-11-06 監査・決まりは scripts/test-b2c/dates/test-dates.ts）。
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const out = execFileSync("npx", ["tsx", "scripts/test-b2c/dates/test-dates.ts"], { cwd: root, encoding: "utf8" }).trim().split("\n").pop()
export const SHIFT_DAYS = Number(out)
const DAY = 86_400_000
export const D = (ymd) => new Date(Date.parse(`${ymd}T12:00:00Z`) + SHIFT_DAYS * DAY).toISOString().slice(0, 10)
export const T = (iso) => new Date(Date.parse(iso) + SHIFT_DAYS * DAY).toISOString().replace(".000Z", "Z")
