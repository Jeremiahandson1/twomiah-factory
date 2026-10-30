// Availability and shift swaps (restaurant-bar-depth #10; 7shifts' availability and shift pool/swap, Toast's schedule
// swaps). Against the database; the arithmetic is barAvailability.ts and barSchedulePlan.ts.
//
//   · AVAILABILITY. A person submits the windows they can work; a manager approves or denies; a manager can set anyone's
//     directly. The week grid flags a shift outside someone's windows (it warns, it never blocks: a manager decides).
//   · SHIFT REQUESTS. 'give': put a shift up for anyone; a colleague claims it. 'swap': offer it to one person for one of
//     theirs; they accept. Either way a MANAGER approves before anything moves, and approving moves it: the shift (or
//     both) changes hands, the published copy staff see changes with it, and nothing is double-booked or on a day off.
//   · A person only ever acts on their own shifts; a manager decides (bar:update).
import { and, asc, eq, gte, inArray, ne, or } from 'drizzle-orm'
import { barAvailability, barScheduleShift, barScheduleWeek, barShiftRequest, barTimeOff, user } from '../../db/schema/index.ts'
import { addDays } from './barHours.ts'
import { businessDayOf } from './barLive.ts'
import { DAY_NAMES, cleanWindows, windowsRefusal, worksWithin, type Window } from './barAvailability.ts'
import { shiftSpan, workweekStart } from './barSchedulePlan.ts'
import type { Actor } from './barManagers.ts'
import type { BarDb } from './db.ts'
import type { BarSchedule } from './barSchedule.ts'
import { RotaError } from './barSchedule.ts'

const nameOf = (u: { firstName: string; lastName: string; email: string }) => [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email
const clean = (v: unknown, n: number) => { const s = String(v ?? '').trim().slice(0, n); return s || null }
const LIVE = ['open', 'offered', 'pending']

type Mail = { to: string; subject: string; html: string }
export function createBarStaffRequests(db: BarDb, schedule: BarSchedule, sendRaw?: (m: Mail) => Promise<unknown>, businessEmail?: (companyId: string) => Promise<string | null>) {
  /** A short plain email, best effort: a mail that will not send never blocks the request (7shifts tells managers and both staff). */
  async function tell(to: string | null | undefined, subject: string, line: string) {
    if (!sendRaw || !to) return
    try { await sendRaw({ to, subject, html: `<p>${line.replace(/[<>&]/g, '')}</p><p>Open the Schedule to see it.</p>` }) } catch { /* the request stands */ }
  }
  async function emailOf(userId: string): Promise<string | null> {
    const [u] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1)
    return u?.email ?? null
  }
  async function tellManagers(companyId: string, subject: string, line: string) { await tell(businessEmail ? await businessEmail(companyId) : null, subject, line) }

  async function today(companyId: string) { const { tz } = await schedule.weekFor(companyId); return { tz, today: businessDayOf(new Date(), tz) } }
  async function names(companyId: string, ids: string[]) {
    if (!ids.length) return new Map<string, string>()
    const rows = await db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email }).from(user).where(and(eq(user.companyId, companyId), inArray(user.id, ids)))
    return new Map(rows.map((u) => [u.id, nameOf(u)]))
  }

  // ─── Availability ──────────────────────────────────────────────────────────────────────────────────────────
  async function windowsOf(companyId: string, userId: string, status: 'approved' | 'pending'): Promise<Window[]> {
    const rows = await db.select().from(barAvailability).where(and(eq(barAvailability.companyId, companyId), eq(barAvailability.userId, userId), eq(barAvailability.status, status))).orderBy(asc(barAvailability.dow), asc(barAvailability.startTime))
    return rows.map((r) => ({ dow: r.dow, start: r.startTime, end: r.endTime }))
  }

  async function mineAvailability(actor: Actor) {
    const [approved, pending] = await Promise.all([windowsOf(actor.companyId, actor.id as string, 'approved'), windowsOf(actor.companyId, actor.id as string, 'pending')])
    return { approved, pending: pending.length ? pending : null }
  }

  async function write(companyId: string, userId: string, windows: Window[], status: 'approved' | 'pending', by: string | null) {
    await db.transaction(async (tx: any) => {
      // A fresh submission replaces any earlier one waiting; an approved set replaces the approved set (and clears anything waiting).
      await tx.delete(barAvailability).where(and(eq(barAvailability.companyId, companyId), eq(barAvailability.userId, userId), eq(barAvailability.status, 'pending')))
      if (status === 'approved') await tx.delete(barAvailability).where(and(eq(barAvailability.companyId, companyId), eq(barAvailability.userId, userId), eq(barAvailability.status, 'approved')))
      if (windows.length) await tx.insert(barAvailability).values(windows.map((w) => ({ companyId, userId, dow: w.dow, startTime: w.start, endTime: w.end, status, decidedByName: status === 'approved' ? by : null, decidedAt: status === 'approved' ? new Date() : null })))
    })
  }

  /** I submit my windows; a manager decides. Sending none asks to be free any time. */
  async function submitAvailability(actor: Actor, raw: unknown) {
    const windows = cleanWindows(raw)
    const bad = windowsRefusal(windows); if (bad) throw new RotaError(bad)
    await write(actor.companyId, actor.id as string, windows, 'pending', null)
    // Asking for "any time" is a pending row with no windows; kept as a marker so a manager sees the request.
    if (!windows.length) await db.insert(barAvailability).values({ companyId: actor.companyId, userId: actor.id as string, dow: 0, startTime: '00:00', endTime: '23:59', status: 'pending', decidedByName: 'ANY' })
    await tellManagers(actor.companyId, 'Availability change to approve', `${actor.name} asked to change when they can work.`)
    return mineAvailability(actor)
  }

  /** A manager sets someone's availability outright. */
  async function setAvailability(actor: Actor, userId: string, raw: unknown) {
    const windows = cleanWindows(raw)
    const bad = windowsRefusal(windows); if (bad) throw new RotaError(bad)
    const [u] = await db.select({ id: user.id }).from(user).where(and(eq(user.id, userId), eq(user.companyId, actor.companyId))).limit(1)
    if (!u) throw new RotaError('Who is that?', 404)
    await write(actor.companyId, userId, windows, 'approved', actor.name)
    return { windows: await windowsOf(actor.companyId, userId, 'approved') }
  }

  async function decideAvailability(actor: Actor, userId: string, status: unknown) {
    if (status !== 'approved' && status !== 'denied') throw new RotaError('Approve or deny?')
    const rows = await db.select().from(barAvailability).where(and(eq(barAvailability.companyId, actor.companyId), eq(barAvailability.userId, userId), eq(barAvailability.status, 'pending')))
    if (!rows.length) throw new RotaError('There is nothing waiting for that person.', 404)
    const anytime = rows.some((r) => r.decidedByName === 'ANY')
    if (status === 'denied') {
      await db.delete(barAvailability).where(and(eq(barAvailability.companyId, actor.companyId), eq(barAvailability.userId, userId), eq(barAvailability.status, 'pending')))
      await tell(await emailOf(userId), 'Your availability change was not approved', `${actor.name} did not approve your availability change. What was approved before still applies.`)
      return { windows: await windowsOf(actor.companyId, userId, 'approved') }
    }
    await write(actor.companyId, userId, anytime ? [] : rows.map((r) => ({ dow: r.dow, start: r.startTime, end: r.endTime })), 'approved', actor.name)
    await tell(await emailOf(userId), 'Your availability was approved', `${actor.name} approved your availability change.`)
    return { windows: await windowsOf(actor.companyId, userId, 'approved') }
  }

  /** Everyone's availability, for a manager: the approved windows and anything waiting. */
  async function allAvailability(companyId: string) {
    const [rows, people] = await Promise.all([
      db.select().from(barAvailability).where(eq(barAvailability.companyId, companyId)).orderBy(asc(barAvailability.dow), asc(barAvailability.startTime)),
      db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, isActive: user.isActive }).from(user).where(and(eq(user.companyId, companyId), eq(user.isActive, true))).orderBy(asc(user.firstName)),
    ])
    return {
      days: DAY_NAMES,
      people: people.map((p) => {
        const mine = rows.filter((r) => r.userId === p.id)
        const pending = mine.filter((r) => r.status === 'pending')
        return {
          userId: p.id, name: nameOf(p),
          windows: mine.filter((r) => r.status === 'approved').map((r) => ({ dow: r.dow, start: r.startTime, end: r.endTime })),
          pending: pending.length ? (pending.some((r) => r.decidedByName === 'ANY') ? [] : pending.map((r) => ({ dow: r.dow, start: r.startTime, end: r.endTime }))) : null,
        }
      }),
    }
  }

  /** Approved windows of these people, for the week grid's "outside availability" flag. */
  async function approvedFor(companyId: string, userIds: string[]): Promise<Map<string, Window[]>> {
    const out = new Map<string, Window[]>()
    if (!userIds.length) return out
    const rows = await db.select().from(barAvailability).where(and(eq(barAvailability.companyId, companyId), eq(barAvailability.status, 'approved'), inArray(barAvailability.userId, userIds)))
    for (const r of rows) out.set(r.userId, [...(out.get(r.userId) || []), { dow: r.dow, start: r.startTime, end: r.endTime }])
    return out
  }

  /** "Amy can't work Tuesday evenings" for a shift being placed; null when it fits (or the feature is off — the caller asks). */
  async function availabilityWarning(companyId: string, s: { userId: string; day: string; start: string; end: string }): Promise<string | null> {
    const ws = (await approvedFor(companyId, [s.userId])).get(s.userId) || []
    if (worksWithin(ws, s.day, s.start, s.end)) return null
    const n = (await names(companyId, [s.userId])).get(s.userId) || 'They'
    return `${n} said they cannot work then. It is scheduled anyway.`
  }

  // ─── Shift requests ────────────────────────────────────────────────────────────────────────────────────────
  /** My own shift, by its id or by its day and start; it has to be today or later. */
  async function myShift(actor: Actor, b: Record<string, unknown>) {
    const where = b.shiftId
      ? and(eq(barScheduleShift.id, String(b.shiftId)), eq(barScheduleShift.companyId, actor.companyId))
      : and(eq(barScheduleShift.companyId, actor.companyId), eq(barScheduleShift.userId, actor.id as string), eq(barScheduleShift.day, String(b.day || '')), eq(barScheduleShift.start, String(b.start || '')))
    const [s] = await db.select().from(barScheduleShift).where(where).limit(1)
    if (!s || s.userId !== actor.id) throw new RotaError('That is not one of your shifts.', 404)
    if (s.day < (await today(actor.companyId)).today) throw new RotaError("That shift's already gone.")
    return s
  }

  async function createRequest(actor: Actor, b: Record<string, unknown>) {
    const kind = b.kind === 'swap' ? 'swap' : b.kind === 'give' ? 'give' : null
    if (!kind) throw new RotaError('Give the shift away, or swap it?')
    const s = await myShift(actor, b)
    const [live] = await db.select({ id: barShiftRequest.id }).from(barShiftRequest).where(and(eq(barShiftRequest.shiftId, s.id), inArray(barShiftRequest.status, LIVE))).limit(1)
    if (live) throw new RotaError('That shift already has a request.', 409)
    if (kind === 'give') {
      const [row] = await db.insert(barShiftRequest).values({ kind, shiftId: s.id, fromUserId: actor.id as string, status: 'open', note: clean(b.note, 200), companyId: actor.companyId }).returning()
      return row
    }
    const [other] = await db.select().from(barScheduleShift).where(and(eq(barScheduleShift.id, String(b.withShiftId || '')), eq(barScheduleShift.companyId, actor.companyId))).limit(1)
    if (!other) throw new RotaError('Pick the shift you want in return.', 404)
    if (other.userId === actor.id) throw new RotaError('That is your own shift.')
    if (other.day < (await today(actor.companyId)).today) throw new RotaError("That shift's already gone.")
    const [theirs] = await db.select({ id: barShiftRequest.id }).from(barShiftRequest).where(and(or(eq(barShiftRequest.shiftId, other.id), eq(barShiftRequest.withShiftId, other.id)), inArray(barShiftRequest.status, LIVE))).limit(1)
    if (theirs) throw new RotaError('That shift is already in a request.', 409)
    const [row] = await db.insert(barShiftRequest).values({ kind, shiftId: s.id, withShiftId: other.id, fromUserId: actor.id as string, toUserId: other.userId, status: 'offered', note: clean(b.note, 200), companyId: actor.companyId }).returning()
    await tell(await emailOf(other.userId), 'A shift swap is offered to you', `${actor.name} offered ${s.day} ${s.start}-${s.end} in exchange for your ${other.day} ${other.start}-${other.end}.`)
    return row
  }

  async function load(companyId: string, id: string) {
    const [r] = await db.select().from(barShiftRequest).where(and(eq(barShiftRequest.id, id), eq(barShiftRequest.companyId, companyId))).limit(1)
    if (!r) throw new RotaError('That request is gone.', 404)
    return r
  }

  /** A colleague takes an open shift: it now waits for a manager. */
  async function claim(actor: Actor, id: string) {
    const r = await load(actor.companyId, id)
    if (r.kind !== 'give' || r.status !== 'open') throw new RotaError('That shift is no longer on offer.', 409)
    if (r.fromUserId === actor.id) throw new RotaError('That is your own shift.')
    const [s] = await db.select().from(barScheduleShift).where(eq(barScheduleShift.id, r.shiftId)).limit(1)
    if (!s || s.day < (await today(actor.companyId)).today) throw new RotaError("That shift's already gone.", 409)
    const [row] = await db.update(barShiftRequest).set({ toUserId: actor.id as string, status: 'pending', updatedAt: new Date() }).where(and(eq(barShiftRequest.id, id), eq(barShiftRequest.status, 'open'))).returning()
    if (!row) throw new RotaError('Someone just took it.', 409)
    await tellManagers(actor.companyId, 'A shift swap to approve', `${actor.name} will take ${s.day} ${s.start}-${s.end}. It needs a manager's approval.`)
    await tell(await emailOf(r.fromUserId), 'Someone will take your shift', `${actor.name} will take your ${s.day} ${s.start}-${s.end} shift. A manager still has to approve it.`)
    return row
  }

  /** The person a swap was offered to says yes or no. */
  async function respond(actor: Actor, id: string, accept: boolean) {
    const r = await load(actor.companyId, id)
    if (r.kind !== 'swap' || r.status !== 'offered' || r.toUserId !== actor.id) throw new RotaError('That swap is not waiting for you.', 409)
    const [row] = await db.update(barShiftRequest).set({ status: accept ? 'pending' : 'declined', updatedAt: new Date() }).where(and(eq(barShiftRequest.id, id), eq(barShiftRequest.status, 'offered'))).returning()
    if (!row) throw new RotaError('That swap has changed.', 409)
    if (accept) await tellManagers(actor.companyId, 'A shift swap to approve', `${actor.name} accepted a swap. It needs a manager's approval.`)
    else await tell(await emailOf(r.fromUserId), 'Your swap was declined', `${actor.name} declined the swap you offered.`)
    return row
  }

  /** The person who asked takes it back, any time before a manager decides. */
  async function cancel(actor: Actor, id: string) {
    const r = await load(actor.companyId, id)
    if (r.fromUserId !== actor.id) throw new RotaError('Only the person who asked can take it back.', 403)
    if (!LIVE.includes(r.status)) throw new RotaError('That request is already settled.', 409)
    const [row] = await db.update(barShiftRequest).set({ status: 'cancelled', updatedAt: new Date() }).where(and(eq(barShiftRequest.id, id), inArray(barShiftRequest.status, LIVE))).returning()
    return row
  }

  async function view(companyId: string, rows: Array<typeof barShiftRequest.$inferSelect>) {
    const shiftIds = [...new Set(rows.flatMap((r) => [r.shiftId, r.withShiftId].filter(Boolean) as string[]))]
    const shifts = shiftIds.length ? await db.select().from(barScheduleShift).where(inArray(barScheduleShift.id, shiftIds)) : []
    const nm = await names(companyId, [...new Set(rows.flatMap((r) => [r.fromUserId, r.toUserId].filter(Boolean) as string[]))])
    const sh = new Map(shifts.map((s) => [s.id, { id: s.id, day: s.day, start: s.start, end: s.end, position: s.position }]))
    return rows.map((r) => ({ id: r.id, kind: r.kind, status: r.status, note: r.note, fromUserId: r.fromUserId, fromName: nm.get(r.fromUserId) || '?', toUserId: r.toUserId, toName: r.toUserId ? nm.get(r.toUserId) || '?' : null, shift: sh.get(r.shiftId) || null, withShift: r.withShiftId ? sh.get(r.withShiftId) || null : null, decidedByName: r.decidedByName, createdAt: r.createdAt.toISOString() }))
  }

  /** What a person sees: their own requests, swaps offered to them, and shifts on offer that they could take. */
  async function mine(actor: Actor) {
    const { today: t } = await today(actor.companyId)
    const rows = await db.select().from(barShiftRequest).where(and(eq(barShiftRequest.companyId, actor.companyId), or(eq(barShiftRequest.fromUserId, actor.id as string), eq(barShiftRequest.toUserId, actor.id as string), eq(barShiftRequest.status, 'open')))).orderBy(asc(barShiftRequest.createdAt))
    const all = await view(actor.companyId, rows)
    const keep = (x: (typeof all)[number]) => x.shift && x.shift.day >= t
    return {
      mine: all.filter((x) => x.fromUserId === actor.id && keep(x)),
      forMe: all.filter((x) => x.toUserId === actor.id && x.fromUserId !== actor.id && x.status === 'offered' && keep(x)),
      onOffer: all.filter((x) => x.kind === 'give' && x.status === 'open' && x.fromUserId !== actor.id && keep(x)),
    }
  }

  /** For a manager: what waits for a decision, and the last few settled. */
  async function toDecide(companyId: string, onlyPending = false) {
    const rows = await db.select().from(barShiftRequest).where(and(eq(barShiftRequest.companyId, companyId), onlyPending ? eq(barShiftRequest.status, 'pending') : ne(barShiftRequest.status, 'cancelled'))).orderBy(asc(barShiftRequest.createdAt))
    const all = await view(companyId, rows)
    return { pending: all.filter((x) => x.status === 'pending'), open: all.filter((x) => x.status === 'open' || x.status === 'offered'), recent: onlyPending ? [] : all.filter((x) => ['approved', 'denied', 'declined'].includes(x.status)).slice(-20).reverse() }
  }

  /** Can this person take this shift: not on an approved day off, not double-booked. Returns the reasons, empty when fine. */
  async function conflictsFor(tx: any, companyId: string, userId: string, s: { id: string; day: string; start: string; end: string }, leaving: string[], tz: string) {
    const why: string[] = []
    const [u] = await tx.select({ isActive: user.isActive }).from(user).where(and(eq(user.id, userId), eq(user.companyId, companyId))).limit(1)
    if (!u?.isActive) why.push('they are no longer on the team')
    const [off] = await tx.select({ id: barTimeOff.id }).from(barTimeOff).where(and(eq(barTimeOff.companyId, companyId), eq(barTimeOff.userId, userId), eq(barTimeOff.day, s.day), eq(barTimeOff.status, 'approved'))).limit(1)
    if (off) why.push('they have that day off')
    const near = await tx.select().from(barScheduleShift).where(and(eq(barScheduleShift.companyId, companyId), eq(barScheduleShift.userId, userId), inArray(barScheduleShift.day, [addDays(s.day, -1), s.day, addDays(s.day, 1)])))
    const me = shiftSpan(s.day, s.start, s.end, tz)
    for (const o of near) {
      if (leaving.includes(o.id)) continue
      const sp = shiftSpan(o.day, o.start, o.end, tz)
      if (sp.a.getTime() < me.b.getTime() && me.a.getTime() < sp.b.getTime()) { why.push('it overlaps a shift they already have'); break }
    }
    return why
  }

  /** The published copy staff see: the same people, the same shifts, with the swap applied. */
  async function patchPublished(tx: any, companyId: string, moves: Array<{ day: string; start: string; end: string; fromUserId: string; toUserId: string; toName: string }>) {
    const weeks = [...new Set(moves.map((m) => workweekStart(m.day)))]
    const rows = await tx.select().from(barScheduleWeek).where(and(eq(barScheduleWeek.companyId, companyId), inArray(barScheduleWeek.weekStart, weeks)))
    for (const w of rows) {
      if (!Array.isArray(w.snapshot)) continue
      const snap = (w.snapshot as any[]).map((e) => {
        const m = moves.find((x) => x.day === e.day && x.start === e.start && x.end === e.end && x.fromUserId === e.userId)
        return m ? { ...e, userId: m.toUserId, name: m.toName } : e
      })
      await tx.update(barScheduleWeek).set({ snapshot: snap }).where(eq(barScheduleWeek.id, w.id))
    }
  }

  /** A manager approves (the shift or shifts change hands) or denies. */
  async function decide(actor: Actor, id: string, status: unknown) {
    if (status !== 'approved' && status !== 'denied') throw new RotaError('Approve or deny?')
    const { tz, today: t } = await today(actor.companyId)
    // Read outside the transaction (an outside read inside one deadlocks a one-connection database): who they are and what they said they can work.
    const peek = await load(actor.companyId, id)
    const nm = await names(actor.companyId, [peek.fromUserId, ...(peek.toUserId ? [peek.toUserId] : [])])
    const av = await approvedFor(actor.companyId, [peek.fromUserId, ...(peek.toUserId ? [peek.toUserId] : [])])
    const result = await db.transaction(async (tx: any) => {
      const [r] = await tx.select().from(barShiftRequest).where(and(eq(barShiftRequest.id, id), eq(barShiftRequest.companyId, actor.companyId))).limit(1).for('update')
      if (!r) throw new RotaError('That request is gone.', 404)
      if (r.status !== 'pending') throw new RotaError(r.status === 'approved' || r.status === 'denied' ? 'That was already decided.' : 'That is not ready for a decision yet.', 409)
      if (status === 'denied') {
        const [row] = await tx.update(barShiftRequest).set({ status: 'denied', decidedByName: actor.name, decidedAt: new Date(), updatedAt: new Date() }).where(eq(barShiftRequest.id, id)).returning()
        return { request: row, warnings: [] as string[] }
      }
      const [s1] = await tx.select().from(barScheduleShift).where(eq(barScheduleShift.id, r.shiftId)).limit(1).for('update')
      const s2 = r.withShiftId ? (await tx.select().from(barScheduleShift).where(eq(barScheduleShift.id, r.withShiftId)).limit(1).for('update'))[0] : null
      if (!s1 || s1.userId !== r.fromUserId || (r.kind === 'swap' && (!s2 || s2.userId !== r.toUserId))) throw new RotaError('A shift in this request has changed since it was asked. Deny it and ask again.', 409)
      if (s1.day < t || (s2 && s2.day < t)) throw new RotaError("That shift's already gone.", 409)
      if (!r.toUserId) throw new RotaError('Nobody has taken it yet.', 409)
      const moving = [s1.id, ...(s2 ? [s2.id] : [])]
      const problems = [
        ...(await conflictsFor(tx, actor.companyId, r.toUserId, s1, moving, tz)).map((x: string) => `Cannot move it: ${x}.`),
        ...(s2 ? (await conflictsFor(tx, actor.companyId, r.fromUserId, s2, moving, tz)).map((x: string) => `Cannot move the swap: ${x}.`) : []),
      ]
      if (problems.length) throw new RotaError(problems[0], 409)
      await tx.update(barScheduleShift).set({ userId: r.toUserId, updatedAt: new Date() }).where(eq(barScheduleShift.id, s1.id))
      if (s2) await tx.update(barScheduleShift).set({ userId: r.fromUserId, updatedAt: new Date() }).where(eq(barScheduleShift.id, s2.id))
      await patchPublished(tx, actor.companyId, [
        { day: s1.day, start: s1.start, end: s1.end, fromUserId: r.fromUserId, toUserId: r.toUserId, toName: nm.get(r.toUserId) || '?' },
        ...(s2 ? [{ day: s2.day, start: s2.start, end: s2.end, fromUserId: r.toUserId, toUserId: r.fromUserId, toName: nm.get(r.fromUserId) || '?' }] : []),
      ])
      const [row] = await tx.update(barShiftRequest).set({ status: 'approved', decidedByName: actor.name, decidedAt: new Date(), updatedAt: new Date() }).where(eq(barShiftRequest.id, id)).returning()
      // Availability only warns: the manager is told, and has already decided.
      const warnings: string[] = []
      for (const [uid, sh] of [[r.toUserId, s1], ...(s2 ? [[r.fromUserId, s2]] : [])] as Array<[string, typeof s1]>) {
        const ws = av.get(uid) || []
        if (!worksWithin(ws, sh.day, sh.start, sh.end)) warnings.push(`${nm.get(uid) || 'They'} said they cannot work ${sh.day} ${sh.start}-${sh.end}.`)
      }
      return { request: row, warnings }
    })
    // Both people are told what was decided (outside the transaction, best effort).
    const word = status === 'approved' ? 'approved' : 'not approved'
    for (const uid of [peek.fromUserId, peek.toUserId]) if (uid) await tell(await emailOf(uid), `Your shift swap was ${word}`, `${actor.name} ${word === 'approved' ? 'approved' : 'did not approve'} the shift ${peek.kind === 'swap' ? 'swap' : 'change'}.${word === 'approved' ? ' The schedule is updated.' : ' Nothing changed on the schedule.'}`)
    return result
  }

  return { mineAvailability, submitAvailability, setAvailability, decideAvailability, allAvailability, approvedFor, availabilityWarning, createRequest, claim, respond, cancel, mine, toDecide, decide }
}
export type BarStaffRequests = ReturnType<typeof createBarStaffRequests>
