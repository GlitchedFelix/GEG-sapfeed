'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'
import type { RateCard, RateCardDistanceBand, RateCardWeightBand, RateCardCell } from '@/lib/types'

interface EditableDistanceBand {
  id: number | null
  position: number
  min_km: string
  max_km: string
}

interface EditableWeightBand {
  id: number | null
  position: number
  label: string
  min_kg: string
  max_kg: string
  mode: 'flat' | 'per_ton'
  is_ibt: boolean
}

function numOrNull(s: string): number | null {
  if (s.trim() === '') return null
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

// Distance and weight bands are global — every rate card shares the same
// grid structure (same columns, same rows). Only the payout amount in each
// cell, and the long-distance rate, differ from one rate card to the next.
export default function RateCardsSection() {
  const supabase = createClient()

  const [loadingBands, setLoadingBands] = useState(true)
  const [distanceBands, setDistanceBands] = useState<EditableDistanceBand[]>([])
  const [weightBands, setWeightBands] = useState<EditableWeightBand[]>([])
  const [structureSaving, setStructureSaving] = useState(false)
  const [structureError, setStructureError] = useState<string | null>(null)
  const [structureSaved, setStructureSaved] = useState(false)

  const [rateCards, setRateCards] = useState<RateCard[]>([])
  const [loadingCards, setLoadingCards] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const [newDate, setNewDate] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [creating, setCreating] = useState(false)

  const [loadingCells, setLoadingCells] = useState(false)
  const [cellsGrid, setCellsGrid] = useState<string[][]>([]) // [weightIdx][distanceIdx]
  const [longDistanceRate, setLongDistanceRate] = useState('26')

  const [amountsSaving, setAmountsSaving] = useState(false)
  const [amountsError, setAmountsError] = useState<string | null>(null)
  const [amountsSaved, setAmountsSaved] = useState(false)

  async function loadBands() {
    setLoadingBands(true)
    const [distRes, weightRes] = await Promise.all([
      supabase.from('distance_bands').select('*').order('position'),
      supabase.from('weight_bands').select('*').order('position'),
    ])
    setDistanceBands(
      ((distRes.data as RateCardDistanceBand[]) || []).map((b) => ({
        id: b.id,
        position: b.position,
        min_km: String(b.min_km),
        max_km: b.max_km == null ? '' : String(b.max_km),
      }))
    )
    setWeightBands(
      ((weightRes.data as RateCardWeightBand[]) || []).map((b) => ({
        id: b.id,
        position: b.position,
        label: b.label,
        min_kg: String(b.min_kg),
        max_kg: b.max_kg == null ? '' : String(b.max_kg),
        mode: b.mode,
        is_ibt: b.is_ibt,
      }))
    )
    setLoadingBands(false)
  }

  async function loadCards() {
    setLoadingCards(true)
    const { data } = await supabase.from('rate_cards').select('*').order('effective_date', { ascending: false })
    setRateCards((data as RateCard[]) || [])
    setLoadingCards(false)
  }

  useEffect(() => {
    loadBands()
    loadCards()
  }, [])

  function emptyGrid(): string[][] {
    return weightBands.map(() => distanceBands.map(() => ''))
  }

  async function selectCard(id: number) {
    setSelectedId(id)
    setAmountsError(null)
    setAmountsSaved(false)
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
      .insert({ effective_date: newDate, label: newLabel || null })
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

  function addDistanceBand() {
    setDistanceBands((prev) => [...prev, { id: null, position: prev.length, min_km: '', max_km: '' }])
    setCellsGrid((prev) => prev.map((row) => [...row, '']))
    setStructureSaved(false)
  }

  async function removeDistanceBand(idx: number) {
    const band = distanceBands[idx]
    setDistanceBands((prev) => prev.filter((_, i) => i !== idx))
    setCellsGrid((prev) => prev.map((row) => row.filter((_, i) => i !== idx)))
    if (band.id != null) await supabase.from('distance_bands').delete().eq('id', band.id)
    setStructureSaved(false)
  }

  function addWeightBand() {
    setWeightBands((prev) => [
      ...prev,
      { id: null, position: prev.length, label: '', min_kg: '', max_kg: '', mode: 'flat', is_ibt: false },
    ])
    setCellsGrid((prev) => [...prev, distanceBands.map(() => '')])
    setStructureSaved(false)
  }

  async function removeWeightBand(idx: number) {
    const band = weightBands[idx]
    setWeightBands((prev) => prev.filter((_, i) => i !== idx))
    setCellsGrid((prev) => prev.filter((_, i) => i !== idx))
    if (band.id != null) await supabase.from('weight_bands').delete().eq('id', band.id)
    setStructureSaved(false)
  }

  function updateDistanceBand(idx: number, field: 'min_km' | 'max_km', value: string) {
    setDistanceBands((prev) => prev.map((b, i) => (i === idx ? { ...b, [field]: value } : b)))
    setStructureSaved(false)
  }

  function updateWeightBand(idx: number, field: keyof EditableWeightBand, value: string | boolean) {
    setWeightBands((prev) => prev.map((b, i) => (i === idx ? { ...b, [field]: value } : b)))
    setStructureSaved(false)
  }

  function updateCell(weightIdx: number, distanceIdx: number, value: string) {
    setCellsGrid((prev) =>
      prev.map((row, i) => (i === weightIdx ? row.map((v, j) => (j === distanceIdx ? value : v)) : row))
    )
    setAmountsSaved(false)
  }

  // Persists the shared grid structure (columns/rows). Affects every rate card.
  async function saveStructure() {
    setStructureSaving(true)
    setStructureError(null)
    try {
      for (let i = 0; i < distanceBands.length; i++) {
        const b = distanceBands[i]
        const payload = { position: i, min_km: numOrNull(b.min_km) ?? 0, max_km: numOrNull(b.max_km) }
        if (b.id == null) {
          const { data, error } = await supabase.from('distance_bands').insert(payload).select().single()
          if (error) throw error
          setDistanceBands((prev) => prev.map((x, j) => (j === i ? { ...x, id: (data as RateCardDistanceBand).id } : x)))
        } else {
          const { error } = await supabase.from('distance_bands').update(payload).eq('id', b.id)
          if (error) throw error
        }
      }

      for (let i = 0; i < weightBands.length; i++) {
        const b = weightBands[i]
        const payload = {
          position: i,
          label: b.label || `Band ${i + 1}`,
          min_kg: numOrNull(b.min_kg) ?? 0,
          max_kg: numOrNull(b.max_kg),
          mode: b.mode,
          is_ibt: b.is_ibt,
        }
        if (b.id == null) {
          const { data, error } = await supabase.from('weight_bands').insert(payload).select().single()
          if (error) throw error
          setWeightBands((prev) => prev.map((x, j) => (j === i ? { ...x, id: (data as RateCardWeightBand).id } : x)))
        } else {
          const { error } = await supabase.from('weight_bands').update(payload).eq('id', b.id)
          if (error) throw error
        }
      }

      setStructureSaved(true)
      if (selectedId != null) await selectCard(selectedId)
    } catch (err: any) {
      setStructureError(err?.message ?? 'Failed to save grid structure')
    } finally {
      setStructureSaving(false)
    }
  }

  // Persists this rate card's payout amounts + long-distance rate.
  async function saveAmounts() {
    if (selectedId == null) return
    if (distanceBands.some((b) => b.id == null) || weightBands.some((b) => b.id == null)) {
      setAmountsError('Save the grid structure first (unsaved bands present).')
      return
    }
    setAmountsSaving(true)
    setAmountsError(null)
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
      setAmountsSaved(true)
    } catch (err: any) {
      setAmountsError(err?.message ?? 'Failed to save rate card')
    } finally {
      setAmountsSaving(false)
    }
  }

  return (
    <>
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

      {loadingBands ? (
        <p className="text-xs text-slate-400">Loading grid…</p>
      ) : (
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <p className="mb-3 text-xs text-slate-500">
            The grid below (columns and rows) is <span className="font-medium">shared by every rate card</span> —
            editing it here changes the structure for all of them. Only the R amounts in each cell, and the
            long-distance rate, are specific to the selected rate card.
          </p>

          <div className="mb-3 flex items-center gap-2">
            <label className="text-xs text-slate-500">Long-distance rate (R/km, beyond last band)</label>
            <input
              type="text"
              value={longDistanceRate}
              onChange={(e) => { setLongDistanceRate(e.target.value); setAmountsSaved(false) }}
              disabled={selectedId == null}
              className="w-20 rounded border border-slate-300 px-1.5 py-0.5 font-mono text-xs disabled:bg-slate-50"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="text-xs border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-white px-2 py-1 text-left font-medium text-slate-600 w-56">
                    Weight \ Distance
                  </th>
                  {distanceBands.map((b, di) => (
                    <th key={di} className="px-1 py-1 text-center font-medium text-slate-600 min-w-[90px]">
                      <div className="flex items-center justify-center gap-0.5">
                        <input
                          type="text"
                          value={b.min_km}
                          onChange={(e) => updateDistanceBand(di, 'min_km', e.target.value)}
                          placeholder="min"
                          className="w-10 rounded border border-slate-300 px-1 py-0.5 font-mono"
                        />
                        <span>-</span>
                        <input
                          type="text"
                          value={b.max_km}
                          onChange={(e) => updateDistanceBand(di, 'max_km', e.target.value)}
                          placeholder="∞"
                          className="w-10 rounded border border-slate-300 px-1 py-0.5 font-mono"
                        />
                        <button onClick={() => removeDistanceBand(di)} className="text-slate-400 hover:text-red-500">×</button>
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-400">km</div>
                    </th>
                  ))}
                  <th className="px-2 py-1">
                    <button onClick={addDistanceBand} className="rounded border border-slate-300 px-1.5 py-0.5 text-slate-500 hover:bg-slate-50">
                      + km band
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {weightBands.map((wb, wi) => (
                  <tr key={wi} className="border-t border-slate-100">
                    <td className="sticky left-0 bg-white px-2 py-1">
                      <div className="flex flex-wrap items-center gap-1">
                        <input
                          type="text"
                          value={wb.label}
                          onChange={(e) => updateWeightBand(wi, 'label', e.target.value)}
                          placeholder="Label"
                          className="w-24 rounded border border-slate-300 px-1 py-0.5"
                        />
                        <input
                          type="text"
                          value={wb.min_kg}
                          onChange={(e) => updateWeightBand(wi, 'min_kg', e.target.value)}
                          placeholder="min"
                          className="w-10 rounded border border-slate-300 px-1 py-0.5 font-mono"
                        />
                        <span>-</span>
                        <input
                          type="text"
                          value={wb.max_kg}
                          onChange={(e) => updateWeightBand(wi, 'max_kg', e.target.value)}
                          placeholder="∞"
                          className="w-10 rounded border border-slate-300 px-1 py-0.5 font-mono"
                        />
                        <span className="text-[10px] text-slate-400">kg</span>
                        <select
                          value={wb.mode}
                          onChange={(e) => updateWeightBand(wi, 'mode', e.target.value as 'flat' | 'per_ton')}
                          className="rounded border border-slate-300 px-1 py-0.5"
                        >
                          <option value="flat">flat</option>
                          <option value="per_ton">per ton</option>
                        </select>
                        <label className="flex items-center gap-0.5 text-[10px] text-slate-500">
                          <input
                            type="checkbox"
                            checked={wb.is_ibt}
                            onChange={(e) => updateWeightBand(wi, 'is_ibt', e.target.checked)}
                          />
                          IBT
                        </label>
                        <button onClick={() => removeWeightBand(wi)} className="text-slate-400 hover:text-red-500">×</button>
                      </div>
                    </td>
                    {distanceBands.map((_, di) => (
                      <td key={di} className="px-1 py-1 text-center">
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
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={addWeightBand}
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
            >
              + weight band
            </button>
            <button
              onClick={saveStructure}
              disabled={structureSaving}
              className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              {structureSaving ? 'Saving…' : 'Save grid structure'}
            </button>
            {structureSaved && !structureSaving && <span className="text-xs font-medium text-emerald-600">✓ Structure saved</span>}
            {structureError && <span className="text-xs text-red-500">{structureError}</span>}

            <span className="mx-1 h-4 w-px bg-slate-200" />

            <button
              onClick={saveAmounts}
              disabled={amountsSaving || selectedId == null}
              className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40"
            >
              {amountsSaving ? 'Saving…' : 'Save rate card amounts'}
            </button>
            {amountsSaved && !amountsSaving && <span className="text-xs font-medium text-emerald-600">✓ Amounts saved</span>}
            {amountsError && <span className="text-xs text-red-500">{amountsError}</span>}
            {selectedId == null && <span className="text-xs text-slate-400">Select or create a rate card to enter amounts.</span>}
          </div>
        </div>
      )}
    </>
  )
}
