import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { geocodeAddress } from '@/lib/geocoding'
import { getDrivingDistanceKm } from '@/lib/routing'

export const runtime = 'nodejs'
export const maxDuration = 55  // just under Vercel's 60s pro limit

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const batchSize = Math.min(
    parseInt(request.nextUrl.searchParams.get('batch') ?? '10', 10),
    25
  )

  // Rows that still need a distance and have at least a city
  const { data: rows, error } = await supabase
    .from('deliveries')
    .select('row_hash, store_code, store_name, brand, street, city, country, customer_lat, customer_lon')
    .is('distance_km', null)
    .not('city', 'is', null)
    .limit(batchSize)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!rows || rows.length === 0) {
    return NextResponse.json({ processed: 0, remaining: 0 })
  }

  // Cache store coords within this batch
  const storeCache = new Map<string, { lat: number; lon: number } | null>()

  async function getStoreLoc(storeCode: string, storeName: string, brand: string) {
    if (storeCache.has(storeCode)) return storeCache.get(storeCode)!
    const { data: existing } = await supabase
      .from('store_locations')
      .select('lat, lon')
      .eq('store_code', storeCode)
      .maybeSingle()
    if (existing?.lat != null && existing?.lon != null) {
      const loc = { lat: existing.lat, lon: existing.lon }
      storeCache.set(storeCode, loc)
      return loc
    }
    const query = `${storeName} South Africa`
    await sleep(1100)
    const geo = await geocodeAddress(query)
    if (!geo) { storeCache.set(storeCode, null); return null }
    const loc = { lat: geo.lat, lon: geo.lon }
    storeCache.set(storeCode, loc)
    await supabase.from('store_locations').upsert({
      store_code: storeCode, store_name: storeName, brand,
      lat: geo.lat, lon: geo.lon,
      geocoded_at: new Date().toISOString(),
      geocode_query: query,
    })
    return loc
  }

  let processed = 0

  for (const row of rows) {
    let customerLat: number | null = row.customer_lat
    let customerLon: number | null = row.customer_lon

    // Reuse coordinates from another delivery with the same address to
    // avoid redundant Nominatim calls (many deliveries share a destination).
    if (customerLat == null || customerLon == null) {
      const addressParts = [row.street, row.city, row.country].filter(Boolean)
      if (addressParts.length === 0) continue

      const { data: twin } = await supabase
        .from('deliveries')
        .select('customer_lat, customer_lon')
        .eq('city', row.city)
        .eq('country', row.country ?? '')
        .not('customer_lat', 'is', null)
        .limit(1)
        .maybeSingle()

      if (twin?.customer_lat != null) {
        customerLat = twin.customer_lat
        customerLon = twin.customer_lon
      } else {
        await sleep(1100)
        const geo = await geocodeAddress(addressParts.join(', '))
        if (!geo) continue
        customerLat = geo.lat
        customerLon = geo.lon
      }
    }

    const storeLoc = await getStoreLoc(row.store_code, row.store_name, row.brand)
    let distanceKm: number | null = null
    if (storeLoc && customerLat != null) {
      distanceKm = await getDrivingDistanceKm(storeLoc, { lat: customerLat, lon: customerLon! })
    }

    await supabase
      .from('deliveries')
      .update({ customer_lat: customerLat, customer_lon: customerLon, distance_km: distanceKm })
      .eq('row_hash', row.row_hash)

    processed++
  }

  // Count how many still need processing
  const { count: remaining } = await supabase
    .from('deliveries')
    .select('*', { count: 'exact', head: true })
    .is('distance_km', null)
    .not('city', 'is', null)

  return NextResponse.json({ processed, remaining: remaining ?? 0 })
}
