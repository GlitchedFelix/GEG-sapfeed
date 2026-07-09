export async function getDrivingDistanceKm(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number }
): Promise<number | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    if (data.code !== 'Ok' || !data.routes?.length) return null
    return Math.round((data.routes[0].distance / 1000) * 10) / 10  // metres → km, 1 decimal
  } catch {
    return null
  }
}
