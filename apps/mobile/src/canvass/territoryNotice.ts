/**
 * Roofing parity row 23 (Spotio; territory_tools, not ready): what the canvass screen says about where the rep is, from
 * GET /api/territories/locate?lat&lng ({ inside: [{ name }], inMine, hasTerritory }). Nothing is blocked — a door outside is still
 * logged — the rep is only told. Null: nothing to say (inside their own, or they have no territory).
 */
export function territoryNotice(r: { inside?: Array<{ name: string }>; inMine?: boolean; hasTerritory?: boolean } | null | undefined): string | null {
  if (!r || !r.hasTerritory || r.inMine) return null
  const other = (r.inside || []).map((t) => t.name).filter(Boolean)
  return other.length ? `You are outside your territory — this is ${other.join(', ')}.` : 'You are outside your territory.'
}
