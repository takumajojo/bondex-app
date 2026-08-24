-- 022: 団体ダッシュボードの期限付き共有リンク (添乗員用)
-- 添乗員はアカウント不要。運営/代理店が発行した token 付き URL (/g/<token>) で
-- 自分の担当団体だけを閲覧できる (読み取り専用・料金/請求は返さない)。
create table if not exists group_shares (
  token       text primary key,           -- ランダム 32+ 文字 (URL に載る秘密)
  booking_id  text not null,
  expires_at  timestamptz not null,
  created_by  text not null default 'operator', -- 'operator' または代理店名
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists group_shares_booking_idx on group_shares (booking_id);

-- RLS: ポリシーなしで有効化 = service_role (サーバー) のみアクセス可。
-- 公開エンドポイントはサーバー側で token を検証して返す。
alter table group_shares enable row level security;
