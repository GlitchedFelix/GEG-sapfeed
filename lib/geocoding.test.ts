import { describe, it, expect, vi, afterEach } from 'vitest'
import { geocodeAddress, geocodeStructuredAddress } from './geocoding'

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }
}

function feature(opts: {
  lat: number
  lon: number
  fullAddress?: string
  featureType?: string
  countryCode?: string
  countryName?: string
  placeName?: string
}) {
  return {
    geometry: { coordinates: [opts.lon, opts.lat] },
    properties: {
      full_address: opts.fullAddress,
      feature_type: opts.featureType,
      context: {
        country: { name: opts.countryName, country_code: opts.countryCode },
        place: { name: opts.placeName },
      },
    },
  }
}

describe('geocodeAddress', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a GeoResult for a single matching feature', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(200, { features: [feature({ lat: -26.1, lon: 28.0, fullAddress: 'Melville, South Africa' })] })
    ))
    const result = await geocodeAddress('Pick n Pay Melville South Africa')
    expect(result).toEqual({ lat: -26.1, lon: 28.0, displayName: 'Melville, South Africa' })
  })

  it('returns null when no features match', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { features: [] })))
    const result = await geocodeAddress('nonexistent place')
    expect(result).toBeNull()
  })

  it('returns null on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})))
    const result = await geocodeAddress('anything')
    expect(result).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const result = await geocodeAddress('anything')
    expect(result).toBeNull()
  })
})

describe('geocodeStructuredAddress', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a precise match when country/city match and feature_type is address', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(200, {
        features: [feature({
          lat: -26.1, lon: 28.0, fullAddress: '12 Church St, Melville, South Africa',
          featureType: 'address', countryCode: 'za', countryName: 'South Africa', placeName: 'Melville',
        })],
      })
    ))
    const result = await geocodeStructuredAddress({ street: '12 Church St', city: 'Melville', country: 'ZA' })
    expect(result).toEqual({
      lat: -26.1, lon: 28.0, displayName: '12 Church St, Melville, South Africa', precise: true,
    })
  })

  it('rejects a result whose country does not match', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(200, {
        features: [feature({
          lat: 1, lon: 1, featureType: 'address', countryCode: 'ke', countryName: 'Kenya', placeName: 'Melville',
        })],
      })
    ))
    const result = await geocodeStructuredAddress({ street: '12 Church St', city: 'Melville', country: 'ZA' })
    expect(result).toEqual({ error: 'no_match' })
  })

  it('rejects a result whose city does not match', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(200, {
        features: [feature({
          lat: 1, lon: 1, featureType: 'address', countryCode: 'za', countryName: 'South Africa', placeName: 'Sandton',
        })],
      })
    ))
    const result = await geocodeStructuredAddress({ street: '12 Church St', city: 'Melville', country: 'ZA' })
    expect(result).toEqual({ error: 'no_match' })
  })

  it('falls back to free text and returns a precise result when the structured attempt finds nothing', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { features: [] }))
      .mockResolvedValueOnce(jsonResponse(200, {
        features: [feature({
          lat: 2, lon: 2, featureType: 'address', countryCode: 'za', countryName: 'South Africa', placeName: 'Melville',
        })],
      }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await geocodeStructuredAddress({ street: 'Shop 4, Melrose Arch', city: 'Melville', country: 'ZA' })
    expect(result).toEqual({ lat: 2, lon: 2, displayName: '', precise: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('accepts a free-text fallback that only resolves to a locality-level match, marked imprecise', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { features: [] }))
      .mockResolvedValueOnce(jsonResponse(200, {
        features: [feature({
          lat: 2, lon: 2, featureType: 'place', countryCode: 'za', countryName: 'South Africa', placeName: 'Melville',
        })],
      }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await geocodeStructuredAddress({ street: 'some unresolvable place', city: 'Melville', country: 'ZA' })
    expect(result).toEqual({ lat: 2, lon: 2, displayName: '', precise: false })
  })

  it('still rejects a free-text fallback whose city does not match', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { features: [] }))
      .mockResolvedValueOnce(jsonResponse(200, {
        features: [feature({
          lat: 2, lon: 2, featureType: 'place', countryCode: 'za', countryName: 'South Africa', placeName: 'Sandton',
        })],
      }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await geocodeStructuredAddress({ street: 'some unresolvable place', city: 'Melville', country: 'ZA' })
    expect(result).toEqual({ error: 'no_match' })
  })

  it('returns http_error when both attempts fail with a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})))
    const result = await geocodeStructuredAddress({ street: '12 Church St', city: 'Melville', country: 'ZA' })
    expect(result).toEqual({ error: 'http_error' })
  })

  it('includes an ISO-2 country filter in the request URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        features: [feature({
          lat: 1, lon: 1, featureType: 'address', countryCode: 'za', countryName: 'South Africa', placeName: 'Melville',
        })],
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    await geocodeStructuredAddress({ street: '12 Church St', city: 'Melville', country: 'za' })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('country=za')
  })

  it('omits the country filter for a full country name and relies on the sanity check', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        features: [feature({
          lat: 1, lon: 1, featureType: 'address', countryCode: 'za', countryName: 'South Africa', placeName: 'Melville',
        })],
      })
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = await geocodeStructuredAddress({ street: '12 Church St', city: 'Melville', country: 'South Africa' })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).not.toContain('country=')
    expect(result).toEqual({ lat: 1, lon: 1, displayName: '', precise: true })
  })
})
