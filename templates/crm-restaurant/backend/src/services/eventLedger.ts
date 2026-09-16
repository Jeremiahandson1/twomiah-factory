import { db } from '../../db/index.ts'
import { event, eventMenuItem, eventPayment, invoice, invoiceLineItem, payment, contact, project, quote, company } from '../../db/schema.ts'
import { and, asc, eq, sql } from 'drizzle-orm'
import { insertInvoice, retotalInvoice, replaceInvoiceLines, invoiceBalance, recomputeStatus, defaultTaxRateFrom, calcTotals, round2 } from '../shared/index.ts'

/**
 * Events money — ONE ledger. An event's deposits and balance live on a single invoice (invoice.eventId),
 * the same invoice as the rest of the CRM, so Reports, the invoice list, the dashboard, refunds, the
 * client portal and QuickBooks all see event money. The event keeps only the SCHEDULE (event_payment:
 * label, amount, due date). Invoices are created and re-totalled through the shared invoicing code
 * (insertInvoice / retotalInvoice) and paid / refunded / voided through the shared invoice routes.
 *
 *   invoice lines  = the event's menu lines (room hire included), plus "Balance of quoted total" while the
 *                    menu is below the quote — so the invoice total is max(menu, quote) + tax
 *   installment    = paid once the invoice has collected enough to cover it and every earlier one
 *   invoice due    = the first installment not yet covered (else the event date), so the invoice turns
 *                    overdue exactly when a scheduled payment is missed
 */

// Same as the invoice routes' numbering (routes/invoices.ts passes this constant), so an event invoice
// takes the next INV-00000 in the one sequence.
export const INVOICE_NUMBERING = { prefix: 'INV', pad: 5, seed: 0 }
const TABLES = { invoice, invoiceLineItem, payment, contact, project, quote, company }
// Billed and collectable, not emailed — the invoice exists the moment a payment is scheduled; sending it
// to the client is a separate, deliberate step on the invoice.
const EVENT_INVOICE_STATUS = 'open'
// The event has left the book; its invoice is closed by closeEventInvoice and no longer follows the menu.
export const EXIT_STATUSES = ['cancelled', 'lost']

export class LedgerError extends Error {
  constructor(message: string, public status: 400 | 404 | 409 = 400) { super(message) }
}

const ledgerLock = (tx: any, companyId: string, eventId: string) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId + ':event-ledger:' + eventId}))`)

type Line = { description: string; quantity: number; unitPrice: number }

/** Invoice lines for an event: its menu, topped up to the quoted total while the menu is still below it. */
export function eventInvoiceLines(ev: { name: string; quotedTotal: any }, menu: Array<{ name: string; quantity: any; unitPrice: any }>): Line[] {
  const lines: Line[] = menu.map((l) => ({ description: l.name, quantity: Math.max(0, Number(l.quantity) || 0), unitPrice: Math.max(0, Number(l.unitPrice) || 0) }))
  const menuTotal = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0))
  const quoted = round2(Number(ev.quotedTotal) || 0)
  if (quoted > menuTotal + 0.005) {
    lines.push({ description: lines.length ? 'Balance of quoted total' : `Quoted total — ${ev.name}`, quantity: 1, unitPrice: round2(quoted - menuTotal) })
  }
  return lines
}

export type InstallmentState = 'paid' | 'part_paid' | 'unpaid' | 'refunded' | 'void'

/**
 * Each scheduled installment with what the invoice has covered of it, in due-date order. "Covered" is
 * total − balance, so it follows the shared refund model: a refunded deposit reopens its installment.
 */
export function installmentStates(inv: any | null, schedule: any[]) {
  const ordered = [...schedule].sort((a, b) =>
    (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31') || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  const covered = inv && inv.status !== 'void' ? round2(Number(inv.total) - invoiceBalance(inv)) : 0
  let before = 0
  return ordered.map((p) => {
    const amount = round2(Number(p.amount) || 0)
    const paidAmount = round2(Math.min(amount, Math.max(0, covered - before)))
    before = round2(before + amount)
    const state: InstallmentState = inv?.status === 'void' ? 'void'
      : inv?.status === 'refunded' ? 'refunded'
      : paidAmount >= amount - 0.005 ? 'paid'
      : paidAmount > 0.005 ? 'part_paid' : 'unpaid'
    return { id: p.id, eventId: p.eventId, label: p.label, amount, dueDate: p.dueDate, notes: p.notes, createdAt: p.createdAt, paidAmount, state }
  })
}

/** The invoice is due when the first installment not yet covered is due; with none left, on the event date. */
export function invoiceDueDate(ev: { eventDate: string }, states: Array<{ state: InstallmentState; dueDate: string | null }>): Date {
  const next = states.find((s) => s.state === 'unpaid' || s.state === 'part_paid')
  return new Date(next?.dueDate || ev.eventDate)
}

async function readEventMoney(exec: any, companyId: string, eventId: string, forUpdate: boolean) {
  const [ev] = await exec.select().from(event).where(and(eq(event.id, eventId), eq(event.companyId, companyId))).limit(1)
  if (!ev) return null
  const menu = await exec.select().from(eventMenuItem)
    .where(and(eq(eventMenuItem.eventId, eventId), eq(eventMenuItem.companyId, companyId)))
    .orderBy(asc(eventMenuItem.createdAt))
  const schedule = await exec.select().from(eventPayment)
    .where(and(eq(eventPayment.eventId, eventId), eq(eventPayment.companyId, companyId)))
    .orderBy(asc(eventPayment.dueDate), asc(eventPayment.createdAt))
  // Row-lock the invoice like the shared payment/refund/void handlers do, so a total can't be lowered
  // underneath a payment landing at the same instant.
  if (forUpdate) await exec.execute(sql`SELECT id FROM invoice WHERE event_id = ${eventId} AND company_id = ${companyId} FOR UPDATE`)
  const [inv] = await exec.select().from(invoice).where(and(eq(invoice.eventId, eventId), eq(invoice.companyId, companyId))).limit(1)
  return { ev, menu, schedule, inv: inv || null }
}

/** Read-only view for the event page, the BEO and the dashboard. */
export async function loadEventLedger(companyId: string, eventId: string | undefined) {
  if (!eventId) return null
  const m = await readEventMoney(db, companyId, eventId, false)
  if (!m) return null
  const { ev, menu, schedule, inv } = m
  const menuTotal = round2(menu.reduce((s: number, l: any) => s + Number(l.unitPrice || 0) * Number(l.quantity || 0), 0))
  // Minimum spend is food & beverage: the room-hire line (spaceId set) doesn't count toward it.
  const fbTotal = round2(menu.filter((l: any) => !l.spaceId).reduce((s: number, l: any) => s + Number(l.unitPrice || 0) * Number(l.quantity || 0), 0))
  const quoted = round2(Number(ev.quotedTotal || 0))
  const payments = installmentStates(inv, schedule)
  const totals = inv
    ? { menuTotal, fbTotal, quoted, invoiced: true, total: round2(Number(inv.total)), tax: round2(Number(inv.taxAmount)),
        paid: round2(Number(inv.amountPaid || 0) - Number(inv.amountRefunded || 0)), refunded: round2(Number(inv.amountRefunded || 0)), outstanding: invoiceBalance(inv) }
    : { menuTotal, fbTotal, quoted, invoiced: false, total: Math.max(menuTotal, quoted), tax: 0, paid: 0, refunded: 0, outstanding: Math.max(menuTotal, quoted) }
  return { ev, menu, payments, invoice: inv, totals }
}

/**
 * The event's invoice, raised now if it doesn't exist yet (first scheduled payment). Runs inside the
 * caller's transaction. A void invoice from an earlier cancellation stays on record, detached, and a
 * fresh one is raised.
 */
export async function ensureEventInvoice(tx: any, companyId: string, eventId: string | undefined) {
  if (!eventId) throw new LedgerError('Event not found', 404)
  await ledgerLock(tx, companyId, eventId)
  const m = await readEventMoney(tx, companyId, eventId, true)
  if (!m) throw new LedgerError('Event not found', 404)
  if (m.inv && m.inv.status !== 'void') return m
  if (!m.ev.contactId) throw new LedgerError('Add a client to this event before scheduling payments — the invoice is raised to them.')
  if (m.inv) await tx.update(invoice).set({ eventId: null, updatedAt: new Date() }).where(eq(invoice.id, m.inv.id))
  const [co] = await tx.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
  const now = new Date()
  const createdAt = m.ev.createdAt ? new Date(m.ev.createdAt) : now
  const created = await insertInvoice(tx, TABLES, INVOICE_NUMBERING, {
    companyId, contactId: m.ev.contactId, notes: `Event: ${m.ev.name} — ${m.ev.eventDate}`,
    issueDate: createdAt < now ? createdAt : now, dueDate: new Date(m.ev.eventDate),
    taxRate: defaultTaxRateFrom(co?.settings), status: EVENT_INVOICE_STATUS,
  }, eventInvoiceLines(m.ev, m.menu))
  await tx.update(invoice).set({ eventId }).where(eq(invoice.id, created.id))
  return { ...m, inv: { ...created, eventId } }
}

const sameLines = (current: any[], next: Line[]) =>
  current.length === next.length && current.every((c, i) =>
    c.description === next[i].description && Math.abs(Number(c.quantity) - next[i].quantity) < 0.005 && Math.abs(Number(c.unitPrice) - next[i].unitPrice) < 0.005)

/**
 * Keep the event's invoice in step with the event, inside the caller's transaction: lines (menu / quote),
 * client, and due date. A change that would take the total below money already collected throws a
 * LedgerError, so the caller's whole write rolls back. linesToo=false only moves the due date (used after
 * a payment, refund, void or edit made on the invoice itself).
 */
export async function syncEventInvoice(tx: any, companyId: string, eventId: string | undefined, opts: { linesToo?: boolean } = {}) {
  if (!eventId) return null
  const linesToo = opts.linesToo !== false
  await ledgerLock(tx, companyId, eventId)
  const m = await readEventMoney(tx, companyId, eventId, true)
  if (!m?.inv) return m
  const inv = m.inv
  const updates: Record<string, any> = {}
  if (linesToo && !EXIT_STATUSES.includes(m.ev.status) && inv.status !== 'void' && inv.status !== 'refunded') {
    const lines = eventInvoiceLines(m.ev, m.menu)
    const current = await tx.select().from(invoiceLineItem).where(eq(invoiceLineItem.invoiceId, inv.id)).orderBy(asc(invoiceLineItem.sortOrder))
    if (!sameLines(current, lines)) {
      const retotal = retotalInvoice(inv, lines, Number(inv.taxRate), Number(inv.discount))
      if ('error' in retotal) throw new LedgerError(retotal.error)
      Object.assign(updates, retotal.fields)
      await replaceInvoiceLines(tx, TABLES, inv.id, lines)
    }
    if (m.ev.contactId && m.ev.contactId !== inv.contactId) updates.contactId = m.ev.contactId
  }
  const after = { ...inv, ...updates }
  const due = invoiceDueDate(m.ev, installmentStates(after, m.schedule))
  if (!inv.dueDate || new Date(inv.dueDate).getTime() !== due.getTime()) updates.dueDate = due
  if (Object.keys(updates).length) {
    updates.updatedAt = new Date()
    await tx.update(invoice).set(updates).where(eq(invoice.id, inv.id))
  }
  return { ...m, inv: { ...after, dueDate: due } }
}

/** After a payment / refund / void / edit on an invoice: if it belongs to an event, move its due date. */
export async function syncEventInvoiceDueDate(invoiceId: string) {
  const [row] = await db.select({ eventId: invoice.eventId, companyId: invoice.companyId }).from(invoice).where(eq(invoice.id, invoiceId)).limit(1)
  const eventId = row?.eventId
  if (!eventId) return
  await db.transaction((tx: any) => syncEventInvoice(tx, row.companyId, eventId, { linesToo: false }))
}

/**
 * The event is leaving the book (cancelled / lost). Nothing collected → the invoice is voided. Money
 * collected → the caller must choose: keepDeposit closes the invoice at what was collected; otherwise
 * refuse, so the money is refunded on the invoice first.
 *
 * The closed invoice bills exactly the money that came in (gross), untaxed: "Deposit retained" for what
 * was kept, plus "Refunded" for anything already returned — the refund itself stays on the payment
 * ledger. That keeps it inside the shared money model: the total never drops below amountPaid, the
 * balance is 0 and the status is 'paid' (a total of only the kept amount would read as a whole-sale
 * return once refunds ≥ total).
 */
export async function closeEventInvoice(tx: any, companyId: string, eventId: string | undefined, keepDeposit: boolean) {
  if (!eventId) return
  await ledgerLock(tx, companyId, eventId)
  const m = await readEventMoney(tx, companyId, eventId, true)
  if (!m?.inv || m.inv.status === 'void' || m.inv.status === 'refunded') return
  const inv = m.inv
  const kept = round2(Number(inv.amountPaid || 0) - Number(inv.amountRefunded || 0))
  if (kept <= 0.005) {
    const note = `Voided: event ${m.ev.status === 'lost' ? 'lost' : 'cancelled'}`
    await tx.update(invoice).set({ status: 'void', notes: inv.notes ? `${inv.notes}\n${note}` : note, updatedAt: new Date() }).where(eq(invoice.id, inv.id))
    return
  }
  if (!keepDeposit) {
    throw new LedgerError(`$${kept.toFixed(2)} has been collected for this event. Keep it as a retained deposit, or refund it on invoice ${inv.number} first.`, 409)
  }
  const refunded = round2(Number(inv.amountRefunded || 0))
  const lines = [{ description: `Deposit retained — ${m.ev.name} cancelled`, quantity: 1, unitPrice: kept }]
  if (refunded > 0.005) lines.push({ description: `Refunded — ${m.ev.name} cancelled`, quantity: 1, unitPrice: refunded })
  const retotal = retotalInvoice(inv, lines, 0, 0)
  if ('error' in retotal) throw new LedgerError(retotal.error)
  await replaceInvoiceLines(tx, TABLES, inv.id, lines)
  await tx.update(invoice).set({ ...retotal.fields, paidAt: inv.paidAt || new Date(), updatedAt: new Date() }).where(eq(invoice.id, inv.id))
}

/** Legacy free-text method → the invoice payment method enum. */
function paymentMethod(v: string | null): string {
  const s = String(v || '').toLowerCase()
  if (/card|visa|amex|master/.test(s)) return 'card'
  if (/cash/.test(s)) return 'cash'
  if (/check|cheque/.test(s)) return 'check'
  if (/transfer|bank|ach|wire/.test(s)) return 'bank_transfer'
  if (/stripe/.test(s)) return 'stripe'
  return 'other'
}

/**
 * One-time move of money recorded on event_payment (before the ledger moved onto invoices) onto each
 * event's invoice: the invoice is raised from the menu/quote, and every row marked paid becomes a real
 * payment dated when it was paid. Idempotent — an event that already has an invoice is skipped, and each
 * event is converted in its own transaction. Events with no client can't be invoiced and are left as
 * they are (logged). No room-hire line is added: existing events recorded room hire by hand.
 */
let backfillRan = false
export async function backfillEventInvoices() {
  if (backfillRan) return
  backfillRan = true
  const res: any = await db.execute(sql`
    SELECT DISTINCT ep.event_id AS "eventId", ep.company_id AS "companyId"
    FROM event_payment ep LEFT JOIN invoice i ON i.event_id = ep.event_id
    WHERE i.id IS NULL`)
  const pending: Array<{ eventId: string; companyId: string }> = res.rows || res
  let converted = 0
  for (const { eventId, companyId } of pending) {
    try {
      const done = await db.transaction(async (tx: any) => {
        await ledgerLock(tx, companyId, eventId)
        const m = await readEventMoney(tx, companyId, eventId, true)
        if (!m || m.inv) return false
        if (!m.ev.contactId) { console.warn(`[events] backfill: event ${eventId} has payments but no client — left unconverted`); return false }
        const paidRows = m.schedule.filter((p: any) => p.paidAt)
        const collected = round2(paidRows.reduce((s: number, p: any) => s + Number(p.amount || 0), 0))
        const [co] = await tx.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
        const taxRate = defaultTaxRateFrom(co?.settings)
        const lines = eventInvoiceLines(m.ev, m.menu)
        // Money already taken can't exceed the invoice: if it does, record the difference as its own line
        // rather than lose a payment.
        const total = calcTotals(lines, taxRate, 0).total
        if (collected > total + 0.005) lines.push({ description: 'Payments recorded before invoicing', quantity: 1, unitPrice: round2(Math.ceil(((collected - total) / (1 + taxRate / 100)) * 100) / 100) })
        const earliest = [m.ev.createdAt, ...m.schedule.map((p: any) => p.createdAt)].map((d: any) => new Date(d)).sort((a, b) => a.getTime() - b.getTime())[0]
        const created = await insertInvoice(tx, TABLES, INVOICE_NUMBERING, {
          companyId, contactId: m.ev.contactId, notes: `Event: ${m.ev.name} — ${m.ev.eventDate}`,
          issueDate: earliest, dueDate: new Date(m.ev.eventDate), taxRate, status: EVENT_INVOICE_STATUS,
        }, lines)
        for (const p of paidRows) {
          await tx.insert(payment).values({
            invoiceId: created.id, amount: round2(Number(p.amount)).toString(), method: paymentMethod(p.method),
            reference: p.reference || null, notes: `${p.label}${p.method ? ` (${p.method})` : ''} — recorded on the event`, paidAt: new Date(p.paidAt),
          })
        }
        const status = collected > 0 ? recomputeStatus({ total: created.total, amountPaid: collected, amountRefunded: 0 }, EVENT_INVOICE_STATUS, EVENT_INVOICE_STATUS) : EVENT_INVOICE_STATUS
        const settled = collected >= Number(created.total) - 0.005 && collected > 0
        const lastPaidAt = paidRows.map((p: any) => new Date(p.paidAt)).sort((a: Date, b: Date) => b.getTime() - a.getTime())[0]
        await tx.update(invoice).set({ eventId, amountPaid: collected.toString(), status, paidAt: settled ? lastPaidAt : null, updatedAt: new Date() }).where(eq(invoice.id, created.id))
        await syncEventInvoice(tx, companyId, eventId, { linesToo: false })
        return true
      })
      if (done) converted++
    } catch (err: any) {
      console.error(`[events] backfill failed for event ${eventId}:`, err?.message || err)
    }
  }
  if (converted) console.log(`[events] moved ${converted} event payment schedule(s) onto invoices`)
}
