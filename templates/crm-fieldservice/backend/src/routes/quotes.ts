import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { quote, quoteLineItem, contact, project, invoice, invoiceLineItem, company } from '../../db/schema.ts'
import { eq, and, count, desc, asc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'

const app = new Hono()
app.use('*', authenticate)

const lineItemSchema = z.object({ description: z.string().min(1), quantity: z.number().default(1), unitPrice: z.number().default(0) })
const quoteSchema = z.object({
  name: z.string().min(1),
  contactId: z.string().optional().transform(v => v === '' ? undefined : v),
  projectId: z.string().optional().transform(v => v === '' ? undefined : v),
  expiryDate: z.string().optional(),
  taxRate: z.number().default(0),
  discount: z.number().default(0),
  notes: z.string().optional(),
  terms: z.string().optional(),
  lineItems: z.array(lineItemSchema).default([]),
})

const calcTotals = (items: { quantity: number; unitPrice: number }[], taxRate: number, discount: number) => {
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const taxAmount = subtotal * (taxRate / 100)
  return { subtotal, taxAmount, total: subtotal + taxAmount - discount }
}

app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const contactId = c.req.query('contactId')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const conditions = [eq(quote.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(quote.status, status))
  if (contactId) conditions.push(eq(quote.contactId, contactId))

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(quote).where(where).orderBy(desc(quote.createdAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(quote).where(where),
  ])

  // Fetch contacts and line items
  const quoteIds = data.map(q => q.id)
  const contactIds = [...new Set(data.filter(q => q.contactId).map(q => q.contactId!))]

  const [contacts, lineItems] = await Promise.all([
    contactIds.length ? db.select({ id: contact.id, name: contact.name }).from(contact).where(eq(contact.companyId, currentUser.companyId)) : Promise.resolve([]),
    quoteIds.length ? db.select().from(quoteLineItem).where(eq(quoteLineItem.quoteId, quoteIds[0]!)).then(async () => {
      // Fetch all line items for all quotes
      const allItems: (typeof quoteLineItem.$inferSelect)[] = []
      for (const qid of quoteIds) {
        const items = await db.select().from(quoteLineItem).where(eq(quoteLineItem.quoteId, qid))
        allItems.push(...items)
      }
      return allItems
    }) : Promise.resolve([]),
  ])

  const contactMap = Object.fromEntries(contacts.map(ct => [ct.id, ct]))
  const lineItemMap: Record<string, (typeof quoteLineItem.$inferSelect)[]> = {}
  lineItems.forEach(li => { (lineItemMap[li.quoteId] ||= []).push(li) })

  const dataWithRelations = data.map(q => ({
    ...q,
    contact: q.contactId ? contactMap[q.contactId] || null : null,
    lineItems: lineItemMap[q.id] || [],
  }))

  return c.json({ data: dataWithRelations, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

app.get('/stats', async (c) => {
  const currentUser = c.get('user') as any
  const quotes = await db.select({ status: quote.status, total: quote.total }).from(quote).where(eq(quote.companyId, currentUser.companyId))
  const stats: Record<string, number> = { total: quotes.length, draft: 0, sent: 0, approved: 0, rejected: 0, totalValue: 0, approvedValue: 0 }
  quotes.forEach(q => { stats[q.status] = (stats[q.status] || 0) + 1; stats.totalValue += Number(q.total); if (q.status === 'approved') stats.approvedValue += Number(q.total) })
  return c.json(stats)
})

app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [foundQuote] = await db.select().from(quote).where(and(eq(quote.id, id), eq(quote.companyId, currentUser.companyId))).limit(1)
  if (!foundQuote) return c.json({ error: 'Quote not found' }, 404)

  const [quoteContact, quoteProject, lineItems] = await Promise.all([
    foundQuote.contactId ? db.select().from(contact).where(eq(contact.id, foundQuote.contactId)).limit(1) : Promise.resolve([]),
    foundQuote.projectId ? db.select().from(project).where(eq(project.id, foundQuote.projectId)).limit(1) : Promise.resolve([]),
    db.select().from(quoteLineItem).where(eq(quoteLineItem.quoteId, id)).orderBy(asc(quoteLineItem.sortOrder)),
  ])

  return c.json({ ...foundQuote, contact: quoteContact[0] || null, project: quoteProject[0] || null, lineItems })
})

app.post('/', async (c) => {
  const currentUser = c.get('user') as any
  const data = quoteSchema.parse(await c.req.json())
  const { lineItems, ...quoteData } = data
  const totals = calcTotals(lineItems, data.taxRate, data.discount)

  const [{ value: cnt }] = await db.select({ value: count() }).from(quote).where(eq(quote.companyId, currentUser.companyId))

  const [newQuote] = await db.insert(quote).values({
    ...quoteData,
    ...{ subtotal: totals.subtotal.toString(), taxAmount: totals.taxAmount.toString(), total: totals.total.toString(), taxRate: quoteData.taxRate.toString(), discount: quoteData.discount.toString() },
    number: `QTE-${String(Number(cnt) + 1).padStart(5, '0')}`,
    expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
    companyId: currentUser.companyId,
  }).returning()

  // Insert line items
  const insertedLineItems = lineItems.length > 0
    ? await db.insert(quoteLineItem).values(lineItems.map((item, i) => ({
        ...item,
        quantity: item.quantity.toString(),
        unitPrice: item.unitPrice.toString(),
        total: (item.quantity * item.unitPrice).toString(),
        sortOrder: i,
        quoteId: newQuote.id,
      }))).returning()
    : []

  const result = { ...newQuote, lineItems: insertedLineItems }
  emitToCompany(currentUser.companyId, EVENTS.QUOTE_CREATED, result)
  return c.json(result, 201)
})

app.put('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = quoteSchema.partial().parse(await c.req.json())

  const [existing] = await db.select().from(quote).where(and(eq(quote.id, id), eq(quote.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Quote not found' }, 404)

  const { lineItems, ...quoteData } = data
  let totals: Record<string, string> = {}
  if (lineItems) {
    await db.delete(quoteLineItem).where(eq(quoteLineItem.quoteId, id))
    const calc = calcTotals(lineItems, data.taxRate ?? Number(existing.taxRate), data.discount ?? Number(existing.discount))
    totals = { subtotal: calc.subtotal.toString(), taxAmount: calc.taxAmount.toString(), total: calc.total.toString() }
  }

  const updateData: Record<string, any> = { ...quoteData, ...totals, updatedAt: new Date() }
  if (quoteData.taxRate !== undefined) updateData.taxRate = quoteData.taxRate.toString()
  if (quoteData.discount !== undefined) updateData.discount = quoteData.discount.toString()
  if (data.expiryDate) updateData.expiryDate = new Date(data.expiryDate)

  const [updated] = await db.update(quote).set(updateData).where(eq(quote.id, id)).returning()

  let insertedLineItems: (typeof quoteLineItem.$inferSelect)[] = []
  if (lineItems && lineItems.length > 0) {
    insertedLineItems = await db.insert(quoteLineItem).values(lineItems.map((item, i) => ({
      ...item,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
      total: (item.quantity * item.unitPrice).toString(),
      sortOrder: i,
      quoteId: id,
    }))).returning()
  }

  const result = { ...updated, lineItems: insertedLineItems.length > 0 ? insertedLineItems : await db.select().from(quoteLineItem).where(eq(quoteLineItem.quoteId, id)) }
  emitToCompany(currentUser.companyId, EVENTS.QUOTE_UPDATED, result)
  return c.json(result)
})

app.delete('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(quote).where(and(eq(quote.id, id), eq(quote.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Quote not found' }, 404)

  await db.delete(quote).where(eq(quote.id, id))
  return c.body(null, 204)
})

app.post('/:id/send', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [updated] = await db.update(quote).set({ status: 'sent', sentAt: new Date(), updatedAt: new Date() }).where(eq(quote.id, id)).returning()
  emitToCompany(currentUser.companyId, EVENTS.QUOTE_SENT, { id: updated.id, number: updated.number })
  return c.json(updated)
})

app.post('/:id/approve', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [updated] = await db.update(quote).set({ status: 'approved', approvedAt: new Date(), updatedAt: new Date() }).where(eq(quote.id, id)).returning()
  emitToCompany(currentUser.companyId, EVENTS.QUOTE_APPROVED, { id: updated.id, number: updated.number, total: updated.total })
  return c.json(updated)
})

app.post('/:id/reject', async (c) => {
  const id = c.req.param('id')
  const [updated] = await db.update(quote).set({ status: 'rejected', updatedAt: new Date() }).where(eq(quote.id, id)).returning()
  return c.json(updated)
})

app.post('/:id/convert-to-invoice', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [foundQuote] = await db.select().from(quote).where(and(eq(quote.id, id), eq(quote.companyId, currentUser.companyId))).limit(1)
  if (!foundQuote) return c.json({ error: 'Quote not found' }, 404)

  const quoteItems = await db.select().from(quoteLineItem).where(eq(quoteLineItem.quoteId, id))
  const [{ value: cnt }] = await db.select({ value: count() }).from(invoice).where(eq(invoice.companyId, currentUser.companyId))

  const [newInvoice] = await db.insert(invoice).values({
    number: `INV-${String(Number(cnt) + 1).padStart(5, '0')}`,
    contactId: foundQuote.contactId,
    projectId: foundQuote.projectId,
    quoteId: foundQuote.id,
    subtotal: foundQuote.subtotal,
    taxRate: foundQuote.taxRate,
    taxAmount: foundQuote.taxAmount,
    discount: foundQuote.discount,
    total: foundQuote.total,
    amountPaid: '0',
    notes: foundQuote.notes,
    terms: foundQuote.terms,
    companyId: currentUser.companyId,
  }).returning()

  const insertedLineItems = quoteItems.length > 0
    ? await db.insert(invoiceLineItem).values(quoteItems.map(item => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.total,
        sortOrder: item.sortOrder,
        invoiceId: newInvoice.id,
      }))).returning()
    : []

  const result = { ...newInvoice, lineItems: insertedLineItems }
  emitToCompany(currentUser.companyId, EVENTS.INVOICE_CREATED, result)
  return c.json(result, 201)
})

// PDF download
app.get('/:id/pdf', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const { generateQuotePDF } = await import('../services/pdf.ts')
  const [foundQuote] = await db.select().from(quote).where(and(eq(quote.id, id), eq(quote.companyId, currentUser.companyId))).limit(1)
  if (!foundQuote) return c.json({ error: 'Quote not found' }, 404)

  const [quoteContact, lineItems, [foundCompany]] = await Promise.all([
    foundQuote.contactId ? db.select().from(contact).where(eq(contact.id, foundQuote.contactId)).limit(1) : Promise.resolve([]),
    db.select().from(quoteLineItem).where(eq(quoteLineItem.quoteId, id)).orderBy(asc(quoteLineItem.sortOrder)),
    db.select().from(company).where(eq(company.id, currentUser.companyId)),
  ])

  const quoteWithRelations = { ...foundQuote, contact: quoteContact[0] || null, lineItems }
  const pdfBuffer = await generateQuotePDF(quoteWithRelations, foundCompany)

  return new Response(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="quote-${foundQuote.number}.pdf"`,
    },
  })
})

export default app
