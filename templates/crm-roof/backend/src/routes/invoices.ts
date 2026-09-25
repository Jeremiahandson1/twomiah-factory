import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { invoice, contact, job, company } from '../../db/schema.ts'
import { eq, and, ne, desc, count, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { businessToday, companyTimeZone, dueDateFromTerms } from '../shared/index.ts'

const app = new Hono()
app.use('*', authenticate)

/**
 * Roof keeps its own invoicing because its schema differs (line items are JSON on the row, there is no
 * payment table), but "what day is it and how long do we give them" is not roof-specific. These are the
 * shared helpers the rest of the fleet uses, so a change to the rule reaches roof too.
 *
 * Before this, both documents defaulted to `Date.now() + 30 days`: an instant rather than a calendar
 * day, thirty days regardless of what the company had configured, and the server's idea of today — so an
 * invoice raised after 19:00 Central fell due a day late. (Field Service T28 M4, applied to roof)
 */
const companyDates = async (companyId: string) => {
  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
  const settings = (co?.settings as any) || {}
  const today = businessToday(await companyTimeZone(db, companyId))
  return { settings, today }
}


const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().min(0, 'Quantity cannot be negative').default(1),
  unitPrice: z.number().min(0, 'Price cannot be negative').default(0),
})

const invoiceSchema = z.object({
  jobId: z.string().min(1),
  contactId: z.string().min(1),
  lineItems: z.array(lineItemSchema).min(1),
  taxRate: z.number().default(0),
  notes: z.string().optional(),
  dueDate: z.string().optional(),
})

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const calcTotals = (items: { quantity: number; unitPrice: number }[], taxRate: number) => {
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const taxAmount = round2(subtotal * (Math.max(0, taxRate) / 100))
  return { subtotal, taxAmount, total: round2(subtotal + taxAmount) }
}

// List invoices
/**
 * H3: what the business actually billed, collected and is still owed.
 *
 * Reports showed a single "Revenue" tile computed from job.finalRevenue/estimatedRevenue/rcv — which
 * is PIPELINE VALUE, what the work is thought to be worth, not money. On the test tenant it read
 * $81,072 while $128,444.34 had been invoiced, $75,253.03 collected and $53,191.31 was outstanding.
 * Three different true numbers, none of them the one on screen.
 *
 * The definitions are the fleet's, not new ones (see scripts/check-refund-revenue.ts):
 *   billed      every invoice except draft and void — a refunded sale was still billed
 *   issued      billed, minus refunded — a refunded invoice owes nothing, so it cannot be outstanding
 *
 * Declared before '/:id' so the path is not swallowed as an invoice id.
 */
app.get('/summary', async (c) => {
  const currentUser = c.get('user') as any
  const BILLED = ['void', 'draft']
  const billed = sql`${invoice.status} NOT IN ('void', 'draft')`
  const issued = sql`${invoice.status} NOT IN ('void', 'draft', 'refunded')`

  const [billedRow] = await db
    .select({ invoiced: sql<string>`COALESCE(SUM(${invoice.total}), 0)`, collected: sql<string>`COALESCE(SUM(${invoice.amountPaid}), 0)`, count: count() })
    .from(invoice)
    .where(and(eq(invoice.companyId, currentUser.companyId), billed))

  const [issuedRow] = await db
    .select({ outstanding: sql<string>`COALESCE(SUM(${invoice.balance}), 0)` })
    .from(invoice)
    .where(and(eq(invoice.companyId, currentUser.companyId), issued))

  return c.json({
    invoiced: Number(billedRow?.invoiced ?? 0),
    collected: Number(billedRow?.collected ?? 0),
    outstanding: Number(issuedRow?.outstanding ?? 0),
    invoiceCount: Number(billedRow?.count ?? 0),
    excludedStatuses: BILLED,
  })
})

app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const unpaid = c.req.query('unpaid')
  const jobId = c.req.query('jobId')
  const contactId = c.req.query('contactId')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const conditions: any[] = [eq(invoice.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(invoice.status, status))
  // The Unpaid tab passes unpaid=true; without handling it here the tab showed
  // every invoice, so a just-paid one kept sitting in Unpaid.
  if (unpaid === 'true') conditions.push(ne(invoice.status, 'paid'))
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
  const { settings, today } = await companyDates(currentUser.companyId)
  // Both relations must be this company's — an unknown id used to surface as a foreign-key 500.
  const [ownContact] = await db.select({ id: contact.id }).from(contact).where(and(eq(contact.id, data.contactId), eq(contact.companyId, currentUser.companyId))).limit(1)
  if (!ownContact) return c.json({ error: 'That contact does not exist.' }, 404)
  const [ownJob] = await db.select({ id: job.id }).from(job).where(and(eq(job.id, data.jobId), eq(job.companyId, currentUser.companyId))).limit(1)
  if (!ownJob) return c.json({ error: 'That job does not exist.' }, 404)

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
    dueDate: data.dueDate ? new Date(data.dueDate) : dueDateFromTerms(settings, today),
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

  // Balance check and write happen in ONE transaction with the invoice row locked
  // (SELECT ... FOR UPDATE). Two payments sent at the same instant used to both read the
  // same balance, both pass the check and both write — the later write overwrote the
  // earlier, so $120 paid recorded only $60. The lock serialises them: the second waits,
  // re-reads the now-updated balance, and is rejected if it exceeds what's left.
  let outcome: { status: number; body: any } = { status: 500, body: { error: 'Payment failed' } }
  await db.transaction(async (tx: any) => {
    const locked: any = await tx.execute(sql`SELECT * FROM invoice WHERE id = ${id} AND company_id = ${currentUser.companyId} FOR UPDATE`)
    const row = (locked.rows || locked)[0]
    if (!row) { outcome = { status: 404, body: { error: 'Invoice not found' } }; return }

    // Don't accept a payment larger than what's owed (a fat-fingered 999,999 on
    // an $8,400 invoice went straight through).
    const balanceDue = Number(row.total) - Number(row.amount_paid)
    if (data.amount > balanceDue + 0.005) {
      outcome = { status: 400, body: { error: `Payment exceeds the balance due — $${balanceDue.toFixed(2)} remaining` } }
      return
    }

    const newAmountPaid = Number(row.amount_paid) + data.amount
    const newBalance = Number(row.total) - newAmountPaid
    const isPaidInFull = newBalance <= 0

    const [updated] = await tx.update(invoice).set({
      amountPaid: newAmountPaid.toString(),
      balance: Math.max(0, newBalance).toString(),
      status: isPaidInFull ? 'paid' : 'partial',
      paidAt: isPaidInFull ? new Date() : undefined,
      updatedAt: new Date(),
    }).where(eq(invoice.id, id)).returning()
    outcome = { status: 200, body: updated }
  })

  return c.json(outcome.body, outcome.status as any)
})

/**
 * Invoice PDF.
 *
 * The frontend API client has always exposed `invoices.downloadPdf()` pointing at this path, and
 * quotes have had a PDF since the module was built — this was the half that was never written, so the
 * link 404'd. (roof T17 L11)
 *
 * Built on the same pdfkit layout as the quote PDF so the two documents look like they come from the
 * same company. The one difference is what an invoice is FOR: it carries what has been paid and what
 * is still owed, which a quote has no concept of.
 */
app.get('/:id/pdf', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [foundInvoice] = await db.select().from(invoice)
    .where(and(eq(invoice.id, id), eq(invoice.companyId, currentUser.companyId)))
    .limit(1)
  if (!foundInvoice) return c.json({ error: 'Invoice not found' }, 404)

  const [[invoiceContact], [foundCompany]] = await Promise.all([
    foundInvoice.contactId ? db.select().from(contact).where(eq(contact.id, foundInvoice.contactId)).limit(1) : Promise.resolve([null]),
    db.select().from(company).where(eq(company.id, currentUser.companyId)),
  ])

  const PDFDocument = (await import('pdfkit')).default
  const doc = new PDFDocument({ margin: 50 })
  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const pdfReady = new Promise<Buffer>((resolve) => { doc.on('end', () => resolve(Buffer.concat(chunks))) })

  const money = (n: unknown) => `$${Number(n || 0).toFixed(2)}`

  // Header
  doc.fontSize(20).text(foundCompany?.name || 'Company', { align: 'center' })
  doc.moveDown(0.5)
  doc.fontSize(14).text(`Invoice ${foundInvoice.invoiceNumber}`, { align: 'center' })
  doc.moveDown()

  if (foundCompany) {
    doc.fontSize(10)
    if (foundCompany.address) doc.text(foundCompany.address)
    const cityLine = [foundCompany.city, foundCompany.state, foundCompany.zip].filter(Boolean).join(', ')
    if (cityLine) doc.text(cityLine)
    if (foundCompany.phone) doc.text(`Phone: ${foundCompany.phone}`)
    if (foundCompany.email) doc.text(`Email: ${foundCompany.email}`)
  }
  doc.moveDown()

  if (invoiceContact) {
    doc.fontSize(12).text('Bill To:', { underline: true })
    doc.fontSize(10)
    doc.text(`${invoiceContact.firstName} ${invoiceContact.lastName}`)
    if (invoiceContact.email) doc.text(invoiceContact.email)
    if (invoiceContact.phone) doc.text(invoiceContact.phone)
    if (invoiceContact.address) doc.text(invoiceContact.address)
    const custCity = [invoiceContact.city, invoiceContact.state, invoiceContact.zip].filter(Boolean).join(', ')
    if (custCity) doc.text(custCity)
  }
  doc.moveDown(0.5)
  if (foundInvoice.dueDate) {
    doc.fontSize(10).text(`Due: ${new Date(foundInvoice.dueDate as any).toLocaleDateString()}`)
  }
  doc.moveDown()

  // Line items
  const lineItems = Array.isArray(foundInvoice.lineItems) ? (foundInvoice.lineItems as any[]) : []
  doc.fontSize(12).text('Line Items:', { underline: true })
  doc.moveDown(0.5)

  const tableTop = doc.y
  doc.fontSize(9).font('Helvetica-Bold')
  doc.text('Description', 50, tableTop, { width: 250 })
  doc.text('Qty', 310, tableTop, { width: 50, align: 'right' })
  doc.text('Unit Price', 370, tableTop, { width: 80, align: 'right' })
  doc.text('Total', 460, tableTop, { width: 80, align: 'right' })
  doc.moveTo(50, tableTop + 15).lineTo(540, tableTop + 15).stroke()
  doc.font('Helvetica')

  let y = tableTop + 20
  for (const item of lineItems) {
    const qty = Number(item.quantity ?? item.qty ?? 0)
    const unitPrice = Number(item.unitPrice ?? item.unitCost ?? 0)
    doc.fontSize(9)
    doc.text(String(item.description ?? ''), 50, y, { width: 250 })
    doc.text(String(qty), 310, y, { width: 50, align: 'right' })
    doc.text(money(unitPrice), 370, y, { width: 80, align: 'right' })
    doc.text(money(item.total ?? qty * unitPrice), 460, y, { width: 80, align: 'right' })
    y += 18
  }

  doc.moveTo(350, y + 5).lineTo(540, y + 5).stroke()
  y += 12

  doc.fontSize(10)
  doc.text('Subtotal:', 370, y, { width: 80, align: 'right' })
  doc.text(money(foundInvoice.subtotal), 460, y, { width: 80, align: 'right' })
  y += 18
  doc.text('Tax:', 370, y, { width: 80, align: 'right' })
  doc.text(money(foundInvoice.taxAmount), 460, y, { width: 80, align: 'right' })
  y += 18

  doc.font('Helvetica-Bold')
  doc.text('Total:', 370, y, { width: 80, align: 'right' })
  doc.text(money(foundInvoice.total), 460, y, { width: 80, align: 'right' })
  y += 18

  // What an invoice has and a quote does not: what has been paid, and what is left.
  const paid = Number(foundInvoice.amountPaid || 0)
  // `balance` is a stored column that the payment and mark-paid routes maintain, so it is the figure
  // the rest of the product reports. Fall back to total − paid only if it was never set.
  const balance = foundInvoice.balance != null
    ? Math.max(0, Number(foundInvoice.balance))
    : Math.max(0, Number(foundInvoice.total || 0) - paid)
  doc.font('Helvetica')
  doc.text('Paid:', 370, y, { width: 80, align: 'right' })
  doc.text(`-${money(paid)}`, 460, y, { width: 80, align: 'right' })
  y += 18
  doc.font('Helvetica-Bold')
  doc.text(balance > 0 ? 'Balance Due:' : 'Paid in Full', 370, y, { width: 80, align: 'right' })
  doc.text(money(balance), 460, y, { width: 80, align: 'right' })

  // Notes now exist: the column was added in the same change that built this PDF. POST and PUT had
  // both been writing `notes` to a column that was never there, so anything typed was discarded.
  if (foundInvoice.notes) {
    doc.moveDown(2)
    doc.font('Helvetica').fontSize(10)
    doc.text('Notes:', { underline: true })
    doc.text(String(foundInvoice.notes))
  }

  doc.end()
  const pdfBuffer = await pdfReady

  return new Response(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${foundInvoice.invoiceNumber}.pdf"`,
    },
  })
})

export default app
