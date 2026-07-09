import { createHash } from 'crypto'
import type { Brand, DeliveryRecord } from './types'

/**
 * SAP exports these reports as MHTML (multipart MIME) wearing a .XLS
 * extension — NOT real binary Excel. The actual data lives in a
 * text/html MIME part, quoted-printable encoded. This function pulls
 * that part out as a plain HTML string.
 */
function extractHtmlFromMhtml(raw: string): string {
  // Quoted-printable: "=3D" -> "=", "=\r\n" (soft line break) -> "" (join lines)
  function decodeQuotedPrintable(input: string): string {
    return input
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      )
  }

  const boundaryMatch = raw.match(/boundary="?([^"\r\n]+)"?/i)
  if (!boundaryMatch) {
    // Not actually MHTML-wrapped — assume it's already raw HTML.
    return raw
  }
  const boundary = boundaryMatch[1]
  const parts = raw.split(`--${boundary}`)

  for (const part of parts) {
    if (/Content-Type:\s*text\/html/i.test(part)) {
      // Strip MIME headers (everything up to the first blank line), keep the body.
      const bodyStart = part.search(/\r?\n\r?\n/)
      const body = bodyStart >= 0 ? part.slice(bodyStart).trim() : part.trim()
      const isQp = /Content-Transfer-Encoding:\s*quoted-printable/i.test(part)
      return isQp ? decodeQuotedPrintable(body) : body
    }
  }

  throw new Error('No text/html part found in MHTML file — unexpected SAP export format.')
}

/**
 * Extremely small HTML table parser, deliberately not a full DOM parser.
 * SAP's export is simple, well-formed <table><tr><td> markup, so a regex
 * walk is enough and avoids pulling in a heavy HTML parsing dependency.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .trim()
}

function parseHtmlTable(html: string): string[][] {
  const rows: string[][] = []
  const rowMatches = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []

  for (const rowHtml of rowMatches) {
    const cellMatches = rowHtml.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []
    const cells: string[] = []
    for (const cell of cellMatches) {
      const openTagMatch = cell.match(/<t[dh]([^>]*)>/i)
      const colspanMatch = openTagMatch?.[1].match(/colspan\s*=\s*"?(\d+)"?/i)
      const colspan = colspanMatch ? parseInt(colspanMatch[1], 10) : 1

      const text = decodeHtmlEntities(cell.replace(/<[^>]+>/g, ''))

      // SAP only uses colspan on header cells spanning empty placeholder
      // columns (e.g. "Store" spans 2 cols: code + name). Repeating the
      // header text across the span keeps column *count* aligned with
      // data rows, even though the literal text duplicates — the second
      // occurrence is resolved by position in parseSapExport below.
      for (let i = 0; i < colspan; i++) cells.push(text)
    }
    if (cells.length > 0) rows.push(cells)
  }

  return rows
}

/** Detects brand from filename. SAP filenames contain "_ITAL_" for Italtile exports. */
export function detectBrand(filename: string): Brand {
  return /_ITAL_/i.test(filename) ? 'ITALTILE' : 'CTM'
}

/**
 * Parses a numeric field that may be plain ("1059.299") or, for
 * ITALTILE exports specifically, formatted with thousands separators
 * and a unit suffix ("1,064.500 KG"). Returns null if unparseable —
 * caller decides whether that's an error or an acceptable gap.
 */
function parseNumeric(value: string | undefined): number | null {
  if (!value) return null
  const cleaned = value.replace(/,/g, '').replace(/\s*KG\s*$/i, '').trim()
  if (cleaned === '' || cleaned.toLowerCase() === 'nan') return null
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}

function parseDate(value: string | undefined): string | null {
  if (!value) return null
  // SAP gives "YYYY/MM/DD" — convert to ISO "YYYY-MM-DD".
  const match = value.trim().match(/^(\d{4})\/(\d{2})\/(\d{2})$/)
  if (!match) return null
  return `${match[1]}-${match[2]}-${match[3]}`
}

function parseInt14(value: string | undefined): number {
  const n = Number((value || '').replace(/,/g, '').trim())
  if (!Number.isFinite(n)) {
    throw new Error(`Expected a numeric delivery/billing field, got "${value}"`)
  }
  return n
}

/**
 * Builds the content hash used as the dedupe key. Per the agreed
 * decision: hash the full row content (not just delivery_number,
 * which turned out not to be reliably unique). Identical hash on
 * insert => treated as a duplicate and skipped.
 */
function hashRow(cells: string[]): string {
  return createHash('sha256').update(cells.join('|')).digest('hex')
}

/**
 * Parses a raw uploaded SAP .XLS (MHTML) file buffer into normalized
 * DeliveryRecord rows ready for insert.
 *
 * Column layout differs slightly between CTM and ITALTILE exports
 * (confirmed against real samples):
 *  - CTM has an extra duplicated "Country" column ITALTILE lacks.
 *  - ITALTILE's weight columns are formatted strings ("1,064.500 KG");
 *    CTM's are plain numeric strings.
 * Both differences are handled by column-name lookup below rather than
 * fixed positional indexes, so a future minor column reordering from
 * SAP won't silently corrupt data — it'll just fail to find the column
 * and throw, which is the safer failure mode.
 */
export function parseSapExport(raw: string, filename: string): {
  brand: Brand
  records: DeliveryRecord[]
  errors: string[]
} {
  const brand = detectBrand(filename)
  const html = extractHtmlFromMhtml(raw)
  const tables = html.split(/<table/i).slice(1).map((t) => parseHtmlTable('<table' + t))

  // The real data table is the largest one on the page — title/metadata
  // tables before it only have a single cell.
  const dataTable = tables.reduce((biggest, t) => (t.length > biggest.length ? t : biggest), [])

  if (dataTable.length < 3) {
    throw new Error('Could not locate the data table in this file — is this a valid SAP export?')
  }

  // Row 0 is units metadata (KG, ZAR, etc.), row 1 is the real header, data starts at row 2.
  const header = dataTable[1].map((h) => h.trim())
  const dataRows = dataTable.slice(2)

  function colIndex(name: string, fromIndex = 0): number {
    const idx = header.indexOf(name, fromIndex)
    if (idx === -1) {
      throw new Error(`Expected column "${name}" not found in ${brand} export header.`)
    }
    return idx
  }

  // Resolved once per file, not per row, since header layout is fixed within one file.
  const storeCodeIdx = colIndex('Store')
  const idx = {
    storeCode: storeCodeIdx,
    // "Store" appears twice (code, then name) via a colspan=2 header cell —
    // second occurrence (search starting after the first) is the name.
    storeName: colIndex('Store', storeCodeIdx + 1),
    billingDocument: colIndex('Billing document'),
    customerName: colIndex('Customer Name'),
    street: colIndex('Street'),
    city: colIndex('City'),
    country: colIndex('Country'),
    telephone: colIndex('Telephone 1'),
    supplierStore: colIndex('Supplier Store'),
    ibtFrom: colIndex('IBT From'),
    ibtTo: colIndex('IBT TO'),
    oboOrder: colIndex('OBO Order?'),
    createdOn: colIndex('Created on'),
    deliveryDate: colIndex('Delivery Date'),
    delivery: colIndex('Delivery'),
    salesDocument: colIndex('Sales document'),
    salesRep: colIndex('Sales Representative'),
  }

  // Weight/amount columns sit after a blank/NaN header cell and aren't
  // named distinctly enough to find by exact text reliably across both
  // formats, so we take them as the last 5 columns by fixed offset from
  // the end of the row, which both samples confirm is stable.
  const records: DeliveryRecord[] = []
  const errors: string[] = []

  for (let i = 0; i < dataRows.length; i++) {
    const cells = dataRows[i]
    try {
      const n = cells.length
      const grossWeight = parseNumeric(cells[n - 5])
      const netWeight = parseNumeric(cells[n - 4])
      const invoiceAmount = parseNumeric(cells[n - 3])
      const transport1 = parseNumeric(cells[n - 2])
      const transport2 = parseNumeric(cells[n - 1])

      const record: DeliveryRecord = {
        row_hash: hashRow(cells),
        delivery_number: parseInt14(cells[idx.delivery]),
        billing_document: parseInt14(cells[idx.billingDocument]),
        brand,
        store_code: cells[idx.storeCode]?.trim() || '',
        store_name: cells[idx.storeName]?.trim() || '',
        customer_name: cells[idx.customerName]?.trim() || null,
        street: cells[idx.street]?.trim() || null,
        city: cells[idx.city]?.trim() || null,
        country: cells[idx.country]?.trim() || null,
        telephone: cells[idx.telephone]?.trim() || null,
        supplier_store: cells[idx.supplierStore]?.trim() || null,
        ibt_from: cells[idx.ibtFrom]?.trim() || null,
        ibt_to: cells[idx.ibtTo]?.trim() || null,
        obo_order: cells[idx.oboOrder]?.trim() === 'X',
        created_on: parseDate(cells[idx.createdOn]),
        delivery_date: parseDate(cells[idx.deliveryDate]),
        sales_document: cells[idx.salesDocument] ? parseInt14(cells[idx.salesDocument]) : null,
        sales_representative: cells[idx.salesRep]?.trim() || null,
        gross_weight_kg: grossWeight,
        net_weight_kg: netWeight,
        invoice_amount_zar: invoiceAmount,
        transport1_amount_zar: transport1,
        transport2_amount_zar: transport2,
        customer_lat: null,
        customer_lon: null,
        distance_km: null,
      }

      if (!record.store_code || !record.delivery_number || !record.billing_document) {
        errors.push(`Row ${i + 1}: missing required field (store/delivery/billing), skipped.`)
        continue
      }

      records.push(record)
    } catch (e) {
      errors.push(`Row ${i + 1}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { brand, records, errors }
}
