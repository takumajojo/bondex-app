-- 027: 送り状(紙)を郵送した記録
--
-- 送り状が旅行者の手元に届かないと当日ホテルで荷物を出せない = 配送が丸ごと止まる。
-- 「投函期限(発送日の5営業日前)を過ぎたら鳴り続ける」アラートを成立させるため、
-- 郵送したことを記録する列を持つ。運営が「郵送済みにする」を押すまで消えない。
alter table public.shipments
  add column if not exists label_sent_at timestamptz;

comment on column public.shipments.label_sent_at is
  '送り状(紙)を郵送した日時。null の間は運営ダッシュボードに送付アラートを出す。';

-- 未郵送の抽出を軽くする部分インデックス (cron が毎朝全件走査するため)
create index if not exists shipments_label_sent_at_idx
  on public.shipments (label_sent_at)
  where label_sent_at is null;
