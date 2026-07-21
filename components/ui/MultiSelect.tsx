'use client'

import { Fragment, useState } from 'react'
import { Listbox, Transition } from '@headlessui/react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from './cn'
import { fieldClass, fieldLabelClass } from './fieldStyles'

interface Option {
  value: string
  label: string
}

export default function MultiSelect({
  label,
  options,
  selected,
  onChange,
  placeholder = 'All',
  className,
}: {
  label?: string
  options: Option[]
  selected: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  className?: string
}) {
  const [query, setQuery] = useState('')
  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  const summary =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? options.find((o) => o.value === selected[0])?.label ?? selected[0]
        : `${selected.length} selected`

  return (
    <div className={className}>
      {label && <label className={fieldLabelClass}>{label}</label>}
      <Listbox value={selected} onChange={onChange} multiple>
        <div className="relative">
          <Listbox.Button className={cn(fieldClass, 'flex w-48 items-center justify-between gap-1 text-left')}>
            <span className={cn('truncate', selected.length === 0 && 'text-slate-400')}>{summary}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          </Listbox.Button>
          <Transition
            as={Fragment}
            leave="transition ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
            afterLeave={() => setQuery('')}
          >
            <Listbox.Options className="absolute z-10 mt-1 max-h-72 w-64 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-popover focus:outline-none">
              <div className="sticky top-0 border-b border-slate-100 bg-white px-2 py-1.5">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search stores…"
                  className="w-full rounded border border-slate-200 px-2 py-1 text-xs focus:border-accent-500 focus:outline-none"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>
              <div className="flex items-center justify-between px-3 py-1 text-[11px] text-slate-400">
                <button
                  type="button"
                  className="hover:text-slate-700"
                  onClick={() => onChange(options.map((o) => o.value))}
                >
                  Select all
                </button>
                <button type="button" className="hover:text-slate-700" onClick={() => onChange([])}>
                  Clear
                </button>
              </div>
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-xs text-slate-400">No matches</div>
              ) : (
                filtered.map((opt) => (
                  <Listbox.Option
                    key={opt.value}
                    value={opt.value}
                    className={({ active }) =>
                      cn('flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs', active && 'bg-accent-50')
                    }
                  >
                    {({ selected: isSelected }) => (
                      <>
                        <span
                          className={cn(
                            'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
                            isSelected ? 'border-accent-600 bg-accent-600' : 'border-slate-300'
                          )}
                        >
                          {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
                        </span>
                        <span className="truncate text-slate-700">{opt.label}</span>
                      </>
                    )}
                  </Listbox.Option>
                ))
              )}
            </Listbox.Options>
          </Transition>
        </div>
      </Listbox>
    </div>
  )
}
