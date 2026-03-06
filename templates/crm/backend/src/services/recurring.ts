/**
 * Recurring Invoice Service
 *
 * Manages recurring invoice templates and generates invoices on schedule.
 *
 * NOTE: The schema does not include recurringInvoice / recurringInvoiceLineItem tables.
 * This module is a placeholder that mirrors the original logic using raw SQL via Drizzle's
 * `sql` helper.  Once the corresponding tables are added to the schema, swap in typed
 * table references.
 */

import { db } from '../../db/index.ts'
import { invoice, invoiceLineItem, contact, project } from '../../db/schema.ts'
import { eq, and, lte, desc, sql } from 'drizzle-orm'
import emailService from './email.js'

/**
 * Frequency options
 */
export const FREQUENCIES = {
  WEEKLY: 'weekly',
  BIWEEKLY: 'biweekly',
  MONTHLY: 'monthly',
  QUARTERLY: 'quarterly',
  SEMIANNUAL: 'semiannual',
  ANNUAL: 'annual',
} as const

export type Frequency = (typeof FREQUENCIES)[keyof typeof FREQUENCIES]

/**
 * Calculate next invoice date based on frequency
 */
export function calculateNextDate(fromDate: Date | string, frequency: string): Date {
  const date = new Date(fromDate)

  switch (frequency) {
    case FREQUENCIES.WEEKLY:
      date.setDate(date.getDate() + 7)
      break
    case FREQUENCIES.BIWEEKLY:
      date.setDate(date.getDate() + 14)
      break
    case FREQUENCIES.MONTHLY:
      date.setMonth(date.getMonth() + 1)
      break
    case FREQUENCIES.QUARTERLY:
      date.setMonth(date.getMonth() + 3)
      break
    case FREQUENCIES.SEMIANNUAL:
      date.setMonth(date.getMonth() + 6)
      break
    case FREQUENCIES.ANNUAL:
      date.setFullYear(date.getFullYear() + 1)
      break
    default:
      date.setMonth(date.getMonth() + 1)
  }

  return date
}

/**
 * Calculate due date based on terms
 */
function calculateDueDate(invoiceDate: Date, terms: string): Date {
  const date = new Date(invoiceDate)
  const days = parseInt(terms) || 30
  date.setDate(date.getDate() + days)
  return date
}

/**
 * Generate next invoice number
 */
async function generateInvoiceNumber(companyId: string): Promise<string> {
  const [lastInvoice] = await db
    .select({ number: invoice.number })
    .from(invoice)
    .where(eq(invoice.companyId, companyId))
    .orderBy(desc(invoice.createdAt))
    .limit(1)

  if (!lastInvoice) {
    return 'INV-00001'
  }

  const match = lastInvoice.number.match(/(\d+)$/)
  if (match) {
    const num = parseInt(match[1]) + 1
    const prefix = lastInvoice.number.replace(/\d+$/, '')
    return `${prefix}${String(num).padStart(5, '0')}`
  }

  return `INV-${Date.now()}`
}

/**
 * Create a recurring invoice template
 *
 * Because the schema has no recurringInvoice table we fall back to raw SQL.
 */
export async function createRecurringInvoice(data: any, companyId: string) {
  const {
    contactId,
    projectId,
    frequency,
    startDate,
    endDate,
    terms,
    lineItems,
    notes,
    autoSend,
  } = data

  // Calculate totals
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

  // Raw insert into recurring_invoice (table assumed to exist at DB level)
  const [recurring] = await db.execute(sql`
    INSERT INTO recurring_invoice (company_id, contact_id, project_id, frequency, start_date, end_date, next_run_date, terms, subtotal, tax_rate, tax_amount, discount, total, notes, auto_send, status)
    VALUES (${companyId}, ${contactId}, ${projectId || null}, ${frequency}, ${new Date(startDate)}, ${endDate ? new Date(endDate) : null}, ${new Date(startDate)}, ${terms || '30'}, ${subtotal}, ${taxRate}, ${taxAmount}, ${discount}, ${total}, ${notes}, ${autoSend || false}, 'active')
    RETURNING *
  `) as any

  const recurringId = (recurring as any).id ?? (recurring as any)[0]?.id

  for (const item of processedItems) {
    await db.execute(sql`
      INSERT INTO recurring_invoice_line_item (recurring_invoice_id, description, quantity, unit_price, total, sort_order)
      VALUES (${recurringId}, ${item.description}, ${item.quantity || 1}, ${item.unitPrice || 0}, ${item.total}, ${item.sortOrder})
    `)
  }

  return recurring
}

/**
 * Generate invoice from recurring template
 */
export async function generateInvoiceFromRecurring(recurringId: string) {
  const [recurring] = (await db.execute(sql`
    SELECT ri.*, row_to_json(c.*) as contact, row_to_json(co.*) as company
    FROM recurring_invoice ri
    LEFT JOIN contact c ON c.id = ri.contact_id
    LEFT JOIN company co ON co.id = ri.company_id
    WHERE ri.id = ${recurringId}
  `)) as any[]

  if (!recurring) {
    throw new Error('Recurring invoice not found')
  }

  if (recurring.status !== 'active') {
    throw new Error('Recurring invoice is not active')
  }

  const lineItems = (await db.execute(sql`
    SELECT * FROM recurring_invoice_line_item WHERE recurring_invoice_id = ${recurringId} ORDER BY sort_order ASC
  `)) as any[]

  // Generate invoice number
  const number = await generateInvoiceNumber(recurring.company_id)

  // Calculate dates
  const invoiceDate = new Date()
  const dueDate = calculateDueDate(invoiceDate, recurring.terms)

  // Create invoice
  const [newInvoice] = await db
    .insert(invoice)
    .values({
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
    })
    .returning()

  // Create invoice line items
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

  // Update recurring invoice
  const nextRunDate = calculateNextDate(recurring.next_run_date, recurring.frequency)

  let newStatus = recurring.status
  if (recurring.end_date && nextRunDate > new Date(recurring.end_date)) {
    newStatus = 'completed'
  }

  await db.execute(sql`
    UPDATE recurring_invoice SET next_run_date = ${nextRunDate}, last_run_date = ${invoiceDate}, invoice_count = invoice_count + 1, status = ${newStatus}
    WHERE id = ${recurringId}
  `)

  // Auto-send if enabled
  if (recurring.auto_send && recurring.contact?.email) {
    await db
      .update(invoice)
      .set({ status: 'sent', sentAt: new Date() })
      .where(eq(invoice.id, newInvoice.id))

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

/**
 * Process all due recurring invoices (run via cron daily)
 */
export async function processRecurringInvoices() {
  const now = new Date()

  const dueRecurring = (await db.execute(sql`
    SELECT * FROM recurring_invoice WHERE status = 'active' AND next_run_date <= ${now}
  `)) as any[]

  const results: any[] = []

  for (const recurring of dueRecurring) {
    try {
      const inv = await generateInvoiceFromRecurring(recurring.id)
      results.push({ recurringId: recurring.id, success: true, invoiceId: inv.id, invoiceNumber: inv.number })
    } catch (error: any) {
      results.push({ recurringId: recurring.id, success: false, error: error.message })
    }
  }

  return {
    processed: results.length,
    successful: results.filter((r) => r.success).length,
    results,
  }
}

/**
 * Get recurring invoices
 */
export async function getRecurringInvoices(
  companyId: string,
  { status, contactId, page = 1, limit = 25 }: { status?: string; contactId?: string; page?: number; limit?: number }
) {
  const conditions: string[] = [`ri.company_id = '${companyId}'`]
  if (status) conditions.push(`ri.status = '${status}'`)
  if (contactId) conditions.push(`ri.contact_id = '${contactId}'`)
  const where = conditions.join(' AND ')
  const offset = (page - 1) * limit

  const data = (await db.execute(sql.raw(`
    SELECT ri.*, row_to_json(c.*) as contact, row_to_json(p.*) as project
    FROM recurring_invoice ri
    LEFT JOIN contact c ON c.id = ri.contact_id
    LEFT JOIN project p ON p.id = ri.project_id
    WHERE ${where}
    ORDER BY ri.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `))) as any[]

  const [{ count: total }] = (await db.execute(sql.raw(`SELECT count(*)::int as count FROM recurring_invoice ri WHERE ${where}`))) as any[]

  return {
    data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  }
}

/**
 * Get single recurring invoice
 */
export async function getRecurringInvoice(id: string, companyId: string) {
  const [result] = (await db.execute(sql`
    SELECT ri.*, row_to_json(c.*) as contact, row_to_json(p.*) as project
    FROM recurring_invoice ri
    LEFT JOIN contact c ON c.id = ri.contact_id
    LEFT JOIN project p ON p.id = ri.project_id
    WHERE ri.id = ${id} AND ri.company_id = ${companyId}
  `)) as any[]

  if (!result) return null

  const lineItemRows = (await db.execute(sql`
    SELECT * FROM recurring_invoice_line_item WHERE recurring_invoice_id = ${id} ORDER BY sort_order ASC
  `)) as any[]

  result.lineItems = lineItemRows

  return result
}

/**
 * Update recurring invoice
 */
export async function updateRecurringInvoice(id: string, companyId: string, data: any) {
  const [existing] = (await db.execute(sql`
    SELECT * FROM recurring_invoice WHERE id = ${id} AND company_id = ${companyId}
  `)) as any[]
  if (!existing) return null

  if (data.lineItems) {
    await db.execute(sql`DELETE FROM recurring_invoice_line_item WHERE recurring_invoice_id = ${id}`)

    let subtotal = 0
    const processedItems = (data.lineItems as any[]).map((item: any, index: number) => {
      const total = (item.quantity || 1) * (item.unitPrice || 0)
      subtotal += total
      return {
        description: item.description,
        quantity: item.quantity || 1,
        unitPrice: item.unitPrice || 0,
        total,
        sortOrder: index,
        recurringInvoiceId: id,
      }
    })

    for (const item of processedItems) {
      await db.execute(sql`
        INSERT INTO recurring_invoice_line_item (recurring_invoice_id, description, quantity, unit_price, total, sort_order)
        VALUES (${id}, ${item.description}, ${item.quantity}, ${item.unitPrice}, ${item.total}, ${item.sortOrder})
      `)
    }

    const taxRate = data.taxRate ?? existing.tax_rate
    const taxAmount = subtotal * (taxRate / 100)
    const discount = data.discount ?? existing.discount
    const total = subtotal + taxAmount - discount

    delete data.lineItems
    Object.assign(data, { subtotal, taxRate, taxAmount, discount, total })
  }

  // Build SET clause dynamically
  const sets: string[] = []
  if (data.frequency !== undefined) sets.push(`frequency = '${data.frequency}'`)
  if (data.autoSend !== undefined) sets.push(`auto_send = ${data.autoSend}`)
  if (data.status !== undefined) sets.push(`status = '${data.status}'`)
  if (data.subtotal !== undefined) sets.push(`subtotal = ${data.subtotal}`)
  if (data.taxRate !== undefined) sets.push(`tax_rate = ${data.taxRate}`)
  if (data.taxAmount !== undefined) sets.push(`tax_amount = ${data.taxAmount}`)
  if (data.discount !== undefined) sets.push(`discount = ${data.discount}`)
  if (data.total !== undefined) sets.push(`total = ${data.total}`)
  if (data.notes !== undefined) sets.push(`notes = '${data.notes}'`)

  if (sets.length > 0) {
    await db.execute(sql.raw(`UPDATE recurring_invoice SET ${sets.join(', ')} WHERE id = '${id}'`))
  }

  return getRecurringInvoice(id, companyId)
}

/**
 * Pause recurring invoice
 */
export async function pauseRecurringInvoice(id: string, companyId: string) {
  const [existing] = (await db.execute(sql`
    SELECT * FROM recurring_invoice WHERE id = ${id} AND company_id = ${companyId}
  `)) as any[]
  if (!existing) return null

  await db.execute(sql`UPDATE recurring_invoice SET status = 'paused' WHERE id = ${id}`)
  return { ...existing, status: 'paused' }
}

/**
 * Resume recurring invoice
 */
export async function resumeRecurringInvoice(id: string, companyId: string) {
  const [existing] = (await db.execute(sql`
    SELECT * FROM recurring_invoice WHERE id = ${id} AND company_id = ${companyId}
  `)) as any[]
  if (!existing) return null

  let nextRunDate = new Date(existing.next_run_date)
  const now = new Date()
  while (nextRunDate < now) {
    nextRunDate = calculateNextDate(nextRunDate, existing.frequency)
  }

  await db.execute(sql`UPDATE recurring_invoice SET status = 'active', next_run_date = ${nextRunDate} WHERE id = ${id}`)
  return { ...existing, status: 'active', next_run_date: nextRunDate }
}

/**
 * Cancel recurring invoice
 */
export async function cancelRecurringInvoice(id: string, companyId: string) {
  const [existing] = (await db.execute(sql`
    SELECT * FROM recurring_invoice WHERE id = ${id} AND company_id = ${companyId}
  `)) as any[]
  if (!existing) return null

  await db.execute(sql`UPDATE recurring_invoice SET status = 'cancelled' WHERE id = ${id}`)
  return { ...existing, status: 'cancelled' }
}

/**
 * Delete recurring invoice
 */
export async function deleteRecurringInvoice(id: string, companyId: string): Promise<boolean> {
  const [existing] = (await db.execute(sql`
    SELECT * FROM recurring_invoice WHERE id = ${id} AND company_id = ${companyId}
  `)) as any[]
  if (!existing) return false

  await db.execute(sql`DELETE FROM recurring_invoice_line_item WHERE recurring_invoice_id = ${id}`)
  await db.execute(sql`DELETE FROM recurring_invoice WHERE id = ${id}`)
  return true
}

export default {
  FREQUENCIES,
  calculateNextDate,
  createRecurringInvoice,
  generateInvoiceFromRecurring,
  processRecurringInvoices,
  getRecurringInvoices,
  getRecurringInvoice,
  updateRecurringInvoice,
  pauseRecurringInvoice,
  resumeRecurringInvoice,
  cancelRecurringInvoice,
  deleteRecurringInvoice,
}
