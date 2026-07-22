import { isWebstoreName } from './store-utils'

export interface OriginStore {
  storeCode: string
  storeName: string
}

// Normal deliveries use their own recorded store. Webstore deliveries that
// carry an IBT From use the coordinates of the store that actually shipped
// the transfer instead of the (address-less) webstore's own coordinates.
// IBT From arrives in the same "CODE --- NAME" format as the Store column,
// so its trimmed text is itself a stable, natural store_locations key —
// repeat transfers from the same branch reuse the same cached/geocoded row.
export function resolveOriginStore(record: {
  store_code: string
  store_name: string
  ibt_from: string | null
}): OriginStore {
  if (isWebstoreName(record.store_name) && record.ibt_from) {
    const name = record.ibt_from.trim()
    return { storeCode: name, storeName: name }
  }
  return { storeCode: record.store_code, storeName: record.store_name }
}
