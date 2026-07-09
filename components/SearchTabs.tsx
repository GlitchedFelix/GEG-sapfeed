'use client'

import { useState } from 'react'
import SearchClient from '@/components/SearchClient'
import DistancesClient from '@/components/DistancesClient'
import SettingsClient from '@/components/SettingsClient'

type Tab = 'search' | 'distances' | 'settings'

const TAB_LABELS: Record<Tab, string> = {
  search: 'Search',
  distances: 'Distances',
  settings: 'Settings',
}

export default function SearchTabs() {
  const [tab, setTab] = useState<Tab>('search')

  return (
    <>
      <div className="flex gap-1 px-4 pt-3 pb-0">
        {(['search', 'distances', 'settings'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-t px-3 py-1.5 text-xs font-medium border border-b-0 ${
              tab === t
                ? 'bg-white border-slate-200 text-slate-900'
                : 'bg-slate-50 border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      <div className="border-t border-slate-200">
        {tab === 'search' && <SearchClient />}
        {tab === 'distances' && <DistancesClient />}
        {tab === 'settings' && <SettingsClient />}
      </div>
    </>
  )
}
