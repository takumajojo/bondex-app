-- 月次請求書の「承認 → 代理店送付」フローのための状態列を invoice_sends に追加する。
--
-- 運用 (2026-10-09 谷口さん指示):
--   月初1営業日 … cron(monthly-invoices) が請求書を生成し、谷口さんへ「確認依頼」メールを送る
--                  (この時点で invoice_sends 行が作られる。approved_at / sent_to_agency_at は NULL)。
--   谷口さんが金額を確認して「承認」 … approved_at を立てる。
--   翌営業日(第2営業日) … cron(invoice-autosend) が承認済み・未送付の請求書を代理店へ自動送付し、
--                           sent_to_agency_at を立てる。
--
-- いずれも追加のみ。既存の (agency, month) 主キー・RLS・既存データはそのまま。
-- 既存の履歴行は approved_at=NULL のままなので、自動送付の対象には一切ならない
-- (承認したものだけが代理店へ送られる)。

alter table invoice_sends add column if not exists approved_at       timestamptz;
alter table invoice_sends add column if not exists approved_by       text;
alter table invoice_sends add column if not exists sent_to_agency_at timestamptz;

comment on column invoice_sends.approved_at       is '谷口さんが金額を確認し承認した日時 (NULL=未承認)。承認済みのみ自動送付対象。';
comment on column invoice_sends.approved_by       is '承認した運用者 (現状は operator 固定)。';
comment on column invoice_sends.sent_to_agency_at is '代理店へ実際に請求書を送付した日時 (NULL=未送付)。二重送付防止に使う。';

-- 承認済み・未送付を素早く引くための部分インデックス (invoice-autosend cron 用)。
create index if not exists invoice_sends_pending_send_idx
  on invoice_sends (approved_at)
  where approved_at is not null and sent_to_agency_at is null;
