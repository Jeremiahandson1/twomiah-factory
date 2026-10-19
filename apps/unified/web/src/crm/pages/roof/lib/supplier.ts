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
