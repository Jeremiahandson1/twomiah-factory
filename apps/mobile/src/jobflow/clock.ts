/**
 * The trades' Clock screen as a pure rule: what the clock shows given what the server last said (GET /api/time/active) and
 * what is waiting on the phone to be sent (../offline). Tested by tests/mobile/job-flow.test.ts.
 *
 * A clock tap made with no signal is kept with the moment it was TAPPED (`at`), which the server honours for up to 48 hours
 * (packages/tenant-backend time/time.ts), so the hours are those worked, not those between the phone and the server.
 * The record key is `clock:<userId>`: a clock-in and the clock-out after it go in order.
 */
import type { ItemView } from '../offline/engine'

export const clockKey = (userId: string) => `clock:${userId}`
const IN = '/api/time/clock-in'
const OUT = '/api/time/clock-out'
const BREAK_START = '/api/time/break/start'
const BREAK_END = '/api/time/break/end'

export type ClockState = 'out' | 'in' | 'in_waiting' | 'out_waiting'
export interface ClockView {
  state: ClockState
  /** When the open clock started (ISO): the server's, or the moment tapped while waiting to send. */
  since: string | null
  /** The tap that has not been sent yet. */
  waiting: boolean
  /** A refused clock tap, in the server's words — and the id of the save to retry or drop. */
  refused: { id: string; message: string } | null
  /** Clock in is offered / clock out is offered. */
  canClockIn: boolean
  canClockOut: boolean
  /** On a break (the server's, or one tapped and not sent yet), and since when (ISO). */
  onBreak: boolean
  breakSince: string | null
  /** Start break is offered while clocked in and not on one; End break while on one. */
  canStartBreak: boolean
  canEndBreak: boolean
}

type Q = Pick<ItemView, 'id' | 'path' | 'method' | 'state' | 'recordKey' | 'body' | 'refusal' | 'lastError'>

export function clockView(active: { clockIn?: string; breakStartedAt?: string | null } | null, queue: Q[], userId: string): ClockView {
  const mine = queue.filter((q) => q.recordKey === clockKey(userId) && q.method === 'POST')
  const failed = mine.find((q) => q.state === 'failed')
  const refused = failed ? { id: failed.id, message: failed.refusal?.message || failed.lastError || "Couldn't send" } : null
  const live = mine.filter((q) => q.state !== 'failed')
  const lastIn = [...live].reverse().find((q) => q.path === IN)
  const lastOut = [...live].reverse().find((q) => q.path === OUT)
  const tapped = (q?: Q) => (q?.body as { at?: string } | undefined)?.at ?? null

  let state: ClockState = active ? 'in' : 'out'
  let since: string | null = active?.clockIn ?? null
  if (!active && lastIn) { state = 'in_waiting'; since = tapped(lastIn) }
  if (lastOut && (active || lastIn)) {
    // Clocked out on the phone, not sent yet: the clock is closed for now.
    const outAfterIn = !lastIn || mine.indexOf(lastOut) > mine.indexOf(lastIn)
    if (outAfterIn) { state = 'out_waiting'; since = null }
  }
  // A break: the last break tap waiting to be sent decides (start = on one, end = off); otherwise what the server says.
  // A closed clock has no break.
  const open = state === 'in' || state === 'in_waiting'
  const lastBreak = [...live].reverse().find((q) => q.path === BREAK_START || q.path === BREAK_END)
  const afterIn = lastBreak && (!lastIn || mine.indexOf(lastBreak) > mine.indexOf(lastIn))
  let onBreak = open && !!active?.breakStartedAt
  let breakSince: string | null = onBreak ? active!.breakStartedAt ?? null : null
  if (open && lastBreak && afterIn) { onBreak = lastBreak.path === BREAK_START; breakSince = onBreak ? tapped(lastBreak) : null }
  return {
    state, since, waiting: state === 'in_waiting' || state === 'out_waiting', refused,
    canClockIn: state === 'out' || state === 'out_waiting',
    canClockOut: state === 'in' || state === 'in_waiting',
    onBreak, breakSince, canStartBreak: open && !onBreak, canEndBreak: open && onBreak,
  }
}

/** A tap's body: the moment it was made, so a send later records when the work started or stopped. */
export const tapBody = (now: Date, extra: Record<string, unknown> = {}) => ({ ...extra, at: now.toISOString() })

/**
 * Where the phone was at a tap, as the body the server reads (`place`), or nothing when there is no usable fix. Both numbers on
 * the earth or neither — the server refuses half a place, and a clock tap must never be refused over a bad fix.
 */
export function placeBody(pos: { latitude?: unknown; longitude?: unknown } | null | undefined): { place?: { lat: number; lng: number } } {
  const lat = Number(pos?.latitude), lng = Number(pos?.longitude)
  if (pos?.latitude == null || pos?.longitude == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return {}
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return {}
  return { place: { lat, lng } }
}
