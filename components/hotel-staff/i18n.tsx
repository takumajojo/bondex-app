"use client"

import { createContext, useContext, useState, type ReactNode } from "react"

export type Locale = "en" | "ja"

interface I18nContextType {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string) => string
}

const translations: Record<string, Record<Locale, string>> = {
  
  "header.title": { en: "BondEx Staff", ja: "BondEx Staff" },
  "header.logout": { en: "Sign out", ja: "ログアウト" },

  
  "login.title": { en: "BondEx Staff", ja: "BondEx Staff" },
  "login.subtitle": { en: "Hotel check-in portal", ja: "ホテル受付ポータル" },
  "login.hotelCode": { en: "Hotel code", ja: "ホテルコード" },
  "login.hotelCodePlaceholder": { en: "Enter hotel code", ja: "ホテルコードを入力" },
  "login.password": { en: "Password", ja: "パスワード" },
  "login.passwordPlaceholder": { en: "Enter password", ja: "パスワードを入力" },
  "login.submit": { en: "Sign in", ja: "ログイン" },
  "login.loading": { en: "Signing in...", ja: "ログイン中..." },
  "login.session": { en: "Sessions remain active for 30 days", ja: "セッションは30日間有効です" },

  
  "orders.search": { en: "Search by QR, order ID, or guest name...", ja: "QR・注文ID・ゲスト名で検索..." },
  "orders.noOrders": { en: "No orders found", ja: "注文が見つかりません" },
  "orders.noOrdersSub": { en: "No pending orders at the moment", ja: "現在対応待ちの注文はありません" },
  "orders.tryDifferent": { en: "Try a different search term", ja: "別のキーワードで検索してください" },
  "orders.items": { en: "items", ja: "個" },
  "orders.item": { en: "item", ja: "個" },
  "orders.checkin": { en: "Check-in", ja: "チェックイン" },
  "orders.today": { en: "Today", ja: "本日" },
  "orders.tomorrow": { en: "Tomorrow", ja: "明日" },
  "orders.scanQr": { en: "Position QR code here", ja: "QRコードをここに合わせてください" },
  "orders.simulateScan": { en: "Simulate scan", ja: "スキャンをシミュレート" },
  "orders.filterAll": { en: "All", ja: "すべて" },
  "orders.flaggedItems": { en: "flagged items", ja: "件のフラグ付き" },
  "orders.systemHandling": { en: "System is handling", ja: "システム対応中" },

  
  "status.waiting": { en: "Waiting for guest", ja: "来館待ち" },
  "status.ready": { en: "Ready for pickup", ja: "配送業者引渡待ち" },
  "status.flagged": { en: "Flagged", ja: "フラグ付き" },

  
  "statusDesc.waiting": { en: "Guest has booked. Luggage not yet recorded at front desk.", ja: "ゲストが予約済み。フロントでの荷物記録はまだ完了していません。" },
  "statusDesc.ready": { en: "Luggage recorded. Label issued. Waiting for carrier pickup.", ja: "荷物記録完了・シール発行済み。配送業者の集荷待ち。" },
  "statusDesc.flagged": { en: "Issue flagged by staff. System is handling asynchronously.", ja: "スタッフがフラグを立てました。システムが非同期で対応中。" },

  
  "legend.title": { en: "Status Guide", ja: "ステータスガイド" },

  
  "reissue.button": { en: "Reissue label", ja: "配送シール再発行" },
  "reissue.title": { en: "Reissue shipping label?", ja: "配送シールを再発行しますか？" },
  "reissue.warning": { en: "The previous label will be invalidated. Tracking number remains unchanged.", ja: "以前のシールは無効になります。トラッキング番号は変更されません。" },
  "reissue.reissueLabel": { en: "Reissue", ja: "再発行する" },
  "reissue.cancel": { en: "Cancel", ja: "キャンセル" },
  "reissue.success": { en: "New label generated", ja: "新しいシールを発行しました" },
  "reissue.print": { en: "Print label", ja: "シールを印刷" },

  
  "checkin.title": { en: "Guest check-in", ja: "ゲストチェックイン" },
  "checkin.qrVerified": { en: "QR Code Verified", ja: "QRコード確認済み" },
  "checkin.qrVerifiedSub": { en: "Scanned successfully", ja: "スキャン完了" },
  "checkin.orderSummary": { en: "Order Summary", ja: "注文概要" },
  "checkin.guestName": { en: "Guest name", ja: "ゲスト名" },
  "checkin.orderId": { en: "Order ID", ja: "注文ID" },
  "checkin.luggage": { en: "Luggage", ja: "荷物" },
  "checkin.size": { en: "Size", ja: "サイズ" },
  "checkin.checkInDate": { en: "Check-in date", ja: "チェックイン予定日" },

  
  "capture.title": { en: "Capture luggage photo", ja: "荷物の写真を撮影" },
  "capture.subtitle": { en: "Take at least one photo of the luggage.", ja: "荷物の写真を1枚以上撮影してください。" },
  "capture.officialRecord": { en: "This photo becomes the official delivery record.", ja: "この写真が公式の配送記録になります。" },
  "capture.takePhoto": { en: "Capture photo", ja: "撮影する" },
  "capture.takeAnother": { en: "Capture another", ja: "もう1枚撮影" },
  "capture.capturing": { en: "Capturing...", ja: "撮影中..." },
  "capture.photosCaptured": { en: "photo(s) captured", ja: "枚撮影済み" },
  "capture.recorded": { en: "Recorded", ja: "記録完了" },
  "capture.autoFinalize": { en: "Luggage is recorded at photo capture. No further steps needed.", ja: "写真撮影で荷物の記録が完了します。追加の手順は不要です。" },
  "capture.flagIssue": { en: "Flag issue", ja: "問題を報告" },

  
  "photos.travelerTitle": { en: "Traveler photos", ja: "ゲスト撮影写真" },
  "photos.travelerDesc": { en: "Reference only. Taken by guest before check-in.", ja: "参考用。チェックイン前にゲストが撮影。" },
  "photos.hotelTitle": { en: "Recorded photos", ja: "記録写真" },

  
  "success.title": { en: "Recorded", ja: "記録完了" },
  "success.auto": { en: "Completed automatically", ja: "自動的に完了しました" },
  "success.statusUpdated": { en: "Status: Ready for pickup", ja: "ステータス：配送業者引渡待ち" },
  "success.labelGenerated": { en: "Shipping label generated", ja: "配送シールを発行" },
  "success.labelSent": { en: "Label sent to printer", ja: "プリンターに送信済み" },
  "success.trackingAssigned": { en: "Tracking number assigned", ja: "トラッキング番号を付与" },
  "success.shippingLabel": { en: "Shipping label", ja: "配送シール" },
  "success.nextStepTitle": { en: "Next step", ja: "次のステップ" },
  "success.step1": { en: "Collect the printed label from the printer", ja: "プリンターからシールを取得" },
  "success.step2": { en: "Attach label to the luggage", ja: "シールを荷物に貼り付ける" },
  "success.step3": { en: "Carrier will collect during scheduled window", ja: "配送業者が集荷時間帯に集荷します" },
  "success.done": { en: "Done", ja: "完了" },

  
  "detail.title": { en: "Order detail", ja: "注文詳細" },
  "detail.status": { en: "Status", ja: "ステータス" },
  "detail.guestName": { en: "Guest name", ja: "ゲスト名" },
  "detail.orderId": { en: "Order ID", ja: "注文ID" },
  "detail.luggage": { en: "Luggage", ja: "荷物" },
  "detail.checkInDate": { en: "Check-in date", ja: "チェックイン予定日" },
  "detail.tracking": { en: "Delivery tracking", ja: "配送追跡" },
  "detail.carrier": { en: "Carrier", ja: "配送業者" },
  "detail.trackingNumber": { en: "Tracking number", ja: "トラッキング番号" },
  "detail.copied": { en: "Copied", ja: "コピーしました" },
  "detail.deliveryStatus": { en: "Delivery status", ja: "配送状況" },
  "detail.trackingWaiting": { en: "Waiting for pickup", ja: "集荷待ち" },
  "detail.trackingInTransit": { en: "In transit", ja: "配送中" },
  "detail.trackingAtDepot": { en: "Held at depot", ja: "営業所留め" },
  "detail.trackingDelivered": { en: "Delivered", ja: "配達完了" },
  "detail.viewOnly": { en: "View only. Status is system-assigned.", ja: "閲覧のみ。ステータスはシステムが自動設定します。" },
  "detail.back": { en: "Back to list", ja: "一覧に戻る" },

  
  "exception.title": { en: "Issue flagged", ja: "問題報告済み" },
  "exception.qrIssue": { en: "QR code issue", ja: "QRコードの問題" },
  "exception.qrDamaged": { en: "QR Code Damaged", ja: "QRコード破損" },
  "exception.qrDamagedDesc": { en: "The QR code cannot be scanned or verified.", ja: "QRコードをスキャンまたは確認できません。" },
  "exception.resolution": { en: "Resolution", ja: "対応方法" },
  "exception.resolutionDesc": { en: "Assign a new QR code to this booking. The guest will receive the new code via email.", ja: "この予約に新しいQRコードを割り当てます。ゲストにメールで新しいコードが送信されます。" },
  "exception.noReentry": { en: "No re-entry required", ja: "再入力は不要です" },
  "exception.noRepayment": { en: "No re-payment required", ja: "再決済は不要です" },
  "exception.reassign": { en: "Reassign new QR", ja: "新しいQRを再割当" },
  "exception.reassigning": { en: "Reassigning...", ja: "再割当中..." },
  "exception.reassignSuccess": { en: "New QR assigned", ja: "新しいQRを割り当てました" },
  "exception.reassignSuccessDesc": { en: "The guest will receive a new QR code via email. They can proceed with check-in using the new code.", ja: "ゲストにメールで新しいQRコードが送信されます。新しいコードでチェックインを進められます。" },
  "exception.note": { en: "Note:", ja: "注意:" },
  "exception.noteDesc": { en: "No re-entry or re-payment required. The original booking remains valid.", ja: "再入力・再決済は不要です。元の予約はそのまま有効です。" },
  "exception.backToList": { en: "Back to order list", ja: "注文一覧に戻る" },
}

const I18nContext = createContext<I18nContextType | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    if (typeof navigator !== "undefined") {
      return navigator.language.startsWith("ja") ? "ja" : "en"
    }
    return "en"
  })

  const t = (key: string): string => {
    return translations[key]?.[locale] ?? key
  }

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error("useI18n must be used within I18nProvider")
  return context
}
