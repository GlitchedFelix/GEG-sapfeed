import type { Brand, RateCard, RateCardCell, RateCardDistanceBand, RateCardWeightBand, RateSystem } from '@/lib/types'

// Routes a delivery to its rate card system. CTM always uses the CTM
// system; Italtile splits into its webstore (identified by store name)
// vs every other physical store.
export function getRateSystemForRow(brand: Brand, storeName: string | null): RateSystem {
  if (brand === 'CTM') return 'CTM'
  return storeName && /webstore/i.test(storeName) ? 'ITALTILE_WEBSTORE' : 'ITALTILE_STORE'
}

// Picks the rate card in force on a given delivery date: the one with the
// latest effective_date that is still on/before that date.
export function getApplicableRateCard(cards: RateCard[], deliveryDate: string | null): RateCard | null {
  if (!deliveryDate) return null
  let best: RateCard | null = null
  for (const card of cards) {
    if (card.effective_date > deliveryDate) continue
    if (!best || card.effective_date > best.effective_date) best = card
  }
  return best
}

function inBand(value: number, min: number, max: number | null): boolean {
  return value >= min && (max == null || value < max)
}

// distanceBands and weightBands are the global, shared grid structure —
// the same for every rate card. Only cells (and long_distance_rate_zar_per_km)
// are specific to the given card.
export function computePayout(
  card: RateCard,
  distanceBands: RateCardDistanceBand[],
  weightBands: RateCardWeightBand[],
  cells: RateCardCell[],
  distanceKm: number | null,
  netWeightKg: number | null,
  isIbt: boolean
): number | null {
  if (distanceKm == null || netWeightKg == null) return null

  const cardCells = cells.filter((c) => c.rate_card_id === card.id)

  // Distances beyond the last configured band fall back to a flat per-km rate.
  const maxBandedKm = distanceBands.reduce(
    (max, b) => (b.max_km == null ? Infinity : Math.max(max, b.max_km)),
    0
  )
  if (distanceKm >= maxBandedKm) {
    return distanceKm * card.long_distance_rate_zar_per_km
  }

  // IBT always uses the IBT per-ton rate, no matter the weight. Non-IBT uses
  // the flat weight-band rate below 1 ton, and the "1 Ton+" per-ton rate at
  // or above it.
  const weightBand = isIbt
    ? weightBands.find((b) => b.mode === 'per_ton' && b.is_ibt)
    : netWeightKg >= 1000
      ? weightBands.find((b) => b.mode === 'per_ton' && !b.is_ibt)
      : weightBands.find((b) => b.mode === 'flat' && inBand(netWeightKg, b.min_kg, b.max_kg))
  if (!weightBand) return null

  const distanceBand = distanceBands.find((b) => inBand(distanceKm, b.min_km, b.max_km))
  if (!distanceBand) return null

  const cell = cardCells.find(
    (c) => c.weight_band_id === weightBand.id && c.distance_band_id === distanceBand.id
  )
  if (!cell) return null

  if (weightBand.mode !== 'per_ton') return cell.amount_zar

  // IBT under 1 ton is billed as a full ton, never scaled down below the per-ton rate.
  const tons = Math.max(netWeightKg, 1000) / 1000
  return cell.amount_zar * tons
}

// Italtile's payout formula differs from CTM's: above 1000kg it's a flat
// base charge (the top flat band's amount) plus a per-kg surcharge only on
// the kg above 1000 — not a per-ton multiplier applied to the whole weight.
// Distances beyond the last band, or weight beyond 2 tonnes, are a custom
// quote (no fallback formula, unlike CTM's long-distance rate) -> null.
export function computeItaltilePayout(
  card: RateCard,
  distanceBands: RateCardDistanceBand[],
  weightBands: RateCardWeightBand[],
  cells: RateCardCell[],
  distanceKm: number | null,
  netWeightKg: number | null
): number | null {
  if (distanceKm == null || netWeightKg == null || netWeightKg > 2000) return null

  const cardCells = cells.filter((c) => c.rate_card_id === card.id)

  const distanceBand = distanceBands.find((b) => inBand(distanceKm, b.min_km, b.max_km))
  if (!distanceBand) return null

  const cellFor = (weightBandId: number) =>
    cardCells.find((c) => c.weight_band_id === weightBandId && c.distance_band_id === distanceBand.id)

  if (netWeightKg < 1000) {
    const weightBand = weightBands.find((b) => b.mode === 'flat' && inBand(netWeightKg, b.min_kg, b.max_kg))
    if (!weightBand) return null
    const cell = cellFor(weightBand.id)
    return cell ? cell.amount_zar : null
  }

  const topFlatBand = weightBands
    .filter((b) => b.mode === 'flat' && b.max_kg === 1000)
    .sort((a, b) => b.min_kg - a.min_kg)[0]
  const surchargeBand = weightBands.find((b) => b.mode === 'over_1000_surcharge')
  if (!topFlatBand || !surchargeBand) return null

  const base = cellFor(topFlatBand.id)
  const surcharge = cellFor(surchargeBand.id)
  if (!base || !surcharge) return null

  return base.amount_zar + (netWeightKg - 1000) * surcharge.amount_zar
}
