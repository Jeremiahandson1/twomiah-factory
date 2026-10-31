// Team time off and business closed periods (salon parity row 3; Fresha team time off and closed dates; feature `book_grid`).
//
//   · TIME OFF is one stylist's, of any length (a block is capped at 14 days). A stylist asks for their own; a manager decides. A manager who
//     enters it for someone is deciding it, so it starts approved. Only an APPROVED one takes the chair off the Book and out of online booking.
//   · A CLOSED PERIOD is whole days the salon is shut — every chair, online booking too. Only a manager sets one.
//   · Both are drawn on the Book (bookBlocks.ts GET), warn the desk before it books over them (findOff, used by findBlock), and are refused online
//     (onlineBooking.ts). Making or approving one lists the appointments already booked inside it, for the manager to move — said, never refused.
//   · Paid or unpaid carries to the hours report: GET /hours, per stylist, from approved time off and from blocks made from a paid/unpaid type.
//
// "A manager" is a seat that sees the whole Book (schedule:read-all) and can change the schedule (schedule:update): managers, admins, the owner.
// A stylist holds schedule:update but never read-all, so cannot decide their own; the front desk holds read-all but not update.
import { Hono } from 'hono'
import { and, asc, eq, gt, gte, inArray, lt, lte } from 'drizzle-orm'
import { companyTimeZone, tzParts, addDays, zonedWallTimeToUtc, isRealCalendarDay, isRealDate } from '@twomiah/tenant-backend'
import { appointment, appointmentItem, bookBlock, contact, salonClosedPeriod, salonTimeOff, serviceMenu, teamMember, user } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { resolveStylist, stylistIdOf, unknownStylist, type StylistRef } from './people.ts'
import type { SalonServices } from './services.ts'

const CANCELLED = ['cancelled', 'no_show']
const DAY_MS = 86_400_000
const MAX_OFF_MS = 366 * DAY_MS
const MAX_CLOSED_DAYS = 366

export type OffSpan = { id: string; stylistId: string | null; stylistMemberId: string | null; start: Date; end: Date; reason: string; kind: 'time_off' | 'closed' }

/** A closed period as the instants it covers on the company's clock: midnight of its first day to midnight after its last. */
export function closedSpan(p: { startDate: string; endDate: string }, tz: string): { start: Date; end: Date } {
  return { start: zonedWallTimeToUtc(p.startDate, '00:00', tz), end: zonedWallTimeToUtc(addDays(p.endDate, 1), '00:00', tz) }
}

/** Every approved time off and closed period touching [from, to): what takes a chair away besides a block. `exec` may be a transaction. */
export async function offSpans(exec: any, companyId: string, from: Date, to: Date): Promise<OffSpan[]> {
  const tz = await companyTimeZone(exec, companyId)
  const out: OffSpan[] = []
  const offs: any[] = await exec.select({ o: salonTimeOff, first: user.firstName, member: teamMember.name }).from(salonTimeOff)
    .leftJoin(user, eq(user.id, salonTimeOff.stylistId)).leftJoin(teamMember, eq(teamMember.id, salonTimeOff.stylistMemberId))
    .where(and(eq(salonTimeOff.companyId, companyId), eq(salonTimeOff.status, 'approved'), lt(salonTimeOff.startTime, to), gt(salonTimeOff.endTime, from)))
  for (const r of offs) {
    const who = r.first || String(r.member || '').trim().split(/\s+/)[0] || 'The stylist'
    out.push({ id: r.o.id, stylistId: r.o.stylistId, stylistMemberId: r.o.stylistMemberId, start: new Date(r.o.startTime), end: new Date(r.o.endTime), reason: `${who} is off${r.o.reason ? `: ${r.o.reason}` : ''}`, kind: 'time_off' })
  }
  // A day either side, so a period whose instants straddle the window by the zone's offset is still found; the instants decide.
  const lo = addDays(tzParts(from, tz).date, -1), hi = addDays(tzParts(to, tz).date, 1)
  const closed: any[] = await exec.select().from(salonClosedPeriod).where(and(eq(salonClosedPeriod.companyId, companyId), lte(salonClosedPeriod.startDate, hi), gte(salonClosedPeriod.endDate, lo)))
  for (const p of closed) {
    const sp = closedSpan(p, tz)
    if (sp.start < to && sp.end > from) out.push({ id: p.id, stylistId: null, stylistMemberId: null, ...sp, reason: `The salon is closed: ${p.name}`, kind: 'closed' })
  }
  return out
}

/** The first time off or closed period that covers any of these stretches for these stylists (a closed period covers everyone), or undefined. */
export async function findOff(exec: any, companyId: string, spans: Array<{ stylist: StylistRef; start: Date; end: Date }>): Promise<OffSpan | undefined> {
  if (!spans.length) return undefined
  const from = new Date(Math.min(...spans.map((s) => s.start.getTime()))), to = new Date(Math.max(...spans.map((s) => s.end.getTime())))
  const all = await offSpans(exec, companyId, from, to)
  for (const sp of spans) {
    const hit = all.find((o) => o.start < sp.end && o.end > sp.start
      && (o.kind === 'closed' || (!!o.stylistId && o.stylistId === sp.stylist.stylistId) || (!!o.stylistMemberId && o.stylistMemberId === sp.stylist.stylistMemberId)))
    if (hit) return hit
  }
  return undefined
}

export type Affected = { id: string; startTime: string; clientName: string | null; serviceName: string | null; stylistId: string | null }

/** The appointments already booked inside a stretch for one stylist (or for everyone when `ref` is null) — what a manager has to move. */
export async function appointmentsInside(db: any, companyId: string, ref: StylistRef | null, start: Date, end: Date): Promise<Affected[]> {
  const rows: any[] = await db.select({ a: appointment, client: contact.name, service: serviceMenu.name }).from(appointment)
    .leftJoin(contact, eq(contact.id, appointment.contactId)).leftJoin(serviceMenu, eq(serviceMenu.id, appointment.serviceId))
    .where(and(eq(appointment.companyId, companyId), lt(appointment.startTime, end), gt(appointment.startTime, new Date(start.getTime() - DAY_MS))))
  const live = rows.filter((r) => !CANCELLED.includes(r.a.status))
  const items: any[] = live.length ? await db.select().from(appointmentItem).where(and(eq(appointmentItem.companyId, companyId), inArray(appointmentItem.appointmentId, live.map((r) => r.a.id)))) : []
  const itemised = new Set(items.map((i) => i.appointmentId))
  const heldBy = (sid: string | null, mid: string | null) => !ref || (!!ref.stylistId && sid === ref.stylistId) || (!!ref.stylistMemberId && mid === ref.stylistMemberId)
  const out = new Map<string, Affected>()
  const add = (r: any, sid: string | null, mid: string | null) => out.set(r.a.id, { id: r.a.id, startTime: new Date(r.a.startTime).toISOString(), clientName: r.client ?? null, serviceName: r.service ?? null, stylistId: sid ?? mid })
  for (const r of live) {
    if (itemised.has(r.a.id)) continue
    const rs = new Date(r.a.startTime).getTime(), re = r.a.endTime ? new Date(r.a.endTime).getTime() : rs + 3600_000
    if (heldBy(r.a.stylistId, r.a.stylistMemberId) && rs < end.getTime() && re > start.getTime()) add(r, r.a.stylistId, r.a.stylistMemberId)
  }
  for (const it of items) {
    const r = live.find((x) => x.a.id === it.appointmentId)
    if (!r) continue
    const is = new Date(r.a.startTime).getTime() + it.startOffsetMin * 60_000, ie = is + it.durationMin * 60_000
    if (heldBy(it.stylistId, it.stylistMemberId) && is < end.getTime() && ie > start.getTime()) add(r, it.stylistId, it.stylistMemberId)
  }
  return [...out.values()].sort((a, b) => a.startTime.localeCompare(b.startTime))
}

/** Minutes of [a, b) that fall inside [from, to). */
const clipMin = (a: Date, b: Date, from: Date, to: Date) => Math.max(0, (Math.min(b.getTime(), to.getTime()) - Math.max(a.getTime(), from.getTime())) / 60_000)

export function createTimeOffRoutes(d: CrmDeps, salon: SalonServices) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const live = d.realtime
  const app = new Hono<AppEnv>()
  const refresh = (companyId: string) => live.emitToCompany(companyId, live.EVENTS.REFRESH, { entity: 'appointment' })
  /** A manager: sees the whole Book and can change the schedule. */
  const mayDecide = async (u: any) => (await salon.book.seesWholeBook(u)) && d.permissions.hasPermission(String(u.role || ''), 'schedule:update', await d.permissions.getExtraPermissions(u.userId))
  const holder = (r: { stylistId: string | null; stylistMemberId: string | null }): StylistRef => ({ stylistId: r.stylistId, stylistMemberId: r.stylistMemberId })
  const parseSpan = (body: any, max: number) => {
    for (const k of ['startTime', 'endTime'] as const) {
      if (!body[k]) return { error: `${k === 'startTime' ? 'Start' : 'End'} time is required.` }
      if (!isRealCalendarDay(body[k])) return { error: `${String(body[k]).slice(0, 10)} is not a real calendar date.` }
    }
    const start = new Date(body.startTime), end = new Date(body.endTime)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { error: 'The start or end time is not a valid date.' }
    if (end.getTime() <= start.getTime()) return { error: 'The end time must be after the start time.' }
    if (end.getTime() - start.getTime() > max) return { error: 'Time off cannot be longer than a year.' }
    return { start, end }
  }

  const offOut = (r: any) => ({
    id: r.o.id, stylistId: stylistIdOf(r.o), stylistFirstName: r.first ?? (String(r.member || '').trim().split(/\s+/)[0] || null),
    stylistLastName: r.last ?? (String(r.member || '').trim().split(/\s+/).slice(1).join(' ') || null),
    startTime: r.o.startTime, endTime: r.o.endTime, status: r.o.status, paid: r.o.paid, reason: r.o.reason, decisionNote: r.o.decisionNote, decidedAt: r.o.decidedAt, createdAt: r.o.createdAt,
  })
  const offRows = (companyId: string, ...more: any[]) => db.select({ o: salonTimeOff, first: user.firstName, last: user.lastName, member: teamMember.name }).from(salonTimeOff)
    .leftJoin(user, eq(user.id, salonTimeOff.stylistId)).leftJoin(teamMember, eq(teamMember.id, salonTimeOff.stylistMemberId))
    .where(and(eq(salonTimeOff.companyId, companyId), ...more)).orderBy(asc(salonTimeOff.startTime))

  /** Who the seat is as a stylist: its login and the roster cards that are the same person. */
  const myIds = async (u: any) => ({ userId: String(u.userId), memberIds: await salon.book.memberIdsOf(u.companyId, String(u.userId)) })
  const isMine = (me: { userId: string; memberIds: string[] }, r: { stylistId: string | null; stylistMemberId: string | null }) =>
    (!!r.stylistId && r.stylistId === me.userId) || (!!r.stylistMemberId && me.memberIds.includes(r.stylistMemberId))

  // ─── Time off ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  // GET ?from=&to=&status= — a manager sees everyone's; anyone else sees their own requests and the approved time off of the team (the Book draws it).
  app.get('/time-off', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const { from, to, status } = c.req.query()
    const more: any[] = []
    if (from) more.push(gt(salonTimeOff.endTime, new Date(from)))
    if (to) more.push(lt(salonTimeOff.startTime, new Date(to)))
    if (status) more.push(eq(salonTimeOff.status, status))
    const rows: any[] = await offRows(u.companyId, ...more)
    if (await mayDecide(u)) return listAll(c, rows.map(offOut))
    const me = await myIds(u)
    return listAll(c, rows.filter((r) => r.o.status === 'approved' || isMine(me, r.o)).map(offOut))
  })

  // POST { stylistId?, startTime, endTime, paid?, reason? } — a stylist asks for their own (pending); a manager enters anyone's (approved).
  app.post('/time-off', requirePermission('schedule:create'), async (c) => {
    const u = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const span = parseSpan(body, MAX_OFF_MS)
    if ('error' in span) return fail(c, 400, span.error!, 'BAD_TIME_OFF')
    const manager = await mayDecide(u)
    const me = await myIds(u)
    const asked = body.stylistId ?? body.stylistMemberId
    const ref = await resolveStylist(db, u.companyId, !manager && (asked == null || asked === '') ? me.userId : asked)
    if (!ref || (!ref.stylistId && !ref.stylistMemberId)) return asked ? unknownStylist(c, asked) : fail(c, 400, 'Choose whose time off this is.', 'BAD_TIME_OFF', { stylistId: 'Choose a stylist.' })
    if (!manager && !isMine(me, ref)) return fail(c, 403, 'You can ask for your own time off. A manager can enter it for someone else.', 'OWN_TIME_OFF_ONLY')
    const status = manager ? 'approved' : 'pending'
    const [made] = (await db.insert(salonTimeOff).values({
      companyId: u.companyId, stylistId: ref.stylistId, stylistMemberId: ref.stylistMemberId, startTime: span.start, endTime: span.end, status,
      paid: manager && body.paid === true, reason: String(body.reason || '').trim().slice(0, 200) || null, requestedBy: u.userId,
      ...(manager ? { decidedBy: u.userId, decidedAt: new Date() } : {}),
    } as any).returning()) as any[]
    await audit.log({ action: 'create', entity: 'salon_time_off', entityId: made.id, metadata: { status, stylist: stylistIdOf(ref) }, req: { user: u } })
    refresh(u.companyId)
    const affected = status === 'approved' ? await appointmentsInside(db, u.companyId, ref, span.start, span.end) : []
    return one(c, { ...offOut({ o: made }), affected }, 201)
  })

  // PUT /:id/decision { status: 'approved' | 'denied', paid?, note? } — a manager. Approving lists what is already booked inside it.
  app.put('/time-off/:id/decision', requirePermission('schedule:update'), async (c) => {
    const u = c.get('user') as any
    if (!(await mayDecide(u))) return fail(c, 403, 'A manager decides time off.', 'MANAGER_ONLY')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    if (body.status !== 'approved' && body.status !== 'denied') return fail(c, 400, 'Approve it or deny it.', 'BAD_TIME_OFF', { status: 'approved or denied.' })
    const [row] = await db.select().from(salonTimeOff).where(and(eq(salonTimeOff.id, c.req.param('id')), eq(salonTimeOff.companyId, u.companyId))).limit(1)
    if (!row) return fail(c, 404, 'That time off was not found.')
    const set: Record<string, any> = { status: body.status, decidedBy: u.userId, decidedAt: new Date(), decisionNote: String(body.note || '').trim().slice(0, 200) || null }
    if ('paid' in body) set.paid = body.paid === true
    const [updated] = (await db.update(salonTimeOff).set(set).where(eq(salonTimeOff.id, row.id)).returning()) as any[]
    await audit.log({ action: 'update', entity: 'salon_time_off', entityId: row.id, changes: audit.diff(row, updated), req: { user: u } })
    refresh(u.companyId)
    const affected = updated.status === 'approved' ? await appointmentsInside(db, u.companyId, holder(updated), new Date(updated.startTime), new Date(updated.endTime)) : []
    return one(c, { ...offOut({ o: updated }), affected })
  })

  // GET /:id — one, with the appointments already booked inside it.
  app.get('/time-off/:id', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const [r] = (await offRows(u.companyId, eq(salonTimeOff.id, c.req.param('id')))) as any[]
    if (!r) return fail(c, 404, 'That time off was not found.')
    if (!(await mayDecide(u)) && r.o.status !== 'approved' && !isMine(await myIds(u), r.o)) return fail(c, 404, 'That time off was not found.')
    return one(c, { ...offOut(r), affected: await appointmentsInside(db, u.companyId, holder(r.o), new Date(r.o.startTime), new Date(r.o.endTime)) })
  })

  // DELETE /:id — a stylist withdraws their own request while it waits; a manager removes any.
  app.delete('/time-off/:id', requirePermission('schedule:update'), async (c) => {
    const u = c.get('user') as any
    const [row] = await db.select().from(salonTimeOff).where(and(eq(salonTimeOff.id, c.req.param('id')), eq(salonTimeOff.companyId, u.companyId))).limit(1)
    if (!row) return fail(c, 404, 'That time off was not found.')
    if (!(await mayDecide(u))) {
      if (!isMine(await myIds(u), row)) return fail(c, 404, 'That time off was not found.')
      if (row.status !== 'pending') return fail(c, 403, 'Only a manager can remove time off that has been decided.', 'MANAGER_ONLY')
    }
    await db.delete(salonTimeOff).where(eq(salonTimeOff.id, row.id))
    await audit.log({ action: 'delete', entity: 'salon_time_off', entityId: row.id, metadata: { status: row.status }, req: { user: u } })
    refresh(u.companyId)
    return one(c, { success: true })
  })

  // ─── Closed periods ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const closedOut = (p: any) => ({ id: p.id, name: p.name, startDate: p.startDate, endDate: p.endDate })
  const closedBody = (body: any) => {
    const name = String(body.name || '').trim().slice(0, 80)
    if (!name) return { error: 'Give the closed dates a name, like "Thanksgiving".', field: 'name' }
    for (const k of ['startDate', 'endDate'] as const) if (!isRealDate(body[k])) return { error: `${k === 'startDate' ? 'The first' : 'The last'} day must be a real calendar date.`, field: k }
    if (body.endDate < body.startDate) return { error: 'The last day cannot be before the first.', field: 'endDate' }
    if ((new Date(body.endDate).getTime() - new Date(body.startDate).getTime()) / DAY_MS + 1 > MAX_CLOSED_DAYS) return { error: 'Closed dates can cover at most a year.', field: 'endDate' }
    return { value: { name, startDate: String(body.startDate), endDate: String(body.endDate) } }
  }

  app.get('/closed', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const { from, to } = c.req.query()
    const more: any[] = [eq(salonClosedPeriod.companyId, u.companyId)]
    if (from && isRealDate(from)) more.push(gte(salonClosedPeriod.endDate, from))
    if (to && isRealDate(to)) more.push(lte(salonClosedPeriod.startDate, to))
    return listAll(c, ((await db.select().from(salonClosedPeriod).where(and(...more)).orderBy(asc(salonClosedPeriod.startDate))) as any[]).map(closedOut))
  })

  const closedAffected = async (companyId: string, p: { startDate: string; endDate: string }) => {
    const sp = closedSpan(p, await companyTimeZone(db, companyId))
    return appointmentsInside(db, companyId, null, sp.start, sp.end)
  }

  app.post('/closed', requirePermission('schedule:update'), async (c) => {
    const u = c.get('user') as any
    if (!(await mayDecide(u))) return fail(c, 403, 'A manager sets the days the salon is closed.', 'MANAGER_ONLY')
    const v = closedBody((await c.req.json().catch(() => null)) ?? {})
    if ('error' in v) return fail(c, 400, v.error!, 'BAD_CLOSED', { [v.field!]: v.error! })
    const [made] = (await db.insert(salonClosedPeriod).values({ companyId: u.companyId, ...v.value, createdBy: u.userId }).returning()) as any[]
    await audit.log({ action: 'create', entity: 'salon_closed_period', entityId: made.id, metadata: v.value, req: { user: u } })
    refresh(u.companyId)
    return one(c, { ...closedOut(made), affected: await closedAffected(u.companyId, made) }, 201)
  })

  app.put('/closed/:id', requirePermission('schedule:update'), async (c) => {
    const u = c.get('user') as any
    if (!(await mayDecide(u))) return fail(c, 403, 'A manager sets the days the salon is closed.', 'MANAGER_ONLY')
    const [row] = await db.select().from(salonClosedPeriod).where(and(eq(salonClosedPeriod.id, c.req.param('id')), eq(salonClosedPeriod.companyId, u.companyId))).limit(1)
    if (!row) return fail(c, 404, 'Those closed dates were not found.')
    const body = (await c.req.json().catch(() => null)) ?? {}
    const v = closedBody({ name: row.name, startDate: row.startDate, endDate: row.endDate, ...body })
    if ('error' in v) return fail(c, 400, v.error!, 'BAD_CLOSED', { [v.field!]: v.error! })
    const [updated] = (await db.update(salonClosedPeriod).set(v.value).where(eq(salonClosedPeriod.id, row.id)).returning()) as any[]
    await audit.log({ action: 'update', entity: 'salon_closed_period', entityId: row.id, changes: audit.diff(row, updated), req: { user: u } })
    refresh(u.companyId)
    return one(c, { ...closedOut(updated), affected: await closedAffected(u.companyId, updated) })
  })

  app.delete('/closed/:id', requirePermission('schedule:update'), async (c) => {
    const u = c.get('user') as any
    if (!(await mayDecide(u))) return fail(c, 403, 'A manager sets the days the salon is closed.', 'MANAGER_ONLY')
    const [row] = await db.select().from(salonClosedPeriod).where(and(eq(salonClosedPeriod.id, c.req.param('id')), eq(salonClosedPeriod.companyId, u.companyId))).limit(1)
    if (!row) return fail(c, 404, 'Those closed dates were not found.')
    await db.delete(salonClosedPeriod).where(eq(salonClosedPeriod.id, row.id))
    await audit.log({ action: 'delete', entity: 'salon_closed_period', entityId: row.id, metadata: { name: row.name }, req: { user: u } })
    refresh(u.companyId)
    return one(c, { success: true })
  })

  // ─── Hours: time away from the chair, paid and unpaid ──────────────────────────────────────────────────────────────────────────────
  // GET /hours?from=&to= — per stylist, the minutes of APPROVED time off and of blocks made from a paid/unpaid type that fall in the window.
  // A block with no type has no paid mark and is not counted; a closed period is the salon's, not a stylist's, and is not either.
  app.get('/hours', requirePermission('reports:read'), async (c) => {
    const u = c.get('user') as any
    const { from, to } = c.req.query()
    if (!from || !to || !isRealCalendarDay(from) || !isRealCalendarDay(to)) return fail(c, 400, 'Give the window as from and to.', 'BAD_WINDOW')
    const f = new Date(from), t = new Date(to)
    if (!(t > f)) return fail(c, 400, 'The end of the window must be after its start.', 'BAD_WINDOW')
    const people = new Map<string, { id: string | null; name: string; paidMinutes: number; unpaidMinutes: number }>()
    const person = (sid: string | null, mid: string | null, first: string | null, last: string | null, member: string | null) => {
      const key = sid ? `u:${sid}` : mid ? `m:${mid}` : 'all'
      if (!people.has(key)) people.set(key, { id: sid ?? mid, name: sid ? [first, last].filter(Boolean).join(' ') : mid ? String(member || '').trim() : 'Whole salon', paidMinutes: 0, unpaidMinutes: 0 })
      return people.get(key)!
    }
    const offs: any[] = await db.select({ o: salonTimeOff, first: user.firstName, last: user.lastName, member: teamMember.name }).from(salonTimeOff)
      .leftJoin(user, eq(user.id, salonTimeOff.stylistId)).leftJoin(teamMember, eq(teamMember.id, salonTimeOff.stylistMemberId))
      .where(and(eq(salonTimeOff.companyId, u.companyId), eq(salonTimeOff.status, 'approved'), lt(salonTimeOff.startTime, t), gt(salonTimeOff.endTime, f)))
    for (const r of offs) {
      const p = person(r.o.stylistId, r.o.stylistMemberId, r.first, r.last, r.member)
      const m = clipMin(new Date(r.o.startTime), new Date(r.o.endTime), f, t)
      if (r.o.paid) p.paidMinutes += m; else p.unpaidMinutes += m
    }
    const blocks: any[] = await db.select({ b: bookBlock, first: user.firstName, last: user.lastName, member: teamMember.name }).from(bookBlock)
      .leftJoin(user, eq(user.id, bookBlock.stylistId)).leftJoin(teamMember, eq(teamMember.id, bookBlock.stylistMemberId))
      .where(and(eq(bookBlock.companyId, u.companyId), lt(bookBlock.startTime, t), gt(bookBlock.endTime, f)))
    for (const r of blocks) {
      if (r.b.paid == null) continue
      const p = person(r.b.stylistId, r.b.stylistMemberId, r.first, r.last, r.member)
      const m = clipMin(new Date(r.b.startTime), new Date(r.b.endTime), f, t)
      if (r.b.paid) p.paidMinutes += m; else p.unpaidMinutes += m
    }
    const stylists = [...people.values()].map((p) => ({ ...p, paidMinutes: Math.round(p.paidMinutes), unpaidMinutes: Math.round(p.unpaidMinutes) })).sort((a, b) => a.name.localeCompare(b.name))
    return one(c, { range: { from: f.toISOString(), to: t.toISOString() }, stylists, totals: { paidMinutes: stylists.reduce((n, p) => n + p.paidMinutes, 0), unpaidMinutes: stylists.reduce((n, p) => n + p.unpaidMinutes, 0) } })
  })

  return app
}
