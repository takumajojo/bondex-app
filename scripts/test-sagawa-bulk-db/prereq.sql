-- sql/065 を隔離 PostgreSQL に適用するための前提のみ (本番スキーマの忠実な縮小版)。
-- set_updated_at() は sql/001 と同一。shipments は members の FK 先スタブ (id のみ)。
create extension if not exists pgcrypto;

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid()
);
