import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { suggestAddresses } from '@/lib/geocoding'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })

  const q = request.nextUrl.searchParams.get('q')?.trim()
  const sessionToken = request.nextUrl.searchParams.get('session_token')
  if (!q || !sessionToken) {
    return NextResponse.json({ error: 'q and session_token are required.' }, { status: 400 })
  }

  const result = await suggestAddresses(q, sessionToken)
  if ('error' in result) {
    return NextResponse.json({ error: 'Mapbox suggest request failed.' }, { status: 502 })
  }

  return NextResponse.json({ suggestions: result.suggestions })
}
