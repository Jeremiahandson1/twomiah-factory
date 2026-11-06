// Payment requests by text, and receipts (roofing parity row 17; JobNimbus "text payment request", Leap scheduled requests and receipts;
// feature invoice_text_requests, not ready). The routes are crm/roof/invoiceRequests.ts; the paid step is registered by crm/roof/index.ts.
//
//   · "Text this invoice": the invoice's own link (/d/<token>, where the homeowner reads and pays it) by text, now or at a chosen time,
//     and — a scheduled request — again every few days, a few times, until it is paid. Through the scheduled texts: the customer's
//     opt-out, the 8:00–20:00 window on the business's clock, the business's own number. Each text is tagged with its invoice.
//   · Once the invoice is paid in full, its texts not sent yet are cancelled.
//   · Every payment gets a receipt by email — what was paid, how, on which invoice and what is still owed — to the customer and to the
//     job's sales rep, once (payment.receipt_sent_at).
// Raw reads here (RULEBOOK §2); nothing here moves money.
import { and, asc, eq, isNull, gt } from 'drizzle-orm'
import { companyTimeZone, documentLinkToken, documentLinkPath, invoiceBalance } from '@twomiah/tenant-backend'
import { company, contact, invoice, job, payment, scheduledText, user } from '../db/schema/index.ts'
import { textTime } from './routeRainDay.ts'

export const REQUESTS_FEATURE = 'invoice_text_requests'
export const MAX_REPEATS = 6
const DAY = 86_400_000
const OPEN = ['sent', 'viewed', 'partial', 'overdue']
const first = (name: string | null | undefined) => String(name || '').trim().split(/\s+/)[0] || 'there'
const esc = (s: string) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export type QueueOutcome = { status: 'queued'; texts: Array<{ id: string; sendAt: Date }> } | { status: 'refused'; code: string; error: string }

/**
 * Queue the invoice's payment-request texts: the first at `startAt` (now when not given), then every `everyDays` days, `times` in all
 * (1 when no repeat). Each moves into the 8:00–20:00 window on the business's clock.
 */
export async function queueInvoiceTexts(db: any, companyId: string, userId: string | null, invoiceId: string, opts: { origin: string; startAt?: Date | null; everyDays?: number | null; times?: number | null; now?: Date }): Promise<QueueOutcome> {
  const now = opts.now ?? new Date()
  const [inv] = await db.select().from(invoice).where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId))).limit(1)
  if (!inv) return { status: 'refused', code: 'NOT_FOUND', error: 'Invoice not found' }
  if (!OPEN.includes(String(inv.status))) return { status: 'refused', code: 'NOT_OPEN', error: inv.status === 'draft' ? 'Send the invoice first: a draft has no link to text.' : `This invoice is ${inv.status}: there is nothing to ask for.` }
  if (invoiceBalance(inv) <= 0) return { status: 'refused', code: 'PAID', error: 'This invoice has nothing left to pay.' }
  const [ct] = inv.contactId ? await db.select().from(contact).where(and(eq(contact.id, inv.contactId), eq(contact.companyId, companyId))).limit(1) : []
  const phone = String(ct?.mobile || ct?.phone || '').trim()
  if (!ct || !phone) return { status: 'refused', code: 'NO_PHONE', error: 'The customer has no phone number to text.' }
  if (ct.optedOutSms) return { status: 'refused', code: 'OPTED_OUT', error: 'The customer has asked not to be texted.' }
  if (!/^https?:\/\//.test(opts.origin)) return { status: 'refused', code: 'NO_ADDRESS', error: 'The app’s web address is not set, so there is no link to text.' }
  const token = await documentLinkToken(db, invoice, inv.id)
  if (!token) return { status: 'refused', code: 'NO_LINK', error: 'This invoice has no link yet.' }
  const link = `${opts.origin.replace(/\/+$/, '')}${documentLinkPath(token)}`
  const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
  const tz = await companyTimeZone(db, companyId)
  const times = Math.min(MAX_REPEATS, Math.max(1, Math.floor(Number(opts.times) || 1)))
  const every = opts.everyDays ? Math.max(1, Math.floor(Number(opts.everyDays))) : null
  const start = opts.startAt && opts.startAt > now ? opts.startAt : now
  const out: Array<{ id: string; sendAt: Date }> = []
  for (let i = 0; i < (every ? times : 1); i++) {
    const at = textTime(new Date(start.getTime() + i * (every ?? 0) * DAY), tz)
    const body = i === 0
      ? `Hi ${first(ct.name)}, invoice ${inv.number} from ${co?.name || 'us'} is ready. View and pay it at ${link}`
      : `Hi ${first(ct.name)}, a reminder: invoice ${inv.number} from ${co?.name || 'us'} still has a balance. View and pay it at ${link}`
    const [row] = await db.insert(scheduledText).values({ companyId, contactId: ct.id, toPhone: phone, body, sendAt: at, invoiceId: inv.id, createdById: userId }).returning({ id: scheduledText.id, sendAt: scheduledText.sendAt })
    out.push(row)
  }
  return { status: 'queued', texts: out }
}

/** The invoice's payment-request texts, oldest first. */
export async function requestsFor(db: any, companyId: string, invoiceId: string) {
  return db.select({ id: scheduledText.id, sendAt: scheduledText.sendAt, status: scheduledText.status, sentAt: scheduledText.sentAt, error: scheduledText.error, body: scheduledText.body })
    .from(scheduledText).where(and(eq(scheduledText.companyId, companyId), eq(scheduledText.invoiceId, invoiceId))).orderBy(asc(scheduledText.sendAt), asc(scheduledText.id))
}

/** Cancel one request not sent yet. Null when it is not this company's or not waiting. */
export async function cancelRequest(db: any, companyId: string, id: string) {
  const [row] = await db.update(scheduledText).set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
    .where(and(eq(scheduledText.id, id), eq(scheduledText.companyId, companyId), eq(scheduledText.status, 'scheduled'))).returning({ id: scheduledText.id })
  return row ?? null
}

/** The invoice was paid: when nothing is left to pay, its requests not sent yet are cancelled. Returns how many. */
export async function cancelWhenPaid(db: any, invoiceId: string): Promise<number> {
  const [inv] = await db.select().from(invoice).where(eq(invoice.id, invoiceId)).limit(1)
  if (!inv || invoiceBalance(inv) > 0) return 0
  const rows = await db.update(scheduledText).set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
    .where(and(eq(scheduledText.invoiceId, invoiceId), eq(scheduledText.status, 'scheduled'))).returning({ id: scheduledText.id })
  return rows.length
}

const METHOD: Record<string, string> = { card: 'card', credit_card: 'card', ach: 'bank transfer', bank: 'bank transfer', us_bank_account: 'bank transfer', check: 'cheque', cash: 'cash', other: 'another way' }

/**
 * Email the receipt for each payment on the invoice that has none yet: to the customer and the job's sales rep, once each payment.
 * `sendEmail` is the email service's sendRaw. Returns how many payments were receipted.
 */
export async function sendReceipts(db: any, sendEmail: (m: { to: string; subject: string; html: string }) => Promise<unknown>, invoiceId: string): Promise<number> {
  const [inv] = await db.select().from(invoice).where(eq(invoice.id, invoiceId)).limit(1)
  if (!inv) return 0
  const pays: any[] = await db.select().from(payment).where(and(eq(payment.invoiceId, invoiceId), isNull(payment.receiptSentAt), gt(payment.amount, '0'))).orderBy(asc(payment.paidAt))
  if (!pays.length) return 0
  const [ct] = inv.contactId ? await db.select().from(contact).where(eq(contact.id, inv.contactId)).limit(1) : []
  const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, inv.companyId)).limit(1)
  let rep: string | null = null
  if (inv.jobId) {
    const [j] = await db.select({ rep: job.assignedSalesRepId }).from(job).where(eq(job.id, inv.jobId)).limit(1)
    if (j?.rep) { const [u] = await db.select({ email: user.email }).from(user).where(eq(user.id, j.rep)).limit(1); rep = u?.email || null }
  }
  const to = [ct && !ct.emailOptOut && String(ct.email || '').trim() ? String(ct.email).trim() : null, rep].filter((x): x is string => !!x)
  const tz = await companyTimeZone(db, inv.companyId)
  const left = invoiceBalance(inv)
  let done = 0
  for (const p of pays) {
    const amount = Number(p.amount)
    const day = new Date(p.paidAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: tz })
    const how = METHOD[String(p.method || 'other')] || 'another way'
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111827">
<h2 style="margin:0 0 8px">Payment received — thank you</h2>
<p>${esc(co?.name || 'We')} received ${esc(money(amount))} by ${esc(how)} on ${esc(day)} for invoice ${esc(String(inv.number))}.</p>
<p>${left > 0 ? `Still owed on this invoice: <b>${esc(money(left))}</b>.` : 'This invoice is now paid in full.'}</p>
${p.reference ? `<p style="color:#6b7280;font-size:13px">Reference: ${esc(String(p.reference))}</p>` : ''}
<p style="color:#6b7280;font-size:13px">Keep this email as your receipt.</p></div>`
    for (const address of to) {
      try { await sendEmail({ to: address, subject: `Receipt: ${money(amount)} paid on invoice ${inv.number}`, html }) } catch { /* one address failing never blocks the other or the mark */ }
    }
    await db.update(payment).set({ receiptSentAt: new Date() }).where(eq(payment.id, p.id))
    done++
  }
  return done
}
