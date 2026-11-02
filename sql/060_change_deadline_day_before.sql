-- 060: 変更受付締切 (shipments.change_deadline_at) を「発送日の前日 17:00 JST」に統一 (2026-11-03 谷口さん決定)。
-- 旧: 発送日の2営業日前 18:00 JST (lib/change-deadline.ts の旧実装)。新しい値はコード側 (changeDeadlineAt) で保存される。
-- この SQL は、すでに保存済みの「これから発送する区間」の締切を新しい基準に揃えるためのもの。
-- 締切は後ろに延びる方向の変更 (緩める) のみ。配達完了・キャンセル済み・過去の発送日の行は触らない。
-- 本番への適用は、コードのデプロイと同時に、谷口さんの承認を得てから行う (未適用)。

update shipments
set change_deadline_at = ((shipment_date - 1)::text || 'T08:00:00Z')::timestamptz
where shipment_date is not null
  and shipment_date >= (now() at time zone 'Asia/Tokyo')::date
  and status not in ('delivered', 'cancelled')
  and change_deadline_at is distinct from ((shipment_date - 1)::text || 'T08:00:00Z')::timestamptz;
