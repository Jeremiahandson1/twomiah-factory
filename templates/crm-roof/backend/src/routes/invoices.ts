import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { invoice, contact, job } from '../../db/schema.ts'
import { eq, and, desc, count, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().default(1),
  unitPrice: z.number().default(0),
})

const invoiceSchema = z.object({
  jobId: z.string().min(1),
  contactId: z.string().min(1),
  lineItems: z.array(lineItemSchema).min(1),
  taxRate: z.number().default(0),
  notes: z.string().optional(),
  dueDate: z.string().optional(),
})

const calcTotals = (items: { quantity: number; unitPrice: number }[], taxRate: number) => {
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const taxAmount = subtotal * (taxRate / 100)
  return { subtotal, taxAmount, total: subtotal + taxAmount }
}

// List invoices
app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const jobId = c.req.query('jobId')
  const contactId = c.req.query('contactId')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const conditions: any[] = [eq(invoice.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(invoice.status, status))
  if (jobId) conditions.push(eq(invoice.jobId, jobId))
  if (contactId) conditions.push(eq(invoice.contactId, contactId))

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(invoice).where(where).orderBy(desc(invoice.createdAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(invoice).where(where),
  ])

  // Fetch contacts
  const contactIds = [...new Set(data.filter(i => i.contactId).map(i => i.contactId))]
  const contacts = contactIds.length
    ? await db.select({ id: contact.id, firstName: contact.firstName, lastName: contact.lastName }).from(contact).where(eq(contact.companyId, currentUser.companyId))
    : []
  const contactMap = Object.fromEntries(contacts.map(ct => [ct.id, ct]))

  // Fetch jobs for job number display
  const jobIds = [...new Set(data.filter(i => i.jobId).map(i => i.jobId))]
  const jobs = jobIds.length
    ? await db.select({ id: job.id, jobNumber: job.jobNumber }).from(job).where(eq(job.companyId, currentUser.companyId))
    : []
  const jobMap = Object.fromEntries(jobs.map(j => [j.id, j]))

  const dataWithRelations = data.map(inv => ({
    ...inv,
    contact: inv.contactId ? contactMap[inv.contactId] || null : null,
    job: inv.jobId ? jobMap[inv.jobId] || null : null,
  }))

  return c.json({ data: dataWithRelations, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

// Create invoice with auto invoiceNumber
app.post('/', async (c) => {
  const currentUser = c.get('user') as any
  const data = invoiceSchema.parse(await c.req.json())

  // Auto-generate invoiceNumber: INV-0001
  const [maxResult] = await db
    .select({ maxNum: sql<string>`MAX(${invoice.invoiceNumber})` })
    .from(invoice)
    .where(eq(invoice.companyId, currentUser.companyId))

  let nextNum = 1
  if (maxResult?.maxNum) {
    const match = maxResult.maxNum.match(/INV-(\d+)/)
    if (match) nextNum = parseInt(match[1], 10) + 1
  }
  const invoiceNumber = `INV-${String(nextNum).padStart(4, '0')}`

  const totals = calcTotals(data.lineItems, data.taxRate)

  const [newInvoice] = await db.insert(invoice).values({
    companyId: currentUser.companyId,
    jobId: data.jobId,
    contactId: data.contactId,
    invoiceNumber,
    lineItems: data.lineItems.map(item => ({
      ...item,
      total: item.quantity * item.unitPrice,
    })),
    subtotal: totals.subtotal.toString(),
    taxRate: (data.taxRate / 100).toString(),
    taxAmount: totals.taxAmount.toString(),
    total: totals.total.toString(),
    amountPaid: '0',
    balance: totals.total.toString(),
    notes: data.notes,
    dueDate: data.dueDate ? new Date(data.dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  }).returning()

  return c.json(newInvoice, 201)
})

// Get invoice detail
app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [found] = await db.select().from(invoice)
    .where(and(eq(invoice.id, id), eq(invoice.companyId, currentUser.companyId)))
    .limit(1)
  if (!found) return c.json({ error: 'Invoice not found' }, 404)

  const [invoiceContact] = found.contactId
    ? await db.select().from(contact).where(eq(contact.id, found.contactId)).limit(1)
    : [null]

  return c.json({ ...found, contact: invoiceContact || null })
})

// Update invoice
app.put('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = invoiceSchema.partial().parse(await c.req.json())

  const [existing] = await db.select().from(invoice)
    .where(and(eq(invoice.id, id), eq(invoice.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Invoice not found' }, 404)

  const updateData: Record<string, any> = { updatedAt: new Date() }
  if (data.contactId) updateData.contactId = data.contactId
  if (data.jobId) updateData.jobId = data.jobId
  if (data.notes !== undefined) updateData.notes = data.notes
  if (data.dueDate) updateData.dueDate = new Date(data.dueDate)

  if (data.lineItems) {
    const taxRate = data.taxRate ?? (Number(existing.taxRate) * 100)
    const totals = calcTotals(data.lineItems, taxRate)
    updateData.lineItems = data.lineItems.map(item => ({ ...item, total: item.quantity * item.unitPrice }))
    updateData.subtotal = totals.subtotal.toString()
    updateData.taxRate = (taxRate / 100).toString()
    updateData.taxAmount = totals.taxAmount.toString()
    updateData.total = totals.total.toString()
    updateData.balance = (totals.total - Number(existing.amountPaid)).toString()
  }

  const [updated] = await db.update(invoice).set(updateData).where(eq(invoice.id, id)).returning()
  return c.json(updated)
})

// Send invoice
app.post('/:id/send', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(invoice)
    .where(and(eq(invoice.id, id), eq(invoice.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Invoice not found' }, 404)

  const [updated] = await db.update(invoice).set({ status: 'sent', updatedAt: new Date() }).where(eq(invoice.id, id)).returning()
  return c.json(updated)
})

// Mark invoice as paid
app.post('/:id/mark-paid', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(invoice)
    .where(and(eq(invoice.id, id), eq(invoice.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Invoice not found' }, 404)

  const [updated] = await db.update(invoice).set({
    status: 'paid',
    paidAt: new Date(),
    amountPaid: existing.total,
    balance: '0',
    updatedAt: new Date(),
  }).where(eq(invoice.id, id)).returning()

  return c.json(updated)
})

// Record partial payment
app.post('/:id/payment', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const paymentSchema = z.object({ amount: z.number().positive() })
  const data = paymentSchema.parse(await c.req.json())

  const [existing] = await db.select().from(invoice)
    .where(and(eq(invoice.id, id), eq(invoice.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Invoice not found' }, 404)

  const newAmountPaid = Number(existing.amountPaid) + data.amount
  const newBalance = Number(existing.total) - newAmountPaid
  const isPaidInFull = newBalance <= 0

  const [updated] = await db.update(invoice).set({
    amountPaid: newAmountPaid.toString(),
    balance: Math.max(0, newBalance).toString(),
    status: isPaidInFull ? 'paid' : 'partial',
    paidAt: isPaidInFull ? new Date() : undefined,
    updatedAt: new Date(),
  }).where(eq(invoice.id, id)).returning()

  return c.json(updated)
})

export default app
