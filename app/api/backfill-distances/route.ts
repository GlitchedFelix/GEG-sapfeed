import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { geocodeAddress, geocodeStructuredAddress, type GeocodeOutcome } from '@/lib/geocoding'
import { getDrivingDistanceKm } from '@/lib/routing'
import { resolveOriginStore } from '@/lib/origin-store'

export const runtime = 'nodejs'
export const maxDuration = 55

// Stop starting new rows once this much wall-clock time has elapsed, leaving
// headroom under maxDuration for the trailing count queries + response. This
// (not the row-count batch size) is what actually bounds an invocation, so
// the batch size can safely be raised well above a fixed worst-case estimate.
const TIME_BUDGET_MS = 45_000
const timedOut = (start: number) => Date.now() - start > TIME_BUDGET_MS

export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const start = Date.now()

  const batchSize = Math.min(
    parseInt(request.nextUrl.searchParams.get('batch') ?? '25', 10),
    150
  )

  // Cache store coords within this call
  const storeCache = new Map<string, { lat: number; lon: number } | null>()

  // Cache customer geocodes by normalized address within this call, so
  // repeat customer addresses in the same batch cost one Mapbox
  // round-trip instead of one per row.
  const geoCache = new Map<string, GeocodeOutcome>()
  function addressKey(row: { street: string | null; city: string | null; country: string | null }) {
    return [row.street, row.city, row.country].map((s) => (s ?? '').trim().toLowerCase()).join('|')
  }

  // Resolves store coordinates for a delivery row, honoring IBT From for
  // webstore deliveries (see resolveOriginStore) — geocodes fresh on a miss,
  // same as the import route, since this is the only place some IBT-origin
  // stores will ever get looked up for the first time.
  async function getOriginStoreLoc(row: { store_code: string; store_name: string; ibt_from: string | null; brand: string }) {
    const origin = resolveOriginStore(row)
    if (storeCache.has(origin.storeCode)) return storeCache.get(origin.storeCode)!

    const { data } = await supabase
      .from('store_locations')
      .select('lat, lon')
      .eq('store_code', origin.storeCode)
      .maybeSingle()

    let loc: { lat: number; lon: number } | null =
      (data?.lat != null && data?.lon != null) ? { lat: data.lat as number, lon: data.lon as number } : null

    if (!loc) {
      const query = `${origin.storeName} South Africa`
      const geo = await geocodeAddress(query)
      if (geo) {
        loc = { lat: geo.lat, lon: geo.lon }
        await supabase.from('store_locations').upsert({
          store_code: origin.storeCode,
          store_name: origin.storeName,
          brand: row.brand,
          lat: geo.lat,
          lon: geo.lon,
          geocoded_at: new Date().toISOString(),
          geocode_query: query,
        })
      }
    }

    storeCache.set(origin.storeCode, loc)
    return loc
  }

  let processed = 0
  let pass0Found = 0
  let pass1Found = 0
  let pass2Found = 0
  const errors: string[] = []
  function logWriteError(rowHash: string, error: { message: string } | null) {
    if (!error) return
    console.error(`[backfill-distances] update failed for row_hash=${rowHash}: ${error.message}`)
    if (errors.length < 5) errors.push(`${rowHash}: ${error.message}`)
  }

  // --- Pass 0: retroactively correct webstore/IBT rows already given a
  // distance under the old (webstore's own store) coordinates. Only ever
  // matches webstore + ibt_from rows, so it's a permanent no-op for
  // everything else once each matching row is marked backfilled. ---
  const { data: ibtOriginRows } = await supabase
    .from('deliveries')
    .select('row_hash, store_code, store_name, brand, ibt_from, customer_lat, customer_lon')
    .ilike('store_name', '%webstore%')
    .not('ibt_from', 'is', null)
    .not('distance_km', 'is', null)
    .eq('ibt_origin_backfilled', false)
    .limit(batchSize)

  pass0Found = (ibtOriginRows ?? []).length

  for (const row of (ibtOriginRows ?? [])) {
    if (timedOut(start)) break
    if (row.customer_lat == null || row.customer_lon == null) {
      const { error } = await supabase.from('deliveries').update({ ibt_origin_backfilled: true }).eq('row_hash', row.row_hash)
      logWriteError(row.row_hash, error)
      continue
    }

    const storeLoc = await getOriginStoreLoc(row)
    let distanceKm: number | null = null
    if (storeLoc) {
      const distanceResult = await getDrivingDistanceKm(storeLoc, { lat: row.customer_lat, lon: row.customer_lon })
      if ('km' in distanceResult) distanceKm = distanceResult.km
    }

    const { error: updateError } = await supabase
      .from('deliveries')
      .update({ distance_km: distanceKm, ibt_origin_backfilled: true })
      .eq('row_hash', row.row_hash)
    logWriteError(row.row_hash, updateError)

    processed++
  }

  // --- Pass 1: geocode customer addresses that haven't been attempted yet ---
  // Using customer_lat IS NULL + geocode_failed=false as the sentinel so rows
  // aren't re-processed once Mapbox has already failed to match them.
  // Rows lacking every address part (street/city/country all null) fall
  // through to the addressParts.length === 0 check below and get marked
  // geocode_failed permanently — they must stay in this query's candidate
  // set (not filtered out by requiring city specifically) or they'd never
  // be attempted, never get a sentinel, and sit as invisible "pending" rows
  // forever since the remaining-count queries below exclude them too.
  const { data: ungeocodedRows } = await supabase
    .from('deliveries')
    .select('row_hash, store_code, store_name, brand, ibt_from, street, city, country')
    .is('customer_lat', null)
    .eq('geocode_failed', false)
    .limit(batchSize)

  pass1Found = (ungeocodedRows ?? []).length

  for (const row of (ungeocodedRows ?? [])) {
    if (timedOut(start)) break

    const addressParts = [row.street, row.city, row.country].filter(Boolean)
    // A city is the minimum viable signal for a useful geocode — street/country
    // alone geocode too vaguely to trust. Rows missing it (or every part) are
    // marked permanently rather than silently skipped, so they get a sentinel
    // instead of sitting invisible forever (excluded from every remaining-count
    // query yet still shown as "pending" in the UI).
    if (row.city == null || addressParts.length === 0) {
      const { error } = await supabase.from('deliveries').update({ geocode_failed: true }).eq('row_hash', row.row_hash)
      logWriteError(row.row_hash, error)
      continue
    }

    // Every row is geocoded from its own street address — no coordinate
    // reuse across rows, even within the same city/country, since two
    // addresses in the same city can be kilometers apart. Exact repeat
    // addresses within this batch (same customer, multiple deliveries) do
    // reuse a cached result instead of re-hitting Mapbox.
    const key = addressKey(row)
    let geo = geoCache.get(key)
    if (!geo) {
      geo = await geocodeStructuredAddress({ street: row.street, city: row.city, country: row.country })
      // Don't cache a transient failure — worth a fresh attempt if the same
      // address recurs later in this batch.
      if (!('error' in geo && geo.error === 'http_error')) geoCache.set(key, geo)
    }

    if ('error' in geo) {
      if (geo.error === 'no_match') {
        // Mark permanently so this row is never re-fetched by the backfill.
        const { error } = await supabase.from('deliveries').update({ geocode_failed: true }).eq('row_hash', row.row_hash)
        logWriteError(row.row_hash, error)
      }
      // http_error is transient — leave the row untouched so the next
      // backfill run retries it instead of getting stuck permanently.
      continue
    }
    const customerLat = geo.lat
    const customerLon = geo.lon

    const storeLoc = await getOriginStoreLoc(row)
    let distanceKm: number | null = null
    if (storeLoc) {
      const distanceResult = await getDrivingDistanceKm(storeLoc, { lat: customerLat, lon: customerLon })
      if ('km' in distanceResult) distanceKm = distanceResult.km
    }

    const { error: updateError } = await supabase
      .from('deliveries')
      .update({ customer_lat: customerLat, customer_lon: customerLon, distance_km: distanceKm })
      .eq('row_hash', row.row_hash)
    logWriteError(row.row_hash, updateError)

    processed++
  }

  // --- Pass 2: compute distances for rows already geocoded but missing distance ---
  // This runs after store coords are manually added in Settings.
  let rateLimited = 0
  if (pass1Found === 0) {
    const { data: pendingRows } = await supabase
      .from('deliveries')
      .select('row_hash, store_code, store_name, brand, ibt_from, customer_lat, customer_lon')
      .is('distance_km', null)
      .not('customer_lat', 'is', null)
      .eq('distance_failed', false)
      .order('row_hash')
      .limit(batchSize)

    pass2Found = (pendingRows ?? []).length

    for (const row of (pendingRows ?? [])) {
      if (timedOut(start)) break
      if (row.customer_lat == null) continue

      const storeLoc = await getOriginStoreLoc(row)
      if (!storeLoc) {
        const { error: updateError } = await supabase
          .from('deliveries')
          .update({ distance_failed: true, distance_fail_reason: 'no_store_location' })
          .eq('row_hash', row.row_hash)
        logWriteError(row.row_hash, updateError)
        continue
      }

      const distanceResult = await getDrivingDistanceKm(
        storeLoc,
        { lat: row.customer_lat, lon: row.customer_lon }
      )

      if ('error' in distanceResult) {
        if (distanceResult.error === 'rate_limited') {
          // Transient — don't mark permanently failed, just stop this batch
          // early so we don't burn through more calls the API will also reject.
          rateLimited++
          break
        }
        const { error: updateError } = await supabase
          .from('deliveries')
          .update({ distance_failed: true, distance_fail_reason: distanceResult.error })
          .eq('row_hash', row.row_hash)
        logWriteError(row.row_hash, updateError)
        continue
      }

      const { error: updateError } = await supabase
        .from('deliveries')
        .update({ distance_km: distanceResult.km })
        .eq('row_hash', row.row_hash)
      logWriteError(row.row_hash, updateError)

      processed++
    }
  }

  // Remaining = rows with no customer_lat (not yet geocoded) + rows geocoded but
  // still eligible for a distance attempt (excludes permanently-failed rows).
  const { count: noCoords } = await supabase
    .from('deliveries')
    .select('*', { count: 'exact', head: true })
    .is('customer_lat', null)
    .eq('geocode_failed', false)

  const { count: noDistance } = await supabase
    .from('deliveries')
    .select('*', { count: 'exact', head: true })
    .is('distance_km', null)
    .not('customer_lat', 'is', null)
    .eq('distance_failed', false)

  const { count: distanceFailed } = await supabase
    .from('deliveries')
    .select('*', { count: 'exact', head: true })
    .eq('distance_failed', true)

  return NextResponse.json({
    processed,
    remainingGeocode: noCoords ?? 0,
    remainingDistance: noDistance ?? 0,
    remaining: (noCoords ?? 0) + (noDistance ?? 0),
    distanceFailed: distanceFailed ?? 0,
    rateLimited,
    // True only when every pass found zero rows to attempt — caller should stop.
    exhausted: pass0Found === 0 && pass1Found === 0 && pass2Found === 0,
    errors,
  })
}
