import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { invoices, invoiceLineItems, clients, timeEntries, clientAssignments, users } from '../../db/schema.ts'
import { eq, and, gte, lte, count, desc } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)

// ── INVOICES ──────────────────────────────────────────────────────

app.get('/invoices', async (c) => {
  const { paymentStatus, clientId, startDate, endDate, page = '1', limit = '50' } = c.req.query()
  const skip = (parseInt(page) - 1) * parseInt(limit)

  const conditions = []
  if (paymentStatus) conditions.push(eq(invoices.paymentStatus, paymentStatus))
  if (clientId) conditions.push(eq(invoices.clientId, clientId))
  if (startDate) conditions.push(gte(invoices.billingPeriodStart, startDate))
  if (endDate) conditions.push(lte(invoices.billingPeriodStart, endDate))

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const [rows, [{ value: total }]] = await Promise.all([
    db.select({
      invoice: invoices,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
    })
      .from(invoices)
      .leftJoin(clients, eq(invoices.clientId, clients.id))
      .where(where)
      .orderBy(desc(invoices.createdAt))
      .offset(skip)
      .limit(parseInt(limit)),
    db.select({ value: count() }).from(invoices).where(where),
  ])

  // Fetch line items for these invoices
  const invoiceIds = rows.map(r => r.invoice.id)
  const allLineItems = invoiceIds.length > 0
    ? await db.select().from(invoiceLineItems).where(
        invoiceIds.length === 1
          ? eq(invoiceLineItems.invoiceId, invoiceIds[0])
          : eq(invoiceLineItems.invoiceId, invoiceIds[0]) // fallback; use inArray below
      )
    : []

  // Actually use sql inArray for multiple ids
  const lineItemsByInvoice: Record<string, typeof allLineItems> = {}
  if (invoiceIds.length > 0) {
    const { inArray } = await import('drizzle-orm')
    const items = await db.select().from(invoiceLineItems).where(inArray(invoiceLineItems.invoiceId, invoiceIds))
    items.forEach(li => {
      if (!lineItemsByInvoice[li.invoiceId]) lineItemsByInvoice[li.invoiceId] = []
      lineItemsByInvoice[li.invoiceId].push(li)
    })
  }

  const invoicesResult = rows.map(r => ({
    ...r.invoice,
    client: { firstName: r.clientFirstName, lastName: r.clientLastName },
    lineItems: lineItemsByInvoice[r.invoice.id] || [],
  }))

  return c.json({ invoices: invoicesResult, total })
})

app.get('/invoices/:id', async (c) => {
  const id = c.req.param('id')
  const [row] = await db.select({
    invoice: invoices,
    client: clients,
  })
    .from(invoices)
    .leftJoin(clients, eq(invoices.clientId, clients.id))
    .where(eq(invoices.id, id))
    .limit(1)

  if (!row) return c.json({ error: 'Invoice not found' }, 404)

  const lineItems = await db.select({
    lineItem: invoiceLineItems,
    caregiverFirstName: users.firstName,
    caregiverLastName: users.lastName,
  })
    .from(invoiceLineItems)
    .leftJoin(users, eq(invoiceLineItems.caregiverId, users.id))
    .where(eq(invoiceLineItems.invoiceId, id))

  return c.json({
    ...row.invoice,
    client: row.client,
    lineItems: lineItems.map(li => ({
      ...li.lineItem,
      caregiver: { firstName: li.caregiverFirstName, lastName: li.caregiverLastName },
    })),
  })
})

app.post('/invoices', async (c) => {
  const { lineItems: lineItemsData, ...data } = await c.req.json()
  const [{ value: cnt }] = await db.select({ value: count() }).from(invoices)
  const invoiceNumber = `INV-${String(cnt + 1).padStart(5, '0')}`

  const [invoice] = await db.insert(invoices).values({ ...data, invoiceNumber }).returning()

  let createdLineItems: any[] = []
  if (lineItemsData && lineItemsData.length > 0) {
    createdLineItems = await db.insert(invoiceLineItems)
      .values(lineItemsData.map((li: any) => ({ ...li, invoiceId: invoice.id })))
      .returning()
  }

  return c.json({ ...invoice, lineItems: createdLineItems }, 201)
})

app.patch('/invoices/:id/status', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const [invoice] = await db.update(invoices)
    .set({
      paymentStatus: body.status,
      paymentDate: body.paymentDate ? body.paymentDate : undefined,
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, id))
    .returning()

  return c.json(invoice)
})

// ── GENERATE INVOICE FROM TIME ENTRIES ───────────────────────────

app.post('/invoices/generate', async (c) => {
  const { clientId, startDate, endDate } = await c.req.json()

  const entries = await db.select({
    entry: timeEntries,
    caregiverFirstName: users.firstName,
    caregiverLastName: users.lastName,
  })
    .from(timeEntries)
    .leftJoin(users, eq(timeEntries.caregiverId, users.id))
    .where(and(
      eq(timeEntries.clientId, clientId),
      gte(timeEntries.startTime, new Date(startDate)),
      lte(timeEntries.startTime, new Date(endDate)),
      eq(timeEntries.isComplete, true),
    ))

  if (!entries.length) return c.json({ error: 'No completed time entries in this period' }, 400)

  const [assignment] = await db.select()
    .from(clientAssignments)
    .where(and(eq(clientAssignments.clientId, clientId), eq(clientAssignments.status, 'active')))
    .limit(1)

  const rate = assignment?.payRate ? Number(assignment.payRate) : 25.00

  const lineItemsData = entries.map(e => ({
    caregiverId: e.entry.caregiverId,
    timeEntryId: e.entry.id,
    description: `${e.caregiverFirstName} ${e.caregiverLastName} - Care Visit`,
    hours: Number(((e.entry.billableMinutes || e.entry.durationMinutes || 0) / 60).toFixed(2)),
    rate: Number(rate),
    amount: Number((((e.entry.billableMinutes || e.entry.durationMinutes || 0) / 60) * Number(rate)).toFixed(2)),
  }))

  const subtotal = lineItemsData.reduce((s, l) => s + Number(l.amount), 0)
  const [{ value: cnt }] = await db.select({ value: count() }).from(invoices)

  const [invoice] = await db.insert(invoices).values({
    invoiceNumber: `INV-${String(cnt + 1).padStart(5, '0')}`,
    clientId,
    billingPeriodStart: startDate,
    billingPeriodEnd: endDate,
    subtotal: String(subtotal),
    total: String(subtotal),
  }).returning()

  const createdLineItems = await db.insert(invoiceLineItems)
    .values(lineItemsData.map(li => ({ ...li, invoiceId: invoice.id, hours: String(li.hours), rate: String(li.rate), amount: String(li.amount) })))
    .returning()

  const [client] = await db.select({ firstName: clients.firstName, lastName: clients.lastName })
    .from(clients).where(eq(clients.id, clientId)).limit(1)

  return c.json({ ...invoice, lineItems: createdLineItems, client }, 201)
})

export default app
