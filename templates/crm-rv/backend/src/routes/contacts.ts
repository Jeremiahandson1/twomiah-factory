import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { contact, project, quote, invoice } from '../../db/schema.ts'
import { eq, and, or, ilike, count, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

const contactSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['lead', 'client', 'subcontractor', 'vendor']).default('lead'),
  company: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  mobile: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  source: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
})

app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const type = c.req.query('type')
  const search = c.req.query('search')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')

  const conditions = [eq(contact.companyId, currentUser.companyId)]
  if (type) conditions.push(eq(contact.type, type))
  if (search) {
    conditions.push(or(
      ilike(contact.name, `%${search}%`),
      ilike(contact.email, `%${search}%`),
      ilike(contact.company, `%${search}%`),
    )!)
  }

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(contact).where(where).orderBy(desc(contact.createdAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(contact).where(where),
  ])

  return c.json({ data, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

app.get('/stats', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const contacts = await db.select({ type: contact.type }).from(contact).where(eq(contact.companyId, currentUser.companyId))
  const stats: Record<string, number> = { total: contacts.length, lead: 0, client: 0, subcontractor: 0, vendor: 0 }
  contacts.forEach(ct => stats[ct.type] = (stats[ct.type] || 0) + 1)
  return c.json(stats)
})

app.get('/:id', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [foundContact] = await db.select().from(contact).where(and(eq(contact.id, id), eq(contact.companyId, currentUser.companyId))).limit(1)
  if (!foundContact) return c.json({ error: 'Contact not found' }, 404)

  // Fetch related data separately
  const [projects, quotes, invoices] = await Promise.all([
    db.select({ id: project.id, name: project.name, status: project.status }).from(project).where(eq(project.contactId, id)),
    db.select({ id: quote.id, number: quote.number, total: quote.total, status: quote.status }).from(quote).where(eq(quote.contactId, id)),
    db.select({ id: invoice.id, number: invoice.number, total: invoice.total, amountPaid: invoice.amountPaid, status: invoice.status }).from(invoice).where(eq(invoice.contactId, id)),
  ])

  return c.json({ ...foundContact, projects, quotes, invoices })
})

app.post('/', requirePermission('contacts:create'), async (c) => {
  const currentUser = c.get('user') as any
  const cBody = await c.req.json()
  if (cBody.email && typeof cBody.email === 'string') cBody.email = cBody.email.toLowerCase().trim()
  const data = contactSchema.parse(cBody)
  const [newContact] = await db.insert(contact).values({ ...data, companyId: currentUser.companyId }).returning()
  emitToCompany(currentUser.companyId, EVENTS.CONTACT_CREATED, newContact)
  audit.log({ action: audit.ACTIONS.CREATE, entity: 'contact', entityId: newContact.id, entityName: newContact.name, req: c.req })
  return c.json(newContact, 201)
})

app.put('/:id', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const uBody = await c.req.json()
  if (uBody.email && typeof uBody.email === 'string') uBody.email = uBody.email.toLowerCase().trim()
  const data = contactSchema.partial().parse(uBody)

  const [existing] = await db.select().from(contact).where(and(eq(contact.id, id), eq(contact.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Contact not found' }, 404)

  const [updated] = await db.update(contact).set({ ...data, updatedAt: new Date() }).where(eq(contact.id, id)).returning()
  emitToCompany(currentUser.companyId, EVENTS.CONTACT_UPDATED, updated)
  const changes = audit.diff(existing, updated)
  if (changes) audit.log({ action: audit.ACTIONS.UPDATE, entity: 'contact', entityId: updated.id, entityName: updated.name, changes, req: c.req })
  return c.json(updated)
})

app.delete('/:id', requirePermission('contacts:delete'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(contact).where(and(eq(contact.id, id), eq(contact.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Contact not found' }, 404)

  await db.delete(contact).where(eq(contact.id, id))
  emitToCompany(currentUser.companyId, EVENTS.CONTACT_DELETED, { id })
  audit.log({ action: audit.ACTIONS.DELETE, entity: 'contact', entityId: existing.id, entityName: existing.name, req: c.req })
  return c.body(null, 204)
})

app.post('/:id/convert', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(contact).where(and(eq(contact.id, id), eq(contact.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Contact not found' }, 404)
  if (existing.type !== 'lead') return c.json({ error: 'Only leads can be converted' }, 400)

  const [updated] = await db.update(contact).set({ type: 'client', updatedAt: new Date() }).where(eq(contact.id, id)).returning()
  emitToCompany(currentUser.companyId, EVENTS.CONTACT_UPDATED, updated)
  audit.log({ action: audit.ACTIONS.STATUS_CHANGE, entity: 'contact', entityId: updated.id, entityName: updated.name, changes: { type: { old: 'lead', new: 'client' } }, req: c.req })
  return c.json(updated)
})

export default app
