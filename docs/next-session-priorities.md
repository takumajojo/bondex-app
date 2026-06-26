# 月曜の最優先タスク（事務所iMacでの作業）

最終更新: 2026-06-26（金曜夜）

次のセッションで迷わずスタートするための申し送り。
関連: [scope-decisions-2026-06-26.md](./scope-decisions-2026-06-26.md) /
[shipment-deferred-design.md](./shipment-deferred-design.md)

> ⚠️ 注記: 当初「docs/database-design.md（今夜作成済）」を前提にしていたが、
> このファイルは**まだ存在しない**。今夜作成済みなのは上記2ドキュメント。
> DBの暫定テーブルリストは [scope-decisions-2026-06-26.md](./scope-decisions-2026-06-26.md) の §6 にある。
> `docs/database-design.md` を起こすこと自体が優先度2の最初のサブタスク。

---

## 【優先度1: 必須】ヤマトの伝票が問題なく出力されることを確認

今夜の実装（30日制約ガード＋deferred＋ES003001 UX）が本番で正しく動くかの検証。
**`.env` が iMac にあるため、実APIテストはここで初めて行える。**

- [ ] `git pull` で `feat/shipment-deferred-and-notifications` ブランチを取り込む
- [ ] `npm run dev` で起動、`/operator` を開く
- [ ] **検証1**: 未来日付（10日後・20日後）の旅程で伝票が発行されるか
- [ ] **検証2**: 過去日付の旅程で 400 エラーが綺麗に返るか（日本語メッセージ表示）
- [ ] **検証3**: 30日超（60日後等）の旅程で **deferred 表示**（「発行予約済み — YYYY-MM-DD から発行可能」）が出るか
- [ ] 問題なければ **PR作成 → main マージ → Vercel 本番反映**

PR作成リンク: https://github.com/takumajojo/bondex-app/pull/new/feat/shipment-deferred-and-notifications

---

## 【優先度2: 月曜午後以降】DB導入（Supabase）

- 既存資産: **Supabase / Resend アカウント済、独自ドメイン取得済**
- [ ] **まず `docs/database-design.md` を作成**
      （[scope-decisions-2026-06-26.md](./scope-decisions-2026-06-26.md) §6 の暫定テーブルリストを起点に、
      関係・カラム・制約を確定する）
- [ ] スキーマ実装
- [ ] `lib/booking-store.ts` を **localStorage → Supabase** に書き換え

暫定テーブル（§6 再掲、写真関連は含めない）:
`agency, agency_user, hotel, traveler, booking, shipment, shipment_event,
shipment_tracking, notification_setting, notification_log, claim_case`

---

## 【優先度低・後回し】

- 認証（Supabase Auth）
- トラッキング画面（代理店向け＋旅行者向け）
- 通知システム（Resend 実装 — 設計は [shipment-deferred-design.md](./shipment-deferred-design.md) §C）
- 自動発行 Vercel Cron（設計は [shipment-deferred-design.md](./shipment-deferred-design.md) §B）
- `claim_case` テーブル本格設計

---

## 【今夜決まった事業方針（再掲）】

- **スコープ**: 当面 operator フローのみ、traveler / hotel staff UI は保留
- **写真機能**: 使わない（伝票を貼って終わり）
- **トラブル対応**: 当面「最強の対応」＋ヤマト標準補償、窓口は代表者個人
- **トラッキング**: 代理店と旅行者の両方が見られる、10分遅れ OK、
  旅行者は認証なしのトークンURL方式
- **認証**: 代理店ユーザーのみ Supabase Auth、旅行者は会員登録なし

詳細な決定事項は [scope-decisions-2026-06-26.md](./scope-decisions-2026-06-26.md) を参照。
