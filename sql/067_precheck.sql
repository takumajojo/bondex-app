-- sql/067_pickup_requests.sql を本番へ適用する「直前」に流す確認用クエリ (読み取りのみ・何も書き換えない)。
--
-- 062 の移行は、既存区間を次の3つに分ける:
--   accepted     … 佐川の問合番号がある / 集荷済み以降        → 手動依頼済みとして記録
--   needs_review … 今日以降の発送で「依頼済み」印 (pickup_requested_at) があるのに番号なし、
--                  または旧発行で issued なのに印も番号もなし → 要確認として記録 (Biz-Logi からは送れない)
--   no_row       … それ以外                                    → 記録なし = 未依頼
--
-- 注意: 「Excel で依頼したのに印も番号も付けていない」区間は no_row (未依頼) になり、Biz-Logi から送れてしまう。
-- 適用前に、下の一覧の no_row (今日以降) がすべて本当に未依頼かを運営が確認すること。
-- Excel で依頼済みの区間があれば、先に運営画面の「集荷手配（佐川）済み」を付ける (→ needs_review になる)。
--
-- 2026-11-03 時点の確認結果: accepted 21 (すべて配達完了・番号あり) / needs_review 0 /
-- no_row 今日以降 4 (11/07・11/11・11/16・11/18 = 谷口さん確認済みの未依頼) / 取消は対象外。

-- 1) 件数の内訳
with c as (
  select s.*,
    (jsonb_typeof(s.tracking_numbers) = 'array' and jsonb_array_length(s.tracking_numbers) > 0) as has_num,
    case when s.status = 'cancelled' then 'excluded (取消)'
         when (jsonb_typeof(s.tracking_numbers) = 'array' and jsonb_array_length(s.tracking_numbers) > 0)
              or s.status in ('picked_up', 'in_transit', 'delivered') then 'accepted'
         when s.shipment_date >= (now() at time zone 'Asia/Tokyo')::date
              and (s.pickup_requested_at is not null or s.status = 'issued') then 'needs_review'
         else 'no_row' end as cls
  from public.shipments s
)
select cls, (shipment_date >= (now() at time zone 'Asia/Tokyo')::date) as upcoming, count(*) as legs
  from c group by 1, 2 order by 1, 2;

-- 2) 今日以降の発送の区間を1件ずつ (運営が実際の依頼状況と突き合わせる)
with c as (
  select s.*,
    (jsonb_typeof(s.tracking_numbers) = 'array' and jsonb_array_length(s.tracking_numbers) > 0) as has_num,
    case when s.status = 'cancelled' then 'excluded (取消)'
         when (jsonb_typeof(s.tracking_numbers) = 'array' and jsonb_array_length(s.tracking_numbers) > 0)
              or s.status in ('picked_up', 'in_transit', 'delivered') then 'accepted'
         when s.shipment_date >= (now() at time zone 'Asia/Tokyo')::date
              and (s.pickup_requested_at is not null or s.status = 'issued') then 'needs_review'
         else 'no_row' end as cls
  from public.shipments s
)
select booking_id || '-L' || (leg_index + 1) as leg, shipment_date, status,
       pickup_requested_at is not null as marked, coalesce(has_num, false) as has_tracking_number, cls
  from c
 where shipment_date >= (now() at time zone 'Asia/Tokyo')::date
 order by shipment_date, booking_id, leg_index;

-- 3) 既に記録がある場合 (再適用時) は件数を確認
select to_regclass('public.pickup_requests') is not null as pickup_requests_exists;
