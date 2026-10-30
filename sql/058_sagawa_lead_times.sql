-- 058: 佐川 配達日数 (リードタイム) マスタ
--
-- 背景: 配達希望日の検証は全ルート一律「発送翌日〜7日」(lib/carrier.ts deliveryRule) で、
--   長距離の翌日不可などは Ship&co の発行時エラー任せだった。佐川「配達日数検索」
--   (https://www2.sagawa-exp.co.jp/send/days/) を郵便番号で照会した結果を保持し、
--   ルートごとの最短お届け日 (発送日 + days) を予約入力時点で出せるようにする。
--
-- 調査で確定した事実 (2026-10-30, data/sagawa-lead-times/README.md):
--   - 日数は「発地の担当営業所 × 着地の担当営業所」で決まる (同一営業所なら郵便番号が違っても同じ)。
--   - 行きと帰りで日数が違う組み合わせが約17%ある → 必ず方向つきで持つ。
--   - 検索結果は日数のみ (時間帯は出ない)。days は「発送日 + days 日」でお届け。
--
-- 引き方 (lib/sagawa-lead-time.ts):
--   1) sagawa_lead_times (郵便番号ペア完全一致)
--   2) sagawa_zip_offices で両郵便番号の担当営業所を引き → sagawa_office_lead_times
--   3) どちらも無ければ佐川サイトへその場で照会 → 1)〜3) のテーブルへ保存 (source='live')
--
-- 書き込み・読み出しともサーバー (service_role) のみ。RLS を有効にしてポリシーは作らない
-- (= anon / authenticated からは見えない)。

create table if not exists sagawa_lead_times (
  from_zip     text not null check (from_zip ~ '^[0-9]{7}$'),
  to_zip       text not null check (to_zip ~ '^[0-9]{7}$'),
  from_office  text,
  to_office    text,
  days         smallint not null check (days between 0 and 14),
  source       text not null default 'live',  -- national_to_tokyo / spot_to_tokyo / tourist_matrix / live / manual
  fetched_at   timestamptz not null default now(),
  primary key (from_zip, to_zip)
);

create table if not exists sagawa_zip_offices (
  zip         text primary key check (zip ~ '^[0-9]{7}$'),
  office      text not null,
  prefecture  text,
  city        text,
  town        text,
  fetched_at  timestamptz not null default now()
);

create table if not exists sagawa_office_lead_times (
  from_office      text not null,
  to_office        text not null,
  days             smallint not null check (days between 0 and 14),
  sample_from_zip  text,
  sample_to_zip    text,
  fetched_at       timestamptz not null default now(),
  primary key (from_office, to_office)
);

-- 月次の再取得で「古い行」を拾うためのインデックス
create index if not exists idx_sagawa_lead_times_fetched_at on sagawa_lead_times (fetched_at);
create index if not exists idx_sagawa_office_lead_times_fetched_at on sagawa_office_lead_times (fetched_at);

alter table sagawa_lead_times enable row level security;
alter table sagawa_zip_offices enable row level security;
alter table sagawa_office_lead_times enable row level security;
