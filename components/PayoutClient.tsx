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
import SegmentedControl from '@/components/ui/SegmentedControl'
import Pagination from '@/components/ui/Pagination'
import { fieldClass, fieldLabelClass } from '@/components/ui/fieldStyles'
import { cn } from '@/components/ui/cn'

type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 50

const NUMERIC_COLS = new Set(['transport1_amount_zar', 'transport2_amount_zar', 'payout', 'diff1', 'diff2'])

interface Row extends Pick<
  DeliveryRecord,
  | 'row_hash'
  | 'delivery_date'
  | 'brand'
  | 'store_code'
  | 'store_name'
  | 'net_weight_kg'
  | 'distance_km'
  | 'transport1_amount_zar'
  | 'transport2_amount_zar'
> {}

const SELECT_FIELDS = [
  'row_hash',
  'delivery_date',
  'brand',
  'store_code',
  'store_name',
  'net_weight_kg',
  'distance_km',
  'transport1_amount_zar',
  'transport2_amount_zar',
].join(',')

export default function PayoutClient() {
  const supabase = createClient()

  const [brand, setBrand] = useState<Brand | 'ALL'>('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [storeOptions, setStoreOptions] = useState<{ value: string; label: string }[]>([])
  const [sortKey, setSortKey] = useState('store_code')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [page, setPage] = useState(0)

  const [rows, setRows] = useState<Row[]>([])
  const [totalCount, setTotalCount] = useState(0)
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
    'Store', 'Store Name', 'Transport 1', 'Transport 2', 'Payout (Rate Card)',
    'Diff vs Transport 1', 'Diff vs Transport 2',
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
        const diff1 = payout != null && row.transport1_amount_zar != null ? row.transport1_amount_zar - payout : null
        const diff2 = payout != null && row.transport2_amount_zar != null ? row.transport2_amount_zar - payout : null
        const cells = [
          code || row.store_code,
          name || row.store_name,
          row.transport1_amount_zar ?? '',
          row.transport2_amount_zar ?? '',
          payout ?? '',
          diff1 ?? '',
          diff2 ?? '',
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

  const COLS: { key: string; label: string; sortable: boolean }[] = [
    { key: 'store_code', label: 'Store', sortable: true },
    { key: 'store_name', label: 'Store Name', sortable: false },
    { key: 'transport1_amount_zar', label: 'Transport 1', sortable: true },
    { key: 'transport2_amount_zar', label: 'Transport 2', sortable: true },
    { key: 'payout', label: 'Payout (Rate Card)', sortable: false },
    { key: 'diff1', label: 'Diff vs Transport 1', sortable: false },
    { key: 'diff2', label: 'Diff vs Transport 2', sortable: false },
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
          <div>
            <label className={fieldLabelClass}>From</label>
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
          <div>
            <label className={fieldLabelClass}>Store</label>
            <select
              value={storeFilter}
              onChange={(e) => setStoreFilter(e.target.value)}
              className={fieldClass}
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
              className="text-xs text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline"
            >
              Clear
            </button>
          )}
        </div>

        <div className="h-6 w-px bg-slate-200" />

        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>
            <span className="font-semibold text-slate-900">{totalCount}</span> with distance
          </span>
        </div>

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
                const diff1 = payout != null && row.transport1_amount_zar != null ? row.transport1_amount_zar - payout : null
                const diff2 = payout != null && row.transport2_amount_zar != null ? row.transport2_amount_zar - payout : null
                return (
                  <tr key={i} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/70">
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono font-medium text-slate-700">{code || row.store_code}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-slate-700">{name || row.store_name}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-medium text-slate-800">{formatZar(row.transport1_amount_zar)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-medium text-slate-800">{formatZar(row.transport2_amount_zar)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-semibold text-slate-900">{formatZar(payout)}</td>
                    <td className={cn(
                      'whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-medium',
                      diff1 == null ? 'text-slate-400' : diff1 > 0 ? 'text-emerald-600' : diff1 < 0 ? 'text-red-600' : 'text-slate-700'
                    )}>
                      {formatZarSigned(diff1)}
                    </td>
                    <td className={cn(
                      'whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-medium',
                      diff2 == null ? 'text-slate-400' : diff2 > 0 ? 'text-emerald-600' : diff2 < 0 ? 'text-red-600' : 'text-slate-700'
                    )}>
                      {formatZarSigned(diff2)}
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
