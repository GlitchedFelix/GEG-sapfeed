'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'

export default function NavBar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const linkClass = (href: string) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
      pathname.startsWith(href)
        ? 'bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-100'
        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
    }`

  return (
    <nav className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-3 shadow-card backdrop-blur">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-600 text-xs font-bold text-white">
            G
          </span>
          <span className="text-sm font-semibold text-slate-900">GEG SAP Reports</span>
        </div>
        <div className="flex items-center gap-1">
          <Link href="/search" className={linkClass('/search')}>
            Search
          </Link>
          <Link href="/import" className={linkClass('/import')}>
            Import
          </Link>
        </div>
      </div>
      <button
        onClick={handleSignOut}
        className="flex items-center gap-1.5 border-l border-slate-200 pl-4 text-xs font-medium text-slate-400 hover:text-slate-700"
      >
        <LogOut className="h-3.5 w-3.5" />
        Sign out
      </button>
    </nav>
  )
}
