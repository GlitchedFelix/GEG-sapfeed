// Regex-based cleanup for the noisy `street` values in SAP delivery exports,
// applied just before geocoding. Targets the specific noise patterns already
// known to break Nominatim's structured street= search (see the fallback
// comment in geocoding.ts): unit/shop/suite numbers, and "Cnr X & Y"
// cross-street notation. Deliberately does NOT try to strip mall/complex
// names — those are arbitrary proper nouns with no reliable pattern, and in
// small towns without formal street addressing the complex name is
// sometimes the only thing Nominatim can resolve at all.

export interface CleanedStreet {
  /** Value to send as Nominatim's structured street= param (single road name). */
  structured: string
  /** Value to fold into the free-text fallback query (keeps both cross-streets). */
  freeText: string
  changed: boolean
}

// Unit/shop/suite/office/erf/stand/flat/floor noise — describes something
// *inside* or *on* a property, which street= has no concept of. Requires a
// trailing number so a street legitimately named "Shop Street" survives.
const UNIT_TOKEN_RE =
  /\b(?:shop|unit|suite|ste|office|erf|stand|flat|floor|flr|block|level|bay|room|kiosk)\.?\s*#?\s*[a-z]?\d+[a-z]?\b\.?,?/gi

// "Cnr Main Rd & Church St" / "Corner of 5th Ave and Oak St" — a structured
// street= param takes one road name, not two joined by "&"/"and".
const CNR_RE = /\b(?:cnr\.?|corner(?:\s+of)?)\s+([^,&/]+?)\s*(?:&|\/|\band\b)\s*([^,]+)/i
const CNR_KEYWORD_RE = /\b(?:cnr\.?|corner(?:\s+of)?)\s+/i

function tidy(s: string): string {
  return s
    .replace(/,\s*,/g, ',')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function cleanStreet(raw: string | null | undefined): CleanedStreet {
  const original = (raw ?? '').trim()
  if (!original) return { structured: '', freeText: '', changed: false }

  const cnrMatch = original.match(CNR_RE)
  const structuredBase = cnrMatch ? cnrMatch[1].trim() : original
  const freeTextBase = original.replace(CNR_KEYWORD_RE, '')

  const structured = tidy(structuredBase.replace(UNIT_TOKEN_RE, ''))
  const freeText = tidy(freeTextBase.replace(UNIT_TOKEN_RE, ''))

  return {
    structured: structured || original,
    freeText: freeText || original,
    changed: structured !== original || freeText !== original,
  }
}
