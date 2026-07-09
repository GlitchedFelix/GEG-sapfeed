'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'
import type { Brand } from '@/lib/types'

interface StoreRow {
  store_code: string
  store_name: string
  brand: Brand
  lat: string   // editable string fields
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

      // All unique stores from deliveries
      const { data: deliveryStores } = await supabase
        .from('deliveries')
        .select('store_code, store_name, brand')
        .limit(2000)

      // Existing stored coordinates
      const { data: locations } = await supabase
        .from('store_locations')
        .select('store_code, lat, lon')

      const locMap = new Map(
        (locations ?? []).map((l: any) => [l.store_code, { lat: l.lat, lon: l.lon }])
      )

      // Deduplicate stores by store_code
      const seen = new Set<string>()
      const rows: StoreRow[] = []
      for (const d of (deliveryStores ?? []) as any[]) {
        if (seen.has(d.store_code)) continue
        seen.add(d.store_code)
        const existing = locMap.get(d.store_code)
        rows.push({
          store_code: d.store_code,
          store_name: d.store_name,
          brand: d.brand,
          lat: existing?.lat != null ? String(existing.lat) : '',
          lon: existing?.lon != null ? String(existing.lon) : '',
          saved: existing != null,
          saving: false,
          error: null,
        })
      }

      rows.sort((a, b) => a.brand.localeCompare(b.brand) || a.store_code.localeCompare(b.store_code))
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
  const missing = visible.filter((s) => !s.saved).length
  const total = visible.length

  return (
    <main className="px-4 py-4 max-w-3xl">
      <h2 className="text-sm font-semibold text-slate-800 mb-1">Settings</h2>

      {/* Geocoding section */}
      <section className="mt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
          Geocoding — Store Coordinates
        </h3>
        <p className="text-xs text-slate-500 mb-3">
          Driving distances require a latitude and longitude for each store. Paste coordinates
          from Google Maps (right-click a location → copy lat/lng).
        </p>

        {/* Brand filter */}
        <div className="mb-3 flex gap-1">
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
            <span className="ml-2 self-center text-xs text-slate-400">
              {total - missing}/{total} stores configured
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
                  <th className="px-3 py-2 text-left font-medium text-slate-600 w-24">Code</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">Store Name</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 w-16">Brand</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 w-36">Latitude</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 w-36">Longitude</th>
                  <th className="px-3 py-2 w-20" />
                </tr>
              </thead>
              <tbody>
                {visible.map((store) => (
                  <tr key={store.store_code} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-1.5 font-mono text-slate-700">{store.store_code}</td>
                    <td className="px-3 py-1.5 text-slate-700">{store.store_name}</td>
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
                        <span className="mr-2 text-red-500">{store.error}</span>
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
