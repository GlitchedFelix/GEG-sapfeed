'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { COLUMNS } from '@/lib/columns'
import type { Brand, DeliveryRecord } from '@/lib/types'

type SortDir = 'asc' | 'desc'

interface Stats {
  deliveryCount: number
  totalTransport1: number
  totalTransport2: number
  totalGrossWeight: number
  totalNetWeight: number
}

const PAGE_SIZE = 50

export default function SearchClient() {
  const supabase = createClient()

  const [brand, setBrand] = useState<Brand | 'ALL'>('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sortKey, setSortKey] = useState('delivery_date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(() => new Set(COLUMNS.map((c) => c.key)))
  const [showColModal, setShowColModal] = useState(false)

  const [rows, setRows] = useState<DeliveryRecord[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [stats, setStats] = useState<Stats | null>(null)
  const [storeOptions, setStoreOptions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  // Debounce the raw search input so we don't fire two Supabase queries
  // on every keystroke while the user is still typing a document number.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(id)
  }, [search])

  // Builds the same set of filters for both the paginated row query and
  // the stats query, so the side panel always reflects exactly what's
  // visible in the table — no drift between "what you see" and "what
  // the stats describe".
  const applyFilters = useCallback(
    (query: ReturnType<typeof supabase.from>) => {
      let q = query as any
      if (brand !== 'ALL') q = q.eq('brand', brand)
      if (dateFrom) q = q.gte('delivery_date', dateFrom)
      if (dateTo) q = q.lte('delivery_date', dateTo)
      if (storeFilter) q = q.eq('store_code', storeFilter)
      if (debouncedSearch) q = q.ilike('search_blob', `%${debouncedSearch.toLowerCase()}%`)
      return q
    },
    [brand, dateFrom, dateTo, storeFilter, debouncedSearch]
  )

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    let rowQuery = applyFilters(supabase.from('deliveries').select('*', { count: 'exact' }))
    rowQuery = rowQuery.order(sortKey, { ascending: sortDir === 'asc' }).range(from, to)

    const { data, count, error: rowError } = await rowQuery

    if (rowError) {
      setError(rowError.message)
      setLoading(false)
      return
    }

    setRows((data as DeliveryRecord[]) || [])
    setTotalCount(count || 0)

    // Stats are computed via a Postgres aggregate query (not by summing
    // the current page client-side) so they reflect ALL matching rows
    // across every page, not just the 50 visible right now.
    const statsQuery = applyFilters(
      supabase.from('deliveries').select('transport1_amount_zar, transport2_amount_zar, gross_weight_kg, net_weight_kg')
    )
    const { data: statsRows, error: statsError } = await statsQuery

    if (!statsError && statsRows) {
      const s = statsRows.reduce(
        (acc, r: any) => ({
          deliveryCount: acc.deliveryCount + 1,
          totalTransport1: acc.totalTransport1 + (r.transport1_amount_zar || 0),
          totalTransport2: acc.totalTransport2 + (r.transport2_amount_zar || 0),
          totalGrossWeight: acc.totalGrossWeight + (r.gross_weight_kg || 0),
          totalNetWeight: acc.totalNetWeight + (r.net_weight_kg || 0),
        }),
        { deliveryCount: 0, totalTransport1: 0, totalTransport2: 0, totalGrossWeight: 0, totalNetWeight: 0 }
      )
      setStats(s)
    }

    setLoading(false)
  }, [applyFilters, sortKey, sortDir, page, supabase])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Store list for the dropdown depends on brand, so it's refetched
  // whenever brand changes (CTM stores shouldn't appear when viewing
  // Italtile and vice versa).
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
  }, [brand, dateFrom, dateTo, storeFilter, debouncedSearch, sortKey, sortDir])

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const visibleCols = COLUMNS.filter((c) => visibleKeys.has(c.key))

  const formatZar = (n: number) =>
    new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(n)
  const formatKg = (n: number) => `${new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 }).format(n)} kg`

  // CSV helpers — kept close to the export function so the intent is clear.
  // csvCell mirrors the table's display logic but emits spreadsheet-friendly values:
  // booleans as Yes/No, nulls as empty string (not the on-screen dash), numbers raw.
  function csvCell(value: unknown, type: string): string {
    if (value === null || value === undefined) return ''
    if (type === 'boolean') return value ? 'Yes' : 'No'
    return String(value)
  }

  // Wraps a cell in double quotes only when it contains a comma, quote, or newline;
  // doubles any internal double-quotes per RFC 4180.
  function csvEscape(s: string): string {
    if (/[,"\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }

  async function exportCsv() {
    const cols = visibleCols
    if (cols.length === 0) return
    setExporting(true)
    setError(null)
    try {
      const selectFields = cols.map((c) => c.key).join(',')
      const allRows: Record<string, unknown>[] = []
      const BATCH = 1000

      // Supabase silently caps un-ranged queries at 1000 rows, so we page
      // through in batches of 1000 until a batch comes back short.
      let offset = 0
      while (true) {
        let q = applyFilters(supabase.from('deliveries').select(selectFields))
        q = q.order(sortKey, { ascending: sortDir === 'asc' }).range(offset, offset + BATCH - 1)
        const { data, error: fetchError } = await q
        if (fetchError) {
          setError(fetchError.message)
          return
        }
        if (data && data.length > 0) allRows.push(...(data as Record<string, unknown>[]))
        if (!data || data.length < BATCH) break
        offset += BATCH
      }

      const header = cols.map((c) => csvEscape(c.label)).join(',')
      const body = allRows.map((row) =>
        cols.map((c) => csvEscape(csvCell(row[c.key], c.type))).join(',')
      )
      // UTF-8 BOM ensures Excel auto-detects encoding and renders accented text correctly.
      const csv = '﻿' + [header, ...body].join('\r\n')

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const today = new Date().toISOString().slice(0, 10)
      const a = document.createElement('a')
      a.href = url
      a.download = `deliveries-${today}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  function toggleCol(key: string) {
    setVisibleKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) { next.delete(key) } else { next.add(key) }
      return next
    })
  }

  return (
    <main className="px-4 py-3">
      {/* Column picker modal */}
      {showColModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowColModal(false)} />
          <div className="relative z-10 w-[480px] max-h-[80vh] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <span className="text-sm font-semibold text-slate-900">Visible columns</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setVisibleKeys(new Set(COLUMNS.map((c) => c.key)))}
                  className="text-xs text-slate-500 hover:text-slate-900"
                >
                  All
                </button>
                <button
                  onClick={() => setVisibleKeys(new Set())}
                  className="text-xs text-slate-500 hover:text-slate-900"
                >
                  None
                </button>
                <button onClick={() => setShowColModal(false)} className="text-slate-400 hover:text-slate-700">
                  ✕
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 px-4 py-3">
              {COLUMNS.map((col) => (
                <label key={col.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={visibleKeys.has(col.key)}
                    onChange={() => toggleCol(col.key)}
                    className="h-3.5 w-3.5 rounded border-slate-300"
                  />
                  <span className="text-xs text-slate-700">{col.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Top bar: brand toggle + filters + stats */}
      <div className="mb-2 flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
        {/* Brand toggle */}
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

        {/* Date + store filters */}
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
                <option key={opt} value={opt.split(' — ')[0]}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-0.5 block text-xs text-slate-400">Search</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Delivery / billing / sales no, customer…"
              className="w-56 rounded border border-slate-300 px-1.5 py-1 text-xs"
            />
          </div>
          {(dateFrom || dateTo || storeFilter || search) && (
            <button
              onClick={() => {
                setDateFrom('')
                setDateTo('')
                setStoreFilter('')
                setSearch('')
              }}
              className="text-xs text-slate-400 underline-offset-2 hover:underline"
            >
              Clear
            </button>
          )}
        </div>

        <div className="h-4 w-px bg-slate-200" />

        {/* Inline stats */}
        {stats ? (
          <dl className="flex gap-4 text-xs">
            <div>
              <dt className="text-slate-400">Deliveries</dt>
              <dd className="font-semibold text-slate-900">{stats.deliveryCount}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Transport 1</dt>
              <dd className="text-sm font-bold text-slate-900">{formatZar(stats.totalTransport1)}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Transport 2</dt>
              <dd className="font-medium text-slate-700">{formatZar(stats.totalTransport2)}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Gross</dt>
              <dd className="font-medium text-slate-700">{formatKg(stats.totalGrossWeight)}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Net</dt>
              <dd className="font-medium text-slate-700">{formatKg(stats.totalNetWeight)}</dd>
            </div>
          </dl>
        ) : (
          <span className="text-xs text-slate-400">Loading…</span>
        )}

        <div className="ml-auto flex gap-2">
          <button
            onClick={exportCsv}
            disabled={exporting || totalCount === 0}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
          <button
            onClick={() => setShowColModal(true)}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            Columns ({visibleKeys.size}/{COLUMNS.length})
          </button>
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
              {visibleCols.map((col) => (
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
                <td colSpan={visibleCols.length} className="px-3 py-6 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={visibleCols.length} className="px-3 py-6 text-center text-slate-400">
                  No deliveries match these filters.
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                  {visibleCols.map((col) => {
                    const value = (row as any)[col.key]
                    let display: string
                    if (col.type === 'boolean') display = value ? 'Yes' : 'No'
                    else if (value === null || value === undefined) display = '—'
                    else display = String(value)
                    return (
                      <td key={col.key} className="whitespace-nowrap px-2 py-1 text-slate-700">
                        {display}
                      </td>
                    )
                  })}
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
