/**
 * /bondex-sync の入力スキーマ。
 *
 * ChatGPT で整理した営業メモを Claude が下記 JSON に構造化し、このスクリプトへ渡す。
 * 「解釈」は AI 側、「HubSpot への書き込み」は本スクリプト側、と役割を分離している。
 * AI が壊れた JSON を出した場合はここで落とし、HubSpot には一切触れない。
 */

import { z } from "zod"

/** HubSpot の任意プロパティを差し込むための逃げ道 (内部名 -> 値) */
const extraProperties = z.record(z.string(), z.string()).optional()

/** ISO 8601 (日付のみ or 日時) を受ける */
const isoDateLike = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "ISO 8601 の日付/日時として解釈できません" })

export const CompanySchema = z.object({
  /** 会社名。必須 (これが無いと同期する意味がない) */
  name: z.string().min(1, "会社名は必須です"),
  /** 例: example.co.jp。重複判定の第一キーになるので可能な限り入れる */
  domain: z.string().optional(),
  phone: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  industry: z.string().optional(),
  description: z.string().optional(),
  website: z.string().optional(),
  properties: extraProperties,
})

export const ContactSchema = z.object({
  /** メールがあれば重複判定が確実になる。無い場合は姓名＋会社で照合 */
  email: z.string().email("メールアドレスの形式が不正です").optional(),
  firstname: z.string().optional(),
  lastname: z.string().optional(),
  jobtitle: z.string().optional(),
  phone: z.string().optional(),
  properties: extraProperties,
}).refine((c) => Boolean(c.email || c.lastname || c.firstname), {
  message: "contact には email か氏名のいずれかが必要です",
})

export const DealSchema = z.object({
  dealname: z.string().min(1, "取引名は必須です"),
  /** 円単位の数値。通貨はポータル既定に従う */
  amount: z.number().nonnegative().optional(),
  closedate: isoDateLike.optional(),
  /** 未指定なら既定パイプラインの先頭ステージに入る */
  pipeline: z.string().optional(),
  dealstage: z.string().optional(),
  properties: extraProperties,
})

/**
 * HubSpot の Note エンゲージメント。実施済み/予定含め「商談内容の記録」全般に使う。
 * Meeting (実際のカレンダー予定) とは別物: Note は日時に厳密な意味を持たず、
 * 「いつの時点の情報か」のメモとして残すだけでよい場合に使う。
 */
export const NoteSchema = z.object({
  body: z.string().min(1, "Note の本文は必須です"),
  /** 未指定なら現在時刻。タイムライン上の表示位置に使われるだけで、厳密な日時である必要はない */
  timestamp: isoDateLike.optional(),
})

export const MeetingSchema = z.object({
  title: z.string().min(1, "商談メモのタイトルは必須です"),
  /** 営業内容の本文。HubSpot 側では meeting の本文として表示される */
  body: z.string().min(1, "商談メモの本文は必須です"),
  /** 商談を行った日時 */
  startTime: isoDateLike,
  endTime: isoDateLike.optional(),
  outcome: z.enum(["SCHEDULED", "COMPLETED", "RESCHEDULED", "NO_SHOW", "CANCELED"]).optional(),
})

export const TaskSchema = z.object({
  subject: z.string().min(1, "タスク名は必須です"),
  body: z.string().optional(),
  /** 期限。未指定なら 3 営業日後などではなく「翌日 09:00 JST」を既定にする */
  dueDate: isoDateLike.optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "WAITING", "COMPLETED", "DEFERRED"]).default("NOT_STARTED"),
  type: z.enum(["CALL", "EMAIL", "TODO"]).default("TODO"),
})

export const SyncInputSchema = z.object({
  /**
   * 冪等キー。同じキーでの再実行は「作り直し」ではなく「更新のみ」になる。
   * 未指定なら会社名＋取引名＋商談日時から自動生成する。
   */
  syncKey: z.string().min(1).optional(),
  company: CompanySchema,
  contacts: z.array(ContactSchema).default([]),
  deal: DealSchema.optional(),
  meeting: MeetingSchema.optional(),
  /** 商談内容・営業状況のメモ。HubSpot の Note として保存される (要件: 商談内容はNoteへ保存) */
  note: NoteSchema.optional(),
  tasks: z.array(TaskSchema).default([]),
})

export type SyncInput = z.infer<typeof SyncInputSchema>
export type CompanyInput = z.infer<typeof CompanySchema>
export type ContactInput = z.infer<typeof ContactSchema>
export type DealInput = z.infer<typeof DealSchema>
export type MeetingInput = z.infer<typeof MeetingSchema>
export type NoteInput = z.infer<typeof NoteSchema>
export type TaskInput = z.infer<typeof TaskSchema>

/** zod のエラーを人間が読める 1 行ずつのリストに変換する */
export function formatZodError(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
}

/**
 * サンプル/テストデータを本番反映してしまう事故を防ぐガード。
 * `scripts/crm-sync/example.input.json` の会社名・ドメインと一致したら
 * --apply を機械的に拒否する (要件:「サンプルデータはHubSpotへ反映しない」)。
 */
const SAMPLE_MARKERS = ["株式会社サンプル商事", "sample-shoji.co.jp"]

export function isSampleData(input: SyncInput): boolean {
  const haystack = [input.company.name, input.company.domain].filter(Boolean).join(" ")
  return SAMPLE_MARKERS.some((marker) => haystack.includes(marker))
}
