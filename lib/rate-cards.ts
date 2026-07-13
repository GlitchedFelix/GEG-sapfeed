import type { RateCard, RateCardCell, RateCardDistanceBand, RateCardWeightBand } from '@/lib/types'

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

  // Under 1 ton always uses the flat weight-band rate, regardless of IBT status.
  // IBT only distinguishes which per-ton rate applies once weight reaches 1 ton.
  const weightBand =
    netWeightKg >= 1000
      ? weightBands.find((b) => b.mode === 'per_ton' && b.is_ibt === isIbt)
      : weightBands.find((b) => b.mode === 'flat' && inBand(netWeightKg, b.min_kg, b.max_kg))
  if (!weightBand) return null

  const distanceBand = distanceBands.find((b) => inBand(distanceKm, b.min_km, b.max_km))
  if (!distanceBand) return null

  const cell = cardCells.find(
    (c) => c.weight_band_id === weightBand.id && c.distance_band_id === distanceBand.id
  )
  if (!cell) return null

  return weightBand.mode === 'per_ton' ? cell.amount_zar * (netWeightKg / 1000) : cell.amount_zar
}
