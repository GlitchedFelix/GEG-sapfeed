// Store names arrive as "C944 --- CTM Alberton" or "C562 -- CTM Protea Glen".
// Match " -+ " (one or more dashes surrounded by spaces) to handle both forms.
export function parseStoreName(raw: string): { code: string; name: string } {
  const match = raw.match(/^(.+?)\s-+\s(.+)$/)
  if (!match) return { code: '', name: raw.trim() }
  return { code: match[1].trim(), name: match[2].trim() }
}
