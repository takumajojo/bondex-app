-- 028: 送り状(紙)の投函期限を依頼時に選べるようにする
--
-- 佐川の送り状は発送日の30日前からしか発行できない (E1-0046)。
-- そのため「いつまでに送り状を送るか」は [発送日-30日, 発送日前日] の範囲で
-- 代理店が依頼時に選ぶ (既定 = 最初の発送日の5営業日前)。
-- null = この機能より前の予約。null は郵送アラートの対象外
-- (既存予約は無視してよい・谷口さん 2026-08-28)。
alter table public.shipments
  add column if not exists label_mail_due date;

comment on column public.shipments.label_mail_due is
  '送り状(紙)の投函期限。依頼時に選択。null=旧予約(郵送アラート対象外)。発行が発送30日前からのため範囲は[発送-30日,発送)。';
