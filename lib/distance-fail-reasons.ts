export const FAIL_REASON_LABELS: Record<string, string> = {
  no_store_location: 'No store location set',
  no_route: 'No road route found',
  http_error: 'Mapping service error',
  rate_limited: 'Rate limited',
  geocode_failed: 'Address could not be geocoded',
}

export function failReasonLabel(reason: string | null): string {
  if (reason == null) return 'Unknown'
  return FAIL_REASON_LABELS[reason] ?? reason
}
