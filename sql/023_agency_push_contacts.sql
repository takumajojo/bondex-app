-- 023: 代理店へのプッシュ通知先 (配達完了などをメール以外でも届ける)
--   notify_whatsapp     : WhatsApp番号 (E.164 例 +819012345678)。Meta WhatsApp Cloud API で送信。
--   notify_line_user_id : LINE Messaging API の userId (公式アカウントを友だち追加した後に取得)。
-- どちらも null なら従来どおりメールのみ。送信は環境変数 (WHATSAPP_CLOUD_TOKEN 等) 設定後に有効。
alter table agencies
  add column if not exists notify_whatsapp     text,
  add column if not exists notify_line_user_id text;
