'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { parseStoreName } from '@/lib/store-utils'
import { getApplicableRateCard, computePayout, computeItaltilePayout, getRateSystemForRow } from '@/lib/rate-cards'
import type {
  Brand,
  DeliveryRecord,
  RateCard,
  RateCardDistanceBand,
  RateCardWeightBand,
  RateCardCell,
} from '@/lib/types'

type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 50

const FAIL_REASON_LABELS: Record<string, string> = {
  no_store_location: 'No store location set',
  no_route: 'No road route found',
  http_error: 'Mapping service error',
  rate_limited: 'Rate limited',
}

function failReasonLabel(reason: string | null): string {
  if (reason == null) return 'Unknown'
  return FAIL_REASON_LABELS[reason] ?? reason
}

interface Row extends Pick<
  DeliveryRecord,
  | 'row_hash'
  | 'delivery_date'
  | 'billing_document'
  | 'brand'
  | 'store_code'
  | 'store_name'
  | 'street'
  | 'city'
  | 'country'
  | 'net_weight_kg'
  | 'distance_km'
  | 'transport1_amount_zar'
  | 'transport2_amount_zar'
  | 'ibt_from'
  | 'ibt_to'
> {}

const SELECT_FIELDS = [
  'row_hash',
  'delivery_date',
  'billing_document',
  'brand',
  'store_code',
  'store_name',
  'street',
  'city',
  'country',
  'net_weight_kg',
  'distance_km',
  'transport1_amount_zar',
  'transport2_amount_zar',
  'ibt_from',
  'ibt_to',
].join(',')

export default function DistancesClient() {
  const supabase = createClient()

  const [brand, setBrand] = useState<Brand | 'ALL'>('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [storeOptions, setStoreOptions] = useState<{ value: string; label: string }[]>([])
  const [sortKey, setSortKey] = useState('distance_km')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)

  const [rows, setRows] = useState<Row[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [nullCount, setNullCount] = useState(0)
  const [distanceFailedCount, setDistanceFailedCount] = useState(0)
  const [failedByReason, setFailedByReason] = useState<{ reason: string | null; count: number }[]>([])
  const [showFailedBreakdown, setShowFailedBreakdown] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const [backfilling, setBackfilling] = useState(false)
  const [backfillRemaining, setBackfillRemaining] = useState<number | null>(null)
  const [backfillProcessed, setBackfillProcessed] = useState(0)

  const [rateCards, setRateCards] = useState<RateCard[]>([])
  const [distanceBands, setDistanceBands] = useState<RateCardDistanceBand[]>([])
  const [weightBands, setWeightBands] = useState<RateCardWeightBand[]>([])
  const [rateCells, setRateCells] = useState<RateCardCell[]>([])

  useEffect(() => {
    async function loadRateCards() {
      const [cardsRes, distRes, weightRes, cellsRes] = await Promise.all([
        supabase.from('rate_cards').select('*'),
        supabase.from('distance_bands').select('*').order('position'),
        supabase.from('weight_bands').select('*').order('position'),
        supabase.from('rate_card_cells').select('*'),
      ])
      setRateCards((cardsRes.data as RateCard[]) || [])
      setDistanceBands((distRes.data as RateCardDistanceBand[]) || [])
      setWeightBands((weightRes.data as RateCardWeightBand[]) || [])
      setRateCells((cellsRes.data as RateCardCell[]) || [])
    }
    loadRateCards()
  }, [supabase])

  function getPayout(row: Row): number | null {
    const system = getRateSystemForRow(row.brand, row.store_name)
    const systemCards = rateCards.filter((c) => c.system === system)
    const card = getApplicableRateCard(systemCards, row.delivery_date)
    if (!card) return null

    const systemDistanceBands = distanceBands.filter((b) => b.system === system)
    const systemWeightBands = weightBands.filter((b) => b.system === system)

    if (system === 'CTM') {
      return computePayout(
        card,
        systemDistanceBands,
        systemWeightBands,
        rateCells,
        row.distance_km,
        row.net_weight_kg,
        // IBT rate selection is disabled until IBT is a properly supported
        // delivery type — every delivery uses the standard (non-IBT) bands.
        false
      )
    }
    return computeItaltilePayout(card, systemDistanceBands, systemWeightBands, rateCells, row.distance_km, row.net_weight_kg)
  }

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

    // Count deliveries that are still awaiting a distance (will be retried by backfill)
    const { count: noDistCount } = await applyFilters(
      supabase.from('deliveries').select('*', { count: 'exact', head: true }).is('distance_km', null).eq('distance_failed', false)
    )
    setNullCount(noDistCount || 0)

    // Count deliveries that permanently failed to get a distance (won't be retried automatically)
    const { count: failedCount } = await applyFilters(
      supabase.from('deliveries').select('*', { count: 'exact', head: true }).eq('distance_failed', true)
    )
    setDistanceFailedCount(failedCount || 0)

    // Breakdown of failures by reason, so it's clear what's actionable (e.g. a
    // missing store location) vs a dead end (no road route found).
    if (failedCount) {
      const { data: reasonRows } = await applyFilters(
        supabase.from('deliveries').select('distance_fail_reason').eq('distance_failed', true)
      )
      const counts = new Map<string | null, number>()
      for (const r of (reasonRows as { distance_fail_reason: string | null }[] | null) ?? []) {
        counts.set(r.distance_fail_reason, (counts.get(r.distance_fail_reason) ?? 0) + 1)
      }
      setFailedByReason(
        Array.from(counts.entries())
          .map(([reason, count]) => ({ reason, count }))
          .sort((a, b) => b.count - a.count)
      )
    } else {
      setFailedByReason([])
    }

    setLoading(false)
  }, [applyFilters, sortKey, sortDir, page, supabase])

  useEffect(() => {
    fetchData()
  }, [fetchData])

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
    let finalDistanceFailed = 0
    let hadBlockingError = false
    try {
      while (true) {
        const res = await fetch('/api/backfill-distances?batch=10')
        if (!res.ok) { setError('Backfill request failed'); hadBlockingError = true; break }
        const json = await res.json()
        const processed: number = json.processed
        const remaining: number = json.remaining
        const remainingGeocode: number = json.remainingGeocode ?? remaining
        const remainingDistance: number = json.remainingDistance ?? 0
        const exhausted: boolean = json.exhausted ?? false
        const distanceFailed: number = json.distanceFailed ?? 0
        const rateLimited: number = json.rateLimited ?? 0
        const writeErrors: string[] = json.errors ?? []
        totalProcessed += processed
        finalDistanceFailed = distanceFailed
        setBackfillProcessed(totalProcessed)
        setBackfillRemaining(remaining)
        if (writeErrors.length > 0) {
          setError(`Backfill write failed: ${writeErrors[0]}`)
          hadBlockingError = true
          break
        }
        if (remaining === 0) break
        if (exhausted && remainingGeocode === 0 && remainingDistance > 0) {
          // All geocodable addresses done but store coords missing for remaining rows
          setError(`${remainingDistance} deliveries geocoded but need store coordinates. Add them in the Settings tab, then run backfill again.`)
          hadBlockingError = true
          break
        }
        if (exhausted) break
        if (rateLimited > 0) {
          // Mapping service is rate-limiting us — back off before the next batch.
          await new Promise((r) => setTimeout(r, 2000))
        }
      }
      if (!hadBlockingError && finalDistanceFailed > 0) {
        setError(
          `${finalDistanceFailed} deliveries could not get an automatic distance ` +
          `(no matching store location or no road route found) and were skipped.`
        )
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

  // Wraps a cell in double quotes only when it contains a comma, quote, or newline;
  // doubles any internal double-quotes per RFC 4180.
  function csvEscape(s: string): string {
    if (/[,"\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }

  const EXPORT_COLS = [
    'Date', 'Billing Document', 'Store Code', 'Store Name', 'Street', 'City', 'Country',
    'Net Weight (kg)', 'Distance (km)', 'Transport 1', 'Transport 2', 'Payout',
  ]

  async function exportCsv() {
    if (totalCount === 0) return
    setExporting(true)
    setError(null)
    try {
      const allRows: Row[] = []
      const BATCH = 1000

      // Supabase silently caps un-ranged queries at 1000 rows, so we page
      // through in batches of 1000 until a batch comes back short.
      let offset = 0
      while (true) {
        let q = applyFilters(
          supabase.from('deliveries').select(SELECT_FIELDS).not('distance_km', 'is', null)
        )
        q = q.order(sortKey, { ascending: sortDir === 'asc' }).range(offset, offset + BATCH - 1)
        const { data, error: fetchError } = await q
        if (fetchError) {
          setError(fetchError.message)
          return
        }
        if (data && data.length > 0) allRows.push(...(data as Row[]))
        if (!data || data.length < BATCH) break
        offset += BATCH
      }

      const header = EXPORT_COLS.map(csvEscape).join(',')
      const body = allRows.map((row) => {
        const { code, name } = parseStoreName(row.store_name ?? '')
        const cells = [
          row.delivery_date ?? '',
          row.billing_document ?? '',
          code || row.store_code,
          name || row.store_name,
          row.street ?? '',
          row.city ?? '',
          row.country ?? '',
          row.net_weight_kg ?? '',
          row.distance_km ?? '',
          row.transport1_amount_zar ?? '',
          row.transport2_amount_zar ?? '',
          getPayout(row) ?? '',
        ]
        return cells.map((c) => csvEscape(String(c))).join(',')
      })
      // UTF-8 BOM ensures Excel auto-detects encoding and renders accented text correctly.
      const csv = '﻿' + [header, ...body].join('\r\n')

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const today = new Date().toISOString().slice(0, 10)
      const a = document.createElement('a')
      a.href = url
      a.download = `distances-${today}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const formatZar = (n: number | null) =>
    n == null ? '—' : new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(n)

  const COLS: { key: string; label: string; sortable: boolean }[] = [
    { key: 'delivery_date', label: 'Date', sortable: true },
    { key: 'billing_document', label: 'Billing Document', sortable: true },
    { key: 'store_code', label: 'Store', sortable: true },
    { key: 'address', label: 'To Address', sortable: false },
    { key: 'net_weight_kg', label: 'Net Weight (kg)', sortable: true },
    { key: 'distance_km', label: 'Distance (km)', sortable: true },
    { key: 'transport1_amount_zar', label: 'Transport 1', sortable: true },
    { key: 'transport2_amount_zar', label: 'Transport 2', sortable: true },
    { key: 'payout', label: 'Payout', sortable: false },
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
                <option key={opt.value} value={opt.value}>{opt.label}</option>
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
          <span className="relative">
            <span className="font-semibold text-slate-900">{totalCount}</span> with distance
            {nullCount > 0 && (
              <span className="ml-2 text-amber-600">{nullCount} pending</span>
            )}
            {distanceFailedCount > 0 && (
              <button
                onClick={() => setShowFailedBreakdown((v) => !v)}
                className="ml-2 text-red-600 underline decoration-dotted underline-offset-2 hover:text-red-700"
              >
                {distanceFailedCount} failed
              </button>
            )}
            {showFailedBreakdown && failedByReason.length > 0 && (
              <div className="absolute left-0 top-full z-10 mt-1 min-w-[220px] rounded border border-slate-200 bg-white p-2 text-xs shadow-md">
                <div className="mb-1 flex items-center justify-between font-medium text-slate-700">
                  <span>Failed distance reasons</span>
                  <button onClick={() => setShowFailedBreakdown(false)} className="text-slate-400 hover:text-slate-600">✕</button>
                </div>
                <ul>
                  {failedByReason.map(({ reason, count }) => (
                    <li key={reason ?? 'unknown'} className="flex items-center justify-between gap-4 py-0.5 text-slate-600">
                      <span>{failReasonLabel(reason)}</span>
                      <span className="font-mono font-medium text-slate-900">{count}</span>
                    </li>
                  ))}
                </ul>
              </div>
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

        <div className="ml-auto flex gap-2">
          <button
            onClick={exportCsv}
            disabled={exporting || totalCount === 0}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
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
                  <td className="whitespace-nowrap px-2 py-1 font-mono text-slate-700">{row.billing_document ?? '—'}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-slate-700">
                    {(() => {
                      const { code, name } = parseStoreName(row.store_name ?? '')
                      return (
                        <>
                          <span className="font-mono font-medium">{code || row.store_code}</span>
                          <span className="ml-1 text-slate-400">{name || row.store_name}</span>
                        </>
                      )
                    })()}
                  </td>
                  <td className="px-2 py-1 text-slate-700">
                    {[row.street, row.city, row.country].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-slate-700">
                    {row.net_weight_kg != null ? `${row.net_weight_kg} kg` : '—'}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 font-semibold text-slate-900">
                    {row.distance_km != null ? `${row.distance_km} km` : '—'}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-slate-700">{formatZar(row.transport1_amount_zar)}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-slate-700">{formatZar(row.transport2_amount_zar)}</td>
                  <td className="whitespace-nowrap px-2 py-1 font-semibold text-slate-900">{formatZar(getPayout(row))}</td>
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
