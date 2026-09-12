// Invoices — ONE implementation for every CRM template, vendored into each tenant at generation.
// The template's route file passes its Drizzle db + tables, auth/permission middleware, socket
// emitter, email + PDF services and a small options object for the few things a vertical does
// differently (salon tips and its 'open' status, RV numbering). Everything else is the same
// product, so a fix here lands in all of them on their next deploy.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, or, count, desc, asc, sql, inArray, lt, gte, isNull } from 'drizzle-orm'
import { round2, calcTotals, rawSubtotal, DEFAULT_OPEN_STATUSES, isOverdue, deriveStatus, defaultTaxRateFrom, dueDateFromTerms, normalizeDateInput, nextNumber, type NumberingOptions } from './money'

export interface InvoiceTables {
  invoice: any
  invoiceLineItem: any
  payment: any
  contact: any
  project: any
  quote: any
  company: any
}

export interface InvoiceOptions {
  /** Statuses that count as billed-and-collectable. Default includes salon's 'open'. */
  openStatuses?: string[]
  /** Document numbering. Default INV-00001. RV uses { prefix: 'INV', pad: 0, seed: 1000 } → INV-1001. */
  numbering?: NumberingOptions
  /** payment.tipAmount exists and gratuity is recorded on payments (salon). */
  tips?: boolean
  /** Refuse a due date earlier than today on create (RV H-07). */
  rejectPastDueOnCreate?: boolean
  /** Require at least this many line items on create (landscaping used 1). */
  minLineItems?: number
  /** Maximum page size for the list. */
  maxLimit?: number
}

export interface InvoiceDeps {
  db: any
  tables: InvoiceTables
  authenticate: any
  requirePermission: (permission: string) => any
  emitToCompany: (companyId: string, event: string, data: any) => void
  EVENTS: Record<string, string>
  sendInvoiceEmail: (to: string, data: Record<string, unknown>) => Promise<unknown>
  /** Lazy so pdfkit is only loaded when a PDF is actually requested. */
  loadPdf: () => Promise<(invoice: any, company: any) => Promise<Buffer>>
  options?: InvoiceOptions
}

const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().min(0, 'Quantity cannot be negative').default(1),
  unitPrice: z.number().min(0, 'Price cannot be negative').default(0),
})
const optionalId = z.string().optional().transform(v => (v === '' ? undefined : v))
const invoiceSchema = z.object({
  contactId: optionalId,
  projectId: optionalId,
  // '' and null clear the date; the route validates the string (a blank used to reach Postgres as '' → 500)
  dueDate: z.union([z.string(), z.null()]).optional(),
  taxRate: z.number().min(0).max(100).optional(),
  discount: z.number().min(0, 'Discount cannot be negative').default(0),
  notes: z.string().optional(),
  terms: z.string().optional(),
  lineItems: z.array(lineItemSchema).default([]),
})
const PAYMENT_METHODS = ['card', 'cash', 'check', 'bank_transfer', 'stripe', 'other'] as const

const toRow = (items: z.infer<typeof lineItemSchema>[], invoiceId: string) => items.map((item, i) => ({
  description: item.description,
  quantity: item.quantity.toString(),
  unitPrice: item.unitPrice.toString(),
  total: round2(item.quantity * item.unitPrice).toString(),
  sortOrder: i,
  invoiceId,
}))

export function createInvoiceRoutes(deps: InvoiceDeps) {
  const { db, tables: t, authenticate, requirePermission, emitToCompany, EVENTS, sendInvoiceEmail, loadPdf } = deps
  const openStatuses = deps.options?.openStatuses || DEFAULT_OPEN_STATUSES
  const numbering: NumberingOptions = deps.options?.numbering || { prefix: 'INV', pad: 5, seed: 0 }
  const tips = !!deps.options?.tips
  const maxLimit = deps.options?.maxLimit ?? 100
  const minLineItems = deps.options?.minLineItems ?? 0
  const derive = (inv: any) => deriveStatus(inv, openStatuses)

  const app = new Hono()
  app.use('*', authenticate)

  const companySettings = async (companyId: string) => {
    const [co] = await db.select({ settings: t.company.settings }).from(t.company).where(eq(t.company.id, companyId)).limit(1)
    return (co?.settings as any) || {}
  }
  const ownContact = async (companyId: string, id: string) => (await db.select({ id: t.contact.id }).from(t.contact).where(and(eq(t.contact.id, id), eq(t.contact.companyId, companyId))).limit(1))[0]
  const ownProject = async (companyId: string, id: string) => (await db.select({ id: t.project.id }).from(t.project).where(and(eq(t.project.id, id), eq(t.project.companyId, companyId))).limit(1))[0]

  // ---------------------------------------------------------------- list
  app.get('/', requirePermission('invoices:read'), async (c) => {
    const currentUser = c.get('user') as any
    const status = c.req.query('status')
    const contactId = c.req.query('contactId')
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1)
    const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50), maxLimit)

    const conditions: any[] = [eq(t.invoice.companyId, currentUser.companyId)]
    // 'overdue' is derived, never stored: translate the filter instead of matching a status that no row
    // has, and keep past-due rows out of the plain open-status filters so the page and its count agree.
    const now = new Date()
    if (status === 'overdue') { conditions.push(inArray(t.invoice.status, openStatuses)); conditions.push(lt(t.invoice.dueDate, now)) }
    else if (status && openStatuses.includes(status)) { conditions.push(eq(t.invoice.status, status)); conditions.push(or(isNull(t.invoice.dueDate), gte(t.invoice.dueDate, now))) }
    else if (status) conditions.push(eq(t.invoice.status, status))
    if (contactId) conditions.push(eq(t.invoice.contactId, contactId))

    const where = and(...conditions)
    const [data, [{ value: total }]] = await Promise.all([
      db.select().from(t.invoice).where(where).orderBy(desc(t.invoice.createdAt)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(t.invoice).where(where),
    ])
    const invoiceIds: string[] = data.map((inv: any) => inv.id)
    const contactIds: string[] = [...new Set<string>(data.filter((inv: any) => inv.contactId).map((inv: any) => inv.contactId))]
    const [contacts, lineItems, payments] = await Promise.all([
      contactIds.length ? db.select({ id: t.contact.id, name: t.contact.name }).from(t.contact).where(and(eq(t.contact.companyId, currentUser.companyId), inArray(t.contact.id, contactIds))) : Promise.resolve([]),
      invoiceIds.length ? db.select().from(t.invoiceLineItem).where(inArray(t.invoiceLineItem.invoiceId, invoiceIds)).orderBy(asc(t.invoiceLineItem.sortOrder)) : Promise.resolve([]),
      invoiceIds.length ? db.select().from(t.payment).where(inArray(t.payment.invoiceId, invoiceIds)).orderBy(desc(t.payment.paidAt)) : Promise.resolve([]),
    ])
    const contactMap = Object.fromEntries(contacts.map((ct: any) => [ct.id, ct]))
    const lineItemMap: Record<string, any[]> = {}; lineItems.forEach((li: any) => { (lineItemMap[li.invoiceId] ||= []).push(li) })
    const paymentMap: Record<string, any[]> = {}; payments.forEach((p: any) => { (paymentMap[p.invoiceId] ||= []).push(p) })

    const rows = data.map((inv: any) => ({ ...inv, status: derive(inv), contact: inv.contactId ? contactMap[inv.contactId] || null : null, lineItems: lineItemMap[inv.id] || [], payments: paymentMap[inv.id] || [] }))
    return c.json({ data: rows, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
  })

  // ---------------------------------------------------------------- stats
  // One set of numbers for the dashboard, Reports and the invoice list:
  //   issued     = every invoice that is not draft / void / refunded
  //   totalAmount = sum of issued totals; outstanding = sum of issued balances, floored per invoice
  //   paidAmount  = money actually kept: amountPaid − amountRefunded on every non-void invoice
  app.get('/stats', requirePermission('invoices:read'), async (c) => {
    const currentUser = c.get('user') as any
    const invoices = await db.select({ status: t.invoice.status, total: t.invoice.total, amountPaid: t.invoice.amountPaid, amountRefunded: t.invoice.amountRefunded, dueDate: t.invoice.dueDate }).from(t.invoice).where(eq(t.invoice.companyId, currentUser.companyId))
    const stats: Record<string, number> = { total: invoices.length, draft: 0, sent: 0, paid: 0, overdue: 0, totalAmount: 0, paidAmount: 0, outstanding: 0 }
    for (const inv of invoices) {
      const s = derive(inv)
      stats[s] = (stats[s] || 0) + 1
      if (inv.status !== 'draft' && inv.status !== 'void' && inv.status !== 'refunded') {
        stats.totalAmount = round2(stats.totalAmount + Number(inv.total))
        stats.outstanding = round2(stats.outstanding + Math.max(0, Number(inv.total) - Number(inv.amountPaid)))
      }
      if (inv.status !== 'void') stats.paidAmount = round2(stats.paidAmount + Number(inv.amountPaid || 0) - Number(inv.amountRefunded || 0))
    }
    return c.json(stats)
  })

  // ---------------------------------------------------------------- read one
  app.get('/:id', requirePermission('invoices:read'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [found] = await db.select().from(t.invoice).where(and(eq(t.invoice.id, id), eq(t.invoice.companyId, currentUser.companyId))).limit(1)
    if (!found) return c.json({ error: 'Invoice not found' }, 404)
    const cid = currentUser.companyId
    const [ct, pr, qt, lineItems, payments] = await Promise.all([
      found.contactId ? db.select().from(t.contact).where(and(eq(t.contact.id, found.contactId), eq(t.contact.companyId, cid))).limit(1) : Promise.resolve([]),
      found.projectId ? db.select().from(t.project).where(and(eq(t.project.id, found.projectId), eq(t.project.companyId, cid))).limit(1) : Promise.resolve([]),
      found.quoteId ? db.select().from(t.quote).where(and(eq(t.quote.id, found.quoteId), eq(t.quote.companyId, cid))).limit(1) : Promise.resolve([]),
      db.select().from(t.invoiceLineItem).where(eq(t.invoiceLineItem.invoiceId, id)).orderBy(asc(t.invoiceLineItem.sortOrder)),
      db.select().from(t.payment).where(eq(t.payment.invoiceId, id)).orderBy(desc(t.payment.paidAt)),
    ])
    const balance = ['void', 'refunded'].includes(found.status) ? 0 : round2(Math.max(0, Number(found.total) - Number(found.amountPaid || 0)))
    return c.json({ ...found, status: derive(found), balance, contact: ct[0] || null, project: pr[0] || null, quote: qt[0] || null, lineItems, payments })
  })

  // ---------------------------------------------------------------- create
  app.post('/', requirePermission('invoices:create'), async (c) => {
    const currentUser = c.get('user') as any
    const data = invoiceSchema.parse(await c.req.json())
    const cid = currentUser.companyId
    if (!data.contactId) return c.json({ error: 'A client is required to create an invoice.' }, 400)
    if (!(await ownContact(cid, data.contactId))) return c.json({ error: 'That client does not exist.' }, 404)
    if (data.projectId && !(await ownProject(cid, data.projectId))) return c.json({ error: 'That project does not exist.' }, 404)
    if (data.lineItems.length < minLineItems) return c.json({ error: 'Add at least one line item.' }, 400)
    const subtotalRaw = rawSubtotal(data.lineItems)
    if (data.discount > subtotalRaw + 0.005) return c.json({ error: `Discount cannot exceed the subtotal (${subtotalRaw.toFixed(2)}).` }, 400)
    const settings = await companySettings(cid)
    const taxRate = data.taxRate ?? defaultTaxRateFrom(settings)
    const totals = calcTotals(data.lineItems, taxRate, data.discount)
    // Due date: what the form sent, else the company's payment terms (Settings → Company). Never null:
    // an invoice with no due date could never become overdue.
    const due = normalizeDateInput(data.dueDate)
    if (due.error) return c.json({ error: `Due date: ${due.error}` }, 400)
    const dueDate = due.value ?? dueDateFromTerms(settings)
    if (deps.options?.rejectPastDueOnCreate && due.value) { const today = new Date(); today.setHours(0, 0, 0, 0); if (due.value < today) return c.json({ error: 'Due date cannot be before the issue date' }, 400) }

    const { lineItems, ...rest } = data
    const result = await db.transaction(async (tx: any) => {
      const number = await nextNumber(tx, t.invoice, t.invoice.number, t.invoice.companyId, cid, numbering)
      const [created] = await tx.insert(t.invoice).values({
        contactId: rest.contactId, projectId: rest.projectId, notes: rest.notes, terms: rest.terms,
        number, companyId: cid, dueDate,
        subtotal: totals.subtotal.toString(), taxRate: String(taxRate), taxAmount: totals.taxAmount.toString(),
        discount: totals.effectiveDiscount.toString(), total: totals.total.toString(), amountPaid: '0',
      }).returning()
      const items = lineItems.length ? await tx.insert(t.invoiceLineItem).values(toRow(lineItems, created.id)).returning() : []
      return { ...created, lineItems: items }
    })
    emitToCompany(cid, EVENTS.INVOICE_CREATED, result)
    return c.json(result, 201)
  })

  // ---------------------------------------------------------------- update
  app.put('/:id', requirePermission('invoices:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const cid = currentUser.companyId
    const data = invoiceSchema.partial().parse(await c.req.json())
    const [existing] = await db.select().from(t.invoice).where(and(eq(t.invoice.id, id), eq(t.invoice.companyId, cid))).limit(1)
    if (!existing) return c.json({ error: 'Invoice not found' }, 404)
    if (existing.status === 'void') return c.json({ error: 'This invoice is void and can no longer be edited.' }, 400)
    if (existing.status === 'refunded') return c.json({ error: 'This sale was refunded and can no longer be edited. Start a new invoice.' }, 400)
    if (data.contactId && !(await ownContact(cid, data.contactId))) return c.json({ error: 'That client does not exist.' }, 404)
    if (data.projectId && !(await ownProject(cid, data.projectId))) return c.json({ error: 'That project does not exist.' }, 404)
    const due = normalizeDateInput(data.dueDate)
    if (due.error) return c.json({ error: `Due date: ${due.error}` }, 400)

    // Totals are recomputed whenever anything that feeds them changes — lines, tax rate or discount.
    // (Changing only the tax rate used to leave the stored total at the old rate.)
    const recompute = data.lineItems !== undefined || data.taxRate !== undefined || data.discount !== undefined
    let lines: z.infer<typeof lineItemSchema>[] | undefined = data.lineItems
    if (recompute && !lines) {
      const current = await db.select().from(t.invoiceLineItem).where(eq(t.invoiceLineItem.invoiceId, id)).orderBy(asc(t.invoiceLineItem.sortOrder))
      lines = current.map((li: any) => ({ description: li.description, quantity: Number(li.quantity), unitPrice: Number(li.unitPrice) }))
    }
    const update: Record<string, any> = { updatedAt: new Date() }
    for (const k of ['contactId', 'projectId', 'notes', 'terms'] as const) if (data[k] !== undefined) update[k] = data[k]
    if (due.value !== undefined) update.dueDate = due.value
    if (recompute && lines) {
      const taxRate = data.taxRate ?? Number(existing.taxRate)
      const discount = data.discount ?? Number(existing.discount)
      if (lines.length < minLineItems) return c.json({ error: 'Add at least one line item.' }, 400)
      const subtotalRaw = rawSubtotal(lines)
      if (discount > subtotalRaw + 0.005) return c.json({ error: `Discount cannot exceed the subtotal (${subtotalRaw.toFixed(2)}).` }, 400)
      const calc = calcTotals(lines, taxRate, discount)
      const paid = Number(existing.amountPaid)
      if (calc.total < paid - 0.005) return c.json({ error: `This invoice already has $${paid.toFixed(2)} in payments; the total can't be lowered below that. Refund or void instead.` }, 400)
      // amountPaid is gross (refunds live in amountRefunded), so a partially refunded, fully paid invoice stays 'paid'.
      Object.assign(update, {
        subtotal: calc.subtotal.toString(), taxRate: String(taxRate), taxAmount: calc.taxAmount.toString(),
        discount: calc.effectiveDiscount.toString(), total: calc.total.toString(),
        status: paid >= calc.total - 0.005 ? 'paid' : paid > 0 ? 'partial' : existing.status,
      })
    }
    const result = await db.transaction(async (tx: any) => {
      const [updated] = await tx.update(t.invoice).set(update).where(eq(t.invoice.id, id)).returning()
      let items: any[]
      if (data.lineItems !== undefined) {
        await tx.delete(t.invoiceLineItem).where(eq(t.invoiceLineItem.invoiceId, id))
        items = data.lineItems.length ? await tx.insert(t.invoiceLineItem).values(toRow(data.lineItems, id)).returning() : []
      } else items = await tx.select().from(t.invoiceLineItem).where(eq(t.invoiceLineItem.invoiceId, id)).orderBy(asc(t.invoiceLineItem.sortOrder))
      return { ...updated, lineItems: items }
    })
    emitToCompany(cid, EVENTS.INVOICE_UPDATED, result)
    return c.json(result)
  })

  // ---------------------------------------------------------------- delete
  app.delete('/:id', requirePermission('invoices:delete'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const [existing] = await db.select().from(t.invoice).where(and(eq(t.invoice.id, id), eq(t.invoice.companyId, currentUser.companyId))).limit(1)
    if (!existing) return c.json({ error: 'Invoice not found' }, 404)
    // Never delete an invoice that has taken money — it destroys the financial record. Void it instead.
    if (Number(existing.amountPaid) > 0 || existing.status === 'paid') return c.json({ error: 'Cannot delete an invoice with payments recorded. Void it instead.' }, 400)
    await db.delete(t.invoice).where(eq(t.invoice.id, id))
    return c.body(null, 204)
  })

  // ---------------------------------------------------------------- send
  app.post('/:id/send', requirePermission('invoices:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const cid = currentUser.companyId
    const [found] = await db.select().from(t.invoice).where(and(eq(t.invoice.id, id), eq(t.invoice.companyId, cid))).limit(1)
    if (!found) return c.json({ error: 'Invoice not found' }, 404)
    if (found.status === 'void') return c.json({ error: 'This invoice is void and cannot be sent.' }, 400)
    if (found.status === 'refunded') return c.json({ error: 'This sale was refunded and cannot be sent.' }, 400)
    let recipientEmail: string | null = null
    let contactName = 'there'
    if (found.contactId) {
      const [ct] = await db.select().from(t.contact).where(and(eq(t.contact.id, found.contactId), eq(t.contact.companyId, cid))).limit(1)
      if (ct) { recipientEmail = ct.email || null; contactName = ct.name || contactName }
    }
    if (!recipientEmail) return c.json({ error: 'This invoice has no contact email address to send to. Add an email to the contact first.' }, 400)
    const [co] = await db.select().from(t.company).where(eq(t.company.id, cid)).limit(1)
    const balance = round2(Math.max(0, Number(found.total) - Number(found.amountPaid || 0)))
    try {
      await sendInvoiceEmail(recipientEmail, {
        invoiceNumber: found.number, companyName: co?.name || 'Your provider', companyEmail: co?.email || '', contactName,
        total: found.total, balance, dueDate: found.dueDate ? new Date(found.dueDate as any).toLocaleDateString() : 'Upon receipt',
      })
    } catch (err: any) {
      return c.json({ error: `Could not send the invoice email: ${err?.message || 'delivery failed'}. It was not marked as sent.` }, 502)
    }
    // Sending never rewinds a paid/partial/open invoice to 'sent' — only a draft becomes 'sent'. sentAt is always stamped.
    const status = found.status === 'draft' ? 'sent' : found.status
    const [updated] = await db.update(t.invoice).set({ status, sentAt: new Date(), updatedAt: new Date() }).where(and(eq(t.invoice.id, id), eq(t.invoice.companyId, cid))).returning()
    emitToCompany(cid, EVENTS.INVOICE_SENT, { id: updated.id, number: updated.number })
    return c.json(updated)
  })

  // ---------------------------------------------------------------- payments
  app.post('/:id/payments', requirePermission('invoices:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const paymentSchema = z.object({ amount: z.number().positive(), method: z.enum(PAYMENT_METHODS), reference: z.string().optional(), notes: z.string().optional(), tipAmount: z.number().min(0).max(1000).optional() })
    const data = paymentSchema.parse(await c.req.json())
    const amount = round2(data.amount)
    if (amount <= 0) return c.json({ error: 'Payment amount must be at least $0.01' }, 400)
    const tipAmount = tips ? round2(data.tipAmount || 0) : 0
    if (tips && tipAmount > Math.max(amount * 5, 100)) return c.json({ error: `A $${tipAmount.toFixed(2)} tip on a $${amount.toFixed(2)} payment looks wrong — check the amount.` }, 400)

    // Balance check and write in ONE transaction with the row locked: two payments (or a payment and a
    // refund) sent at the same instant cannot both pass the check.
    let outcome: { status: number; body: any; row?: any; newBalance?: number; newStatus?: string } = { status: 500, body: { error: 'Payment failed' } }
    await db.transaction(async (tx: any) => {
      const locked: any = await tx.execute(sql`SELECT * FROM invoice WHERE id = ${id} AND company_id = ${currentUser.companyId} FOR UPDATE`)
      const row = (locked.rows || locked)[0]
      if (!row) { outcome = { status: 404, body: { error: 'Invoice not found' } }; return }
      if (row.status === 'void') { outcome = { status: 400, body: { error: 'This invoice is void and cannot take payments.' } }; return }
      if (row.status === 'refunded') { outcome = { status: 400, body: { error: 'This sale was refunded. Start a new invoice to charge the client again.' } }; return }
      const balanceDue = round2(Number(row.total) - Number(row.amount_paid))
      if (amount > balanceDue + 0.005) { outcome = { status: 400, body: { error: `Payment exceeds the balance due — $${balanceDue.toFixed(2)} remaining` } }; return }
      const values: any = { invoiceId: id, amount: amount.toString(), method: data.method, reference: data.reference, notes: data.notes }
      if (tips) values.tipAmount = tipAmount.toString()
      const [newPayment] = await tx.insert(t.payment).values(values).returning()
      const newAmountPaid = round2(Number(row.amount_paid) + amount)
      const newBalance = round2(Number(row.total) - newAmountPaid)
      // A draft may take a payment (a walk-in pays at the desk before anything is emailed); the payment issues it.
      const newStatus = newBalance <= 0.005 ? 'paid' : newAmountPaid > 0 ? 'partial' : row.status
      await tx.update(t.invoice).set({ amountPaid: newAmountPaid.toString(), status: newStatus, paidAt: newBalance <= 0.005 ? new Date() : null, updatedAt: new Date() }).where(eq(t.invoice.id, id))
      outcome = { status: 201, body: newPayment, row, newBalance, newStatus }
    })
    if (outcome.status !== 201) return c.json(outcome.body, outcome.status as any)
    emitToCompany(currentUser.companyId, EVENTS.PAYMENT_RECEIVED, { invoiceId: id, invoiceNumber: outcome.row.number, amount, newBalance: outcome.newBalance, status: outcome.newStatus })
    if (outcome.newStatus === 'paid') emitToCompany(currentUser.companyId, EVENTS.INVOICE_PAID, { id, number: outcome.row.number, total: outcome.row.total })
    return c.json(outcome.body, 201)
  })

  // ---------------------------------------------------------------- void
  // An issued invoice is never deleted: voiding keeps the number and the audit trail and takes it out
  // of outstanding balances. Money that was collected and not refunded blocks a void. Row-locked so a
  // payment landing at the same instant cannot leave a void invoice holding money.
  app.post('/:id/void', requirePermission('invoices:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    let outcome: { status: number; body: any } = { status: 500, body: { error: 'Void failed' } }
    await db.transaction(async (tx: any) => {
      const locked: any = await tx.execute(sql`SELECT * FROM invoice WHERE id = ${id} AND company_id = ${currentUser.companyId} FOR UPDATE`)
      const row = (locked.rows || locked)[0]
      if (!row) { outcome = { status: 404, body: { error: 'Invoice not found' } }; return }
      if (row.status === 'void') { outcome = { status: 400, body: { error: 'This invoice is already void.' } }; return }
      const paid = round2(Number(row.amount_paid) - Number(row.amount_refunded || 0))
      if (paid > 0.005) { outcome = { status: 400, body: { error: `This invoice has $${paid.toFixed(2)} in payments that were not refunded. Refund them first, then void.` } }; return }
      const note = body.reason ? `Voided: ${String(body.reason).slice(0, 500)}` : 'Voided'
      const [updated] = await tx.update(t.invoice).set({ status: 'void', notes: row.notes ? `${row.notes}\n${note}` : note, updatedAt: new Date() }).where(eq(t.invoice.id, id)).returning()
      outcome = { status: 200, body: updated }
    })
    if (outcome.status === 200) emitToCompany(currentUser.companyId, EVENTS.INVOICE_UPDATED, outcome.body)
    return c.json(outcome.body, outcome.status as any)
  })

  // ---------------------------------------------------------------- refund
  // A refund is its own ledger event: a negative payment row plus amountRefunded. amountPaid stays gross,
  // so the sale stays paid and a refund never reopens a balance the client must settle again. Only
  // refunding everything collected changes the status (→ 'refunded').
  app.post('/:id/refund', requirePermission('invoices:update'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const refundSchema = z.object({ amount: z.number().positive(), method: z.enum(PAYMENT_METHODS).optional(), reference: z.string().optional(), notes: z.string().optional() })
    const data = refundSchema.parse(await c.req.json())
    const amount = round2(data.amount)
    let outcome: { status: number; body: any } = { status: 500, body: { error: 'Refund failed' } }
    await db.transaction(async (tx: any) => {
      const locked: any = await tx.execute(sql`SELECT * FROM invoice WHERE id = ${id} AND company_id = ${currentUser.companyId} FOR UPDATE`)
      const row = (locked.rows || locked)[0]
      if (!row) { outcome = { status: 404, body: { error: 'Invoice not found' } }; return }
      if (row.status === 'void') { outcome = { status: 400, body: { error: 'This invoice is void.' } }; return }
      const paid = round2(Number(row.amount_paid))
      const refunded = round2(Number(row.amount_refunded || 0))
      const net = round2(paid - refunded)
      if (paid <= 0.005) { outcome = { status: 400, body: { error: 'This invoice has no payments to refund.' } }; return }
      if (net <= 0.005) { outcome = { status: 400, body: { error: 'Everything collected on this invoice has already been refunded.' } }; return }
      if (amount > net + 0.005) { outcome = { status: 400, body: { error: `Refund exceeds what was collected — $${net.toFixed(2)} still refundable on this invoice.` } }; return }
      // Default to how the money came in — the most recent positive payment's method.
      const [last] = await tx.select({ method: t.payment.method }).from(t.payment).where(and(eq(t.payment.invoiceId, id), sql`${t.payment.amount}::numeric > 0`)).orderBy(desc(t.payment.paidAt)).limit(1)
      const method = data.method || last?.method || 'other'
      const [refund] = await tx.insert(t.payment).values({ invoiceId: id, amount: (-amount).toString(), method, reference: data.reference || null, notes: data.notes || 'Refund' }).returning()
      const newRefunded = round2(refunded + amount)
      const newStatus = newRefunded >= paid - 0.005 ? 'refunded' : row.status
      const [updated] = await tx.update(t.invoice).set({ amountRefunded: newRefunded.toString(), status: newStatus, updatedAt: new Date() }).where(eq(t.invoice.id, id)).returning()
      outcome = { status: 200, body: { refund, invoice: updated } }
    })
    if (outcome.status === 200) emitToCompany(currentUser.companyId, EVENTS.INVOICE_UPDATED, outcome.body.invoice)
    return c.json(outcome.body, outcome.status as any)
  })

  // ---------------------------------------------------------------- pdf
  app.get('/:id/pdf', requirePermission('invoices:read'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const cid = currentUser.companyId
    const generateInvoicePDF = await loadPdf()
    const [found] = await db.select().from(t.invoice).where(and(eq(t.invoice.id, id), eq(t.invoice.companyId, cid))).limit(1)
    if (!found) return c.json({ error: 'Invoice not found' }, 404)
    const [ct, lineItems, payments, [co]] = await Promise.all([
      found.contactId ? db.select().from(t.contact).where(and(eq(t.contact.id, found.contactId), eq(t.contact.companyId, cid))).limit(1) : Promise.resolve([]),
      db.select().from(t.invoiceLineItem).where(eq(t.invoiceLineItem.invoiceId, id)).orderBy(asc(t.invoiceLineItem.sortOrder)),
      db.select().from(t.payment).where(eq(t.payment.invoiceId, id)).orderBy(desc(t.payment.paidAt)),
      db.select().from(t.company).where(eq(t.company.id, cid)),
    ])
    const pdfBuffer = await generateInvoicePDF({ ...found, status: derive(found), contact: ct[0] || null, lineItems, payments }, co)
    return new Response(pdfBuffer, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="invoice-${found.number}.pdf"` } })
  })

  return app
}

export { isOverdue, deriveStatus }
