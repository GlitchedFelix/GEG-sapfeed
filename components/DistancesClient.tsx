'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import type { Brand, DeliveryRecord } from '@/lib/types'

type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 50

interface Row extends Pick<
  DeliveryRecord,
  | 'row_hash'
  | 'delivery_date'
  | 'store_code'
  | 'store_name'
  | 'customer_name'
  | 'city'
  | 'street'
  | 'country'
  | 'distance_km'
  | 'transport1_amount_zar'
  | 'transport2_amount_zar'
> {}

const SELECT_FIELDS = [
  'row_hash',
  'delivery_date',
  'store_code',
  'store_name',
  'customer_name',
  'city',
  'street',
  'country',
  'distance_km',
  'transport1_amount_zar',
  'transport2_amount_zar',
].join(',')

export default function DistancesClient() {
  const supabase = createClient()

  const [brand, setBrand] = useState<Brand | 'ALL'>('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [storeOptions, setStoreOptions] = useState<string[]>([])
  const [sortKey, setSortKey] = useState('distance_km')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)

  const [rows, setRows] = useState<Row[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [nullCount, setNullCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [backfilling, setBackfilling] = useState(false)
  const [backfillRemaining, setBackfillRemaining] = useState<number | null>(null)
  const [backfillProcessed, setBackfillProcessed] = useState(0)

  const applyFilters = useCallback(
    (query: any) => {
      let q = query
      if (brand !== 'ALL') q = q.eq('brand', brand)
      if (dateFrom) q = q.gte('delivery_date', dateFrom)
      if (dateTo) q = q.lte('delivery_date', dateTo)
      if (storeFilter) q = q.eq('store_code', storeFilter)
      return q
    },
    [brand, dateFrom, dateTo, storeFilter]
  )

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    let rowQuery = applyFilters(
      supabase.from('deliveries').select(SELECT_FIELDS, { count: 'exact' }).not('distance_km', 'is', null)
    )
    rowQuery = rowQuery.order(sortKey, { ascending: sortDir === 'asc' }).range(from, to)

    const { data, count, error: rowError } = await rowQuery
    if (rowError) {
      setError(rowError.message)
      setLoading(false)
      return
    }

    setRows((data as Row[]) || [])
    setTotalCount(count || 0)

    // Count deliveries that have no distance yet (geocoding pending or failed)
    const { count: noDistCount } = await applyFilters(
      supabase.from('deliveries').select('*', { count: 'exact', head: true }).is('distance_km', null)
    )
    setNullCount(noDistCount || 0)

    setLoading(false)
  }, [applyFilters, sortKey, sortDir, page, supabase])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    async function loadStores() {
      let q = supabase.from('deliveries').select('store_code, store_name').limit(1000)
      if (brand !== 'ALL') q = q.eq('brand', brand)
      const { data } = await q
      const unique = Array.from(
        new Map((data || []).map((r: any) => [r.store_code, `${r.store_code} — ${r.store_name}`])).entries()
      )
      setStoreOptions(unique.map(([, label]) => label).sort())
      setStoreFilter('')
    }
    loadStores()
  }, [brand, supabase])

  useEffect(() => {
    setPage(0)
  }, [brand, dateFrom, dateTo, storeFilter, sortKey, sortDir])

  async function runBackfill() {
    setBackfilling(true)
    setBackfillProcessed(0)
    let totalProcessed = 0
    try {
      while (true) {
        const res = await fetch('/api/backfill-distances?batch=10')
        if (!res.ok) { setError('Backfill request failed'); break }
        const { processed, remaining } = await res.json()
        totalProcessed += processed
        setBackfillProcessed(totalProcessed)
        setBackfillRemaining(remaining)
        if (remaining === 0 || processed === 0) break
      }
    } finally {
      setBackfilling(false)
      fetchData()
    }
  }

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const formatZar = (n: number | null) =>
    n == null ? '—' : new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(n)

  const COLS: { key: string; label: string; sortable: boolean }[] = [
    { key: 'delivery_date', label: 'Date', sortable: true },
    { key: 'store_code', label: 'Store', sortable: true },
    { key: 'customer_name', label: 'Customer', sortable: true },
    { key: 'city', label: 'City', sortable: true },
    { key: 'distance_km', label: 'Distance (km)', sortable: true },
    { key: 'transport1_amount_zar', label: 'Transport 1', sortable: true },
    { key: 'transport2_amount_zar', label: 'Transport 2', sortable: true },
  ]

  return (
    <main className="px-4 py-3">
      {/* Filters */}
      <div className="mb-2 flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
        <div className="flex gap-1 mr-2">
          {(['ALL', 'CTM', 'ITALTILE'] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBrand(b)}
              className={`rounded px-2 py-1 text-xs font-medium ${
                brand === b ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {b === 'ALL' ? 'All' : b}
            </button>
          ))}
        </div>

        <div className="h-4 w-px bg-slate-200" />

        <div className="flex items-end gap-2">
          <div>
            <label className="mb-0.5 block text-xs text-slate-400">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded border border-slate-300 px-1.5 py-1 text-xs"
            />
          </div>
          <div>
            <label className="mb-0.5 block text-xs text-slate-400">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded border border-slate-300 px-1.5 py-1 text-xs"
            />
          </div>
          <div>
            <label className="mb-0.5 block text-xs text-slate-400">Store</label>
            <select
              value={storeFilter}
              onChange={(e) => setStoreFilter(e.target.value)}
              className="rounded border border-slate-300 px-1.5 py-1 text-xs"
            >
              <option value="">All stores</option>
              {storeOptions.map((opt) => (
                <option key={opt} value={opt.split(' — ')[0]}>{opt}</option>
              ))}
            </select>
          </div>
          {(dateFrom || dateTo || storeFilter) && (
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); setStoreFilter('') }}
              className="text-xs text-slate-400 underline-offset-2 hover:underline"
            >
              Clear
            </button>
          )}
        </div>

        <div className="h-4 w-px bg-slate-200" />

        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>
            <span className="font-semibold text-slate-900">{totalCount}</span> with distance
            {nullCount > 0 && (
              <span className="ml-2 text-amber-600">{nullCount} pending</span>
            )}
          </span>
          {nullCount > 0 && (
            <button
              onClick={runBackfill}
              disabled={backfilling}
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              {backfilling
                ? `Geocoding… ${backfillProcessed} done, ${backfillRemaining ?? '?'} left`
                : 'Backfill distances'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              {COLS.map((col) => (
                <th key={col.key} className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-slate-600">
                  <button
                    onClick={() => col.sortable && toggleSort(col.key)}
                    className={`flex items-center gap-0.5 ${col.sortable ? 'cursor-pointer hover:text-slate-900' : 'cursor-default'}`}
                    disabled={!col.sortable}
                  >
                    {col.label}
                    {sortKey === col.key && <span>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={COLS.length} className="px-3 py-6 text-center text-slate-400">Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={COLS.length} className="px-3 py-6 text-center text-slate-400">
                  No distance data yet. Import a SAP file to populate distances.
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="whitespace-nowrap px-2 py-1 text-slate-700">{row.delivery_date ?? '—'}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-slate-700">
                    <span className="font-medium">{row.store_code}</span>
                    <span className="ml-1 text-slate-400">{row.store_name}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-slate-700">{row.customer_name ?? '—'}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-slate-700">{row.city ?? '—'}</td>
                  <td className="whitespace-nowrap px-2 py-1 font-semibold text-slate-900">
                    {row.distance_km != null ? `${row.distance_km} km` : '—'}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-slate-700">{formatZar(row.transport1_amount_zar)}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-slate-700">{formatZar(row.transport2_amount_zar)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>{totalCount} result{totalCount === 1 ? '' : 's'}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40"
          >
            Previous
          </button>
          <span>Page {page + 1} of {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </main>
  )
}
