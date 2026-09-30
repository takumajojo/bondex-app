-- 代理店の「追加」通知メール宛先。agencies.contact_email が主、これらは追加。
-- 集荷/配達完了などの通知は contact_email + agency_emails の重複排除セットへ送る。
-- ログインユーザーの複数化は既存 user_agencies で表現する。
--   user_agencies.user_id は PRIMARY KEY = 1ユーザーは1代理店のみ所属。
--   agency_id は非ユニークなので「1代理店に複数ユーザー」は表現できる(その逆=1ユーザー複数代理店は不可)。
--   ※ この 1:1 前提のため下の RLS のスカラサブクエリ(=単一値比較)は安全。将来 user↔agency を
--     多対多へ緩める場合は、このRLSと sql/002 のポリシー・agency-auth の maybeSingle を要見直し。
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
