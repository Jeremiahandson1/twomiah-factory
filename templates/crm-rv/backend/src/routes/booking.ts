import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import booking from '../services/booking.ts'

const app = new Hono()

// ============================================
// PUBLIC ROUTES (no auth - for the widget)
// ============================================

app.get('/public/:companySlug', async (c) => {
  const companySlug = c.req.param('companySlug')
  const [found] = await db.select({
    id: company.id,
    name: company.name,
    logo: company.logo,
    primaryColor: company.primaryColor,
  }).from(company).where(eq(company.slug, companySlug)).limit(1)

  if (!found) return c.json({ error: 'Company not found' }, 404)

  const [settings, services] = await Promise.all([
    booking.getBookingSettings(found.id),
    booking.getBookableServices(found.id),
  ])

  if (!settings.enabled) return c.json({ error: 'Online booking is not enabled' }, 403)

  return c.json({
    company: {
      name: found.name,
      logo: found.logo || settings.logoUrl,
      primaryColor: found.primaryColor || settings.primaryColor,
    },
    settings: {
      title: settings.title,
      description: settings.description,
      requirePhone: settings.requirePhone,
      requireAddress: settings.requireAddress,
    },
    services,
  })
})

app.get('/public/:companySlug/dates', async (c) => {
  const companySlug = c.req.param('companySlug')
  const [found] = await db.select().from(company).where(eq(company.slug, companySlug)).limit(1)
  if (!found) return c.json({ error: 'Company not found' }, 404)

  const dates = await booking.getAvailableDates(found.id)
  return c.json(dates)
})

app.get('/public/:companySlug/slots', async (c) => {
  const companySlug = c.req.param('companySlug')
  const date = c.req.query('date')
  const serviceId = c.req.query('serviceId')

  if (!date) return c.json({ error: 'Date required' }, 400)

  const [found] = await db.select().from(company).where(eq(company.slug, companySlug)).limit(1)
  if (!found) return c.json({ error: 'Company not found' }, 404)

  const slots = await booking.getAvailableSlots(found.id, date, serviceId)
  return c.json(slots)
})

const bookingSchema = z.object({
  serviceId: z.string().optional(),
  date: z.string(),
  time: z.string(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  notes: z.string().optional(),
})

app.post('/public/:companySlug', async (c) => {
  const companySlug = c.req.param('companySlug')
  const body = await c.req.json()
  if (typeof body.email === 'string') { body.email = body.email.toLowerCase().trim(); if (!body.email) delete body.email }
  const data = bookingSchema.parse(body)

  const [found] = await db.select().from(company).where(eq(company.slug, companySlug)).limit(1)
  if (!found) return c.json({ error: 'Company not found' }, 404)

  const settings = await booking.getBookingSettings(found.id)

  if (settings.requirePhone && !data.phone) {
    return c.json({ error: 'Phone number is required' }, 400)
  }
  if (settings.requireAddress && !data.address) {
    return c.json({ error: 'Address is required' }, 400)
  }

  const result = await booking.createBooking(found.id, data)

  return c.json({
    success: true,
    confirmationCode: result.confirmationCode,
    appointment: {
      date: data.date,
      time: data.time,
      service: result.job.title,
    },
  }, 201)
})

// ============================================
// ADMIN ROUTES (authenticated)
// ============================================

app.use('*', authenticate)

app.get('/settings', async (c) => {
  const user = c.get('user') as any
  const settings = await booking.getBookingSettings(user.companyId)
  return c.json(settings)
})

app.put('/settings', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const settings = await booking.updateBookingSettings(user.companyId, body)
  return c.json(settings)
})

app.get('/services', async (c) => {
  const user = c.get('user') as any
  const services = await booking.getBookableServices(user.companyId)
  return c.json(services)
})

app.post('/services', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const service = await booking.createBookableService(user.companyId, body)
  return c.json(service, 201)
})

app.put('/services/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await booking.updateBookableService(id, user.companyId, body)
  return c.json({ success: true })
})

app.get('/', async (c) => {
  const user = c.get('user') as any
  const { status, page = '1', limit = '50' } = c.req.query() as any

  const data = await booking.getBookings(user.companyId, {
    status,
    page: parseInt(page),
    limit: parseInt(limit),
  })

  return c.json(data)
})

app.get('/embed-code', async (c) => {
  const user = c.get('user') as any
  const [found] = await db.select({ slug: company.slug }).from(company).where(eq(company.id, user.companyId)).limit(1)
  const embedCode = booking.getEmbedCode(user.companyId, found?.slug)
  return c.json({ embedCode })
})

export default app
