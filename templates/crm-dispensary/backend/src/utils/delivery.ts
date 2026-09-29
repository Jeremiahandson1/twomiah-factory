// Delivery zones: what a zone costs, what it requires, and whether an address is in one.
//
// T46 N3: the register charged the fee and enforced the minimum (T45 H7), and the public order-ahead
// menu did neither. An in-zone delivery came to $87.50 = $70 + tax with no $5 fee, and a Chicago
// address was accepted by an Ohio shop at the same total. Two paths, one rule, one of them missing —
// so the matching and the reading move here and both call it.
//
// Zone rows come from raw SQL in one caller and Drizzle in another, and older rows carry `min_order`
// where newer ones carry `minimum_order`. Both spellings and both shapes are handled here rather
// than at each call site, which is where the drift started.

export interface ZoneRow {
  id?: string
  name?: string | null
  active?: boolean | null
  delivery_fee?: any
  deliveryFee?: any
  minimum_order?: any
  minimumOrder?: any
  min_order?: any
  minOrder?: any
  zip_codes?: any
  zipCodes?: any
}

/** The five-digit ZIPs a zone covers. */
export function zoneZips(zone: ZoneRow): string[] {
  const raw = zone.zip_codes ?? zone.zipCodes
  let list: any[] = []
  if (Array.isArray(raw)) list = raw
  else if (typeof raw === 'string') { try { list = JSON.parse(raw || '[]') } catch { list = [] } }
  return list.map((v) => String(v).trim().slice(0, 5)).filter(Boolean)
}

/** The last ZIP written in a free-text address, which is where a US address puts it. */
export function zipInAddress(address: string): string | null {
  const found = (String(address || '').match(/\b[0-9]{5}(?:-[0-9]{4})?\b/g) || []).pop()
  return found ? found.slice(0, 5) : null
}

/** What this zone charges, and the smallest order it will take. Both in dollars. */
export function zoneTerms(zone: ZoneRow): { fee: number; minimum: number } {
  const fee = Number(zone.delivery_fee ?? zone.deliveryFee ?? 0) || 0
  const minimum = Number(zone.minimum_order ?? zone.minimumOrder ?? zone.min_order ?? zone.minOrder ?? 0) || 0
  return { fee: fee > 0 ? fee : 0, minimum: minimum > 0 ? minimum : 0 }
}

/** The active zone covering this address, or null when none does. */
export function matchZoneForAddress<T extends ZoneRow>(zones: T[], address: string): T | null {
  const zip = zipInAddress(address)
  if (!zip) return null
  return zones.find((z) => z.active !== false && zoneZips(z).includes(zip)) || null
}
