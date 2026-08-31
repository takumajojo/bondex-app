-- 030: 月次請求書の送付記録 (2026-08-31 スケール監査・フェーズ2)
--
-- monthly-invoices cron は代理店数に比例して実行時間が伸び、タイムアウトで途中終了すると
-- GitHub Actions が先頭から再実行する。送付記録が無いと、先に処理済みの代理店へ
-- 請求書メールが二重送付される。送付済みマーカーでスキップできるようにする。
create table if not exists public.invoice_sends (
  agency     text not null,
  month      text not null, -- YYYY-MM
  invoice_no text,
  sent_to    text[],
  created_at timestamptz not null default now(),
  primary key (agency, month)
);
alter table public.invoice_sends enable row level security;
comment on table public.invoice_sends is
  '月次請求書の送付記録 (二重送付防止)。RLSポリシーなし=サーバー専用。';
