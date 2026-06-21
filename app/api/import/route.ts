import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { parseSapExport } from '@/lib/sap-parser'
import type { ImportResult } from '@/lib/types'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return NextResponse.json({ error: 'No file provided.' }, { status: 400 })
  }

  const raw = await file.text()

  let parsed: ReturnType<typeof parseSapExport>
  try {
    parsed = parseSapExport(raw, file.name)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to parse file.' },
      { status: 400 }
    )
  }

  if (parsed.records.length === 0) {
    return NextResponse.json(
      { error: 'No valid rows found in this file.' },
      { status: 400 }
    )
  }

  // Upsert on the row_hash unique index, ignoring conflicts — this is
  // the agreed dedupe behavior: identical row content already in the
  // database is silently skipped, everything else is inserted.
  // We need the per-row outcome to report an accurate duplicate count,
  // so we check which hashes already exist first rather than relying
  // solely on upsert's silent ignore (which doesn't tell us *how many*
  // were skipped).
  const incomingHashes = parsed.records.map((r) => r.row_hash)

  const { data: existing, error: existingError } = await supabase
    .from('deliveries')
    .select('row_hash')
    .in('row_hash', incomingHashes)

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 })
  }

  const existingHashSet = new Set((existing || []).map((r) => r.row_hash))
  const newRecords = parsed.records.filter((r) => !existingHashSet.has(r.row_hash))
  const duplicateCount = parsed.records.length - newRecords.length

  let insertedCount = 0
  if (newRecords.length > 0) {
    const { error: insertError, count } = await supabase
      .from('deliveries')
      .insert(
        newRecords.map((r) => ({ ...r, imported_by: user.id })),
        { count: 'exact' }
      )

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }
    insertedCount = count ?? newRecords.length
  }

  const result: ImportResult = {
    brand: parsed.brand,
    filename: file.name,
    totalRows: parsed.records.length,
    inserted: insertedCount,
    duplicates: duplicateCount,
    errors: parsed.errors,
  }

  return NextResponse.json(result)
}
