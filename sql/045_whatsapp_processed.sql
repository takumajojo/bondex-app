-- WhatsApp 自動応答のべき等性テーブル (2026-09-30)。
-- WhatsApp は同一メッセージを再送しうるため、処理済み message_id を記録して
-- 二重返信を防ぐ (app/api/whatsapp/webhook)。
create table if not exists whatsapp_processed (
  message_id text primary key,
  created_at timestamptz not null default now()
);

-- 古い行の掃除用 (任意・手動 or 定期)。30日より前は削除してよい。
-- delete from whatsapp_processed where created_at < now() - interval '30 days';
