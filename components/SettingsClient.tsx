'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { parseStoreName } from '@/lib/store-utils'
import type { Brand } from '@/lib/types'

interface StoreRow {
  store_code: string      // DB key e.g. ABT001
  display_code: string    // from store_name prefix e.g. C944
  display_name: string    // readable name e.g. CTM Alberton
  store_name: string      // raw value e.g. "C944 --- CTM Alberton"
  brand: Brand
  lat: string
  lon: string
  saved: boolean
  saving: boolean
  error: string | null
}


export default function SettingsClient() {
  const supabase = createClient()
  const [stores, setStores] = useState<StoreRow[]>([])
  const [loading, setLoading] = useState(true)
  const [brandFilter, setBrandFilter] = useState<Brand | 'ALL'>('ALL')

  useEffect(() => {
    async function load() {
      setLoading(true)

      // Paginate through all deliveries to collect every unique store.
      // Supabase caps a single request at 1000 rows, so we batch with range().
      const seen = new Map<string, { store_name: string; brand: Brand }>()
      const PAGE = 1000
      let offset = 0
      while (true) {
        const { data } = await supabase
          .from('deliveries')
          .select('store_code, store_name, brand')
          .range(offset, offset + PAGE - 1)
        if (!data || data.length === 0) break
        for (const d of data as any[]) {
          if (!seen.has(d.store_code)) {
            seen.set(d.store_code, { store_name: d.store_name, brand: d.brand })
          }
        }
        if (data.length < PAGE) break
        offset += PAGE
      }

      // Existing stored coordinates
      const { data: locations } = await supabase
        .from('store_locations')
        .select('store_code, lat, lon')

      const locMap = new Map(
        (locations ?? []).map((l: any) => [l.store_code, { lat: l.lat, lon: l.lon }])
      )

      const rows: StoreRow[] = []
      for (const [store_code, { store_name, brand }] of seen.entries()) {
        const { code: display_code, name: display_name } = parseStoreName(store_name)
        const existing = locMap.get(store_code)
        rows.push({
          store_code,
          display_code,
          display_name,
          store_name,
          brand,
          lat: existing?.lat != null ? String(existing.lat) : '',
          lon: existing?.lon != null ? String(existing.lon) : '',
          saved: existing != null,
          saving: false,
          error: null,
        })
      }

      rows.sort((a, b) => a.brand.localeCompare(b.brand) || a.display_code.localeCompare(b.display_code))
      setStores(rows)
      setLoading(false)
    }
    load()
  }, [supabase])

  function update(code: string, field: 'lat' | 'lon', value: string) {
    setStores((prev) =>
      prev.map((s) => s.store_code === code ? { ...s, [field]: value, saved: false, error: null } : s)
    )
  }

  async function save(code: string) {
    const store = stores.find((s) => s.store_code === code)
    if (!store) return

    const lat = parseFloat(store.lat)
    const lon = parseFloat(store.lon)

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setStores((prev) =>
        prev.map((s) => s.store_code === code ? { ...s, error: 'Invalid coordinates' } : s)
      )
      return
    }

    setStores((prev) =>
      prev.map((s) => s.store_code === code ? { ...s, saving: true, error: null } : s)
    )

    const { error } = await supabase.from('store_locations').upsert({
      store_code: store.store_code,
      store_name: store.store_name,
      brand: store.brand,
      lat,
      lon,
      geocoded_at: new Date().toISOString(),
      geocode_query: 'manual',
    })

    setStores((prev) =>
      prev.map((s) =>
        s.store_code === code
          ? { ...s, saving: false, saved: !error, error: error?.message ?? null }
          : s
      )
    )
  }

  const visible = stores.filter((s) => brandFilter === 'ALL' || s.brand === brandFilter)
  const configured = visible.filter((s) => s.saved).length

  return (
    <main className="px-4 py-4 max-w-3xl">
      <h2 className="text-sm font-semibold text-slate-800 mb-1">Settings</h2>

      <section className="mt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
          Geocoding — Store Coordinates
        </h3>
        <p className="text-xs text-slate-500 mb-3">
          Driving distances require a latitude and longitude for each store. Paste coordinates
          from Google Maps (right-click a location → copy lat/lng).
        </p>

        <div className="mb-3 flex items-center gap-1">
          {(['ALL', 'CTM', 'ITALTILE'] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBrandFilter(b)}
              className={`rounded px-2 py-1 text-xs font-medium ${
                brandFilter === b ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {b === 'ALL' ? 'All' : b}
            </button>
          ))}
          {!loading && (
            <span className="ml-2 text-xs text-slate-400">
              {configured}/{visible.length} stores configured
            </span>
          )}
        </div>

        {loading ? (
          <p className="text-xs text-slate-400">Loading stores…</p>
        ) : (
          <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-3 py-2 text-left font-medium text-slate-600 w-20">Code</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">Store Name</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 w-16">Brand</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 w-36">Latitude</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 w-36">Longitude</th>
                  <th className="px-3 py-2 w-24" />
                </tr>
              </thead>
              <tbody>
                {visible.map((store) => (
                  <tr key={store.store_code} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-1.5 font-mono font-medium text-slate-800">
                      {store.display_code || store.store_code}
                    </td>
                    <td className="px-3 py-1.5 text-slate-700">{store.display_name}</td>
                    <td className="px-3 py-1.5 text-slate-500">{store.brand}</td>
                    <td className="px-3 py-1.5">
                      <input
                        type="text"
                        value={store.lat}
                        onChange={(e) => update(store.store_code, 'lat', e.target.value)}
                        placeholder="-26.2041"
                        className="w-full rounded border border-slate-300 px-1.5 py-0.5 font-mono text-xs focus:border-slate-500 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="text"
                        value={store.lon}
                        onChange={(e) => update(store.store_code, 'lon', e.target.value)}
                        placeholder="28.0473"
                        className="w-full rounded border border-slate-300 px-1.5 py-0.5 font-mono text-xs focus:border-slate-500 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {store.error && (
                        <span className="mr-2 text-red-500 text-xs">{store.error}</span>
                      )}
                      {store.saved && !store.error ? (
                        <span className="text-emerald-600 font-medium">✓ Saved</span>
                      ) : (
                        <button
                          onClick={() => save(store.store_code)}
                          disabled={store.saving || (!store.lat && !store.lon)}
                          className="rounded border border-slate-300 px-2 py-0.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                        >
                          {store.saving ? 'Saving…' : 'Save'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
