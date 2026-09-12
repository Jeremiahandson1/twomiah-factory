// Quotes — ONE implementation for every CRM template, vendored into each tenant at generation.
// Same shape as invoices.ts: the template injects db + tables + middleware + services and a small
// options object for what its vertical really does differently (field-service site/equipment fields,
// customer message, decline with timestamp, SMS on send, which conversions it offers).
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, or, count, desc, asc, ilike, inArray } from 'drizzle-orm'
import { round2, calcTotals, rawSubtotal, defaultTaxRateFrom, dueDateFromTerms, normalizeDateInput, nextNumber, type NumberingOptions } from './money'

export interface QuoteTables {
  quote: any
  quoteLineItem: any
  contact: any
  project: any
  invoice: any
  invoiceLineItem: any
  company: any
  job: any
  /** field service / landscaping */
  equipment?: any
  site?: any
}

export type QuoteExtraField = 'siteId' | 'equipmentId' | 'customerMessage'

export interface QuoteOptions {
  /** Extra quote columns this vertical has (siteId, equipmentId, customerMessage). */
  extraFields?: QuoteExtraField[]
  /** quote.declinedAt exists → POST /:id/decline is offered and reject stamps it. */
  hasDeclinedAt?: boolean
  /** quote.convertedToJobId exists → used for job-conversion idempotency (else job.quoteId is looked up). */
  hasConvertedToJobId?: boolean
  /** job.equipmentId / job.siteId exist → carried over from the quote. */
  jobHasSiteAndEquipment?: boolean
  /** Which conversions this vertical offers. Default both. */
  conversions?: Array<'invoice' | 'job'>
  numbering?: { quote?: NumberingOptions; invoice?: NumberingOptions; job?: NumberingOptions }
  maxLimit?: number
  /** Optional: text the customer when a quote is sent (field service). */
  onSent?: (ctx: { companyId: string; quote: any; contact: any; company: any }) => Promise<void>
}

export interface QuoteDeps {
  db: any
  tables: QuoteTables
  authenticate: any
  requirePermission: (permission: string) => any
  emitToCompany: (companyId: string, event: string, data: any) => void
  EVENTS: Record<string, string>
  loadPdf: () => Promise<(quote: any, company: any) => Promise<Buffer>>
  options?: QuoteOptions
}

const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().min(0, 'Quantity cannot be negative').default(1),
  unitPrice: z.number().min(0, 'Price cannot be negative').default(0),
})
const optionalId = z.string().optional().transform(v => (v === '' ? undefined : v))
const QUOTE_STATUSES = ['draft', 'sent', 'approved', 'rejected', 'declined', 'expired'] as const
const EDITABLE = ['draft', 'sent']

const toRow = (items: z.infer<typeof lineItemSchema>[], quoteId: string) => items.map((item, i) => ({
  description: item.description,
  quantity: item.quantity.toString(),
  unitPrice: item.unitPrice.toString(),
  total: round2(item.quantity * item.unitPrice).toString(),
  sortOrder: i,
  quoteId,
}))

export function createQuoteRoutes(deps: QuoteDeps) {
  const { db, tables: t, authenticate, requirePermission, emitToCompany, EVENTS, loadPdf } = deps
  const o = deps.options || {}
  const extra = new Set(o.extraFields || [])
  const conversions = new Set(o.conversions || ['invoice', 'job'])
  const maxLimit = o.maxLimit ?? 100
  const numQuote: NumberingOptions = o.numbering?.quote || { prefix: 'QTE', pad: 5, seed: 0 }
  const numInvoice: NumberingOptions = o.numbering?.invoice || { prefix: 'INV', pad: 5, seed: 0 }
  const numJob: NumberingOptions = o.numbering?.job || { prefix: 'JOB', pad: 5, seed: 0 }

  const quoteSchema = z.object({
    name: z.string().min(1),
    contactId: optionalId,
    projectId: optionalId,
    ...(extra.has('siteId') ? { siteId: optionalId } : {}),
    ...(extra.has('equipmentId') ? { equipmentId: optionalId } : {}),
    ...(extra.has('customerMessage') ? { customerMessage: z.string().optional() } : {}),
    expiryDate: z.union([z.string(), z.null()]).optional(),
    taxRate: z.number().min(0).max(100).optional(),
    discount: z.number().min(0, 'Discount cannot be negative').default(0),
    notes: z.string().optional(),
    terms: z.string().optional(),
    lineItems: z.array(lineItemSchema).default([]),
    status: z.enum(QUOTE_STATUSES).optional(),
  })
  const COPY_FIELDS = ['name', 'contactId', 'projectId', 'notes', 'terms', ...(extra.has('siteId') ? ['siteId'] : []), ...(extra.has('equipmentId') ? ['equipmentId'] : []), ...(extra.has('customerMessage') ? ['customerMessage'] : [])] as const

  const app = new Hono()
  app.use('*', authenticate)

  const companySettings = async (companyId: string) => {
    const [co] = await db.select({ settings: t.company.settings }).from(t.company).where(eq(t.company.id, companyId)).limit(1)
    return (co?.settings as any) || {}
  }
  const ownContact = async (companyId: string, id: string) => (await db.select({ id: t.contact.id }).from(t.contact).where(and(eq(t.contact.id, id), eq(t.contact.companyId, companyId))).limit(1))[0]
  const ownProject = async (companyId: string, id: string) => (await db.select({ id: t.project.id }).from(t.project).where(and(eq(t.project.id, id), eq(t.project.companyId, companyId))).limit(1))[0]
  const findOwn = async (companyId: string, id: string) => (await db.select().from(t.quote).where(and(eq(t.quote.id, id), eq(t.quote.companyId, companyId))).limit(1))[0]
  const lineRows = (id: string) => db.select().from(t.quoteLineItem).where(eq(t.quoteLineItem.quoteId, id)).orderBy(asc(t.quoteLineItem.sortOrder))

  // ---------------------------------------------------------------- list
  app.get('/', requirePermission('quotes:read'), async (c) => {
    const currentUser = c.get('user') as any
    const status = c.req.query('status')
    const contactId = c.req.query('contactId')
    const search = c.req.query('search')
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1)
    const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') || '50', 10) || 50), maxLimit)
    const conditions: any[] = [eq(t.quote.companyId, currentUser.companyId)]
    if (status) conditions.push(eq(t.quote.status, status))
    if (contactId) conditions.push(eq(t.quote.contactId, contactId))
    if (search) { const p = `%${search}%`; conditions.push(or(ilike(t.quote.number, p), ilike(t.quote.name, p))) }
    const where = and(...conditions)
    const [data, [{ value: total }]] = await Promise.all([
      db.select().from(t.quote).where(where).orderBy(desc(t.quote.createdAt)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(t.quote).where(where),
    ])
    const quoteIds: string[] = data.map((q: any) => q.id)
    const contactIds: string[] = [...new Set<string>(data.filter((q: any) => q.contactId).map((q: any) => q.contactId))]
    const [contacts, lineItems] = await Promise.all([
      contactIds.length ? db.select({ id: t.contact.id, name: t.contact.name }).from(t.contact).where(and(eq(t.contact.companyId, currentUser.companyId), inArray(t.contact.id, contactIds))) : Promise.resolve([]),
      quoteIds.length ? db.select().from(t.quoteLineItem).where(inArray(t.quoteLineItem.quoteId, quoteIds)).orderBy(asc(t.quoteLineItem.sortOrder)) : Promise.resolve([]),
    ])
    const contactMap = Object.fromEntries(contacts.map((ct: any) => [ct.id, ct]))
    const lineItemMap: Record<string, any[]> = {}; lineItems.forEach((li: any) => { (lineItemMap[li.quoteId] ||= []).push(li) })
    const rows = data.map((q: any) => ({ ...q, contact: q.contactId ? contactMap[q.contactId] || null : null, lineItems: lineItemMap[q.id] || [] }))
    return c.json({ data: rows, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
  })

  // ---------------------------------------------------------------- stats
  app.get('/stats', requirePermission('quotes:read'), async (c) => {
    const currentUser = c.get('user') as any
    const quotes = await db.select({ status: t.quote.status, total: t.quote.total }).from(t.quote).where(eq(t.quote.companyId, currentUser.companyId))
    const stats: Record<string, number> = { total: quotes.length, draft: 0, sent: 0, approved: 0, rejected: 0, declined: 0, expired: 0, totalValue: 0, approvedValue: 0 }
    for (const q of quotes) { stats[q.status] = (stats[q.status] || 0) + 1; stats.totalValue = round2(stats.totalValue + Number(q.total)); if (q.status === 'approved') stats.approvedValue = round2(stats.approvedValue + Number(q.total)) }
    return c.json(stats)
  })

  // ---------------------------------------------------------------- read one
  app.get('/:id', requirePermission('quotes:read'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const cid = currentUser.companyId
    const found = await findOwn(cid, id)
    if (!found) return c.json({ error: 'Quote not found' }, 404)
    const [ct, pr, lineItems, eq_, st] = await Promise.all([
      found.contactId ? db.select().from(t.contact).where(and(eq(t.contact.id, found.contactId), eq(t.contact.companyId, cid))).limit(1) : Promise.resolve([]),
      found.projectId ? db.select().from(t.project).where(and(eq(t.project.id, found.projectId), eq(t.project.companyId, cid))).limit(1) : Promise.resolve([]),
      lineRows(id),
      extra.has('equipmentId') && t.equipment && found.equipmentId ? db.select({ id: t.equipment.id, name: t.equipment.name, manufacturer: t.equipment.manufacturer, model: t.equipment.model }).from(t.equipment).where(and(eq(t.equipment.id, found.equipmentId), eq(t.equipment.companyId, cid))).limit(1) : Promise.resolve([]),
      extra.has('siteId') && t.site && found.siteId ? db.select({ id: t.site.id, name: t.site.name, address: t.site.address }).from(t.site).where(and(eq(t.site.id, found.siteId), eq(t.site.companyId, cid))).limit(1) : Promise.resolve([]),
    ])
    const out: any = { ...found, contact: ct[0] || null, project: pr[0] || null, lineItems }
    if (extra.has('equipmentId')) out.equipment = eq_[0] || null
    if (extra.has('siteId')) out.site = st[0] || null
    return c.json(out)
  })

  // ---------------------------------------------------------------- create
  app.post('/', requirePermission('quotes:create'), async (c) => {
    const currentUser = c.get('user') as any
    const cid = currentUser.companyId
    const data = quoteSchema.parse(await c.req.json()) as any
    if (data.contactId && !(await ownContact(cid, data.contactId))) return c.json({ error: 'That client does not exist.' }, 404)
    if (data.projectId && !(await ownProject(cid, data.projectId))) return c.json({ error: 'That project does not exist.' }, 404)
    const subtotalRaw = rawSubtotal(data.lineItems)
    if (data.discount > subtotalRaw + 0.005) return c.json({ error: `Discount cannot exceed the subtotal (${subtotalRaw.toFixed(2)}).` }, 400)
    const exp = normalizeDateInput(data.expiryDate)
    if (exp.error) return c.json({ error: `Expiry date: ${exp.error}` }, 400)
    const taxRate = data.taxRate ?? defaultTaxRateFrom(await companySettings(cid))
    const totals = calcTotals(data.lineItems, taxRate, data.discount)
    const values: any = { companyId: cid, expiryDate: exp.value ?? null, subtotal: totals.subtotal.toString(), taxRate: String(taxRate), taxAmount: totals.taxAmount.toString(), discount: totals.effectiveDiscount.toString(), total: totals.total.toString() }
    for (const k of COPY_FIELDS) if (data[k] !== undefined) values[k] = data[k]
    // A quote is born a draft; the lifecycle routes stamp sentAt/approvedAt. A status in the body cannot skip them.
    const result = await db.transaction(async (tx: any) => {
      values.number = await nextNumber(tx, t.quote, t.quote.number, t.quote.companyId, cid, numQuote)
      const [created] = await tx.insert(t.quote).values(values).returning()
      const items = data.lineItems.length ? await tx.insert(t.quoteLineItem).values(toRow(data.lineItems, created.id)).returning() : []
      return { ...created, lineItems: items }
    })
    emitToCompany(cid, EVENTS.QUOTE_CREATED, result)
    return c.json(result, 201)
  })

  // ---------------------------------------------------------------- update
  app.put('/:id', requirePermission('quotes:update'), async (c) => {
    const currentUser = c.get('user') as any
    const cid = currentUser.companyId
    const id = c.req.param('id')
    const data = quoteSchema.partial().parse(await c.req.json()) as any
    const existing = await findOwn(cid, id)
    if (!existing) return c.json({ error: 'Quote not found' }, 404)
    // Once a customer has approved (or declined) a quote it is a record, not a draft. Signed acceptances must not be mutable.
    if (!EDITABLE.includes(existing.status)) return c.json({ error: 'Only draft or sent quotes can be edited' }, 400)
    if (data.contactId && !(await ownContact(cid, data.contactId))) return c.json({ error: 'That client does not exist.' }, 404)
    if (data.projectId && !(await ownProject(cid, data.projectId))) return c.json({ error: 'That project does not exist.' }, 404)
    const exp = normalizeDateInput(data.expiryDate)
    if (exp.error) return c.json({ error: `Expiry date: ${exp.error}` }, 400)
    const update: Record<string, any> = { updatedAt: new Date() }
    for (const k of COPY_FIELDS) if (data[k] !== undefined) update[k] = data[k]
    if (exp.value !== undefined) update.expiryDate = exp.value
    // status may move between draft and sent from the editor; approvals go through their own routes
    if (data.status && EDITABLE.includes(data.status) && data.status !== existing.status) { update.status = data.status; if (data.status === 'sent') update.sentAt = new Date() }
    const recompute = data.lineItems !== undefined || data.taxRate !== undefined || data.discount !== undefined
    if (recompute) {
      const lines: z.infer<typeof lineItemSchema>[] = data.lineItems ?? (await lineRows(id)).map((li: any) => ({ description: li.description, quantity: Number(li.quantity), unitPrice: Number(li.unitPrice) }))
      const taxRate = data.taxRate ?? Number(existing.taxRate)
      const discount = data.discount ?? Number(existing.discount)
      const subtotalRaw = rawSubtotal(lines)
      if (discount > subtotalRaw + 0.005) return c.json({ error: `Discount cannot exceed the subtotal (${subtotalRaw.toFixed(2)}).` }, 400)
      const calc = calcTotals(lines, taxRate, discount)
      Object.assign(update, { subtotal: calc.subtotal.toString(), taxRate: String(taxRate), taxAmount: calc.taxAmount.toString(), discount: calc.effectiveDiscount.toString(), total: calc.total.toString() })
    }
    const result = await db.transaction(async (tx: any) => {
      const [updated] = await tx.update(t.quote).set(update).where(eq(t.quote.id, id)).returning()
      let items: any[]
      if (data.lineItems !== undefined) {
        await tx.delete(t.quoteLineItem).where(eq(t.quoteLineItem.quoteId, id))
        items = data.lineItems.length ? await tx.insert(t.quoteLineItem).values(toRow(data.lineItems, id)).returning() : []
      } else items = await lineRows(id)
      return { ...updated, lineItems: items }
    })
    emitToCompany(cid, EVENTS.QUOTE_UPDATED, result)
    return c.json(result)
  })

  // ---------------------------------------------------------------- delete
  app.delete('/:id', requirePermission('quotes:delete'), async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const existing = await findOwn(currentUser.companyId, id)
    if (!existing) return c.json({ error: 'Quote not found' }, 404)
    if (existing.status !== 'draft') return c.json({ error: 'Only draft quotes can be deleted' }, 400)
    await db.delete(t.quote).where(eq(t.quote.id, id))
    return c.body(null, 204)
  })

  // ---------------------------------------------------------------- lifecycle
  const setStatus = async (c: any, id: string, patch: Record<string, any>, allowedFrom: string[] | null, event?: string, extraPayload?: (q: any) => Record<string, any>) => {
    const currentUser = c.get('user') as any
    const cid = currentUser.companyId
    const existing = await findOwn(cid, id)
    if (!existing) return c.json({ error: 'Quote not found' }, 404)
    if (allowedFrom && !allowedFrom.includes(existing.status)) return c.json({ error: `A ${existing.status} quote cannot be ${patch.status}.` }, 400)
    const [updated] = await db.update(t.quote).set({ ...patch, updatedAt: new Date() }).where(and(eq(t.quote.id, id), eq(t.quote.companyId, cid))).returning()
    if (event) emitToCompany(cid, event, { id: updated.id, number: updated.number, ...(extraPayload ? extraPayload(updated) : {}) })
    return { updated, existing, cid }
  }

  app.post('/:id/send', requirePermission('quotes:update'), async (c) => {
    const r: any = await setStatus(c, c.req.param('id'), { status: 'sent', sentAt: new Date() }, ['draft', 'sent'], EVENTS.QUOTE_SENT)
    if (!r.updated) return r
    if (o.onSent && r.updated.contactId) {
      const [ct] = await db.select().from(t.contact).where(and(eq(t.contact.id, r.updated.contactId), eq(t.contact.companyId, r.cid))).limit(1)
      const [co] = await db.select().from(t.company).where(eq(t.company.id, r.cid)).limit(1)
      if (ct) o.onSent({ companyId: r.cid, quote: r.updated, contact: ct, company: co }).catch(() => {})
    }
    return c.json(r.updated)
  })
  app.post('/:id/approve', requirePermission('quotes:update'), async (c) => {
    const r: any = await setStatus(c, c.req.param('id'), { status: 'approved', approvedAt: new Date() }, ['draft', 'sent', 'approved'], EVENTS.QUOTE_APPROVED, q => ({ total: q.total }))
    return r.updated ? c.json(r.updated) : r
  })
  app.post('/:id/reject', requirePermission('quotes:update'), async (c) => {
    const r: any = await setStatus(c, c.req.param('id'), { status: 'rejected', ...(o.hasDeclinedAt ? { declinedAt: new Date() } : {}) }, ['draft', 'sent', 'rejected'])
    return r.updated ? c.json(r.updated) : r
  })
  if (o.hasDeclinedAt) {
    app.post('/:id/decline', requirePermission('quotes:update'), async (c) => {
      const r: any = await setStatus(c, c.req.param('id'), { status: 'declined', declinedAt: new Date() }, ['draft', 'sent', 'declined'])
      return r.updated ? c.json(r.updated) : r
    })
  }

  // ---------------------------------------------------------------- convert → invoice
  if (conversions.has('invoice')) {
    app.post('/:id/convert-to-invoice', requirePermission('invoices:create'), async (c) => {
      const currentUser = c.get('user') as any
      const cid = currentUser.companyId
      const id = c.req.param('id')
      const found = await findOwn(cid, id)
      if (!found) return c.json({ error: 'Quote not found' }, 404)
      if (['rejected', 'declined', 'expired'].includes(found.status)) return c.json({ error: `A ${found.status} quote cannot be converted to an invoice.` }, 400)
      const [already] = await db.select({ id: t.invoice.id, number: t.invoice.number }).from(t.invoice).where(and(eq(t.invoice.quoteId, id), eq(t.invoice.companyId, cid))).limit(1)
      if (already) return c.json({ error: `This quote was already converted to invoice ${already.number}.`, invoiceId: already.id }, 400)
      const items = await lineRows(id)
      const settings = await companySettings(cid)
      const result = await db.transaction(async (tx: any) => {
        const number = await nextNumber(tx, t.invoice, t.invoice.number, t.invoice.companyId, cid, numInvoice)
        const [inv] = await tx.insert(t.invoice).values({
          number, contactId: found.contactId, projectId: found.projectId, quoteId: found.id,
          subtotal: found.subtotal, taxRate: found.taxRate, taxAmount: found.taxAmount, discount: found.discount, total: found.total, amountPaid: '0',
          dueDate: dueDateFromTerms(settings), notes: found.notes, terms: found.terms, companyId: cid,
        }).returning()
        const lines = items.length ? await tx.insert(t.invoiceLineItem).values(items.map((li: any) => ({ description: li.description, quantity: li.quantity, unitPrice: li.unitPrice, total: li.total, sortOrder: li.sortOrder, invoiceId: inv.id }))).returning() : []
        return { ...inv, lineItems: lines }
      })
      emitToCompany(cid, EVENTS.INVOICE_CREATED, result)
      return c.json(result, 201)
    })
  }

  // ---------------------------------------------------------------- convert → job
  if (conversions.has('job')) {
    app.post('/:id/convert-to-job', requirePermission('jobs:create'), async (c) => {
      const currentUser = c.get('user') as any
      const cid = currentUser.companyId
      const id = c.req.param('id')
      const found = await findOwn(cid, id)
      if (!found) return c.json({ error: 'Quote not found' }, 404)
      if (found.status !== 'approved') return c.json({ error: 'Only approved quotes can be converted to jobs' }, 400)
      const [existingJob] = o.hasConvertedToJobId && found.convertedToJobId
        ? [{ id: found.convertedToJobId }]
        : await db.select({ id: t.job.id }).from(t.job).where(and(eq(t.job.quoteId, id), eq(t.job.companyId, cid))).limit(1)
      if (existingJob) return c.json({ error: 'Quote already converted to a job', jobId: existingJob.id }, 400)
      const items = await lineRows(id)
      const description = items.map((li: any) => `${li.description} (${Number(li.quantity)} × $${Number(li.unitPrice).toFixed(2)})`).join('\n')
      // Service address: the quote's site when the vertical has sites, else the contact's address.
      let address = '', city = '', state = '', zip = ''
      let src: any = null
      if (extra.has('siteId') && t.site && found.siteId) src = (await db.select().from(t.site).where(and(eq(t.site.id, found.siteId), eq(t.site.companyId, cid))).limit(1))[0]
      if (!src && found.contactId) src = (await db.select().from(t.contact).where(and(eq(t.contact.id, found.contactId), eq(t.contact.companyId, cid))).limit(1))[0]
      if (src) { address = src.address || ''; city = src.city || ''; state = src.state || ''; zip = src.zip || '' }
      const result = await db.transaction(async (tx: any) => {
        const number = await nextNumber(tx, t.job, t.job.number, t.job.companyId, cid, numJob)
        const values: any = {
          number, title: found.name, description, status: 'scheduled', priority: 'normal', estimatedValue: found.total,
          address, city, state, zip, notes: `Converted from Quote ${found.number}`,
          contactId: found.contactId, projectId: found.projectId, quoteId: found.id, createdById: currentUser.userId, companyId: cid,
        }
        if (o.jobHasSiteAndEquipment) { values.equipmentId = found.equipmentId || null; values.siteId = found.siteId || null }
        const [newJob] = await tx.insert(t.job).values(values).returning()
        if (o.hasConvertedToJobId) await tx.update(t.quote).set({ convertedToJobId: newJob.id, updatedAt: new Date() }).where(eq(t.quote.id, id))
        return newJob
      })
      const [pr, ct] = await Promise.all([
        result.projectId ? db.select({ id: t.project.id, name: t.project.name }).from(t.project).where(eq(t.project.id, result.projectId)).limit(1) : Promise.resolve([]),
        result.contactId ? db.select({ id: t.contact.id, name: t.contact.name }).from(t.contact).where(eq(t.contact.id, result.contactId)).limit(1) : Promise.resolve([]),
      ])
      const out = { ...result, project: pr[0] || null, contact: ct[0] || null }
      emitToCompany(cid, EVENTS.JOB_CREATED, out)
      return c.json(out, 201)
    })
  }

  // ---------------------------------------------------------------- pdf
  app.get('/:id/pdf', requirePermission('quotes:read'), async (c) => {
    const currentUser = c.get('user') as any
    const cid = currentUser.companyId
    const id = c.req.param('id')
    const generateQuotePDF = await loadPdf()
    const found = await findOwn(cid, id)
    if (!found) return c.json({ error: 'Quote not found' }, 404)
    const [ct, lineItems, [co]] = await Promise.all([
      found.contactId ? db.select().from(t.contact).where(and(eq(t.contact.id, found.contactId), eq(t.contact.companyId, cid))).limit(1) : Promise.resolve([]),
      lineRows(id),
      db.select().from(t.company).where(eq(t.company.id, cid)),
    ])
    const pdfBuffer = await generateQuotePDF({ ...found, contact: ct[0] || null, lineItems }, co)
    return new Response(pdfBuffer, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="quote-${found.number}.pdf"` } })
  })

  return app
}
