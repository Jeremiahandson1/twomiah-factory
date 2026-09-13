/**
 * Recurring Invoices — ONE implementation for every CRM that offers `recurring_jobs` (crm, crm-fieldservice,
 * crm-landscaping). Vendored into each template as ../shared; the template's services/recurring.ts wires in
 * db + tables + its email service, and routes/recurring.ts wires the middleware + audit logger.
 *
 * Recurring invoice templates that generate real invoices on a schedule. The recurring_invoice /
 * recurring_line_item tables are NOT in schema.ts, so this uses parameterized raw SQL (Drizzle `sql`) for
 * those and typed Drizzle for invoice / invoiceLineItem. emailService is INJECTED via deps (the old copies
 * did import('./email.ts'), which cannot resolve from the vendored shared/ folder).
 */
import { Hono } from 'hono'
import { eq, desc, sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'

export interface RecurringTables { invoice: any; invoiceLineItem: any }
export interface RecurringEmail { sendInvoice: (to: string, data: any) => Promise<any> }
export interface RecurringServiceDeps { db: any; tables: RecurringTables; emailService: RecurringEmail }
export interface RecurringAudit {
  log: (entry: any) => any
  ACTIONS: { CREATE: string; UPDATE: string; DELETE: string; STATUS_CHANGE: string; [k: string]: string }
}
export interface RecurringRoutesDeps {
  service: RecurringService
  authenticate: any
  requirePermission: (permission: string) => any
  audit: RecurringAudit
}

export const FREQUENCIES = {
  WEEKLY: 'weekly', BIWEEKLY: 'biweekly', MONTHLY: 'monthly',
  QUARTERLY: 'quarterly', SEMIANNUAL: 'semiannual', ANNUAL: 'annual',
} as const
export type Frequency = (typeof FREQUENCIES)[keyof typeof FREQUENCIES]

/** Extract rows array from db.execute() result (node-postgres returns { rows } object) */
function rows(result: any): any[] {
  return Array.isArray(result) ? result : (result?.rows || [])
}

export function calculateNextDate(fromDate: Date | string, frequency: string): Date {
  const date = new Date(fromDate)
  switch (frequency) {
    case FREQUENCIES.WEEKLY: date.setDate(date.getDate() + 7); break
    case FREQUENCIES.BIWEEKLY: date.setDate(date.getDate() + 14); break
    case FREQUENCIES.MONTHLY: date.setMonth(date.getMonth() + 1); break
    case FREQUENCIES.QUARTERLY: date.setMonth(date.getMonth() + 3); break
    case FREQUENCIES.SEMIANNUAL: date.setMonth(date.getMonth() + 6); break
    case FREQUENCIES.ANNUAL: date.setFullYear(date.getFullYear() + 1); break
    default: date.setMonth(date.getMonth() + 1)
  }
  return date
}

function calculateDueDate(invoiceDate: Date, terms: string): Date {
  const date = new Date(invoiceDate)
  const days = parseInt(terms) || 30
  date.setDate(date.getDate() + days)
  return date
}

export function createRecurringService(deps: RecurringServiceDeps) {
  const { db, tables, emailService } = deps
  const { invoice, invoiceLineItem } = tables

  async function generateInvoiceNumber(companyId: string): Promise<string> {
    const [lastInvoice] = await db.select({ number: invoice.number }).from(invoice)
      .where(eq(invoice.companyId, companyId)).orderBy(desc(invoice.createdAt)).limit(1)
    if (!lastInvoice) return 'INV-00001'
    const match = lastInvoice.number.match(/(\d+)$/)
    if (match) {
      const num = parseInt(match[1]) + 1
      const prefix = lastInvoice.number.replace(/\d+$/, '')
      return `${prefix}${String(num).padStart(5, '0')}`
    }
    return `INV-${Date.now()}`
  }

  async function createRecurringInvoice(data: any, companyIdArg?: string) {
    const { contactId, projectId, frequency, startDate, endDate, terms, lineItems, notes, autoSend } = data
    // The route passes companyId inside `data`; older callers pass it as the 2nd arg. Resolve either — an
    // undefined companyId emitted an empty SQL value and produced "syntax error at or near ','".
    const companyId = companyIdArg ?? data.companyId

    let subtotal = 0
    const processedItems = (lineItems as any[]).map((item: any, index: number) => {
      const total = (item.quantity || 1) * (item.unitPrice || 0)
      subtotal += total
      return { ...item, sortOrder: index, total }
    })
    const taxRate = data.taxRate || 0
    const taxAmount = subtotal * (taxRate / 100)
    const discount = data.discount || 0
    const total = subtotal + taxAmount - discount

    const [recurring] = rows(await db.execute(sql`
      INSERT INTO recurring_invoice (id, company_id, contact_id, project_id, frequency, start_date, end_date, next_run_date, terms, subtotal, tax_rate, tax_amount, discount, total, notes, auto_send, status)
      VALUES (${createId()}, ${companyId}, ${contactId}, ${projectId || null}, ${frequency}, ${new Date(startDate)}, ${endDate ? new Date(endDate) : null}, ${new Date(startDate)}, ${terms || '30'}, ${subtotal}, ${taxRate}, ${taxAmount}, ${discount}, ${total}, ${notes ?? null}, ${autoSend || false}, 'active')
      RETURNING *
    `))
    const recurringId = recurring?.id
    for (const item of processedItems) {
      await db.execute(sql`
        INSERT INTO recurring_line_item (id, recurring_invoice_id, description, quantity, unit_price, total, sort_order)
        VALUES (${createId()}, ${recurringId}, ${item.description}, ${item.quantity || 1}, ${item.unitPrice || 0}, ${item.total}, ${item.sortOrder})
      `)
    }
    return recurring
  }

  async function generateInvoiceFromRecurring(recurringId: string) {
    const [recurring] = rows(await db.execute(sql`
      SELECT ri.*, row_to_json(c.*) as contact, row_to_json(co.*) as company
      FROM recurring_invoice ri
      LEFT JOIN contact c ON c.id = ri.contact_id
      LEFT JOIN company co ON co.id = ri.company_id
      WHERE ri.id = ${recurringId}
    `))
    if (!recurring) throw new Error('Recurring invoice not found')
    if (recurring.status !== 'active') throw new Error('Recurring invoice is not active')

    const lineItems = rows(await db.execute(sql`
      SELECT * FROM recurring_line_item WHERE recurring_invoice_id = ${recurringId} ORDER BY sort_order ASC
    `))
    const number = await generateInvoiceNumber(recurring.company_id)
    const invoiceDate = new Date()
    const dueDate = calculateDueDate(invoiceDate, recurring.terms)

    const [newInvoice] = await db.insert(invoice).values({
      companyId: recurring.company_id,
      contactId: recurring.contact_id,
      projectId: recurring.project_id,
      number,
      status: 'draft',
      issueDate: invoiceDate,
      dueDate,
      terms: recurring.terms,
      subtotal: recurring.subtotal,
      taxRate: recurring.tax_rate,
      taxAmount: recurring.tax_amount,
      discount: recurring.discount,
      total: recurring.total,
      amountPaid: '0',
      notes: recurring.notes,
    }).returning()

    for (const item of lineItems) {
      await db.insert(invoiceLineItem).values({
        invoiceId: newInvoice.id,
        description: item.description,
        quantity: String(item.quantity),
        unitPrice: String(item.unit_price),
        total: String(item.total),
        sortOrder: item.sort_order,
      })
    }

    const nextRunDate = calculateNextDate(recurring.next_run_date, recurring.frequency)
    let newStatus = recurring.status
    if (recurring.end_date && nextRunDate > new Date(recurring.end_date)) newStatus = 'completed'
    await db.execute(sql`
      UPDATE recurring_invoice SET next_run_date = ${nextRunDate}, last_run_date = ${invoiceDate}, invoice_count = invoice_count + 1, status = ${newStatus}
      WHERE id = ${recurringId}
    `)

    if (recurring.auto_send && recurring.contact?.email) {
      await db.update(invoice).set({ status: 'sent', sentAt: new Date() }).where(eq(invoice.id, newInvoice.id))
      try {
        await emailService.sendInvoice(recurring.contact.email, {
          invoiceNumber: newInvoice.number,
          contactName: recurring.contact.name,
          total: newInvoice.total,
          balance: newInvoice.total,
          dueDate: dueDate.toLocaleDateString(),
          companyName: recurring.company.name,
          companyEmail: recurring.company.email,
        })
      } catch (error) {
        console.error('Failed to send recurring invoice email:', error)
      }
    }
    return newInvoice
  }

  async function processRecurringInvoices() {
    const now = new Date()
    const dueRecurring = rows(await db.execute(sql`
      SELECT * FROM recurring_invoice WHERE status = 'active' AND next_run_date <= ${now}
    `))
    const results: any[] = []
    for (const recurring of dueRecurring) {
      try {
        const inv = await generateInvoiceFromRecurring(recurring.id)
        results.push({ recurringId: recurring.id, success: true, invoiceId: inv.id, invoiceNumber: inv.number })
      } catch (error: any) {
        results.push({ recurringId: recurring.id, success: false, error: error.message })
      }
    }
    return { processed: results.length, successful: results.filter((r) => r.success).length, results }
  }

  async function getRecurringInvoices(companyId: string, { status, contactId, page = 1, limit = 25 }: { status?: string; contactId?: string; page?: number; limit?: number }) {
    const conditions = [sql`ri.company_id = ${companyId}`]
    if (status) conditions.push(sql`ri.status = ${status}`)
    if (contactId) conditions.push(sql`ri.contact_id = ${contactId}`)
    const where = sql.join(conditions, sql` AND `)
    const pageN = Number.isFinite(Number(page)) && Number(page) > 0 ? Math.floor(Number(page)) : 1
    const limitN = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.min(200, Math.floor(Number(limit))) : 25
    const offset = (pageN - 1) * limitN
    const data = rows(await db.execute(sql`
      SELECT ri.*, row_to_json(c.*) as contact, row_to_json(p.*) as project
      FROM recurring_invoice ri
      LEFT JOIN contact c ON c.id = ri.contact_id
      LEFT JOIN project p ON p.id = ri.project_id
      WHERE ${where}
      ORDER BY ri.created_at DESC
      LIMIT ${limitN} OFFSET ${offset}
    `))
    const [{ count: total }] = rows(await db.execute(sql`SELECT count(*)::int as count FROM recurring_invoice ri WHERE ${where}`))
    return { data, pagination: { page: pageN, limit: limitN, total, pages: Math.ceil(total / limitN) } }
  }

  async function getRecurringInvoice(id: string, companyId: string) {
    const [result] = rows(await db.execute(sql`
      SELECT ri.*, row_to_json(c.*) as contact, row_to_json(p.*) as project
      FROM recurring_invoice ri
      LEFT JOIN contact c ON c.id = ri.contact_id
      LEFT JOIN project p ON p.id = ri.project_id
      WHERE ri.id = ${id} AND ri.company_id = ${companyId}
    `))
    if (!result) return null
    const lineItemRows = rows(await db.execute(sql`
      SELECT * FROM recurring_line_item WHERE recurring_invoice_id = ${id} ORDER BY sort_order ASC
    `))
    result.lineItems = lineItemRows
    return result
  }

  async function updateRecurringInvoice(id: string, companyId: string, data: any) {
    const [existing] = rows(await db.execute(sql`
      SELECT * FROM recurring_invoice WHERE id = ${id} AND company_id = ${companyId}
    `))
    if (!existing) return null

    if (data.lineItems) {
      await db.execute(sql`DELETE FROM recurring_line_item WHERE recurring_invoice_id = ${id}`)
      let subtotal = 0
      const processedItems = (data.lineItems as any[]).map((item: any, index: number) => {
        const total = (item.quantity || 1) * (item.unitPrice || 0)
        subtotal += total
        return { description: item.description, quantity: item.quantity || 1, unitPrice: item.unitPrice || 0, total, sortOrder: index, recurringInvoiceId: id }
      })
      for (const item of processedItems) {
        await db.execute(sql`
          INSERT INTO recurring_line_item (id, recurring_invoice_id, description, quantity, unit_price, total, sort_order)
          VALUES (${createId()}, ${id}, ${item.description}, ${item.quantity}, ${item.unitPrice}, ${item.total}, ${item.sortOrder})
        `)
      }
      const taxRate = data.taxRate ?? existing.tax_rate
      const taxAmount = subtotal * (taxRate / 100)
      const discount = data.discount ?? existing.discount
      const total = subtotal + taxAmount - discount
      delete data.lineItems
      Object.assign(data, { subtotal, taxRate, taxAmount, discount, total })
    }

    // Parameterized SET clause (numbers coerced, so a string in a numeric field can't inject).
    const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
    const sets: any[] = []
    if (data.frequency !== undefined) sets.push(sql`frequency = ${data.frequency}`)
    if (data.autoSend !== undefined) sets.push(sql`auto_send = ${!!data.autoSend}`)
    if (data.status !== undefined) sets.push(sql`status = ${data.status}`)
    if (data.subtotal !== undefined) sets.push(sql`subtotal = ${num(data.subtotal)}`)
    if (data.taxRate !== undefined) sets.push(sql`tax_rate = ${num(data.taxRate)}`)
    if (data.taxAmount !== undefined) sets.push(sql`tax_amount = ${num(data.taxAmount)}`)
    if (data.discount !== undefined) sets.push(sql`discount = ${num(data.discount)}`)
    if (data.total !== undefined) sets.push(sql`total = ${num(data.total)}`)
    if (data.notes !== undefined) sets.push(sql`notes = ${data.notes}`)
    if (sets.length > 0) {
      await db.execute(sql`UPDATE recurring_invoice SET ${sql.join(sets, sql`, `)} WHERE id = ${id} AND company_id = ${companyId}`)
    }
    return getRecurringInvoice(id, companyId)
  }

  async function pauseRecurringInvoice(id: string, companyId: string) {
    const [existing] = rows(await db.execute(sql`SELECT * FROM recurring_invoice WHERE id = ${id} AND company_id = ${companyId}`))
    if (!existing) return null
    await db.execute(sql`UPDATE recurring_invoice SET status = 'paused' WHERE id = ${id}`)
    return { ...existing, status: 'paused' }
  }

  async function resumeRecurringInvoice(id: string, companyId: string) {
    const [existing] = rows(await db.execute(sql`SELECT * FROM recurring_invoice WHERE id = ${id} AND company_id = ${companyId}`))
    if (!existing) return null
    let nextRunDate = new Date(existing.next_run_date)
    const now = new Date()
    while (nextRunDate < now) nextRunDate = calculateNextDate(nextRunDate, existing.frequency)
    await db.execute(sql`UPDATE recurring_invoice SET status = 'active', next_run_date = ${nextRunDate} WHERE id = ${id}`)
    return { ...existing, status: 'active', next_run_date: nextRunDate }
  }

  async function cancelRecurringInvoice(id: string, companyId: string) {
    const [existing] = rows(await db.execute(sql`SELECT * FROM recurring_invoice WHERE id = ${id} AND company_id = ${companyId}`))
    if (!existing) return null
    await db.execute(sql`UPDATE recurring_invoice SET status = 'cancelled' WHERE id = ${id}`)
    return { ...existing, status: 'cancelled' }
  }

  async function deleteRecurringInvoice(id: string, companyId: string): Promise<boolean> {
    const [existing] = rows(await db.execute(sql`SELECT * FROM recurring_invoice WHERE id = ${id} AND company_id = ${companyId}`))
    if (!existing) return false
    await db.execute(sql`DELETE FROM recurring_line_item WHERE recurring_invoice_id = ${id}`)
    await db.execute(sql`DELETE FROM recurring_invoice WHERE id = ${id}`)
    return true
  }

  async function getRecurringStats(companyId: string) {
    const [activeRes, pausedRes] = await Promise.all([
      db.execute(sql`SELECT count(*)::int as count FROM recurring_invoice WHERE company_id = ${companyId} AND status = 'active'`),
      db.execute(sql`SELECT count(*)::int as count FROM recurring_invoice WHERE company_id = ${companyId} AND status = 'paused'`),
    ])
    return { active: rows(activeRes)[0]?.count || 0, paused: rows(pausedRes)[0]?.count || 0 }
  }

  async function updateRecurringStatus(id: string, status: string, opts?: { nextRunDate?: Date }) {
    const sets = [sql`status = ${status}`]
    if (opts?.nextRunDate) sets.push(sql`next_run_date = ${opts.nextRunDate}`)
    const [updated] = rows(await db.execute(sql`UPDATE recurring_invoice SET ${sql.join(sets, sql`, `)} WHERE id = ${id} RETURNING *`))
    return updated
  }

  return {
    FREQUENCIES,
    calculateNextDate,
    createRecurringInvoice,
    generateInvoiceFromRecurring,
    processRecurringInvoices,
    getRecurringInvoices,
    getRecurringInvoice,
    getRecurringList: getRecurringInvoices,
    getRecurringById: getRecurringInvoice,
    getRecurringStats,
    createRecurring: createRecurringInvoice,
    updateRecurring: updateRecurringInvoice,
    updateRecurringStatus,
    generateInvoice: generateInvoiceFromRecurring,
    deleteRecurring: deleteRecurringInvoice,
    processDueRecurring: processRecurringInvoices,
    updateRecurringInvoice,
    pauseRecurringInvoice,
    resumeRecurringInvoice,
    cancelRecurringInvoice,
    deleteRecurringInvoice,
  }
}

export type RecurringService = ReturnType<typeof createRecurringService>

export function createRecurringRoutes(deps: RecurringRoutesDeps) {
  const { service, authenticate, requirePermission, audit } = deps
  const app = new Hono()
  app.use('*', authenticate)

  app.get('/', requirePermission('invoices:read'), async (c: any) => {
    const user = c.get('user')
    const data = await service.getRecurringList(user.companyId, {
      status: c.req.query('status'),
      contactId: c.req.query('contactId'),
      page: parseInt(c.req.query('page') || '1'),
      limit: parseInt(c.req.query('limit') || '25'),
    })
    return c.json(data)
  })

  app.get('/stats', requirePermission('invoices:read'), async (c: any) => c.json(await service.getRecurringStats((c.get('user')).companyId)))

  app.get('/:id', requirePermission('invoices:read'), async (c: any) => {
    const recurring = await service.getRecurringById(c.req.param('id'), (c.get('user')).companyId)
    if (!recurring) return c.json({ error: 'Recurring invoice not found' }, 404)
    return c.json(recurring)
  })

  app.post('/', requirePermission('invoices:create'), async (c: any) => {
    const user = c.get('user')
    const b = await c.req.json()
    if (!b.contactId) return c.json({ error: 'Contact is required' }, 400)
    if (!b.frequency) return c.json({ error: 'Frequency is required' }, 400)
    if (!b.lineItems || b.lineItems.length === 0) return c.json({ error: 'At least one line item is required' }, 400)
    const recurring = await service.createRecurring({
      companyId: user.companyId,
      contactId: b.contactId, projectId: b.projectId, frequency: b.frequency,
      startDate: b.startDate || new Date(), endDate: b.endDate, dayOfMonth: b.dayOfMonth, dayOfWeek: b.dayOfWeek,
      lineItems: b.lineItems, notes: b.notes, terms: b.terms, taxRate: b.taxRate, discount: b.discount,
      autoSend: b.autoSend, paymentTermsDays: b.paymentTermsDays,
    })
    audit.log({ action: audit.ACTIONS.CREATE, entity: 'recurring_invoice', entityId: recurring.id, entityName: `${recurring.frequency} - $${recurring.total}`, userId: user.userId, companyId: user.companyId })
    return c.json(recurring, 201)
  })

  app.put('/:id', requirePermission('invoices:update'), async (c: any) => {
    const user = c.get('user')
    const recurring = await service.updateRecurring(c.req.param('id'), user.companyId, await c.req.json())
    if (!recurring) return c.json({ error: 'Recurring invoice not found' }, 404)
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'recurring_invoice', entityId: recurring.id, userId: user.userId, companyId: user.companyId })
    return c.json(recurring)
  })

  const statusChange = (to: string, opts?: (r: any) => { nextRunDate?: Date }) =>
    async (c: any) => {
      const user = c.get('user'); const id = c.req.param('id')
      const recurring = await service.getRecurringById(id, user.companyId)
      if (!recurring) return c.json({ error: 'Recurring invoice not found' }, 404)
      const updated = await service.updateRecurringStatus(id, to, opts ? opts(recurring) : undefined)
      audit.log({ action: audit.ACTIONS.STATUS_CHANGE, entity: 'recurring_invoice', entityId: recurring.id, metadata: { from: recurring.status, to }, userId: user.userId, companyId: user.companyId })
      return c.json(updated)
    }
  app.post('/:id/pause', requirePermission('invoices:update'), statusChange('paused'))
  app.post('/:id/resume', requirePermission('invoices:update'), statusChange('active', () => ({ nextRunDate: new Date() })))
  app.post('/:id/cancel', requirePermission('invoices:update'), statusChange('cancelled'))

  app.post('/:id/generate', requirePermission('invoices:create'), async (c: any) => {
    const user = c.get('user'); const id = c.req.param('id')
    const recurring = await service.getRecurringById(id, user.companyId)
    if (!recurring) return c.json({ error: 'Recurring invoice not found' }, 404)
    const { invoice } = await service.generateInvoice(id) as any
    audit.log({ action: audit.ACTIONS.CREATE, entity: 'invoice', entityId: invoice.id, entityName: invoice.number, metadata: { source: 'recurring', recurringId: recurring.id }, userId: user.userId, companyId: user.companyId })
    return c.json(invoice, 201)
  })

  app.delete('/:id', requirePermission('invoices:delete'), async (c: any) => {
    const user = c.get('user'); const id = c.req.param('id')
    const recurring = await service.getRecurringById(id, user.companyId)
    if (!recurring) return c.json({ error: 'Recurring invoice not found' }, 404)
    await service.deleteRecurring(id, user.companyId)
    audit.log({ action: audit.ACTIONS.DELETE, entity: 'recurring_invoice', entityId: recurring.id, userId: user.userId, companyId: user.companyId })
    return c.body(null, 204)
  })

  // Cron endpoint — secure with an internal secret, not the user session.
  app.post('/process', async (c: any) => {
    const cronSecret = c.req.header('x-cron-secret')
    if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) return c.json({ error: 'Unauthorized' }, 401)
    return c.json(await service.processDueRecurring())
  })

  return app
}
