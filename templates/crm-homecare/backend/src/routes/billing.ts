import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { invoices, invoiceLineItems, invoiceAdjustments, invoicePayments, clients, timeEntries, clientAssignments, users, referralSources, referralSourceRates } from '../../db/schema.ts'
import { eq, and, gte, lte, count, desc, inArray, isNull } from 'drizzle-orm'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { createId } from '@paralleldrive/cuid2'
import emailService from '../services/email.ts'

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

// ── GENERATE INVOICE WITH PAYER RATES ─────────────────────────────

app.post('/invoices/generate-with-rates', async (c) => {
  const { clientId, billingPeriodStart, billingPeriodEnd, notes } = await c.req.json()

  if (!clientId || !billingPeriodStart || !billingPeriodEnd) {
    return c.json({ error: 'Client and billing period are required' }, 400)
  }

  // Get client with referral source
  const [client] = await db.select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1)

  if (!client) return c.json({ error: 'Client not found' }, 404)

  // Check for existing invoice
  const existing = await db.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber })
    .from(invoices)
    .where(and(
      eq(invoices.clientId, clientId),
      eq(invoices.billingPeriodStart, billingPeriodStart),
      eq(invoices.billingPeriodEnd, billingPeriodEnd),
    ))
    .limit(1)

  if (existing.length) {
    return c.json({ error: `Invoice ${existing[0].invoiceNumber} already exists for this period` }, 400)
  }

  // Get time entries
  const entries = await db.select({
    entry: timeEntries,
    caregiverFirstName: users.firstName,
    caregiverLastName: users.lastName,
  })
    .from(timeEntries)
    .leftJoin(users, eq(timeEntries.caregiverId, users.id))
    .where(and(
      eq(timeEntries.clientId, clientId),
      gte(timeEntries.startTime, new Date(billingPeriodStart)),
      lte(timeEntries.startTime, new Date(billingPeriodEnd + 'T23:59:59')),
      eq(timeEntries.isComplete, true),
    ))

  if (!entries.length) {
    return c.json({ error: 'No completed time entries found for this client in the selected period' }, 400)
  }

  // Look up payer rate
  let rate = 25.00
  let rateType = 'hourly'

  if (client.referredById) {
    const rateRows = await db.select()
      .from(referralSourceRates)
      .where(and(
        eq(referralSourceRates.referralSourceId, client.referredById),
        eq(referralSourceRates.isActive, true),
      ))
      .limit(1)

    if (rateRows.length) {
      rate = parseFloat(rateRows[0].rateAmount)
      rateType = rateRows[0].rateType
    }
  }

  // If no payer rate, try assignment rate
  if (rate === 25.00) {
    const [assignment] = await db.select()
      .from(clientAssignments)
      .where(and(eq(clientAssignments.clientId, clientId), eq(clientAssignments.status, 'active')))
      .limit(1)

    if (assignment?.payRate) rate = Number(assignment.payRate)
  }

  // Build line items
  const lineItemsData = entries.map(e => {
    let hours = 0
    if (e.entry.durationMinutes) {
      hours = e.entry.durationMinutes / 60
    } else if (e.entry.startTime && e.entry.endTime) {
      hours = (new Date(e.entry.endTime).getTime() - new Date(e.entry.startTime).getTime()) / 3600000
    }
    if (hours <= 0) hours = 0

    const amount = rateType === 'hourly' ? hours * rate : rate

    return {
      timeEntryId: e.entry.id,
      caregiverId: e.entry.caregiverId,
      description: e.entry.notes || `${e.caregiverFirstName} ${e.caregiverLastName} - Home Care Services`,
      hours: String(hours.toFixed(2)),
      rate: String(rate.toFixed(2)),
      amount: String(amount.toFixed(2)),
    }
  }).filter(li => parseFloat(li.hours) > 0)

  const subtotal = lineItemsData.reduce((sum, li) => sum + parseFloat(li.amount), 0)

  const dueDate = new Date(billingPeriodEnd)
  dueDate.setDate(dueDate.getDate() + 30)

  const [{ value: cnt }] = await db.select({ value: count() }).from(invoices)
  const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}-${clientId.slice(0, 4).toUpperCase()}`

  const [invoice] = await db.insert(invoices).values({
    invoiceNumber,
    clientId,
    billingPeriodStart,
    billingPeriodEnd,
    subtotal: String(subtotal),
    total: String(subtotal),
    paymentDueDate: dueDate.toISOString().split('T')[0],
    notes,
  }).returning()

  const createdLineItems = await db.insert(invoiceLineItems)
    .values(lineItemsData.map(li => ({ ...li, invoiceId: invoice.id })))
    .returning()

  // Get referral source name
  let referralSourceName: string | null = null
  if (client.referredById) {
    const [rs] = await db.select({ name: referralSources.name })
      .from(referralSources)
      .where(eq(referralSources.id, client.referredById))
      .limit(1)
    referralSourceName = rs?.name || null
  }

  return c.json({
    ...invoice,
    client: { firstName: client.firstName, lastName: client.lastName },
    referralSourceName,
    lineItems: createdLineItems,
    totalHours: createdLineItems.reduce((sum, li) => sum + parseFloat(li.hours), 0),
  }, 201)
})

// ── MANUAL INVOICE ─────────────────────────────────────────────────

app.post('/invoices/manual', async (c) => {
  const { clientId, billingPeriodStart, billingPeriodEnd, notes, lineItems: lineItemsInput } = await c.req.json()

  if (!clientId || !billingPeriodStart || !billingPeriodEnd) {
    return c.json({ error: 'Client and billing period are required' }, 400)
  }
  if (!lineItemsInput?.length) {
    return c.json({ error: 'At least one line item is required' }, 400)
  }

  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1)
  if (!client) return c.json({ error: 'Client not found' }, 404)

  const subtotal = lineItemsInput.reduce((sum: number, li: any) => sum + parseFloat(li.amount || 0), 0)
  const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}-${clientId.slice(0, 4).toUpperCase()}`

  const dueDate = new Date(billingPeriodEnd)
  dueDate.setDate(dueDate.getDate() + 30)

  const [invoice] = await db.insert(invoices).values({
    invoiceNumber,
    clientId,
    billingPeriodStart,
    billingPeriodEnd,
    subtotal: String(subtotal),
    total: String(subtotal),
    paymentDueDate: dueDate.toISOString().split('T')[0],
    notes,
  }).returning()

  const createdLineItems = await db.insert(invoiceLineItems)
    .values(lineItemsInput.map((li: any) => ({
      invoiceId: invoice.id,
      caregiverId: li.caregiverId || null,
      description: li.description || 'Home Care Services',
      hours: String(li.hours || 0),
      rate: String(li.rate || 0),
      amount: String(li.amount || 0),
    })))
    .returning()

  return c.json({
    ...invoice,
    client: { firstName: client.firstName, lastName: client.lastName },
    lineItems: createdLineItems,
  }, 201)
})

// ── BATCH GENERATE INVOICES ──────────────────────────────────────

app.post('/invoices/batch-generate', async (c) => {
  const { clientIds, billingPeriodStart, billingPeriodEnd } = await c.req.json()

  if (!clientIds?.length || !billingPeriodStart || !billingPeriodEnd) {
    return c.json({ error: 'Client IDs and billing period required' }, 400)
  }

  const results = { generated: 0, skipped: 0, errors: [] as { clientId: string; error: string }[] }

  for (const clientId of clientIds) {
    try {
      // Use the generate-with-rates logic inline
      const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1)
      if (!client) { results.skipped++; continue }

      const existing = await db.select({ id: invoices.id }).from(invoices)
        .where(and(
          eq(invoices.clientId, clientId),
          eq(invoices.billingPeriodStart, billingPeriodStart),
          eq(invoices.billingPeriodEnd, billingPeriodEnd),
        ))
        .limit(1)
      if (existing.length) { results.skipped++; continue }

      const entries = await db.select({ entry: timeEntries, caregiverFirstName: users.firstName, caregiverLastName: users.lastName })
        .from(timeEntries)
        .leftJoin(users, eq(timeEntries.caregiverId, users.id))
        .where(and(
          eq(timeEntries.clientId, clientId),
          gte(timeEntries.startTime, new Date(billingPeriodStart)),
          lte(timeEntries.startTime, new Date(billingPeriodEnd + 'T23:59:59')),
          eq(timeEntries.isComplete, true),
        ))

      if (!entries.length) { results.skipped++; continue }

      let rate = 25.00
      if (client.referredById) {
        const rateRows = await db.select().from(referralSourceRates)
          .where(and(eq(referralSourceRates.referralSourceId, client.referredById), eq(referralSourceRates.isActive, true)))
          .limit(1)
        if (rateRows.length) rate = parseFloat(rateRows[0].rateAmount)
      }

      const lineItemsData = entries.map(e => {
        const hours = (e.entry.billableMinutes || e.entry.durationMinutes || 0) / 60
        return {
          caregiverId: e.entry.caregiverId,
          description: `${e.caregiverFirstName} ${e.caregiverLastName} - Home Care Services`,
          hours: String(hours.toFixed(2)),
          rate: String(rate.toFixed(2)),
          amount: String((hours * rate).toFixed(2)),
        }
      }).filter(li => parseFloat(li.hours) > 0)

      const subtotal = lineItemsData.reduce((sum, li) => sum + parseFloat(li.amount), 0)
      const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}-${clientId.slice(0, 4).toUpperCase()}`

      const dueDate = new Date(billingPeriodEnd)
      dueDate.setDate(dueDate.getDate() + 30)

      const [invoice] = await db.insert(invoices).values({
        invoiceNumber, clientId, billingPeriodStart, billingPeriodEnd,
        subtotal: String(subtotal), total: String(subtotal),
        paymentDueDate: dueDate.toISOString().split('T')[0],
      }).returning()

      if (lineItemsData.length) {
        await db.insert(invoiceLineItems)
          .values(lineItemsData.map(li => ({ ...li, invoiceId: invoice.id })))
      }

      results.generated++
    } catch (e: any) {
      results.errors.push({ clientId, error: e.message })
    }
  }

  return c.json(results)
})

// ── SEND INVOICE EMAIL ─────────────────────────────────────────────

app.post('/invoices/:id/send-email', async (c) => {
  const id = c.req.param('id')

  const rows = await db.select({
    invoice: invoices,
    firstName: clients.firstName,
    lastName: clients.lastName,
    email: clients.email,
    portalEmail: clients.portalEmail,
  })
    .from(invoices)
    .innerJoin(clients, eq(invoices.clientId, clients.id))
    .where(eq(invoices.id, id))

  if (!rows.length) return c.json({ error: 'Invoice not found' }, 404)

  const { invoice, firstName, lastName, email, portalEmail } = rows[0]
  const toEmail = portalEmail || email

  if (!toEmail) return c.json({ error: 'Client has no email address' }, 400)

  // Get line items for email
  const lineItems = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, id))

  const lineItemsHtml = lineItems.map(li =>
    `<tr><td>${li.createdAt ? new Date(li.createdAt).toLocaleDateString() : ''}</td><td>${li.description}</td><td>${parseFloat(li.hours).toFixed(1)}h</td><td>$${parseFloat(li.amount).toFixed(2)}</td></tr>`
  ).join('')

  const FRONTEND_URL = process.env.FRONTEND_URL || ''
  const payUrl = FRONTEND_URL ? `${FRONTEND_URL}/pay/${invoice.id}` : undefined

  await emailService.sendInvoiceEmail(toEmail, {
    companyName: process.env.COMPANY_NAME || '{{COMPANY_NAME}}',
    contactName: `${firstName} ${lastName}`,
    invoiceNumber: invoice.invoiceNumber,
    total: parseFloat(invoice.total).toFixed(2),
    amountDue: parseFloat(invoice.total).toFixed(2),
    dueDate: invoice.paymentDueDate ? new Date(invoice.paymentDueDate).toLocaleDateString() : 'N/A',
    lineItems: lineItemsHtml,
    payUrl,
  })

  return c.json({ success: true, sentTo: toEmail })
})

// ── INVOICE ADJUSTMENTS ──────────────────────────────────────────

app.get('/invoices/:id/adjustments', async (c) => {
  const id = c.req.param('id')
  const adjustments = await db.select()
    .from(invoiceAdjustments)
    .where(eq(invoiceAdjustments.invoiceId, id))
    .orderBy(desc(invoiceAdjustments.createdAt))

  return c.json(adjustments)
})

app.post('/invoices/:id/adjustments', async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')
  const { adjustmentType, amount, reason, notes } = await c.req.json()

  const [adjustment] = await db.insert(invoiceAdjustments).values({
    id: createId(),
    invoiceId: id,
    adjustmentType,
    amount: String(amount),
    reason,
    notes,
    createdById: user.userId,
  }).returning()

  return c.json(adjustment, 201)
})

// ── REFERRAL SOURCE RATES ─────────────────────────────────────────

app.get('/rates', async (c) => {
  const rows = await db.select({
    rate: referralSourceRates,
    referralSourceName: referralSources.name,
  })
    .from(referralSourceRates)
    .leftJoin(referralSources, eq(referralSourceRates.referralSourceId, referralSources.id))
    .orderBy(desc(referralSourceRates.createdAt))

  return c.json(rows.map(r => ({ ...r.rate, referralSourceName: r.referralSourceName })))
})

app.post('/rates', async (c) => {
  const body = await c.req.json()
  const [rate] = await db.insert(referralSourceRates).values(body).returning()
  return c.json(rate, 201)
})

app.put('/rates/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const [rate] = await db.update(referralSourceRates)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(referralSourceRates.id, id))
    .returning()

  return c.json(rate)
})

// GET /referral-source-rates — same shape as /rates, alias path the frontend uses
app.get('/referral-source-rates', async (c) => {
  const rows = await db.select({
    rate: referralSourceRates,
    referralSourceName: referralSources.name,
  })
    .from(referralSourceRates)
    .leftJoin(referralSources, eq(referralSourceRates.referralSourceId, referralSources.id))
    .orderBy(desc(referralSourceRates.createdAt))

  return c.json(rows.map(r => ({
    id: r.rate.id,
    referral_source_id: r.rate.referralSourceId,
    referral_source_name: r.referralSourceName,
    care_type_id: r.rate.careTypeId,
    rate_amount: r.rate.rateAmount,
    rate_type: r.rate.rateType,
    effective_date: r.rate.effectiveDate,
    end_date: r.rate.endDate,
    is_active: r.rate.isActive,
  })))
})

app.post('/referral-source-rates', async (c) => {
  const body = await c.req.json()
  const [rate] = await db.insert(referralSourceRates).values({
    referralSourceId: body.referralSourceId || body.referral_source_id,
    careTypeId: body.careTypeId || body.care_type_id || null,
    rateAmount: body.rateAmount || body.rate_amount,
    rateType: body.rateType || body.rate_type || 'hourly',
    effectiveDate: body.effectiveDate || body.effective_date || null,
    endDate: body.endDate || body.end_date || null,
  }).returning()
  return c.json(rate, 201)
})

app.put('/referral-source-rates/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const [rate] = await db.update(referralSourceRates)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(referralSourceRates.id, id))
    .returning()
  return c.json(rate)
})

app.delete('/referral-source-rates/:id', async (c) => {
  const id = c.req.param('id')
  await db.delete(referralSourceRates).where(eq(referralSourceRates.id, id))
  return c.json({ success: true })
})

// ── INVOICE PAYMENTS ──────────────────────────────────────────────

// GET /invoice-payments — list payments, optionally filtered by invoice/date
app.get('/invoice-payments', async (c) => {
  const { invoiceId, startDate, endDate } = c.req.query()

  const conditions: any[] = []
  if (invoiceId) conditions.push(eq(invoicePayments.invoiceId, invoiceId))
  if (startDate) conditions.push(gte(invoicePayments.paymentDate, startDate))
  if (endDate) conditions.push(lte(invoicePayments.paymentDate, endDate))

  const rows = await db
    .select()
    .from(invoicePayments)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(invoicePayments.paymentDate), desc(invoicePayments.createdAt))

  return c.json(rows.map((p) => ({
    id: p.id,
    invoice_id: p.invoiceId,
    amount: p.amount,
    payment_method: p.paymentMethod,
    method: p.paymentMethod,
    reference_number: p.referenceNumber,
    reference: p.referenceNumber,
    payment_date: p.paymentDate,
    received_at: p.paymentDate,
    notes: p.notes,
    created_at: p.createdAt,
  })))
})

// POST /invoice-payments — record a payment against an invoice
app.post('/invoice-payments', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const invoiceId = body.invoiceId || body.invoice_id
  const amount = body.amount
  if (!invoiceId || amount === undefined || amount === null) {
    return c.json({ error: 'invoiceId and amount are required' }, 400)
  }

  const [payment] = await db.insert(invoicePayments).values({
    invoiceId,
    amount: String(amount),
    paymentMethod: body.paymentMethod || body.payment_method || 'check',
    referenceNumber: body.referenceNumber || body.reference_number || null,
    paymentDate: body.paymentDate || body.payment_date || new Date().toISOString().slice(0, 10),
    notes: body.notes || null,
    createdById: user?.userId || null,
  }).returning()

  // Roll up to invoice: sum all payments for this invoice and update amountPaid / status.
  const allPayments = await db
    .select({ amount: invoicePayments.amount })
    .from(invoicePayments)
    .where(eq(invoicePayments.invoiceId, invoiceId))
  const totalPaid = allPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)

  const [invoice] = await db.select({ total: invoices.total }).from(invoices).where(eq(invoices.id, invoiceId)).limit(1)
  if (invoice) {
    const invoiceTotal = Number(invoice.total || 0)
    const status = totalPaid >= invoiceTotal ? 'paid' : totalPaid > 0 ? 'partial' : 'pending'
    await db.update(invoices).set({
      amountPaid: String(totalPaid),
      paymentStatus: status,
      paidAt: status === 'paid' ? new Date() : null,
      paymentMethod: payment.paymentMethod,
      paymentDate: payment.paymentDate,
      updatedAt: new Date(),
    }).where(eq(invoices.id, invoiceId))
  }

  return c.json(payment, 201)
})

app.delete('/invoice-payments/:id', async (c) => {
  const id = c.req.param('id')
  const [existing] = await db.select().from(invoicePayments).where(eq(invoicePayments.id, id)).limit(1)
  if (!existing) return c.json({ error: 'Payment not found' }, 404)
  await db.delete(invoicePayments).where(eq(invoicePayments.id, id))

  // Recompute invoice payment status
  const remaining = await db
    .select({ amount: invoicePayments.amount })
    .from(invoicePayments)
    .where(eq(invoicePayments.invoiceId, existing.invoiceId))
  const totalPaid = remaining.reduce((sum, p) => sum + Number(p.amount || 0), 0)
  const [invoice] = await db.select({ total: invoices.total }).from(invoices).where(eq(invoices.id, existing.invoiceId)).limit(1)
  if (invoice) {
    const invoiceTotal = Number(invoice.total || 0)
    const status = totalPaid >= invoiceTotal ? 'paid' : totalPaid > 0 ? 'partial' : 'pending'
    await db.update(invoices).set({
      amountPaid: String(totalPaid),
      paymentStatus: status,
      paidAt: status === 'paid' ? new Date() : null,
      updatedAt: new Date(),
    }).where(eq(invoices.id, existing.invoiceId))
  }
  return c.json({ success: true })
})

export default app
