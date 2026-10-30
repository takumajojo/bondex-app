-- 追跡通知 (集荷/配達メール) の「宛先ごと」の送信状態を永続化する。
-- レビュー 7c234a4 是正の第2弾 + 第3弾 (送信前 write-ahead):
--   処理中(pending)・成功(sent)・未送信(failed)・結果不明(ambiguous)・手動確認(manual) を宛先ごとに区別する。
--   - pending : 外部送信の「前」に記録する write-ahead 状態。送信成功後・結果保存前に処理が止まっても、
--               この行と初回試行時刻 first_attempt_at・固定の冪等キーが残る (再開時に二重送信を防ぐ)。
--   - sent    : 送信成功。以後その宛先へは再送しない。
--   - failed  : 明確な失敗。次回に同じ冪等キーで再送してよい。
--   - ambiguous: 結果不明。重複防止窓(24h)の内側だけ再試行し、窓を越えたら manual へ。
--   - manual  : 人手確認。自動では送らない。shipments.*_notified_at (送信済み日時) では代用しない。
--   重複防止窓の判定は first_attempt_at (初回試行時刻) を起点にする。起点は最初の write-ahead で一度だけ
--   記録し、再試行・エラー種別の変化では動かさない。
-- 冪等キーは「正規化した宛先アドレス」由来 (lib/agency-status-notify / lib/tracking/notify-state)。
-- service_role (RLS を通過) からのみ読み書きする運用。
create table if not exists public.tracking_notifications (
  shipment_id      uuid not null references public.shipments(id) on delete cascade,
  kind             text not null check (kind in ('picked_up','delivered')),
  recipient        text not null,               -- 正規化済み (小文字) の宛先アドレス
  state            text not null check (state in ('pending','sent','failed','ambiguous','manual')),
  idempotency_key  text,                         -- 固定の冪等キー `<base>:<recipient>` (送信前に記録・不変)
  first_attempt_at timestamptz,                  -- 初回試行を記録した時刻 (24h 超の未確定で manual へ。起点は動かさない)
  attempt_owner    text,                          -- 送信権を取得した実行のトークン (結果保存の所有権確認に使う)
  error            text,
  updated_at       timestamptz not null default now(),
  primary key (shipment_id, kind, recipient)
);
-- 既存テーブルがあっても前進できるようにする (本番未適用のため通常は上の新規作成で完結)。
alter table public.tracking_notifications add column if not exists first_attempt_at timestamptz;
alter table public.tracking_notifications add column if not exists attempt_owner    text;
-- state に pending を許可する (既存の check 制約を張り替える。制約名は自動/明示の両方に対応)。
alter table public.tracking_notifications drop constraint if exists tracking_notifications_state_check;
alter table public.tracking_notifications drop constraint if exists tracking_notifications_state_chk;
alter table public.tracking_notifications
  add constraint tracking_notifications_state_chk
  check (state in ('pending','sent','failed','ambiguous','manual'));
alter table public.tracking_notifications enable row level security;
-- ポリシーは作らない = anon/authenticated からは触れない (service_role は RLS を通過)。
create index if not exists idx_tracking_notifications_lookup
  on public.tracking_notifications (shipment_id, kind);
