# 04. Dashboard（ホーム画面）仕様

トップページ `🏠 BondEx OS` を、事業全体が一目で分かるホームにします。
本体DBは「Databases」配下に置き、ここでは **リンクドビュー（Linked view of database）** で参照します。

## 4.1 全体レイアウト

```
🏠 BondEx OS
┌───────────────────────────────────────────────┐
│ 見出し + 一言ビジョン                             │
│ 「旅行中の荷物ストレスを無くす事業OS」              │
├──────────────┬──────────────┬─────────────────┤
│ 📊 KPIカード群（4カラム / callout or DBビュー）    │
│ DMC数 / PoC候補数 / 北海道案件数 / 実施中PoC数     │
├──────────────┴──────────────┴─────────────────┤
│ 🔴 今週やること                                    │
│  ・要フォローDMC（Formula=⚠️）                     │
│  ・Next Action期日が近いMeeting                    │
├──────────────┬────────────────────────────────┤
│ 🗓 今週のMeeting │ 🧪 PoC状況(Board)               │
├──────────────┴────────────────────────────────┤
│ 📈 営業状況（DMCをステータスでBoard）              │
├───────────────────────────────────────────────┤
│ 📦 旅行/配送サマリ（Travelers 分析ビュー）          │
├──────────────┬────────────────────────────────┤
│ 📚 最新Documents │ 🧭 最近のDecision Log           │
└──────────────┴────────────────────────────────┘
```

## 4.2 各ブロックの作り方

### KPIカード（数値）
Notionには単独の「数値タイル」機能がないため、次のどちらかで実現：
- **簡易**: 各DBのリンクドビューを **Board/Table** で置き、ビュー名に件数の意味を持たせ、
  ビュー下部の Count 表示（`Calculate → Count all`）で数を見せる。
- **推奨（見た目重視）**: 4カラムのCalloutブロックを並べ、Claude Codeが定期的に数値を書き込む
  （[05-ai-automation.md](./05-ai-automation.md) の「ダッシュボード自動更新」）。

| カード | ソース | フィルタ |
|--------|--------|---------|
| DMC数 | DMC | なし（全件Count） |
| PoC候補数 | DMC | `PoC候補 = ✔` |
| 北海道案件数 | DMC | `北海道案件 = ✔` |
| 実施中PoC数 | PoC | `ステータス = 実施中` |
| 成約数 | DMC | `営業ステータス = 成約` |

### 🔴 今週やること
- **要フォローDMC**: DMCのリンクドビュー（Table）/ Filter `要フォロー` contains `⚠️` / Sort `次回アクション期日` 昇順。
- **迫るNext Action**: Meetingsのリンクドビュー / Filter `Next Action期日` is on or before `今週末` / `Next Action` is not empty。

### 🗓 今週のMeeting
Meetings リンクドビュー（Calendar もしくは Table）/ Filter `日時` is `This week`。

### 🧪 PoC状況
PoC リンクドビュー（**Board**）/ Group by `ステータス` / Card preview に `地域`・`実績配送件数`・`利用率`。

### 📈 営業状況
DMC リンクドビュー（**Board**）/ Group by `営業ステータス` / Sort `優先順位` / Card に `優先順位`・`最新Meeting日`・`要フォロー`。

### 📦 旅行/配送サマリ
Travelers リンクドビュー（Table）を複数タブ（ビュー）で：
- `国別`: Group by `国籍`、`配送件数`Sum・`配送金額`Sum
- `月別需要`: Group by `旅行開始日`(By month)、`旅行人数`Sum
- `ランドオペ別`: Group by `ランドオペ`、`配送金額`Sum
- `トラブル`: Filter `トラブル有無 != なし`

### 📚 最新Documents
Documents リンクドビュー（Table/Gallery）/ Sort `作成日` 降順 / Limit 表示。

### 🧭 最近のDecision Log
Decision Log リンクドビュー（Table）/ Sort `日付` 降順 / `要見直し` を強調。

## 4.3 モバイル配慮
calloutのKPIは1カラムに折り返るため、重要順（要フォロー → 今週Meeting → PoC）に上から並べる。

## 4.4 タスク要件との対応表

| 依頼の表示項目 | Dashboard上の実装 |
|----------------|------------------|
| 営業状況 | 📈 営業状況（DMC Board by ステータス） |
| PoC状況 | 🧪 PoC状況（PoC Board by ステータス） |
| 今週のMeeting | 🗓 今週のMeeting（This week フィルタ） |
| Next Action | 🔴 今週やること（迫るNext Action） |
| DMC数 | KPIカード（全件Count） |
| PoC候補数 | KPIカード（PoC候補=✔） |
| 北海道案件数 | KPIカード（北海道案件=✔） |
| Documents | 📚 最新Documents |
| Decision Log | 🧭 最近のDecision Log |
