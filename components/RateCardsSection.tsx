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

export default function RateCardsSection() {
  const supabase = createClient()

  const [rateCards, setRateCards] = useState<RateCard[]>([])
  const [loadingCards, setLoadingCards] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const [newDate, setNewDate] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [creating, setCreating] = useState(false)

  const [loadingGrid, setLoadingGrid] = useState(false)
  const [distanceBands, setDistanceBands] = useState<EditableDistanceBand[]>([])
  const [weightBands, setWeightBands] = useState<EditableWeightBand[]>([])
  const [cellsGrid, setCellsGrid] = useState<string[][]>([]) // [weightIdx][distanceIdx]
  const [longDistanceRate, setLongDistanceRate] = useState('26')

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function loadCards() {
    setLoadingCards(true)
    const { data } = await supabase.from('rate_cards').select('*').order('effective_date', { ascending: false })
    setRateCards((data as RateCard[]) || [])
    setLoadingCards(false)
  }

  useEffect(() => {
    loadCards()
  }, [])

  async function selectCard(id: number) {
    setSelectedId(id)
    setSaveError(null)
    setSaved(false)
    setLoadingGrid(true)

    const card = rateCards.find((c) => c.id === id)
    setLongDistanceRate(card ? String(card.long_distance_rate_zar_per_km) : '26')

    const [distRes, weightRes, cellsRes] = await Promise.all([
      supabase.from('rate_card_distance_bands').select('*').eq('rate_card_id', id).order('position'),
      supabase.from('rate_card_weight_bands').select('*').eq('rate_card_id', id).order('position'),
      supabase.from('rate_card_cells').select('*').eq('rate_card_id', id),
    ])

    const dBands = ((distRes.data as RateCardDistanceBand[]) || []).map((b) => ({
      id: b.id,
      position: b.position,
      min_km: String(b.min_km),
      max_km: b.max_km == null ? '' : String(b.max_km),
    }))
    const wBands = ((weightRes.data as RateCardWeightBand[]) || []).map((b) => ({
      id: b.id,
      position: b.position,
      label: b.label,
      min_kg: String(b.min_kg),
      max_kg: b.max_kg == null ? '' : String(b.max_kg),
      mode: b.mode,
      is_ibt: b.is_ibt,
    }))
    const cells = (cellsRes.data as RateCardCell[]) || []

    const grid = wBands.map((wb) =>
      dBands.map((db) => {
        const cell = cells.find((c) => c.weight_band_id === wb.id && c.distance_band_id === db.id)
        return cell ? String(cell.amount_zar) : ''
      })
    )

    setDistanceBands(dBands)
    setWeightBands(wBands)
    setCellsGrid(grid)
    setLoadingGrid(false)
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
    setDistanceBands([])
    setWeightBands([])
    setCellsGrid([])
    setLongDistanceRate('26')
    setSelectedId((data as RateCard).id)
  }

  async function deleteCard(id: number) {
    await supabase.from('rate_cards').delete().eq('id', id)
    if (selectedId === id) {
      setSelectedId(null)
      setDistanceBands([])
      setWeightBands([])
      setCellsGrid([])
    }
    loadCards()
  }

  function addDistanceBand() {
    setDistanceBands((prev) => [...prev, { id: null, position: prev.length, min_km: '', max_km: '' }])
    setCellsGrid((prev) => prev.map((row) => [...row, '']))
    setSaved(false)
  }

  function removeDistanceBand(idx: number) {
    const band = distanceBands[idx]
    setDistanceBands((prev) => prev.filter((_, i) => i !== idx))
    setCellsGrid((prev) => prev.map((row) => row.filter((_, i) => i !== idx)))
    if (band.id != null) supabase.from('rate_card_distance_bands').delete().eq('id', band.id).then()
    setSaved(false)
  }

  function addWeightBand() {
    setWeightBands((prev) => [
      ...prev,
      { id: null, position: prev.length, label: '', min_kg: '', max_kg: '', mode: 'flat', is_ibt: false },
    ])
    setCellsGrid((prev) => [...prev, distanceBands.map(() => '')])
    setSaved(false)
  }

  function removeWeightBand(idx: number) {
    const band = weightBands[idx]
    setWeightBands((prev) => prev.filter((_, i) => i !== idx))
    setCellsGrid((prev) => prev.filter((_, i) => i !== idx))
    if (band.id != null) supabase.from('rate_card_weight_bands').delete().eq('id', band.id).then()
    setSaved(false)
  }

  function updateDistanceBand(idx: number, field: 'min_km' | 'max_km', value: string) {
    setDistanceBands((prev) => prev.map((b, i) => (i === idx ? { ...b, [field]: value } : b)))
    setSaved(false)
  }

  function updateWeightBand(idx: number, field: keyof EditableWeightBand, value: string | boolean) {
    setWeightBands((prev) => prev.map((b, i) => (i === idx ? { ...b, [field]: value } : b)))
    setSaved(false)
  }

  function updateCell(weightIdx: number, distanceIdx: number, value: string) {
    setCellsGrid((prev) =>
      prev.map((row, i) => (i === weightIdx ? row.map((v, j) => (j === distanceIdx ? value : v)) : row))
    )
    setSaved(false)
  }

  async function saveGrid() {
    if (selectedId == null) return
    setSaving(true)
    setSaveError(null)

    try {
      // Persist distance bands, tracking id assignment for new rows.
      const savedDistanceIds: (number | null)[] = []
      for (let i = 0; i < distanceBands.length; i++) {
        const b = distanceBands[i]
        const payload = {
          rate_card_id: selectedId,
          position: i,
          min_km: numOrNull(b.min_km) ?? 0,
          max_km: numOrNull(b.max_km),
        }
        if (b.id == null) {
          const { data, error } = await supabase.from('rate_card_distance_bands').insert(payload).select().single()
          if (error) throw error
          savedDistanceIds.push((data as RateCardDistanceBand).id)
        } else {
          const { error } = await supabase.from('rate_card_distance_bands').update(payload).eq('id', b.id)
          if (error) throw error
          savedDistanceIds.push(b.id)
        }
      }

      const savedWeightIds: (number | null)[] = []
      for (let i = 0; i < weightBands.length; i++) {
        const b = weightBands[i]
        const payload = {
          rate_card_id: selectedId,
          position: i,
          label: b.label || `Band ${i + 1}`,
          min_kg: numOrNull(b.min_kg) ?? 0,
          max_kg: numOrNull(b.max_kg),
          mode: b.mode,
          is_ibt: b.is_ibt,
        }
        if (b.id == null) {
          const { data, error } = await supabase.from('rate_card_weight_bands').insert(payload).select().single()
          if (error) throw error
          savedWeightIds.push((data as RateCardWeightBand).id)
        } else {
          const { error } = await supabase.from('rate_card_weight_bands').update(payload).eq('id', b.id)
          if (error) throw error
          savedWeightIds.push(b.id)
        }
      }

      const cellRows = []
      for (let wi = 0; wi < weightBands.length; wi++) {
        for (let di = 0; di < distanceBands.length; di++) {
          const raw = cellsGrid[wi]?.[di] ?? ''
          const amount = numOrNull(raw)
          if (amount == null) continue
          cellRows.push({
            rate_card_id: selectedId,
            weight_band_id: savedWeightIds[wi],
            distance_band_id: savedDistanceIds[di],
            amount_zar: amount,
          })
        }
      }
      if (cellRows.length > 0) {
        const { error } = await supabase
          .from('rate_card_cells')
          .upsert(cellRows, { onConflict: 'weight_band_id,distance_band_id' })
        if (error) throw error
      }

      const rate = numOrNull(longDistanceRate) ?? 26
      const { error: cardError } = await supabase
        .from('rate_cards')
        .update({ long_distance_rate_zar_per_km: rate })
        .eq('id', selectedId)
      if (cardError) throw cardError

      await loadCards()
      await selectCard(selectedId)
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

      {selectedId != null && (
        <div className="rounded-md border border-slate-200 bg-white p-3">
          {loadingGrid ? (
            <p className="text-xs text-slate-400">Loading grid…</p>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2">
                <label className="text-xs text-slate-500">Long-distance rate (R/km, beyond last band)</label>
                <input
                  type="text"
                  value={longDistanceRate}
                  onChange={(e) => { setLongDistanceRate(e.target.value); setSaved(false) }}
                  className="w-20 rounded border border-slate-300 px-1.5 py-0.5 font-mono text-xs"
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
                              className="w-16 rounded border border-slate-300 px-1 py-0.5 text-center font-mono"
                            />
                          </td>
                        ))}
                        <td />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={addWeightBand}
                  className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
                >
                  + weight band
                </button>
                <button
                  onClick={saveGrid}
                  disabled={saving}
                  className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40"
                >
                  {saving ? 'Saving…' : 'Save rate card'}
                </button>
                {saved && !saving && <span className="text-xs font-medium text-emerald-600">✓ Saved</span>}
                {saveError && <span className="text-xs text-red-500">{saveError}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
