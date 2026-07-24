'use client'

import { useState, useEffect, useRef } from 'react'
import { Pencil, X } from 'lucide-react'
import { cn } from '@/components/ui/cn'

interface Suggestion {
  mapboxId: string
  name: string
  placeFormatted?: string
}

interface ResolveResult {
  distanceKm: number | null
  failReason: string | null
}

interface Props {
  rowHash: string
  street: string | null
  city: string | null
  country: string | null
  onResolved: (result: ResolveResult) => void
}

export default function AddressSearchCell({ rowHash, street, city, country, onResolved }: Props) {
  const currentAddress = [street, city, country].filter(Boolean).join(', ') || '—'

  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [sessionToken, setSessionToken] = useState('')
  const [searching, setSearching] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function startEdit() {
    setQuery([street, city, country].filter(Boolean).join(', '))
    setSuggestions([])
    setError(null)
    setSessionToken(crypto.randomUUID())
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
    setSuggestions([])
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }

  // Debounce suggest calls the same way SearchClient debounces its filter
  // query, so we don't fire a Mapbox request on every keystroke.
  useEffect(() => {
    if (!editing) return
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const trimmed = query.trim()
    if (trimmed.length < 3) {
      setSuggestions([])
      return
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/geocode-suggest?q=${encodeURIComponent(trimmed)}&session_token=${encodeURIComponent(sessionToken)}`
        )
        const data = await res.json()
        if (!res.ok) {
          setError(data.error ?? 'Search failed')
          setSuggestions([])
        } else {
          setSuggestions(data.suggestions ?? [])
        }
      } catch {
        setError('Search failed')
        setSuggestions([])
      } finally {
        setSearching(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, editing])

  async function pick(suggestion: Suggestion) {
    setResolving(true)
    setError(null)
    try {
      const res = await fetch('/api/geocode-retrieve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowHash, mapboxId: suggestion.mapboxId, sessionToken }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Could not resolve address')
        return
      }
      setEditing(false)
      onResolved({ distanceKm: data.distanceKm ?? null, failReason: data.failReason ?? null })
    } catch {
      setError('Could not resolve address')
    } finally {
      setResolving(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-slate-700">{currentAddress}</span>
        <button onClick={startEdit} className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600">
          <Pencil className="h-3 w-3" />
        </button>
      </div>
    )
  }

  return (
    <div className="relative min-w-[220px]">
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && cancel()}
          autoFocus
          placeholder="Search for the correct address…"
          className="w-full rounded border border-slate-300 px-1.5 py-1 text-xs transition-colors focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20"
        />
        <button onClick={cancel} disabled={resolving} className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-40">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {error && <p className="mt-1 text-[11px] text-red-500">{error}</p>}

      {(searching || suggestions.length > 0) && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full min-w-[280px] overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg scrollbar-thin">
          {searching && (
            <li className="px-2 py-1.5 text-[11px] text-slate-400">Searching…</li>
          )}
          {!searching && suggestions.map((s) => (
            <li key={s.mapboxId}>
              <button
                onClick={() => pick(s)}
                disabled={resolving}
                className={cn(
                  'w-full px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-accent-50 disabled:opacity-40'
                )}
              >
                <div className="font-medium">{s.name}</div>
                {s.placeFormatted && <div className="text-[11px] text-slate-400">{s.placeFormatted}</div>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
