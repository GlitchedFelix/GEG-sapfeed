import { describe, it, expect, vi, afterEach } from 'vitest'
import { getDrivingDistanceKm } from './routing'

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }
}

const from = { lat: -26.1, lon: 28.0 }
const to = { lat: -26.2, lon: 28.1 }

describe('getDrivingDistanceKm', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('converts metres to a rounded km figure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(200, { code: 'Ok', routes: [{ distance: 12345 }] })
    ))
    const result = await getDrivingDistanceKm(from, to)
    expect(result).toEqual({ km: 12.3 })
  })

  it('rounds to the nearest 100m step', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(200, { code: 'Ok', routes: [{ distance: 12360 }] })
    ))
    const result = await getDrivingDistanceKm(from, to)
    expect(result).toEqual({ km: 12.4 })
  })

  it('returns no_route when Mapbox reports no route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(200, { code: 'NoRoute', routes: [] })
    ))
    const result = await getDrivingDistanceKm(from, to)
    expect(result).toEqual({ error: 'no_route' })
  })

  it('returns no_route when routes is empty despite code Ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(200, { code: 'Ok', routes: [] })
    ))
    const result = await getDrivingDistanceKm(from, to)
    expect(result).toEqual({ error: 'no_route' })
  })

  it('returns rate_limited on a 429 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(429, {})))
    const result = await getDrivingDistanceKm(from, to)
    expect(result).toEqual({ error: 'rate_limited' })
  })

  it('returns http_error on a non-OK, non-429 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})))
    const result = await getDrivingDistanceKm(from, to)
    expect(result).toEqual({ error: 'http_error' })
  })

  it('returns http_error when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const result = await getDrivingDistanceKm(from, to)
    expect(result).toEqual({ error: 'http_error' })
  })
})
