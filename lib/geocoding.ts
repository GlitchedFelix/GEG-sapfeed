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
