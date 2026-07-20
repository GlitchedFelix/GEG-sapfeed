export interface GeoResult {
  lat: number
  lon: number
  displayName: string
}

export async function geocodeAddress(query: string): Promise<GeoResult | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'GEG-sapfeed/1.0 (glitcheddesignsinfo@gmail.com)' },
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) return null
    return {
      lat: parseFloat(data[0].lat),
      lon: parseFloat(data[0].lon),
      displayName: data[0].display_name,
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
// full name depending on brand/export layout, but Nominatim's addressdetails
// always returns both a full name (address.country) and an ISO alpha-2 code
// (address.country_code) — check the requested value against whichever form
// it looks like it is, so a code like "ZA" correctly matches "South Africa".
function countryMatches(requested: string, address: { country?: string; country_code?: string }): boolean {
  const req = requested.trim().toLowerCase()
  if (address.country_code && req === address.country_code.toLowerCase()) return true
  return looselyMatches(requested, address.country)
}

function sanityCheck(address: { country?: string; country_code?: string; [key: string]: unknown }, parts: {
  city?: string | null
  country?: string | null
}): boolean {
  if (parts.country && !countryMatches(parts.country, address)) return false

  if (parts.city) {
    const locality =
      (address.city as string | undefined) ?? (address.town as string | undefined) ??
      (address.village as string | undefined) ?? (address.suburb as string | undefined) ??
      (address.municipality as string | undefined) ?? (address.county as string | undefined)
    if (!looselyMatches(parts.city, locality)) return false
  }

  return true
}

async function nominatimSearch(params: URLSearchParams): Promise<{ lat: string; lon: string; display_name: string; address?: Record<string, unknown> } | null> {
  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'GEG-sapfeed/1.0 (glitcheddesignsinfo@gmail.com)' },
  })
  if (!res.ok) return null
  const data = await res.json()
  if (!Array.isArray(data) || data.length === 0) return null
  return data[0]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function geocodeStructuredAddress(parts: {
  street?: string | null
  city?: string | null
  country?: string | null
}): Promise<GeoResult | null> {
  try {
    const params = new URLSearchParams({ format: 'json', addressdetails: '1', limit: '1' })
    if (parts.street) params.set('street', parts.street)
    if (parts.city) params.set('city', parts.city)
    if (parts.country) params.set('country', parts.country)
    // Narrow the search area server-side when the country looks like an
    // ISO alpha-2 code, rather than relying only on the post-hoc check.
    if (parts.country && /^[a-z]{2}$/i.test(parts.country.trim())) {
      params.set('countrycodes', parts.country.trim().toLowerCase())
    }

    let result = await nominatimSearch(params)

    if (!result) {
      // Structured field-by-field search can fail to resolve messy `street`
      // values (shop/complex names, "Cnr X & Y", unit numbers) that the old
      // single free-text query could still blend into a match. Retry once
      // with the free-text form before giving up.
      const freeText = [parts.street, parts.city, parts.country].filter(Boolean).join(', ')
      if (!freeText) return null
      await sleep(1100)
      const fallbackParams = new URLSearchParams({ q: freeText, format: 'json', addressdetails: '1', limit: '1' })
      result = await nominatimSearch(fallbackParams)
      if (!result) return null
    }

    const address = result.address ?? {}
    if (!sanityCheck(address, parts)) return null

    return {
      lat: parseFloat(result.lat),
      lon: parseFloat(result.lon),
      displayName: result.display_name,
    }
  } catch {
    return null
  }
}
