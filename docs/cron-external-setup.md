# 追跡同期を「本当に」定期実行させる（外部スケジューラ設定）

## 背景 / 問題
配送ステータス（集荷済み・輸送中・配達完了）と代理店への集荷/配達メールは、
`/api/cron/sync-tracking` が Ship&co を照会して更新・発火する。これを GitHub Actions の
スケジュール（`.github/workflows/sync-tracking.yml`）で回しているが、**GitHub Actions の
スケジュール実行は高負荷時に遅延・間引かれ、実測で数時間空くことがある**。
その結果「佐川では配達完了なのに BondEx は輸送中のまま」「集荷/配達メールが遅れる」が起きる。

## 対策（本命）: 外部の信頼できるスケジューラから叩く
GitHub Actions は残す（バックストップ）が、**主たるトリガーを外部スケジューラにする**。
無料で1分解像度の [cron-job.org](https://cron-job.org) を推奨（Upstash QStash / EasyCron 等でも可）。

### 設定内容（cron-job.org の例）
- **URL**: `https://bondex.express/api/cron/sync-tracking`
- **Method**: `GET`
- **Request header**（1行追加）: `Authorization: Bearer <CRON_SECRET>`
  - `<CRON_SECRET>` は **Vercel / GitHub と同じ値**（Vercel → Project → Settings →
    Environment Variables の `CRON_SECRET`）。※この値はシークレット。ドキュメントやコードに書かない。
- **Schedule**: 毎 15 分（`*/15 * * * *`）。もっと速くしたければ 5〜10 分でも可。
- **Timeout**: 60 秒以上（関数の maxDuration は 300s）。

### 補足
- 二重起動は `acquireCronLock('sync-tracking')` で無害化済み（同時に走っても後発は skip）。
  なので GitHub Actions と外部スケジューラを併用してよい。
- 認証は `Authorization: Bearer <CRON_SECRET>` のみ。ヘッダが違えば 401。
- 正常時は 200 と JSON（`checked` / `updated` / `pickupNotified` / `deliveryNotified` 等）が返る。
  cron-job.org の「実行履歴」で 200 を確認できる。

## 動作確認
1. 外部ジョブを保存 → 手動実行（Run now）。
2. cron-job.org の履歴が **HTTP 200** になること。
3. 進行中の配送があれば、数分内に `/operator/dashboard` のステータスが更新されること。

## 参考: 同じ仕組みの他 cron
`issue-due`（日次）・`monthly-invoices`（月次）も同様に叩けるが、頻度が低いので現状の
GitHub Actions のままで問題ない。リアルタイム性が要るのは `sync-tracking` のみ。
