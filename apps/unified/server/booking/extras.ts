// The rest of bookings, around the engine: repeating bookings, the waitlist, bans, webhooks, the customers and the
// numbers, the calendar feed, and the scheduled messages (reminders, "ready for the next one?", review requests).
// Moved from the premium site (routes/admin.ts, server-static.ts) with its faults fixed — each named where it is.
import crypto from 'node:crypto'
import { and, asc, desc, eq, gte, inArray, isNull, isNotNull, lt, lte, ne, gt } from 'drizzle-orm'
import { tzParts, isRealDate, normaliseZip, zonedWallTimeToUtc, companyRowTimeZone } from '@twomiah/tenant-backend'
import { booking, bookingService, bookingSeries, bookingWaitlist, bookingBan, bookingWebhook, bookingSettings, company } from '../db/schema/index.ts'
import type { EmailService } from '../core/email.ts'
import type { Logger } from '../core/logger.ts'
import { BookingError, type BookingEngine, type BookInput } from './engine.ts'
import { expandSeries, describeSeries, type Frequency } from './recurrence.ts'
import { messageFor, icsOf, siteOrigin } from './happenings.ts'
import { WEBHOOK_EVENTS, type BookingWebhooks } from './webhooks.ts'
import { bookingTextFor, type BookingTexts } from './texts.ts'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

export function createBookingExtras(deps: { db: any; engine: BookingEngine; email: EmailService; logger: Logger; webhooks: BookingWebhooks; texts?: BookingTexts; now?: () => number }) {
  const { db, engine, email, logger, webhooks } = deps
  const now = deps.now ?? (() => Date.now())

  // ── Repeating bookings ────────────────────────────────────────────────────
  /**
   * Staff make a series; each visit is booked through the engine like any other (the same check, the same lock). A
   * visit that can't be had is listed back, not silently made — the site inserted every visit with no check at all,
   * though its own comment said clashes were marked.
   */
  async function createSeries(companyId: string, body: Record<string, any>, userId: string | null = null) {
    const svc = await engine.serviceById(companyId, String(body.serviceId || ''))
    if (!svc) throw new BookingError('Choose a service.')
    // Refused once, before any visit, rather than every visit listed back as refused.
    engine.assertListed(svc)
    const frequency: Frequency = body.frequency === 'monthly' ? 'monthly' : 'weekly'
    const intervalCount = body.frequency === 'biweekly' ? 2 : Math.max(1, Math.min(12, Math.trunc(n(body.intervalCount) || 1)))
    if (!isRealDate(body.date) || !/^\d{2}:\d{2}$/.test(String(body.time))) throw new BookingError('Choose the first visit\'s date and time.')
    const occurrencesCount = body.occurrencesCount ? Math.max(1, Math.min(52, Math.trunc(n(body.occurrencesCount)))) : null
    const untilDate = body.untilDate ? String(body.untilDate) : null
    if (untilDate && !isRealDate(untilDate)) throw new BookingError('The end date isn\'t a real date.')
    if (!occurrencesCount && !untilDate) throw new BookingError('Say how many visits, or until when.')
    const s = await engine.settingsOf(companyId)
    // The first visit is held like any desk booking — the phone the business asks for, and the window unless staff
    // tick "Book outside the hours" — before anything is written: the later visits are the series itself and run past
    // the window by design, so a series must not start where a single booking couldn't.
    engine.bookingRules(s, { by: 'staff', phone: text(body.phone, 40), zip: text(body.zip, 10), dates: [String(body.date)], outside: body.override === true })
    const tz = engine.tzOf(s)
    const spec = { frequency, intervalCount, firstStartAt: zonedWallTimeToUtc(body.date, body.time, tz), durationMinutes: svc.durationMinutes, timezone: tz, occurrencesCount, untilDate }
    const visits = expandSeries(spec)
    const name = String(body.name || '').trim(), mail = String(body.email || '').trim().toLowerCase()
    if (!name || !EMAIL_RE.test(mail)) throw new BookingError('The series needs the customer\'s name and email.')
    const [series] = await db.insert(bookingSeries).values({
      companyId, serviceId: svc.id, frequency, intervalCount, firstStartAt: spec.firstStartAt, occurrencesCount, untilDate,
      customerName: name, customerEmail: mail, customerPhone: text(body.phone, 40), customerAddress: text(body.address, 300), customerZip: text(body.zip, 10),
      customerNotes: text(body.notes, 2000), assignedUserId: body.assignedUserId || null, token: crypto.randomBytes(24).toString('base64url'),
    }).returning()
    const made: string[] = [], skipped: Array<{ date: string; reason: string }> = []
    for (const v of visits) {
      const input: BookInput = { service: svc.id, date: v.date, time: body.time, name, email: mail, phone: body.phone, address: body.address, zip: body.zip, notes: body.notes }
      try {
        const r = await engine.book(companyId, input, { by: 'staff', assignedUserId: body.assignedUserId || null, seriesId: series.id, seriesIndex: v.index, source: 'series', override: body.override === true, userId })
        made.push(r.booking.id)
      } catch (e: any) {
        if (!(e instanceof BookingError)) throw e
        skipped.push({ date: v.date, reason: e.message })
      }
    }
    if (!made.length) {
      await db.delete(bookingSeries).where(eq(bookingSeries.id, series.id))
      throw new BookingError(`None of the visits could be booked: ${skipped[0]?.reason ?? ''}`, 409)
    }
    if (made[0]) await db.update(bookingSeries).set({ contactId: (await engine.getBooking(companyId, made[0]))?.contactId ?? null }).where(eq(bookingSeries.id, series.id))
    return { ...series, summary: describeSeries(spec), booked: made.length, skipped }
  }

  async function getSeries(companyId: string, id: string) {
    const [s] = await db.select().from(bookingSeries).where(and(eq(bookingSeries.id, id), eq(bookingSeries.companyId, companyId))).limit(1)
    return s ?? null
  }
  const listSeries = (companyId: string) => db.select().from(bookingSeries).where(eq(bookingSeries.companyId, companyId)).orderBy(desc(bookingSeries.createdAt))

  /** Ends a series: every visit still to come is cancelled (each one told and freed like any cancel). */
  async function cancelSeries(companyId: string, id: string) {
    const series = await getSeries(companyId, id)
    if (!series) return null
    const future = await db.select().from(booking).where(and(eq(booking.seriesId, id), inArray(booking.status, ['pending', 'confirmed']), gt(booking.startAt, new Date(now()))))
    for (const b of future) await engine.cancel(companyId, b, { by: 'staff', reason: 'series ended' })
    const [u] = await db.update(bookingSeries).set({ status: 'cancelled', cancelledAt: new Date(now()), updatedAt: new Date(now()) }).where(eq(bookingSeries.id, id)).returning()
    return { ...u, cancelledVisits: future.length }
  }

  // ── Waitlist ──────────────────────────────────────────────────────────────
  async function joinWaitlist(companyId: string, slug: string, body: Record<string, any>) {
    const svc = await engine.serviceBySlug(companyId, slug)
    if (!engine.offered(svc)) throw new BookingError('That service is not available.', 404)
    const name = String(body.name || '').trim().slice(0, 200), mail = String(body.email || '').trim().toLowerCase()
    if (!name) throw new BookingError('Please enter your name.')
    if (!EMAIL_RE.test(mail)) throw new BookingError('Please enter a valid email address.')
    for (const k of ['from', 'to']) if (body[k] && !isRealDate(body[k])) throw new BookingError('Choose real dates.')
    if (body.from && body.to && body.from > body.to) throw new BookingError('The first date must be before the last.')
    // The same rules as taking a booking (engine.customerRules): the window, and the phone the booking form asks for.
    const phone = text(body.phone, 40) ?? null
    const zip = text(body.zip, 10) ?? null
    engine.customerRules(await engine.settingsOf(companyId), { phone, zip, dates: [body.from, body.to].filter(Boolean) })
    if (await engine.isBanned(companyId, mail, phone)) throw new BookingError("We can't take this online — please call us.", 403)
    const [row] = await db.insert(bookingWaitlist).values({
      companyId, serviceId: svc.id, customerName: name, customerEmail: mail, customerPhone: phone, customerZip: zip && (normaliseZip(zip) ?? zip),
      preferredFrom: body.from || null, preferredTo: body.to || null, notes: text(body.notes, 1000),
    }).returning()
    return row
  }
  async function listWaitlist(companyId: string) {
    // An entry whose last date has passed is no longer waiting.
    const today = tzParts(new Date(now()), engine.tzOf(await engine.settingsOf(companyId))).date
    await db.update(bookingWaitlist).set({ status: 'expired' }).where(and(eq(bookingWaitlist.companyId, companyId), eq(bookingWaitlist.status, 'open'), lt(bookingWaitlist.preferredTo, today)))
    return db.select({ w: bookingWaitlist, serviceName: bookingService.name }).from(bookingWaitlist).leftJoin(bookingService, eq(bookingWaitlist.serviceId, bookingService.id))
      .where(eq(bookingWaitlist.companyId, companyId)).orderBy(desc(bookingWaitlist.createdAt))
      .then((rows: any[]) => rows.map((r) => ({ ...r.w, serviceName: r.serviceName })))
  }
  async function removeWaitlist(companyId: string, id: string) {
    return (await db.delete(bookingWaitlist).where(and(eq(bookingWaitlist.id, id), eq(bookingWaitlist.companyId, companyId))).returning({ id: bookingWaitlist.id })).length > 0
  }

  // ── Bans ──────────────────────────────────────────────────────────────────
  const listBans = (companyId: string) => db.select().from(bookingBan).where(eq(bookingBan.companyId, companyId)).orderBy(desc(bookingBan.createdAt))
  async function addBan(companyId: string, body: Record<string, any>, userId: string) {
    const mail = text(body.email, 320)?.toLowerCase() ?? null
    const phone = String(body.phone || '').replace(/\D/g, '') || null
    if (!mail && !phone) throw new BookingError('Enter an email address or a phone number.')
    if (mail && !EMAIL_RE.test(mail)) throw new BookingError('That email address doesn\'t look right.')
    const [row] = await db.insert(bookingBan).values({ companyId, email: mail, phone, reason: text(body.reason, 300), addedByUserId: userId }).returning()
    return row
  }
  const removeBan = async (companyId: string, id: string) => (await db.delete(bookingBan).where(and(eq(bookingBan.id, id), eq(bookingBan.companyId, companyId))).returning({ id: bookingBan.id })).length > 0

  // ── Webhooks ──────────────────────────────────────────────────────────────
  /** The secret is shown once, when the webhook is made; listed afterwards without it. */
  const hookOut = (w: any) => { const { secret: _s, ...rest } = w; return rest }
  const listWebhooks = async (companyId: string) => (await db.select().from(bookingWebhook).where(eq(bookingWebhook.companyId, companyId)).orderBy(desc(bookingWebhook.createdAt))).map(hookOut)
  function hookEvents(v: unknown): string[] {
    if (v === undefined || v === null || (Array.isArray(v) && !v.length)) return ['*']
    if (!Array.isArray(v) || v.some((e) => e !== '*' && !(WEBHOOK_EVENTS as readonly string[]).includes(String(e)))) throw new BookingError(`Events are any of ${WEBHOOK_EVENTS.join(', ')}, or *.`)
    return v.map(String)
  }
  async function addWebhook(companyId: string, body: Record<string, any>) {
    const url = String(body.url || '').trim()
    const problem = await webhooks.checkUrl(url)
    if (problem) throw new BookingError(problem)
    const secret = crypto.randomBytes(24).toString('hex')
    const [row] = await db.insert(bookingWebhook).values({ companyId, url: url.slice(0, 2000), secret, events: hookEvents(body.events) }).returning()
    return { ...hookOut(row), secret }
  }
  async function updateWebhook(companyId: string, id: string, body: Record<string, any>) {
    const u: Record<string, unknown> = {}
    if (body.url !== undefined) {
      const problem = await webhooks.checkUrl(String(body.url))
      if (problem) throw new BookingError(problem)
      u.url = String(body.url).trim().slice(0, 2000)
    }
    if (body.events !== undefined) u.events = hookEvents(body.events)
    if (typeof body.active === 'boolean') u.active = body.active
    if (!Object.keys(u).length) throw new BookingError('Nothing to change.')
    const [row] = await db.update(bookingWebhook).set(u).where(and(eq(bookingWebhook.id, id), eq(bookingWebhook.companyId, companyId))).returning()
    return row ? hookOut(row) : null
  }
  const removeWebhook = async (companyId: string, id: string) => (await db.delete(bookingWebhook).where(and(eq(bookingWebhook.id, id), eq(bookingWebhook.companyId, companyId))).returning({ id: bookingWebhook.id })).length > 0

  // ── Customers and the numbers ─────────────────────────────────────────────
  /**
   * Everyone who has booked, by email: visits, no-shows, first and last visit, and booked value — the price of
   * their completed visits (deposits and payments are the CRM's). The site called it "lifetime value", which it isn't.
   */
  async function customers(companyId: string) {
    const rows = await db.select({ email: booking.customerEmail, name: booking.customerName, phone: booking.customerPhone, contactId: booking.contactId, startAt: booking.startAt, status: booking.status, price: bookingService.price })
      .from(booking).leftJoin(bookingService, eq(booking.serviceId, bookingService.id)).where(eq(booking.companyId, companyId)).orderBy(asc(booking.startAt))
    const by = new Map<string, any>()
    for (const r of rows) {
      const c = by.get(r.email) ?? { email: r.email, name: r.name, names: [] as string[], phone: r.phone, contactId: r.contactId, bookings: 0, completed: 0, noShows: 0, cancelled: 0, bookedValue: 0, firstVisit: null, lastVisit: null, nextVisit: null }
      c.name = r.name; c.phone = r.phone || c.phone; c.contactId = r.contactId || c.contactId
      // Everyone who has booked under this email, in the name each typed (a household shares one address): the latest
      // first, each once. (Field service T24 L1)
      c.names = [r.name, ...c.names.filter((x: string) => x !== r.name)]
      c.bookings++
      if (r.status === 'completed') { c.completed++; c.bookedValue += n(r.price); c.lastVisit = r.startAt; c.firstVisit ??= r.startAt }
      if (r.status === 'no_show') c.noShows++
      if (r.status === 'cancelled') c.cancelled++
      if ((r.status === 'confirmed' || r.status === 'pending') && r.startAt.getTime() > now() && !c.nextVisit) c.nextVisit = r.startAt
      by.set(r.email, c)
    }
    return [...by.values()].map((c) => ({ ...c, bookedValue: Math.round(c.bookedValue * 100) / 100 })).sort((a, b) => b.bookings - a.bookings)
  }

  /** The last `days` days: counts by status, booked value, no-show rate, busiest days and hours IN THE BUSINESS'S ZONE (the site used the server's), top services. */
  async function analytics(companyId: string, days = 90) {
    const s = await engine.settingsOf(companyId)
    const tz = engine.tzOf(s)
    const since = new Date(now() - days * 86_400_000)
    const rows = await db.select({ status: booking.status, startAt: booking.startAt, serviceName: bookingService.name, price: bookingService.price, source: booking.source })
      .from(booking).leftJoin(bookingService, eq(booking.serviceId, bookingService.id))
      .where(and(eq(booking.companyId, companyId), gte(booking.startAt, since), lt(booking.startAt, new Date(now()))))
    const byStatus: Record<string, number> = {}, byWeekday = [0, 0, 0, 0, 0, 0, 0], byHour = Array(24).fill(0), bySource: Record<string, number> = {}
    const services = new Map<string, number>()
    let bookedValue = 0
    const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1
      bySource[r.source] = (bySource[r.source] || 0) + 1
      if (r.status === 'cancelled') continue
      const p = tzParts(r.startAt, tz)
      byWeekday[names.indexOf(p.weekday)]++
      byHour[Math.floor(p.minutes / 60)]++
      services.set(r.serviceName || 'Removed service', (services.get(r.serviceName || 'Removed service') || 0) + 1)
      if (r.status === 'completed') bookedValue += n(r.price)
    }
    const happened = (byStatus.completed || 0) + (byStatus.no_show || 0)
    return {
      days, timezone: tz, total: rows.length, byStatus, bySource,
      bookedValue: Math.round(bookedValue * 100) / 100,
      noShowRate: happened ? Math.round(((byStatus.no_show || 0) / happened) * 1000) / 1000 : null,
      byWeekday, byHour,
      topServices: [...services.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
    }
  }

  // ── The calendar feed ─────────────────────────────────────────────────────
  /** The business's bookings as a calendar to subscribe to: from 60 days ago on, cancelled ones marked so they disappear. */
  async function feed(token: string) {
    const [s] = await db.select().from(bookingSettings).where(eq(bookingSettings.icalFeedToken, token)).limit(1)
    if (!s || !token) return null
    const rows = await db.select({ b: booking, svc: bookingService }).from(booking).leftJoin(bookingService, eq(booking.serviceId, bookingService.id))
      .where(and(eq(booking.companyId, s.companyId), gte(booking.startAt, new Date(now() - 60 * 86_400_000)), ne(booking.status, 'pending')))
    // The owner's own calendar: each event names the customer.
    const events = rows.map((r: any) => icsOf(r.b, r.svc, `${r.b.customerName}`, r.b.status === 'cancelled').split('\r\n').filter((l: string) => !/^(BEGIN|END):VCALENDAR|^VERSION|^PRODID|^CALSCALE/.test(l)))
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Twomiah//Bookings//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Bookings', ...events.flat(), 'END:VCALENDAR'].join('\r\n')
  }

  // ── Scheduled messages (run by the Factory's scheduler, /api/internal/booking-jobs) ──
  /**
   * One pass of every timed message, for every company in this database. Each message is stamped when it goes, so a
   * second pass never repeats one; a failed send isn't stamped and is tried next time.
   *   reminder — between 20 and 28 hours before the start (an hourly pass can't miss the window), by email and by text
   *              (each stamped on its own; a text the business can't send yet — no texting, no balance — is tried again).
   *   rebook   — the service's rebook interval after a completed visit, unless they've booked that service again.
   *   review   — one to three days after a completed visit, when the business has a review link.
   */
  async function runJobs() {
    const t = now()
    const sent = { reminders: 0, rebooks: 0, reviews: 0 }
    // Each on its business's one clock (the company's — engine.ts settingsOf), never the settings row's own column.
    const clocks = new Map((await db.select().from(company)).map((co: any) => [co.id, companyRowTimeZone(co)]))
    const settingsRows: any[] = await db.select().from(bookingSettings)
    const settingsOf = new Map(settingsRows.map((s) => [s.companyId, { ...s, timezone: clocks.get(s.companyId) ?? companyRowTimeZone(null) }]))
    const svcCache = new Map<string, any>()
    const svcOf = async (id: string | null) => { if (!id) return null; if (!svcCache.has(id)) svcCache.set(id, (await db.select().from(bookingService).where(eq(bookingService.id, id)).limit(1))[0] ?? null); return svcCache.get(id) }

    const due = await db.select().from(booking).where(and(eq(booking.status, 'confirmed'), isNull(booking.reminderEmailSentAt), gte(booking.startAt, new Date(t + 20 * 3600_000)), lte(booking.startAt, new Date(t + 28 * 3600_000))))
    for (const b of due) {
      const s = settingsOf.get(b.companyId); if (!s) continue
      try {
        await email.send(b.customerEmail, 'bookingReminder', messageFor(b, await svcOf(b.serviceId), s))
        await db.update(booking).set({ reminderEmailSentAt: new Date(t) }).where(eq(booking.id, b.id))
        sent.reminders++
      } catch (e: any) { logger.warn('Booking reminder failed', { id: b.id, error: e?.message }) }
    }

    if (deps.texts) {
      const dueText = await db.select().from(booking).where(and(eq(booking.status, 'confirmed'), isNull(booking.reminderSmsSentAt), isNotNull(booking.customerPhone), gte(booking.startAt, new Date(t + 20 * 3600_000)), lte(booking.startAt, new Date(t + 28 * 3600_000))))
      const names = new Map<string, string>()
      for (const b of dueText) {
        const s = settingsOf.get(b.companyId); if (!s) continue
        try {
          if (!names.has(b.companyId)) names.set(b.companyId, (await db.select({ name: company.name }).from(company).where(eq(company.id, b.companyId)).limit(1))[0]?.name || '')
          const m = messageFor(b, await svcOf(b.serviceId), s)
          const r = await deps.texts.send(b, bookingTextFor.reminder({ companyName: names.get(b.companyId)!, serviceName: m.serviceName, when: m.when, manageUrl: m.manageUrl }))
          if (r !== 'refused') await db.update(booking).set({ reminderSmsSentAt: new Date(t) }).where(eq(booking.id, b.id))
          if (r === 'sent') sent.reminders++
        } catch (e: any) { logger.warn('Booking reminder text failed', { id: b.id, error: e?.message }) }
      }
    }

    const done = await db.select({ b: booking, svc: bookingService }).from(booking).innerJoin(bookingService, eq(booking.serviceId, bookingService.id))
      .where(and(eq(booking.status, 'completed'), gte(booking.startAt, new Date(t - 800 * 86_400_000))))
    for (const { b, svc } of done) {
      const s = settingsOf.get(b.companyId); if (!s) continue
      const age = t - b.startAt.getTime()
      if (!b.reviewRequestSentAt && s.reviewLink && age >= 86_400_000 && age <= 3 * 86_400_000) {
        try {
          await email.send(b.customerEmail, 'bookingReviewRequest', messageFor(b, svc, s, { reviewLink: s.reviewLink }))
          await db.update(booking).set({ reviewRequestSentAt: new Date(t) }).where(eq(booking.id, b.id))
          // …and by text, once, beside the email (the site sent both)
          if (deps.texts) {
            const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, b.companyId)).limit(1)
            await deps.texts.send(b, bookingTextFor.review({ companyName: co?.name || '', customerName: b.customerName, reviewLink: s.reviewLink }))
              .catch((e: any) => logger.warn('Booking review text failed', { id: b.id, error: e?.message }))
          }
          sent.reviews++
        } catch (e: any) { logger.warn('Booking review request failed', { id: b.id, error: e?.message }) }
      }
      if (!b.rebookReminderSentAt && svc.rebookIntervalDays && svc.active && age >= svc.rebookIntervalDays * 86_400_000) {
        // Not if they've already booked this service again (on or after this visit).
        const [again] = await db.select({ id: booking.id }).from(booking).where(and(eq(booking.companyId, b.companyId), eq(booking.customerEmail, b.customerEmail), eq(booking.serviceId, svc.id), gt(booking.startAt, b.startAt), ne(booking.status, 'cancelled'))).limit(1)
        try {
          if (!again) await email.send(b.customerEmail, 'bookingRebook', messageFor(b, svc, s, { bookUrl: `${siteOrigin()}/book/${svc.slug}` }))
          await db.update(booking).set({ rebookReminderSentAt: new Date(t) }).where(eq(booking.id, b.id))
          if (!again) sent.rebooks++
        } catch (e: any) { logger.warn('Booking rebook reminder failed', { id: b.id, error: e?.message }) }
      }
    }
    return sent
  }

  return {
    createSeries, getSeries, listSeries, cancelSeries,
    joinWaitlist, listWaitlist, removeWaitlist,
    listBans, addBan, removeBan,
    listWebhooks, addWebhook, updateWebhook, removeWebhook,
    customers, analytics, feed, runJobs,
  }
}

export type BookingExtras = ReturnType<typeof createBookingExtras>
