'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { X, ChevronUp, ChevronDown } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { COLUMNS } from '@/lib/columns'
import { parseStoreName } from '@/lib/store-utils'
import type { Brand, DeliveryRecord } from '@/lib/types'
import Panel from '@/components/ui/Panel'
import Button from '@/components/ui/Button'
import Alert from '@/components/ui/Alert'
import StatCard from '@/components/ui/StatCard'
import SegmentedControl from '@/components/ui/SegmentedControl'
import MultiSelect from '@/components/ui/MultiSelect'
import Pagination from '@/components/ui/Pagination'
import { fieldClass, fieldLabelClass } from '@/components/ui/fieldStyles'
import { cn } from '@/components/ui/cn'

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
  const [createdFrom, setCreatedFrom] = useState('')
  const [createdTo, setCreatedTo] = useState('')
  const [storeFilters, setStoreFilters] = useState<string[]>([])
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
  const [storeOptions, setStoreOptions] = useState<{ value: string; label: string }[]>([])
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
    (query: any) => {
      let q = query as any
      if (brand !== 'ALL') q = q.eq('brand', brand)
      if (createdFrom) q = q.gte('created_on', createdFrom)
      if (createdTo) q = q.lte('created_on', createdTo)
      if (dateFrom) q = q.gte('delivery_date', dateFrom)
      if (dateTo) q = q.lte('delivery_date', dateTo)
      if (storeFilters.length > 0) q = q.in('store_code', storeFilters)
      if (debouncedSearch) q = q.ilike('search_blob', `%${debouncedSearch.toLowerCase()}%`)
      return q
    },
    [brand, createdFrom, createdTo, dateFrom, dateTo, storeFilters, debouncedSearch]
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

    // Stats must cover ALL matching rows, not just the current page.
    // Supabase caps un-ranged queries at 1000 rows, so we page through
    // in batches of 1000 (same pattern as CSV export) to get accurate totals.
    const STATS_BATCH = 1000
    const s: Stats = { deliveryCount: 0, totalTransport1: 0, totalTransport2: 0, totalGrossWeight: 0, totalNetWeight: 0 }
    let statsOffset = 0
    let statsOk = true
    while (true) {
      const { data: statsRows, error: statsError } = await applyFilters(
        supabase.from('deliveries').select('transport1_amount_zar, transport2_amount_zar, gross_weight_kg, net_weight_kg')
      ).range(statsOffset, statsOffset + STATS_BATCH - 1)
      if (statsError) { statsOk = false; break }
      for (const r of statsRows || []) {
        s.deliveryCount++
        s.totalTransport1 += r.transport1_amount_zar || 0
        s.totalTransport2 += r.transport2_amount_zar || 0
        s.totalGrossWeight += r.gross_weight_kg || 0
        s.totalNetWeight += r.net_weight_kg || 0
      }
      if (!statsRows || statsRows.length < STATS_BATCH) break
      statsOffset += STATS_BATCH
    }
    if (statsOk) setStats(s)

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
      const seen = new Map<string, string>()
      const PAGE = 1000
      let offset = 0
      while (true) {
        let q = supabase.from('deliveries').select('store_code, store_name').range(offset, offset + PAGE - 1)
        if (brand !== 'ALL') q = q.eq('brand', brand)
        const { data } = await q
        if (!data || data.length === 0) break
        for (const r of data as any[]) {
          if (!seen.has(r.store_code)) {
            const { code, name } = parseStoreName(r.store_name ?? '')
            seen.set(r.store_code, `${code || r.store_code} — ${name}`)
          }
        }
        if (data.length < PAGE) break
        offset += PAGE
      }
      const opts = Array.from(seen.entries())
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label))
      setStoreOptions(opts)
      setStoreFilters([])
    }
    loadStores()
  }, [brand, supabase])

  useEffect(() => {
    setPage(0)
  }, [brand, dateFrom, dateTo, storeFilters, debouncedSearch, sortKey, sortDir])

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
    <main className="mx-auto max-w-[1600px] space-y-3 px-4 py-4">
      {/* Column picker modal */}
      <Transition show={showColModal} as={Fragment}>
        <Dialog onClose={() => setShowColModal(false)} className="relative z-20">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-150"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" aria-hidden="true" />
          </Transition.Child>

          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-150"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-100"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md max-h-[80vh] overflow-y-auto rounded-xl bg-white shadow-popover">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <Dialog.Title className="text-sm font-semibold text-slate-900">Visible columns</Dialog.Title>
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
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 px-4 py-3">
                  {COLUMNS.map((col) => (
                    <label key={col.key} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={visibleKeys.has(col.key)}
                        onChange={() => toggleCol(col.key)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
                      />
                      <span className="text-xs text-slate-700">{col.label}</span>
                    </label>
                  ))}
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition>

      {/* Top bar: brand toggle + filters + stats */}
      <Panel className="flex flex-wrap items-end gap-3">
        <SegmentedControl
          options={[
            { value: 'ALL' as const, label: 'All' },
            { value: 'CTM' as const, label: 'CTM' },
            { value: 'ITALTILE' as const, label: 'Italtile' },
          ]}
          value={brand}
          onChange={setBrand}
        />

        <div className="h-6 w-px bg-slate-200" />

        {/* Date + store filters */}
        <div className="flex flex-wrap items-end gap-2">
          {/* Created On range */}
          <div className="flex items-end gap-1">
            <div>
              <label className={fieldLabelClass}>Created On From</label>
              <input
                type="date"
                value={createdFrom}
                onChange={(e) => setCreatedFrom(e.target.value)}
                className={fieldClass}
              />
            </div>
            <div>
              <label className={fieldLabelClass}>To</label>
              <input
                type="date"
                value={createdTo}
                onChange={(e) => setCreatedTo(e.target.value)}
                className={fieldClass}
              />
            </div>
          </div>

          <div className="h-6 w-px bg-slate-200" />

          {/* Delivery Date range */}
          <div className="flex items-end gap-1">
            <div>
              <label className={fieldLabelClass}>Delivery Date From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className={fieldClass}
              />
            </div>
            <div>
              <label className={fieldLabelClass}>To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className={fieldClass}
              />
            </div>
          </div>
          <MultiSelect
            label="Store"
            options={storeOptions}
            selected={storeFilters}
            onChange={setStoreFilters}
            placeholder="All stores"
          />
          <div>
            <label className={fieldLabelClass}>Search</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Delivery / billing / sales no, customer…"
              className={cn('w-56', fieldClass)}
            />
          </div>
          {(createdFrom || createdTo || dateFrom || dateTo || storeFilters.length > 0 || search) && (
            <button
              onClick={() => {
                setCreatedFrom('')
                setCreatedTo('')
                setDateFrom('')
                setDateTo('')
                setStoreFilters([])
                setSearch('')
              }}
              className="text-xs text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline"
            >
              Clear
            </button>
          )}
        </div>

        <div className="h-6 w-px bg-slate-200" />

        {/* Inline stats */}
        {stats ? (
          <div className="flex flex-wrap gap-5">
            <StatCard label="Deliveries" value={String(stats.deliveryCount)} />
            <StatCard label="Transport 1" value={formatZar(stats.totalTransport1)} emphasis="primary" />
            <StatCard label="Transport 2" value={formatZar(stats.totalTransport2)} />
            <StatCard label="Gross" value={formatKg(stats.totalGrossWeight)} />
            <StatCard label="Net" value={formatKg(stats.totalNetWeight)} />
          </div>
        ) : (
          <span className="text-xs text-slate-400">Loading…</span>
        )}

        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={exportCsv} disabled={exporting || totalCount === 0}>
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
          <Button variant="secondary" onClick={() => setShowColModal(true)}>
            Columns ({visibleKeys.size}/{COLUMNS.length})
          </Button>
        </div>
      </Panel>

      {error && <Alert tone="warning">{error}</Alert>}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-card scrollbar-thin">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80">
              {visibleCols.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500',
                    col.type === 'number' ? 'text-right' : 'text-left'
                  )}
                >
                  <button
                    onClick={() => col.sortable && toggleSort(col.key)}
                    className={cn(
                      'inline-flex items-center gap-0.5',
                      col.sortable ? 'cursor-pointer hover:text-slate-900' : 'cursor-default',
                      col.type === 'number' && 'flex-row-reverse'
                    )}
                    disabled={!col.sortable}
                  >
                    {col.label}
                    {sortKey === col.key &&
                      (sortDir === 'asc' ? (
                        <ChevronUp className="h-3 w-3 text-accent-600" />
                      ) : (
                        <ChevronDown className="h-3 w-3 text-accent-600" />
                      ))}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={visibleCols.length} className="px-3 py-10 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={visibleCols.length} className="px-3 py-10 text-center text-slate-400">
                  No deliveries match these filters.
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={i} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/70">
                  {visibleCols.map((col) => {
                    const value = (row as any)[col.key]
                    const numeric = col.type === 'number'
                    if (col.key === 'store_code') {
                      const { code } = parseStoreName(row.store_name ?? '')
                      return (
                        <td key={col.key} className="whitespace-nowrap px-3 py-1.5 font-mono font-medium text-slate-800">
                          {code || row.store_code}
                        </td>
                      )
                    }
                    if (col.key === 'store_name') {
                      const { name } = parseStoreName(row.store_name ?? '')
                      return (
                        <td key={col.key} className="whitespace-nowrap px-3 py-1.5 text-slate-700">
                          {name || row.store_name}
                        </td>
                      )
                    }
                    let display: string
                    if (col.type === 'boolean') display = value ? 'Yes' : 'No'
                    else if (value === null || value === undefined) display = '—'
                    else display = String(value)
                    return (
                      <td
                        key={col.key}
                        className={cn(
                          'whitespace-nowrap px-3 py-1.5 text-slate-700',
                          numeric && 'text-right tabular-nums font-medium text-slate-800'
                        )}
                      >
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

      <Pagination
        page={page}
        totalPages={totalPages}
        totalCount={totalCount}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
        itemLabel="result"
      />
    </main>
  )
}
