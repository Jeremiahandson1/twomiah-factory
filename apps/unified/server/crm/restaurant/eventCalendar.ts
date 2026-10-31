// The event calendar (restaurant-bar-depth #4, Tripleseat holds + waitlist, Perfect Venue calendar sync):
//   · a grid of the month or week BY ROOM (GET /api/event-calendar), with each event's hours, so lunch and dinner
//     in one room show side by side — rooms are held by time window (eventBooking.findClash) with this feature on;
//   · a WAITLIST for a held date (/api/event-waitlist): a guest who wants a room that is taken waits; when the hold is
//     let go (cancelled, lost, moved) the first waiting guest is offered the date and told;
//   · a calendar feed per room (/api/event-feed/<token>.ics) that Google, Apple and Outlook subscribe to.
// All behind the 'event_calendar' feature (not ready); with it off, the room holds one event a date as it always has.
import { Hono } from 'hono'
import crypto from 'node:crypto'
import { and, asc, eq, gte, inArray, lte, ne } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { event, eventSpace, eventWaitlist, contact, company } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, done, listAll } from '../../http/reply.ts'
import { createTokenGuessGuard } from '../../http/guards.ts'
import { DATE_RE, TIME_RE, HELD, findClash, windowsOverlap, isCalendarDate, eventDayWords } from './eventBooking.ts'

const FEED_STATUSES = [...HELD, 'enquiry']

export function createEventCalendarRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  // GET /event-calendar?from=YYYY-MM-DD&to=YYYY-MM-DD — the grid's data: the rooms and every event in the range with its hours.
  app.get('/', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const from = c.req.query('from') || '', to = c.req.query('to') || ''
    if (!isCalendarDate(from) || !isCalendarDate(to)) return fail(c, 400, 'from and to are required as YYYY-MM-DD')
    if (to < from || (Date.parse(to) - Date.parse(from)) / 86400000 > 62) return fail(c, 400, 'Ask for at most two months at a time.')
    const spaces = await db.select({ id: eventSpace.id, name: eventSpace.name, seatedCapacity: eventSpace.seatedCapacity }).from(eventSpace)
      .where(and(eq(eventSpace.companyId, u.companyId), eq(eventSpace.active, true))).orderBy(asc(eventSpace.name))
    const events = await db.select({
      id: event.id, name: event.name, status: event.status, eventDate: event.eventDate, startTime: event.startTime, endTime: event.endTime,
      spaceId: event.spaceId, guestCount: event.guestCount, guestCountFinal: event.guestCountFinal,
    }).from(event)
      .where(and(eq(event.companyId, u.companyId), gte(event.eventDate, from), lte(event.eventDate, to), ne(event.status, 'cancelled'), ne(event.status, 'lost')))
      .orderBy(asc(event.eventDate), asc(event.startTime))
    const waiting = await db.select().from(eventWaitlist)
      .where(and(eq(eventWaitlist.companyId, u.companyId), gte(eventWaitlist.eventDate, from), lte(eventWaitlist.eventDate, to), inArray(eventWaitlist.status, ['waiting', 'offered'])))
    return one(c, { from, to, spaces, events, waitlist: waiting.map((w: any) => ({ id: w.id, spaceId: w.spaceId, eventDate: w.eventDate, startTime: w.startTime, endTime: w.endTime, name: w.name, status: w.status })) })
  })

  // Calendar feeds. A feed URL is a secret (calendar apps cannot sign in), so seeing or resetting it is contacts:update.
  app.get('/feeds', requirePermission('contacts:update'), async (c) => {
    const u = c.get('user') as any
    const rows = await db.select().from(eventSpace).where(and(eq(eventSpace.companyId, u.companyId), eq(eventSpace.active, true))).orderBy(asc(eventSpace.name))
    const out = []
    for (const r of rows) {
      let token = r.feedToken
      if (!token) {
        token = crypto.randomBytes(24).toString('hex')
        await db.update(eventSpace).set({ feedToken: token }).where(eq(eventSpace.id, r.id))
      }
      out.push({ spaceId: r.id, name: r.name, path: `/api/event-feed/${token}.ics` })
    }
    return listAll(c, out)
  })
  app.post('/feeds/:spaceId/reset', requirePermission('contacts:update'), async (c) => {
    const u = c.get('user') as any
    const [sp] = await db.select().from(eventSpace).where(and(eq(eventSpace.id, c.req.param('spaceId')), eq(eventSpace.companyId, u.companyId))).limit(1)
    if (!sp) return fail(c, 404, 'Space not found')
    const token = crypto.randomBytes(24).toString('hex')
    await db.update(eventSpace).set({ feedToken: token }).where(eq(eventSpace.id, sp.id))
    await audit.log({ action: 'update', entity: 'event_space', entityId: sp.id, entityName: `${sp.name} calendar feed reset`, req: { user: u } })
    return one(c, { spaceId: sp.id, name: sp.name, path: `/api/event-feed/${token}.ics` })
  })

  return app
}

const icsEscape = (s: unknown) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\;')
const ymd = (date: string) => date.replace(/-/g, '')
const hm = (t: string) => t.replace(':', '') + '00'
/** Fold a line to 75 octets as RFC 5545 asks. */
const fold = (line: string) => line.length <= 73 ? line : line.match(/.{1,73}/g)!.join('\r\n ')

/** A room's events as an iCalendar file. Floating local times: the room's staff read them in the venue's own clock. */
export function roomIcs(roomName: string, events: Array<{ id: string; name: string; status: string; eventDate: string; startTime: string | null; endTime: string | null; guestCount: number | null; updatedAt: Date }>): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Twomiah//Events//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsEscape(roomName)}`]
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@twomiah-events`, `DTSTAMP:${new Date(e.updatedAt).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`)
    if (e.startTime && e.endTime) lines.push(`DTSTART:${ymd(e.eventDate)}T${hm(e.startTime)}`, `DTEND:${ymd(e.eventDate)}T${hm(e.endTime)}`)
    else {
      const next = new Date(Date.parse(e.eventDate + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)
      lines.push(`DTSTART;VALUE=DATE:${ymd(e.eventDate)}`, `DTEND;VALUE=DATE:${ymd(next)}`)
    }
    lines.push(`SUMMARY:${icsEscape(e.status === 'enquiry' ? `[Enquiry] ${e.name}` : e.status === 'tentative' ? `[Tentative] ${e.name}` : e.name)}`)
    lines.push(`DESCRIPTION:${icsEscape(`${e.guestCount ? e.guestCount + ' guests. ' : ''}Status: ${e.status}.`)}`, `STATUS:${e.status === 'confirmed' || e.status === 'completed' ? 'CONFIRMED' : 'TENTATIVE'}`, 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}

/** The public feed, by a room's secret token. No money and no client details leave: name, hours, head count, stage. */
export function createEventFeedRoutes(d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()
  // Guessing feed links: the same limit as the proposal and payment links (20 wrong in 15 minutes from one address, then every
  // link from it is "not found" for the rest of the window) — a room's feed lists its bookings (10/30, owner's follow-up).
  app.use('/:file', createTokenGuessGuard(15 * 60_000, 20, 'Not found'))
  app.get('/:file', async (c) => {
    const token = c.req.param('file').replace(/\.ics$/i, '')
    if (!/^[0-9a-f]{48}$/.test(token)) return fail(c, 404, 'Not found')
    const [sp] = await db.select().from(eventSpace).where(eq(eventSpace.feedToken, token)).limit(1)
    if (!sp || !sp.active) return fail(c, 404, 'Not found')
    const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10)
    const rows = await db.select().from(event).where(and(eq(event.companyId, sp.companyId), eq(event.spaceId, sp.id), inArray(event.status, FEED_STATUSES), gte(event.eventDate, since))).orderBy(asc(event.eventDate))
    return c.body(roomIcs(sp.name, rows), 200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=300' })
  })
  return app
}

// ── Waitlist ────────────────────────────────────────────────────────────────────────────────────────────────────────
function waitInput(b: any): string | null {
  if (typeof b.name !== 'string' || !b.name.trim()) return 'name is required'
  if (typeof b.eventDate !== 'string' || !DATE_RE.test(b.eventDate) || !isCalendarDate(b.eventDate)) return 'eventDate is required as YYYY-MM-DD'
  for (const k of ['startTime', 'endTime']) if (b[k] && !TIME_RE.test(b[k])) return 'Times must be HH:MM (24-hour clock).'
  if (b.startTime && b.endTime && b.endTime <= b.startTime) return 'End time must be after the start time.'
  if (b.email && !String(b.email).includes('@')) return 'That email address does not look right.'
  return null
}

export function createEventWaitlistRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  app.get('/', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const spaceId = c.req.query('spaceId'), status = c.req.query('status')
    const rows = await db.select({ w: eventWaitlist, spaceName: eventSpace.name }).from(eventWaitlist)
      .leftJoin(eventSpace, eq(eventWaitlist.spaceId, eventSpace.id))
      .where(and(eq(eventWaitlist.companyId, u.companyId), ...(spaceId ? [eq(eventWaitlist.spaceId, spaceId)] : []), ...(status ? [eq(eventWaitlist.status, status)] : [])))
      .orderBy(asc(eventWaitlist.eventDate), asc(eventWaitlist.createdAt))
    return listAll(c, rows.map((r: any) => ({ ...r.w, spaceName: r.spaceName })))
  })

  // Waiting is for a room that is taken: if the date is open, book it instead.
  app.post('/', requirePermission('contacts:create'), async (c) => {
    const u = c.get('user') as any
    const b = (await c.req.json().catch(() => null)) ?? ({} as any)
    const bad = waitInput(b)
    if (bad) return fail(c, 400, bad)
    const [sp] = typeof b.spaceId === 'string' ? await db.select().from(eventSpace).where(and(eq(eventSpace.id, b.spaceId), eq(eventSpace.companyId, u.companyId))).limit(1) : []
    if (!sp) return fail(c, 404, 'Space not found')
    if (b.contactId) {
      const [ct] = await db.select({ id: contact.id }).from(contact).where(and(eq(contact.id, b.contactId), eq(contact.companyId, u.companyId))).limit(1)
      if (!ct) return fail(c, 404, 'Client not found')
    }
    const held = await findClash(db, u.companyId, sp.id, b.eventDate, undefined, { startTime: b.startTime, endTime: b.endTime })
    if (!held) return fail(c, 409, `${sp.name} is open on ${eventDayWords(b.eventDate)}${b.startTime ? ' at those hours' : ''} — book it instead of waiting.`, 'space_open')
    const [row] = await db.insert(eventWaitlist).values({
      id: createId(), spaceId: sp.id, eventDate: b.eventDate, startTime: b.startTime || null, endTime: b.endTime || null, contactId: b.contactId || null,
      name: b.name.trim().slice(0, 120), email: b.email ? String(b.email).trim().slice(0, 200) : null, phone: b.phone ? String(b.phone).trim().slice(0, 40) : null,
      guestCount: Number.isInteger(b.guestCount) && b.guestCount > 0 ? b.guestCount : null, notes: b.notes ? String(b.notes).slice(0, 1000) : null, companyId: u.companyId,
    }).returning()
    await audit.log({ action: 'create', entity: 'event_waitlist', entityId: row.id, entityName: row.name, metadata: row, req: { user: u } })
    return one(c, row, 201)
  })

  // Mark it booked or remove it.
  app.put('/:id', requirePermission('contacts:update'), async (c) => {
    const u = c.get('user') as any
    const b = (await c.req.json().catch(() => null)) ?? ({} as any)
    if (!['waiting', 'booked', 'removed'].includes(b.status)) return fail(c, 400, 'status must be waiting, booked or removed')
    const [existing] = await db.select().from(eventWaitlist).where(and(eq(eventWaitlist.id, c.req.param('id')), eq(eventWaitlist.companyId, u.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Waitlist entry not found')
    const [row] = await db.update(eventWaitlist).set({ status: b.status, updatedAt: new Date() }).where(eq(eventWaitlist.id, existing.id)).returning()
    await audit.log({ action: 'update', entity: 'event_waitlist', entityId: row.id, entityName: row.name, changes: audit.diff(existing, row), req: { user: u } })
    return one(c, row)
  })

  app.delete('/:id', requirePermission('contacts:update'), async (c) => {
    const u = c.get('user') as any
    const [existing] = await db.select().from(eventWaitlist).where(and(eq(eventWaitlist.id, c.req.param('id')), eq(eventWaitlist.companyId, u.companyId))).limit(1)
    if (!existing) return fail(c, 404, 'Waitlist entry not found')
    await db.delete(eventWaitlist).where(eq(eventWaitlist.id, existing.id))
    await audit.log({ action: 'delete', entity: 'event_waitlist', entityId: existing.id, entityName: existing.name, metadata: existing, req: { user: u } })
    return done(c)
  })
  return app
}

/**
 * A hold was let go on this room and day (cancelled, lost, moved off): offer it to the first guest waiting whose hours it
 * now fits, and tell them. Called after the write commits; never throws.
 */
export async function offerWaitlist(d: CrmDeps, companyId: string, spaceId: string | null, eventDate: string): Promise<number> {
  if (!spaceId) return 0
  try {
    if (!(await d.features.isFeatureEnabled(companyId, 'event_calendar'))) return 0
    const waiting = await d.db.select().from(eventWaitlist)
      .where(and(eq(eventWaitlist.companyId, companyId), eq(eventWaitlist.spaceId, spaceId), eq(eventWaitlist.eventDate, eventDate), eq(eventWaitlist.status, 'waiting'))).orderBy(asc(eventWaitlist.createdAt))
    const [co] = await d.db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
    const [sp] = await d.db.select({ name: eventSpace.name }).from(eventSpace).where(eq(eventSpace.id, spaceId)).limit(1)
    const offered: Array<{ startTime?: string | null; endTime?: string | null }> = []
    for (const w of waiting) {
      // Once someone is offered an hour, a later guest wanting those hours keeps waiting behind them.
      if (offered.some((o) => windowsOverlap(o, w))) continue
      if (await findClash(d.db, companyId, spaceId, eventDate, undefined, w)) continue
      await d.db.update(eventWaitlist).set({ status: 'offered', offeredAt: new Date(), updatedAt: new Date() }).where(eq(eventWaitlist.id, w.id))
      offered.push(w)
      d.realtime.emitToCompany(companyId, d.realtime.EVENTS.REFRESH, { entity: 'event_waitlist' })
      if (w.email) {
        await d.services.emailService.send(w.email, 'eventNote', {
          companyName: co?.name || 'The venue', contactName: w.name, subject: `${sp?.name || 'The room'} is open on ${eventDayWords(eventDate)}`,
          headline: `${sp?.name || 'The room'} you asked about has opened up on ${eventDayWords(eventDate)}.`,
          body: 'It is not held for you yet. Reply to this email or call us soon to book it.',
        }).catch((err: any) => d.logger.warn('[events] waitlist offer not emailed', { error: err?.message }))
      }
    }
    return offered.length
  } catch (err: any) {
    d.logger.warn('[events] waitlist offer failed', { error: err?.message })
    return 0
  }
}
