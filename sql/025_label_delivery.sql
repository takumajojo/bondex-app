-- 024: 送り状(伝票)の郵送先・差出人の指定
--
-- 背景: BondEx が発行した佐川の送り状は「紙」として旅行者の手元に届く必要がある。
-- 従来この郵送は完全に手作業・口頭合意で、システム上どこにも記録がなかった。
-- 2026-08-27 谷口さん指示で、依頼時に「どこへ送るか」「誰の名義で送るか」を選べるようにする。
--
-- 決定 (谷口さん 2026-08-28):
--   - 選択は 代理店ポータルの新規依頼画面 と 運営画面 の両方に置く
--   - 代理店の住所は請求先住所 (自由入力1行・4社中2社が未登録) では送り状に使えないため、
--     代理店マスタに構造化した「発送先住所」欄を新設して登録制にする

-- ---------------------------------------------------------------------------
-- 1) 代理店マスタ: 発送先住所 (ResidenceAddress と同じ形)
--    { name, phone, zip, prefecture, city, street, building }
--    lib/residence.ts の型をそのまま流用し、郵便番号↔住所の整合を担保する。
-- ---------------------------------------------------------------------------
alter table public.agencies
  add column if not exists ship_address jsonb;

comment on column public.agencies.ship_address is
  '送り状(紙)の郵送先/差出人に使う構造化住所。lib/residence.ts の ResidenceAddress 形。billing_address(請求先・自由入力)とは別物。';

-- ---------------------------------------------------------------------------
-- 2) 予約(区間)側: 郵送先と差出人の指定
--    予約単位の設定だが、区間ごとに分けて送る選択があるため区間行に持たせる。
-- ---------------------------------------------------------------------------
alter table public.shipments
  -- 送り先: agency=代理店(御社)宛 / hotel=ホテル宛(旅行者様気付)
  add column if not exists label_to text not null default 'agency',
  -- 複数区間かつ hotel のとき: false=最初のホテルへ一括 / true=区間ごとに各発送元ホテルへ
  add column if not exists label_split boolean not null default false,
  -- 差出人: bondex=株式会社JOJO / land_operator=登録済みの取引先 / travel_agent=第三者(手入力)
  add column if not exists label_sender text not null default 'bondex',
  -- travel_agent のときの入力値、および land_operator 選択時の発送時点スナップショット
  add column if not exists label_sender_info jsonb;

alter table public.shipments
  drop constraint if exists shipments_label_to_check;
alter table public.shipments
  add constraint shipments_label_to_check check (label_to in ('agency', 'hotel'));

alter table public.shipments
  drop constraint if exists shipments_label_sender_check;
alter table public.shipments
  add constraint shipments_label_sender_check
  check (label_sender in ('bondex', 'land_operator', 'travel_agent'));

comment on column public.shipments.label_to is
  '送り状(紙)の郵送先: agency=代理店宛 / hotel=ホテル宛(旅行者様気付)';
comment on column public.shipments.label_split is
  'hotel かつ複数区間のとき true で区間ごとに各発送元ホテルへ分送。false は最初のホテルへ一括。';
comment on column public.shipments.label_sender is
  '送り状を郵送する際の差出人: bondex / land_operator(登録済み取引先) / travel_agent(第三者・手入力)';
comment on column public.shipments.label_sender_info is
  '差出人の氏名・住所 (ResidenceAddress 形)。travel_agent は手入力値、land_operator は発送時点のスナップショット。';
