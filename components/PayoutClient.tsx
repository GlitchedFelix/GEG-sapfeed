'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
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
  totalNetWeight: number
  totalPayout: number
  totalDiff: number
}

const PAGE_SIZE = 50

const NUMERIC_COLS = new Set(['net_weight_kg', 'distance_km', 'transport1_amount_zar', 'transport2_amount_zar', 'payout', 'diff'])

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
].join(',')

export default function PayoutClient() {
  const supabase = createClient()

  const [brand, setBrand] = useState<Brand | 'ALL'>('ALL')
  const [createdFrom, setCreatedFrom] = useState('')
  const [createdTo, setCreatedTo] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [storeFilters, setStoreFilters] = useState<string[]>([])
  const [storeOptions, setStoreOptions] = useState<{ value: string; label: string }[]>([])
  const [sortKey, setSortKey] = useState('delivery_date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)

  const [rows, setRows] = useState<Row[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

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

  const getPayout = useCallback(
    (row: Pick<Row, 'brand' | 'store_name' | 'delivery_date' | 'distance_km' | 'net_weight_kg'>): number | null => {
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
    },
    [rateCards, distanceBands, weightBands, rateCells]
  )

  // A delivery is only ever charged on transport1 OR transport2, never both,
  // so the "actual" transport amount and its variance against the rate card
  // collapse to a single figure per row.
  function getTransportAmount(row: Pick<Row, 'transport1_amount_zar' | 'transport2_amount_zar'>): number | null {
    return row.transport1_amount_zar ?? row.transport2_amount_zar
  }

  function getDiff(row: Row, payout: number | null): number | null {
    const transport = getTransportAmount(row)
    return payout != null && transport != null ? transport - payout : null
  }

  const applyFilters = useCallback(
    (query: any) => {
      let q = query
      if (brand !== 'ALL') q = q.eq('brand', brand)
      if (createdFrom) q = q.gte('created_on', createdFrom)
      if (createdTo) q = q.lte('created_on', createdTo)
      if (dateFrom) q = q.gte('delivery_date', dateFrom)
      if (dateTo) q = q.lte('delivery_date', dateTo)
      if (storeFilters.length > 0) q = q.in('store_code', storeFilters)
      return q
    },
    [brand, createdFrom, createdTo, dateFrom, dateTo, storeFilters]
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

    // Stats must cover ALL matching rows, not just the current page.
    // Supabase caps un-ranged queries at 1000 rows, so we page through
    // in batches of 1000 (same pattern as CSV export) to get accurate totals.
    const STATS_BATCH = 1000
    const s: Stats = { deliveryCount: 0, totalTransport1: 0, totalTransport2: 0, totalNetWeight: 0, totalPayout: 0, totalDiff: 0 }
    let statsOffset = 0
    let statsOk = true
    while (true) {
      const { data: statsRows, error: statsError } = await applyFilters(
        supabase.from('deliveries').select(SELECT_FIELDS).not('distance_km', 'is', null)
      ).range(statsOffset, statsOffset + STATS_BATCH - 1)
      if (statsError) { statsOk = false; break }
      for (const r of (statsRows as Row[] | null) || []) {
        const payout = getPayout(r)
        const diff = getDiff(r, payout)
        s.deliveryCount++
        s.totalTransport1 += r.transport1_amount_zar || 0
        s.totalTransport2 += r.transport2_amount_zar || 0
        s.totalNetWeight += r.net_weight_kg || 0
        s.totalPayout += payout || 0
        s.totalDiff += diff || 0
      }
      if (!statsRows || statsRows.length < STATS_BATCH) break
      statsOffset += STATS_BATCH
    }
    if (statsOk) setStats(s)

    setLoading(false)
  }, [applyFilters, sortKey, sortDir, page, supabase, getPayout])

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
      setStoreFilters([])
    }
    loadStores()
  }, [brand, supabase])

  useEffect(() => {
    setPage(0)
  }, [brand, createdFrom, createdTo, dateFrom, dateTo, storeFilters, sortKey, sortDir])

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
    'Net Weight (kg)', 'Distance (km)', 'Transport 1', 'Transport 2', 'Payout (Rate Card)', 'Diff',
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
        const payout = getPayout(row)
        const diff = getDiff(row, payout)
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
          payout ?? '',
          diff ?? '',
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
      a.download = `payout-${today}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const formatZar = (n: number | null) =>
    n == null ? '—' : new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(n)
  const formatZarSigned = (n: number | null) =>
    n == null
      ? '—'
      : new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0, signDisplay: 'exceptZero' }).format(n)
  const formatKg = (n: number) => `${new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 }).format(n)} kg`

  const COLS: { key: string; label: string; sortable: boolean }[] = [
    { key: 'delivery_date', label: 'Date', sortable: true },
    { key: 'billing_document', label: 'Billing Document', sortable: true },
    { key: 'store_code', label: 'Store', sortable: true },
    { key: 'store_name', label: 'Store Name', sortable: false },
    { key: 'address', label: 'Address', sortable: false },
    { key: 'net_weight_kg', label: 'Net Weight (kg)', sortable: true },
    { key: 'distance_km', label: 'Distance (km)', sortable: true },
    { key: 'transport1_amount_zar', label: 'Transport 1', sortable: true },
    { key: 'transport2_amount_zar', label: 'Transport 2', sortable: true },
    { key: 'payout', label: 'Payout (Rate Card)', sortable: false },
    { key: 'diff', label: 'Diff', sortable: false },
  ]

  return (
    <main className="mx-auto max-w-[1600px] space-y-3 px-4 py-4">
      {/* Filters */}
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

          {(createdFrom || createdTo || dateFrom || dateTo || storeFilters.length > 0) && (
            <button
              onClick={() => {
                setCreatedFrom('')
                setCreatedTo('')
                setDateFrom('')
                setDateTo('')
                setStoreFilters([])
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
            <StatCard label="Transport 1" value={formatZar(stats.totalTransport1)} />
            <StatCard label="Transport 2" value={formatZar(stats.totalTransport2)} />
            <StatCard label="Net" value={formatKg(stats.totalNetWeight)} />
            <StatCard label="Payout Total" value={formatZar(stats.totalPayout)} emphasis="primary" />
            <StatCard label="Diff Total" value={formatZarSigned(stats.totalDiff)} />
          </div>
        ) : (
          <span className="text-xs text-slate-400">Loading…</span>
        )}

        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={exportCsv} disabled={exporting || totalCount === 0}>
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        </div>
      </Panel>

      {error && <Alert tone="warning">{error}</Alert>}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-card scrollbar-thin">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80">
              {COLS.map((col) => {
                const numeric = NUMERIC_COLS.has(col.key)
                return (
                  <th
                    key={col.key}
                    className={cn(
                      'whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500',
                      numeric ? 'text-right' : 'text-left'
                    )}
                  >
                    <button
                      onClick={() => col.sortable && toggleSort(col.key)}
                      className={cn(
                        'inline-flex items-center gap-0.5',
                        col.sortable ? 'cursor-pointer hover:text-slate-900' : 'cursor-default',
                        numeric && 'flex-row-reverse'
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
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={COLS.length} className="px-3 py-10 text-center text-slate-400">Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={COLS.length} className="px-3 py-10 text-center text-slate-400">
                  No payout data yet. Import a SAP file to populate deliveries.
                </td>
              </tr>
            ) : (
              rows.map((row, i) => {
                const { code, name } = parseStoreName(row.store_name ?? '')
                const payout = getPayout(row)
                const diff = getDiff(row, payout)
                return (
                  <tr key={i} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/70">
                    <td className="whitespace-nowrap px-3 py-1.5 text-slate-700">{row.delivery_date ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-slate-700">{row.billing_document ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono font-medium text-slate-800">{code || row.store_code}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-slate-700">{name || row.store_name}</td>
                    <td className="px-3 py-1.5 text-slate-700">
                      {[row.street, row.city, row.country].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-medium text-slate-800">
                      {row.net_weight_kg != null ? `${row.net_weight_kg} kg` : '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-semibold text-slate-900">
                      {row.distance_km != null ? `${row.distance_km} km` : '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-medium text-slate-800">{formatZar(row.transport1_amount_zar)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-medium text-slate-800">{formatZar(row.transport2_amount_zar)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-semibold text-slate-900">{formatZar(payout)}</td>
                    <td className={cn(
                      'whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-medium',
                      diff == null ? 'text-slate-400' : diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-slate-700'
                    )}>
                      {formatZarSigned(diff)}
                    </td>
                  </tr>
                )
              })
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
