'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'
import type { RateCard, RateCardDistanceBand, RateCardWeightBand, RateCardCell } from '@/lib/types'

function numOrNull(s: string): number | null {
  if (s.trim() === '') return null
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

function distanceBandLabel(b: RateCardDistanceBand): string {
  return b.max_km == null ? `${b.min_km}+ km` : `${b.min_km}-${b.max_km - 1} km`
}

// Distance and weight bands are fixed permanently — every rate card shares
// the exact same columns/rows. Only the payout amount in each cell, and
// the long-distance rate, differ from one rate card to the next.
export default function RateCardsSection() {
  const supabase = createClient()

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

  async function loadBands() {
    setLoadingBands(true)
    const [distRes, weightRes] = await Promise.all([
      supabase.from('distance_bands').select('*').order('position'),
      supabase.from('weight_bands').select('*').order('position'),
    ])
    setDistanceBands((distRes.data as RateCardDistanceBand[]) || [])
    setWeightBands((weightRes.data as RateCardWeightBand[]) || [])
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
