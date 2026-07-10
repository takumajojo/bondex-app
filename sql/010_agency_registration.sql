-- BondEx — 代理店セルフ会員登録 + 決済方法 + 承認フロー
--
-- 会員登録 (/agency/signup → /api/agency/register) が agencies に行を作る。
-- 初期 status は 'pending'。BondEx 管理画面 (/operator) で 'active' に承認するまで
-- バウチャー発行はできない。
--
-- 決済方法 (payment_method):
--   'invoice' … 月次請求書払い (国内のみ)
--   'card'    … 1 件ごと Stripe カード決済 (国内・海外)
-- 海外代理店 (is_domestic = false) は 'card' のみ。

alter table agencies
  add column if not exists country            text,                       -- 例: 'JP', 'US', 'FR'
  add column if not exists is_domestic        boolean not null default true, -- true = 国内 (日本)
  add column if not exists payment_method      text    not null default 'invoice', -- 'invoice' | 'card'
  add column if not exists status              text    not null default 'active',   -- 'pending' | 'active' | 'suspended'
  add column if not exists stripe_customer_id  text,
  add column if not exists card_on_file        boolean not null default false,
  add column if not exists default_currency    text    not null default 'jpy',
  add column if not exists created_via          text;                        -- 'self_signup' | null (手動登録)

-- 既存の手動登録済み代理店は status='active' 扱いにしておく (デフォルトが active なので
-- 新規カラム追加時点で既存行は自動的に active)。セルフ登録のみ pending にする
-- (アプリ側 /api/agency/register で status='pending', created_via='self_signup' を明示指定)。

comment on column agencies.status is 'pending=承認待ち / active=有効 / suspended=停止';
comment on column agencies.payment_method is 'invoice=月次請求書 / card=Stripeカード';
comment on column agencies.card_on_file is 'Stripe に保存済みカードがあるか';
