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

export async function geocodeStructuredAddress(parts: {
  street?: string | null
  city?: string | null
  country?: string | null
}): Promise<GeoResult | null> {
  const params = new URLSearchParams({ format: 'json', addressdetails: '1', limit: '1' })
  if (parts.street) params.set('street', parts.street)
  if (parts.city) params.set('city', parts.city)
  if (parts.country) params.set('country', parts.country)

  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'GEG-sapfeed/1.0 (glitcheddesignsinfo@gmail.com)' },
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) return null

    const address = data[0].address ?? {}

    if (parts.country && !looselyMatches(parts.country, address.country)) return null

    if (parts.city) {
      const locality =
        address.city ?? address.town ?? address.village ?? address.suburb ??
        address.municipality ?? address.county
      if (!looselyMatches(parts.city, locality)) return null
    }

    return {
      lat: parseFloat(data[0].lat),
      lon: parseFloat(data[0].lon),
      displayName: data[0].display_name,
    }
  } catch {
    return null
  }
}
