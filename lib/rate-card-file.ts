import * as XLSX from 'xlsx'
import type { RateCardDistanceBand, RateCardWeightBand } from '@/lib/types'

// Parses a rate card spreadsheet shaped like the reference file: a header
// row of distance bands across the top, a label column of weight bands
// down the left, and a ZAR amount in every other cell. Matching is purely
// positional (row/column order), not by label text, since source files
// label things inconsistently (e.g. "10.1-20km" vs "11-20 Km", or two rows
// both named "Per Ton x weight") — the grid must have exactly as many data
// rows/columns as the app's fixed weight/distance bands, in the same order.
export async function parseRateCardGrid(
  file: File,
  distanceBandCount: number,
  weightBandCount: number
): Promise<(number | null)[][]> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error('No sheets found in file.')
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, defval: null })

  const dataRows = rows.slice(1).filter((r) => r.some((v) => v != null && v !== ''))
  if (dataRows.length !== weightBandCount) {
    throw new Error(
      `Expected ${weightBandCount} weight-band rows, found ${dataRows.length}. The file's rows must match the app's weight bands, in order.`
    )
  }

  return dataRows.map((row, ri) => {
    const cols = row.slice(1, 1 + distanceBandCount)
    if (cols.length < distanceBandCount) {
      throw new Error(
        `Row ${ri + 2} has only ${cols.length} amount columns, expected ${distanceBandCount}.`
      )
    }
    return cols.map((v) => {
      if (v == null || v === '') return null
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
      return isNaN(n) ? null : n
    })
  })
}

function parseAmount(v: string | number | null): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return isNaN(n) ? null : n
}

// Parses the Italtile store rate card template: distance bands down the
// rows, weight bands (plus the over-1-ton surcharge) across the columns —
// the transpose of parseRateCardGrid's layout. Like parseRateCardGrid,
// matching is positional against the app's fixed Italtile Store bands, and
// non-numeric cells (e.g. "CUSTOM QUOTATION") parse to null.
export async function parseItaltileStoreGrid(
  file: File,
  distanceBandCount: number,
  weightBandCount: number
): Promise<(number | null)[][]> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error('No sheets found in file.')
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, defval: null })

  // Data rows are the ones that actually carry a rate — title/header rows
  // are all-text (no numeric cells beyond the distance label column).
  const dataRows = rows.filter((r) => r.slice(1).some((v) => typeof v === 'number'))
  if (dataRows.length !== distanceBandCount) {
    throw new Error(
      `Expected ${distanceBandCount} distance-band rows with rates, found ${dataRows.length}. The file's rows must match the app's distance bands, in order.`
    )
  }

  return dataRows.map((row, ri) => {
    const cols = row.slice(1, 1 + weightBandCount)
    if (cols.length < weightBandCount) {
      throw new Error(`Row ${ri + 1} has only ${cols.length} amount columns, expected ${weightBandCount}.`)
    }
    return cols.map(parseAmount)
  })
}

// Parses the Italtile webstore rate card template: a long list of rows
// with named columns (distance_from, distance_to, weight_from, weight_to,
// rate, additional_cost), rather than a fixed grid. Each row's rate is
// fanned out to every configured distance band whose min_km falls inside
// the row's [distance_from, distance_to] range — this naturally spreads a
// distance-independent row (e.g. distance_to: 2000) across every band. A
// row's additional_cost is only treated as the over-1-ton surcharge when
// its weight_to is exactly 1000 (the row at the ton boundary).
export async function parseItaltileWebstoreList(
  file: File,
  distanceBands: RateCardDistanceBand[],
  weightBands: RateCardWeightBand[]
): Promise<{ weightBandId: number; distanceBandId: number; amount: number }[]> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error('No sheets found in file.')
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, defval: null })

  const headerIdx = rows.findIndex((r) =>
    r.some((v) => typeof v === 'string' && v.trim().toLowerCase() === 'distance_from')
  )
  if (headerIdx === -1) {
    throw new Error('Could not find a header row with a "distance_from" column.')
  }
  const header = rows[headerIdx].map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : ''))
  const colIndex = (name: string) => header.indexOf(name)
  const idx = {
    distanceFrom: colIndex('distance_from'),
    distanceTo: colIndex('distance_to'),
    weightFrom: colIndex('weight_from'),
    weightTo: colIndex('weight_to'),
    rate: colIndex('rate'),
    additionalCost: colIndex('additional_cost'),
  }
  for (const [key, i] of Object.entries(idx)) {
    if (i === -1) throw new Error(`Missing expected column "${key}" in the header row.`)
  }

  const surchargeBand = weightBands.find((b) => b.mode === 'over_1000_surcharge')
  const result: { weightBandId: number; distanceBandId: number; amount: number }[] = []

  for (const row of rows.slice(headerIdx + 1)) {
    const weightFrom = parseAmount(row[idx.weightFrom])
    const weightTo = parseAmount(row[idx.weightTo])
    const distanceFrom = parseAmount(row[idx.distanceFrom])
    const distanceTo = parseAmount(row[idx.distanceTo])
    if (weightFrom == null || distanceFrom == null || distanceTo == null) continue

    const matchedBands = distanceBands.filter((db) => db.min_km >= distanceFrom && db.min_km <= distanceTo)

    const rate = parseAmount(row[idx.rate])
    if (rate != null) {
      const weightBand = weightBands.find(
        (b) => b.mode === 'flat' && weightFrom >= b.min_kg && (b.max_kg == null || weightFrom < b.max_kg)
      )
      if (weightBand) {
        for (const db of matchedBands) result.push({ weightBandId: weightBand.id, distanceBandId: db.id, amount: rate })
      }
    }

    const additionalCost = parseAmount(row[idx.additionalCost])
    if (additionalCost != null && weightTo === 1000 && surchargeBand) {
      for (const db of matchedBands) result.push({ weightBandId: surchargeBand.id, distanceBandId: db.id, amount: additionalCost })
    }
  }

  return result
}
