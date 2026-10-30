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
}

type Q = Pick<ItemView, 'id' | 'path' | 'method' | 'state' | 'recordKey' | 'body' | 'refusal' | 'lastError'>

export function clockView(active: { clockIn?: string } | null, queue: Q[], userId: string): ClockView {
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
  return {
    state, since, waiting: state === 'in_waiting' || state === 'out_waiting', refused,
    canClockIn: state === 'out' || state === 'out_waiting',
    canClockOut: state === 'in' || state === 'in_waiting',
  }
}

/** A tap's body: the moment it was made, so a send later records when the work started or stopped. */
export const tapBody = (now: Date, extra: Record<string, unknown> = {}) => ({ ...extra, at: now.toISOString() })
