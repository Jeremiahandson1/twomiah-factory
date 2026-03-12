import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { contact, job, smsMessage } from '../../db/schema.ts'
import { eq, and, desc, like, or, count } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

const contactSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  mobilePhone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  leadSource: z.string().optional(),
  propertyType: z.string().optional(),
  portalEnabled: z.boolean().optional(),
})

// List contacts with search and pagination
app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const search = c.req.query('search')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const conditions: any[] = [eq(contact.companyId, currentUser.companyId)]

  if (search) {
    const searchPattern = `%${search}%`
    conditions.push(
      or(
        like(contact.firstName, searchPattern),
        like(contact.lastName, searchPattern),
        like(contact.email, searchPattern),
        like(contact.phone, searchPattern),
      )!
    )
  }

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(contact).where(where).orderBy(desc(contact.createdAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(contact).where(where),
  ])

  return c.json({ data, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

// Create contact
app.post('/', async (c) => {
  const currentUser = c.get('user') as any
  const cBody = await c.req.json()
  if (typeof cBody.email === 'string') { cBody.email = cBody.email.toLowerCase().trim(); if (!cBody.email) delete cBody.email }
  const data = contactSchema.parse(cBody)

  const [newContact] = await db.insert(contact).values({
    ...data,
    companyId: currentUser.companyId,
  }).returning()

  return c.json(newContact, 201)
})

// Get contact detail with jobs and SMS thread
app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [foundContact] = await db.select().from(contact).where(and(eq(contact.id, id), eq(contact.companyId, currentUser.companyId))).limit(1)
  if (!foundContact) return c.json({ error: 'Contact not found' }, 404)

  const [contactJobs, smsThread] = await Promise.all([
    db.select().from(job).where(and(eq(job.contactId, id), eq(job.companyId, currentUser.companyId))).orderBy(desc(job.createdAt)),
    db.select().from(smsMessage).where(and(eq(smsMessage.contactId, id), eq(smsMessage.companyId, currentUser.companyId))).orderBy(desc(smsMessage.createdAt)).limit(50),
  ])

  return c.json({ ...foundContact, jobs: contactJobs, smsThread })
})

// Update contact
app.put('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const uBody = await c.req.json()
  if (typeof uBody.email === 'string') { uBody.email = uBody.email.toLowerCase().trim(); if (!uBody.email) delete uBody.email }
  const data = contactSchema.partial().parse(uBody)

  const [existing] = await db.select().from(contact).where(and(eq(contact.id, id), eq(contact.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Contact not found' }, 404)

  const [updated] = await db.update(contact).set({
    ...data,
    updatedAt: new Date(),
  }).where(eq(contact.id, id)).returning()

  return c.json(updated)
})

// Delete contact
app.delete('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(contact).where(and(eq(contact.id, id), eq(contact.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Contact not found' }, 404)

  await db.delete(contact).where(eq(contact.id, id))
  return c.body(null, 204)
})

export default app
