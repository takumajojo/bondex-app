-- 2026-09-17: 集荷元(発送元)ホテルのチェックイン日 (代理店フォーム入力・任意・日付のみ)。
-- 既存の from_check_in は「お届け先ホテルのチェックイン日」で意味が別。混同回避のため別列。
alter table shipments add column if not exists origin_check_in date;
