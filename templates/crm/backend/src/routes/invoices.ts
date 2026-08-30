import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { invoice, invoiceLineItem, contact, project, quote, payment, company } from '../../db/schema.ts'
import { eq, and, count, desc, asc, lt, inArray } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import emailService from '../services/email.ts'

const app = new Hono()
app.use('*', authenticate)

// "Overdue" is derived, not stored — an invoice that's been billed but not
// fully paid and is past its due date. Computing it at read time means it's
// always current without a background job flipping statuses.
const OPEN_STATUSES = ['sent', 'viewed', 'partial']
const isOverdue = (inv: { status: string; dueDate: Date | string | null; total: any; amountPaid: any }) => {
  if (!OPEN_STATUSES.includes(inv.status) || !inv.dueDate) return false
  if (Number(inv.total) - Number(inv.amountPaid) <= 0.005) return false
  return new Date(inv.dueDate) < new Date()
}
const deriveStatus = (inv: any) => (isOverdue(inv) ? 'overdue' : inv.status)

const lineItemSchema = z.object({ description: z.string().min(1), quantity: z.number().min(0, 'Quantity cannot be negative').default(1), unitPrice: z.number().min(0, 'Price cannot be negative').default(0) })
const invoiceSchema = z.object({
  contactId: z.string().optional().transform(v => v === '' ? undefined : v),
  projectId: z.string().optional().transform(v => v === '' ? undefined : v),
  dueDate: z.string().optional(),
  taxRate: z.number().min(0).max(100).default(0),
  discount: z.number().min(0, 'Discount cannot be negative').default(0),
  notes: z.string().optional(),
  terms: z.string().optional(),
  lineItems: z.array(lineItemSchema).default([]),
})

// Round to whole cents to avoid $330.949-style totals, and tax the
// post-discount amount (the common US convention for an order-level discount).
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const calcTotals = (items: { quantity: number; unitPrice: number }[], taxRate: number, discount: number) => {
  const subtotal = round2(items.reduce((s, i) => s + Math.max(0, i.quantity) * Math.max(0, i.unitPrice), 0))
  // A discount can never exceed the subtotal (that produced negative totals).
  const effectiveDiscount = Math.min(Math.max(0, discount), subtotal)
  const taxable = Math.max(0, subtotal - effectiveDiscount)
  const taxAmount = round2(taxable * (Math.max(0, taxRate) / 100))
  const total = round2(subtotal - effectiveDiscount + taxAmount)
  return { subtotal, taxAmount, total, balance: total }
}

app.get('/', requirePermission('invoices:read'), async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const contactId = c.req.query('contactId')
  const page = +(c.req.query('page') || '1')
  const limit = Math.min(+(c.req.query('limit') || '50'), 100)

  const conditions = [eq(invoice.companyId, currentUser.companyId)]
  // 'overdue' isn't a stored status — translate the filter to "open + past due".
  if (status === 'overdue') {
    conditions.push(inArray(invoice.status, OPEN_STATUSES))
    conditions.push(lt(invoice.dueDate, new Date()))
  } else if (status) {
    conditions.push(eq(invoice.status, status))
  }
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
    status: deriveStatus(inv),
    contact: inv.contactId ? contactMap[inv.contactId] || null : null,
    lineItems: lineItemMap[inv.id] || [],
    payments: paymentMap[inv.id] || [],
  }))

  return c.json({ data: dataWithRelations, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

app.get('/stats', requirePermission('invoices:read'), async (c) => {
  const currentUser = c.get('user') as any
  const invoices = await db.select({ status: invoice.status, total: invoice.total, amountPaid: invoice.amountPaid, dueDate: invoice.dueDate }).from(invoice).where(eq(invoice.companyId, currentUser.companyId))
  const stats: Record<string, number> = { total: invoices.length, draft: 0, sent: 0, paid: 0, overdue: 0, totalAmount: 0, paidAmount: 0, outstanding: 0 }
  invoices.forEach(inv => {
    const s = deriveStatus(inv)
    stats[s] = (stats[s] || 0) + 1
    stats.totalAmount += Number(inv.total)
    // Outstanding = what customers still owe on BILLED invoices. A draft isn't
    // billed, and a credit (over-payment) on one invoice must not net off
    // another, so floor each invoice's balance at zero.
    if (inv.status !== 'draft' && inv.status !== 'paid') {
      stats.outstanding += Math.max(0, Number(inv.total) - Number(inv.amountPaid))
    }
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

  return c.json({ ...foundInvoice, status: deriveStatus(foundInvoice), contact: invoiceContact[0] || null, project: invoiceProject[0] || null, quote: invoiceQuote[0] || null, lineItems, payments })
})

app.post('/', requirePermission('invoices:create'), async (c) => {
  const currentUser = c.get('user') as any
  const data = invoiceSchema.parse(await c.req.json())
  const { lineItems, ...invoiceData } = data
  const totals = calcTotals(lineItems, data.taxRate, data.discount)

  // Number from the highest existing invoice number, not the row count — deleting an
  // invoice dropped the count so count()+1 collided with a still-existing number. (VET-03)
  const existingNumbers = await db.select({ number: invoice.number }).from(invoice).where(eq(invoice.companyId, currentUser.companyId))
  const maxSeq = existingNumbers.reduce((max, r) => {
    const m = String(r.number || '').match(/(\d+)\s*$/)
    return m ? Math.max(max, parseInt(m[1], 10)) : max
  }, 0)

  const [newInvoice] = await db.insert(invoice).values({
    ...invoiceData,
    subtotal: totals.subtotal.toString(),
    taxAmount: totals.taxAmount.toString(),
    total: totals.total.toString(),
    amountPaid: '0',
    taxRate: invoiceData.taxRate.toString(),
    discount: invoiceData.discount.toString(),
    number: `INV-${String(maxSeq + 1).padStart(5, '0')}`,
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
    // Never let an edit drop the total below what has already been collected. (CC-02)
    const paid = Number(existing.amountPaid)
    if (calc.total < paid - 0.005) {
      return c.json({ error: `This invoice already has $${paid.toFixed(2)} in payments; the total can't be lowered below that. Refund or void instead.` }, 400)
    }
    const newStatus = paid >= calc.total - 0.005 ? 'paid' : paid > 0 ? 'partial' : existing.status
    totals = { subtotal: calc.subtotal.toString(), taxAmount: calc.taxAmount.toString(), total: calc.total.toString(), amountPaid: existing.amountPaid, status: newStatus }
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

  // Never delete an invoice that has taken money — it destroys the financial record. (VET-04/CC-02)
  if (Number(existing.amountPaid) > 0 || existing.status === 'paid') {
    return c.json({ error: 'Cannot delete an invoice with payments recorded. Void it instead.' }, 400)
  }

  await db.delete(invoice).where(eq(invoice.id, id))
  return c.body(null, 204)
})

app.post('/:id/send', requirePermission('invoices:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [found] = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.companyId, currentUser.companyId))).limit(1)
  if (!found) return c.json({ error: 'Invoice not found' }, 404)

  // Delivery truth (SEND-01): this used to flip the invoice to "sent" without ever
  // emailing anyone — an invoice to a missing/undeliverable address still showed
  // "Sent". Require a real recipient, actually send, and only record sent on success.
  let recipientEmail: string | null = null
  let contactName = 'there'
  if (found.contactId) {
    const [ct] = await db.select().from(contact).where(eq(contact.id, found.contactId)).limit(1)
    if (ct) { recipientEmail = ct.email || null; contactName = ct.name || contactName }
  }
  if (!recipientEmail) {
    return c.json({ error: 'This invoice has no contact email address to send to. Add an email to the contact first.' }, 400)
  }

  const [co] = await db.select().from(company).where(eq(company.id, currentUser.companyId)).limit(1)
  const balance = Number(found.total) - Number(found.amountPaid || 0)
  try {
    await emailService.sendInvoice(recipientEmail, {
      invoiceNumber: found.number,
      companyName: co?.name || 'Your provider',
      companyEmail: co?.email || '',
      contactName,
      total: found.total,
      balance,
      dueDate: found.dueDate ? new Date(found.dueDate as any).toLocaleDateString() : 'Upon receipt',
    })
  } catch (err: any) {
    return c.json({ error: `Could not send the invoice email: ${err?.message || 'delivery failed'}. It was not marked as sent.` }, 502)
  }

  const [updated] = await db.update(invoice).set({ status: 'sent', sentAt: new Date(), updatedAt: new Date() }).where(and(eq(invoice.id, id), eq(invoice.companyId, currentUser.companyId))).returning()
  emitToCompany(currentUser.companyId, EVENTS.INVOICE_SENT, { id: updated.id, number: updated.number })
  return c.json(updated)
})

app.post('/:id/payments', requirePermission('invoices:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const paymentSchema = z.object({ amount: z.number().positive(), method: z.enum(['card', 'cash', 'check', 'bank_transfer', 'stripe', 'other']), reference: z.string().optional(), notes: z.string().optional() })
  const data = paymentSchema.parse(await c.req.json())

  const [foundInvoice] = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.companyId, currentUser.companyId))).limit(1)
  if (!foundInvoice) return c.json({ error: 'Invoice not found' }, 404)

  // Reject overpayment: recording more than the balance due poisons
  // amountPaid and every report built on it (collection rate, revenue).
  // Work in whole cents so 89.999 can't bank  .00 and status can't desync. (R2-04)
  const round2 = (n: number) => Math.round(n * 100) / 100
  const amount = round2(data.amount)
  if (amount <= 0) return c.json({ error: 'Payment amount must be at least /usr/bin/bash.01' }, 400)
  const balanceDue = round2(Number(foundInvoice.total) - Number(foundInvoice.amountPaid))
  if (amount > balanceDue + 0.005) {
    return c.json({ error: `Payment exceeds the balance due — $${balanceDue.toFixed(2)} remaining` }, 400)
  }

  const [newPayment] = await db.insert(payment).values({ ...data, amount: amount.toString(), invoiceId: id }).returning()

  const newAmountPaid = round2(Number(foundInvoice.amountPaid) + amount)
  const newBalance = round2(Number(foundInvoice.total) - newAmountPaid)
  const newStatus = newBalance <= 0.005 ? 'paid' : newAmountPaid > 0 ? 'partial' : foundInvoice.status

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
