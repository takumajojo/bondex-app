# BondEx Sales OS — Phase 2 設計書 (3) DB 設計

対象成果物: 2(DB設計)
基盤: 既存の Supabase プロジェクト（`sql/001〜023` の続きとして `024〜029` を追加）
方針: 既存テーブルは **1 つも変更しません**。すべて新規テーブルの追加のみです。

---

## 0. 6 テーブルの役割（先に全体像）

| # | テーブル | 一言でいうと | 追記のみ / 更新あり |
| --- | --- | --- | --- |
| 024 | `sales_company` | HubSpot の会社の写し + AIが持つ営業状態 | 更新あり |
| 025 | `sales_target_domain` | 「このドメインは営業対象」の名簿。**自動で育つ** | 更新あり |
| 026 | `sales_event` | 起きたこと全部（メール/会議/予定）の台帳 | **追記のみ・不変** |
| 027 | `sales_insight` | AI が各イベントから抽出した構造化データ | **追記のみ・不変** |
| 028 | `sales_change_set` | 「HubSpot をこう変える」提案と、その結果 | 更新あり（状態遷移） |
| 029 | `sales_daily_report` | 毎朝のレポート本文と、その根拠 | 追記のみ |

**設計の芯**: `sales_event` と `sales_insight` は**絶対に更新も削除もしません**。
「なぜ AI がそう判断したか」を後から必ず再現できるようにするためです。
プロンプトを改善したとき、過去のイベントを流し直して精度を比較できます（`--replay`）。

---

## 1. `024_sales_company.sql`

HubSpot の Company に 1:1 で対応します。HubSpot が「人が見る正」、この表が「AI が使う作業用の写し」です。

```sql
-- 024: BondEx Sales OS — 会社の営業状態
--   HubSpot Company の写し。hubspot_company_id が唯一の対応キー。
--   会社の同定は「社名」ではなく「ドメイン」で行う (Phase1 で社名が空の会社が実在したため)。
create table if not exists sales_company (
  id                    uuid primary key default uuid_generate_v4(),
  hubspot_company_id    text not null unique,
  domain                text unique,             -- 例: "trix.co.jp" (小文字・www除去で正規化)
  name                  text,
  category              text,                    -- HubSpot bondex_category の写し

  -- 営業状態 (HubSpot の bondex_* と同期する)
  stage                 text not null default 'not_started',
  stage_updated_at      timestamptz,
  temperature           text not null default 'cold',
  is_target             boolean not null default false,

  -- AI が抽出した構造化データ (HubSpot では ai_brief 1欄に集約されるもの)
  pain                  text,                    -- 現在の課題
  price_sense           text,                    -- 価格感
  competitors           text[],                  -- 競合
  timeline              text,                    -- 導入時期
  decision_maker        text,                    -- 決裁者
  risk                  text,                    -- リスク
  ai_comment            text,                    -- AIコメント (営業への助言)
  ai_brief              text,                    -- HubSpot に書いた本文そのもの (差分検出用)

  -- 接触・返信の実績 (すべて機械計算。AI は関与しない)
  first_outbound_at     timestamptz,
  last_contact_at       timestamptz,
  last_inbound_at       timestamptz,
  last_outbound_at      timestamptz,
  reply_count           integer not null default 0,
  reply_median_seconds  integer,                 -- 返信速度の中央値
  reply_speed           text,                    -- fast/normal/slow/cold

  owner_email           text,                    -- 担当営業
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists sales_company_stage_idx    on sales_company (stage) where is_target;
create index if not exists sales_company_temp_idx     on sales_company (temperature) where is_target;
create index if not exists sales_company_lastcontact_idx on sales_company (last_contact_at desc nulls last);
alter table sales_company enable row level security;
```

**`stage` / `temperature` / `reply_speed` は文字列にします**（enum 型にしません）。
段階を1つ足すたびに DB マイグレーションが必要になるのを避けるためです。
値の妥当性はアプリ側（TypeScript の型 + Zod）で担保します。

---

## 2. `025_sales_target_domain.sql`

**「Gmail のどのスレッドを見るか」を決める名簿**です。設計上いちばん重要な表かもしれません。

```sql
-- 025: BondEx Sales OS — 営業対象ドメイン名簿
--   Gmail 取り込みの第0段フィルタ。ここに無いドメインは原則 AI に渡さない。
--   谷口さんが BondEx の営業メールを送った時点で自動追加される (自己成長する名簿)。
create table if not exists sales_target_domain (
  domain          text primary key,              -- 小文字正規化済み
  company_id      uuid references sales_company(id) on delete set null,
  status          text not null default 'active',-- active / excluded / pending
  added_by        text not null,                 -- 'outbound_email' / 'hubspot_sync' / 'manual'
  added_reason    text,                          -- 追加根拠 (どのメールか等)
  excluded_reason text,                          -- 除外した理由 (人が除外したとき)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists sales_target_domain_status_idx on sales_target_domain (status);
alter table sales_target_domain enable row level security;
```

`status` の意味:
- `active` … 営業対象。このドメインのメールは AI に渡す
- `excluded` … 明確に対象外（メルマガ配信元・他事業・取引先）。**人が除外したら AI は覆さない**
- `pending` … 判断保留。朝レポートに「これは営業対象ですか？」として出す

初期投入は Phase 4 で HubSpot の 27 社（`bondex_category` 入り）のドメインから行います。
除外リストの初期値は Phase 1 の実測から作ります（`udemy.com` `squareup.com` `aeris.net` `curama.jp`
`booking.com` `github.com` `visasq.info` `endclothing.com` `jprep.jp` `kencorp.co.jp` 等）。

---

## 3. `026_sales_event.sql` — 追記のみ・不変

```sql
-- 026: BondEx Sales OS — 営業イベント台帳 (append-only / 不変)
--   Gmail / Calendar / Fathom / (将来)WhatsApp の生イベントを1つの形に正規化して溜める。
--   ここは絶対に UPDATE / DELETE しない。AI 判断の再現性の土台。
create table if not exists sales_event (
  id             uuid primary key default uuid_generate_v4(),
  channel        text not null,                  -- gmail / calendar / fathom / whatsapp / phone
  direction      text not null,                  -- inbound / outbound / system
  external_id    text not null,                  -- Gmail message_id / Fathom recording_id 等
  occurred_at    timestamptz not null,
  company_id     uuid references sales_company(id) on delete set null,  -- 未紐付けなら null
  domain         text,                           -- 紐付け前でも残す (後から会社に結び直せる)
  subject        text,
  body           text,                           -- 正規化済み本文 (HTMLは除去)
  participants   jsonb not null default '[]',    -- [{email,name,role}]
  raw            jsonb,                          -- 元データ (デバッグ用)
  triage         text,                           -- sales / not_sales / unknown (A1の結果)
  triage_conf    numeric(3,2),
  processed_at   timestamptz,                    -- A2/A3 が処理した時刻。null なら未処理
  created_at     timestamptz not null default now(),

  unique (channel, external_id)                  -- ★冪等性を DB レベルで保証
);
create index if not exists sales_event_unprocessed_idx on sales_event (occurred_at)
  where processed_at is null;
create index if not exists sales_event_company_idx on sales_event (company_id, occurred_at desc);
alter table sales_event enable row level security;
```

**`unique (channel, external_id)` が二重処理を防ぐ最後の砦です。**
アプリのバグでも、cron の二重起動でも、同じメールが 2 回 CRM に反映されることはありません。

---

## 4. `027_sales_insight.sql` — 追記のみ・不変

```sql
-- 027: BondEx Sales OS — AI が1イベントから抽出した構造化データ (append-only / 不変)
--   sales_company の現在値は、この履歴の最新を畳み込んだもの。
create table if not exists sales_insight (
  id                uuid primary key default uuid_generate_v4(),
  event_id          uuid not null references sales_event(id) on delete cascade,
  company_id        uuid references sales_company(id) on delete set null,
  agent             text not null,                -- a2_thread / a3_meeting
  model             text not null,                -- 実際に使ったモデルID
  prompt_version    text not null,                -- プロンプトのバージョン (回帰比較用)

  pain              text,
  price_sense       text,
  competitors       text[],
  timeline          text,
  decision_maker    text,
  next_action       text,
  next_action_due   date,
  temperature       text,
  risk              text,
  summary           text,                          -- AI要約
  proposed_stage    text,                          -- 提案ステージ
  confidence        numeric(3,2) not null,
  evidence          jsonb not null default '[]',   -- [{field, quote}] 判断根拠の原文引用
  input_tokens      integer,
  output_tokens     integer,
  cost_usd          numeric(10,6),                 -- 1件あたりの実費 (費用監視用)
  created_at        timestamptz not null default now()
);
create index if not exists sales_insight_company_idx on sales_insight (company_id, created_at desc);
alter table sales_insight enable row level security;
```

`evidence` に原文引用を必ず入れさせます。**「AI が勝手にそう言った」を無くす**ためで、
誤判定を見つけたとき、どの文をどう読み違えたかが即座に分かります。
`cost_usd` を1件ずつ持たせるのは、月額費用の実測を後から積み上げるためです。

---

## 5. `028_sales_change_set.sql` — DRY RUN の実体

```sql
-- 028: BondEx Sales OS — HubSpot への変更提案と実行結果
--   「本番反映前に必ず DRY RUN」「変更前後の差分レポート」を仕組みとして満たす表。
--   AI は HubSpot を直接触らない。必ずこの表を経由する。
create table if not exists sales_change_set (
  id              uuid primary key default uuid_generate_v4(),
  batch_id        uuid not null,                 -- 1回の実行でまとめて作られたものを束ねる
  company_id      uuid references sales_company(id) on delete set null,
  source_event_id uuid references sales_event(id) on delete set null,
  insight_id      uuid references sales_insight(id) on delete set null,

  object_type     text not null,                 -- company / contact / note / task / meeting
  hubspot_id      text,                          -- 更新時のみ。作成時は null
  operation       text not null,                 -- create / update / delete
  field           text,                          -- update のとき対象項目
  before_value    text,                          -- ★変更前
  after_value     text,                          -- ★変更後
  payload         jsonb,                         -- create のとき本体
  external_ref    text,                          -- bondex-event-id (重複防止の埋め込み値)

  reason          text not null,                 -- なぜこの変更が必要か (日本語)
  confidence      numeric(3,2),
  auto_apply      boolean not null default false,-- R1〜R6 を通ったか
  status          text not null default 'planned',
    -- planned  : DRY RUN 済み・未反映
    -- applied  : HubSpot へ反映済み
    -- rejected : 人が却下
    -- failed   : 反映を試みたが失敗
    -- skipped  : 重複などで不要と判明
  applied_at      timestamptz,
  error           text,
  created_at      timestamptz not null default now()
);
create index if not exists sales_change_set_pending_idx on sales_change_set (created_at)
  where status = 'planned';
create index if not exists sales_change_set_batch_idx on sales_change_set (batch_id);
alter table sales_change_set enable row level security;
```

### この1表が絶対条件を満たす仕組み

| 絶対条件 | どう満たすか |
| --- | --- |
| 本番反映前に必ず DRY RUN | `--apply` なしの実行は `status='planned'` を作って終わる。HubSpot へは 1 バイトも送らない |
| 変更前後の差分レポート | `before_value` / `after_value` を全行持つ。レポートは `batch_id` で束ねて出すだけ |
| 重複作成禁止 | `external_ref` + `sales_event.unique` + HubSpot 側の本文検索 = 三重 |
| 既存データを壊さない | `operation='delete'` は `auto_apply=false` 固定。人の承認なしには絶対に実行されない |

---

## 6. `029_sales_daily_report.sql`

```sql
-- 029: BondEx Sales OS — 毎朝9時の営業レポート
create table if not exists sales_daily_report (
  id            uuid primary key default uuid_generate_v4(),
  report_date   date not null unique,            -- JST の日付
  body_text     text not null,                   -- メール本文 (プレーンテキスト)
  body_html     text,                            -- ダッシュボード表示用
  metrics       jsonb not null,                  -- 10指標の数値スナップショット
  top10         jsonb not null,                  -- 今日やるべき会社TOP10 (根拠付き)
  pending_count integer not null default 0,      -- 承認待ちの change_set 件数
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);
alter table sales_daily_report enable row level security;
```

`metrics` を毎日スナップショットとして残すので、**「先週より Hot が増えたか」が
後から計算できます**。HubSpot 無料プランにはこの履歴機能がありません。

---

## 7. RLS（行レベルセキュリティ）方針

全テーブルで RLS を有効化し、**ポリシーを1つも定義しません**（= 匿名・認証ユーザーからは全拒否）。
アクセスは `service_role` を持つサーバー側コードのみです。
既存の `contact_inquiries`（009）と同じ方針で、営業情報が公開クライアントから読まれることはありません。

ダッシュボード `/sales` は Next.js の **サーバーコンポーネント**から `service_role` で読み、
既存の `middleware.ts` の認証で保護します（新しい認証の仕組みは作りません）。

---

## 8. データ量の見積もり

| テーブル | 1年後の想定行数 | 備考 |
| --- | --- | --- |
| `sales_company` | 300 | 営業対象の増加ペース次第 |
| `sales_target_domain` | 600 | 除外リスト含む |
| `sales_event` | 15,000 | 1日40件 × 365日 |
| `sales_insight` | 4,000 | 1日10件 |
| `sales_change_set` | 20,000 | 1イベントあたり平均1.5変更 |
| `sales_daily_report` | 365 | |

Supabase の無料枠（500MB）に対し、本文を含めても年間 100MB 未満の想定です。**追加費用なし**。
2 年目以降は `sales_event.raw` と `body` を 12 ヶ月で圧縮アーカイブする運用を入れます。
