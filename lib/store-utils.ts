// Store names arrive as "C944 --- CTM Alberton". Split on " --- " to get
// the store's own display code and the human-readable name separately.
export function parseStoreName(raw: string): { code: string; name: string } {
  const sep = raw.indexOf(' --- ')
  if (sep === -1) return { code: '', name: raw.trim() }
  return { code: raw.slice(0, sep).trim(), name: raw.slice(sep + 5).trim() }
}
