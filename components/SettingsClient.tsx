'use client'

import { useState, useEffect } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { parseStoreName } from '@/lib/store-utils'
import RateCardsSection from '@/components/RateCardsSection'
import CollapsibleSection from '@/components/CollapsibleSection'
import Button from '@/components/ui/Button'
import SegmentedControl from '@/components/ui/SegmentedControl'
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
    <main className="mx-auto max-w-6xl px-4 py-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">Settings</h2>

      <CollapsibleSection
        title="Geocoding — Store Coordinates"
        subtitle="Driving distances require a latitude and longitude for each store."
      >
        <p className="mb-3 text-xs text-slate-500">
          Paste coordinates from Google Maps (right-click a location → copy lat/lng).
        </p>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SegmentedControl
            options={[
              { value: 'ALL' as const, label: 'All' },
              { value: 'CTM' as const, label: 'CTM' },
              { value: 'ITALTILE' as const, label: 'Italtile' },
            ]}
            value={brandFilter}
            onChange={setBrandFilter}
          />
          {!loading && (
            <span className="text-xs text-slate-400">
              {configured}/{visible.length} stores configured
            </span>
          )}
        </div>

        {loading ? (
          <p className="text-xs text-slate-400">Loading stores…</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-card scrollbar-thin">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80">
                  <th className="w-20 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Code</th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Store Name</th>
                  <th className="w-16 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Brand</th>
                  <th className="w-36 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Latitude</th>
                  <th className="w-36 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Longitude</th>
                  <th className="w-24 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {visible.map((store) => (
                  <tr key={store.store_code} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/70">
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
                        className="w-full rounded border border-slate-300 px-1.5 py-1 font-mono text-xs transition-colors focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="text"
                        value={store.lon}
                        onChange={(e) => update(store.store_code, 'lon', e.target.value)}
                        placeholder="28.0473"
                        className="w-full rounded border border-slate-300 px-1.5 py-1 font-mono text-xs transition-colors focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {store.error && (
                        <span className="mr-2 text-xs text-red-500">{store.error}</span>
                      )}
                      {store.saved && !store.error ? (
                        <span className="flex items-center justify-end gap-1 font-medium text-emerald-600">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Saved
                        </span>
                      ) : (
                        <Button
                          variant="secondary"
                          onClick={() => save(store.store_code)}
                          disabled={store.saving || (!store.lat && !store.lon)}
                        >
                          {store.saving ? 'Saving…' : 'Save'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Rate Cards"
        subtitle="Payout grids by distance and weight, effective-dated per delivery."
      >
        <RateCardsSection />
      </CollapsibleSection>
    </main>
  )
}
