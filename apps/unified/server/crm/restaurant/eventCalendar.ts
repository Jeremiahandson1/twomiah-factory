// The event calendar (restaurant-bar-depth #4, Tripleseat holds + waitlist, Perfect Venue calendar sync):
//   · a grid of the month or week BY ROOM (GET /api/event-calendar), with each event's hours, so lunch and dinner
//     in one room show side by side — rooms are held by time window (eventBooking.findClash) with this feature on;
//   · a WAITLIST for a held date (/api/event-waitlist): a guest who wants a room that is taken waits; when the hold is
//     let go (cancelled, lost, moved) the first waiting guest is offered the date and told;
//   · a calendar feed per room (/api/event-feed/<token>.ics) that Google, Apple and Outlook subscribe to.
//   · a MOVE CHECK (POST /api/event-calendar/move-check, restaurant-bar parity #5): what dragging an event to another day, hour or room
//     would do, read-only — the same overlap, hold and guarantee rules the edit (PUT /api/events/:id) applies, which is the call that
//     makes the move, so a move is refused exactly when an edit would be;
//   · HOLDS THAT LAPSE (hold_until on a tentative event, 'event_hold_expiry'): a reminder before, and on a timer the hold is released
//     and the slot is offered to the waitlist in order.
// All behind the 'event_calendar' feature (not ready); with it off, the room holds one event a date as it always has.
import { Hono } from 'hono'
import crypto from 'node:crypto'
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { event, eventSpace, eventWaitlist, eventProposal, contact, company, user, invoice } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, done, listAll } from '../../http/reply.ts'
import { createTokenGuessGuard } from '../../http/guards.ts'
import { lockEventBook } from '../../data/restaurantEvents.ts'
import { DATE_RE, TIME_RE, HELD, findClash, windowsOverlap, isCalendarDate, eventDayWords, venueToday, validateEventInput, eventWarnings, clashMessage } from './eventBooking.ts'
import { dayBefore, guaranteeFor, guaranteeOn } from './eventGuarantee.ts'
import { getEventSettings } from './eventSettings.ts'

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
      spaceId: event.spaceId, guestCount: event.guestCount, guestCountFinal: event.guestCountFinal, holdUntil: event.holdUntil,
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

  // POST /event-calendar/move-check — what moving an event would do, without doing it. The same rules the edit applies: a bad
  // time or day, a room that is not yours, a hold in the way (findClash, hours and all), the warnings an edit gives (a past day, a
  // room too small), and what follows from the guarantee cutoff, a hold's end, the waitlist and a proposal already sent.
  app.post('/move-check', requirePermission('contacts:update'), async (c) => {
    const u = c.get('user') as any
    const b = (await c.req.json().catch(() => null)) ?? ({} as any)
    const [ev] = typeof b.eventId === 'string' ? await db.select().from(event).where(and(eq(event.id, b.eventId), eq(event.companyId, u.companyId))).limit(1) : []
    if (!ev) return fail(c, 404, 'Event not found')
    const target: Record<string, any> = {}
    for (const k of ['eventDate', 'startTime', 'endTime', 'spaceId']) if (k in b) target[k] = b[k] === '' ? null : b[k]
    const blocked = (code: string, message: string) => one(c, { ok: false, blocked: { code, message }, warnings: [] as string[], notes: [] as string[] })
    if (['cancelled', 'lost', 'completed'].includes(ev.status)) return blocked('not_movable', `A ${ev.status} event cannot be moved.`)
    const bad = validateEventInput(target, ev)
    if (bad) return blocked('invalid', bad)
    const next = { eventDate: target.eventDate ?? ev.eventDate, startTime: 'startTime' in target ? target.startTime : ev.startTime, endTime: 'endTime' in target ? target.endTime : ev.endTime, spaceId: 'spaceId' in target ? target.spaceId : ev.spaceId }
    if ('spaceId' in target && target.spaceId) {
      const [sp] = await db.select({ id: eventSpace.id }).from(eventSpace).where(and(eq(eventSpace.id, target.spaceId), eq(eventSpace.companyId, u.companyId), eq(eventSpace.active, true))).limit(1)
      if (!sp) return blocked('space_missing', 'That room is not one of this venue’s rooms.')
    }
    if (next.spaceId && HELD.includes(ev.status)) {
      const clash = await findClash(db, u.companyId, next.spaceId, next.eventDate, ev.id, { startTime: next.startTime, endTime: next.endTime })
      if (clash) return blocked('space_held', clashMessage(next.eventDate, clash))
    }
    const moved = { date: next.eventDate !== ev.eventDate, room: (next.spaceId || null) !== (ev.spaceId || null), hours: (next.startTime || null) !== (ev.startTime || null) || (next.endTime || null) !== (ev.endTime || null) }
    if (!moved.date && !moved.room && !moved.hours) return blocked('no_change', 'That is where it already is.')
    const warnings = await eventWarnings(db, u.companyId, { ...ev, ...next }, { date: moved.date, capacity: moved.room })
    const notes: string[] = []
    if (await guaranteeOn(d, u.companyId)) {
      const days = (await getEventSettings(db, u.companyId)).guaranteeDays
      const today = await venueToday(db, u.companyId)
      const was = guaranteeFor(ev, days, today), will = guaranteeFor({ eventDate: next.eventDate, status: ev.status }, days, today)
      if (moved.date && was.locked && !will.locked) notes.push(`The guest count is locked now; on the new day it is open again until ${eventDayWords(will.cutoff!)}.`)
      else if (moved.date && !was.locked && will.locked) notes.push(`On the new day the guest count is already locked (it was final on ${eventDayWords(will.cutoff!)}): changing it needs a manager and a reason.`)
      else if (will.locked) notes.push('The guest count stays locked; only a manager changes it, with a reason.')
    }
    if (ev.status === 'tentative' && ev.holdUntil && moved.date && ev.holdUntil > next.eventDate) notes.push(`The hold will now end on the event day, ${eventDayWords(next.eventDate)}.`)
    if (HELD.includes(ev.status) && ev.spaceId && (moved.date || moved.room || moved.hours)) {
      const waiting = await db.select().from(eventWaitlist).where(and(eq(eventWaitlist.companyId, u.companyId), eq(eventWaitlist.spaceId, ev.spaceId), eq(eventWaitlist.eventDate, ev.eventDate), eq(eventWaitlist.status, 'waiting')))
      const n = waiting.filter((w: any) => windowsOverlap(w, ev) || windowsOverlap(ev, w)).length
      if (n) notes.push(`${n} guest${n === 1 ? ' is' : 's are'} waiting for where it is now; the first in line is offered the slot, and told.`)
    }
    if (moved.date || moved.room) {
      const open = await db.select({ id: eventProposal.id }).from(eventProposal).where(and(eq(eventProposal.eventId, ev.id), inArray(eventProposal.status, ['sent', 'viewed', 'partly_signed']))).limit(1)
      if (open.length) notes.push('A proposal already sent for this event shows the old day and room: send a new one.')
    }
    return one(c, { ok: true, blocked: null, warnings, notes, to: next })
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

// ── Holds that lapse (restaurant-bar parity #5; Tripleseat's tentative holds, Perfect Venue's hold expiry) ────────────────────────
// A hold is a tentative event: it keeps its room and hours against everyone else. With 'event_hold_expiry' on it carries the last day
// it is kept (hold_until, a calendar day on the venue's clock): the venue's default length when it becomes a hold, or a day chosen
// for that hold alone. A reminder goes a few days before; the hour after the day ends, the hold is released — it goes back to an
// enquiry, which holds nothing — and the slot is offered to the waitlist, in order. A hold with money paid on it is never released.
const holdOn = (d: Pick<CrmDeps, 'features'>, companyId: string) => d.features.isFeatureEnabled(companyId, 'event_hold_expiry')
const plusDays = (date: string, n: number) => dayBefore(date, -n)

/**
 * The hold columns an event write must carry, from the write's own values: a hold being made gets the venue's default length (or
 * the day the person chose); one that stops being a hold loses it; one moved to an earlier day cannot outlast it. `body.holdUntil`
 * null or '' means "never lapses". Returns the first problem as a sentence, or the columns to add (none when nothing changes).
 * With the feature off it adds nothing and a posted holdUntil is ignored.
 */
export async function holdColumns(d: CrmDeps, companyId: string, existing: any | null, updates: Record<string, any>, body: Record<string, any>): Promise<{ error: string | null; cols: Record<string, any> }> {
  if (!(await holdOn(d, companyId))) return { error: null, cols: {} }
  const status = 'status' in updates ? updates.status : (existing?.status ?? 'enquiry')
  const eventDate: string = updates.eventDate ?? existing?.eventDate
  const had: string | null = existing?.holdUntil ?? null
  const explicit = Object.prototype.hasOwnProperty.call(body, 'holdUntil')
  if (status !== 'tentative') {
    if (explicit && body.holdUntil) return { error: 'Only a tentative hold can have an end day.', cols: {} }
    return { error: null, cols: had || existing?.holdReminderSentAt ? { holdUntil: null, holdReminderSentAt: null } : {} }
  }
  const today = await venueToday(d.db, companyId)
  let until = had
  if (explicit) {
    const v = body.holdUntil
    if (v === null || v === '') until = null
    else if (typeof v !== 'string' || !DATE_RE.test(v) || !isCalendarDate(v)) return { error: 'The hold’s last day must be a real date (YYYY-MM-DD).', cols: {} }
    else if (v < today) return { error: 'A hold cannot end in the past.', cols: {} }
    else if (eventDate && v > eventDate) return { error: 'A hold cannot last past the event day.', cols: {} }
    else until = v
  } else if (existing?.status !== 'tentative') {
    const days = (await getEventSettings(d.db, companyId)).holdDays
    until = days > 0 && eventDate && eventDate >= today ? (plusDays(today, days) < eventDate ? plusDays(today, days) : eventDate) : null
  }
  if (until && eventDate && until > eventDate) until = eventDate
  return { error: null, cols: until !== had ? { holdUntil: until, holdReminderSentAt: null } : {} }
}

/** Who on the venue's side is told about a hold: the event's coordinator, else the business's own address. */
async function staffFor(d: CrmDeps, co: { id: string; name: string; email: string | null }, coordinatorId: string | null): Promise<{ email: string; name: string } | null> {
  if (coordinatorId) {
    const [u] = await d.db.select({ email: user.email, first: user.firstName }).from(user).where(and(eq(user.id, coordinatorId), eq(user.companyId, co.id))).limit(1)
    if (u?.email) return { email: u.email, name: u.first || 'there' }
  }
  return co.email ? { email: co.email, name: co.name } : null
}

/**
 * Reminds the venue's team (and, if the venue asks, the client) once, from `holdReminderDays` before a hold's last day until it.
 * Run hourly by the job in index.ts; callable on its own (the test). Returns how many holds were reminded.
 */
export async function runHoldReminders(d: CrmDeps, now = new Date()): Promise<number> {
  let sent = 0
  const companies = await d.db.select({ id: company.id, name: company.name, email: company.email }).from(company)
  for (const co of companies) {
    if (!(await holdOn(d, co.id))) continue
    const s = await getEventSettings(d.db, co.id)
    if (!(s.holdReminderDays > 0)) continue
    const today = await venueToday(d.db, co.id)
    const rows = await d.db.select({ ev: event, room: eventSpace.name, cEmail: contact.email, cName: contact.name, optOut: contact.emailOptOut }).from(event)
      .leftJoin(eventSpace, eq(event.spaceId, eventSpace.id)).leftJoin(contact, eq(event.contactId, contact.id))
      .where(and(eq(event.companyId, co.id), eq(event.status, 'tentative'), isNotNull(event.holdUntil), isNull(event.holdReminderSentAt), gte(event.holdUntil, today)))
    for (const r of rows) {
      const until = String(r.ev.holdUntil)
      if (today < dayBefore(until, s.holdReminderDays)) continue
      const staff = await staffFor(d, co, r.ev.coordinatorId)
      const client = s.holdRemindClient && r.cEmail && !r.optOut ? { email: r.cEmail as string, name: (r.cName as string) || 'there' } : null
      if (!staff && !client) continue
      // Claimed before the emails go, so two passes at once send one.
      const claimed = await d.db.update(event).set({ holdReminderSentAt: now }).where(and(eq(event.id, r.ev.id), isNull(event.holdReminderSentAt))).returning({ id: event.id })
      if (!claimed.length) continue
      const where = r.room ? ` in ${r.room}` : ''
      try {
        if (staff) {
          await d.services.emailService.send(staff.email, 'eventNote', {
            companyName: co.name, contactName: staff.name, subject: `Hold ending ${eventDayWords(until)}: ${r.ev.name}`,
            headline: `The hold on “${r.ev.name}” ends ${eventDayWords(until)}.`,
            body: `${r.ev.name} is held for ${eventDayWords(r.ev.eventDate)}${where}. If it is not confirmed by then, the hold is released and the room is offered to the waitlist, in order. To keep it, confirm the booking, or change how long it is held on the event.`,
            path: `/crm/events/${r.ev.id}`, button: 'Open the event',
          })
        }
        if (client) {
          await d.services.emailService.send(client.email, 'eventNote', {
            companyName: co.name, contactName: client.name, subject: `Your date is held until ${eventDayWords(until)}`,
            headline: `We are holding ${eventDayWords(r.ev.eventDate)} for you until ${eventDayWords(until)}.`,
            body: 'To keep the date, please confirm with us by then. After that it is released and may be offered to someone else.',
          })
        }
        sent++
      } catch (err: any) {
        d.logger.warn('[events] hold reminder not sent', { event: r.ev.id, error: err?.message })
      }
    }
  }
  return sent
}

/**
 * Releases each hold whose last day has passed on the venue's clock: back to an enquiry (it holds nothing), the expiry cleared, the
 * time kept, and the slot offered to the first guest waiting for it. A hold with a payment recorded is not released — it loses its
 * end day instead, so it stops being looked at, and stays a hold for staff to settle. Returns how many were released.
 */
export async function runHoldReleases(d: CrmDeps, now = new Date()): Promise<number> {
  let released = 0
  const companies = await d.db.select({ id: company.id, name: company.name, email: company.email }).from(company)
  for (const co of companies) {
    if (!(await holdOn(d, co.id))) continue
    const today = await venueToday(d.db, co.id)
    const lapsed = await d.db.select().from(event).where(and(eq(event.companyId, co.id), eq(event.status, 'tentative'), isNotNull(event.holdUntil), lt(event.holdUntil, today)))
    for (const ev of lapsed) {
      let outcome: 'released' | 'paid' | 'gone' = 'gone'
      try {
        outcome = await d.db.transaction(async (tx: any) => {
          await lockEventBook(tx, co.id)
          const [now1] = await tx.select().from(event).where(and(eq(event.id, ev.id), eq(event.status, 'tentative'), isNotNull(event.holdUntil), lt(event.holdUntil, today))).limit(1)
          if (!now1) return 'gone' as const
          const [inv] = await tx.select({ paid: invoice.amountPaid }).from(invoice).where(and(eq(invoice.eventId, ev.id), ne(invoice.status, 'void'))).limit(1)
          if (inv && Number(inv.paid) > 0) {
            await tx.update(event).set({ holdUntil: null, holdReminderSentAt: null, updatedAt: now }).where(eq(event.id, ev.id))
            return 'paid' as const
          }
          await tx.update(event).set({ status: 'enquiry', holdUntil: null, holdReminderSentAt: null, holdReleasedAt: now, updatedAt: now }).where(eq(event.id, ev.id))
          return 'released' as const
        })
      } catch (err: any) {
        d.logger.warn('[events] hold not released', { event: ev.id, error: err?.message })
        continue
      }
      if (outcome === 'gone') continue
      d.realtime.emitToCompany(co.id, d.realtime.EVENTS.REFRESH, { entity: 'event' })
      if (outcome === 'paid') {
        await d.audit.log({ action: 'update', entity: 'event', entityId: ev.id, entityName: `${ev.name} — hold kept: a payment is recorded`, companyId: co.id })
        continue
      }
      released++
      await d.audit.log({ action: 'update', entity: 'event', entityId: ev.id, entityName: `${ev.name} — hold lapsed and released`, changes: { status: { from: 'tentative', to: 'enquiry' }, holdUntil: { from: ev.holdUntil, to: null } }, companyId: co.id })
      await offerWaitlist(d, co.id, ev.spaceId, ev.eventDate)
      const staff = await staffFor(d, co, ev.coordinatorId)
      if (staff) {
        await d.services.emailService.send(staff.email, 'eventNote', {
          companyName: co.name, contactName: staff.name, subject: `Hold released: ${ev.name}`,
          headline: `The hold on “${ev.name}” lapsed on ${eventDayWords(String(ev.holdUntil))} and was released.`,
          body: `${ev.name} (${eventDayWords(ev.eventDate)}) is an enquiry again and no longer keeps its room. Guests waiting for the slot were offered it, in order.`,
          path: `/crm/events/${ev.id}`, button: 'Open the event',
        }).catch((err: any) => d.logger.warn('[events] hold release not emailed', { error: err?.message }))
      }
    }
  }
  return released
}
