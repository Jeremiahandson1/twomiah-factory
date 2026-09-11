import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { invoice, invoiceLineItem, contact, project, quote, payment, company } from '../../db/schema.ts'
import { eq, and, count, desc, asc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import emailService from '../services/email.ts'

const app = new Hono()
app.use('*', authenticate)

// "Overdue" is derived, not stored — billed, not fully paid, past due. Computed at read time so the
// list, stats and Reports agree without a background job flipping statuses.
const OPEN_STATUSES = ['sent', 'open', 'viewed', 'partial']
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
  taxRate: z.number().min(0).max(100).optional(),
  discount: z.number().min(0, 'Discount cannot be negative').default(0),
  notes: z.string().optional(),
  terms: z.string().optional(),
  lineItems: z.array(lineItemSchema).default([]),
})


// Company default sales-tax rate (Settings → Company → "Default sales tax rate"). Quotes and
// invoices used to default to 0% with no tax line at all (Wrench QA W-8); an explicit taxRate on
// the request still wins.
async function defaultTaxRate(companyId: string): Promise<number> {
  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
  const r = Number((co?.settings as any)?.defaultTaxRate)
  return Number.isFinite(r) && r >= 0 && r <= 100 ? r : 0
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
// Tax the post-discount amount (US convention), clamp discount to the subtotal so
// it can't go negative, and round to whole cents — matching the base CRM.
const calcTotals = (items: { quantity: number; unitPrice: number }[], taxRate: number, discount: number = 0) => {
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
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
    status: deriveStatus(inv),
    contact: inv.contactId ? contactMap[inv.contactId] || null : null,
    lineItems: lineItemMap[inv.id] || [],
    payments: paymentMap[inv.id] || [],
  }))

  return c.json({ data: dataWithRelations, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

app.get('/stats', requirePermission('invoices:read'), async (c) => {
  const currentUser = c.get('user') as any
  const invoices = await db.select({ status: invoice.status, total: invoice.total, amountPaid: invoice.amountPaid, amountRefunded: invoice.amountRefunded, dueDate: invoice.dueDate }).from(invoice).where(eq(invoice.companyId, currentUser.companyId))
  const stats: Record<string, number> = { total: invoices.length, draft: 0, sent: 0, paid: 0, overdue: 0, totalAmount: 0, paidAmount: 0, outstanding: 0 }
  invoices.forEach(inv => {
    const s = deriveStatus(inv)
    stats[s] = (stats[s] || 0) + 1
    // Drafts aren't sent; exclude from invoiced + outstanding so collection rate stays meaningful. (VET-19)
    if (inv.status !== 'draft' && inv.status !== 'void' && inv.status !== 'refunded') {
      stats.totalAmount += Number(inv.total)
      stats.outstanding += Number(inv.total) - Number(inv.amountPaid)
    }
    // Money actually collected (net of refunds) — the same base Reports uses, so the two screens agree. (SALON-N8)
    if (inv.status !== 'void') stats.paidAmount += Number(inv.amountPaid || 0) - Number(inv.amountRefunded || 0)
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
  const [client] = await db.select({ id: contact.id }).from(contact).where(and(eq(contact.id, data.contactId), eq(contact.companyId, currentUser.companyId))).limit(1)
  if (!client) return c.json({ error: 'That client does not exist.' }, 404)
  const subtotalRaw = lineItems.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
  if (data.discount > subtotalRaw + 0.005) return c.json({ error: `Discount cannot exceed the subtotal (${subtotalRaw.toFixed(2)}).` }, 400)
  const taxRate = data.taxRate ?? await defaultTaxRate(currentUser.companyId)
  const totals = calcTotals(lineItems, taxRate, data.discount)

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
    taxRate: String(taxRate),
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
  if (existing.status === 'void') return c.json({ error: 'This invoice is void and can no longer be edited.' }, 400)

  const { lineItems, ...invoiceData } = data
  let totals: Record<string, string> = {}
  if (lineItems) {
    const calc = calcTotals(lineItems, data.taxRate ?? Number(existing.taxRate), data.discount ?? Number(existing.discount))
    // Never let an edit drop the total below what has already been collected. (CC-02)
    const paid = Number(existing.amountPaid)
    if (calc.total < paid - 0.005) {
      return c.json({ error: `This invoice already has $${paid.toFixed(2)} in payments; the total can't be lowered below that. Refund or void instead.` }, 400)
    }
    // Only now is it safe to replace the lines — a rejected edit used to leave a paid invoice with no line items. (SALON-C2)
    await db.delete(invoiceLineItem).where(eq(invoiceLineItem.invoiceId, id))
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
  if (found.status === 'void') return c.json({ error: 'This invoice is void and cannot be sent.' }, 400)

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

  const [updated] = await db.update(invoice).set({ status: 'sent', sentAt: new Date(), updatedAt: new Date() }).where(eq(invoice.id, id)).returning()
  emitToCompany(currentUser.companyId, EVENTS.INVOICE_SENT, { id: updated.id, number: updated.number })
  return c.json(updated)
})

app.post('/:id/payments', requirePermission('invoices:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const paymentSchema = z.object({ amount: z.number().positive(), method: z.enum(['card', 'cash', 'check', 'bank_transfer', 'stripe', 'other']), reference: z.string().optional(), notes: z.string().optional() })
  const data = paymentSchema.parse(await c.req.json())

  // Work in whole cents so fractional inputs cannot desync amountPaid from status. (R2-04)
  const round2 = (n: number) => Math.round(n * 100) / 100
  const amount = round2(data.amount)
  if (amount <= 0) return c.json({ error: 'Payment amount must be at least $0.01' }, 400)

  // The balance check and the update run in ONE transaction with the invoice row locked, so two
  // payments (or a payment and a refund) sent at the same moment cannot both pass the check — the
  // second waits for the lock and then sees the updated balance. (SALON-N1)
  let outcome: { status: number; body: any; row?: any; newBalance?: number; newStatus?: string } = { status: 500, body: { error: 'Payment failed' } }
  await db.transaction(async (tx) => {
    const locked: any = await tx.execute(sql`SELECT * FROM invoice WHERE id = ${id} AND company_id = ${currentUser.companyId} FOR UPDATE`)
    const row = (locked.rows || locked)[0]
    if (!row) { outcome = { status: 404, body: { error: 'Invoice not found' } }; return }
    if (row.status === 'void') { outcome = { status: 400, body: { error: 'This invoice is void and cannot take payments.' } }; return }
    if (row.status === 'refunded') { outcome = { status: 400, body: { error: 'This sale was refunded. Start a new invoice to charge the client again.' } }; return }
    // A draft can take a payment (a walk-in pays at the desk before anything is emailed); the payment
    // issues it. Only void is final.
    const balanceDue = round2(Number(row.total) - Number(row.amount_paid))
    if (amount > balanceDue + 0.005) { outcome = { status: 400, body: { error: `Payment exceeds the balance due — $${balanceDue.toFixed(2)} remaining` } }; return }

    const [newPayment] = await tx.insert(payment).values({ ...data, amount: amount.toString(), invoiceId: id } as any).returning()
    const newAmountPaid = round2(Number(row.amount_paid) + amount)
    const newBalance = round2(Number(row.total) - newAmountPaid)
    const newStatus = newBalance <= 0.005 ? 'paid' : newAmountPaid > 0 ? 'partial' : row.status
    await tx.update(invoice).set({
      amountPaid: newAmountPaid.toString(),
      status: newStatus,
      paidAt: newBalance <= 0.005 ? new Date() : null,
      updatedAt: new Date(),
    }).where(eq(invoice.id, id))
    outcome = { status: 201, body: newPayment, row, newBalance, newStatus }
  })
  if (outcome.status !== 201) return c.json(outcome.body, outcome.status as any)

  emitToCompany(currentUser.companyId, EVENTS.PAYMENT_RECEIVED, { invoiceId: id, invoiceNumber: outcome.row.number, amount, newBalance: outcome.newBalance, status: outcome.newStatus })
  if (outcome.newStatus === 'paid') {
    emitToCompany(currentUser.companyId, EVENTS.INVOICE_PAID, { id, number: outcome.row.number, total: outcome.row.total })
  }
  return c.json(outcome.body, 201)
})

// POST /:id/void — an issued invoice is never deleted: voiding keeps the number and the audit trail
// and takes it out of outstanding balances. Money already taken must be refunded first. (SALON-H8)
app.post('/:id/void', requirePermission('invoices:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)
  const [existing] = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Invoice not found' }, 404)
  if (existing.status === 'void') return c.json({ error: 'This invoice is already void.' }, 400)
  const paid = Number(existing.amountPaid) - Number((existing as any).amountRefunded || 0)
  if (paid > 0.005) return c.json({ error: `This invoice has ${paid.toFixed(2)} in payments that were not refunded. Refund them first, then void.` }, 400)
  const note = body.reason ? `Voided: ${String(body.reason).slice(0, 500)}` : 'Voided'
  const [updated] = await db.update(invoice)
    .set({ status: 'void', notes: existing.notes ? `${existing.notes}\n${note}` : note, updatedAt: new Date() })
    .where(eq(invoice.id, id)).returning()
  emitToCompany(currentUser.companyId, EVENTS.INVOICE_UPDATED, updated)
  return c.json(updated)
})

// POST /:id/refund — records a NEGATIVE payment and raises amountRefunded; amountPaid stays gross, so the ledger, status and balance stay
// truthful (a refund is a real ledger event, not an edit). Card refunds through Stripe are issued in
// the processor; this records the outcome on the invoice. (SALON-H8)
app.post('/:id/refund', requirePermission('invoices:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const refundSchema = z.object({ amount: z.number().positive(), method: z.enum(['card', 'cash', 'check', 'bank_transfer', 'stripe', 'other']).optional(), reference: z.string().optional(), notes: z.string().optional() })
  const data = refundSchema.parse(await c.req.json())
  const round2 = (n: number) => Math.round(n * 100) / 100
  const amount = round2(data.amount)

  // Same row lock as payments: concurrent refunds used to each read the same amountPaid and
  // together refund more than was ever collected. (SALON-N1)
  let outcome: { status: number; body: any } = { status: 500, body: { error: 'Refund failed' } }
  await db.transaction(async (tx) => {
    const locked: any = await tx.execute(sql`SELECT * FROM invoice WHERE id = ${id} AND company_id = ${currentUser.companyId} FOR UPDATE`)
    const row = (locked.rows || locked)[0]
    if (!row) { outcome = { status: 404, body: { error: 'Invoice not found' } }; return }
    if (row.status === 'void') { outcome = { status: 400, body: { error: 'This invoice is void.' } }; return }
    const paid = round2(Number(row.amount_paid))
    const refunded = round2(Number(row.amount_refunded || 0))
    const net = round2(paid - refunded)
    if (paid <= 0.005) { outcome = { status: 400, body: { error: 'This invoice has no payments to refund.' } }; return }
    if (net <= 0.005) { outcome = { status: 400, body: { error: 'Everything collected on this invoice has already been refunded.' } }; return }
    if (amount > net + 0.005) { outcome = { status: 400, body: { error: `Refund exceeds what was collected — ${net.toFixed(2)} still refundable on this invoice.` } }; return }
    // Default to how the money came in — the most recent positive payment's method. (SALON-N12)
    const [last] = await tx.select({ method: payment.method }).from(payment)
      .where(and(eq(payment.invoiceId, id), sql`${payment.amount}::numeric > 0`)).orderBy(desc(payment.paidAt)).limit(1)
    const method = data.method || last?.method || 'other'
    const [refund] = await tx.insert(payment).values({
      invoiceId: id, amount: (-amount).toString(), method, reference: data.reference || null, notes: data.notes || 'Refund',
    } as any).returning()
    // The sale stays paid: a refund is its own transaction and never reopens a balance the client
    // must settle again. Only refunding everything collected changes the status.
    const newRefunded = round2(refunded + amount)
    const newStatus = newRefunded >= paid - 0.005 ? 'refunded' : row.status
    const [updated] = await tx.update(invoice)
      .set({ amountRefunded: newRefunded.toString(), status: newStatus, updatedAt: new Date() })
      .where(eq(invoice.id, id)).returning()
    outcome = { status: 200, body: { refund, invoice: updated } }
  })
  if (outcome.status === 200) emitToCompany(currentUser.companyId, EVENTS.INVOICE_UPDATED, outcome.body.invoice)
  return c.json(outcome.body, outcome.status as any)
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
