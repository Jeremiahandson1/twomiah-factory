import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { invoice, invoiceLineItem, contact, project, quote, payment, company } from '../../db/schema.ts'
import { eq, and, count, desc, asc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'

const app = new Hono()
app.use('*', authenticate)

const lineItemSchema = z.object({ description: z.string().min(1), quantity: z.number().default(1), unitPrice: z.number().default(0) })
const invoiceSchema = z.object({
  contactId: z.string().optional().transform(v => v === '' ? undefined : v),
  projectId: z.string().optional().transform(v => v === '' ? undefined : v),
  dueDate: z.string().optional(),
  taxRate: z.number().default(0),
  discount: z.number().default(0),
  notes: z.string().optional(),
  terms: z.string().optional(),
  lineItems: z.array(lineItemSchema).default([]),
})

const calcTotals = (items: { quantity: number; unitPrice: number }[], taxRate: number, discount: number) => {
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const taxAmount = subtotal * (taxRate / 100)
  const total = subtotal + taxAmount - discount
  return { subtotal, taxAmount, total, balance: total }
}

app.get('/', requirePermission('invoices:read'), async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const contactId = c.req.query('contactId')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const conditions = [eq(invoice.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(invoice.status, status))
  if (contactId) conditions.push(eq(invoice.contactId, contactId))

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(invoice).where(where).orderBy(desc(invoice.createdAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(invoice).where(where),
  ])

  // Fetch contacts, line items, and payments
  const invoiceIds = data.map(inv => inv.id)
  const contactIds = [...new Set(data.filter(inv => inv.contactId).map(inv => inv.contactId!))]

  const [contacts, lineItems, payments] = await Promise.all([
    contactIds.length ? db.select({ id: contact.id, name: contact.name }).from(contact).where(eq(contact.companyId, currentUser.companyId)) : Promise.resolve([]),
    (async () => {
      const allItems: (typeof invoiceLineItem.$inferSelect)[] = []
      for (const iid of invoiceIds) {
        const items = await db.select().from(invoiceLineItem).where(eq(invoiceLineItem.invoiceId, iid))
        allItems.push(...items)
      }
      return allItems
    })(),
    (async () => {
      const allPayments: (typeof payment.$inferSelect)[] = []
      for (const iid of invoiceIds) {
        const pays = await db.select().from(payment).where(eq(payment.invoiceId, iid))
        allPayments.push(...pays)
      }
      return allPayments
    })(),
  ])

  const contactMap = Object.fromEntries(contacts.map(ct => [ct.id, ct]))
  const lineItemMap: Record<string, (typeof invoiceLineItem.$inferSelect)[]> = {}
  lineItems.forEach(li => { (lineItemMap[li.invoiceId] ||= []).push(li) })
  const paymentMap: Record<string, (typeof payment.$inferSelect)[]> = {}
  payments.forEach(p => { (paymentMap[p.invoiceId] ||= []).push(p) })

  const dataWithRelations = data.map(inv => ({
    ...inv,
    contact: inv.contactId ? contactMap[inv.contactId] || null : null,
    lineItems: lineItemMap[inv.id] || [],
    payments: paymentMap[inv.id] || [],
  }))

  return c.json({ data: dataWithRelations, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

app.get('/stats', requirePermission('invoices:read'), async (c) => {
  const currentUser = c.get('user') as any
  const invoices = await db.select({ status: invoice.status, total: invoice.total, amountPaid: invoice.amountPaid }).from(invoice).where(eq(invoice.companyId, currentUser.companyId))
  const stats: Record<string, number> = { total: invoices.length, draft: 0, sent: 0, paid: 0, overdue: 0, totalAmount: 0, paidAmount: 0, outstanding: 0 }
  invoices.forEach(inv => {
    stats[inv.status] = (stats[inv.status] || 0) + 1
    stats.totalAmount += Number(inv.total)
    stats.outstanding += Number(inv.total) - Number(inv.amountPaid)
    if (inv.status === 'paid') stats.paidAmount += Number(inv.total)
  })
  return c.json(stats)
})

app.get('/:id', requirePermission('invoices:read'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [foundInvoice] = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.companyId, currentUser.companyId))).limit(1)
  if (!foundInvoice) return c.json({ error: 'Invoice not found' }, 404)

  const [invoiceContact, invoiceProject, invoiceQuote, lineItems, payments] = await Promise.all([
    foundInvoice.contactId ? db.select().from(contact).where(eq(contact.id, foundInvoice.contactId)).limit(1) : Promise.resolve([]),
    foundInvoice.projectId ? db.select().from(project).where(eq(project.id, foundInvoice.projectId)).limit(1) : Promise.resolve([]),
    foundInvoice.quoteId ? db.select().from(quote).where(eq(quote.id, foundInvoice.quoteId)).limit(1) : Promise.resolve([]),
    db.select().from(invoiceLineItem).where(eq(invoiceLineItem.invoiceId, id)).orderBy(asc(invoiceLineItem.sortOrder)),
    db.select().from(payment).where(eq(payment.invoiceId, id)).orderBy(desc(payment.paidAt)),
  ])

  return c.json({ ...foundInvoice, contact: invoiceContact[0] || null, project: invoiceProject[0] || null, quote: invoiceQuote[0] || null, lineItems, payments })
})

app.post('/', requirePermission('invoices:create'), async (c) => {
  const currentUser = c.get('user') as any
  const data = invoiceSchema.parse(await c.req.json())
  const { lineItems, ...invoiceData } = data
  const totals = calcTotals(lineItems, data.taxRate, data.discount)

  const [{ value: cnt }] = await db.select({ value: count() }).from(invoice).where(eq(invoice.companyId, currentUser.companyId))

  const [newInvoice] = await db.insert(invoice).values({
    ...invoiceData,
    subtotal: totals.subtotal.toString(),
    taxAmount: totals.taxAmount.toString(),
    total: totals.total.toString(),
    amountPaid: '0',
    taxRate: invoiceData.taxRate.toString(),
    discount: invoiceData.discount.toString(),
    number: `INV-${String(Number(cnt) + 1).padStart(5, '0')}`,
    dueDate: data.dueDate ? new Date(data.dueDate) : null,
    companyId: currentUser.companyId,
  }).returning()

  const insertedLineItems = lineItems.length > 0
    ? await db.insert(invoiceLineItem).values(lineItems.map((item, i) => ({
        ...item,
        quantity: item.quantity.toString(),
        unitPrice: item.unitPrice.toString(),
        total: (item.quantity * item.unitPrice).toString(),
        sortOrder: i,
        invoiceId: newInvoice.id,
      }))).returning()
    : []

  const result = { ...newInvoice, lineItems: insertedLineItems }
  emitToCompany(currentUser.companyId, EVENTS.INVOICE_CREATED, result)
  return c.json(result, 201)
})

app.put('/:id', requirePermission('invoices:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = invoiceSchema.partial().parse(await c.req.json())

  const [existing] = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Invoice not found' }, 404)

  const { lineItems, ...invoiceData } = data
  let totals: Record<string, string> = {}
  if (lineItems) {
    await db.delete(invoiceLineItem).where(eq(invoiceLineItem.invoiceId, id))
    const calc = calcTotals(lineItems, data.taxRate ?? Number(existing.taxRate), data.discount ?? Number(existing.discount))
    const balance = calc.total - Number(existing.amountPaid)
    totals = { subtotal: calc.subtotal.toString(), taxAmount: calc.taxAmount.toString(), total: calc.total.toString(), amountPaid: existing.amountPaid }
  }

  const updateData: Record<string, any> = { ...invoiceData, ...totals, updatedAt: new Date() }
  if (invoiceData.taxRate !== undefined) updateData.taxRate = invoiceData.taxRate.toString()
  if (invoiceData.discount !== undefined) updateData.discount = invoiceData.discount.toString()
  if (data.dueDate) updateData.dueDate = new Date(data.dueDate)

  const [updated] = await db.update(invoice).set(updateData).where(eq(invoice.id, id)).returning()

  let insertedLineItems: (typeof invoiceLineItem.$inferSelect)[] = []
  if (lineItems && lineItems.length > 0) {
    insertedLineItems = await db.insert(invoiceLineItem).values(lineItems.map((item, i) => ({
      ...item,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
      total: (item.quantity * item.unitPrice).toString(),
      sortOrder: i,
      invoiceId: id,
    }))).returning()
  }

  const result = { ...updated, lineItems: insertedLineItems.length > 0 ? insertedLineItems : await db.select().from(invoiceLineItem).where(eq(invoiceLineItem.invoiceId, id)) }
  emitToCompany(currentUser.companyId, EVENTS.INVOICE_UPDATED, result)
  return c.json(result)
})

app.delete('/:id', requirePermission('invoices:delete'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Invoice not found' }, 404)

  await db.delete(invoice).where(eq(invoice.id, id))
  return c.body(null, 204)
})

app.post('/:id/send', requirePermission('invoices:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [updated] = await db.update(invoice).set({ status: 'sent', sentAt: new Date(), updatedAt: new Date() }).where(eq(invoice.id, id)).returning()
  emitToCompany(currentUser.companyId, EVENTS.INVOICE_SENT, { id: updated.id, number: updated.number })
  return c.json(updated)
})

app.post('/:id/payments', requirePermission('invoices:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const paymentSchema = z.object({ amount: z.number().positive(), method: z.string(), reference: z.string().optional(), notes: z.string().optional() })
  const data = paymentSchema.parse(await c.req.json())

  const [foundInvoice] = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.companyId, currentUser.companyId))).limit(1)
  if (!foundInvoice) return c.json({ error: 'Invoice not found' }, 404)

  const [newPayment] = await db.insert(payment).values({ ...data, amount: data.amount.toString(), invoiceId: id }).returning()

  const newAmountPaid = Number(foundInvoice.amountPaid) + data.amount
  const newBalance = Number(foundInvoice.total) - newAmountPaid
  const newStatus = newBalance <= 0 ? 'paid' : newAmountPaid > 0 ? 'partial' : foundInvoice.status

  await db.update(invoice).set({
    amountPaid: newAmountPaid.toString(),
    total: foundInvoice.total,
    status: newStatus,
    paidAt: newBalance <= 0 ? new Date() : null,
    updatedAt: new Date(),
  }).where(eq(invoice.id, id))

  emitToCompany(currentUser.companyId, EVENTS.PAYMENT_RECEIVED, { invoiceId: foundInvoice.id, invoiceNumber: foundInvoice.number, amount: data.amount, newBalance, status: newStatus })
  if (newStatus === 'paid') {
    emitToCompany(currentUser.companyId, EVENTS.INVOICE_PAID, { id: foundInvoice.id, number: foundInvoice.number, total: foundInvoice.total })
  }

  return c.json(newPayment, 201)
})

// PDF download
app.get('/:id/pdf', requirePermission('invoices:read'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const { generateInvoicePDF } = await import('../services/pdf.ts')
  const [foundInvoice] = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.companyId, currentUser.companyId))).limit(1)
  if (!foundInvoice) return c.json({ error: 'Invoice not found' }, 404)

  const [invoiceContact, lineItems, payments, [foundCompany]] = await Promise.all([
    foundInvoice.contactId ? db.select().from(contact).where(eq(contact.id, foundInvoice.contactId)).limit(1) : Promise.resolve([]),
    db.select().from(invoiceLineItem).where(eq(invoiceLineItem.invoiceId, id)).orderBy(asc(invoiceLineItem.sortOrder)),
    db.select().from(payment).where(eq(payment.invoiceId, id)).orderBy(desc(payment.paidAt)),
    db.select().from(company).where(eq(company.id, currentUser.companyId)),
  ])

  const invoiceWithRelations = { ...foundInvoice, contact: invoiceContact[0] || null, lineItems, payments }
  const pdfBuffer = await generateInvoicePDF(invoiceWithRelations, foundCompany)

  return new Response(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${foundInvoice.number}.pdf"`,
    },
  })
})

export default app
