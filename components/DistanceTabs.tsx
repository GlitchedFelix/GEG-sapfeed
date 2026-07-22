'use client'

import { useState } from 'react'
import DistancesClient from '@/components/DistancesClient'
import FailedDistancesClient from '@/components/FailedDistancesClient'
import { cn } from '@/components/ui/cn'

type Tab = 'distances' | 'failed'

const TAB_LABELS: Record<Tab, string> = {
  distances: 'Distances',
  failed: 'Failed',
}

export default function DistanceTabs() {
  const [tab, setTab] = useState<Tab>('distances')

  return (
    <>
      <div className="flex gap-6 border-b border-slate-200 bg-white px-5">
        {(['distances', 'failed'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              '-mb-px border-b-2 pb-3 pt-4 text-sm font-medium transition-colors',
              tab === t
                ? 'border-accent-600 text-slate-900'
                : 'border-transparent text-slate-400 hover:border-slate-300 hover:text-slate-600'
            )}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      <div className="bg-slate-50">
        {tab === 'distances' && <DistancesClient onSwitchToFailed={() => setTab('failed')} />}
        {tab === 'failed' && <FailedDistancesClient />}
      </div>
    </>
  )
}
