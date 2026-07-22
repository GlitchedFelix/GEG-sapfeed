'use client'

import { useState } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import Button from '@/components/ui/Button'
import { cn } from '@/components/ui/cn'

interface Props {
  rowHash: string
  value: number | null
  manual: boolean
  onSaved: (km: number) => void
}

export default function EditableDistanceCell({ rowHash, value, manual, onSaved }: Props) {
  const supabase = createClient()
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState(value != null ? String(value) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startEdit() {
    setInput(value != null ? String(value) : '')
    setError(null)
    setEditing(true)
  }

  async function save() {
    const parsed = parseFloat(input)
    if (isNaN(parsed) || parsed < 0) {
      setError('Invalid km')
      return
    }

    setSaving(true)
    setError(null)

    const { error: updateError } = await supabase
      .from('deliveries')
      .update({
        distance_km: parsed,
        distance_manual: true,
        geocode_failed: false,
        distance_failed: false,
        distance_fail_reason: null,
      })
      .eq('row_hash', rowHash)

    setSaving(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    onSaved(parsed)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center justify-end gap-1">
        {error && <span className="text-[11px] text-red-500">{error}</span>}
        <input
          type="number"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') setEditing(false)
          }}
          autoFocus
          className="w-20 rounded border border-slate-300 px-1.5 py-0.5 text-right font-mono text-xs transition-colors focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20"
        />
        <button
          onClick={save}
          disabled={saving}
          className="rounded p-1 text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setEditing(false)}
          disabled={saving}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-40"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {manual && (
        <span className="rounded bg-accent-50 px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-700">
          Manual
        </span>
      )}
      <span className={cn('tabular-nums font-semibold text-slate-900', value == null && 'font-normal text-slate-400')}>
        {value != null ? `${value} km` : '—'}
      </span>
      <button onClick={startEdit} className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600">
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  )
}
