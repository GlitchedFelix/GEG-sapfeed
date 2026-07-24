import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { retrieveAddress, geocodeAddress } from '@/lib/geocoding'
import { getDrivingDistanceKm } from '@/lib/routing'
import { resolveOriginStore } from '@/lib/origin-store'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const rowHash: string | undefined = body?.rowHash
  const mapboxId: string | undefined = body?.mapboxId
  const sessionToken: string | undefined = body?.sessionToken
  if (!rowHash || !mapboxId || !sessionToken) {
    return NextResponse.json({ error: 'rowHash, mapboxId and sessionToken are required.' }, { status: 400 })
  }

  const { data: row, error: rowError } = await supabase
    .from('deliveries')
    .select('row_hash, store_code, store_name, brand, ibt_from')
    .eq('row_hash', rowHash)
    .maybeSingle()
  if (rowError || !row) {
    return NextResponse.json({ error: 'Delivery row not found.' }, { status: 404 })
  }

  const geo = await retrieveAddress(mapboxId, sessionToken)
  if ('error' in geo) {
    return NextResponse.json({ error: 'Could not resolve the selected address.' }, { status: 502 })
  }

  const { error: geoUpdateError } = await supabase
    .from('deliveries')
    .update({
      customer_lat: geo.lat,
      customer_lon: geo.lon,
      geocode_precise: geo.precise,
      geocode_failed: false,
    })
    .eq('row_hash', rowHash)
  if (geoUpdateError) {
    return NextResponse.json({ error: geoUpdateError.message }, { status: 500 })
  }

  // Resolve the origin store's coordinates the same way the import and
  // backfill-distances routes do — honoring IBT From for webstore rows —
  // geocoding fresh on a miss.
  const origin = resolveOriginStore(row)
  const { data: storeRow } = await supabase
    .from('store_locations')
    .select('lat, lon')
    .eq('store_code', origin.storeCode)
    .maybeSingle()

  let storeLoc: { lat: number; lon: number } | null =
    storeRow?.lat != null && storeRow?.lon != null ? { lat: storeRow.lat, lon: storeRow.lon } : null

  if (!storeLoc) {
    const query = `${origin.storeName} South Africa`
    const storeGeo = await geocodeAddress(query)
    if (storeGeo) {
      storeLoc = { lat: storeGeo.lat, lon: storeGeo.lon }
      await supabase.from('store_locations').upsert({
        store_code: origin.storeCode,
        store_name: origin.storeName,
        brand: row.brand,
        lat: storeGeo.lat,
        lon: storeGeo.lon,
        geocoded_at: new Date().toISOString(),
        geocode_query: query,
      })
    }
  }

  if (!storeLoc) {
    await supabase
      .from('deliveries')
      .update({ distance_failed: true, distance_fail_reason: 'no_store_location' })
      .eq('row_hash', rowHash)
    return NextResponse.json({ distanceKm: null, failReason: 'no_store_location' })
  }

  const distanceResult = await getDrivingDistanceKm(storeLoc, { lat: geo.lat, lon: geo.lon })
  if ('error' in distanceResult) {
    await supabase
      .from('deliveries')
      .update({ distance_failed: true, distance_fail_reason: distanceResult.error })
      .eq('row_hash', rowHash)
    return NextResponse.json({ distanceKm: null, failReason: distanceResult.error })
  }

  await supabase
    .from('deliveries')
    .update({
      distance_km: distanceResult.km,
      distance_manual: false,
      distance_failed: false,
      distance_fail_reason: null,
    })
    .eq('row_hash', rowHash)

  return NextResponse.json({ distanceKm: distanceResult.km, failReason: null })
}
