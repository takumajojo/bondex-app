-- sql/079_b2c_legal_versions.sql の切り戻し。
-- b2c_charge_check は 074 の版に戻す（sql/074 の「7. 請求してよいかの再確認」を流し直す）。
-- 規約の本文（b2c_legal_documents）と予約の同意の列は、記録として残す（消さない）。
-- 本文の表まで消すのは、本番で一度も使っていない（行が 0）ことを確かめた時だけ:
--   select count(*) from public.b2c_legal_documents;  -- 0 のときだけ下の drop を流す
--   drop table public.b2c_legal_documents; drop function public.b2c_legal_documents_append_only();
alter table public.b2c_orders drop constraint if exists b2c_orders_card_consent_chk;
