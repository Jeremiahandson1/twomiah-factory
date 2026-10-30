// Blocked time in the Book (salon gap #3; feature `book_grid`): lunch, training, a day off — time a chair is NOT bookable. One stylist's,
// or the whole salon's when no stylist is named. Online booking respects it (onlineBooking.ts `booked` and `busy`); the desk is warned
// and may book over it on purpose (appointments.ts, BOOK_BLOCKED).
import { Hono } from 'hono'
import { and, asc, eq, gt, lt, or, isNull } from 'drizzle-orm'
import { isRealCalendarDay } from '@twomiah/tenant-backend'
import { appointment, appointmentItem, bookBlock, user, teamMember } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { resolveStylist, stylistIdOf, unknownStylist, type StylistRef } from './people.ts'
import { isOwnChair, type OwnChair } from './bookScope.ts'
import type { SalonServices } from './services.ts'

const MAX_BLOCK_MS = 14 * 86400_000     // a fortnight's holiday; longer is a mistake
const MAX_REPEAT_WEEKS = 26
const CANCELLED = ['cancelled', 'no_show']

type BlockRow = typeof bookBlock.$inferSelect

/** The block, if any, that covers any of these stretches for these stylists (a salon-wide block covers everyone). `exec` may be a transaction. */
export async function findBlock(exec: any, companyId: string, spans: Array<{ stylist: StylistRef; start: Date; end: Date }>): Promise<BlockRow | undefined> {
  for (const sp of spans) {
    const mine = sp.stylist.stylistId ? eq(bookBlock.stylistId, sp.stylist.stylistId) : sp.stylist.stylistMemberId ? eq(bookBlock.stylistMemberId, sp.stylist.stylistMemberId) : undefined
    const [hit] = await exec.select().from(bookBlock).where(and(
      eq(bookBlock.companyId, companyId),
      mine ? or(mine, and(isNull(bookBlock.stylistId), isNull(bookBlock.stylistMemberId))) : and(isNull(bookBlock.stylistId), isNull(bookBlock.stylistMemberId)),
      lt(bookBlock.startTime, sp.end), gt(bookBlock.endTime, sp.start))).limit(1)
    if (hit) return hit
  }
  return undefined
}

export function createBookBlockRoutes(d: CrmDeps, salon: SalonServices) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const live = d.realtime
  const app = new Hono<AppEnv>()
  const refresh = (companyId: string) => live.emitToCompany(companyId, live.EVENTS.REFRESH, { entity: 'appointment' })
  const holder = (r: { stylistId: string | null; stylistMemberId: string | null }): { stylistId: string | null; stylistMemberId: string | null } => ({ stylistId: r.stylistId, stylistMemberId: r.stylistMemberId })
  /** A narrowed seat sees its own blocks and the salon's; it changes only its own. */
  const visibleTo = (own: OwnChair | null, r: BlockRow) => !own || (!r.stylistId && !r.stylistMemberId) || isOwnChair(own, r)
  const mayChange = (own: OwnChair | null, r: Pick<BlockRow, 'stylistId' | 'stylistMemberId'>) => !own || isOwnChair(own, r)

  /** Appointments already booked inside a block's time for its stylist (or anyone, for a salon-wide one) — said, never refused. */
  async function appointmentsUnder(companyId: string, ref: StylistRef, start: Date, end: Date): Promise<number> {
    const rows: any[] = await db.select({ id: appointment.id, status: appointment.status, s: appointment.startTime, e: appointment.endTime, sid: appointment.stylistId, mid: appointment.stylistMemberId })
      .from(appointment).where(and(eq(appointment.companyId, companyId), lt(appointment.startTime, end), gt(appointment.startTime, new Date(start.getTime() - 86400000))))
    const items: any[] = rows.length ? await db.select().from(appointmentItem).where(eq(appointmentItem.companyId, companyId)) : []
    const itemised = new Set(items.map((i) => i.appointmentId))
    const everyone = !ref.stylistId && !ref.stylistMemberId
    const heldBy = (sid: string | null, mid: string | null) => everyone || (!!ref.stylistId && sid === ref.stylistId) || (!!ref.stylistMemberId && mid === ref.stylistMemberId)
    let n = 0
    for (const r of rows) {
      if (CANCELLED.includes(r.status) || itemised.has(r.id)) continue
      const rs = new Date(r.s).getTime(), re = r.e ? new Date(r.e).getTime() : rs + 3600000
      if (heldBy(r.sid, r.mid) && rs < end.getTime() && re > start.getTime()) n++
    }
    for (const it of items) {
      const parent = rows.find((r) => r.id === it.appointmentId)
      if (!parent || CANCELLED.includes(parent.status)) continue
      const is = new Date(parent.s).getTime() + it.startOffsetMin * 60_000, ie = is + it.durationMin * 60_000
      if (heldBy(it.stylistId, it.stylistMemberId) && is < end.getTime() && ie > start.getTime()) n++
    }
    return n
  }

  const parseSpan = (body: any) => {
    for (const k of ['startTime', 'endTime'] as const) {
      if (!body[k]) return { error: `${k === 'startTime' ? 'Start' : 'End'} time is required.` }
      if (!isRealCalendarDay(body[k])) return { error: `${String(body[k]).slice(0, 10)} is not a real calendar date.` }
    }
    const start = new Date(body.startTime), end = new Date(body.endTime)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { error: 'The start or end time is not a valid date.' }
    if (end.getTime() <= start.getTime()) return { error: 'The end time must be after the start time.' }
    if (end.getTime() - start.getTime() > MAX_BLOCK_MS) return { error: 'Blocked time cannot be longer than 14 days.' }
    return { start, end }
  }

  // GET ?from=&to= — the blocks touching a window (the grid asks for the week it shows).
  app.get('/', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const { from, to } = c.req.query()
    const conds = [eq(bookBlock.companyId, u.companyId)]
    if (from) conds.push(gt(bookBlock.endTime, new Date(from)))
    if (to) conds.push(lt(bookBlock.startTime, new Date(to)))
    const own = await salon.book.ownChairOf(u)
    const rows: any[] = await db.select({ b: bookBlock, first: user.firstName, last: user.lastName, member: teamMember.name }).from(bookBlock)
      .leftJoin(user, eq(user.id, bookBlock.stylistId)).leftJoin(teamMember, eq(teamMember.id, bookBlock.stylistMemberId))
      .where(and(...conds)).orderBy(asc(bookBlock.startTime))
    return listAll(c, rows.filter((r) => visibleTo(own, r.b)).map((r) => ({
      ...r.b, stylistId: stylistIdOf(r.b), stylistMemberId: undefined,
      stylistFirstName: r.first ?? (String(r.member || '').trim().split(/\s+/)[0] || null),
      stylistLastName: r.last ?? (String(r.member || '').trim().split(/\s+/).slice(1).join(' ') || null),
    })))
  })

  // POST { stylistId?, startTime, endTime, reason?, repeatWeeks? } — no stylistId blocks the whole salon (not a narrowed seat's to do).
  app.post('/', requirePermission('schedule:create'), async (c) => {
    const u = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const span = parseSpan(body)
    if ('error' in span) return fail(c, 400, span.error!, 'BAD_BLOCK')
    const own = await salon.book.ownChairOf(u)
    const asked = body.stylistId ?? body.stylistMemberId
    const ref = await resolveStylist(db, u.companyId, own && (asked == null || asked === '') ? own.userId : asked)
    if (!ref) return unknownStylist(c, asked)
    if (!mayChange(own, ref)) return fail(c, 403, 'You can only block time in your own chair. Ask the front desk or a manager.', 'OWN_BOOK_ONLY')
    const weeks = body.repeatWeeks == null || body.repeatWeeks === '' ? 0 : Number(body.repeatWeeks)
    if (!Number.isInteger(weeks) || weeks < 0 || weeks > MAX_REPEAT_WEEKS) return fail(c, 400, `Repeat for 0 to ${MAX_REPEAT_WEEKS} more weeks.`, 'BAD_BLOCK', { repeatWeeks: `0 to ${MAX_REPEAT_WEEKS}.` })
    const reason = String(body.reason || '').trim().slice(0, 200) || null
    const values = Array.from({ length: weeks + 1 }, (_, i) => {
      // The same wall-clock time each week: a week later is 7 calendar days, so go through the calendar, not 168 hours.
      const s = new Date(span.start), e = new Date(span.end)
      s.setUTCDate(s.getUTCDate() + 7 * i); e.setUTCDate(e.getUTCDate() + 7 * i)
      return { companyId: u.companyId, stylistId: ref.stylistId, stylistMemberId: ref.stylistMemberId, startTime: s, endTime: e, reason, createdBy: u.userId }
    })
    const made = (await db.insert(bookBlock).values(values as any).returning()) as BlockRow[]
    await audit.log({ action: 'create', entity: 'book_block', entityId: made[0].id, metadata: { count: made.length, reason, stylist: stylistIdOf(ref) }, req: { user: u } })
    refresh(u.companyId)
    return one(c, { ...made[0], stylistId: stylistIdOf(made[0]), stylistMemberId: undefined, created: made.length, appointmentsInside: await appointmentsUnder(u.companyId, holder(ref), span.start, span.end) }, 201)
  })

  app.put('/:id', requirePermission('schedule:update'), async (c) => {
    const u = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const [row] = await db.select().from(bookBlock).where(and(eq(bookBlock.id, c.req.param('id')), eq(bookBlock.companyId, u.companyId))).limit(1)
    const own = await salon.book.ownChairOf(u)
    if (!row || !visibleTo(own, row)) return fail(c, 404, 'That blocked time was not found.')
    if (!mayChange(own, row)) return fail(c, 403, 'You can only change blocked time in your own chair.', 'OWN_BOOK_ONLY')
    const span = parseSpan({ startTime: body.startTime ?? row.startTime.toISOString(), endTime: body.endTime ?? row.endTime.toISOString() })
    if ('error' in span) return fail(c, 400, span.error!, 'BAD_BLOCK')
    const set: Record<string, any> = { startTime: span.start, endTime: span.end }
    if ('reason' in body) set.reason = String(body.reason || '').trim().slice(0, 200) || null
    if ('stylistId' in body || 'stylistMemberId' in body) {
      const ref = await resolveStylist(db, u.companyId, body.stylistId ?? body.stylistMemberId)
      if (!ref) return unknownStylist(c, body.stylistId)
      if (!mayChange(own, ref)) return fail(c, 403, 'You can only block time in your own chair.', 'OWN_BOOK_ONLY')
      set.stylistId = ref.stylistId; set.stylistMemberId = ref.stylistMemberId
    }
    const [updated] = (await db.update(bookBlock).set(set).where(eq(bookBlock.id, row.id)).returning()) as BlockRow[]
    await audit.log({ action: 'update', entity: 'book_block', entityId: row.id, changes: audit.diff(row, updated), req: { user: u } })
    refresh(u.companyId)
    return one(c, { ...updated, stylistId: stylistIdOf(updated), stylistMemberId: undefined, appointmentsInside: await appointmentsUnder(u.companyId, holder(updated), span.start, span.end) })
  })

  app.delete('/:id', requirePermission('schedule:update'), async (c) => {
    const u = c.get('user') as any
    const [row] = await db.select().from(bookBlock).where(and(eq(bookBlock.id, c.req.param('id')), eq(bookBlock.companyId, u.companyId))).limit(1)
    const own = await salon.book.ownChairOf(u)
    if (!row || !visibleTo(own, row)) return fail(c, 404, 'That blocked time was not found.')
    if (!mayChange(own, row)) return fail(c, 403, 'You can only remove blocked time in your own chair.', 'OWN_BOOK_ONLY')
    await db.delete(bookBlock).where(eq(bookBlock.id, row.id))
    await audit.log({ action: 'delete', entity: 'book_block', entityId: row.id, metadata: { reason: row.reason }, req: { user: u } })
    refresh(u.companyId)
    return one(c, { success: true })
  })

  return app
}
