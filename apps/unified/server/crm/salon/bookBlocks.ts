// Blocked time in the Book (salon gap #3; feature `book_grid`): lunch, training, a day off — time a chair is NOT bookable. One stylist's,
// or the whole salon's when no stylist is named. Online booking respects it (onlineBooking.ts `booked` and `busy`); the desk is warned
// and may book over it on purpose (appointments.ts, BOOK_BLOCKED).
import { Hono } from 'hono'
import { and, asc, eq, gt, gte, lt, or, isNull } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { isRealCalendarDay, companyTimeZone, tzParts, minutesToHm } from '@twomiah/tenant-backend'
import { appointment, appointmentItem, bookBlock, bookBlockType, user, teamMember } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { resolveStylist, stylistIdOf, unknownStylist, type StylistRef } from './people.ts'
import { isOwnChair, type OwnChair } from './bookScope.ts'
import type { SalonServices } from './services.ts'
import { expandRepeat, repeatRefusal, type RepeatRule } from './bookRepeat.ts'
import { createTimeOffRoutes, findOff, offSpans } from './timeOff.ts'
import { createBookLayoutRoutes } from './bookLayout.ts'

const MAX_BLOCK_MS = 14 * 86400_000     // a fortnight's holiday; longer is a mistake
const MAX_REPEAT_WEEKS = 26
const HEX = /^#[0-9a-fA-F]{6}$/
const CANCELLED = ['cancelled', 'no_show']

type BlockRow = typeof bookBlock.$inferSelect

/**
 * What takes these stretches off the Book for these stylists, if anything: a block, an approved time off, or a closed day (a salon-wide block
 * and a closed period cover everyone). `reason` is what the desk is told. `exec` may be a transaction.
 */
export async function findBlock(exec: any, companyId: string, spans: Array<{ stylist: StylistRef; start: Date; end: Date }>): Promise<{ reason: string | null } | undefined> {
  for (const sp of spans) {
    const mine = sp.stylist.stylistId ? eq(bookBlock.stylistId, sp.stylist.stylistId) : sp.stylist.stylistMemberId ? eq(bookBlock.stylistMemberId, sp.stylist.stylistMemberId) : undefined
    const [hit] = await exec.select().from(bookBlock).where(and(
      eq(bookBlock.companyId, companyId),
      mine ? or(mine, and(isNull(bookBlock.stylistId), isNull(bookBlock.stylistMemberId))) : and(isNull(bookBlock.stylistId), isNull(bookBlock.stylistMemberId)),
      lt(bookBlock.startTime, sp.end), gt(bookBlock.endTime, sp.start))).limit(1)
    if (hit) return { reason: hit.typeName && hit.reason ? `${hit.typeName}: ${hit.reason}` : hit.typeName || hit.reason }
  }
  const off = await findOff(exec, companyId, spans)
  return off ? { reason: off.reason } : undefined
}

export function createBookBlockRoutes(d: CrmDeps, salon: SalonServices) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const live = d.realtime
  const app = new Hono<AppEnv>()
  const refresh = (companyId: string) => live.emitToCompany(companyId, live.EVENTS.REFRESH, { entity: 'appointment' })
  const holder = (r: { stylistId: string | null; stylistMemberId: string | null }): { stylistId: string | null; stylistMemberId: string | null } => ({ stylistId: r.stylistId, stylistMemberId: r.stylistMemberId })
  /** A narrowed seat sees its own blocks and the salon's; it changes only its own. */
  const visibleTo = (own: OwnChair | null, r: Pick<BlockRow, 'stylistId' | 'stylistMemberId'>) => !own || (!r.stylistId && !r.stylistMemberId) || isOwnChair(own, r)
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
    const blocks = rows.filter((r) => visibleTo(own, r.b)).map((r) => ({
      ...r.b, kind: 'block', stylistId: stylistIdOf(r.b), stylistMemberId: undefined,
      stylistFirstName: r.first ?? (String(r.member || '').trim().split(/\s+/)[0] || null),
      stylistLastName: r.last ?? (String(r.member || '').trim().split(/\s+/).slice(1).join(' ') || null),
    }))
    // Approved time off and closed days are drawn on the Book like blocks, but are kept on their own screen (timeOff.ts): `readOnly`.
    const off = (await offSpans(db, u.companyId, from ? new Date(from) : new Date(0), to ? new Date(to) : new Date('2100-01-01T00:00:00Z')))
      .filter((o) => visibleTo(own, { stylistId: o.stylistId, stylistMemberId: o.stylistMemberId }))
      .map((o) => ({
        id: `${o.kind}:${o.id}`, kind: o.kind, readOnly: true, stylistId: o.stylistId ?? o.stylistMemberId, startTime: o.start.toISOString(), endTime: o.end.toISOString(),
        reason: o.reason, typeName: o.kind === 'closed' ? 'Closed' : 'Time off', typeColor: o.kind === 'closed' ? '#64748b' : '#a855f7',
      }))
    return listAll(c, [...blocks, ...off].sort((a, b) => String(a.startTime instanceof Date ? a.startTime.toISOString() : a.startTime).localeCompare(String(b.startTime instanceof Date ? b.startTime.toISOString() : b.startTime))))
  })

  // Team time off, closed periods and the paid/unpaid hours report (timeOff.ts): /time-off, /closed, /hours — before /:id below.
  app.route('/', createTimeOffRoutes(d, salon))
  app.route('/', createBookLayoutRoutes(d, salon))

  // ─── Types: the preset kinds of blocked time the owner keeps (name, colour, usual length, paid or unpaid) ───────────────────────────────
  const typeOut = (t: typeof bookBlockType.$inferSelect) => ({ id: t.id, name: t.name, color: t.color, defaultMin: t.defaultMin, paid: t.paid })
  const typeBody = (body: any, prior?: typeof bookBlockType.$inferSelect) => {
    const name = 'name' in body ? String(body.name || '').trim().slice(0, 60) : prior?.name ?? ''
    if (!name) return { error: 'Give the type a name.', field: 'name' }
    const color = 'color' in body ? String(body.color || '') : prior?.color ?? '#94a3b8'
    if (!HEX.test(color)) return { error: 'The colour must be a hex colour like #94a3b8.', field: 'color' }
    const defaultMin = 'defaultMin' in body ? Number(body.defaultMin) : prior?.defaultMin ?? 60
    if (!Number.isInteger(defaultMin) || defaultMin < 5 || defaultMin > 24 * 60) return { error: 'The usual length is 5 minutes to 24 hours.', field: 'defaultMin' }
    const paid = 'paid' in body ? body.paid === true : prior?.paid ?? false
    return { value: { name, color, defaultMin, paid } }
  }

  app.get('/types', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const rows = await db.select().from(bookBlockType).where(eq(bookBlockType.companyId, u.companyId)).orderBy(asc(bookBlockType.name))
    return listAll(c, rows.map(typeOut))
  })

  app.post('/types', requirePermission('company:update'), async (c) => {
    const u = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const v = typeBody(body)
    if ('error' in v) return fail(c, 400, v.error!, 'BAD_BLOCK_TYPE', { [v.field!]: v.error! })
    const [dupe] = await db.select({ id: bookBlockType.id }).from(bookBlockType).where(and(eq(bookBlockType.companyId, u.companyId), eq(bookBlockType.name, v.value.name))).limit(1)
    if (dupe) return fail(c, 409, `There is already a blocked-time type called "${v.value.name}".`, 'BLOCK_TYPE_EXISTS', { name: 'Already in use.' })
    const [made] = (await db.insert(bookBlockType).values({ companyId: u.companyId, ...v.value }).returning()) as any[]
    await audit.log({ action: 'create', entity: 'book_block_type', entityId: made.id, metadata: { name: made.name }, req: { user: u } })
    return one(c, typeOut(made), 201)
  })

  app.put('/types/:id', requirePermission('company:update'), async (c) => {
    const u = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const [row] = await db.select().from(bookBlockType).where(and(eq(bookBlockType.id, c.req.param('id')), eq(bookBlockType.companyId, u.companyId))).limit(1)
    if (!row) return fail(c, 404, 'That blocked-time type was not found.')
    const v = typeBody(body, row)
    if ('error' in v) return fail(c, 400, v.error!, 'BAD_BLOCK_TYPE', { [v.field!]: v.error! })
    const [clash] = await db.select({ id: bookBlockType.id }).from(bookBlockType).where(and(eq(bookBlockType.companyId, u.companyId), eq(bookBlockType.name, v.value.name))).limit(1)
    if (clash && clash.id !== row.id) return fail(c, 409, `There is already a blocked-time type called "${v.value.name}".`, 'BLOCK_TYPE_EXISTS', { name: 'Already in use.' })
    const [updated] = (await db.update(bookBlockType).set(v.value).where(eq(bookBlockType.id, row.id)).returning()) as any[]
    await audit.log({ action: 'update', entity: 'book_block_type', entityId: row.id, changes: audit.diff(row, updated), req: { user: u } })
    return one(c, typeOut(updated))
  })

  // Deleting a type never touches the blocks already made from it: each keeps the name, colour and paid mark it was made with.
  app.delete('/types/:id', requirePermission('company:update'), async (c) => {
    const u = c.get('user') as any
    const [row] = await db.select().from(bookBlockType).where(and(eq(bookBlockType.id, c.req.param('id')), eq(bookBlockType.companyId, u.companyId))).limit(1)
    if (!row) return fail(c, 404, 'That blocked-time type was not found.')
    await db.delete(bookBlockType).where(eq(bookBlockType.id, row.id))
    await audit.log({ action: 'delete', entity: 'book_block_type', entityId: row.id, metadata: { name: row.name }, req: { user: u } })
    return one(c, { success: true })
  })

  // POST { stylistId?, startTime, endTime?, reason?, typeId?, repeat?, repeatWeeks? } — no stylistId blocks the whole salon (not a narrowed seat's to do).
  //   typeId: a preset type — its name, colour and paid mark are kept on the block, and its usual length stands in for a missing endTime.
  //   repeat: { every: 'day'|'week', interval, weekdays?, until? | count? } (bookRepeat.ts). repeatWeeks (0–26) is the older "this many more weeks".
  app.post('/', requirePermission('schedule:create'), async (c) => {
    const u = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    let type: typeof bookBlockType.$inferSelect | undefined
    if (body.typeId) {
      ;[type] = await db.select().from(bookBlockType).where(and(eq(bookBlockType.id, String(body.typeId)), eq(bookBlockType.companyId, u.companyId))).limit(1)
      if (!type) return fail(c, 404, 'That blocked-time type was not found.', 'BLOCK_TYPE_NOT_FOUND', { typeId: 'Not found.' })
      if (!body.endTime && isRealCalendarDay(body.startTime)) body.endTime = new Date(new Date(body.startTime).getTime() + type.defaultMin * 60_000).toISOString()
    }
    const span = parseSpan(body)
    if ('error' in span) return fail(c, 400, span.error!, 'BAD_BLOCK')
    const own = await salon.book.ownChairOf(u)
    const asked = body.stylistId ?? body.stylistMemberId
    const ref = await resolveStylist(db, u.companyId, own && (asked == null || asked === '') ? own.userId : asked)
    if (!ref) return unknownStylist(c, asked)
    if (!mayChange(own, ref)) return fail(c, 403, 'You can only block time in your own chair. Ask the front desk or a manager.', 'OWN_BOOK_ONLY')
    const reason = String(body.reason || '').trim().slice(0, 200) || null

    let rule: RepeatRule | null = null
    if (body.repeat != null) {
      rule = { every: body.repeat.every, interval: Number(body.repeat.interval ?? 1), ...(Array.isArray(body.repeat.weekdays) ? { weekdays: body.repeat.weekdays.map(Number) } : {}),
        ...(body.repeat.until ? { until: String(body.repeat.until).slice(0, 10) } : {}), ...(body.repeat.count != null && body.repeat.count !== '' ? { count: Number(body.repeat.count) } : {}) }
    } else if (body.repeatWeeks != null && body.repeatWeeks !== '') {
      const weeks = Number(body.repeatWeeks)
      if (!Number.isInteger(weeks) || weeks < 0 || weeks > MAX_REPEAT_WEEKS) return fail(c, 400, `Repeat for 0 to ${MAX_REPEAT_WEEKS} more weeks.`, 'BAD_BLOCK', { repeatWeeks: `0 to ${MAX_REPEAT_WEEKS}.` })
      if (weeks > 0) rule = { every: 'week', interval: 1, count: weeks + 1 }
    }
    const tz = await companyTimeZone(db, u.companyId)
    const s = tzParts(span.start, tz), e = tzParts(span.end, tz)
    const first = { date: s.date, startHm: minutesToHm(s.minutes), endHm: minutesToHm(e.minutes), endDate: e.date }
    if (rule) {
      const bad = repeatRefusal(rule, first.date)
      if (bad) return fail(c, 400, bad, 'BAD_REPEAT', { repeat: bad })
    }
    const spans = expandRepeat(first, rule, tz)
    const seriesId = spans.length > 1 ? createId() : null
    const values = spans.map((sp) => ({
      companyId: u.companyId, stylistId: ref.stylistId, stylistMemberId: ref.stylistMemberId, startTime: sp.start, endTime: sp.end, reason,
      typeId: type?.id ?? null, typeName: type?.name ?? null, typeColor: type?.color ?? null, paid: type ? type.paid : null, seriesId, createdBy: u.userId,
    }))
    const made = (await db.insert(bookBlock).values(values as any).returning()) as BlockRow[]
    await audit.log({ action: 'create', entity: 'book_block', entityId: made[0].id, metadata: { count: made.length, reason, type: type?.name ?? null, stylist: stylistIdOf(ref) }, req: { user: u } })
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
    // ?scope=following removes this block and every later one in its repeat series (Square's "this and following").
    const following = c.req.query('scope') === 'following' && !!row.seriesId
    const gone = following
      ? ((await db.delete(bookBlock).where(and(eq(bookBlock.companyId, u.companyId), eq(bookBlock.seriesId, row.seriesId as string), gte(bookBlock.startTime, row.startTime))).returning({ id: bookBlock.id })) as any[]).length
      : ((await db.delete(bookBlock).where(eq(bookBlock.id, row.id)).returning({ id: bookBlock.id })) as any[]).length
    await audit.log({ action: 'delete', entity: 'book_block', entityId: row.id, metadata: { reason: row.reason, removed: gone }, req: { user: u } })
    refresh(u.companyId)
    return one(c, { success: true, removed: gone })
  })

  return app
}
