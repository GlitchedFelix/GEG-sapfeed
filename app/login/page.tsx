'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import Panel from '@/components/ui/Panel'
import Button from '@/components/ui/Button'
import Alert from '@/components/ui/Alert'
import { fieldClass, fieldLabelClass } from '@/components/ui/fieldStyles'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    router.push('/search')
    router.refresh()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <Panel padded={false} className="rounded-xl p-8 shadow-popover">
          <div className="mb-6 flex flex-col items-center text-center">
            <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-accent-600 text-base font-bold text-white">
              G
            </span>
            <h1 className="text-xl font-semibold text-slate-900">GEG SAP Reports</h1>
            <p className="mt-1 text-sm text-slate-500">Good Earth Group · CTM &amp; Italtile transport reports</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className={fieldLabelClass}>
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`w-full ${fieldClass} px-3 py-2 text-sm`}
              />
            </div>

            <div>
              <label htmlFor="password" className={fieldLabelClass}>
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`w-full ${fieldClass} px-3 py-2 text-sm`}
              />
            </div>

            {error && <Alert tone="error">{error}</Alert>}

            <Button type="submit" variant="primary" size="md" className="w-full" disabled={loading}>
              {loading ? 'Please wait…' : 'Sign in'}
            </Button>
          </form>
        </Panel>
      </div>
    </div>
  )
}
