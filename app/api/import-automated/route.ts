import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { parseSapExport } from '@/lib/sap-parser'
import type { Brand, DeliveryRecord, ImportResult } from '@/lib/types'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-automation-secret')
  if (!secret || secret !== process.env.AUTOMATION_SECRET) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const brandValue = formData.get('brand') as string | null

  if (!file) {
    return NextResponse.json({ error: 'No file provided.' }, { status: 400 })
  }

  if (!brandValue || !['CTM', 'ITALTILE'].includes(brandValue)) {
    return NextResponse.json(
      { error: 'Invalid or missing brand. Must be CTM or ITALTILE.' },
      { status: 400 }
    )
  }

  const raw = await file.text()

  let parsed: ReturnType<typeof parseSapExport>
  try {
    parsed = parseSapExport(raw, file.name, brandValue as Brand)
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

  const supabase = createServiceClient()
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
        newRecords.map((r: DeliveryRecord) => ({ ...r, imported_by: null })),
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
