export type DrivingDistanceResult =
  | { km: number }
  | { error: 'no_route' | 'rate_limited' | 'http_error' }

let warnedMissingToken = false
function mapboxToken(): string {
  const token = process.env.MAPBOX_ACCESS_TOKEN
  if (!token && !warnedMissingToken) {
    warnedMissingToken = true
    console.error('[routing] MAPBOX_ACCESS_TOKEN is not set — all routing requests will fail.')
  }
  return token ?? ''
}

export async function getDrivingDistanceKm(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number }
): Promise<DrivingDistanceResult> {
  const params = new URLSearchParams({ overview: 'false', access_token: mapboxToken() })
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${from.lon},${from.lat};${to.lon},${to.lat}?${params.toString()}`
  try {
    const res = await fetch(url)
    if (res.status === 429) return { error: 'rate_limited' }
    if (!res.ok) return { error: 'http_error' }
    const data = await res.json()
    if (data.code !== 'Ok' || !data.routes?.length) return { error: 'no_route' }
    return { km: Math.round((data.routes[0].distance / 1000) * 10) / 10 }  // metres → km, 1 decimal
  } catch {
    return { error: 'http_error' }
  }
}
