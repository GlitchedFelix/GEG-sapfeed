export type DrivingDistanceResult =
  | { km: number }
  | { error: 'no_route' | 'rate_limited' | 'http_error' }

export async function getDrivingDistanceKm(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number }
): Promise<DrivingDistanceResult> {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'GEG-sapfeed/1.0 (glitcheddesignsinfo@gmail.com)' },
    })
    if (res.status === 429) return { error: 'rate_limited' }
    if (!res.ok) return { error: 'http_error' }
    const data = await res.json()
    if (data.code !== 'Ok' || !data.routes?.length) return { error: 'no_route' }
    return { km: Math.round((data.routes[0].distance / 1000) * 10) / 10 }  // metres → km, 1 decimal
  } catch {
    return { error: 'http_error' }
  }
}
