// Automatic invoice reminders and the optional late fee — the emails the CRM had written (crm/messages.ts invoiceReminder
// and invoiceOverdue, home care's homecareInvoiceReminder) that nothing ever sent (matrix 10/23: "the email wording exists
// but nothing sends it"). Every vertical's invoices (the CRM's `invoice`) and home care's Billing invoices (`invoices`).
//
// The rules, all on the company's own clock (Settings › Company's time zone — companyRowTimeZone, storeDateString):
//   · nothing goes out unless the company switched reminders on (company.settings.invoiceReminders.enabled; off by default);
//   · a pass runs every hour, and sends only from 8am on the company's clock, so a reminder never lands at 2am;
//   · "due soon": once, when the due day is within the days the company chose (0 = never);
//   · "overdue": once per step the company chose (e.g. 1, 7 and 14 days late) — the latest step reached, so an invoice
//     found 30 days late sends one email, not three;
//   · every step is claimed in reminder_log BEFORE the email goes, and its unique index (company, kind, invoice, step)
//     is what makes "once" true when two passes overlap. A step names the due day, so a moved due date earns its own;
//   · the customer who unsubscribed (contact.emailOptOut) is never emailed; a customer with no email is skipped, and
//     the log says why;
//   · each email carries the invoice's own pay link (/d/<token>, minted on first need, never changed);
//   · the late fee (off by default): a percent of the balance or a flat amount, once per invoice, after the days chosen —
//     added as a visible line on the invoice ("Late fee"), the totals worked out the way every edit works them out, and
//     an audit row naming the before and after. Not on home care's Billing invoices: their lines are caregiver visits
//     (each needs a caregiver and hours) and most are billed to Medicaid and other payers; their reminders still go.
import { and, eq, inArray, isNotNull, ne, asc } from 'drizzle-orm'
import {
  invoiceBalance, retotalInvoice, round2, money, documentLinkToken, documentLinkPath, companyRowTimeZone, storeDateString,
  daysUntilMarker, markerDay,
} from '@twomiah/tenant-backend'
import { company, contact, invoice, invoiceLineItem, invoices, clients, reminderLog } from '../../db/schema/index.ts'
import { appendInvoiceNote } from '../../data/homecareBillingRoutes.ts'
import type { Logger } from '../../core/logger.ts'

/** The hour of the company's day from which reminders go out. */
export const SEND_FROM_HOUR = 8
/** Statuses that mean "sent to the customer and still owed". A salon's 'open' in-chair sale was never emailed. */
const OPEN = ['sent', 'viewed', 'partial']
const MAX_OVERDUE_STEPS = 5

export interface LateFeeSettings { enabled: boolean; type: 'percent' | 'flat'; amount: number; afterDays: number }
export interface InvoiceReminderSettings { enabled: boolean; dueSoonDays: number; overdueDays: number[]; lateFee: LateFeeSettings }

export const DEFAULT_REMINDERS: InvoiceReminderSettings = {
  enabled: false, dueSoonDays: 3, overdueDays: [1, 7, 14],
  lateFee: { enabled: false, type: 'percent', amount: 1.5, afterDays: 30 },
}

const int = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Number(v)
  return Number.isInteger(n) && n >= lo && n <= hi ? n : fallback
}

/** The company's reminder settings, every gap filled with what the engine actually uses. */
export function reminderSettings(settings: unknown): InvoiceReminderSettings {
  let s: any = settings
  if (typeof s === 'string') { try { s = JSON.parse(s) } catch { s = null } }
  const r = s?.invoiceReminders || {}
  const steps = Array.isArray(r.overdueDays) ? r.overdueDays : DEFAULT_REMINDERS.overdueDays
  const overdueDays = [...new Set(steps.map((d: unknown) => int(d, 1, 365, 0)).filter((d: number) => d > 0))].sort((a, b) => (a as number) - (b as number)).slice(0, MAX_OVERDUE_STEPS) as number[]
  const f = r.lateFee || {}
  const amount = Number(f.amount)
  return {
    enabled: r.enabled === true,
    dueSoonDays: int(r.dueSoonDays, 0, 30, DEFAULT_REMINDERS.dueSoonDays),
    overdueDays,
    lateFee: {
      enabled: f.enabled === true,
      type: f.type === 'flat' ? 'flat' : 'percent',
      amount: Number.isFinite(amount) && amount >= 0 ? round2(amount) : DEFAULT_REMINDERS.lateFee.amount,
      afterDays: int(f.afterDays, 1, 365, DEFAULT_REMINDERS.lateFee.afterDays),
    },
  }
}

/** Which step, if any, an invoice due `days` from today (negative = late) is at. */
export function stepFor(days: number, cfg: InvoiceReminderSettings): { name: string; daysOverdue: number } | null {
  if (days >= 0) return cfg.dueSoonDays > 0 && days <= cfg.dueSoonDays ? { name: 'due_soon', daysOverdue: 0 } : null
  const late = -days
  const reached = cfg.overdueDays.filter((d) => late >= d)
  return reached.length ? { name: `overdue_${reached[reached.length - 1]}`, daysOverdue: late } : null
}

/** The late fee on a balance, to the cent; 0 when there is none to add. */
export function lateFeeOn(balance: number, fee: LateFeeSettings): number {
  if (!fee.enabled || !(balance > 0)) return 0
  return round2(fee.type === 'percent' ? (balance * fee.amount) / 100 : fee.amount)
}

/** "November 5, 2026" for a calendar-day marker — the day it names, never shifted into a zone. */
const dayWords = (marker: Date | string) => {
  const d = markerDay(marker instanceof Date ? marker : new Date(marker))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return ''
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })
}

/** The company's wall-clock hour now. */
const hourIn = (now: Date, tz: string) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now))

export interface ReminderDeps {
  db: any
  email: { send: (to: string, template: string, data: Record<string, unknown>) => Promise<unknown> }
  audit: { log: (entry: any) => unknown }
  logger: Logger
  isFeatureEnabled: (companyId: string, feature: string | string[]) => Promise<boolean>
  /** Home care's Billing invoices are this vertical's (CrmSettings.homecare). */
  homecare?: boolean
}

export interface PassResult { sent: number; skipped: number; failed: number; lateFees: number }

export function createInvoiceReminders(deps: ReminderDeps) {
  const { db, email, audit, logger } = deps

  /** Claim a step; false when it was already claimed (by this pass, an earlier one, or one running beside it). */
  async function claim(companyId: string, kind: string, subjectId: string, step: string, tx: any = db): Promise<string | null> {
    const rows = await tx.insert(reminderLog).values({ companyId, kind, subjectId, step, status: 'sending' })
      .onConflictDoNothing({ target: [reminderLog.companyId, reminderLog.kind, reminderLog.subjectId, reminderLog.step] }).returning({ id: reminderLog.id })
    return rows[0]?.id ?? null
  }
  const settle = (id: string, status: 'sent' | 'failed' | 'skipped', detail: string | null, sentTo: string | null = null) =>
    db.update(reminderLog).set({ status, detail, sentTo, updatedAt: new Date() }).where(eq(reminderLog.id, id))

  /** Add the late fee to one CRM invoice, once. Returns the fee added (0 when none was). */
  async function addLateFee(companyId: string, invoiceId: string, cfg: InvoiceReminderSettings): Promise<number> {
    const added = await db.transaction(async (tx: any) => {
      const [inv] = await tx.select().from(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId))).for('update')
      if (!inv || !OPEN.includes(inv.status)) return null
      const balance = invoiceBalance(inv)
      const fee = lateFeeOn(balance, cfg.lateFee)
      if (fee <= 0) return null
      if (!(await claim(companyId, 'invoice_late_fee', invoiceId, 'late_fee', tx))) return null
      const current = await tx.select().from(invoiceLineItem).where(eq(invoiceLineItem.invoiceId, invoiceId)).orderBy(asc(invoiceLineItem.sortOrder), asc(invoiceLineItem.id))
      const description = cfg.lateFee.type === 'percent'
        ? `Late fee (${cfg.lateFee.amount}% of the ${money(balance)} overdue balance)`
        : 'Late fee'
      const lines = [...current.map((li: any) => ({ description: li.description, quantity: Number(li.quantity), unitPrice: Number(li.unitPrice) })), { description, quantity: 1, unitPrice: fee }]
      const retotal = retotalInvoice(inv, lines, Number(inv.taxRate), Number(inv.discount))
      if ('error' in retotal) throw new Error(retotal.error)
      await tx.insert(invoiceLineItem).values({
        invoiceId, description, type: 'late_fee', quantity: '1', unitPrice: String(fee), total: String(fee),
        sortOrder: current.reduce((m: number, li: any) => Math.max(m, Number(li.sortOrder) || 0), 0) + 1,
      })
      await tx.update(invoice).set({ ...retotal.fields, updatedAt: new Date() }).where(eq(invoice.id, invoiceId))
      await tx.update(reminderLog).set({ status: 'sent', detail: `${description}: ${money(fee)}`, updatedAt: new Date() })
        .where(and(eq(reminderLog.companyId, companyId), eq(reminderLog.kind, 'invoice_late_fee'), eq(reminderLog.subjectId, invoiceId)))
      return { fee, number: inv.number, totalBefore: Number(inv.total), totalAfter: Number(retotal.fields.total), balanceBefore: balance, description }
    })
    if (!added) return 0
    // Who added it: nobody — the company's own late-fee rule, which the row names.
    await audit.log({
      action: 'update', entity: 'invoice', entityId: invoiceId, entityName: added.number, companyId,
      metadata: {
        automatic: 'late_fee', lateFee: added.fee.toFixed(2), line: added.description,
        totalBefore: added.totalBefore.toFixed(2), totalAfter: added.totalAfter.toFixed(2), balanceBefore: added.balanceBefore.toFixed(2),
        rule: cfg.lateFee.type === 'percent' ? `${cfg.lateFee.amount}% after ${cfg.lateFee.afterDays} days` : `${money(cfg.lateFee.amount)} after ${cfg.lateFee.afterDays} days`,
      },
    })
    return added.fee
  }

  /** The CRM's invoices: due-soon and overdue reminders, and the late fee. */
  async function crmInvoices(co: { id: string; name: string }, tz: string, cfg: InvoiceReminderSettings, now: Date, out: PassResult) {
    if (!(await deps.isFeatureEnabled(co.id, 'invoices'))) return
    const rows = await db.select({ inv: invoice, contactName: contact.name, contactEmail: contact.email, optOut: contact.emailOptOut })
      .from(invoice).leftJoin(contact, eq(contact.id, invoice.contactId))
      .where(and(eq(invoice.companyId, co.id), inArray(invoice.status, OPEN), isNotNull(invoice.dueDate)))
    for (const r of rows) {
      const inv = r.inv
      if (invoiceBalance(inv) <= 0.005) continue
      const days = daysUntilMarker(inv.dueDate, tz, now)
      const dueDay = markerDay(inv.dueDate)
      if (cfg.lateFee.enabled && days < 0 && -days >= cfg.lateFee.afterDays) {
        try { if (await addLateFee(co.id, inv.id, cfg)) out.lateFees++ } catch (e: any) { logger.error('[invoice reminders] late fee not added', { invoice: inv.number, error: e?.message }) }
      }
      const step = stepFor(days, cfg)
      if (!step) continue
      const logId = await claim(co.id, 'invoice_reminder', inv.id, `${step.name}:${dueDay}`)
      if (!logId) continue
      if (!inv.contactId) { await settle(logId, 'skipped', 'The invoice has no customer.'); out.skipped++; continue }
      if (r.optOut) { await settle(logId, 'skipped', 'The customer unsubscribed from email.'); out.skipped++; continue }
      const to = String(r.contactEmail || '').trim()
      if (!to) { await settle(logId, 'skipped', 'The customer has no email address.'); out.skipped++; continue }
      // The balance as it stands now — a late fee added above is in it.
      const [fresh] = await db.select().from(invoice).where(eq(invoice.id, inv.id)).limit(1)
      const balance = invoiceBalance(fresh || inv)
      const token = await documentLinkToken(db, invoice, inv.id)
      try {
        await email.send(to, step.daysOverdue > 0 ? 'invoiceOverdue' : 'invoiceReminder', {
          invoiceNumber: inv.number, companyName: co.name, contactName: r.contactName || 'there',
          balance: balance.toFixed(2), dueDate: dayWords(inv.dueDate), daysOverdue: step.daysOverdue,
          documentPath: token ? documentLinkPath(token) : null,
        })
        await settle(logId, 'sent', step.daysOverdue > 0 ? `${step.daysOverdue} days overdue` : 'Due soon', to)
        out.sent++
        await audit.log({ action: 'send', entity: 'invoice', entityId: inv.id, entityName: inv.number, companyId: co.id, metadata: { automatic: 'reminder', step: step.name, to, balance: balance.toFixed(2) } })
      } catch (e: any) {
        await settle(logId, 'failed', String(e?.message || 'The email could not be sent.').slice(0, 500), to)
        out.failed++
      }
    }
  }

  /** Home care's Billing invoices: the same steps, through its own reminder email and its invoice note. */
  async function careInvoices(co: { id: string; name: string }, tz: string, cfg: InvoiceReminderSettings, now: Date, out: PassResult) {
    const rows = await db.select({
      id: invoices.id, invoiceNumber: invoices.invoiceNumber, seqNumber: invoices.seqNumber, total: invoices.total, amountPaid: invoices.amountPaid,
      amountAdjusted: invoices.amountAdjusted, due: invoices.paymentDueDate, firstName: clients.firstName, lastName: clients.lastName,
      portalEmail: clients.portalEmail, email: clients.email,
    })
      .from(invoices).innerJoin(clients, eq(clients.id, invoices.clientId))
      .where(and(eq(invoices.companyId, co.id), isNotNull(invoices.sentAt), ne(invoices.paymentStatus, 'paid'), isNotNull(invoices.paymentDueDate)))
    for (const r of rows) {
      const owed = round2(Number(r.total) - Number(r.amountPaid || 0) - Number(r.amountAdjusted || 0))
      if (owed <= 0.005) continue
      const due = String(r.due).slice(0, 10)
      const step = stepFor(daysUntilMarker(due, tz, now), cfg)
      if (!step) continue
      const logId = await claim(co.id, 'care_invoice_reminder', r.id, `${step.name}:${due}`)
      if (!logId) continue
      // The address the invoice email itself goes to (data/homecareBillingRoutes.ts invoiceForEmail): the portal's, else the client's.
      const to = String(r.portalEmail || r.email || '').trim()
      if (!to) { await settle(logId, 'skipped', 'The client has no email address.'); out.skipped++; continue }
      const token = await documentLinkToken(db, invoices, r.id)
      try {
        await email.send(to, 'homecareInvoiceReminder', {
          companyName: co.name, contactName: `${r.firstName} ${r.lastName}`.trim(), invoiceNumber: r.seqNumber ?? r.invoiceNumber,
          amountDue: owed.toFixed(2), dueDate: dayWords(due), daysOverdue: step.daysOverdue, documentPath: token ? documentLinkPath(token) : null,
        })
        await settle(logId, 'sent', step.daysOverdue > 0 ? `${step.daysOverdue} days overdue` : 'Due soon', to)
        await appendInvoiceNote(db, co.id, r.id, `\nAutomatic reminder sent to ${to} on ${storeDateString(now, tz)} (${step.daysOverdue > 0 ? `${step.daysOverdue}d overdue` : 'pre-due'})`, 'keep')
        out.sent++
      } catch (e: any) {
        await settle(logId, 'failed', String(e?.message || 'The email could not be sent.').slice(0, 500), to)
        out.failed++
      }
    }
  }

  /** One pass over every company. `now` is the clock (a test pins it). */
  async function runOnce(now: Date = new Date()): Promise<PassResult> {
    const out: PassResult = { sent: 0, skipped: 0, failed: 0, lateFees: 0 }
    const companies = await db.select().from(company)
    for (const co of companies) {
      const cfg = reminderSettings(co.settings)
      if (!cfg.enabled) continue
      const tz = companyRowTimeZone(co)
      if (hourIn(now, tz) < SEND_FROM_HOUR) continue
      try {
        await crmInvoices(co, tz, cfg, now, out)
        if (deps.homecare) await careInvoices(co, tz, cfg, now, out)
      } catch (e: any) {
        logger.error('[invoice reminders] pass failed', { company: co.id, error: e?.message })
      }
    }
    if (out.sent || out.failed || out.lateFees) logger.info('[invoice reminders] pass', out as any)
    return out
  }

  /** Every hour, and once shortly after boot. Started by services.startJobs (boot only, never in tests). */
  function start() {
    const tick = () => runOnce().catch((e) => logger.error('[invoice reminders] pass failed', { error: e?.message }))
    setTimeout(tick, 2 * 60_000)
    setInterval(tick, 60 * 60_000)
  }

  /** What was sent, skipped or added for one invoice (the invoice page's panel). */
  async function historyFor(companyId: string, subjectId: string) {
    return db.select({ kind: reminderLog.kind, step: reminderLog.step, status: reminderLog.status, sentTo: reminderLog.sentTo, detail: reminderLog.detail, at: reminderLog.updatedAt })
      .from(reminderLog).where(and(eq(reminderLog.companyId, companyId), eq(reminderLog.subjectId, subjectId), inArray(reminderLog.kind, ['invoice_reminder', 'invoice_late_fee', 'care_invoice_reminder'])))
      .orderBy(asc(reminderLog.createdAt))
  }

  return { runOnce, start, historyFor, addLateFee }
}

export type InvoiceReminders = ReturnType<typeof createInvoiceReminders>
