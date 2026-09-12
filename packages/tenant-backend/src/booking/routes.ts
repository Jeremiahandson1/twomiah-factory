// /api/booking — public widget endpoints (no auth) + the owner's admin endpoints. One route file for
// every CRM; the template passes its tables, calendar and options through createBookingRoutes().
import { Hono } from 'hono'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { BookingError } from './types'
import type { BookingDeps } from './types'
import { createBookingService } from './service'

const bookingSchema = z.object({
  serviceId: z.string().optional().transform(v => (v === '' ? undefined : v)),
  date: z.string(),
  time: z.string(),
  firstName: z.string().trim().min(1, 'First name is required'),
  lastName: z.string().trim().min(1, 'Last name is required'),
  email: z.string().trim().email(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  notes: z.string().max(2000).optional(),
})

/**
 * Bookings taken on the connected premium website (website-premium-* `/api/internal/bookings`), for the
 * CRM schedule. Auth-gated by the CRM's own JWT (mount behind `authenticate`); the server-to-server call
 * uses FACTORY_SYNC_KEY. Empty list when no site is connected.
 */
export function externalBookingsProxy() {
  return async (c: any) => {
    const websiteUrl = process.env.WEBSITE_PREMIUM_URL
    const syncKey = process.env.FACTORY_SYNC_KEY
    if (!websiteUrl || !syncKey) return c.json({ bookings: [] })
    const url = new URL(websiteUrl.replace(/\/$/, '') + '/api/internal/bookings')
    for (const k of ['from', 'to']) { const v = c.req.query(k); if (v) url.searchParams.set(k, v) }
    try {
      const r = await fetch(url.toString(), { headers: { 'X-Factory-Key': syncKey } })
      if (!r.ok) return c.json({ bookings: [], error: 'upstream ' + r.status }, 502)
      const data = (await r.json()) as any
      return c.json({ bookings: data.bookings || [] })
    } catch (e: any) {
      return c.json({ bookings: [], error: e?.message || 'fetch failed' }, 502)
    }
  }
}

export function createBookingRoutes(deps: BookingDeps) {
  const { db, tables: t, authenticate } = deps
  const svc = createBookingService(deps)
  const app = new Hono()

  // A bad public request (closed day, past date, taken slot, malformed time) is the caller's problem,
  // not a server error — bots and broken widgets used to 500 these endpoints.
  app.use('/public/*', async (c, next) => {
    try { await next() } catch (e: any) {
      if (e instanceof BookingError) return c.json({ error: e.message }, 400)
      throw e
    }
  })
  app.onError((e, c) => {
    if (e instanceof BookingError) return c.json({ error: e.message }, 400)
    throw e
  })

  const companyBySlug = async (slug: string) => {
    const [found] = await db.select({ id: t.company.id, name: t.company.name, logo: t.company.logo, primaryColor: t.company.primaryColor })
      .from(t.company).where(eq(t.company.slug, slug)).limit(1)
    return found || null
  }

  // ---------------------------------------------------------------- public (the widget)

  app.get('/public/:companySlug', async (c) => {
    const found = await companyBySlug(c.req.param('companySlug'))
    if (!found) return c.json({ error: 'Company not found' }, 404)
    const [settings, services] = await Promise.all([svc.getSettings(found.id), svc.publicServices(found.id)])
    if (!settings.enabled) return c.json({ error: 'Online booking is not enabled' }, 403)
    return c.json({
      company: { name: found.name, logo: found.logo || settings.logoUrl, primaryColor: found.primaryColor || settings.primaryColor },
      settings: { title: settings.title, description: settings.description, requirePhone: settings.requirePhone, requireAddress: settings.requireAddress, timezone: settings.timezone, slotDurationMinutes: settings.slotDurationMinutes },
      services,
    })
  })

  app.get('/public/:companySlug/dates', async (c) => {
    const found = await companyBySlug(c.req.param('companySlug'))
    if (!found) return c.json({ error: 'Company not found' }, 404)
    return c.json(await svc.getAvailableDates(found.id))
  })

  app.get('/public/:companySlug/slots', async (c) => {
    const date = c.req.query('date')
    if (!date) return c.json({ error: 'Date required' }, 400)
    const found = await companyBySlug(c.req.param('companySlug'))
    if (!found) return c.json({ error: 'Company not found' }, 404)
    return c.json(await svc.getAvailableSlots(found.id, date, c.req.query('serviceId') || undefined))
  })

  app.post('/public/:companySlug', async (c) => {
    const found = await companyBySlug(c.req.param('companySlug'))
    if (!found) return c.json({ error: 'Company not found' }, 404)
    const body = await c.req.json().catch(() => ({}))
    if (typeof body.email === 'string') body.email = body.email.toLowerCase().trim()
    const parsed = bookingSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400)
    const result = await svc.createBooking(found.id, parsed.data)
    return c.json({
      success: true,
      confirmationCode: result.confirmationCode,
      bookingId: result.bookingId,
      // When the service requires a deposit the booking is held as pending and the widget finishes payment with this.
      deposit: result.deposit,
      appointment: { date: parsed.data.date, time: parsed.data.time, service: result.serviceName, timezone: result.timezone },
    }, 201)
  })

  // Confirmation lookup — the customer has a code, not a login. Only what the customer already knows.
  app.get('/public/:companySlug/lookup/:code', async (c) => {
    const found = await companyBySlug(c.req.param('companySlug'))
    if (!found) return c.json({ error: 'Company not found' }, 404)
    const b = await svc.getBookingByCode(found.id, c.req.param('code'))
    if (!b) return c.json({ error: 'Booking not found' }, 404)
    return c.json({ status: b.status, scheduledDate: b.scheduledDate, serviceName: b.serviceName, service_name: b.serviceName, customerName: b.customerName, customer_name: b.customerName, customerEmail: b.customerEmail, customer_email: b.customerEmail, depositStatus: b.depositStatus, depositAmount: b.depositAmount, confirmationCode: b.confirmationCode })
  })

  // ---------------------------------------------------------------- admin (authenticated)

  app.use('*', authenticate)
  const companyId = (c: any) => (c.get('user') as any).companyId

  app.get('/settings', async (c) => c.json(await svc.getSettings(companyId(c))))
  app.put('/settings', async (c) => c.json(await svc.updateSettings(companyId(c), await c.req.json().catch(() => ({})))))

  app.get('/services', async (c) => {
    const cid = companyId(c)
    const [data, retired] = await Promise.all([svc.listServices(cid), svc.catalogRetired(cid)])
    return c.json({ data, retired })
  })
  app.post('/services', async (c) => c.json(await svc.createService(companyId(c), await c.req.json().catch(() => ({}))), 201))
  app.put('/services/:id', async (c) => {
    const row = await svc.updateService(c.req.param('id'), companyId(c), await c.req.json().catch(() => ({})))
    if (!row) return c.json({ error: 'Service not found' }, 404)
    return c.json(row)
  })
  app.delete('/services/:id', async (c) => {
    const removed = await svc.deleteService(c.req.param('id'), companyId(c))
    if (!removed) return c.json({ error: 'Service not found' }, 404)
    return c.json({ success: true })
  })

  app.get('/', async (c) => {
    const { status, page = '1', limit = '50', from, to } = c.req.query() as any
    return c.json(await svc.listBookings(companyId(c), { status: status || undefined, page: Math.max(1, parseInt(page) || 1), limit: Math.min(500, Math.max(1, parseInt(limit) || 50)), from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined }))
  })

  app.get('/embed-code', async (c) => {
    const [found] = await db.select({ slug: t.company.slug }).from(t.company).where(eq(t.company.id, companyId(c))).limit(1)
    return c.json({ embedCode: svc.embedCode(found?.slug || '') })
  })

  app.get('/:id', async (c) => {
    const b = await svc.getBooking(companyId(c), c.req.param('id'))
    if (!b) return c.json({ error: 'Booking not found' }, 404)
    return c.json(b)
  })

  // Change a booking's status (confirm / complete / no-show) — mirrored onto the job or appointment.
  // PATCH is the verb; PUT is accepted too because the templates' api client has no patch().
  const changeStatus = async (c: any) => {
    const body = await c.req.json().catch(() => ({} as any))
    if (!body.status) return c.json({ error: 'status is required' }, 400)
    const ok = await svc.setBookingStatus(companyId(c), c.req.param('id'), String(body.status))
    if (!ok) return c.json({ error: 'Booking not found' }, 404)
    return c.json(await svc.getBooking(companyId(c), c.req.param('id')))
  }
  app.patch('/:id', changeStatus)
  app.put('/:id', changeStatus)

  // Cancel a booking (and its job/appointment) so the slot opens up again.
  app.delete('/:id', async (c) => {
    const ok = await svc.cancelBooking(companyId(c), c.req.param('id'))
    if (!ok) return c.json({ error: 'Booking not found' }, 404)
    return c.json({ success: true })
  })

  return app
}
