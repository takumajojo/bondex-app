"use client"

import React from "react"
import { useState } from "react"
import Link from "next/link"
import { ArrowLeft, History, ChevronDown, ChevronRight, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"



const changelog = [
  {
    version: "6.6.0",
    date: "2026-02-09",
    time: "03:00 JST",
    changes: [
      "booking-store.ts: BookingMessage 型、IssueType（payment_failure / uncollected / carrier_exception / size_mismatch / other）、ISSUE_TEMPLATES テンプレート5種を追加",
      "booking-store.ts: addMessage() / markMessageRead() / getUnreadCount() を追加。StoredBooking に messages フィールドを追加",
      "Admin Order Detail: ステータス変更ドロップダウン（confirmed→waiting→checked_in→picked_up→in_transit→delivered）を追加、updateBookingStatus() でリアルタイム反映",
      "Admin Order Detail: Issue 登録パネル（5種テンプレート + 自由入力）+ 「Send to Traveler」ボタン + 送信履歴一覧（type別色分け・既読/未読表示・時系列）",
      "Traveler Status Dashboard: Admin からの通知カードを表示（action_required=赤 / warning=黄 / info=グレー）、未読バッジ付き、X で既読化・非表示",
      "Traveler Status Dashboard: ライブ booking のステータスをリアルタイム反映（confirmed→scheduled / checked_in→received 等のマッピング）",
    ],
  },
  {
    version: "6.5.0",
    date: "2026-02-09",
    time: "02:30 JST",
    changes: [
      "lib/booking-store.ts 新規作成: sessionStorage ベースの CRUD（saveBooking / getAllBookings / getBookingById / updateBookingStatus）",
      "StoredBooking 型定義: destination / deliveryDate / items / contact / payment の全フィールド、カスタムイベント 'bondex-booking-updated' による変更通知",
      "Traveler Flow: Payment 完了時に saveBooking() で予約データを sessionStorage に保存、orderId を自動生成（BDX-XXXX形式）",
      "Hotel Staff Order List: getAllBookings() からライブデータを読み込み、モックデータとマージ・重複排除して表示。新規予約は 'waiting' ステータスで最上位に配置",
      "Admin Dashboard Overview: ライブ予約数を Active orders カウントに反映、Recent orders にライブデータをマージ表示",
      "Admin Order List: ライブデータをモックとマージ、'confirmed' ステータスフィルタ追加",
      "Admin Order Detail: orderId で sessionStorage からライブデータを優先ロード、未登録の場合はモックデータにフォールバック",
    ],
  },
  {
    version: "6.4.0",
    date: "2026-02-09",
    time: "02:10 JST",
    changes: [
      "Screen Flow (/flowchart) と各画面を連携: TravelerFlow に initialStep マッピングを追加（landing/destination/delivery-date/luggage/contact/payment/completion/status）",
      "フローチャートの Traveler セクションを現行ステップ構成に更新（Step 1: Destination → Step 2: Delivery Date → Step 3: Luggage Details → Step 4: Contact + Verify → Step 5: Payment → Confirmed → Status）",
      "各 FlowNode の href を現行ステップ名に修正し、クリックで該当画面に直接遷移可能に",
      "ダウンロードテキスト・Design Philosophy 説明文も現行構成に同期",
    ],
  },
  {
    version: "6.3.0",
    date: "2026-02-09",
    time: "02:00 JST",
    changes: [
      "Payment: 「Estimated total (max)」の下に自動追加請求の説明を統合表示",
      "太字・大きめテキストで「Up to ~may be charged automatically」を強調表示",
      "サイズ差額が決済方法に自動請求される旨とメール通知を明記",
      "旧 Size adjustment note（別枠）を廃止し、料金カード内の統合説明に集約",
    ],
  },
  {
    version: "6.2.0",
    date: "2026-02-09",
    time: "01:50 JST",
    changes: [
      "Contact Info: 3フェーズの認証フロー導入（入力 → 方法選択 → コード入力）",
      "Phase 2: Email / SMS 選択画面（マスク済みアドレス・番号を表示）",
      "Phase 3: 6桁認証コード入力（1桁ずつ独立入力欄、ペースト対応、自動フォーカス移動）",
      "60秒クールダウン付き再送ボタン（Resend code）、送信方法変更リンク（Use SMS/email instead）",
      "ヘッダーの戻るボタンをフェーズに応じて動的遷移（verify→method→input→前画面）",
    ],
  },
  {
    version: "6.1.0",
    date: "2026-02-09",
    time: "01:40 JST",
    changes: [
      "Trip Plan: Booking Name 入力欄の下に「Booking Confirmation」書類アップロードフォームを追加（必須）",
      "画像（image/*）とPDFに対応、アップロード後はファイル名・サイズを表示し削除可能",
      "canContinue 条件に bookingDoc の存在チェックを追加（未アップロード時は Continue 不可）",
    ],
  },
  {
    version: "6.0.0",
    date: "2026-02-09",
    time: "01:30 JST",
    changes: [
      "Trip Plan: Arrival Time を時間のみ選択する <select> に変更（00:00〜23:00、分は :00 固定）",
      "Booking Name 入力欄を Recipient Name の上に新規追加",
      "Recipient Name に「Same as booking name」チェックボックスを追加（デフォルトON）",
      "チェックOFF時のみ Recipient Name 入力欄を表示し入力必須化",
      "BookingData.destination に recipientName フィールドを追加",
    ],
  },
  {
    version: "5.9.0",
    date: "2026-02-09",
    time: "01:10 JST",
    changes: [
      "Traveler Flow: Luggage Count 画面（Step 3）を削除し、8ステップ→7ステップ構成に変更",
      "ステップ再配置: Destination(1) → Delivery Date(2) → Luggage Details(3) → Contact Info(4) → Payment(5) → Confirmed(6) → Status(7)",
      "ステップ表示を 'Step 2 of 6' に更新、全画面の onBack/onNext 遷移先を再接続",
    ],
  },
  {
    version: "5.8.0",
    date: "2026-02-09",
    time: "01:00 JST",
    changes: [
      "Traveler Flow: 全画面を復活し9ステップ構成に再構築",
      "Step 0: Landing → Step 1: Destination → Step 2: Delivery Date（inline維持） → Step 3: Luggage Count → Step 4: Luggage Details → Step 5: Contact Info → Step 6: Payment → Step 7: Booking Confirmed → Step 8: Status Dashboard",
      "BookingData を完全版に復元: items / contact / orderId フィールドを再追加（既存の各画面コンポーネントとの互換性を回復）",
      "旧 Step 3（Luggage Count）→ Step 3、旧 Step 4（Contact Info placeholder）→ Step 5 として既存画面を復活接続",
    ],
  },
  {
    version: "5.7.0",
    date: "2026-02-09",
    time: "00:50 JST",
    changes: [
      "Traveler Step 3「Luggage count」画面を新規追加（luggage-count-screen.tsx）",
      "荷物タイプ3種（Large Suitcase / Carry-on / Golf・Ski）の個数選択UI（+/- カウンター）",
      "Yamato Transport 規定の重量・サイズ制限をLogistics Policyとして表示",
      "複数荷物選択時に Pro Insight メッセージを表示（動的に合計数を反映）",
      "traveler-flow.tsx のステップルーティングを更新: Step 2→3→4 に拡張、Contact Info を Step 4 に移動",
    ],
  },
  {
    version: "5.6.0",
    date: "2026-02-09",
    time: "00:30 JST",
    changes: [
      "[手動修正] traveler-flow.tsx を全面書き換え",
      "BookingData を簡素化: items / contact / orderId を削除し、destination + deliveryDate の2フィールドに集約",
      "Traveler ステップを 7→3 に削減（Step 1: Destination → Step 2: Delivery Date → Step 3: Contact Info プレースホルダー）",
      "DeliveryDateScreen を traveler-flow.tsx 内にインライン実装（独立ファイルから移行）",
      "配送日UI刷新: Earliest バッジ付きラジオ選択、Logistics Promise（到着予定時刻 + 自動スケジュール表示）、Good to know セクション",
      "空港配送時の Flight time 警告（14:00以降必須）をインライン表示",
      "ArrowLeft ヘルパーコンポーネントを ChevronRight の rotate-180 で実装",
      "destination-screen.tsx: BookingData の新インターフェースに合わせて props を更新",
    ],
  },
  {
    version: "5.5.0",
    date: "2026-02-09",
    time: "00:10 JST",
    changes: [
      "荷物写真: 固定2スロット（Full shot + Damage）を廃止し、自由な写真リスト（最小1枚・最大3枚）に変更",
      "ガイド文を簡素化: 「Include handles and casters. Multiple photos OK.」の1行のみ",
      "1枚目の写真で自動サイズ推定、全写真削除時にサイズ・重量をリセット",
    ],
  },
  {
    version: "5.4.0",
    date: "2026-02-09",
    time: "00:00 JST",
    changes: [
      "確認チェックボックスを廃止し、Continue押下時に確認モーダルを表示する方式に変更",
      "モーダル内容: 禁止物品の不含有確認 + サイズ自動調整の説明（View listリンク付き）",
      "「I confirm」ボタンを押さないと次画面に遷移不可",
      "「Back」ボタンでモーダルを閉じて編集に戻れる",
    ],
  },
  {
    version: "5.3.0",
    date: "2026-02-08",
    time: "23:50 JST",
    changes: [
      "Luggage photos セクションをページ最上部（サイズ選択の上）に移動",
      "複数荷物の一括登録に対応: 「Add another luggage」ボタンを Measuring tape note の下に配置",
      "各荷物が独立した写真・サイズ・重量を持つマルチアイテム構造にリファクタ",
      "2個目以降の荷物にはアイテム番号ラベル + 削除ボタンを表示",
      "CTAボタンを荷物数に応じて動的変更（'Continue' / 'Continue with N items'）",
      "写真2枚を横並びレイアウトに変更（Full shot + Damage を同一行で表示）",
    ],
  },
  {
    version: "5.2.0",
    date: "2026-02-08",
    time: "23:40 JST",
    changes: [
      "荷物写真を2スロットに分割: 1枚目「Full luggage photo」を必須化（Continue条件に追加）",
      "2枚目「Damage or condition issue」は任意（1枚目登録後に表示、例: broken wheel）",
      "説明文を最小限に簡素化（ラベル+バッジのみ、長文説明を削除）",
      "自動サイズ推定は1枚目（全体写真）のみで発動するよう変更",
    ],
  },
  {
    version: "5.1.0",
    date: "2026-02-08",
    time: "23:30 JST",
    changes: [
      "Traveler Step 1（荷物入力）: 写真アップロード時にサイズを自動推定し、サイズカードを自動選択",
      "推定重量を自動入力（サイズごとのデフォルト値）、ユーザーが手動で編集可能",
      "サイズカードに上限表示を追加（例: 'Up to 100 cm | Up to 10 kg'）",
      "自動推定時に 'Auto' バッジをサイズカードに表示、'Auto-estimated' を重量欄に表示",
      "BookingData に estimatedWeight フィールドを追加",
    ],
  },
  {
    version: "5.0.1",
    date: "2026-02-08",
    time: "23:20 JST",
    changes: [
      "Traveler Step 1: Condition Photos のカメラボタンに実ファイル選択機能を実装（<input type='file' accept='image/*'>）",
      "選択画像を URL.createObjectURL でプレビュー表示、削除時に revokeObjectURL でメモリリーク防止",
      "Changelog を /changelog に独立ページとして分離（Requirements Document から切り出し）",
      "Home ページに Changelog ボタンを追加（Requirements / Screen Flow と並列配置）",
      "全 Changelog エントリのタイムスタンプを JST-4:00 に一括修正（全20エントリ）",
    ],
  },
  {
    version: "5.0.0",
    date: "2026-02-08",
    time: "23:10 JST",
    changes: [
      "Decision OS v2: 人間の判断を完全に排除する剛直な物流ステートマシンに再設計",
      "Hotel Staff: Accept/Reject を完全廃止。QRスキャン → 写真撮影で自動確定。判断ゼロ。",
      "Hotel Staff: 'Flag issue' に変更（理由入力なし、タップのみ。システムが非同期処理）",
      "Hotel Staff: ステータスを waiting / ready / flagged に再定義（'action-required' 廃止）",
      "Traveler: Time slot selector を廃止。システムが deadline のみ提示し、時間はシステムが自動割当。",
      "Traveler: Delivery Status を完全 view-only に変更。CTAボタンなし、Help連絡先のみ。",
      "i18n: Approve/Reject/Confirm/Choose の文言を全削除、'Record' / 'Flag' / 'Captured' に統一",
      "Order型: rejectionReason を廃止、flagged / flaggedAt を追加",
      "要件定義書: Design Philosophy を Decision OS v2 に更新、Actor責任分界を全面改定",
      "Changelog を /changelog に分離（Requirements Document から独立ページ化）",
    ],
  },
  {
    version: "4.9.0",
    date: "2026-02-07",
    time: "22:55 JST",
    changes: [
      "要件定義書の包括的精査・整合性チェックを実施",
      "業務フローStep 2: 「破損証明写真」→「コンディション写真（任意）」+ 時間帯選択を反映",
      "写真ポリシー（Section 9.5）を新規追加: ゲスト最大2枚・ホテル最大3枚・上書きルール・サイズ不一致の扱いを明記",
      "データ保持: evidencePhoto → photos に名称統一",
      "通知ポリシー・データ保持・写真ポリシーの表示セクションを追加",
      "配送日ロジック: timeSlot（時間帯選択）と reassurance（不安軽減）の表示セクションを追加",
    ],
  },
  {
    version: "4.8.0",
    date: "2026-02-07",
    time: "22:40 JST",
    changes: [
      "Traveler Step 1（荷物入力）: 任意のコンディション写真（最大2枚）を追加",
      "Hotel Check-in 画面: ゲスト撮影写真を参考表示 + ホテル撮影写真（最大3枚）を追加",
      "ホテル写真がゲスト写真を上書きし公式記録となる旨を明記",
      "Reject理由を変更: 'Exceeds size/weight limit' → 'Booking violation'",
      "サイズ不一致は Reject 理由にならない（システムが自動調整）",
      "Order型にtravelerPhotos / hotelPhotosフィールドを追加",
    ],
  },
  {
    version: "4.7.0",
    date: "2026-02-07",
    time: "22:30 JST",
    changes: [
      "Delivery Date画面を全面リデザイン: Delivery time セクションを追加",
      "【ホテル等】Time slot selector 追加（Morning / Afternoon / Evening）",
      "【空港・デポ等】'Expected arrival: By XX:XX' + 'Automatically scheduled' を表示",
      "フリーフォーム時刻入力を完全削除",
      "不安軽減セクション 'Good to know' を常時表示",
      "BookingData に timeSlot / expectedArrival フィールドを追加",
    ],
  },
  {
    version: "4.6.0",
    date: "2026-02-07",
    time: "22:20 JST",
    changes: [
      "Booking Confirmed 画面: text-light / icon-heavy に全面リデザイン",
      "What to do セクションを横並び3ステップ（アイコン主体）に変更",
      "Delivery Status 画面を新規実装（5段階ステータス）",
      "キャリアトラッキング: 集荷後のみ表示、追跡番号コピー可能",
      "両画面のCTAを1つに限定（Decision OS方針）",
    ],
  },
  {
    version: "4.5.0",
    date: "2026-02-07",
    time: "22:10 JST",
    changes: [
      "Payment画面: クレジットカード入力を折りたたみ式から常時表示に変更",
      "Apple Pay / Google Pay の下に 'or' 区切り線、その下にカードフォームを常に表示",
      "設計意図: ウォレット非対応ユーザーの離脱防止",
    ],
  },
  {
    version: "4.4.0",
    date: "2026-02-07",
    time: "22:05 JST",
    changes: [
      "Payment画面: Apple Pay / Google Pay を主要決済手段として上部に配置",
      "料金表示を Pay now（確定額）と Estimated total max の2段構成に変更",
      "サイズ差額の説明を「自動調整、操作不要、メール通知」に改定",
      "LLサイズの価格（¥6,000）を追加",
    ],
  },
  {
    version: "4.3.0",
    date: "2026-02-07",
    time: "21:55 JST",
    changes: [
      "要件定義書を全セクション精査・最新の実装状態と整合",
      "Phase 1 スコープ: 配送先を「任意の施設・住所」に統一",
      "サイズ定義にLL（200サイズ / 25kg）を追加",
      "Changelogの日付・時刻をJST正確値に修正",
    ],
  },
  {
    version: "4.2.0",
    date: "2026-02-07",
    time: "21:40 JST",
    changes: [
      "Booking Confirmed 画面を全面リデザイン",
      "QRコードの上に配送サマリーカード（Pickup from / Deliver to / Check in by）を追加",
      "Important セクションを3ステップのアクション手順に置換",
    ],
  },
  {
    version: "4.1.0",
    date: "2026-02-07",
    time: "21:25 JST",
    changes: [
      "Admin > Hotels セクションを新設",
      "Hotel一覧画面を追加（Active/Paused、検索、注文数表示）",
      "ホテル新規登録画面を追加（Admin専用、5セクション構成）",
    ],
  },
  {
    version: "4.0.0",
    date: "2026-02-07",
    time: "21:00 JST",
    changes: [
      "Hotel Staffのステータスを3種類に再定義: 来館待ち / 引渡待ち / 要対応",
      "受付フロー: QRスキャン → Accept or Reject の2択のみ",
      "Reject時の理由選択UI（3パターン限定）",
      "注文詳細画面を新規追加",
      "配送トラッキング表示（閲覧専用）",
    ],
  },
  {
    version: "3.3.0",
    date: "2026-02-07",
    time: "20:40 JST",
    changes: [
      "Hotel Staff 全画面に日英切替（Language Switcher）を追加",
      "ステータスガイド（Legend）を一覧上部に追加",
      "配送シール再発行ボタンを追加",
      "ステータスフィルタを検索バー下に追加",
    ],
  },
  {
    version: "3.2.0",
    date: "2026-02-07",
    time: "20:15 JST",
    changes: [
      "Step 3 (Delivery Date) に時間制約ロジックを追加",
      "空港・デポ選択時に「Time-sensitive destination」ラベルを表示",
      "Destination に destination type を追加",
    ],
  },
  {
    version: "3.1.0",
    date: "2026-02-05",
    time: "07:45 JST",
    changes: [
      "要件定義書ページ（/requirements）を新規作成",
      "包括的マスター版（Comprehensive Master）の内容を統合",
      "プロジェクト概要・Actor責任分界・ステータス遷移・料金ロジック・Ship&co連携を追加",
    ],
  },
  {
    version: "2.2.0",
    date: "2026-02-05",
    time: "07:30 JST",
    changes: [
      "配送先をホテル限定から任意の施設・住所に変更",
      "Destination画面に Search / Enter address 切替を追加",
    ],
  },
  {
    version: "2.1.0",
    date: "2026-02-05",
    time: "07:00 JST",
    changes: [
      "要件定義書ページを新規作成（/requirements）",
    ],
  },
  {
    version: "2.0.0",
    date: "2026-02-05",
    time: "06:45 JST",
    changes: [
      "フローチャートページ（/flowchart）を新規作成",
      "Traveler / Hotel Staff / Admin の3フローを視覚的に表現",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-02-05",
    time: "06:30 JST",
    changes: [
      "サイズカードを4種類（S/M/L/LL）に拡張",
      "サイズ詳細モーダルをビジュアル図式に変更",
      "禁止物モーダルをアイコン付きに改善",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-02-05",
    time: "06:00 JST",
    changes: [
      "Landing画面に信頼メッセージを追加",
      "「How it works」3ステップ説明をLandingに追加",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-02-05",
    time: "05:00 JST",
    changes: [
      "初期ワイヤーフレーム作成（全画面のモック）",
      "Traveler / Hotel Staff / Admin の3ロール実装",
    ],
  },
]

function VersionBadge({ version }: { version: string }) {
  const major = version.split(".")[0]
  const isMajor = version.endsWith(".0.0")
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono ${
      isMajor 
        ? "bg-foreground text-background font-bold" 
        : "bg-muted text-foreground"
    }`}>
      v{version}
    </span>
  )
}

function DateGroup({ date, entries }: { date: string; entries: typeof changelog }) {
  const [isOpen, setIsOpen] = useState(true)
  const formattedDate = new Date(date + "T00:00:00+09:00").toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  })

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 bg-muted/50 flex items-center justify-between text-left hover:bg-muted transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="font-medium">{formattedDate}</span>
          <span className="text-xs text-muted-foreground">{entries.length} versions</span>
        </div>
        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>
      {isOpen && (
        <div className="p-4 space-y-4">
          {entries.map((entry) => (
            <div key={entry.version} className="border-l-2 border-border pl-4">
              <div className="flex items-center gap-3">
                <VersionBadge version={entry.version} />
                <span className="text-xs text-muted-foreground font-mono">{entry.time}</span>
              </div>
              <ul className="mt-2 space-y-1">
                {entry.changes.map((change, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="shrink-0 mt-1.5 w-1 h-1 rounded-full bg-muted-foreground/50" />
                    <span>{change}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ChangelogPage() {
  
  const grouped = changelog.reduce<Record<string, typeof changelog>>((acc, entry) => {
    if (!acc[entry.date]) acc[entry.date] = []
    acc[entry.date].push(entry)
    return acc
  }, {})

  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))
  const totalVersions = changelog.length
  const latestVersion = changelog[0]

  return (
    <div className="min-h-screen bg-background">
      {}
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-muted-foreground" />
              <h1 className="font-semibold">Changelog</h1>
            </div>
          </div>
          <Link href="/requirements">
            <Button variant="ghost" size="sm">
              <FileText className="w-4 h-4 mr-2" />
              Requirements
            </Button>
          </Link>
        </div>
      </header>

      {}
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {}
        <div className="p-4 rounded-lg bg-muted/50 border border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Latest version</p>
              <p className="font-semibold text-lg">v{latestVersion.version}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Total versions</p>
              <p className="font-semibold text-lg">{totalVersions}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Last updated</p>
              <p className="font-semibold">{latestVersion.date} {latestVersion.time}</p>
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          All timestamps are in JST (Japan Standard Time, UTC+9).
        </p>

        {}
        {dates.map((date) => (
          <DateGroup key={date} date={date} entries={grouped[date]} />
        ))}
      </main>
    </div>
  )
}
