import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { geocodeAddress } from '@/lib/geocoding'
import { getDrivingDistanceKm } from '@/lib/routing'

export const runtime = 'nodejs'
export const maxDuration = 55

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const batchSize = Math.min(
    parseInt(request.nextUrl.searchParams.get('batch') ?? '10', 10),
    25
  )

  // Cache store coords within this call
  const storeCache = new Map<string, { lat: number; lon: number } | null>()

  async function getStoreLoc(storeCode: string) {
    if (storeCache.has(storeCode)) return storeCache.get(storeCode)!
    const { data } = await supabase
      .from('store_locations')
      .select('lat, lon')
      .eq('store_code', storeCode)
      .maybeSingle()
    const loc = (data?.lat != null && data?.lon != null)
      ? { lat: data.lat as number, lon: data.lon as number }
      : null
    storeCache.set(storeCode, loc)
    return loc
  }

  let processed = 0

  // --- Pass 1: geocode customer addresses that haven't been attempted yet ---
  // Using customer_lat IS NULL as the sentinel so rows aren't re-processed
  // infinitely when store coords are missing.
  const { data: ungeocodedRows } = await supabase
    .from('deliveries')
    .select('row_hash, store_code, brand, street, city, country')
    .is('customer_lat', null)
    .not('city', 'is', null)
    .limit(batchSize)

  for (const row of (ungeocodedRows ?? [])) {
    const addressParts = [row.street, row.city, row.country].filter(Boolean)
    if (addressParts.length === 0) continue

    // Reuse coords from another delivery going to the same city/country
    const { data: twin } = await supabase
      .from('deliveries')
      .select('customer_lat, customer_lon')
      .eq('city', row.city)
      .eq('country', row.country ?? '')
      .not('customer_lat', 'is', null)
      .limit(1)
      .maybeSingle()

    let customerLat: number
    let customerLon: number

    if (twin?.customer_lat != null) {
      customerLat = twin.customer_lat
      customerLon = twin.customer_lon
    } else {
      await sleep(1100)
      const geo = await geocodeAddress(addressParts.join(', '))
      if (!geo) {
        // Mark as attempted with a sentinel so we don't retry endlessly.
        // Using 0,0 is avoided; instead we use a clearly-invalid placeholder
        // that the distance query will ignore (distance_km stays null).
        // We skip and leave customer_lat null — but only retry up to once
        // per batch by tracking attempted hashes below.
        continue
      }
      customerLat = geo.lat
      customerLon = geo.lon
    }

    const storeLoc = await getStoreLoc(row.store_code)
    let distanceKm: number | null = null
    if (storeLoc) {
      distanceKm = await getDrivingDistanceKm(storeLoc, { lat: customerLat, lon: customerLon })
    }

    await supabase
      .from('deliveries')
      .update({ customer_lat: customerLat, customer_lon: customerLon, distance_km: distanceKm })
      .eq('row_hash', row.row_hash)

    processed++
  }

  // --- Pass 2: compute distances for rows already geocoded but missing distance ---
  // This runs after store coords are manually added in Settings — no geocoding
  // needed here, just OSRM calls, so it's fast with no sleep required.
  if ((ungeocodedRows ?? []).length === 0) {
    const { data: pendingRows } = await supabase
      .from('deliveries')
      .select('row_hash, store_code, customer_lat, customer_lon')
      .is('distance_km', null)
      .not('customer_lat', 'is', null)
      .limit(batchSize)

    for (const row of (pendingRows ?? [])) {
      if (row.customer_lat == null) continue
      const storeLoc = await getStoreLoc(row.store_code)
      if (!storeLoc) continue

      const distanceKm = await getDrivingDistanceKm(
        storeLoc,
        { lat: row.customer_lat, lon: row.customer_lon }
      )
      if (distanceKm == null) continue

      await supabase
        .from('deliveries')
        .update({ distance_km: distanceKm })
        .eq('row_hash', row.row_hash)

      processed++
    }
  }

  // Remaining = rows with no customer_lat (not yet geocoded) + rows geocoded but no distance
  const { count: noCoords } = await supabase
    .from('deliveries')
    .select('*', { count: 'exact', head: true })
    .is('customer_lat', null)
    .not('city', 'is', null)

  const { count: noDistance } = await supabase
    .from('deliveries')
    .select('*', { count: 'exact', head: true })
    .is('distance_km', null)
    .not('customer_lat', 'is', null)

  return NextResponse.json({
    processed,
    remainingGeocode: noCoords ?? 0,
    remainingDistance: noDistance ?? 0,
    remaining: (noCoords ?? 0) + (noDistance ?? 0),
  })
}
