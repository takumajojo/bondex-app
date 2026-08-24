-- 代理店のやり取り言語（契約書・各種案内・請求などの出力言語）。
-- これまで is_domestic(国内/海外) から言語を派生していたが、
-- 「国内/海外(請求区分)」と「言語」は別物なので専用カラムに分離する。
-- 値は 'ja' | 'en'（認証側は日英の2言語）。既定は日本語、既存は is_domestic から初期化。
alter table agencies
  add column if not exists locale text not null default 'ja';

update agencies
  set locale = case when is_domestic then 'ja' else 'en' end
  where locale is null or locale = 'ja';

comment on column agencies.locale is 'やり取り言語 ja|en。契約書・案内・請求の出力言語。登録時に選択、承認画面で変更可。';
