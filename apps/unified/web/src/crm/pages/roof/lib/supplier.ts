/**
 * A SUPPLIER'S NAME, NOT ITS SLUG. (T41)
 *
 *   "the material order shows the raw slug abc_supply"
 *
 * `supplier` is free text on the order and the seed stores slugs, so the filter dropdown, the
 * orders table and the job's material panel all printed `abc_supply` at the person placing the
 * order. The stored value is left exactly as it is — the filter sends it back to the server, so
 * rewriting it would break the filter — and only the DISPLAY is humanised.
 *
 * The named list is the roofing supply houses a crew actually says out loud; anything else is
 * title-cased, with the handful of trade acronyms kept in capitals. A name typed by hand ("Smith's
 * Roofing Supply") already has no underscores and comes back unchanged.
 */
const KNOWN: Record<string, string> = {
  abc_supply: 'ABC Supply',
  abc: 'ABC Supply',
  beacon: 'Beacon Building Products',
  beacon_building_products: 'Beacon Building Products',
  srs: 'SRS Distribution',
  srs_distribution: 'SRS Distribution',
  allied: 'Allied Building Products',
  allied_building_products: 'Allied Building Products',
  home_depot: 'Home Depot',
  lowes: "Lowe's",
  bradco: 'Bradco Supply',
  gulfeagle: 'Gulfeagle Supply',
  roofers_supply: 'Roofers Supply',
}

/** Trade names that are initialisms, so title-casing them would read as a typo. */
const ACRONYMS = new Set(['abc', 'srs', 'gaf', 'iko', 'crc', 'us', 'usa', 'tamko', 'epdm', 'tpo', 'pvc'])

export function supplierName(raw?: string | null): string {
  const value = String(raw ?? '').trim()
  if (!value) return ''
  const key = value.toLowerCase().replace(/[\s-]+/g, '_')
  if (KNOWN[key]) return KNOWN[key]
  // Only a slug needs rewriting; a name somebody typed is already a name.
  if (!/[_-]/.test(value) && /[a-z]/.test(value) && /[A-Z]/.test(value)) return value
  return value
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ')
}

/**
 * A MATERIAL ORDER'S STATUS IN THE ROOFER'S WORDS. Roofr's are draft, ready to send, sent, rejected and delivered; ours keep
 * ordered and partly delivered for the order a roofer phones in. `not_ordered` is the stored word for a draft. The server has the
 * same words for its documents (server/crm/roof/materialStatus.ts) — the web build cannot import them.
 */
export const ORDER_STATUS_LABELS: Record<string, string> = {
  not_ordered: 'Draft', ready_to_send: 'Ready to send', sent: 'Sent', rejected: 'Rejected', ordered: 'Ordered',
  partial: 'Partly delivered', delivered: 'Delivered', cancelled: 'Cancelled',
}
export const orderStatusLabel = (s?: string | null): string =>
  ORDER_STATUS_LABELS[String(s ?? '')] ?? String(s ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

/** The statuses a roofer may set by hand: Sent is set only by sending the order. */
export const SETTABLE_ORDER_STATUSES = ['not_ordered', 'ready_to_send', 'ordered', 'partial', 'delivered', 'rejected', 'cancelled'] as const
