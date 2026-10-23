// Bookings' doors: the owner's API (/api/booking), the public one the booking pages call (/api/book), and the
// Factory's door to the scheduled pass (/api/internal/booking-jobs; the pass also runs hourly on its own, startJobs).
// The owner's and public APIs are behind the 'online_booking' feature through the registry
// — the public half answers 404 when it is off, so nobody can tell what exists (SPEC §5.2).
import { Hono, type Context } from 'hono'
import { list, one, fail, done, listAll } from '../http/reply.ts'
import { createRateLimiter, isWrite } from '../http/guards.ts'
import type { AppEnv } from '../http/env.ts'
import type { Mount } from '../http/registry.ts'
import type { EmailService } from '../core/email.ts'
import type { Logger } from '../core/logger.ts'
import type { VerticalSettings } from '../core/vertical.ts'
import { createBookingEngine, BookingError, type BookingEngine, type BookingRow, type DepositProvider } from '../booking/engine.ts'
import { createBookingExtras, type BookingExtras } from '../booking/extras.ts'
import { createBookingWebhooks } from '../booking/webhooks.ts'
import { createHappenings } from '../booking/happenings.ts'
import { bookingTemplates } from '../booking/emails.ts'
import { createPracticeBooking } from '../crm/vet/onlineBooking.ts'
import { createChairBooking } from '../crm/salon/onlineBooking.ts'
import { createCalendars, PROVIDERS, type Calendars, type Provider } from '../booking/calendars.ts'
import type { BookingTexts } from '../booking/texts.ts'
import { ticked } from '../site/smsConsent.ts'

const FEATURE = 'online_booking'

/** A BookingError becomes its own status and sentence; anything else is the error handler's. */
async function guard<T>(c: Context, fn: () => Promise<T>) {
  try { return await fn() } catch (e) {
    if (e instanceof BookingError) return fail(c, e.status as any, e.message, e.code)
    throw e
  }
}
const body = async (c: Context): Promise<Record<string, any>> => (c.req.header('content-type') || '').includes('application/json') ? await c.req.json().catch(() => ({})) : await c.req.parseBody().catch(() => ({})) as any
const pageOf = (c: Context) => ({ page: Math.max(1, Number(c.req.query('page')) || 1), limit: Math.min(500, Math.max(1, Number(c.req.query('limit')) || 100)) })
/** The vertical's own questions' answers from a form (BookingAddOn.questions). */
const answersOf = (engine: BookingEngine, b: Record<string, any>) => Object.fromEntries(engine.questions.map((q) => [q.name, b[q.name]]))

/** What a customer's page may see of a booking (never another customer's details: it is reached by its token). */
const publicBooking = (b: BookingRow, engine: BookingEngine, cutoffOpen: boolean) => ({
  status: b.status, startAt: b.startAt, endAt: b.endAt, customerName: b.customerName, customerAddress: b.customerAddress,
  depositStatus: b.depositStatus, canChange: cutoffOpen,
})

export function createBookingModule(deps: { db: any; vertical: VerticalSettings; email: EmailService; logger: Logger; permissions: any; deposits?: DepositProvider; calendars?: Calendars; texts?: BookingTexts; isFeatureEnabled?: (companyId: string, feature: string) => Promise<boolean> }) {
  const { db, email, logger, permissions } = deps
  // People's own Google / Outlook calendars: their busy time, and their bookings put on them (booking/calendars.ts).
  const calendars = deps.calendars ?? createCalendars({ db, logger })
  const may = permissions.requirePermission as (p: string) => any
  email.register(bookingTemplates)
  const webhooks = createBookingWebhooks({ db, logger })
  const happen = createHappenings({ db, email, logger, webhooks, texts: deps.texts })
  const engine = createBookingEngine({
    // The vertical's answers (VerticalSettings.booking): whether the address is asked (basic, salon, vet, bar say no —
    // templates/crm-basic T42), and where a booking lands besides the list (the vet's practice book).
    db, requireAddressDefault: deps.vertical.booking?.requireAddress ?? true, deposits: deps.deposits, externalBusy: calendars.externalBusy,
    addOn: deps.vertical.booking?.calendar === 'practice' ? createPracticeBooking({ requirePet: deps.vertical.booking.requirePet === true })
      : deps.vertical.booking?.calendar === 'chair' ? createChairBooking() : undefined,
    onHappening: (h) => { void happen(h); void calendars.onHappening(h) },
    // "Convert to job": numbered as the vertical's job module numbers its jobs — roofing's own (crm/roof/jobs.ts
    // ROOF-0001), everyone else's the shared module's default (packages/tenant-backend jobs.ts JOB-00001).
    jobs: deps.vertical.crm ? { numbering: deps.vertical.crm.roof ? { prefix: 'ROOF', pad: 4 } : { prefix: 'JOB', pad: 5 }, defaultType: deps.vertical.crm.jobs?.defaultType } : undefined,
  })
  const extras = createBookingExtras({ db, engine, email, logger, webhooks, texts: deps.texts })

  // ── The owner's API ───────────────────────────────────────────────────────
  const admin = new Hono<AppEnv>()
  const co = (c: Context<AppEnv>) => c.get('user').companyId

  admin.get('/settings', may('bookings:read'), async (c) => one(c, await engine.settingsOf(co(c))))
  admin.patch('/settings', may('bookings:settings'), (c) => guard(c, async () => one(c, await engine.updateSettings(co(c), await body(c)))))
  admin.post('/settings/feed-token', may('bookings:settings'), async (c) => one(c, await engine.rotateFeedToken(co(c))))

  admin.get('/services', may('bookings:read'), async (c) => { const rows = await engine.listServices(co(c)); return listAll(c, rows) })
  admin.post('/services', may('bookings:settings'), (c) => guard(c, async () => one(c, await engine.createService(co(c), await body(c)), 201)))
  admin.patch('/services/:id', may('bookings:settings'), (c) => guard(c, async () => {
    const s = await engine.updateService(co(c), c.req.param('id'), await body(c))
    return s ? one(c, s) : fail(c, 404, 'Service not found')
  }))
  admin.delete('/services/:id', may('bookings:settings'), (c) => guard(c, async () => (await engine.deleteService(co(c), c.req.param('id'))) ? done(c) : fail(c, 404, 'Service not found')))

  // Hours and days off are the day-to-day running of the book: anyone who may change bookings may set them.
  admin.get('/hours', may('bookings:read'), async (c) => { const rows = await engine.getHours(co(c)); return listAll(c, rows) })
  admin.put('/hours', may('bookings:update'), (c) => guard(c, async () => { const b = await body(c); const rows = await engine.setHours(co(c), b.hours); return listAll(c, rows) }))
  admin.get('/days-off', may('bookings:read'), async (c) => { const rows = await engine.listDaysOff(co(c), c.req.query('from')); return listAll(c, rows) })
  admin.post('/days-off', may('bookings:update'), (c) => guard(c, async () => one(c, await engine.addDayOff(co(c), await body(c)), 201)))
  admin.delete('/days-off/:id', may('bookings:update'), async (c) => (await engine.removeDayOff(co(c), c.req.param('id'))) ? done(c) : fail(c, 404, 'Not found'))
  admin.get('/zones', may('bookings:read'), async (c) => { const rows = await engine.listZones(co(c)); return listAll(c, rows) })
  admin.put('/zones/:userId', may('bookings:settings'), (c) => guard(c, async () => { const z = await engine.setZone(co(c), c.req.param('userId'), (await body(c)).zips); return z ? one(c, z) : done(c) }))

  admin.get('/bookings', may('bookings:read'), async (c) => {
    const p = pageOf(c)
    const q = c.req.query()
    const { rows, total } = await engine.listBookings(co(c), { ...p, from: q.from ? new Date(q.from) : undefined, to: q.to ? new Date(q.to) : undefined, status: q.status, assignedUserId: q.assignedUserId, contactId: q.contactId, seriesId: q.seriesId })
    return list(c, rows, { ...p, total })
  })
  /** Free times for staff: the same answer customers get, for any active service, by id. */
  admin.get('/availability', may('bookings:read'), (c) => guard(c, async () => {
    const svc = await engine.serviceById(co(c), c.req.query('serviceId') || '')
    if (!svc) return fail(c, 404, 'Service not found')
    const date = c.req.query('date')
    if (date) { const rows = await engine.availableTimes(co(c), svc.slug, date, c.req.query('zip'), c.req.query('except')); return listAll(c, rows) }
    const rows = await engine.availableDates(co(c), svc.slug, c.req.query('zip'))
    return listAll(c, rows)
  }))
  admin.post('/bookings', may('bookings:create'), (c) => guard(c, async () => {
    const b = await body(c)
    const r = await engine.book(co(c), { ...b, service: String(b.serviceId || b.service || ''), answers: answersOf(engine, b) } as any, { by: 'staff', assignedUserId: b.assignedUserId || null, override: b.override === true, userId: c.get('user').userId })
    return one(c, await engine.withNames(r.booking), 201)
  }))
  admin.get('/bookings/:id', may('bookings:read'), async (c) => {
    const b = await engine.getBooking(co(c), c.req.param('id'))
    return b ? one(c, await engine.withNames(b)) : fail(c, 404, 'Booking not found')
  })
  /** Move it (date + time), change its status, or edit its details — one at a time, each with its own rules. */
  admin.patch('/bookings/:id', may('bookings:update'), (c) => guard(c, async () => {
    const b = await engine.getBooking(co(c), c.req.param('id'))
    if (!b) return fail(c, 404, 'Booking not found')
    const input = await body(c)
    const u = input.date || input.time ? await engine.reschedule(co(c), b, String(input.date || ''), String(input.time || ''), { by: 'staff', override: input.override === true, userId: c.get('user').userId })
      : input.status ? (input.status === 'cancelled' ? await engine.cancel(co(c), b, { by: 'staff', reason: input.reason }) : await engine.setStatus(co(c), b, String(input.status)))
      : await engine.updateDetails(co(c), b, input)
    return one(c, await engine.withNames(u))
  }))

  /**
   * "Convert to job": the booking becomes a job on the schedule, linked to it. Both sides' permissions, and the jobs
   * feature — the same gates as making a job on the Jobs page (gate both sides: the button asks the same).
   */
  admin.post('/bookings/:id/job', may('bookings:update'), may('jobs:create'), (c) => guard(c, async () => {
    if (!deps.isFeatureEnabled || !(await deps.isFeatureEnabled(co(c), 'jobs'))) return fail(c, 404, 'Jobs are not switched on for this account.')
    const b = await engine.getBooking(co(c), c.req.param('id'))
    if (!b) return fail(c, 404, 'Booking not found')
    return one(c, await engine.convertToJob(co(c), b, c.get('user').userId), 201)
  }))

  admin.get('/series', may('bookings:read'), async (c) => { const rows = await extras.listSeries(co(c)); return listAll(c, rows) })
  admin.post('/series', may('bookings:create'), (c) => guard(c, async () => one(c, await extras.createSeries(co(c), await body(c), c.get('user').userId), 201)))
  admin.get('/series/:id', may('bookings:read'), async (c) => { const s = await extras.getSeries(co(c), c.req.param('id')); return s ? one(c, s) : fail(c, 404, 'Not found') })
  admin.delete('/series/:id', may('bookings:update'), async (c) => { const s = await extras.cancelSeries(co(c), c.req.param('id')); return s ? one(c, s) : fail(c, 404, 'Not found') })

  admin.get('/waitlist', may('bookings:read'), async (c) => { const rows = await extras.listWaitlist(co(c)); return listAll(c, rows) })
  admin.delete('/waitlist/:id', may('bookings:update'), async (c) => (await extras.removeWaitlist(co(c), c.req.param('id'))) ? done(c) : fail(c, 404, 'Not found'))

  admin.get('/bans', may('bookings:settings'), async (c) => { const rows = await extras.listBans(co(c)); return listAll(c, rows) })
  admin.post('/bans', may('bookings:settings'), (c) => guard(c, async () => one(c, await extras.addBan(co(c), await body(c), c.get('user').userId), 201)))
  admin.delete('/bans/:id', may('bookings:settings'), async (c) => (await extras.removeBan(co(c), c.req.param('id'))) ? done(c) : fail(c, 404, 'Not found'))

  admin.get('/webhooks', may('bookings:settings'), async (c) => { const rows = await extras.listWebhooks(co(c)); return listAll(c, rows) })
  admin.post('/webhooks', may('bookings:settings'), (c) => guard(c, async () => one(c, await extras.addWebhook(co(c), await body(c)), 201)))
  admin.patch('/webhooks/:id', may('bookings:settings'), (c) => guard(c, async () => { const w = await extras.updateWebhook(co(c), c.req.param('id'), await body(c)); return w ? one(c, w) : fail(c, 404, 'Not found') }))
  admin.delete('/webhooks/:id', may('bookings:settings'), async (c) => (await extras.removeWebhook(co(c), c.req.param('id'))) ? done(c) : fail(c, 404, 'Not found'))

  // A person's own calendar: linked through the Factory's sign-in, which comes back to the page it was started from.
  admin.get('/calendar/connections', may('bookings:read'), async (c) => { const rows = await calendars.connectionsOf(c.get('user').userId); return listAll(c, rows) })
  admin.get('/calendar/providers', may('bookings:read'), (c) => one(c, { providers: calendars.providers() }))
  admin.get('/calendar/:provider/connect-url', may('bookings:read'), (c) => {
    const provider = c.req.param('provider') as Provider
    if (!PROVIDERS.includes(provider)) return fail(c, 404, 'Not found')
    const host = c.req.header('Host') || ''
    const proto = c.req.header('X-Forwarded-Proto') || (host.startsWith('localhost') ? 'http' : 'https')
    const url = calendars.connectUrl(provider, c.get('user').userId, `${proto}://${host}/crm/bookings/settings`)
    return url ? one(c, { url }) : fail(c, 503, 'Calendar linking isn\'t set up for this account yet — contact support.')
  })
  // The answer says whether Google revoked the access, or why it was kept (another link here on the same account).
  admin.delete('/calendar/connections/:id', may('bookings:read'), async (c) => {
    const r = await calendars.disconnect(c.get('user').userId, c.req.param('id'))
    return r ? one(c, { success: true, ...r }) : fail(c, 404, 'Not found')
  })

  /**
   * "Booked value" is what the business TOOK — the price of completed visits — so it is revenue:read's, the permission
   * the dashboards ask for their takings figure (permissions.ts: revenue:read). A stylist, a technician or a vet's front
   * desk reads the counts, the busiest days and who books, and not the money. ABSENT rather than 0, so no tile prints
   * "$0" for a figure it was not given. (Live role check, 2026-10-23)
   */
  const seesTakings = async (c: any) => {
    const u = c.get('user')
    return permissions.hasPermission(u.role, 'revenue:read', await permissions.getExtraPermissions(u.userId))
  }
  admin.get('/customers', may('bookings:read'), async (c) => {
    const rows = await extras.customers(co(c))
    return listAll(c, (await seesTakings(c)) ? rows : rows.map(({ bookedValue: _value, ...r }: any) => r))
  })
  admin.get('/analytics', may('bookings:read'), async (c) => {
    const stats: any = await extras.analytics(co(c), Math.min(365, Math.max(7, Number(c.req.query('days')) || 90)))
    if (await seesTakings(c)) return one(c, stats)
    const { bookedValue: _value, ...rest } = stats
    return one(c, rest)
  })

  // ── The public API the booking pages call ─────────────────────────────────
  // Taking a booking or joining the waitlist: 10 an hour from one address (the site allowed 3, which a family
  // booking two visits and fixing a typo used up).
  const pub = new Hono()
  pub.use('/services/:slug', createRateLimiter(60 * 60 * 1000, 10, isWrite))
  pub.use('/services/:slug/waitlist', createRateLimiter(60 * 60 * 1000, 10, isWrite))
  pub.use('/bookings/*', createRateLimiter(60 * 60 * 1000, 30, isWrite))
  // The scheduled messages (booking/extras.ts runJobs): a reminder the day before, the rebook nudge, the review request.
  // One pass at a time — the clock and the Factory's door share it — so a booking can't be sent the same thing twice
  // by two passes reading it before either marks it sent.
  let running: ReturnType<BookingExtras['runJobs']> | null = null
  const runJobs = () => running ?? (running = extras.runJobs().finally(() => { running = null }))
  /** Hourly from a minute after boot: the reminder looks 20–28 hours ahead, so every booking falls in one pass. */
  function startJobs() {
    const pass = () => { runJobs().catch((e: any) => logger.error('[bookings] scheduled messages failed', { error: e?.message })) }
    setTimeout(pass, 60_000)
    setInterval(pass, 60 * 60 * 1000)
  }
  return { engine, extras, admin, pub, webhooks, runJobs, startJobs, calendars }
}

/** The mounts, once the public router has its company (one company per tenant database). */
export function bookingMounts(m: ReturnType<typeof createBookingModule>, companyId: () => Promise<string | null>): Mount[] {
  const { engine, extras, pub } = m
  const withCompany = async (c: Context, fn: (id: string) => Promise<Response>) => {
    const id = await companyId()
    return id ? fn(id) : fail(c, 404, 'Not found')
  }
  const notBot = (b: Record<string, any>) => !String(b.website || '').trim() && !(Number(b.t) > 0 && Date.now() - Number(b.t) < 2000)

  pub.get('/services', (c) => withCompany(c, async (id) => {
    const s = await engine.settingsOf(id)
    const rows = s.enabled ? (await engine.listServices(id, { activeOnly: true })).map((x) => ({ slug: x.slug, name: x.name, description: x.description, durationMinutes: x.durationMinutes, price: x.price, tipPresets: x.tipPresets })) : []
    return listAll(c, rows)
  }))
  pub.get('/services/:slug/dates', (c) => withCompany(c, (id) => guard(c, async () => {
    const rows = await engine.availableDates(id, c.req.param('slug'), c.req.query('zip'))
    return listAll(c, rows)
  }) as Promise<Response>))
  pub.get('/services/:slug/times', (c) => withCompany(c, (id) => guard(c, async () => {
    // Moving a booking: its own time doesn't block itself. Reached by its token, never its id.
    const moving = c.req.query('token') ? await engine.byToken(id, c.req.query('token')!) : null
    const rows = await engine.availableTimes(id, c.req.param('slug'), c.req.query('date') || '', c.req.query('zip'), moving?.id)
    return listAll(c, rows)
  }) as Promise<Response>))
  pub.post('/services/:slug', (c) => withCompany(c, (id) => guard(c, async () => {
    const b = await body(c)
    if (!notBot(b)) return fail(c, 400, 'Please try again.')
    const r = await engine.book(id, {
      service: c.req.param('slug'), date: b.date, time: b.time, name: b.name, email: b.email, phone: b.phone, address: b.address, zip: b.zip, notes: b.notes,
      tipPercent: b.tipPercent != null && b.tipPercent !== '' ? Number(b.tipPercent) : null, sourcePath: b.sourcePath, sourceReferrer: b.sourceReferrer, sourceVariant: b.sourceVariant,
      answers: answersOf(engine, b), smsConsent: ticked(b),
    }, { by: 'customer' })
    return one(c, { token: r.booking.token, status: r.booking.status, deposit: r.deposit }, 201)
  }) as Promise<Response>))
  pub.post('/services/:slug/waitlist', (c) => withCompany(c, (id) => guard(c, async () => {
    const b = await body(c)
    if (!notBot(b)) return fail(c, 400, 'Please try again.')
    await extras.joinWaitlist(id, c.req.param('slug'), b)
    return done(c, "You're on the list. We'll email you when a time opens.")
  }) as Promise<Response>))
  pub.get('/bookings/:token', (c) => withCompany(c, async (id) => {
    const b = await engine.byToken(id, c.req.param('token'))
    if (!b) return fail(c, 404, 'Booking not found')
    return one(c, publicBooking(b, engine, engine.selfServiceOpen(b, await engine.settingsOf(id))))
  }))
  pub.post('/bookings/:token/reschedule', (c) => withCompany(c, (id) => guard(c, async () => {
    const b = await engine.byToken(id, c.req.param('token'))
    if (!b) return fail(c, 404, 'Booking not found')
    const input = await body(c)
    const u = await engine.reschedule(id, b, String(input.date || ''), String(input.time || ''), { by: 'customer' })
    return one(c, publicBooking(u, engine, engine.selfServiceOpen(u, await engine.settingsOf(id))))
  }) as Promise<Response>))
  pub.post('/bookings/:token/cancel', (c) => withCompany(c, (id) => guard(c, async () => {
    const b = await engine.byToken(id, c.req.param('token'))
    if (!b) return fail(c, 404, 'Booking not found')
    const u = await engine.cancel(id, b, { by: 'customer' })
    return one(c, publicBooking(u, engine, false))
  }) as Promise<Response>))
  pub.get('/feed/:token', async (c) => {
    const ics = await extras.feed(c.req.param('token').replace(/\.ics$/, ''))
    if (!ics) return fail(c, 404, 'Not found')
    return c.body(ics, 200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=300' })
  })

  const jobs = new Hono().post('/', async (c) => one(c, await m.runJobs()))
  // The Factory's calendar sign-in posts a person's tokens here (booking/calendars.ts storeTokens).
  const calendarTokens = new Hono().post('/', async (c) => {
    const r = await m.calendars.storeTokens(await body(c))
    return 'error' in r ? fail(c, 400, r.error) : one(c, { connectionId: r.id })
  })

  return [
    { path: '/api/booking', access: 'user', feature: FEATURE, router: m.admin },
    { path: '/api/book', access: 'public', feature: FEATURE, router: pub },
    { path: '/api/internal/booking-jobs', access: 'factory', router: jobs },
    { path: '/api/internal/calendar/store-tokens', access: 'factory', router: calendarTokens },
  ]
}
