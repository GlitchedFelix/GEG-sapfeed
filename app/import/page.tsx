import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import NavBar from '@/components/NavBar'
import ImportDropzone from '@/components/ImportDropzone'

export default async function ImportPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="mb-1 text-xl font-semibold text-slate-900">Import delivery report</h1>
        <p className="mb-6 text-sm text-slate-500">
          Upload daily SAP transport exports. Rows already in the database are skipped automatically.
        </p>
        <ImportDropzone />
      </main>
    </div>
  )
}
