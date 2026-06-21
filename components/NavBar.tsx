'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
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
    `rounded px-2 py-1 text-xs font-medium ${
      pathname.startsWith(href)
        ? 'bg-slate-900 text-white'
        : 'text-slate-600 hover:bg-slate-100'
    }`

  return (
    <nav className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2">
      <div className="flex items-center gap-1">
        <span className="mr-3 text-xs font-semibold text-slate-900">GEG SAP Reports</span>
        <Link href="/search" className={linkClass('/search')}>
          Search
        </Link>
        <Link href="/import" className={linkClass('/import')}>
          Import
        </Link>
      </div>
      <button
        onClick={handleSignOut}
        className="text-xs text-slate-400 hover:text-slate-700"
      >
        Sign out
      </button>
    </nav>
  )
}
