# Supabase セットアップ手順 (BondEx Phase A + B-1〜B-3)

所要時間: 約 15 分

---

## 0. 現在地の確認

`https://supabase.com/dashboard/project/dscxftwfspgihkszfakk` にいる前提。
プロジェクト名: `takumajojo's Project` / Region: Tokyo / FREE プラン.

---

## 1. テーブル作成 (migration 001 + 002)

1. 左サイドバー「**SQL Editor**」をクリック
2. 「**+ New query**」
3. **migration 001** — プロジェクト内の `sql/001_shipments.sql` の中身を全部コピペ → Run (`Cmd+Enter`)
4. もう一度「+ New query」
5. **migration 002** — `sql/002_agencies_auth.sql` の中身を全部コピペ → Run

それぞれ `Success. No rows returned` が出れば OK。

確認: 左の「Table Editor」を開くと `shipments` / `agencies` / `user_agencies` の3つが見える。

---

## 2. API キー取得 (3つ)

1. 左サイドバー → 「**Project Settings**」(歯車アイコン)
2. 「**API**」セクション
3. 以下 **3つ**をコピー:

   | コピー対象 | 用途 |
   |---|---|
   | **Project URL** (例: `https://dscxftwfspgihkszfakk.supabase.co`) | 共通 |
   | **anon public** (Project API keys → anon) | 代理店向け (RLS effective) |
   | **service_role secret** ("Reveal" を押して見える) | BondEx 管理向け (RLS bypass) |

   ⚠️ `service_role` キーは管理者権限を持つので**絶対に公開しない**。

---

## 3. Vercel に環境変数を設定

`https://vercel.com/dashboard` → bondex-poc-main → Settings → Environment Variables

以下 **3つ** を追加 (**Production + Preview + Development** にチェック):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | (Project URL) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (anon public key) |
| `SUPABASE_SERVICE_ROLE_KEY` | (service_role secret) |

「Save」。

---

## 4. 再デプロイ

Deployments タブ → 最新デプロイ → ⋯ → Redeploy → **"Use existing Build Cache" を外して** Redeploy。

---

## 5. 代理店アカウント作成 (B-1)

代理店ユーザーは BondEx 管理者が手動で作成します。

### 5-1. 代理店マスタを登録

Supabase 「SQL Editor」で実行 (例: My Japan Planner):

```sql
insert into agencies (name, contact_email, contact_phone, contact_person, billing_address)
values (
  'My Japan Planner',
  'karen@myjapanplanner.com',
  '+81-3-6821-8472',
  'Karen Fujita',
  '東京都港区 ...'
)
on conflict (name) do update set
  contact_email = excluded.contact_email,
  contact_phone = excluded.contact_phone,
  contact_person = excluded.contact_person,
  billing_address = excluded.billing_address;
```

⚠️ `name` は voucher 発行時の `tourCompany` (オペレーター設定で入力する値) と**完全一致**させる。

### 5-2. Auth ユーザーを作成

Supabase ダッシュボード → 「**Authentication**」 → 「**Users**」 → 「**Add user**」 → 「Create new user」

- Email: `karen@myjapanplanner.com`
- Password: (任意のパスワード — 代理店に伝える)
- ✅ Auto Confirm User にチェック

### 5-3. user_agencies で紐付け

```sql
insert into user_agencies (user_id, agency_id)
select
  (select id from auth.users where email = 'karen@myjapanplanner.com'),
  (select id from agencies where name = 'My Japan Planner');
```

これで代理店が `https://bondex-poc-main.vercel.app/agency/login` から自社の案件状況を見られる状態に。

---

## 6. 動作確認

### BondEx 管理 (内部)
- `https://bondex-poc-main.vercel.app/operator` (共通パスワード)
- ヘッダーに「**ダッシュボード**」リンクが追加されている
- ダッシュボードで:
  - 全代理店の案件一覧 (RLS bypass)
  - ステータス手動更新
  - **月次請求書 PDF 発行**: 代理店 + 月選択 → ダウンロード

### 代理店 (外部)
- `https://bondex-poc-main.vercel.app/agency/login` (Supabase Auth)
- ログイン後 → 自社の案件のみ表示 (RLS effective)
- 追跡番号クリックでヤマト追跡ページへ
- 送り状 PDF へのリンクもある

### 旅行者 (公開)
- `https://bondex-poc-main.vercel.app/track/BDX-260629-XXX` (認証なし)
- voucher PDF にもこの URL が記載される
- 区間ごとのステータス + ヤマト追跡へのリンクが表示

---

## 7. 適格請求書発行事業者番号 (取得後)

`lib/invoice-pdf.tsx` 内の `registrationNumber` フィールドに登録番号を設定。
`/api/invoices/generate/route.tsx` の `bondex.registrationNumber` を埋める。

---

## トラブルシュート

### ダッシュボードに「Supabase が未設定です」
→ Vercel に env vars 設定 + Build Cache を**外して** Redeploy。

### 代理店ログインしても何も表示されない
→ `user_agencies` への紐付けが抜けている。`select * from user_agencies;` で確認。

### 代理店ダッシュボードに「アカウントに代理店が紐付いていません」
→ 5-3 を実行していない、または `agency_id` が間違い。

### `SUPABASE_SERVICE_ROLE_KEY` 漏洩したら
→ Supabase Project Settings → API → "Reset service_role key" → Vercel の env vars も更新。

---

## 次の Phase (B-4 以降)

- Slack/Notion Webhook 連携 (発行時自動通知)
- 旅程パターン学習 (parse_log テーブル)
- 代理店セルフサインアップ (招待 URL)
- 補償時のクレーム管理 (claim_cases テーブル)
