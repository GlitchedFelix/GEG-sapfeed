'use client'

import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import Panel from '@/components/ui/Panel'

export default function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string
  subtitle?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <Panel padded={false} className="mt-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
        </div>
        <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <div className="border-t border-slate-200 px-4 py-4">{children}</div>}
    </Panel>
  )
}
