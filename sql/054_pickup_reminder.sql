-- 旅行者向け集荷リマインド (2026-10-27)。
-- 集荷前日18時JST / 当日8時JST に、旅行者の WhatsApp へ「フロントへお預けください」を
-- テンプレ(bondex_pickup_reminder)で送る。連絡先は代理店が予約時に入力(=旅行者の同意前提)。
--
-- 設計: docs/b2c/B2C_DESIGN_v1.1.md と整合。メールは使わない(お客様メールは代理店も非保持)。
-- 二重送信防止は既存の "*_sent_at IS NULL → 送信 → now()" パターンを踏襲。

-- ── shipments: 旅行者連絡先・同意・送付元名・集荷元チェックアウト日・送信済みフラグ ──
alter table shipments
  -- 旅行者/ツアー代表の WhatsApp 番号 (E.164 例 +819012345678)。代理店が任意入力。
  add column if not exists traveler_whatsapp text,
  -- 代理店が「お客様はBondExからのWhatsApp通知に同意済み」をチェックした記録 (Meta オプトイン要件)。
  add column if not exists reminder_consent boolean not null default false,
  -- お客様に表示する送付元名 (= 申込代理店名/ツアー名。ランオペ名ではない)。テンプレ {{1}}。
  add column if not exists reminder_sender_name text,
  -- この予約で集荷リマインドを送るか (フォームの「WhatsApp送信」チェック)。
  add column if not exists reminder_enabled boolean not null default false,
  -- 集荷元ホテルのチェックアウト日 (集荷日と比較して注意喚起するため。フォームで必須入力)。
  add column if not exists origin_check_out date,
  -- 前日18時リマインド送信済み日時 (二重送信防止)。
  add column if not exists pickup_reminder_eve_sent_at timestamptz,
  -- 当日8時リマインド送信済み日時 (二重送信防止)。
  add column if not exists pickup_reminder_day_sent_at timestamptz,
  -- 直近の送信失敗理由 (管理画面で確認・再送判断に使う)。
  add column if not exists pickup_reminder_error text;

-- ── agencies: 代理店単位の集荷リマインド マスタON/OFF (既定ON。OFFにするとその代理店は一切送らない) ──
alter table agencies
  add column if not exists pickup_reminder_enabled boolean not null default true;

-- 対象抽出を速くする部分インデックス (未集荷・リマインドON・番号ありの予約を集荷日で引く)。
create index if not exists idx_shipments_pickup_reminder
  on shipments (shipment_date)
  where reminder_enabled = true
    and traveler_whatsapp is not null
    and status in ('requested', 'pending', 'issued');
