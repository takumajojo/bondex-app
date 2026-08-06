# 01. データベース完全スキーマ

各DBの全プロパティを **Notionのプロパティ型** 付きで定義します。
凡例: `Title`=タイトル / `Text`=テキスト / `Number`=数値 / `Select`=セレクト / `Multi`=マルチセレクト /
`Date`=日付 / `Checkbox`=チェックボックス / `Email` / `Phone` / `URL` / `Files`=ファイル&メディア /
`Person`=ユーザー / `Relation`=リレーション / `Rollup`=ロールアップ / `Formula`=関数。

Relation・Rollup・Formulaの詳細配線は [02-relations-rollups-formulas.md](./02-relations-rollups-formulas.md) を参照。

---

## ① DMC / ランドオペレーター  `dmc`

営業対象の企業台帳。市場・顧客の中核。

| プロパティ | 型 | 選択肢 / 補足 |
|-----------|----|--------------|
| 会社名 | **Title** | 主キー |
| 優先順位 | Select | `S` / `A` / `B` |
| 担当者 | Text | 先方キーパーソン名 |
| 役職 | Text | |
| メール | Email | |
| 電話 | Phone | |
| 所在地 | Text | 都道府県・市区町村 |
| 国 | Select | `日本` / `その他`（本社所在国。将来の海外DMC対応） |
| URL | URL | 会社サイト |
| 問い合わせURL | URL | 問い合わせフォーム |
| 北海道案件 | Checkbox | 北海道に強い/案件ありフラグ |
| 団体旅行 | Checkbox | 団体を扱う |
| FIT | Checkbox | 個人旅行(FIT)を扱う |
| 添乗員同行 | Checkbox | 添乗員同行の商流を持つ |
| 得意国 | Multi | `中国` `台湾` `香港` `韓国` `タイ` `シンガポール` `マレーシア` `インドネシア` `ベトナム` `米国` `豪州` `英国` `仏` `独` `その他` |
| 得意地域 | Multi | `北海道` `東北` `関東` `中部` `関西` `中国地方` `四国` `九州` `沖縄` `全国` |
| PoC候補 | Checkbox | PoC候補として検討中 |
| 営業ステータス | Select | `未着手` / `リサーチ済` / `一次接触` / `商談中` / `PoC調整中` / `PoC実施中` / `成約` / `保留` / `見送り` |
| 最終接触日 | Date | |
| 次回アクション | Text | やること |
| 次回アクション期日 | Date | 自動フォロー判定に使用 |
| 要フォロー | **Formula** | 期日超過/当日で `⚠️`（[02参照](./02-relations-rollups-formulas.md)） |
| Meetings | **Relation** | → Meetings（会社） |
| Documents | **Relation** | → Documents（関連DMC） |
| PoC | **Relation** | → PoC（参加企業/ランドオペ） |
| Travelers | **Relation** | → Travelers（ランドオペ） |
| Stakeholders | **Relation** | → Stakeholders（関連DMC） |
| Decision Log | **Relation** | → Decision Log（関連DMC） |
| Meeting数 | **Rollup** | Meetings の Count |
| 最新Meeting日 | **Rollup** | Meetings.日時 の Latest |
| PoC数 | **Rollup** | PoC の Count |
| 累計配送件数 | **Rollup** | Travelers.配送件数 の Sum |
| 出典URL | URL | Web検索で追加した場合の一次情報（AI用） |
| 情報取得日 | Date | AIが情報更新した日 |
| メモ | Text | 補足（本文にも記載可） |

---

## ② Meetings  `meetings`

商談・打合せの記録。宿題とNext Actionの起点。

| プロパティ | 型 | 選択肢 / 補足 |
|-----------|----|--------------|
| タイトル | **Title** | 例: `2026-08-01 ○○DMC 初回商談` |
| 日時 | Date | 開始時刻を含める（Include time） |
| 会社 | **Relation** | → DMC（会社） |
| 関連先(Stakeholder) | **Relation** | → Stakeholders（DMC以外の相手先） |
| 関連PoC | **Relation** | → PoC（関連PoC） |
| 参加者(先方) | Text | 相手側参加者 |
| 参加者(BondEx) | Person | 自社参加者 |
| 議事録 | Text | 要約（全文はページ本文） |
| 課題 | Text | 論点・ブロッカー |
| 宿題 | Text | こちらの宿題 |
| Next Action | Text | 次の一手 |
| Next Action期日 | Date | |
| PoC化可能性 | Select | `高` / `中` / `低` / `なし` |
| 添付資料 | **Relation** | → Documents（添付資料） |
| ファイル | Files | 直接添付する場合 |
| Fathom URL | URL | 録画/文字起こしリンク（AI要約の入力） |
| 要約ステータス | Select | `未要約` / `AI要約済` / `確認済`（AI連携用） |

---

## ③ Travelers（旅行データ）  `travelers`

**分析の中心**。1レコード = 1旅行（ツアー/グループ単位）。需要予測・配送分析の母集団。

| プロパティ | 型 | 選択肢 / 補足 |
|-----------|----|--------------|
| 旅行ID | **Title** | 例: `TRV-2026-0001` |
| ランドオペ | **Relation** | → DMC（ランドオペ） |
| PoC | **Relation** | → PoC |
| ツアー名 | Text | |
| 旅行開始日 | Date | |
| 旅行終了日 | Date | |
| 旅行日数 | **Formula** | `dateBetween(終了,開始,"days")+1` |
| 出国空港 | Select | `新千歳` `羽田` `成田` `中部` `関西` `福岡` `那覇` `その他` |
| 帰国空港 | Select | 同上 |
| 利用航空会社 | Multi | `JAL` `ANA` `Peach` `Jetstar` `中国国際` `中華航空` `キャセイ` `大韓` `その他` |
| 旅行人数 | Number | |
| 国籍 | Select | `中国` `台湾` `香港` `韓国` `タイ` `シンガポール` `マレーシア` `米国` `豪州` `英国` `その他` |
| 添乗員 | Checkbox | 添乗員同行の有無 |
| 添乗員名 | Text | |
| 利用ホテル | **Relation** | → Stakeholders（カテゴリ=ホテル） |
| 観光地 | Multi | `札幌` `小樽` `富良野` `函館` `ニセコ` `旭川` `知床` `その他`（地域に応じ拡張） |
| 購入店舗 | **Relation** | → Stakeholders（カテゴリ=お土産店） |
| 配送件数 | Number | 荷物の配送依頼件数 |
| 配送商品数 | Number | 配送した荷物の個数 |
| 配送重量 | Number | 合計kg |
| 配送金額 | Number | 合計¥ |
| 受取場所 | Text | 空港/ホテル/自宅等 |
| 受取日時 | Date | |
| トラブル有無 | Select | `なし` / `軽微` / `重大` |
| トラブル内容 | Text | |
| 一人あたり配送金額 | **Formula** | `配送金額 / 旅行人数` |
| 一件あたり重量 | **Formula** | `配送重量 / 配送件数` |

---

## ④ Stakeholders  `stakeholders`

空港・ホテル・観光協会・物流・バス・お土産店・ロッカー・自治体などの関係者台帳。

| プロパティ | 型 | 選択肢 / 補足 |
|-----------|----|--------------|
| 名称 | **Title** | |
| カテゴリ | Select | `空港` / `ホテル` / `観光協会` / `物流会社` / `バス会社` / `お土産店` / `ロッカー事業者` / `自治体` / `その他` |
| 担当者 | Text | |
| 役職 | Text | |
| 電話 | Phone | |
| メール | Email | |
| 所在地 | Text | |
| 地域 | Select | `北海道` `東北` `関東` `中部` `関西` `中国地方` `四国` `九州` `沖縄` |
| URL | URL | |
| 優先度 | Select | `S` / `A` / `B` |
| ステータス | Select | `未接触` / `接触済` / `連携協議中` / `連携中` / `見送り` |
| 関連DMC | **Relation** | → DMC（Stakeholders） |
| PoC | **Relation** | → PoC（ホテル/空港） |
| Meetings | **Relation** | → Meetings（関連先） |
| Documents | **Relation** | → Documents（関連先） |
| 利用実績(Travelers-ホテル) | **Relation** | → Travelers（利用ホテル）※逆側 |
| 購入実績(Travelers-店舗) | **Relation** | → Travelers（購入店舗）※逆側 |
| 備考 | Text | |

---

## ⑤ Documents  `documents`

提案・契約・PoC資料・プレゼン・Vision・Business Model・Meeting資料の文書ハブ。タグ管理可能。

| プロパティ | 型 | 選択肢 / 補足 |
|-----------|----|--------------|
| タイトル | **Title** | |
| 種別 | Select | `提案資料` / `契約書` / `PoC資料` / `プレゼン` / `Vision` / `Business Model` / `Meeting資料` / `分析レポート` / `その他` |
| タグ | Multi | 自由タグ（例: `北海道` `FlexyBox` `価格` `法務` `AI生成`） |
| ステータス | Select | `ドラフト` / `レビュー中` / `確定` / `アーカイブ` |
| 作成日 | Date | |
| 版 | Text | 例: `v1.2` |
| ファイル | Files | 実体添付 |
| リンク | URL | Google Drive等の外部リンク |
| 関連DMC | **Relation** | → DMC |
| 関連Meeting | **Relation** | → Meetings |
| 関連PoC | **Relation** | → PoC |
| 関連Stakeholder | **Relation** | → Stakeholders |
| 関連Decision | **Relation** | → Decision Log |
| 作成者 | Person | |
| 生成元 | Select | `人手` / `Claude Code`（AI生成物の区別） |

---

## ⑥ PoC  `poc`

実証実験の計画・実績・結果。

| プロパティ | 型 | 選択肢 / 補足 |
|-----------|----|--------------|
| 名称 | **Title** | 例: `北海道ハンズフリーPoC 2026冬` |
| 地域 | Select | `北海道` `東北` `関東` `中部` `関西` `中国地方` `四国` `九州` `沖縄` |
| ステータス | Select | `構想` / `計画中` / `準備中` / `実施中` / `検証中` / `完了` / `中止` |
| 開始日 | Date | |
| 終了日 | Date | |
| 期間(日) | **Formula** | `dateBetween(終了,開始,"days")+1` |
| 参加企業 | **Relation** | → DMC（PoC） |
| ランドオペ | **Relation** | → DMC（PoC）※主担当ランドオペ |
| ホテル | **Relation** | → Stakeholders（PoC） |
| 空港 | **Relation** | → Stakeholders（PoC） |
| 参加人数(目標) | Number | |
| 目標配送件数 | Number | |
| 目標売上 | Number | ¥ |
| Travelers | **Relation** | → Travelers（PoC） |
| 実績参加人数 | **Rollup** | Travelers.旅行人数 の Sum |
| 実績配送件数 | **Rollup** | Travelers.配送件数 の Sum |
| 実績配送金額 | **Rollup** | Travelers.配送金額 の Sum |
| 利用率 | **Formula** | `実績配送件数 / 目標配送件数`（パーセント表示） |
| 達成率(売上) | **Formula** | `実績配送金額 / 目標売上` |
| 課題 | Text | |
| 改善案 | Text | |
| 結果 | Text | 総括 |
| Meetings | **Relation** | → Meetings（関連PoC） |
| Documents | **Relation** | → Documents（関連PoC） |
| Decision | **Relation** | → Decision Log（関連PoC） |

> 「配送件数・売上・参加人数」は目標値をNumberで持ち、実績はTravelersからのRollupで自動集計する。
> これにより二重入力なく計画対実績が見える。

---

## ⑦ Decision Log  `decision_log`

経営判断の記録。**最重要**。なぜその判断をしたかを未来に残す。

| プロパティ | 型 | 選択肢 / 補足 |
|-----------|----|--------------|
| タイトル | **Title** | 例: `ランドオペレーターへのピボット` |
| 日付 | Date | 決定日 |
| カテゴリ | Select | `戦略` / `営業` / `プロダクト` / `パートナー` / `オペレーション` / `資金` / `採用` / `法務` |
| 背景 | Text | なぜ判断が必要になったか |
| 選択肢 | Text | 検討した選択肢（箇条書き） |
| 採用理由 | Text | なぜこれを選んだか |
| 決定内容 | Text | 何を決めたか |
| 結果 | Text | 後日追記される結果・振り返り |
| ステータス | Select | `有効` / `見直し中` / `破棄` |
| 次回見直し日 | Date | |
| 意思決定者 | Person | |
| 関連DMC | **Relation** | → DMC |
| 関連PoC | **Relation** | → PoC |
| 関連Documents | **Relation** | → Documents |

### Decision Log 初期エントリ（例。CSVにも収録）

| タイトル | カテゴリ | 決定内容(要約) |
|---------|---------|---------------|
| ホテル直販営業の停止 | 戦略 | 単一ホテル営業から撤退 |
| ランドオペレーターへのピボット | 戦略 | 需要の束を持つランドオペを起点にする |
| FlexyBox採用 | プロダクト | 配送UIの箱管理にFlexyBoxを採用 |
| 北海道PoC開始 | パートナー | 冬季北海道でハンズフリーPoCを実施 |

> 背景・選択肢・採用理由は各エントリのページ本文/プロパティに追記すること（一次資料はリポジトリ内ファイルパスで根拠づけ）。
