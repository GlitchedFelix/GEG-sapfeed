'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { parseStoreName } from '@/lib/store-utils'
import type { Brand, DeliveryRecord } from '@/lib/types'
import Panel from '@/components/ui/Panel'
import Button from '@/components/ui/Button'
import Alert from '@/components/ui/Alert'
import SegmentedControl from '@/components/ui/SegmentedControl'
import MultiSelect from '@/components/ui/MultiSelect'
import Pagination from '@/components/ui/Pagination'
import EditableDistanceCell from '@/components/EditableDistanceCell'
import { fieldClass, fieldLabelClass } from '@/components/ui/fieldStyles'
import { cn } from '@/components/ui/cn'

type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 50

const NUMERIC_COLS = new Set(['distance_km'])

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
  | 'distance_km'
  | 'distance_manual'
  | 'geocode_precise'
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
  'distance_km',
  'distance_manual',
  'geocode_precise',
  'ibt_from',
  'ibt_to',
].join(',')

interface Props {
  onSwitchToFailed?: () => void
}

export default function DistancesClient({ onSwitchToFailed }: Props) {
  const supabase = createClient()

  const [brand, setBrand] = useState<Brand | 'ALL'>('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [storeFilters, setStoreFilters] = useState<string[]>([])
  const [storeOptions, setStoreOptions] = useState<{ value: string; label: string }[]>([])
  const [sortKey, setSortKey] = useState('distance_km')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)

  const [rows, setRows] = useState<Row[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [nullCount, setNullCount] = useState(0)
  const [distanceFailedCount, setDistanceFailedCount] = useState(0)
  const [approxCount, setApproxCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const [backfilling, setBackfilling] = useState(false)
  const [backfillRemaining, setBackfillRemaining] = useState<number | null>(null)
  const [backfillProcessed, setBackfillProcessed] = useState(0)

  const applyFilters = useCallback(
    (query: any) => {
      let q = query
      if (brand !== 'ALL') q = q.eq('brand', brand)
      if (dateFrom) q = q.gte('delivery_date', dateFrom)
      if (dateTo) q = q.lte('delivery_date', dateTo)
      if (storeFilters.length > 0) q = q.in('store_code', storeFilters)
      return q
    },
    [brand, dateFrom, dateTo, storeFilters]
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

    // Count deliveries that are still awaiting a distance (will be retried by backfill).
    // Excludes rows that permanently failed geocoding too — those will never get
    // a customer_lat, so they'd otherwise sit in "pending" forever even though
    // the backfill will never touch them again.
    const { count: noDistCount } = await applyFilters(
      supabase.from('deliveries').select('*', { count: 'exact', head: true })
        .is('distance_km', null).eq('distance_failed', false).eq('geocode_failed', false)
    )
    setNullCount(noDistCount || 0)

    // Count deliveries that permanently failed to get a distance (won't be retried
    // automatically) — either the address itself couldn't be geocoded, or the
    // geocoded address couldn't get a driving distance.
    const { count: failedCount } = await applyFilters(
      supabase.from('deliveries').select('*', { count: 'exact', head: true })
        .or('distance_failed.eq.true,geocode_failed.eq.true')
    )
    setDistanceFailedCount(failedCount || 0)

    // Count resolved deliveries whose geocode only matched at city/suburb
    // precision (not an exact street) — worth surfacing separately since
    // they're auditable before being trusted for payout amounts.
    const { count: approxCnt } = await applyFilters(
      supabase.from('deliveries').select('*', { count: 'exact', head: true })
        .not('distance_km', 'is', null).eq('geocode_precise', false).eq('distance_manual', false)
    )
    setApproxCount(approxCnt || 0)

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
      setStoreFilters([])
    }
    loadStores()
  }, [brand, supabase])

  useEffect(() => {
    setPage(0)
  }, [brand, dateFrom, dateTo, storeFilters, sortKey, sortDir])

  async function runBackfill() {
    setBackfilling(true)
    setBackfillProcessed(0)
    let totalProcessed = 0
    let finalDistanceFailed = 0
    let hadBlockingError = false
    try {
      while (true) {
        const res = await fetch('/api/backfill-distances?batch=50')
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
    'Distance (km)', 'Manual', 'Approximate',
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
          row.distance_km ?? '',
          row.distance_manual ? 'Yes' : '',
          !row.distance_manual && !row.geocode_precise ? 'Yes' : '',
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

  const COLS: { key: string; label: string; sortable: boolean }[] = [
    { key: 'delivery_date', label: 'Date', sortable: true },
    { key: 'billing_document', label: 'Billing Document', sortable: true },
    { key: 'store_code', label: 'Store', sortable: true },
    { key: 'address', label: 'To Address', sortable: false },
    { key: 'distance_km', label: 'Distance (km)', sortable: true },
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
          <MultiSelect
            label="Store"
            options={storeOptions}
            selected={storeFilters}
            onChange={setStoreFilters}
            placeholder="All stores"
          />
          {(dateFrom || dateTo || storeFilters.length > 0) && (
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); setStoreFilters([]) }}
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
            {nullCount > 0 && (
              <span className="ml-2 text-amber-600">{nullCount} pending</span>
            )}
            {approxCount > 0 && (
              <span className="ml-2 text-amber-600" title="Geocoded to city/suburb, not an exact street match">
                {approxCount} approximate
              </span>
            )}
          </span>
          {distanceFailedCount > 0 && (
            onSwitchToFailed ? (
              <button
                onClick={onSwitchToFailed}
                className="text-red-600 underline decoration-dotted underline-offset-2 hover:text-red-700"
              >
                {distanceFailedCount} failed
              </button>
            ) : (
              <span className="text-red-600">{distanceFailedCount} failed</span>
            )
          )}
          {nullCount > 0 && (
            <Button variant="secondary" onClick={runBackfill} disabled={backfilling}>
              {backfilling
                ? `Geocoding… ${backfillProcessed} done, ${backfillRemaining ?? '?'} left`
                : 'Backfill distances'}
            </Button>
          )}
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
                  No distance data yet. Import a SAP file to populate distances.
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={i} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/70">
                  <td className="whitespace-nowrap px-3 py-1.5 text-slate-700">{row.delivery_date ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-slate-700">{row.billing_document ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-slate-700">
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
                  <td className="px-3 py-1.5 text-slate-700">
                    {[row.street, row.city, row.country].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <EditableDistanceCell
                      rowHash={row.row_hash}
                      value={row.distance_km}
                      manual={row.distance_manual}
                      precise={row.geocode_precise}
                      onSaved={(km) => {
                        setRows((prev) =>
                          prev.map((r) =>
                            r.row_hash === row.row_hash ? { ...r, distance_km: km, distance_manual: true } : r
                          )
                        )
                      }}
                    />
                  </td>
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
