import * as XLSX from 'xlsx'

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
