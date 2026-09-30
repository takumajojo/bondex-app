-- 代理店の「追加」通知メール宛先。agencies.contact_email が主、これらは追加。
-- 集荷/配達完了などの通知は contact_email + agency_emails の重複排除セットへ送る。
-- ログインユーザーの複数化は既存 user_agencies (agency_id は複数可) で表現する。
create table if not exists agency_emails (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  email text not null,
  label text,
  created_at timestamptz not null default now(),
  created_by text
);
create unique index if not exists agency_emails_agency_lower_email_uidx on agency_emails (agency_id, lower(email));
create index if not exists agency_emails_agency_idx on agency_emails (agency_id);

alter table agency_emails enable row level security;
drop policy if exists "agency users read own emails" on agency_emails;
create policy "agency users read own emails" on agency_emails
  for select to authenticated
  using (agency_id = (select agency_id from user_agencies where user_id = auth.uid()));
-- 書き込みは service_role 経由の API のみ (authenticated 向け write ポリシーは作らない=既定deny)。
