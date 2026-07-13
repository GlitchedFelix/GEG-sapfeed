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

export interface RateCard {
  id: number
  effective_date: string
  label: string | null
  long_distance_rate_zar_per_km: number
}

// Distance and weight bands are global — every rate card shares the same
// grid structure. Only the per-cell payout amount differs between cards.
export interface RateCardDistanceBand {
  id: number
  position: number
  min_km: number
  max_km: number | null
}

export interface RateCardWeightBand {
  id: number
  position: number
  label: string
  min_kg: number
  max_kg: number | null
  mode: 'flat' | 'per_ton'
  is_ibt: boolean
}

export interface RateCardCell {
  id: number
  rate_card_id: number
  weight_band_id: number
  distance_band_id: number
  amount_zar: number
}
