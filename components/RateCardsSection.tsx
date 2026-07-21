'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { UploadCloud, X, CheckCircle2, Search, Eye, Copy, Trash2, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { parseRateCardGrid, parseItaltileStoreGrid, parseItaltileWebstoreList } from '@/lib/rate-card-file'
import type { RateCard, RateCardDistanceBand, RateCardWeightBand, RateCardCell, RateSystem } from '@/lib/types'
import Panel from '@/components/ui/Panel'
import Button from '@/components/ui/Button'
import SegmentedControl from '@/components/ui/SegmentedControl'
import { fieldClass, fieldLabelClass } from '@/components/ui/fieldStyles'
import { cn } from '@/components/ui/cn'

function numOrNull(s: string): number | null {
  if (s.trim() === '') return null
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

function distanceBandLabel(b: RateCardDistanceBand): string {
  return b.max_km == null ? `${b.min_km}+ km` : `${b.min_km}-${b.max_km - 1} km`
}

const SYSTEMS: { value: RateSystem; label: string }[] = [
  { value: 'CTM', label: 'CTM' },
  { value: 'ITALTILE_STORE', label: 'Italtile Stores' },
  { value: 'ITALTILE_WEBSTORE', label: 'Italtile Webstore' },
]

const ADD_MODES: { value: 'blank' | 'upload'; label: string }[] = [
  { value: 'blank', label: 'Blank card' },
  { value: 'upload', label: 'Upload spreadsheet' },
]

// Each brand/channel is its own independent rate card system — its own
// bands (columns/rows) and its own effective-dated cards. Only the payout
// amount in each cell, and the long-distance rate (CTM only), differ from
// one rate card to the next within a system.
export default function RateCardsSection() {
  const supabase = createClient()

  const [system, setSystem] = useState<RateSystem>('CTM')

  const [loadingBands, setLoadingBands] = useState(true)
  const [distanceBands, setDistanceBands] = useState<RateCardDistanceBand[]>([])
  const [weightBands, setWeightBands] = useState<RateCardWeightBand[]>([])

  const [rateCards, setRateCards] = useState<RateCard[]>([])
  const [loadingCards, setLoadingCards] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [search, setSearch] = useState('')

  const [showAddPanel, setShowAddPanel] = useState(false)
  const [addMode, setAddMode] = useState<'blank' | 'upload'>('blank')
  const [duplicateSourceId, setDuplicateSourceId] = useState<number | null>(null)

  const [newDate, setNewDate] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [creating, setCreating] = useState(false)

  const [loadingCells, setLoadingCells] = useState(false)
  const [cellsGrid, setCellsGrid] = useState<string[][]>([]) // [weightIdx][distanceIdx]
  const [longDistanceRate, setLongDistanceRate] = useState('26')

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [uploadDate, setUploadDate] = useState('')
  const [uploadLabel, setUploadLabel] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function loadBands() {
    setLoadingBands(true)
    const [distRes, weightRes] = await Promise.all([
      supabase.from('distance_bands').select('*').eq('system', system).order('position'),
      supabase.from('weight_bands').select('*').eq('system', system).order('position'),
    ])
    setDistanceBands((distRes.data as RateCardDistanceBand[]) || [])
    setWeightBands((weightRes.data as RateCardWeightBand[]) || [])
    setLoadingBands(false)
  }

  async function loadCards() {
    setLoadingCards(true)
    const { data } = await supabase
      .from('rate_cards')
      .select('*')
      .eq('system', system)
      .order('effective_date', { ascending: false })
    setRateCards((data as RateCard[]) || [])
    setLoadingCards(false)
  }

  useEffect(() => {
    setSelectedId(null)
    setCellsGrid([])
    setShowAddPanel(false)
    setSearch('')
    loadBands()
    loadCards()
  }, [system])

  function emptyGrid(): string[][] {
    return weightBands.map(() => distanceBands.map(() => ''))
  }

  async function selectCard(id: number) {
    setSelectedId(id)
    setSaveError(null)
    setSaved(false)
    setLoadingCells(true)

    const card = rateCards.find((c) => c.id === id)
    setLongDistanceRate(card ? String(card.long_distance_rate_zar_per_km) : '26')

    const { data } = await supabase.from('rate_card_cells').select('*').eq('rate_card_id', id)
    const cells = (data as RateCardCell[]) || []

    const grid = weightBands.map((wb) =>
      distanceBands.map((db) => {
        const cell = cells.find((c) => c.weight_band_id === wb.id && c.distance_band_id === db.id)
        return cell ? String(cell.amount_zar) : ''
      })
    )
    setCellsGrid(grid)
    setLoadingCells(false)
  }

  function openAddPanel() {
    setDuplicateSourceId(null)
    setAddMode('blank')
    setNewDate('')
    setNewLabel('')
    setShowAddPanel((v) => !v)
  }

  function startDuplicate(card: RateCard) {
    setDuplicateSourceId(card.id)
    setAddMode('blank')
    setNewDate('')
    setNewLabel(card.label ? `${card.label} copy` : '')
    setShowAddPanel(true)
  }

  async function createCard() {
    if (!newDate) return
    setCreating(true)
    const { data, error } = await supabase
      .from('rate_cards')
      .insert({ system, effective_date: newDate, label: newLabel || null })
      .select()
      .single()
    if (error || !data) {
      setCreating(false)
      return
    }
    const newCard = data as RateCard

    if (duplicateSourceId != null) {
      const { data: sourceCells } = await supabase
        .from('rate_card_cells')
        .select('*')
        .eq('rate_card_id', duplicateSourceId)
      const rows = ((sourceCells as RateCardCell[]) || []).map((c) => ({
        rate_card_id: newCard.id,
        weight_band_id: c.weight_band_id,
        distance_band_id: c.distance_band_id,
        amount_zar: c.amount_zar,
      }))
      if (rows.length > 0) {
        await supabase
          .from('rate_card_cells')
          .upsert(rows, { onConflict: 'rate_card_id,weight_band_id,distance_band_id' })
      }
      const sourceCard = rateCards.find((c) => c.id === duplicateSourceId)
      if (sourceCard) {
        await supabase
          .from('rate_cards')
          .update({ long_distance_rate_zar_per_km: sourceCard.long_distance_rate_zar_per_km })
          .eq('id', newCard.id)
      }
    }

    setCreating(false)
    setNewDate('')
    setNewLabel('')
    setDuplicateSourceId(null)
    setShowAddPanel(false)
    await loadCards()
    await selectCard(newCard.id)
  }

  async function deleteCard(id: number) {
    if (!window.confirm('Delete this rate card? This cannot be undone.')) return
    await supabase.from('rate_cards').delete().eq('id', id)
    if (selectedId === id) {
      setSelectedId(null)
      setCellsGrid([])
    }
    loadCards()
  }

  function updateCell(weightIdx: number, distanceIdx: number, value: string) {
    setCellsGrid((prev) =>
      prev.map((row, i) => (i === weightIdx ? row.map((v, j) => (j === distanceIdx ? value : v)) : row))
    )
    setSaved(false)
  }

  async function saveAmounts() {
    if (selectedId == null) return
    setSaving(true)
    setSaveError(null)
    try {
      const cellRows = []
      for (let wi = 0; wi < weightBands.length; wi++) {
        for (let di = 0; di < distanceBands.length; di++) {
          const raw = cellsGrid[wi]?.[di] ?? ''
          const amount = numOrNull(raw)
          if (amount == null) continue
          cellRows.push({
            rate_card_id: selectedId,
            weight_band_id: weightBands[wi].id,
            distance_band_id: distanceBands[di].id,
            amount_zar: amount,
          })
        }
      }
      if (cellRows.length > 0) {
        const { error } = await supabase
          .from('rate_card_cells')
          .upsert(cellRows, { onConflict: 'rate_card_id,weight_band_id,distance_band_id' })
        if (error) throw error
      }

      const rate = numOrNull(longDistanceRate) ?? 26
      const { error: cardError } = await supabase
        .from('rate_cards')
        .update({ long_distance_rate_zar_per_km: rate })
        .eq('id', selectedId)
      if (cardError) throw cardError

      await loadCards()
      setSaved(true)
    } catch (err: any) {
      setSaveError(err?.message ?? 'Failed to save rate card')
    } finally {
      setSaving(false)
    }
  }

  // Drop a spreadsheet shaped like the reference rate card in and it either
  // updates the rate card for uploadDate (if one already exists) or creates
  // a new one, then fills in all cell amounts from the file.
  async function handleUpload(file: File) {
    if (!uploadDate) {
      setUploadError('Pick an effective date for this upload first.')
      return
    }
    setUploading(true)
    setUploadError(null)
    setUploadSuccess(null)
    try {
      type CellRow = { rate_card_id: number; weight_band_id: number; distance_band_id: number; amount_zar: number }
      let buildCellRows: (cardId: number) => CellRow[]

      if (system === 'CTM') {
        const grid = await parseRateCardGrid(file, distanceBands.length, weightBands.length)
        buildCellRows = (cardId) => {
          const rows: CellRow[] = []
          for (let wi = 0; wi < weightBands.length; wi++) {
            for (let di = 0; di < distanceBands.length; di++) {
              const amount = grid[wi]?.[di]
              if (amount == null) continue
              rows.push({ rate_card_id: cardId, weight_band_id: weightBands[wi].id, distance_band_id: distanceBands[di].id, amount_zar: amount })
            }
          }
          return rows
        }
      } else if (system === 'ITALTILE_STORE') {
        const grid = await parseItaltileStoreGrid(file, distanceBands.length, weightBands.length)
        buildCellRows = (cardId) => {
          const rows: CellRow[] = []
          for (let di = 0; di < distanceBands.length; di++) {
            for (let wi = 0; wi < weightBands.length; wi++) {
              const amount = grid[di]?.[wi]
              if (amount == null) continue
              rows.push({ rate_card_id: cardId, weight_band_id: weightBands[wi].id, distance_band_id: distanceBands[di].id, amount_zar: amount })
            }
          }
          return rows
        }
      } else {
        const entries = await parseItaltileWebstoreList(file, distanceBands, weightBands)
        buildCellRows = (cardId) =>
          entries.map((e) => ({ rate_card_id: cardId, weight_band_id: e.weightBandId, distance_band_id: e.distanceBandId, amount_zar: e.amount }))
      }

      const existing = rateCards.find((c) => c.effective_date === uploadDate)
      let cardId: number
      let isNew = false
      if (existing) {
        cardId = existing.id
        if (uploadLabel) {
          const { error } = await supabase.from('rate_cards').update({ label: uploadLabel }).eq('id', existing.id)
          if (error) throw error
        }
      } else {
        const { data, error } = await supabase
          .from('rate_cards')
          .insert({ system, effective_date: uploadDate, label: uploadLabel || null })
          .select()
          .single()
        if (error || !data) throw error ?? new Error('Failed to create rate card')
        cardId = (data as RateCard).id
        isNew = true
      }

      const cellRows = buildCellRows(cardId)
      if (cellRows.length > 0) {
        const { error } = await supabase
          .from('rate_card_cells')
          .upsert(cellRows, { onConflict: 'rate_card_id,weight_band_id,distance_band_id' })
        if (error) throw error
      }

      await loadCards()
      await selectCard(cardId)
      setUploadSuccess(`${isNew ? 'Created' : 'Updated'} the ${uploadDate} rate card with ${cellRows.length} amounts.`)
      setUploadDate('')
      setUploadLabel('')
      setShowAddPanel(false)
    } catch (err: any) {
      setUploadError(err?.message ?? 'Failed to parse or upload the file')
    } finally {
      setUploading(false)
    }
  }

  const filteredCards = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rateCards
    return rateCards.filter(
      (c) => c.effective_date.toLowerCase().includes(q) || (c.label ?? '').toLowerCase().includes(q)
    )
  }, [rateCards, search])

  const selectedCard = rateCards.find((c) => c.id === selectedId) ?? null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl options={SYSTEMS} value={system} onChange={setSystem} />
        <Button variant="primary" onClick={openAddPanel}>
          <Plus className="h-3.5 w-3.5" />
          Add Rate Card
        </Button>
      </div>

      {showAddPanel && (
        <Panel>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <SegmentedControl options={ADD_MODES} value={addMode} onChange={setAddMode} />
            <button
              onClick={() => setShowAddPanel(false)}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {addMode === 'blank' ? (
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className={fieldLabelClass}>Effective date</label>
                <input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className={fieldClass}
                />
              </div>
              <div>
                <label className={fieldLabelClass}>Label (optional)</label>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="e.g. 2026 rates"
                  className={fieldClass}
                />
              </div>
              <Button variant="primary" onClick={createCard} disabled={!newDate || creating}>
                {creating ? 'Creating…' : duplicateSourceId != null ? 'Duplicate' : 'Create'}
              </Button>
              {duplicateSourceId != null && (
                <span className="text-xs text-slate-400">Copying amounts from the selected rate card.</span>
              )}
            </div>
          ) : (
            <div>
              <p className="mb-3 text-xs text-slate-500">
                {system === 'CTM' &&
                  'Upload a spreadsheet in the same layout as the reference rate card (distance bands across the top, weight bands down the side) — it updates the rate card for the date below if one already exists, or creates a new one.'}
                {system === 'ITALTILE_STORE' &&
                  'Upload a spreadsheet in the Italtile store rate card layout (distance bands down the side, weight bands across the top) — it updates the rate card for the date below if one already exists, or creates a new one.'}
                {system === 'ITALTILE_WEBSTORE' &&
                  'Upload a spreadsheet in the Italtile webstore rate card layout (distance_from/distance_to/weight_from/weight_to/rate/additional_cost columns) — it updates the rate card for the date below if one already exists, or creates a new one.'}
              </p>
              <div className="mb-3 flex flex-wrap items-end gap-2">
                <div>
                  <label className={fieldLabelClass}>Effective date</label>
                  <input
                    type="date"
                    value={uploadDate}
                    onChange={(e) => setUploadDate(e.target.value)}
                    className={fieldClass}
                  />
                </div>
                <div>
                  <label className={fieldLabelClass}>Label (optional)</label>
                  <input
                    type="text"
                    value={uploadLabel}
                    onChange={(e) => setUploadLabel(e.target.value)}
                    placeholder="e.g. 2026 rates"
                    className={fieldClass}
                  />
                </div>
              </div>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragActive(false)
                  const file = e.dataTransfer.files?.[0]
                  if (file) handleUpload(file)
                }}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-3 py-6 text-center text-xs transition-colors',
                  dragActive ? 'border-accent-500 bg-accent-50 text-accent-700' : 'border-slate-300 text-slate-400 hover:border-slate-400 hover:bg-slate-50'
                )}
              >
                <UploadCloud className="h-5 w-5" />
                {uploading ? 'Uploading…' : 'Drop a .xlsx/.csv rate card here, or click to browse'}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleUpload(file)
                    e.target.value = ''
                  }}
                />
              </div>
              {uploadSuccess && (
                <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {uploadSuccess}
                </p>
              )}
              {uploadError && <p className="mt-2 text-xs text-red-500">{uploadError}</p>}
            </div>
          )}
        </Panel>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Left: saved rate card list */}
        <div className="flex w-full shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-card lg:w-72">
          <div className="border-b border-slate-200 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search rate cards…"
                className="w-full rounded-md border border-slate-300 bg-white py-1.5 pl-7 pr-2 text-xs shadow-sm transition-colors focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20"
              />
            </div>
          </div>
          <div className="max-h-[520px] overflow-y-auto scrollbar-thin">
            {loadingCards ? (
              <p className="p-3 text-xs text-slate-400">Loading rate cards…</p>
            ) : filteredCards.length === 0 ? (
              <p className="p-3 text-xs text-slate-400">
                {rateCards.length === 0 ? 'No rate cards yet.' : 'No rate cards match your search.'}
              </p>
            ) : (
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50/95 backdrop-blur">
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Effective date</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">Label</th>
                    <th className="w-20 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {filteredCards.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => selectCard(c.id)}
                      className={cn(
                        'cursor-pointer border-t border-slate-100 transition-colors hover:bg-slate-50',
                        selectedId === c.id && 'bg-accent-50/70'
                      )}
                    >
                      <td className="px-3 py-2 font-mono text-slate-700">{c.effective_date}</td>
                      <td className="px-3 py-2 text-slate-600">{c.label || '—'}</td>
                      <td className="px-1 py-2">
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            title="View"
                            onClick={(e) => { e.stopPropagation(); selectCard(c.id) }}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-accent-600"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button
                            title="Duplicate"
                            onClick={(e) => { e.stopPropagation(); startDuplicate(c) }}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-accent-600"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button
                            title="Delete"
                            onClick={(e) => { e.stopPropagation(); deleteCard(c.id) }}
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right: selected rate card detail */}
        <div className="min-w-0 flex-1">
          {selectedCard == null ? (
            <Panel className="flex min-h-[280px] items-center justify-center text-center text-xs text-slate-400">
              Select or create a rate card to view its details.
            </Panel>
          ) : loadingBands ? (
            <Panel className="flex min-h-[280px] items-center justify-center text-xs text-slate-400">
              Loading grid…
            </Panel>
          ) : (
            <Panel>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    {selectedCard.label || selectedCard.effective_date}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-400">{selectedCard.effective_date}</p>
                </div>
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-500">
                  #{selectedCard.id}
                </span>
              </div>

              {system === 'CTM' && (
                <div className="mb-3 flex items-center gap-2">
                  <label className="text-xs text-slate-500">Long-distance rate (R/km, beyond last band)</label>
                  <input
                    type="text"
                    value={longDistanceRate}
                    onChange={(e) => { setLongDistanceRate(e.target.value); setSaved(false) }}
                    disabled={loadingCells}
                    className={cn('w-20 text-right font-mono', fieldClass, 'disabled:bg-slate-50')}
                  />
                </div>
              )}

              <div className="overflow-x-auto rounded-lg border border-slate-200 scrollbar-thin">
                <table className="border-collapse text-xs">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-[1] w-40 bg-slate-50/80 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Weight \ Distance
                      </th>
                      {distanceBands.map((b) => (
                        <th key={b.id} className="min-w-[80px] bg-slate-50/80 px-1 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {distanceBandLabel(b)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {weightBands.map((wb, wi) => (
                      <tr key={wb.id} className={cn('border-t border-slate-100', wi % 2 === 1 && 'bg-slate-50/40')}>
                        <td className="sticky left-0 z-[1] border-r border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700">
                          {wb.label}
                          {wb.mode === 'per_ton' && (
                            <span className="ml-1 text-[10px] font-normal text-slate-400">R/ton</span>
                          )}
                          {wb.mode === 'over_1000_surcharge' && (
                            <span className="ml-1 text-[10px] font-normal text-slate-400">R/kg over 1 ton</span>
                          )}
                          {wb.is_ibt && (
                            <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-normal text-amber-700">IBT</span>
                          )}
                        </td>
                        {distanceBands.map((db, di) => (
                          <td key={db.id} className="px-1 py-1 text-center">
                            <input
                              type="text"
                              value={cellsGrid[wi]?.[di] ?? ''}
                              onChange={(e) => updateCell(wi, di, e.target.value)}
                              placeholder="R"
                              disabled={loadingCells}
                              className="w-16 rounded border border-slate-200 bg-white px-1 py-1 text-right font-mono text-xs transition-colors focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500/30 disabled:bg-slate-50"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4">
                <Button
                  variant="primary"
                  size="md"
                  onClick={saveAmounts}
                  disabled={saving || loadingCells}
                  className="w-full justify-center"
                >
                  {saving ? 'Saving…' : 'Save rate card'}
                </Button>
                <div className="mt-2 flex items-center justify-center gap-2">
                  {saved && !saving && (
                    <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Saved
                    </span>
                  )}
                  {saveError && <span className="text-xs text-red-500">{saveError}</span>}
                </div>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}
