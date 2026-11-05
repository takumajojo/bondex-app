# 本番 DB の匿名・ログイン利用者の権限の監査と、最小権限の案

作成: 2026-11-05。対象: 本番の Supabase（`dscxftwfspgihkszfakk`）の `public`。**読み取りだけで調べた。本番の権限は変えていない。** 案の適用は別の承認（試験環境で確かめた後）。

## 1. 今の状態（2026-11-05 読み取り）

| 項目 | 状態 |
|---|---|
| 表 | 23。**すべて RLS が有効** |
| 匿名（anon）の表の権限 | **23表すべてに全部の権限**（SELECT・INSERT・UPDATE・DELETE・TRUNCATE・REFERENCES・TRIGGER）。書き込みの権限は 92 |
| ログイン利用者（authenticated）の表の権限 | 同じく 23表すべてに全部の権限 |
| ポリシー | 5つ。すべて authenticated の SELECT（代理店の画面: 自分の代理店・自分の区間・自分の団体の荷物・自分のメール・自分の紐付け） |
| 匿名のポリシー | 0（→ 匿名は RLS によって 1行も読めず、書けない） |
| 関数 | 2（`set_updated_at` = トリガー用、`apply_hotel_change` = 呼んだ人の権限で動く）。**匿名・ログイン利用者も実行できる**。security definer の関数は 0 |
| 既定の権限 | 新しく作る表・関数・連番にも、匿名・ログイン利用者へ全部の権限が自動で付く（Supabase の初期設定） |
| Realtime・Storage | 公開の表 0・バケット 0 |
| GraphQL | `graphql` の名前空間はあるが、拡張（pg_graphql）は入っていない |

## 2. 評価

- **今すぐ悪用できる穴は見つからなかった。** 匿名のポリシーが無いので、公開の API（PostgREST）からは読めず、書けない。`apply_hotel_change` は呼んだ人の権限で動き、匿名には区間が見えないので「区間が無い」で止まる。TRUNCATE は公開の API からは使えない。
- **ただし守りが RLS の 1層だけ。** 次のどれか 1つで、匿名に全部の権限が効く:
  - 新しい表を作って RLS を付け忘れる（既定の権限で匿名に全部の権限が付く）
  - ポリシーを書き間違えて `to public` や `using (true)` にする
  - RLS を一時的に外す操作（調査・移行の時など）
- B2C（旅行者の個人情報・決済の識別子）を足すと、この 1層に依存する表が増える（061〜079 の表もすべて RLS で守られ、ポリシーは無い。試験環境で確認する）。

## 3. アプリが実際に使っている権限（コードの確認）

| 利用者 | 使い方 | 必要な権限 |
|---|---|---|
| サーバー（service_role） | すべての API・定期の処理（`lib/supabase.ts`） | 全部（RLS を通らない） |
| ログイン利用者（代理店の画面・ブラウザ） | `agencies`・`shipments`・`group_luggage` を読む（`app/agency/*`）。ポリシーの中で `user_agencies`・`agencies` を読む。`agency_emails` のポリシーあり | この 5表の SELECT だけ |
| 匿名（ブラウザ・ログインの前） | ログイン・登録・パスワードの再設定は Supabase の認証（`auth` の名前空間）で、`public` の表は使わない | **`public` の表の権限は不要** |
| `apply_hotel_change` | サーバー（service_role）だけが呼ぶ（`app/api/agency/shipment/[id]/hotel-change`・`app/api/operator/shipment/[id]/hotel-change`） | 匿名・ログイン利用者の実行の権限は不要 |

## 4. 最小権限の案（未適用）

```sql
-- 案（本番には未適用。試験環境で動作を確かめてから、別の承認で本番へ）
begin;
-- 匿名: public の表・関数・連番の権限をすべて外す
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
-- ログイン利用者: 代理店の画面が読む 5表の SELECT だけ残す
revoke all on all tables in schema public from authenticated;
grant select on public.agencies, public.shipments, public.group_luggage, public.user_agencies, public.agency_emails to authenticated;
revoke all on all sequences in schema public from authenticated;
revoke execute on all functions in schema public from authenticated;
-- これから作る表・関数・連番にも、匿名・ログイン利用者の権限を自動で付けない
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
commit;
```

注意:
- `alter default privileges` は、実行した役割（postgres）が作る物だけに効く。Supabase の管理者（supabase_admin）が作る物は別（ダッシュボードの操作）。
- 切り戻し: `grant all on all tables in schema public to anon, authenticated; grant execute on all functions in schema public to anon, authenticated; alter default privileges ... grant ...`（今の状態に戻る）。
- 代理店の画面で、今は使っていない表を後でブラウザから読むようにしたら、その表の SELECT とポリシーを足す必要がある（開発の決まりにする）。

## 5. 確かめる順番（承認の後）

1. 試験環境（`bondex-staging`）に案を流す。
2. 代理店の画面（ログイン・一覧・団体の荷物・設定）・運営の画面・B2C の全工程を試験環境で動かす。
3. 公開の API から、匿名で全表が読めず・書けず、ログイン利用者は自分の代理店の分だけ読めることを確かめる。
4. 本番は、利用の少ない時間に流し、代理店の画面の表示を確かめる。問題があれば切り戻しの SQL。
