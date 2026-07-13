export type Brand = 'CTM' | 'ITALTILE'

export interface DeliveryRecord {
  row_hash: string
  delivery_number: number
  billing_document: number
  brand: Brand
  store_code: string
  store_name: string
  customer_name: string | null
  street: string | null
  city: string | null
  country: string | null
  telephone: string | null
  supplier_store: string | null
  ibt_from: string | null
  ibt_to: string | null
  obo_order: boolean
  created_on: string | null // ISO date string
  delivery_date: string | null
  sales_document: number | null
  sales_representative: string | null
  gross_weight_kg: number | null
  net_weight_kg: number | null
  invoice_amount_zar: number | null
  transport1_amount_zar: number | null
  transport2_amount_zar: number | null
  customer_lat: number | null
  customer_lon: number | null
  distance_km: number | null
}

export interface ImportResult {
  brand: Brand
  filename: string
  totalRows: number
  inserted: number
  duplicates: number
  errors: string[]
}

// Each brand/channel has its own independent rate card system: its own
// bands and its own effective-dated cards. CTM's system predates the
// others and is the only one using the 'per_ton' weight-band mode /
// long_distance_rate_zar_per_km fallback.
export type RateSystem = 'CTM' | 'ITALTILE_STORE' | 'ITALTILE_WEBSTORE'

export interface RateCard {
  id: number
  system: RateSystem
  effective_date: string
  label: string | null
  long_distance_rate_zar_per_km: number
}

// Distance and weight bands are shared by every rate card within the same
// system. Only the per-cell payout amount differs between cards.
export interface RateCardDistanceBand {
  id: number
  system: RateSystem
  position: number
  min_km: number
  max_km: number | null
}

export interface RateCardWeightBand {
  id: number
  system: RateSystem
  position: number
  label: string
  min_kg: number
  max_kg: number | null
  // 'flat': amount_zar is the payout directly.
  // 'per_ton' (CTM only): amount_zar * (net_weight_kg / 1000).
  // 'over_1000_surcharge' (Italtile only): amount_zar is a R/kg rate
  // added on top of the system's top flat band, for kg above 1000.
  mode: 'flat' | 'per_ton' | 'over_1000_surcharge'
  is_ibt: boolean
}

export interface RateCardCell {
  id: number
  rate_card_id: number
  weight_band_id: number
  distance_band_id: number
  amount_zar: number
}
