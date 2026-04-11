import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { quote, contact, job, company } from '../../db/schema.ts'
import { eq, and, desc, count, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().default(1),
  unitPrice: z.number().default(0),
})

const quoteSchema = z.object({
  contactId: z.string().min(1),
  jobId: z.string().optional().transform(v => v === '' ? undefined : v),
  lineItems: z.array(lineItemSchema).min(1),
  taxRate: z.number().default(0),
  notes: z.string().optional(),
  customerMessage: z.string().optional(),
  expiresAt: z.string().optional(),
})

const calcTotals = (items: { quantity: number; unitPrice: number }[], taxRate: number) => {
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const taxAmount = subtotal * (taxRate / 100)
  return { subtotal, taxAmount, total: subtotal + taxAmount }
}

// List quotes
app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const contactId = c.req.query('contactId')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  const conditions: any[] = [eq(quote.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(quote.status, status))
  if (contactId) conditions.push(eq(quote.contactId, contactId))

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(quote).where(where).orderBy(desc(quote.createdAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(quote).where(where),
  ])

  // Fetch contacts
  const contactIds = [...new Set(data.filter(q => q.contactId).map(q => q.contactId))]
  const contacts = contactIds.length
    ? await db.select({ id: contact.id, firstName: contact.firstName, lastName: contact.lastName }).from(contact).where(eq(contact.companyId, currentUser.companyId))
    : []
  const contactMap = Object.fromEntries(contacts.map(ct => [ct.id, ct]))

  // Fetch jobs for job number display
  const jobIds = [...new Set(data.filter(q => q.jobId).map(q => q.jobId))]
  const jobs = jobIds.length
    ? await db.select({ id: job.id, jobNumber: job.jobNumber }).from(job).where(eq(job.companyId, currentUser.companyId))
    : []
  const jobMap = Object.fromEntries(jobs.map(j => [j.id, j]))

  const dataWithRelations = data.map(q => ({
    ...q,
    contact: q.contactId ? contactMap[q.contactId] || null : null,
    job: q.jobId ? jobMap[q.jobId] || null : null,
  }))

  return c.json({ data: dataWithRelations, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

// Create quote with auto quoteNumber
app.post('/', async (c) => {
  const currentUser = c.get('user') as any
  const data = quoteSchema.parse(await c.req.json())

  // Auto-generate quoteNumber: Q-0001
  const [maxResult] = await db
    .select({ maxNum: sql<string>`MAX(${quote.quoteNumber})` })
    .from(quote)
    .where(eq(quote.companyId, currentUser.companyId))

  let nextNum = 1
  if (maxResult?.maxNum) {
    const match = maxResult.maxNum.match(/Q-(\d+)/)
    if (match) nextNum = parseInt(match[1], 10) + 1
  }
  const quoteNumber = `Q-${String(nextNum).padStart(4, '0')}`

  const totals = calcTotals(data.lineItems, data.taxRate)

  const [newQuote] = await db.insert(quote).values({
    companyId: currentUser.companyId,
    contactId: data.contactId,
    jobId: data.jobId || null,
    quoteNumber,
    lineItems: data.lineItems.map(item => ({
      ...item,
      total: item.quantity * item.unitPrice,
    })),
    subtotal: totals.subtotal.toString(),
    taxRate: (data.taxRate / 100).toString(),
    taxAmount: totals.taxAmount.toString(),
    total: totals.total.toString(),
    notes: data.notes,
    customerMessage: data.customerMessage,
    expiresAt: data.expiresAt ? new Date(data.expiresAt) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  }).returning()

  return c.json(newQuote, 201)
})

// Get quote detail
app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [foundQuote] = await db.select().from(quote)
    .where(and(eq(quote.id, id), eq(quote.companyId, currentUser.companyId)))
    .limit(1)
  if (!foundQuote) return c.json({ error: 'Quote not found' }, 404)

  const [quoteContact] = foundQuote.contactId
    ? await db.select().from(contact).where(eq(contact.id, foundQuote.contactId)).limit(1)
    : [null]

  return c.json({ ...foundQuote, contact: quoteContact || null })
})

// Update quote
app.put('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = quoteSchema.partial().parse(await c.req.json())

  const [existing] = await db.select().from(quote)
    .where(and(eq(quote.id, id), eq(quote.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Quote not found' }, 404)

  const updateData: Record<string, any> = { updatedAt: new Date() }
  if (data.contactId) updateData.contactId = data.contactId
  if (data.jobId !== undefined) updateData.jobId = data.jobId || null
  if (data.notes !== undefined) updateData.notes = data.notes
  if (data.customerMessage !== undefined) updateData.customerMessage = data.customerMessage
  if (data.expiresAt) updateData.expiresAt = new Date(data.expiresAt)

  if (data.lineItems) {
    const taxRate = data.taxRate ?? (Number(existing.taxRate) * 100)
    const totals = calcTotals(data.lineItems, taxRate)
    updateData.lineItems = data.lineItems.map(item => ({ ...item, total: item.quantity * item.unitPrice }))
    updateData.subtotal = totals.subtotal.toString()
    updateData.taxRate = (taxRate / 100).toString()
    updateData.taxAmount = totals.taxAmount.toString()
    updateData.total = totals.total.toString()
  }

  const [updated] = await db.update(quote).set(updateData).where(eq(quote.id, id)).returning()
  return c.json(updated)
})

// Send quote
app.post('/:id/send', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(quote)
    .where(and(eq(quote.id, id), eq(quote.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Quote not found' }, 404)

  const [updated] = await db.update(quote).set({ status: 'sent', updatedAt: new Date() }).where(eq(quote.id, id)).returning()
  return c.json(updated)
})

// Approve quote
app.post('/:id/approve', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(quote)
    .where(and(eq(quote.id, id), eq(quote.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Quote not found' }, 404)

  const [updated] = await db.update(quote).set({
    status: 'approved',
    approvedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(quote.id, id)).returning()

  return c.json(updated)
})

// Decline quote
app.post('/:id/decline', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [existing] = await db.select().from(quote)
    .where(and(eq(quote.id, id), eq(quote.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Quote not found' }, 404)

  const [updated] = await db.update(quote).set({
    status: 'declined',
    declinedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(quote.id, id)).returning()

  return c.json(updated)
})

// Convert quote to job
app.post('/:id/convert', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [foundQuote] = await db.select().from(quote)
    .where(and(eq(quote.id, id), eq(quote.companyId, currentUser.companyId)))
    .limit(1)
  if (!foundQuote) return c.json({ error: 'Quote not found' }, 404)
  if (foundQuote.convertedToJobId) return c.json({ error: 'Quote already converted to a job' }, 400)

  // Get contact for address info
  const [contactRow] = await db.select().from(contact).where(eq(contact.id, foundQuote.contactId)).limit(1)

  // Generate job number
  const [maxResult] = await db
    .select({ maxNum: sql<string>`MAX(${job.jobNumber})` })
    .from(job)
    .where(eq(job.companyId, currentUser.companyId))

  let nextNum = 1
  if (maxResult?.maxNum) {
    const match = maxResult.maxNum.match(/ROOF-(\d+)/)
    if (match) nextNum = parseInt(match[1], 10) + 1
  }
  const jobNumber = `ROOF-${String(nextNum).padStart(4, '0')}`

  const [newJob] = await db.insert(job).values({
    companyId: currentUser.companyId,
    contactId: foundQuote.contactId,
    jobNumber,
    jobType: 'replacement',
    status: 'lead',
    propertyAddress: contactRow?.address || '',
    city: contactRow?.city || '',
    state: contactRow?.state || '',
    zip: contactRow?.zip || '',
    estimatedRevenue: foundQuote.total,
    source: 'quote_conversion',
    notes: `Converted from Quote ${foundQuote.quoteNumber}`,
  }).returning()

  // Link quote back to job
  await db.update(quote).set({ convertedToJobId: newJob.id, updatedAt: new Date() }).where(eq(quote.id, id))

  return c.json(newJob, 201)
})

// Generate PDF
app.get('/:id/pdf', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [foundQuote] = await db.select().from(quote)
    .where(and(eq(quote.id, id), eq(quote.companyId, currentUser.companyId)))
    .limit(1)
  if (!foundQuote) return c.json({ error: 'Quote not found' }, 404)

  const [[quoteContact], [foundCompany]] = await Promise.all([
    foundQuote.contactId ? db.select().from(contact).where(eq(contact.id, foundQuote.contactId)).limit(1) : Promise.resolve([null]),
    db.select().from(company).where(eq(company.id, currentUser.companyId)),
  ])

  // Generate PDF with pdfkit
  const PDFDocument = (await import('pdfkit')).default
  const doc = new PDFDocument({ margin: 50 })
  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))

  const pdfReady = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
  })

  // Header
  doc.fontSize(20).text(foundCompany?.name || 'Company', { align: 'center' })
  doc.moveDown(0.5)
  doc.fontSize(14).text(`Quote ${foundQuote.quoteNumber}`, { align: 'center' })
  doc.moveDown()

  // Company info
  if (foundCompany) {
    doc.fontSize(10)
    if (foundCompany.address) doc.text(foundCompany.address)
    const cityLine = [foundCompany.city, foundCompany.state, foundCompany.zip].filter(Boolean).join(', ')
    if (cityLine) doc.text(cityLine)
    if (foundCompany.phone) doc.text(`Phone: ${foundCompany.phone}`)
    if (foundCompany.email) doc.text(`Email: ${foundCompany.email}`)
  }
  doc.moveDown()

  // Customer info
  if (quoteContact) {
    doc.fontSize(12).text('Bill To:', { underline: true })
    doc.fontSize(10)
    doc.text(`${quoteContact.firstName} ${quoteContact.lastName}`)
    if (quoteContact.email) doc.text(quoteContact.email)
    if (quoteContact.phone) doc.text(quoteContact.phone)
    if (quoteContact.address) doc.text(quoteContact.address)
    const custCity = [quoteContact.city, quoteContact.state, quoteContact.zip].filter(Boolean).join(', ')
    if (custCity) doc.text(custCity)
  }
  doc.moveDown()

  // Line items table
  const lineItems = foundQuote.lineItems as any[]
  doc.fontSize(12).text('Line Items:', { underline: true })
  doc.moveDown(0.5)

  // Table header
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
    doc.fontSize(9)
    doc.text(item.description, 50, y, { width: 250 })
    doc.text(String(item.quantity), 310, y, { width: 50, align: 'right' })
    doc.text(`$${Number(item.unitPrice).toFixed(2)}`, 370, y, { width: 80, align: 'right' })
    doc.text(`$${Number(item.total || item.quantity * item.unitPrice).toFixed(2)}`, 460, y, { width: 80, align: 'right' })
    y += 18
  }

  // Totals
  doc.moveTo(350, y + 5).lineTo(540, y + 5).stroke()
  y += 12

  doc.fontSize(10)
  doc.text('Subtotal:', 370, y, { width: 80, align: 'right' })
  doc.text(`$${Number(foundQuote.subtotal).toFixed(2)}`, 460, y, { width: 80, align: 'right' })
  y += 18

  doc.text('Tax:', 370, y, { width: 80, align: 'right' })
  doc.text(`$${Number(foundQuote.taxAmount).toFixed(2)}`, 460, y, { width: 80, align: 'right' })
  y += 18

  doc.font('Helvetica-Bold')
  doc.text('Total:', 370, y, { width: 80, align: 'right' })
  doc.text(`$${Number(foundQuote.total).toFixed(2)}`, 460, y, { width: 80, align: 'right' })

  // Notes
  if (foundQuote.notes) {
    doc.moveDown(2)
    doc.font('Helvetica').fontSize(10)
    doc.text('Notes:', { underline: true })
    doc.text(foundQuote.notes)
  }

  if (foundQuote.customerMessage) {
    doc.moveDown()
    doc.text('Message:', { underline: true })
    doc.text(foundQuote.customerMessage)
  }

  doc.end()
  const pdfBuffer = await pdfReady

  return new Response(pdfBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="quote-${foundQuote.quoteNumber}.pdf"`,
    },
  })
})

export default app
