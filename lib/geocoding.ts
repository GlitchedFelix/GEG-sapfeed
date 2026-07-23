import { cleanStreet } from './address-clean'

export interface GeoResult {
  lat: number
  lon: number
  displayName: string
}

// Mirrors the DrivingDistanceResult pattern in lib/routing.ts: callers need to
// tell a transient failure (network blip, Mapbox 5xx/429) apart from a real
// "this address doesn't resolve" so only the latter gets treated as permanent.
export type GeocodeOutcome =
  | (GeoResult & { precise: boolean })
  | { error: 'no_match' | 'http_error' }

const MAPBOX_GEOCODE_URL = 'https://api.mapbox.com/search/geocode/v6/forward'

let warnedMissingToken = false
function mapboxToken(): string {
  const token = process.env.MAPBOX_ACCESS_TOKEN
  if (!token && !warnedMissingToken) {
    warnedMissingToken = true
    console.error('[geocoding] MAPBOX_ACCESS_TOKEN is not set — all geocoding requests will fail.')
  }
  return token ?? ''
}

type MapboxContextEntry = { name?: string; country_code?: string }
type MapboxFeature = {
  geometry: { coordinates: [number, number] } // [lon, lat]
  properties: {
    full_address?: string
    name?: string
    feature_type?: string
    context?: {
      country?: MapboxContextEntry
      region?: MapboxContextEntry
      place?: MapboxContextEntry
      locality?: MapboxContextEntry
      neighborhood?: MapboxContextEntry
    }
  }
}

// Throws on a bad HTTP response (rate limit, 5xx, etc.) instead of returning
// null, so callers can tell "the service failed" apart from "zero results" —
// the former is transient and worth retrying, the latter isn't.
async function mapboxSearch(params: URLSearchParams): Promise<MapboxFeature | null> {
  params.set('access_token', mapboxToken())
  const res = await fetch(`${MAPBOX_GEOCODE_URL}?${params.toString()}`)
  if (!res.ok) throw new Error(`mapbox http ${res.status}`)
  const data = await res.json()
  return data.features?.[0] ?? null
}

export async function geocodeAddress(query: string): Promise<GeoResult | null> {
  try {
    const feature = await mapboxSearch(new URLSearchParams({ q: query, limit: '1' }))
    if (!feature) return null
    const [lon, lat] = feature.geometry.coordinates
    return {
      lat,
      lon,
      displayName: feature.properties?.full_address ?? feature.properties?.name ?? '',
    }
  } catch {
    return null
  }
}

// Loose, case-insensitive, substring-tolerant comparison. Used to sanity-check
// a geocode result against what was requested without rejecting reasonable
// near-matches (e.g. "South Africa" vs "Rep. of South Africa", or a suburb
// name where a city name was requested).
function looselyMatches(requested: string, actual: string | undefined): boolean {
  if (!actual) return false
  const a = requested.trim().toLowerCase()
  const b = actual.trim().toLowerCase()
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a))
}

// SAP source data may store the country as a short ISO code (e.g. "ZA") or a
// full name depending on brand/export layout, but Mapbox's context.country
// always carries both a full name and an ISO alpha-2 code (country_code) —
// check the requested value against whichever form it looks like it is, so a
// code like "ZA" correctly matches "South Africa".
function countryMatches(requested: string, country: MapboxContextEntry | undefined): boolean {
  const req = requested.trim().toLowerCase()
  if (country?.country_code && req === country.country_code.toLowerCase()) return true
  return looselyMatches(requested, country?.name)
}

function sanityCheck(properties: MapboxFeature['properties'], parts: {
  city?: string | null
  country?: string | null
}): boolean {
  const context = properties.context
  if (parts.country && !countryMatches(parts.country, context?.country)) return false

  if (parts.city) {
    const locality =
      context?.place?.name ?? context?.locality?.name ?? context?.neighborhood?.name ?? context?.region?.name
    if (!looselyMatches(parts.city, locality)) return false
  }

  return true
}

// A match resolved no more precisely than a locality centroid
// (neighborhood/place/region) — Mapbox's free-text fallback in particular
// tends to produce these. A distance computed from one of these can be off
// by kilometers, so it's worth telling apart from a proper street-level
// match even though we still return it.
function isPrecise(properties: MapboxFeature['properties']): boolean {
  return properties.feature_type === 'address' || properties.feature_type === 'street'
}

export async function geocodeStructuredAddress(parts: {
  street?: string | null
  city?: string | null
  country?: string | null
}): Promise<GeocodeOutcome> {
  try {
    const cleaned = cleanStreet(parts.street)

    const params = new URLSearchParams({ limit: '1', types: 'address,street' })
    if (cleaned.structured) params.set('address_line1', cleaned.structured)
    if (parts.city) params.set('place', parts.city)
    // Mapbox's country filter only accepts ISO alpha-2 codes, unlike
    // Nominatim which also accepted a full country name in its structured
    // field. When SAP gives a full name, omit the param and rely entirely on
    // the sanity check below (same as it already backstops loose matches).
    if (parts.country && /^[a-z]{2}$/i.test(parts.country.trim())) {
      params.set('country', parts.country.trim().toLowerCase())
    }

    let feature: MapboxFeature | null
    try {
      feature = await mapboxSearch(params)
    } catch {
      return { error: 'http_error' }
    }

    if (!feature) {
      // Structured field-by-field search can fail to resolve messy `street`
      // values (shop/complex names, "Cnr X & Y", unit numbers) that a single
      // free-text query can still blend into a match. Retry once with the
      // free-text form before giving up.
      const freeText = [cleaned.freeText, parts.city, parts.country].filter(Boolean).join(', ')
      if (!freeText) return { error: 'no_match' }
      try {
        feature = await mapboxSearch(new URLSearchParams({ q: freeText, limit: '1' }))
      } catch {
        return { error: 'http_error' }
      }
      if (!feature) return { error: 'no_match' }
    }

    const properties = feature.properties ?? {}
    if (!sanityCheck(properties, parts)) return { error: 'no_match' }

    // sanityCheck already confirmed the country and (if given) the
    // city/locality actually match what was requested, so a free-text
    // fallback that only resolves to a locality centroid — common for South
    // African streets Mapbox has no address-level coverage for — is still a
    // legitimate match, just a coarse one. Accept it rather than discarding
    // it outright; `precise` lets callers keep it distinguishable/auditable
    // instead of silently blending it with exact street-level matches.
    const precise = isPrecise(properties)

    const [lon, lat] = feature.geometry.coordinates
    return {
      lat,
      lon,
      displayName: properties.full_address ?? properties.name ?? '',
      precise,
    }
  } catch {
    return { error: 'http_error' }
  }
}
