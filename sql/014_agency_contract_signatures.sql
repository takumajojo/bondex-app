-- 代理店による契約書の電子署名(手書きサイン+同意)。メールを介さず bondex 上で締結する。
-- 本人性: 代理店ポータルのログイン認証(Supabase Auth)済みユーザーが署名する。
-- 非改ざん: 署名時に生成した署名済みPDFの SHA-256 を contract_hash に保存。

alter table agencies add column if not exists contract_status text not null default 'unsigned';
alter table agencies add column if not exists contract_signed_at timestamptz;
alter table agencies add column if not exists contract_signer_name text;
alter table agencies add column if not exists contract_signer_title text;
alter table agencies add column if not exists contract_version text;

-- 署名の監査記録(署名画像・文書ハッシュ含む)。再署名し得るので履歴として全件保持。
create table if not exists agency_contract_signatures (
  id               uuid primary key default gen_random_uuid(),
  agency           text not null,
  signer_name      text not null,
  signer_title     text,
  signature_image  text,            -- data:image/png;base64,...
  contract_version text not null,
  contract_hash    text,            -- 署名済みPDFの SHA-256
  drive_url        text,
  ip               text,
  user_agent       text,
  signed_at        timestamptz not null default now()
);
create index if not exists agency_contract_sig_idx on agency_contract_signatures (agency, signed_at desc);

-- service_role でのみ読み書き(署名APIは代理店JWT検証後に service_role で自社名固定で書く)。
alter table agency_contract_signatures enable row level security;
