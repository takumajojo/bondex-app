# クラウドの試験環境の構成・費用・手順（案・未承認）

作成: 2026-11-05。目的: Stripe の本物の Webhook（B4）・iPhone と Android での予約（B5）・未集荷の通知（G1）・定期の処理（B6）を、本番と同じ形のクラウドで確かめる。
**作成・課金・外部への公開はまだ何もしていない。費用を確認していただいた後に、別の承認で進める。** 本番の DB・Stripe の本番・Vercel の本番・main は触らない。

## 1. 今の状態（2026-11-05 に確認）

| 項目 | 状態 | 根拠 |
|---|---|---|
| Supabase の組織 `takumajojo` | **Free プラン**。有効な project が 2つ（本番 `dscxftwfspgihkszfakk`・`jojo-aio-dashboard`） | Supabase の管理 API（読み取り） |
| Free プランの上限 | 有効な project は 2つまで・1週間使わないと停止・**自動のバックアップなし**・ブランチ機能なし | [Supabase の料金](https://supabase.com/pricing) |
| → 新しい試験用の project | **今のままでは作れない**（上限）。`jojo-aio-dashboard` を止めると AIO の週次の計測が止まるので、止める案は採らない | — |
| GitHub | 統合ブランチ `integ/bizlogi-b2c` は**手元だけ**（GitHub に上がっていない）。Vercel で動かすには、このブランチを GitHub に上げる必要がある（main ではない別のブランチ） | `git branch -r` |
| Vercel のプラン | **要確認**（Hobby は商用の利用ができないので、本番は Pro と思われるが、管理画面で確認していない） | [Vercel Hobby](https://vercel.com/docs/plans/hobby) |

**本番の DB についての注意（試験環境とは別の話）**: Free プランは自動のバックアップが無い。本番移行チェックリストの前提「本番の DB のバックアップ」は、Free のままなら手作業の書き出し（pg_dump）が必要。Pro にすると毎日のバックアップ（7日分）が付く。

## 2. 構成の案

| 部品 | 案（推奨） | 理由 |
|---|---|---|
| DB | **Supabase の組織を Pro にして、試験用の project `bondex-staging`（東京・Micro）を新しく作る** | 本番と同じ Supabase・pg_cron・Vault が使える。本番の project とは完全に別（データ・鍵・接続先が分かれる）。ブランチ機能より、本番の設定と混ざらない |
| アプリ | **Vercel に試験用の project を別に作る**（`bondex-staging`。同じ GitHub のリポジトリ・統合ブランチ） | 本番の project の Preview の環境変数を触らない（本番の DB の鍵が Preview に入っている可能性を消す） |
| 保護 | Vercel の Deployment Protection を ON。Stripe の Webhook だけ「Protection Bypass for Automation」の秘密の値を URL に付けて通す（全プラン無料） | 試験環境を外から見られないように |
| 決済 | Stripe の**テストモード**（`sk_test_`・試験用の Webhook の受け口を新しく登録） | 実際の課金は起きない |
| 通知 | メールは**社内の試験用の宛先だけ**に送る（送信は今の SMTP か Resend）。WhatsApp は OFF | 旅行者に届かない |
| Biz-Logi | **入れない**（環境変数 `BIZLOGI_*` なし。集荷依頼は Excel の記録だけ） | 佐川・SG に送らない。Biz-Logi の送信は手元の模擬の試験で確認済み |
| 追跡（Ship&co） | **本物の鍵は入れない**（下の 4 の注意） | 佐川の照会の上限を使わない |
| Google の地図 | 今の鍵（試験の照会は数百回の見込み） | — |

## 3. 費用（月額・税抜・1ドル 150円で換算）

| 項目 | 月額 | 根拠・注意 |
|---|---|---|
| Supabase Pro の基本料 | $25（約 3,750円） | 組織ごと。本番の project にも毎日のバックアップ・停止なしが付く |
| Supabase の計算資源（Micro） | 本番・jojo-aio-dashboard・試験用の 3つ × $10 = $30。含まれるクレジット $10 を引いて **$20**（約 3,000円） | Pro では各 project に計算資源の料金がかかる。クレジットは Micro 1つ分（[料金のページ](https://supabase.com/pricing)）。**クレジットの割り当ての細部は管理画面の請求の画面で確認が必要** |
| Vercel | **$0**（今のプランが Pro なら、試験用の project・Preview・Bypass は追加の料金なし） | Hobby の場合は商用の利用ができないので、本番の運用自体の確認が要る |
| Stripe テストモード | $0 | — |
| メール | $0（今の送信の手段・試験の数十通） | — |
| Google の地図 | 無料の範囲の見込み（数百回） | 要確認（Google の料金は品目ごと） |
| **合計** | **約 $45（約 6,750円）／月** | 試験が終わったら試験用の project を消せば、その分（$10）は止まる。Pro の基本料と本番・dashboard の計算資源（$35）は、Pro を続ける限りかかる |

**別の案（費用を抑える）**: 試験の期間だけ Pro にして、終わったら試験用の project を消し、組織を Free に戻す（約 1か月で $45 前後・日割り）。ただし本番のバックアップの利点も無くなる。

## 4. 未集荷の通知の試験の注意（新しく分かったこと）

- 未集荷の通知は、追跡の定時処理（`app/api/cron/sync-tracking`）の中にある。この処理は **Ship&co の鍵が無いと最初に止まり（503）**、**追跡の一時停止（`TRACKING_SYNC_PAUSED=true`）の間も止まる**。
- → 本番でも、佐川の追跡が止まって一時停止にした期間（2026-10 にあった）は、**旅行者の予約の未集荷の通知も出ない**。請求は運営の集荷の確認が無いと作られないので誤って請求することは無いが、運営が気づくのが遅れる（`02_implementation_gaps.md` の G19 として記録。仕様は変えていない）。
- 試験環境では本物の Ship&co の鍵を入れない。未集荷の通知を試すには、(a) 試験用のダミーの鍵を入れ、**問い合わせ番号の無い区間**で、追跡の照会が外に出ないことをログで先に確かめてから通知を確認する、または (b) 未集荷の判定の部分だけを別の定時処理に分ける（コードの変更・別の承認）。推奨は (a)。

## 5. 手順（承認の後）

| 順 | 作業 | 誰が | 確認 |
|---|---|---|---|
| 0 | 費用の承認（この文書の 3） | たくまさん | — |
| 1 | Supabase の組織を Pro にする（請求の画面・カードの入力） | **たくまさん**（支払の情報の入力は私はしない） | プランが Pro |
| 2 | 試験用の project `bondex-staging` を東京で作る（費用の確認の後に作成） | 開発 | 本番とは別の URL・鍵 |
| 3 | 表の定義（本番の定義の写し・データなし `scripts/test-b2c/db/000_base_from_prod.sql`）→ 本番の移行の順番で SQL（067〜079）→ ダミーのデータ（入口の token・確認済みのホテル）→ 規約の本文の登録 | 開発 | 本番移行チェックリストの照合 SQL-D など |
| 4 | 統合ブランチを GitHub に上げる（**main ではない**。ブランチ名 `integ/bizlogi-b2c`） | 開発（**push の承認**） | — |
| 5 | Vercel に試験用の project を作り、環境変数を入れる（試験用の DB・`sk_test_`・新しい Webhook の秘密・新しい `CRON_SECRET`・`B2C_ACCESS_TOKEN_SECRET`・B2C のスイッチ ON・`B2C_LEGAL_PAGES_ENABLED=true`・通知の宛先は社内だけ）。**本番の値は 1つも入れない** | 開発・たくまさん（Vercel の権限） | 本番の DB の URL が環境変数に無いことを確認 |
| 6 | Deployment Protection を ON・Bypass の秘密を作る | 同上 | 外からは保護の画面 |
| 7 | Stripe のテストモードに Webhook の受け口を登録（`…/api/b2c/stripe/webhook?x-vercel-protection-bypass=…`） | 開発 | Stripe のテストの送信が 200 |
| 8 | pg_cron（試験用の DB）で `/api/b2c/cron/tick`（5分おき）・`/api/cron/pickup-watch`（10分おき）・`/api/cron/sync-tracking`（4 の (a) の確認の後） | 開発 | 定時の実行の記録 |
| 9 | 試験: Stripe の本物の Webhook（3D セキュア・失敗・返金・取消の後の通知・再送）／実機（iPhone Safari・Android Chrome・LINE の中のブラウザで予約〜カード登録〜支払のページ〜規約のページ）／未集荷の通知（集荷日の 18:00 以降に 1通だけ）／定期の処理（請求・リマインド・期限切れ） | 開発・たくまさん（実機） | 記録表 |
| 10 | 後片付け（続けて使わないなら試験用の project を消す・Webhook の受け口を消す） | 開発 | 料金が止まる |

目安: 1〜5 で 1日、9 で 1.5〜2日（実機はたくまさんの時間 0.5日）。

## 6. 承認をお願いすること（それぞれ別に）

1. 費用（月 約 $45・約 6,750円）と、Supabase の組織を Pro にすること（本番の project にも影響: 毎日のバックアップが付く・計算資源の料金がかかる）。
2. 試験用の Supabase の project と Vercel の project の作成。
3. 統合ブランチを GitHub に上げること（main ではない）。
4. 未集荷の通知の試験の方法（4 の (a)）。
