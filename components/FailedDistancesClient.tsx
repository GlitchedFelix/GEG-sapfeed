'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { parseStoreName } from '@/lib/store-utils'
import { failReasonLabel } from '@/lib/distance-fail-reasons'
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
  | 'geocode_failed'
  | 'distance_failed'
  | 'distance_fail_reason'
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
  'geocode_failed',
  'distance_failed',
  'distance_fail_reason',
].join(',')

function rowFailReason(row: Pick<Row, 'geocode_failed' | 'distance_fail_reason'>): string | null {
  return row.geocode_failed ? 'geocode_failed' : row.distance_fail_reason
}

export default function FailedDistancesClient() {
  const supabase = createClient()

  const [brand, setBrand] = useState<Brand | 'ALL'>('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [storeFilters, setStoreFilters] = useState<string[]>([])
  const [storeOptions, setStoreOptions] = useState<{ value: string; label: string }[]>([])
  const [sortKey, setSortKey] = useState('delivery_date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)

  const [rows, setRows] = useState<Row[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

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

  const applyFailedFilter = useCallback(
    (query: any) => query.is('distance_km', null).or('distance_failed.eq.true,geocode_failed.eq.true'),
    []
  )

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    let rowQuery = applyFailedFilter(
      applyFilters(supabase.from('deliveries').select(SELECT_FIELDS, { count: 'exact' }))
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
  }, [applyFilters, applyFailedFilter, sortKey, sortDir, page, supabase])

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
    'Date', 'Billing Document', 'Store Code', 'Store Name', 'Street', 'City', 'Country', 'Fail Reason',
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
        let q = applyFailedFilter(applyFilters(supabase.from('deliveries').select(SELECT_FIELDS)))
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
          failReasonLabel(rowFailReason(row)),
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
      a.download = `distances-failed-${today}.csv`
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
    { key: 'fail_reason', label: 'Fail Reason', sortable: false },
    { key: 'distance_km', label: 'Distance (km)', sortable: false },
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

        <span className="text-xs text-slate-500">
          <span className="font-semibold text-slate-900">{totalCount}</span> failed — enter a km value manually to resolve
        </span>

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
              {COLS.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500',
                    col.key === 'distance_km' ? 'text-right' : 'text-left'
                  )}
                >
                  <button
                    onClick={() => col.sortable && toggleSort(col.key)}
                    className={cn(
                      'inline-flex items-center gap-0.5',
                      col.sortable ? 'cursor-pointer hover:text-slate-900' : 'cursor-default'
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
                <td colSpan={COLS.length} className="px-3 py-10 text-center text-slate-400">Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={COLS.length} className="px-3 py-10 text-center text-slate-400">
                  No failed deliveries. Everything has a distance.
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
                  <td className="whitespace-nowrap px-3 py-1.5 text-red-600">
                    {failReasonLabel(rowFailReason(row))}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <EditableDistanceCell
                      rowHash={row.row_hash}
                      value={row.distance_km}
                      manual={row.distance_manual}
                      onSaved={() => {
                        // Once resolved, the row no longer matches this tab's failed
                        // filter — drop it locally instead of waiting for a refetch.
                        setRows((prev) => prev.filter((r) => r.row_hash !== row.row_hash))
                        setTotalCount((c) => Math.max(0, c - 1))
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
