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
import { eq, desc, sql, asc } from 'drizzle-orm'
// One numbering rule for every document in the product — locked, and only ever forwards.
import { nextNumber } from '../invoicing/money'
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

/**
 * Raw-SQL rows come back snake_case; RecurringForm and RecurringList read camelCase. (T32 L7)
 *
 * The report named four modules and this was the fourth. Every recurring endpoint answered
 * `next_run_date`, `last_run_date`, `invoice_count`, `auto_send`, `day_of_month` while the shared UI
 * reads nextRunDate, autoSend, dayOfMonth — and `resumeRecurringInvoice` went further and returned
 * a literal `next_run_date` key alongside camelCase ones, from the same object.
 *
 * `rows` keeps its name because the reads this file makes of its OWN rows index raw column names
 * (`recurring.company_id`, `existing.next_run_date`). Camelising happens at the return.
 */
import { rowsOf as rows, camelRow, camelRows } from '../sqlRows'
// The company's calendar day, for a day-valued field. The generate query already joins the company
// row, so the zone is read from it rather than fetched again. (T33)
import { companyRowTimeZone, storeDateString, storeDayStart } from '../time/businessDay'

/** Aliases in this file that are table rows, and so are safe to camelise inside. */
/**
 * THE CONTACT IS SERIALISED WHOLE HERE, so it is subtracted in SQL. (T43)
 *
 * This module is raw SQL, not Drizzle, and `row_to_json(c.*)` returns EVERY column of the joined
 * contact — including portal_token. Measured live: the recurring list and detail both handed a
 * working portal credential to the owner and the manager on three tenants. Guard #201 had nothing to
 * catch, because it reasons about `db.select().from(contact)` and there is no such call in this file.
 *
 * `to_jsonb(c.*) - 'portal_token' - 'portal_token_exp'` rather than an explicit column list: every
 * other field stays exactly as the screen expects it (name, email, phone, address), a column added
 * later arrives visible — the right default for a contact field — and the two credential keys are
 * named, so removing one is a one-line change in one place. jsonb rather than json because the
 * `-` operator is only defined on jsonb; the serialised result is identical.
 */
const NESTED = ['contact', 'project', 'company']

/**
 * Add months and CLAMP to the end of the target month. (T32 H7)
 *
 * `date.setMonth(date.getMonth() + 1)` on 31 October asks for 31 November, which JavaScript rolls
 * forward to 1 December. So a monthly invoice dated the 31st never billed November at all, and the
 * schedule drifted permanently to the 1st — the tester watched it go 31 Oct → 1 Dec → 1 Jan. The same
 * rollover hits quarterly and semiannual from any 29th, 30th or 31st, and annual from 29 February.
 *
 * A business that invoices on the last day of the month means the LAST DAY, so 31 Oct → 30 Nov and
 * 31 Jan → 28 (or 29) Feb. Setting the day to 1 before changing the month is what stops the rollover
 * happening before there is a chance to clamp.
 */
function addMonthsClamped(from: Date, months: number, anchorDay?: number): Date {
  const date = new Date(from)
  const wantedDay = anchorDay ?? date.getDate()
  date.setDate(1)
  date.setMonth(date.getMonth() + months)
  // day 0 of the following month is the last day of this one
  const lastDayOfTarget = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(wantedDay, lastDayOfTarget))
  return date
}

/**
 * The next run date — measured from the schedule's ANCHOR DAY, not from the last date it produced.
 *
 * T33. The clamp added in T32 H7 was right and not enough: it stopped 31 Oct rolling over into
 * 1 December, but it had no memory of the 31st, so the schedule stayed clamped for ever:
 *
 *     31 Oct → 30 Nov → 30 Dec → 30 Jan …        the day the business chose is lost after one short month
 *     31 Oct → 30 Nov → 31 Dec → 31 Jan …        with the anchor
 *
 * The anchor is the day of the month the schedule STARTS on, because that is what the business
 * picked. `30 Nov` is a fact about November, not an instruction, and chaining off it turns one
 * short month into a permanent change to the billing date.
 *
 * February is the test that matters: 31 Jan → 28 Feb → 31 Mar, not 28 Feb → 28 Mar.
 *
 * `anchorDay` is optional so the exported signature does not break any caller that has not been
 * told about it — omitted, this behaves exactly as before.
 */
export function calculateNextDate(fromDate: Date | string, frequency: string, anchorDay?: number): Date {
  const date = new Date(fromDate)
  switch (frequency) {
    // Week-based schedules have no anchor to lose: seven days from a Tuesday is always a Tuesday.
    case FREQUENCIES.WEEKLY: date.setDate(date.getDate() + 7); return date
    case FREQUENCIES.BIWEEKLY: date.setDate(date.getDate() + 14); return date
    case FREQUENCIES.MONTHLY: return addMonthsClamped(date, 1, anchorDay)
    case FREQUENCIES.QUARTERLY: return addMonthsClamped(date, 3, anchorDay)
    case FREQUENCIES.SEMIANNUAL: return addMonthsClamped(date, 6, anchorDay)
    // 29 February + a year is 1 March by the same rollover; clamp it to 28 February.
    case FREQUENCIES.ANNUAL: return addMonthsClamped(date, 12, anchorDay)
    default: return addMonthsClamped(date, 1, anchorDay)
  }
}

/**
 * The day of the month a schedule bills on, read off its start date.
 *
 * There is no `day_of_month` column — the route accepts `dayOfMonth` and the service has never
 * stored it — so `start_date` is the only record of what the business chose, and it is the right
 * one: a schedule that starts on the 31st is a 31st schedule.
 */
const anchorDayOf = (startDate: Date | string | null | undefined): number | undefined => {
  if (!startDate) return undefined
  const d = new Date(startDate)
  return Number.isNaN(d.getTime()) ? undefined : d.getDate()
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

  /**
   * A RECURRING INVOICE TAKES ITS NUMBER FROM THE SAME PLACE AS EVERY OTHER INVOICE. (T58k)
   *
   *   owner, on Landscaping: "INV-00072 and -00073 were issued again after being deleted."
   *
   * This had its own numbering, and it was the worst of the three shapes in the product: it took the
   * most recently CREATED invoice and incremented THAT one's number. So
   *
   *   · deleting the two newest invoices handed their numbers straight back — the owner's report; and
   *   · ordering by created_at rather than by the number means the newest row need not hold the
   *     highest number. Import a backlog, or renumber anything, and the "next" number is one past a
   *     middling row — a number something else already has. A duplicate, not just a reuse.
   *
   * It also explains why T58j looked fixed everywhere else: landscaping's invoices route DOES use the
   * shared createInvoiceRoutes, so ad-hoc invoices were numbered correctly all along. Only the
   * recurring generator — snow contracts and maintenance plans — came through here.
   *
   * Now the shared `nextNumber`: highest existing, the company's high-water mark, under the advisory
   * lock. It is given the caller's `tx` so the lock still holds when the row lands.
   */
  async function generateInvoiceNumber(tx: any, companyId: string): Promise<string> {
    return nextNumber(tx, invoice, invoice.number, invoice.companyId, companyId, { prefix: 'INV', pad: 5 })
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
    return camelRow(recurring, NESTED)
  }

  async function generateInvoiceFromRecurring(recurringId: string) {
    const [recurring] = rows(await db.execute(sql`
      SELECT ri.*, to_jsonb(c.*) - 'portal_token' - 'portal_token_exp' as contact, row_to_json(co.*) as company
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
    /**
     * Dated the COMPANY'S day, not the server's UTC instant. (T33)
     *
     * `new Date()` was stored straight into issue_date, and the screens render a calendar day by
     * slicing the first ten characters of the serialised value — the UTC date part, deliberately,
     * because that is how a day-valued field stays a day. So an invoice generated at 19:16 in
     * Chicago carried `2026-10-02T00:16Z` and was dated TOMORROW: the tester saw this evening's
     * invoices show 2 Oct.
     *
     * `storeDayStart` gives the instant the company's day begins, whose UTC date part IS that day —
     * the same helper the rest of the product uses for a day-valued field (guard #173).
     *
     * The due date is computed from it rather than from `new Date()`, so terms are counted from the
     * day on the invoice instead of being a day out of step with it.
     */
    const tz = companyRowTimeZone(recurring.company || {})
    const invoiceDate = storeDayStart(storeDateString(new Date(), tz), tz)
    const dueDate = calculateDueDate(invoiceDate, recurring.terms)

    /**
     * The number and the row are taken in ONE transaction, so the advisory lock nextNumber holds is
     * still held when the invoice lands — the monthly run generates many invoices back to back, and
     * a lock released before the insert would let two of them pick the same number. The line items
     * come with it: an invoice that commits without its lines is a £0 invoice sent to a customer.
     */
    const newInvoice = await db.transaction(async (tx: any) => {
      const number = await generateInvoiceNumber(tx, recurring.company_id)
      const [created] = await tx.insert(invoice).values({
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
        await tx.insert(invoiceLineItem).values({
          invoiceId: created.id,
          description: item.description,
          quantity: String(item.quantity),
          unitPrice: String(item.unit_price),
          total: String(item.total),
          sortOrder: item.sort_order,
        })
      }
      return created
    })

    const nextRunDate = calculateNextDate(recurring.next_run_date, recurring.frequency, anchorDayOf(recurring.start_date))
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
      SELECT ri.*, to_jsonb(c.*) - 'portal_token' - 'portal_token_exp' as contact, row_to_json(p.*) as project
      FROM recurring_invoice ri
      LEFT JOIN contact c ON c.id = ri.contact_id
      LEFT JOIN project p ON p.id = ri.project_id
      WHERE ${where}
      ORDER BY ri.created_at DESC
      LIMIT ${limitN} OFFSET ${offset}
    `))
    const [{ count: total }] = rows(await db.execute(sql`SELECT count(*)::int as count FROM recurring_invoice ri WHERE ${where}`))
    return { data: camelRows(data, NESTED), pagination: { page: pageN, limit: limitN, total, pages: Math.ceil(total / limitN) } }
  }

  async function getRecurringInvoice(id: string, companyId: string) {
    const [result] = rows(await db.execute(sql`
      SELECT ri.*, to_jsonb(c.*) - 'portal_token' - 'portal_token_exp' as contact, row_to_json(p.*) as project
      FROM recurring_invoice ri
      LEFT JOIN contact c ON c.id = ri.contact_id
      LEFT JOIN project p ON p.id = ri.project_id
      WHERE ri.id = ${id} AND ri.company_id = ${companyId}
    `))
    if (!result) return null
    const lineItemRows = rows(await db.execute(sql`
      SELECT * FROM recurring_line_item WHERE recurring_invoice_id = ${id} ORDER BY sort_order ASC
    `))
    result.lineItems = camelRows(lineItemRows)
    return camelRow(result, NESTED)
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
    return { ...camelRow(existing, NESTED), status: 'paused' }
  }

  async function resumeRecurringInvoice(id: string, companyId: string) {
    const [existing] = rows(await db.execute(sql`SELECT * FROM recurring_invoice WHERE id = ${id} AND company_id = ${companyId}`))
    if (!existing) return null
    let nextRunDate = new Date(existing.next_run_date)
    const now = new Date()
    // Same anchor on resume: walking a paused schedule forward a month at a time must not strand it
    // on a clamped day either.
    const anchor = anchorDayOf(existing.start_date)
    while (nextRunDate < now) nextRunDate = calculateNextDate(nextRunDate, existing.frequency, anchor)
    await db.execute(sql`UPDATE recurring_invoice SET status = 'active', next_run_date = ${nextRunDate} WHERE id = ${id}`)
    return { ...camelRow(existing, NESTED), status: 'active', nextRunDate }
  }

  async function cancelRecurringInvoice(id: string, companyId: string) {
    const [existing] = rows(await db.execute(sql`SELECT * FROM recurring_invoice WHERE id = ${id} AND company_id = ${companyId}`))
    if (!existing) return null
    await db.execute(sql`UPDATE recurring_invoice SET status = 'cancelled' WHERE id = ${id}`)
    return { ...camelRow(existing, NESTED), status: 'cancelled' }
  }

  async function deleteRecurringInvoice(id: string, companyId: string): Promise<boolean> {
    const [existing] = rows(await db.execute(sql`SELECT * FROM recurring_invoice WHERE id = ${id} AND company_id = ${companyId}`))
    if (!existing) return false
    await db.execute(sql`DELETE FROM recurring_line_item WHERE recurring_invoice_id = ${id}`)
    await db.execute(sql`DELETE FROM recurring_invoice WHERE id = ${id}`)
    return true
  }

  // The page shows Active / Paused / Total / Monthly revenue — total and the revenue were never returned, so those
  // two tiles were blank. Monthly revenue is what the ACTIVE schedules bill per month. (Landscaping T14 L5)
  async function getRecurringStats(companyId: string) {
    const [activeRes, pausedRes, totalRes, activeRows] = await Promise.all([
      db.execute(sql`SELECT count(*)::int as count FROM recurring_invoice WHERE company_id = ${companyId} AND status = 'active'`),
      db.execute(sql`SELECT count(*)::int as count FROM recurring_invoice WHERE company_id = ${companyId} AND status = 'paused'`),
      db.execute(sql`SELECT count(*)::int as count FROM recurring_invoice WHERE company_id = ${companyId}`),
      db.execute(sql`SELECT total, frequency FROM recurring_invoice WHERE company_id = ${companyId} AND status = 'active'`),
    ])
    const perMonth = (frequency: string) => {
      switch (String(frequency || '').toLowerCase()) {
        case 'weekly': return 52 / 12
        case 'biweekly': case 'bi-weekly': case 'fortnightly': return 26 / 12
        case 'quarterly': return 1 / 3
        case 'semiannual': case 'semi-annual': case 'semi_annual': return 1 / 6
        case 'annual': case 'yearly': return 1 / 12
        default: return 1 // monthly
      }
    }
    const monthly = rows(activeRows).reduce((sum: number, r: any) => sum + (Number(r.total) || 0) * perMonth(r.frequency), 0)
    return {
      active: rows(activeRes)[0]?.count || 0,
      paused: rows(pausedRes)[0]?.count || 0,
      total: rows(totalRes)[0]?.count || 0,
      monthlyRecurringRevenue: Math.round(monthly * 100) / 100,
    }
  }

  /**
   * The pause / resume / cancel path the routes ACTUALLY use.
   *
   * `pauseRecurringInvoice`, `resumeRecurringInvoice` and `cancelRecurringInvoice` below are exported
   * aliases that no route calls — the three endpoints share this one function through `statusChange`.
   * Worth saying out loud, because camelising the three named ones and stopping there left the real
   * endpoint still answering snake_case, and only a test that called the ROUTE noticed.
   */
  async function updateRecurringStatus(id: string, status: string, opts?: { nextRunDate?: Date }) {
    const sets = [sql`status = ${status}`]
    if (opts?.nextRunDate) sets.push(sql`next_run_date = ${opts.nextRunDate}`)
    const [updated] = rows(await db.execute(sql`UPDATE recurring_invoice SET ${sql.join(sets, sql`, `)} WHERE id = ${id} RETURNING *`))
    return camelRow(updated)
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
    /**
     * The service returns the invoice ITSELF, not { invoice }. (T32 500-2)
     *
     * This destructured `{ invoice }`, so `invoice` was undefined and `invoice.id` threw — AFTER the
     * invoice had been written and the schedule advanced a month. The caller saw a 500 on a charge
     * that had actually happened, so retrying double-billed the client: the tester got INV-00097 and
     * INV-00098 for one $158.25 run.
     *
     * Tolerating both shapes rather than only the right one, because the same service is called by the
     * cron path (processDueRecurring) and by any template that wires its own: a route that throws on an
     * unexpected shape turns a successful charge into an error, which is how this became a billing bug
     * rather than a cosmetic one.
     */
    const result = await service.generateInvoice(id) as any
    const invoice = result?.invoice ?? result
    if (!invoice?.id) {
      return c.json({ error: 'The invoice could not be generated.', code: 'generate_failed' }, 500)
    }
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

  /**
   * Cron endpoint — and it needs `invoices:create`, because it creates invoices. (T37)
   *
   * The comment here used to read "secure with an internal secret, not the user session", and all
   * three halves of that were wrong:
   *
   *   · It sits under `app.use('*', authenticate)` a few lines above, so it has ALWAYS required a
   *     user session. A secret-only caller could never have reached it.
   *   · The secret check was `if (process.env.CRON_SECRET && …)` — fail-OPEN. CRON_SECRET is not
   *     set in a tenant's environment by the deploy pipeline or render.yaml, so on every tenant the
   *     condition was false and the check was skipped entirely.
   *   · It had no permission gate, while every other write in this file has one.
   *
   * Net effect: any signed-in person could generate every due recurring invoice for the company —
   * a viewer, whose whole contract is read-only, or a field technician. Found while confirming the
   * T37 note about viewers reading /api/recurring (which IS correct: reads are gated on
   * invoices:read and a schedule is an invoice template).
   *
   * Nothing calls this endpoint — no internal caller, no Render cron, no template scheduler — so
   * the gate cannot break a caller. The secret check is kept for the day a real scheduler is wired
   * up, but it is no longer the only thing standing here.
   */
  /**
   * …AND IT IS THE COMPANY'S BILLING RUN, so the question is company:update. (T60)
   *
   *   Contractor: "The recurring-billing run returns 503 rather than a 403 role refusal."
   *
   * invoices:create let a manager through to the scheduler check, so the answer a manager got was
   * "no scheduler is configured" — true, and beside the point: a manager may not run every due
   * schedule for the whole company whether or not one is. Raising one invoice is a manager's job; a
   * company-wide run is the owner's and the admins', the same rung that changes the company. The
   * scheduler check still stands behind it, so an owner by hand still gets 503.
   */
  app.post('/process', requirePermission('company:update'), async (c: any) => {
    /**
     * FAIL CLOSED. The secret is REQUIRED, not "checked if configured". (T41)
     *
     * This morning I added `requirePermission('invoices:create')` and left the secret check as
     * `if (process.env.CRON_SECRET && …)`. T41 then pointed out the obvious: a MANAGER holds
     * invoices:create, so a manager could still run every due schedule for the company from a URL
     * with no screen offering it. My gate narrowed the door; it did not shut it.
     *
     * CRON_SECRET is not written into a tenant's environment by the deploy pipeline, the generator
     * or render.yaml, so in practice the condition was always false and the check never ran at all.
     * Requiring it means: no secret configured → nobody can trigger a company-wide billing run.
     * Nothing calls this endpoint today — no internal caller, no Render cron, no template scheduler
     * — so closing it costs nothing and removes the last way to reach it by hand.
     *
     * FOR WHOEVER WIRES A REAL SCHEDULER: this router sits under `app.use('*', authenticate)`, so a
     * secret-only caller with no user session cannot reach here however correct its header is. Mount
     * this route outside that middleware (the way /api/internal/* is) rather than loosening the
     * secret back to optional.
     */
    const configured = process.env.CRON_SECRET
    if (!configured) {
      return c.json({
        error: 'Recurring invoices are run on a schedule, not from here. No scheduler is configured for this tenant.',
        code: 'cron_not_configured',
      }, 503)
    }
    if (c.req.header('x-cron-secret') !== configured) return c.json({ error: 'Unauthorized' }, 401)
    return c.json(await service.processDueRecurring())
  })

  return app
}
