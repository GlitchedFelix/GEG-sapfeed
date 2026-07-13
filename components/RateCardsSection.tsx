'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { parseRateCardGrid, parseItaltileStoreGrid, parseItaltileWebstoreList } from '@/lib/rate-card-file'
import type { RateCard, RateCardDistanceBand, RateCardWeightBand, RateCardCell, RateSystem } from '@/lib/types'

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

  async function createCard() {
    if (!newDate) return
    setCreating(true)
    const { data, error } = await supabase
      .from('rate_cards')
      .insert({ system, effective_date: newDate, label: newLabel || null })
      .select()
      .single()
    setCreating(false)
    if (error || !data) return
    setNewDate('')
    setNewLabel('')
    await loadCards()
    setCellsGrid(emptyGrid())
    setLongDistanceRate('26')
    setSelectedId((data as RateCard).id)
  }

  async function deleteCard(id: number) {
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
    } catch (err: any) {
      setUploadError(err?.message ?? 'Failed to parse or upload the file')
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <div className="mb-3 flex gap-1">
        {SYSTEMS.map((s) => (
          <button
            key={s.value}
            onClick={() => setSystem(s.value)}
            className={`rounded px-2 py-1 text-xs font-medium ${
              system === s.value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1">
        {loadingCards ? (
          <span className="text-xs text-slate-400">Loading rate cards…</span>
        ) : (
          rateCards.map((c) => (
            <div key={c.id} className="flex items-center">
              <button
                onClick={() => selectCard(c.id)}
                className={`rounded-l px-2 py-1 text-xs font-medium ${
                  selectedId === c.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {c.effective_date}{c.label ? ` — ${c.label}` : ''}
              </button>
              <button
                onClick={() => deleteCard(c.id)}
                title="Delete rate card"
                className={`rounded-r px-1.5 py-1 text-xs ${
                  selectedId === c.id ? 'bg-slate-900 text-slate-300 hover:text-red-400' : 'bg-slate-100 text-slate-400 hover:text-red-500'
                }`}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      <div className="mb-4 flex items-end gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
        <div>
          <label className="mb-0.5 block text-xs text-slate-400">Effective date</label>
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="rounded border border-slate-300 px-1.5 py-1 text-xs"
          />
        </div>
        <div>
          <label className="mb-0.5 block text-xs text-slate-400">Label (optional)</label>
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="e.g. 2026 rates"
            className="rounded border border-slate-300 px-1.5 py-1 text-xs"
          />
        </div>
        <button
          onClick={createCard}
          disabled={!newDate || creating}
          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          {creating ? 'Creating…' : '+ New rate card'}
        </button>
      </div>

      <div className="mb-4 rounded-md border border-slate-200 bg-white px-3 py-2">
        <p className="mb-2 text-xs text-slate-500">
          {system === 'CTM' &&
            'Or upload a spreadsheet in the same layout as the reference rate card (distance bands across the top, weight bands down the side) — it updates the rate card for the date below if one already exists, or creates a new one.'}
          {system === 'ITALTILE_STORE' &&
            'Or upload a spreadsheet in the Italtile store rate card layout (distance bands down the side, weight bands across the top) — it updates the rate card for the date below if one already exists, or creates a new one.'}
          {system === 'ITALTILE_WEBSTORE' &&
            'Or upload a spreadsheet in the Italtile webstore rate card layout (distance_from/distance_to/weight_from/weight_to/rate/additional_cost columns) — it updates the rate card for the date below if one already exists, or creates a new one.'}
        </p>
        <div className="mb-2 flex items-end gap-2">
          <div>
            <label className="mb-0.5 block text-xs text-slate-400">Effective date</label>
            <input
              type="date"
              value={uploadDate}
              onChange={(e) => setUploadDate(e.target.value)}
              className="rounded border border-slate-300 px-1.5 py-1 text-xs"
            />
          </div>
          <div>
            <label className="mb-0.5 block text-xs text-slate-400">Label (optional)</label>
            <input
              type="text"
              value={uploadLabel}
              onChange={(e) => setUploadLabel(e.target.value)}
              placeholder="e.g. 2026 rates"
              className="rounded border border-slate-300 px-1.5 py-1 text-xs"
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
          className={`flex cursor-pointer items-center justify-center rounded-md border-2 border-dashed px-3 py-4 text-xs ${
            dragActive ? 'border-slate-500 bg-slate-50 text-slate-600' : 'border-slate-300 text-slate-400 hover:bg-slate-50'
          }`}
        >
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
        {uploadSuccess && <p className="mt-2 text-xs font-medium text-emerald-600">✓ {uploadSuccess}</p>}
        {uploadError && <p className="mt-2 text-xs text-red-500">{uploadError}</p>}
      </div>

      {loadingBands ? (
        <p className="text-xs text-slate-400">Loading grid…</p>
      ) : (
        <div className="rounded-md border border-slate-200 bg-white p-3">
          {system === 'CTM' && (
            <div className="mb-3 flex items-center gap-2">
              <label className="text-xs text-slate-500">Long-distance rate (R/km, beyond last band)</label>
              <input
                type="text"
                value={longDistanceRate}
                onChange={(e) => { setLongDistanceRate(e.target.value); setSaved(false) }}
                disabled={selectedId == null}
                className="w-20 rounded border border-slate-300 px-1.5 py-0.5 font-mono text-xs disabled:bg-slate-50"
              />
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="text-xs border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-white px-2 py-1 text-left font-medium text-slate-600 w-40">
                    Weight \ Distance
                  </th>
                  {distanceBands.map((b) => (
                    <th key={b.id} className="px-1 py-1 text-center font-medium text-slate-600 min-w-[80px]">
                      {distanceBandLabel(b)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weightBands.map((wb, wi) => (
                  <tr key={wb.id} className="border-t border-slate-100">
                    <td className="sticky left-0 bg-white px-2 py-1 font-medium text-slate-700">
                      {wb.label}
                      {wb.mode === 'per_ton' && (
                        <span className="ml-1 text-[10px] font-normal text-slate-400">R/ton</span>
                      )}
                      {wb.mode === 'over_1000_surcharge' && (
                        <span className="ml-1 text-[10px] font-normal text-slate-400">R/kg over 1 ton</span>
                      )}
                      {wb.is_ibt && (
                        <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-normal text-amber-700">IBT</span>
                      )}
                    </td>
                    {distanceBands.map((db, di) => (
                      <td key={db.id} className="px-1 py-1 text-center">
                        <input
                          type="text"
                          value={cellsGrid[wi]?.[di] ?? ''}
                          onChange={(e) => updateCell(wi, di, e.target.value)}
                          placeholder="R"
                          disabled={selectedId == null || loadingCells}
                          className="w-16 rounded border border-slate-300 px-1 py-0.5 text-center font-mono disabled:bg-slate-50"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={saveAmounts}
              disabled={saving || selectedId == null}
              className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save rate card'}
            </button>
            {saved && !saving && <span className="text-xs font-medium text-emerald-600">✓ Saved</span>}
            {saveError && <span className="text-xs text-red-500">{saveError}</span>}
            {selectedId == null && <span className="text-xs text-slate-400">Select or create a rate card to enter amounts.</span>}
          </div>
        </div>
      )}
    </>
  )
}
