import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import NavBar from '@/components/NavBar'
import DistanceTabs from '@/components/DistanceTabs'

export default async function DistancePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-screen">
      <NavBar />
      <DistanceTabs />
    </div>
  )
}
