/**
 * Shared facility master data for traveler destination screen and Ship&co address payloads.
 */

export type FacilityDestType = "hotel" | "airport"

export interface FacilityRecord {
  id: string
  name: string
  destType: FacilityDestType
  full_name: string
  company: string
  email: string
  phone: string
  country: string
  zip: string
  province: string
  city: string
  address1: string
  address2: string
  extra: string
}

/** Default pickup when user confirms without changing (QR / demo). */
export const DEFAULT_PICKUP_FACILITY: FacilityRecord = {
  id: "p1",
  name: "Sakura Hotel Shinjuku",
  destType: "hotel",
  full_name: "Sakura Hotel Shinjuku Front Desk",
  company: "Sakura Hotel Shinjuku",
  email: "",
  phone: "",
  country: "JP",
  zip: "160-0021",
  province: "東京都",
  city: "新宿区",
  address1: "歌舞伎町2-21-4",
  address2: "Sakura Hotel Shinjuku",
  extra: "",
}

export const MOCK_FACILITIES: FacilityRecord[] =[
  {
    "id": "osaka-1",
    "name": "W Osaka",
    "destType": "hotel",
    "full_name": "W Osaka Front Desk",
    "company": "W Osaka",
    "email": "w.osaka.concierge@whotels.com",
    "phone": "+81 6-6484-5355",
    "country": "JP",
    "zip": "542-0081",
    "province": "大阪府",
    "city": "大阪市",
    "address1": "中央区南船場4-1-3",
    "address2": "W Osaka",
    "extra": ""
  },
  {
    "id": "osaka-2",
    "name": "Conrad Osaka",
    "destType": "hotel",
    "full_name": "Conrad Osaka Front Desk",
    "company": "Conrad Osaka",
    "email": "osaka.concierge@conradhotels.com",
    "phone": "+81 6-6222-0111",
    "country": "JP",
    "zip": "530-0005",
    "province": "大阪府",
    "city": "大阪市",
    "address1": "北区中之島3-2-4",
    "address2": "Conrad Osaka",
    "extra": ""
  },
  {
    "id": "osaka-3",
    "name": "Centara Grand Hotel Osaka",
    "destType": "hotel",
    "full_name": "Centara Grand Hotel Osaka Front Desk",
    "company": "Centara Grand Hotel Osaka",
    "email": "cgoj@chr.co.th",
    "phone": "+81 6-6616-9945",
    "country": "JP",
    "zip": "556-0011",
    "province": "大阪府",
    "city": "大阪市",
    "address1": "浪速区難波中2-11-50",
    "address2": "Centara Grand Hotel Osaka",
    "extra": ""
  },
  {
    "id": "kyoto-1",
    "name": "The Ritz-Carlton Kyoto",
    "destType": "hotel",
    "full_name": "The Ritz-Carlton Kyoto Front Desk",
    "company": "The Ritz-Carlton Kyoto",
    "email": "rc.kyoto.concierge@ritzcarlton.com",
    "phone": "+81 75-746-5555",
    "country": "JP",
    "zip": "604-0902",
    "province": "京都府",
    "city": "京都市",
    "address1": "中京区二条大橋上る鉾田町",
    "address2": "The Ritz-Carlton Kyoto",
    "extra": ""
  },
  {
    "id": "kyoto-2",
    "name": "Ace Hotel Kyoto",
    "destType": "hotel",
    "full_name": "Ace Hotel Kyoto Front Desk",
    "company": "Ace Hotel Kyoto",
    "email": "kyoto@acehotel.com",
    "phone": "+81 75-501-2222",
    "country": "JP",
    "zip": "604-8185",
    "province": "京都府",
    "city": "京都市",
    "address1": "中京区車屋町245-2",
    "address2": "Ace Hotel Kyoto",
    "extra": ""
  },
  {
    "id": "kyoto-3",
    "name": "Park Hyatt Kyoto",
    "destType": "hotel",
    "full_name": "Park Hyatt Kyoto Front Desk",
    "company": "Park Hyatt Kyoto",
    "email": "kyoto.reservations@hyatt.com",
    "phone": "+81 75-534-1234",
    "country": "JP",
    "zip": "605-0826",
    "province": "京都府",
    "city": "京都市",
    "address1": "東山区高台寺桝屋町360",
    "address2": "Park Hyatt Kyoto",
    "extra": ""
  },
  {
    "id": "tokyo-1",
    "name": "Aman Tokyo",
    "destType": "hotel",
    "full_name": "Aman Tokyo Front Desk",
    "company": "Aman Tokyo",
    "email": "tokyo.reservations@aman.com",
    "phone": "+81 3-5224-3333",
    "country": "JP",
    "zip": "100-0004",
    "province": "東京都",
    "city": "千代田区",
    "address1": "大手町1-5-6",
    "address2": "Aman Tokyo",
    "extra": ""
  },
  {
    "id": "tokyo-2",
    "name": "Hotel Nikko Narita",
    "destType": "hotel",
    "full_name": "Hotel Nikko Narita Front Desk",
    "company": "Hotel Nikko Narita",
    "email": "nrt-reservation@nikko-hotels.com",
    "phone": "+81 476-33-1111",
    "country": "JP",
    "zip": "286-0106",
    "province": "千葉県",
    "city": "成田市",
    "address1": "取香500",
    "address2": "Hotel Nikko Narita",
    "extra": ""
  },
  {
    "id": "tokyo-3",
    "name": "The Kahala Hotel & Resort Yokohama",
    "destType": "hotel",
    "full_name": "The Kahala Hotel & Resort Yokohama Front Desk",
    "company": "The Kahala Hotel & Resort Yokohama",
    "email": "info.yokohama@thekahala.jp",
    "phone": "+81 45-350-1111",
    "country": "JP",
    "zip": "220-0012",
    "province": "神奈川県",
    "city": "横浜市",
    "address1": "西区みなとみらい1-1-3",
    "address2": "The Kahala Hotel & Resort Yokohama",
    "extra": ""
  },
  {
    "id": "hokkaido-1",
    "name": "Park Hyatt Niseko Hanazono",
    "destType": "hotel",
    "full_name": "Park Hyatt Niseko Hanazono Front Desk",
    "company": "Park Hyatt Niseko Hanazono",
    "email": "niseko.reservations@hyatt.com",
    "phone": "+81 1366-58-000",
    "country": "JP",
    "zip": "044-0082",
    "province": "北海道",
    "city": "虻田郡倶知安町",
    "address1": "岩尾別328-47",
    "address2": "Park Hyatt Niseko Hanazono",
    "extra": ""
  },
  {
    "id": "ap-1",
    "name": "Narita Airport T1",
    "destType": "airport",
    "full_name": "Narita Airport T1",
    "company": "Narita Airport",
    "email": "info@narita-airport.jp",
    "phone": "+81 476-34-8000",
    "country": "JP",
    "zip": "282-0001",
    "province": "千葉県",
    "city": "成田市",
    "address1": "古込字古込1-1",
    "address2": "Terminal 1",
    "extra": ""
  },
  {
    "id": "ap-2",
    "name": "Haneda Airport T3",
    "destType": "airport",
    "full_name": "Haneda Airport T3",
    "company": "Haneda Airport",
    "email": "haneda-info@tokyo-airport.co.jp",
    "phone": "+81 3-5757-8111",
    "country": "JP",
    "zip": "144-0041",
    "province": "東京都",
    "city": "大田区",
    "address1": "羽田空港2-6-5",
    "address2": "Terminal 3",
    "extra": ""
  },
  {
    "id": "ap-3",
    "name": "Kansai International Airport (KIX)",
    "destType": "airport",
    "full_name": "Kansai International Airport",
    "company": "Kansai International Airport",
    "email": "info@kansai-airport.or.jp",
    "phone": "+81 72-455-1111",
    "country": "JP",
    "zip": "549-0001",
    "province": "大阪府",
    "city": "泉佐野市",
    "address1": "泉州空港北1",
    "address2": "Kansai International Airport",
    "extra": ""
  }
]

export function formatFacilityAddress(f: FacilityRecord): string {
  return `${f.province}${f.city}${f.address1} ${f.address2}`.trim()
}

export function findFacilityById(id: string): FacilityRecord | undefined {
  if (id === DEFAULT_PICKUP_FACILITY.id) return DEFAULT_PICKUP_FACILITY
  return MOCK_FACILITIES.find((x) => x.id === id)
}
