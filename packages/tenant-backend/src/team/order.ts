// The team's order on the Book (salon parity row 1; Fresha's "team order"): the owner drags the stylists into the order the salon
// wants, saved once per salon in company.settings, and every list of the team follows it — the Book's columns, the stylist pickers
// (GET /api/team/assignable) and the stylists a client may choose between online. Pure, so it is tested without a server.

/** The key in company.settings that holds the ids, first to last. */
export const TEAM_ORDER_KEY = 'bookTeamOrder'

/** The most ids a salon's order can hold (a salon's roster is a handful of people; this only bounds a bad request). */
export const TEAM_ORDER_MAX = 500

/** The saved order out of company.settings, cleaned: strings only, no repeats, no blanks. Nothing saved: an empty list. */
export function readTeamOrder(settings: unknown): string[] {
  const raw = (settings as Record<string, unknown> | null | undefined)?.[TEAM_ORDER_KEY]
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw) {
    const id = typeof v === 'string' ? v.trim() : ''
    if (id && !out.includes(id)) out.push(id)
    if (out.length >= TEAM_ORDER_MAX) break
  }
  return out
}

/**
 * The people in the saved order. Anyone the order does not name (a stylist added since it was saved) comes after those it does, in the
 * order they came in, so a new hire never vanishes; an id in the order that is no one now is ignored. No saved order: unchanged.
 */
export function orderTeam<T extends { id: string }>(people: readonly T[], order: readonly string[] | null | undefined): T[] {
  if (!order || order.length === 0) return [...people]
  const rank = new Map<string, number>()
  order.forEach((id, i) => { if (!rank.has(id)) rank.set(id, i) })
  const named: T[] = [], rest: T[] = []
  for (const p of people) (rank.has(p.id) ? named : rest).push(p)
  named.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
  return [...named, ...rest]
}
