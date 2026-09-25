/**
 * lib/kitchen/pacing.ts — the grill screen's arithmetic. Pure; no database.
 *
 * Pacing: everything on a ticket should come off at the same moment. The
 * longest item starts when the ticket fires; every other item starts later by
 * the difference, so "Burger on now · fries in 6" and the plate is hot.
 *
 * Learning: when a ticket is bumped, the time it took says something about its
 * longest item. That feeds a moving average per menu item; after a few
 * samples the learned time replaces the guessed one.
 */

export interface PaceItem { key: string; name: string; qty: number; prepSeconds: number; menuItemId?: string | null }
export interface PacedItem extends PaceItem { startAt: number }
export interface PacedTicket { readyAt: number; items: PacedItem[] }

/** When each item should go on, so the whole ticket is ready together. Times in ms. */
export function paceTicket(firedAt: number, items: PaceItem[]): PacedTicket {
  const longest = items.reduce((m, i) => Math.max(m, i.prepSeconds), 0)
  const readyAt = firedAt + longest * 1000
  return { readyAt, items: items.map(i => ({ ...i, startAt: readyAt - i.prepSeconds * 1000 })) }
}

/** Items count as "on now" from a little before their start until 90 s after (then they are assumed going). */
export const DUE_AHEAD_MS = 15_000
export const DUE_GRACE_MS = 90_000

const label = (i: { name: string; qty: number }) => (i.qty > 1 ? `${i.qty} ${i.name}` : i.name)
const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000))

export interface Cue { text: string; state: 'start' | 'wait' | 'plate' }

/** The one line under a ticket: what to do with it right now. */
export function cueFor(t: PacedTicket, now: number): Cue {
  if (now >= t.readyAt - DUE_AHEAD_MS) return { text: 'Plate it', state: 'plate' }
  const due = t.items.filter(i => i.startAt <= now + DUE_AHEAD_MS && i.startAt > now - DUE_GRACE_MS)
  const upcoming = t.items.filter(i => i.startAt > now + DUE_AHEAD_MS).sort((a, b) => a.startAt - b.startAt)
  const parts: string[] = []
  if (due.length) parts.push(due.map(label).join(' + ') + ' on now')
  if (upcoming.length) {
    const first = upcoming[0].startAt
    const batch = upcoming.filter(i => i.startAt === first)
    parts.push(batch.map(label).join(' + ') + ' in ' + minutes(first - now))
  }
  if (!parts.length) return { text: 'Up in ' + minutes(t.readyAt - now), state: 'wait' }
  return { text: parts.join(' · '), state: due.length ? 'start' : 'wait' }
}

/** Across every open ticket: what should go on right now, grouped ("2 Hamburger · 3 Fries"). */
export function startNow(tickets: PacedTicket[], now: number): Array<{ name: string; qty: number }> {
  const sums = new Map<string, number>()
  for (const t of tickets) {
    if (now >= t.readyAt - DUE_AHEAD_MS) continue
    for (const i of t.items) if (i.startAt <= now + DUE_AHEAD_MS && i.startAt > now - DUE_GRACE_MS) sums.set(i.name, (sums.get(i.name) || 0) + i.qty)
  }
  return [...sums].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name))
}

/** Everything still to come off the grill, grouped ("6 Hamburger · 3 Fish Fry"). */
export function allDay(tickets: Array<{ items: Array<{ name: string; qty: number }> }>): Array<{ name: string; qty: number }> {
  const sums = new Map<string, number>()
  for (const t of tickets) for (const i of t.items) sums.set(i.name, (sums.get(i.name) || 0) + i.qty)
  return [...sums].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name))
}

/** 'fresh' | 'warn' | 'late' from the ticket's age. Shown as a word too, never color alone. */
export function ageState(firedAt: number, now: number, warnSeconds: number, lateSeconds: number): 'fresh' | 'warn' | 'late' {
  const s = (now - firedAt) / 1000
  return s >= lateSeconds ? 'late' : s >= warnSeconds ? 'warn' : 'fresh'
}

// ─── Learning from bumps ──────────────────────────────────────────────────
export const MIN_SAMPLES = 3
const ALPHA = 0.3

/** The prep time pacing uses for an item: learned once there are enough samples, else what the owner set, else the house default. */
export function effectivePrep(item: { prepSeconds: number | null; learnedPrepSeconds: number | null; learnedSamples: number }, houseDefault: number): number {
  if (item.learnedPrepSeconds && item.learnedSamples >= MIN_SAMPLES) return item.learnedPrepSeconds
  return item.prepSeconds || houseDefault
}

/**
 * What a bump teaches. Only a ticket whose longest item is a single menu item
 * says anything clean about that item. Recalled tickets and absurd times
 * (a forgotten bump, a mis-tap) teach nothing.
 */
export function lessonFromBump(items: PaceItem[], firedAt: number, bumpedAt: number, recalled: boolean): { menuItemId: string; observedSeconds: number } | null {
  if (recalled || !items.length) return null
  const longest = Math.max(...items.map(i => i.prepSeconds))
  const top = items.filter(i => i.prepSeconds === longest)
  const ids = new Set(top.map(i => i.menuItemId).filter(Boolean))
  if (ids.size !== 1 || top.some(i => !i.menuItemId)) return null
  const observed = Math.round((bumpedAt - firedAt) / 1000)
  if (observed < 60 || observed > 45 * 60) return null
  if (observed < longest * 0.4 || observed > longest * 3) return null
  return { menuItemId: [...ids][0] as string, observedSeconds: observed }
}

/** Moving average update. */
export function learn(prev: number | null, samples: number, observed: number): { learnedPrepSeconds: number; learnedSamples: number } {
  const next = prev && samples > 0 ? Math.round(prev * (1 - ALPHA) + observed * ALPHA) : observed
  return { learnedPrepSeconds: next, learnedSamples: samples + 1 }
}
