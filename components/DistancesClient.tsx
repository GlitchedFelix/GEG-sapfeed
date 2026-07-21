'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'
import { Popover, Transition } from '@headlessui/react'
import { X, ChevronUp, ChevronDown } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { parseStoreName } from '@/lib/store-utils'
import type { Brand, DeliveryRecord } from '@/lib/types'
import Panel from '@/components/ui/Panel'
import Button from '@/components/ui/Button'
import Alert from '@/components/ui/Alert'
import SegmentedControl from '@/components/ui/SegmentedControl'
import MultiSelect from '@/components/ui/MultiSelect'
import Pagination from '@/components/ui/Pagination'
import { fieldClass, fieldLabelClass } from '@/components/ui/fieldStyles'
import { cn } from '@/components/ui/cn'

type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 50

const NUMERIC_COLS = new Set(['net_weight_kg', 'distance_km'])

const FAIL_REASON_LABELS: Record<string, string> = {
  no_store_location: 'No store location set',
  no_route: 'No road route found',
  http_error: 'Mapping service error',
  rate_limited: 'Rate limited',
  geocode_failed: 'Address could not be geocoded',
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
  'ibt_from',
  'ibt_to',
].join(',')

export default function DistancesClient() {
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
  const [failedByReason, setFailedByReason] = useState<{ reason: string | null; count: number }[]>([])
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

    // Breakdown of failures by reason, so it's clear what's actionable (e.g. a
    // missing store location) vs a dead end (no road route found / no address).
    if (failedCount) {
      const { data: reasonRows } = await applyFilters(
        supabase.from('deliveries').select('geocode_failed, distance_fail_reason')
          .or('distance_failed.eq.true,geocode_failed.eq.true')
      )
      const counts = new Map<string | null, number>()
      for (const r of (reasonRows as { geocode_failed: boolean; distance_fail_reason: string | null }[] | null) ?? []) {
        const reason = r.geocode_failed ? 'geocode_failed' : r.distance_fail_reason
        counts.set(reason, (counts.get(reason) ?? 0) + 1)
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
    'Net Weight (kg)', 'Distance (km)',
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
    { key: 'net_weight_kg', label: 'Net Weight (kg)', sortable: true },
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
          </span>
          {distanceFailedCount > 0 && (
            <Popover className="relative">
              <Popover.Button className="text-red-600 underline decoration-dotted underline-offset-2 hover:text-red-700">
                {distanceFailedCount} failed
              </Popover.Button>
              <Transition
                enter="transition ease-out duration-150"
                enterFrom="opacity-0 translate-y-1"
                enterTo="opacity-100 translate-y-0"
                leave="transition ease-in duration-100"
                leaveFrom="opacity-100 translate-y-0"
                leaveTo="opacity-0 translate-y-1"
              >
                <Popover.Panel className="absolute left-0 top-full z-10 mt-2 min-w-[240px] rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-popover">
                  {({ close }) => (
                    <>
                      <div className="mb-1.5 flex items-center justify-between font-medium text-slate-700">
                        <span>Failed distance reasons</span>
                        <button onClick={() => close()} className="text-slate-400 hover:text-slate-600">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <ul>
                        {failedByReason.map(({ reason, count }) => (
                          <li key={reason ?? 'unknown'} className="flex items-center justify-between gap-4 py-0.5 text-slate-600">
                            <span>{failReasonLabel(reason)}</span>
                            <span className="font-mono font-medium text-slate-900">{count}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </Popover.Panel>
              </Transition>
            </Popover>
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
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-medium text-slate-800">
                    {row.net_weight_kg != null ? `${row.net_weight_kg} kg` : '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-semibold text-slate-900">
                    {row.distance_km != null ? `${row.distance_km} km` : '—'}
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
