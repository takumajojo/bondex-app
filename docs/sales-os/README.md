# BondEx Sales OS

営業担当者が CRM を一切更新しなくても、AI が営業状況を理解して HubSpot を自動更新する仕組み。
営業がやることは **メール / Google Meet / 電話** の3つだけ。

## ドキュメント

| ファイル | 内容 | 状態 |
| --- | --- | --- |
| [phase1-hubspot-audit.md](./phase1-hubspot-audit.md) | 既存 HubSpot 調査（読み取りのみ） | 完了 2026-08-27 |
| [phase2-architecture.md](./phase2-architecture.md) | システム全体設計 / Gmail同期 / Fathom同期 / Agent構成 / 保守構成 | 承認待ち |
| [phase2-hubspot-properties.md](./phase2-hubspot-properties.md) | HubSpot Property 設計 | 承認待ち |
| [phase2-db-schema.md](./phase2-db-schema.md) | Supabase DB 設計（024〜029） | 承認待ち |
| [phase2-dashboard-and-roadmap.md](./phase2-dashboard-and-roadmap.md) | ダッシュボード / 朝レポート / ロードマップ / 費用試算 | 承認待ち |

## 進め方（各 Phase の終わりで必ず停止し、承認を得る）

- [x] **Phase 1** 既存 HubSpot 調査
- [ ] **Phase 2** 設計書作成 ← いまここ（承認待ち）
- [ ] **Phase 3** DRY RUN（HubSpot へは書き込まない）
- [ ] **Phase 4** 限定実装（1社 → 5社）
- [ ] **Phase 5** 本番反映

## 絶対条件

- 既存の HubSpot データを壊さない
- 既存 Property を勝手に変更しない（変更は承認制）
- 新 Property 追加前に調査する
- 重複作成禁止
- 本番反映前に必ず DRY RUN
- 変更前後の差分レポートを必ず出力する
- **勝手に本番へ書き込まない**

## 確定している前提（Phase 1 実測 + 谷口さんの判断 2026-08-27）

| 項目 | 値 |
| --- | --- |
| HubSpot ポータル | 247107122 / na2 / **無料プラン** |
| HubSpot Workflow | **使えない（有料機能）** → 自前の AI エージェントが唯一の書き手 |
| カスタム項目 | **アカウント全体で 10 個まで。現在 10/10 使用済み** |
| 営業ステージ | **Company** が持つ（Deal ではない）。15 段階 |
| ノイズ会社 64 社 | **削除する**（HubSpot の自動作成設定を OFF にしてから） |
| スコープ追加 | 承認済み（automation / owners.read / connected-email） |
| タイムゾーン・通貨 | HubSpot 側は変更せず、アプリ側で JST 固定 |
