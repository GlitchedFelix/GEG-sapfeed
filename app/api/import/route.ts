import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { parseSapExport } from '@/lib/sap-parser'
import { geocodeAddress, geocodeStructuredAddress, type GeocodeOutcome } from '@/lib/geocoding'
import { getDrivingDistanceKm } from '@/lib/routing'
import { resolveOriginStore } from '@/lib/origin-store'
import type { ImportResult } from '@/lib/types'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return NextResponse.json({ error: 'No file provided.' }, { status: 400 })
  }

  const raw = await file.text()

  let parsed: ReturnType<typeof parseSapExport>
  try {
    parsed = parseSapExport(raw, file.name)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to parse file.' },
      { status: 400 }
    )
  }

  if (parsed.records.length === 0) {
    return NextResponse.json(
      { error: 'No valid rows found in this file.' },
      { status: 400 }
    )
  }

  // Upsert on the row_hash unique index, ignoring conflicts — this is
  // the agreed dedupe behavior: identical row content already in the
  // database is silently skipped, everything else is inserted.
  // We need the per-row outcome to report an accurate duplicate count,
  // so we check which hashes already exist first rather than relying
  // solely on upsert's silent ignore (which doesn't tell us *how many*
  // were skipped).
  const incomingHashes = parsed.records.map((r) => r.row_hash)

  const existingHashSet = new Set<string>()
  const BATCH = 100
  for (let i = 0; i < incomingHashes.length; i += BATCH) {
    const { data: existing, error: existingError } = await supabase
      .from('deliveries')
      .select('row_hash')
      .in('row_hash', incomingHashes.slice(i, i + BATCH))
    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 })
    }
    for (const r of existing || []) existingHashSet.add(r.row_hash)
  }
  const newRecords = parsed.records.filter((r) => !existingHashSet.has(r.row_hash))
  const duplicateCount = parsed.records.length - newRecords.length

  let insertedCount = 0
  for (let i = 0; i < newRecords.length; i += BATCH) {
    const batch = newRecords.slice(i, i + BATCH).map((r) => ({ ...r, imported_by: user.id }))
    const { error: insertError, count } = await supabase
      .from('deliveries')
      .insert(batch, { count: 'exact' })

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }
    insertedCount += count ?? batch.length
  }

  // --- Geocoding + distance calculation for newly inserted records ---
  // Runs after insert so import always succeeds even if geo APIs are down.
  if (newRecords.length > 0) {
    // Cache store coords to avoid re-geocoding the same store multiple times
    // within a single import batch.
    const storeCoordCache = new Map<string, { lat: number; lon: number } | null>()

    // Cache customer geocodes by normalized address so repeat customers in
    // the same import batch don't each cost a separate Mapbox round-trip.
    const customerGeoCache = new Map<string, GeocodeOutcome>()
    function customerAddressKey(record: { street: string | null; city: string | null; country: string | null }) {
      return [record.street, record.city, record.country].map((s) => (s ?? '').trim().toLowerCase()).join('|')
    }

    for (const record of newRecords) {
      // 1. Resolve store coordinates (from DB or geocode fresh). Webstore
      // deliveries with an IBT From use that store's coordinates instead of
      // the (address-less) webstore's own — see resolveOriginStore.
      const origin = resolveOriginStore(record)
      let storeLoc: { lat: number; lon: number } | null = null

      if (storeCoordCache.has(origin.storeCode)) {
        storeLoc = storeCoordCache.get(origin.storeCode)!
      } else {
        const { data: existing } = await supabase
          .from('store_locations')
          .select('lat, lon')
          .eq('store_code', origin.storeCode)
          .maybeSingle()

        if (existing?.lat != null && existing?.lon != null) {
          storeLoc = { lat: existing.lat, lon: existing.lon }
        } else {
          const query = `${origin.storeName} South Africa`
          const geo = await geocodeAddress(query)
          if (geo) {
            storeLoc = { lat: geo.lat, lon: geo.lon }
            await supabase.from('store_locations').upsert({
              store_code: origin.storeCode,
              store_name: origin.storeName,
              brand: record.brand,
              lat: geo.lat,
              lon: geo.lon,
              geocoded_at: new Date().toISOString(),
              geocode_query: query,
            })
          }
        }
        storeCoordCache.set(origin.storeCode, storeLoc)
      }

      // 2. Geocode customer delivery address
      const addressParts = [record.street, record.city, record.country].filter(Boolean)
      if (addressParts.length === 0) continue

      const addressKey = customerAddressKey(record)
      let customerGeo = customerGeoCache.get(addressKey)
      if (!customerGeo) {
        customerGeo = await geocodeStructuredAddress({
          street: record.street,
          city: record.city,
          country: record.country,
        })
        // Don't cache transient failures — worth retrying if the same
        // address comes up again later in this batch.
        if (!('error' in customerGeo && customerGeo.error === 'http_error')) {
          customerGeoCache.set(addressKey, customerGeo)
        }
      }
      if ('error' in customerGeo) continue

      // 3. Calculate driving distance
      let distanceKm: number | null = null
      if (storeLoc) {
        const distanceResult = await getDrivingDistanceKm(storeLoc, { lat: customerGeo.lat, lon: customerGeo.lon })
        if ('km' in distanceResult) distanceKm = distanceResult.km
      }

      // 4. Persist coordinates + distance back onto the delivery row
      await supabase
        .from('deliveries')
        .update({
          customer_lat: customerGeo.lat,
          customer_lon: customerGeo.lon,
          distance_km: distanceKm,
        })
        .eq('row_hash', record.row_hash)
    }
  }

  const result: ImportResult = {
    brand: parsed.brand,
    filename: file.name,
    totalRows: parsed.records.length,
    inserted: insertedCount,
    duplicates: duplicateCount,
    errors: parsed.errors,
  }

  return NextResponse.json(result)
}
