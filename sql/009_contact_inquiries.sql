-- BondEx — 導入相談 / 問い合わせフォームの受信テーブル
--
-- LP の「導入相談」フォーム (/contact) が POST /api/contact 経由で保存する。
-- service_role でのみ書き込む (公開クライアントからの直接アクセスは無し)。
-- 通知メール (Resend) が未設定でも、ここに残るので取りこぼさない。

create table if not exists contact_inquiries (
  id           uuid primary key default uuid_generate_v4(),
  company      text,
  name         text,
  email        text not null,
  message      text not null,
  source       text,                       -- 例: "lp" (どこから来たか)
  user_agent   text,
  created_at   timestamptz not null default now(),
  handled      boolean not null default false
);

create index if not exists contact_inquiries_created_idx on contact_inquiries (created_at desc);

-- RLS 有効化 (service_role は bypass するので管理 API は影響なし)。
-- 認証ユーザー・匿名ユーザーからの直接参照は許可しない (ポリシー未定義 = 全拒否)。
alter table contact_inquiries enable row level security;
