'use client'

import { useState } from 'react'
import SearchClient from '@/components/SearchClient'
import DistancesClient from '@/components/DistancesClient'
import PayoutClient from '@/components/PayoutClient'
import { cn } from '@/components/ui/cn'

type Tab = 'search' | 'distances' | 'payout'

const TAB_LABELS: Record<Tab, string> = {
  search: 'Search',
  distances: 'Distances',
  payout: 'Payout',
}

export default function SearchTabs() {
  const [tab, setTab] = useState<Tab>('search')

  return (
    <>
      <div className="flex gap-6 border-b border-slate-200 bg-white px-5">
        {(['search', 'distances', 'payout'] as Tab[]).map((t) => (
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
        {tab === 'search' && <SearchClient />}
        {tab === 'distances' && <DistancesClient />}
        {tab === 'payout' && <PayoutClient />}
      </div>
    </>
  )
}
