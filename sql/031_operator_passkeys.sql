-- 031: 運営管理画面のパスキー (WebAuthn / Touch ID / Face ID) — 2026-08-31 谷口さん指示
--
-- 「管理画面に入るのを厳しくしたい。指紋認証・Face ID的に」への対応。
-- 保存するのは公開鍵のみ (秘密鍵は端末のセキュアエンクレーブから出ない)。
-- 1台でも登録されると、ブラウザからの入場は生体認証必須になり、
-- パスワードは「新しい端末の登録時の本人確認」と Bearer サーバー間通信の専用になる。
create table if not exists public.operator_passkeys (
  credential_id text primary key,          -- base64url
  public_key    bytea not null,
  counter       bigint not null default 0,
  transports    text[],
  label         text,                      -- 端末名 (例: MacBook / iPhone)
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
alter table public.operator_passkeys enable row level security;
comment on table public.operator_passkeys is
  '運営管理画面のパスキー公開鍵。1台でも登録されるとブラウザからの入場は生体認証必須になる。RLSポリシーなし=サーバー専用。';
