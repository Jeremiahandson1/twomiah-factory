// Consumer financing, the way Jobber and Housecall Pro run it with Wisetack (lender.ts says what is public and what is
// not): the owner connects their lender account; a quote or an invoice in the lender's range shows the customer an
// estimated monthly payment and an Apply button; the office can text or email the application link; the lender's signed
// webhooks move the application, and the money it pays out is recorded once, as a payment on the invoice.
//
// NOT READY (registry: consumer_financing hidden): no business has it switched on until a real lender sandbox run
// passes, and nothing names it to a business or a customer before then (apps/unified/tests/not-ready-unseen.test.ts).
//
// Two ways an application is opened, by what the server has:
//   · with Twomiah's partner credentials (lender.ts partnerApi): a transaction per quote or invoice at the lender, the
//     customer's own link, and status by webhook — what Jobber and Housecall Pro do;
//   · without them: the business's own prequalification link (public; every Wisetack merchant has one). The application
//     is recorded as `not_started`; the lender reports nothing back for it, so the office updates it by hand.
import { and, desc, eq, inArray } from 'drizzle-orm'
import { invoiceBalance, recordInvoicePayment, publicApiBase } from '@twomiah/tenant-backend'
import { company, contact, financingApplication, financingEvent, invoice, job, payment, quote } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import { DISCLOSURE, FINAL, LENDER, moves, monthlyPayment, normalizeStatus, wisetack as lender, type FinancingStatus } from './lender.ts'

/** An error a route turns into its status (http/errors.ts reads `.status`). */
const refuse = (message: string, status = 400, code?: string) => Object.assign(new Error(message), { status, code })

export interface Connection { merchantId: string; prequalUrl: string; connectedAt: string }
export interface Offer { lender: string; amount: number; asLowAs: number; apr: number; termMonths: number; disclosure: string }
type DocKind = 'quote' | 'invoice'

/** A merchant id as Wisetack's portal shows it: letters, digits and dashes. */
const MERCHANT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/

/**
 * The prequalification link as pasted: an https address on Wisetack's own domain, so an Apply button can never send a
 * customer anywhere else.
 */
export function prequalLinkProblem(v: unknown): string | null {
  let u: URL
  try { u = new URL(String(v ?? '').trim()) } catch { return 'Paste the whole prequalification link, starting with https://' }
  if (u.protocol !== 'https:') return 'The prequalification link must start with https://'
  if (!/(^|\.)wisetack\.(com|us)$/i.test(u.hostname)) return 'That is not a Wisetack link. Copy it from your Wisetack merchant portal: Account settings › Merchant information.'
  return null
}

/** The estimate shown on a quote or an invoice: the lender's own example terms, on this amount, with its disclosure. */
export function offerFor(amount: number): Offer | null {
  const a = Math.round(Number(amount) * 100) / 100
  if (!Number.isFinite(a) || a < LENDER.minAmount || a > LENDER.maxAmount) return null
  return { lender: LENDER.name, amount: a, asLowAs: monthlyPayment(a, LENDER.exampleApr, LENDER.exampleTermMonths), apr: LENDER.exampleApr, termMonths: LENDER.exampleTermMonths, disclosure: DISCLOSURE }
}

export function createFinancingService(d: Pick<CrmDeps, 'db' | 'logger' | 'services'>) {
  const { db, logger } = d

  // ── The business's lender account ──────────────────────────────────────────────────────────────────────────────────
  async function integrationsOf(companyId: string): Promise<Record<string, any>> {
    const [row] = await db.select({ integrations: company.integrations }).from(company).where(eq(company.id, companyId)).limit(1)
    let v: any = row?.integrations
    if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = {} } }
    return v && typeof v === 'object' ? v : {}
  }

  async function connection(companyId: string): Promise<Connection | null> {
    const w = (await integrationsOf(companyId))?.financing?.wisetack
    return w && typeof w.merchantId === 'string' && typeof w.prequalUrl === 'string' && !prequalLinkProblem(w.prequalUrl)
      ? { merchantId: w.merchantId, prequalUrl: w.prequalUrl, connectedAt: String(w.connectedAt || '') }
      : null
  }

  async function connect(companyId: string, input: { merchantId?: unknown; prequalUrl?: unknown }): Promise<Connection> {
    const merchantId = String(input.merchantId ?? '').trim()
    const prequalUrl = String(input.prequalUrl ?? '').trim()
    const fields: Record<string, string> = {}
    if (!MERCHANT_ID.test(merchantId)) fields.merchantId = 'Enter your Wisetack merchant ID, as your merchant portal shows it.'
    const linkProblem = prequalLinkProblem(prequalUrl)
    if (linkProblem) fields.prequalUrl = linkProblem
    if (Object.keys(fields).length) throw Object.assign(refuse(Object.values(fields)[0]), { fields })
    const all = await integrationsOf(companyId)
    const conn: Connection = { merchantId, prequalUrl, connectedAt: new Date().toISOString() }
    await db.update(company).set({ integrations: { ...all, financing: { ...(all.financing || {}), wisetack: conn } }, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    return conn
  }

  async function disconnect(companyId: string) {
    const all = await integrationsOf(companyId)
    const { wisetack: _gone, ...rest } = all.financing || {}
    await db.update(company).set({ integrations: { ...all, financing: rest }, updatedAt: new Date() } as any).where(eq(company.id, companyId))
  }

  async function status(companyId: string) {
    const conn = await connection(companyId)
    return {
      lender: LENDER.name,
      connected: !!conn,
      merchantId: conn?.merchantId ?? null,
      prequalUrl: conn?.prequalUrl ?? null,
      connectedAt: conn?.connectedAt || null,
      // Whether this server can open applications at the lender and hear back (Twomiah's partner credentials).
      partnerApi: !!lender.partnerApi(),
      webhooks: !!lender.webhookSecret(),
      minAmount: LENDER.minAmount,
      maxAmount: LENDER.maxAmount,
      signupUrl: LENDER.merchantSignupUrl,
    }
  }

  // ── The quote or invoice an application is for ─────────────────────────────────────────────────────────────────────
  async function documentOf(companyId: string, kind: DocKind, id: string) {
    if (kind === 'quote') {
      const [q] = await db.select().from(quote).where(and(eq(quote.id, id), eq(quote.companyId, companyId))).limit(1)
      if (!q) throw refuse('Quote not found', 404)
      return { kind, id: q.id, number: q.number as string, contactId: q.contactId as string | null, amount: Number(q.total), jobId: (q.jobId || q.convertedToJobId || null) as string | null, quoteId: q.id as string, invoiceId: null as string | null, closed: ['declined', 'rejected'].includes(q.status) ? 'This quote was declined.' : null }
    }
    const [i] = await db.select().from(invoice).where(and(eq(invoice.id, id), eq(invoice.companyId, companyId))).limit(1)
    if (!i) throw refuse('Invoice not found', 404)
    const owed = invoiceBalance({ status: i.status, total: i.total, amountPaid: i.amountPaid, amountRefunded: i.amountRefunded })
    return { kind, id: i.id, number: i.number as string, contactId: i.contactId as string | null, amount: owed, jobId: (i.jobId || null) as string | null, quoteId: (i.quoteId || null) as string | null, invoiceId: i.id as string, closed: ['void', 'refunded'].includes(i.status) ? 'This invoice is void.' : owed <= 0.005 ? 'This invoice is paid.' : null }
  }

  /** The estimate for one quote or invoice, or null with the reason none is shown. */
  async function offerOn(companyId: string, kind: DocKind, id: string): Promise<{ offer: Offer | null; reason: string | null; connected: boolean }> {
    const doc = await documentOf(companyId, kind, id)
    const connected = !!(await connection(companyId))
    if (!connected) return { offer: null, reason: 'Connect your lender account in Settings › Integrations first.', connected }
    if (doc.closed) return { offer: null, reason: doc.closed, connected }
    if (!doc.contactId) return { offer: null, reason: `Add the customer to this ${kind} first.`, connected }
    const offer = offerFor(doc.amount)
    return { offer, reason: offer ? null : `${LENDER.name} lends on jobs of $${LENDER.minAmount.toLocaleString('en-US')} to $${LENDER.maxAmount.toLocaleString('en-US')}.`, connected }
  }

  // ── Applications ───────────────────────────────────────────────────────────────────────────────────────────────────
  /**
   * The application for this quote or invoice: the open one for the same amount if there is one (a second Apply or a
   * second text reuses it, as the lender would), else a new one.
   */
  async function open(companyId: string, kind: DocKind, id: string, userId: string | null) {
    const conn = await connection(companyId)
    if (!conn) throw refuse('Connect your lender account in Settings › Integrations first.', 409, 'NOT_CONNECTED')
    const doc = await documentOf(companyId, kind, id)
    if (doc.closed) throw refuse(doc.closed, 409)
    if (!doc.contactId) throw refuse(`Add the customer to this ${kind} first.`, 409)
    if (!offerFor(doc.amount)) throw refuse(`${LENDER.name} lends on jobs of $${LENDER.minAmount.toLocaleString('en-US')} to $${LENDER.maxAmount.toLocaleString('en-US')}.`, 409)
    const column = kind === 'quote' ? financingApplication.quoteId : financingApplication.invoiceId
    const existing = await db.select().from(financingApplication)
      .where(and(eq(financingApplication.companyId, companyId), eq(column, doc.id))).orderBy(desc(financingApplication.createdAt))
    const reusable = existing.find((a: any) => !FINAL.includes(a.status) && Number(a.amount) === doc.amount && a.applicationUrl)
    if (reusable) return { application: reusable, reused: true }

    const [person] = await db.select().from(contact).where(and(eq(contact.id, doc.contactId), eq(contact.companyId, companyId))).limit(1)
    if (!person) throw refuse('The customer on this ' + kind + ' was not found.', 409)
    const api = lender.partnerApi()
    let externalId: string | null = null, applyUrl = conn.prequalUrl, st: FinancingStatus = 'not_started'
    if (api) {
      const [first, ...rest] = String(person.name || '').trim().split(/\s+/)
      const opened = await lender.createTransaction(api, {
        merchantId: conn.merchantId, amount: doc.amount, reference: `${kind}:${doc.id}`,
        callbackUrl: lender.callbackUrl(publicApiBase()),
        customer: { firstName: first || '', lastName: rest.join(' '), email: person.email || null, phone: person.mobile || person.phone || null },
      })
      externalId = opened.transactionId; applyUrl = opened.applyUrl; st = opened.status
    }
    const [row] = await db.insert(financingApplication).values({
      provider: LENDER.id, status: st, amount: doc.amount.toFixed(2), externalId, applicationUrl: applyUrl,
      companyId, contactId: person.id, quoteId: doc.quoteId, invoiceId: doc.invoiceId, jobId: doc.jobId, createdById: userId,
    } as any).returning()
    return { application: row, reused: false }
  }

  async function list(companyId: string, f: { quoteId?: string; invoiceId?: string; jobId?: string; status?: string } = {}) {
    const where: any[] = [eq(financingApplication.companyId, companyId)]
    if (f.quoteId) where.push(eq(financingApplication.quoteId, f.quoteId))
    if (f.invoiceId) where.push(eq(financingApplication.invoiceId, f.invoiceId))
    if (f.jobId) where.push(eq(financingApplication.jobId, f.jobId))
    if (f.status) where.push(eq(financingApplication.status, f.status))
    const rows = await db.select().from(financingApplication).where(and(...where)).orderBy(desc(financingApplication.createdAt)).limit(500)
    const ids = (k: string) => [...new Set(rows.map((r: any) => r[k]).filter(Boolean))] as string[]
    const [people, quotes, invoices, jobs] = await Promise.all([
      ids('contactId').length ? db.select({ id: contact.id, name: contact.name }).from(contact).where(inArray(contact.id, ids('contactId'))) : [],
      ids('quoteId').length ? db.select({ id: quote.id, number: quote.number }).from(quote).where(inArray(quote.id, ids('quoteId'))) : [],
      ids('invoiceId').length ? db.select({ id: invoice.id, number: invoice.number }).from(invoice).where(inArray(invoice.id, ids('invoiceId'))) : [],
      ids('jobId').length ? db.select({ id: job.id, number: job.number, title: job.title }).from(job).where(inArray(job.id, ids('jobId'))) : [],
    ])
    const by = (xs: any[]) => new Map(xs.map((x) => [x.id, x]))
    const P = by(people), Q = by(quotes), I = by(invoices), J = by(jobs)
    return rows.map((r: any) => ({
      id: r.id, provider: r.provider, status: r.status, lenderStatus: r.lenderStatus, amount: Number(r.amount),
      fundedAmount: r.fundedAmount == null ? null : Number(r.fundedAmount), fundedAt: r.fundedAt, paymentId: r.paymentId,
      applyUrl: r.applicationUrl, sentAt: r.sentAt, sentVia: r.sentVia, createdAt: r.createdAt, updatedAt: r.updatedAt,
      // A link-only application (no partner API) hears nothing back: the office keeps its status.
      reportsBack: !!r.externalId,
      contact: P.get(r.contactId) ?? null, quote: Q.get(r.quoteId) ?? null, invoice: I.get(r.invoiceId) ?? null, job: J.get(r.jobId) ?? null,
    }))
  }

  async function applicationOf(companyId: string, id: string) {
    const [a] = await db.select().from(financingApplication).where(and(eq(financingApplication.id, id), eq(financingApplication.companyId, companyId))).limit(1)
    if (!a) throw refuse('Application not found', 404)
    return a
  }

  /** Text or email the customer the application link. */
  async function send(companyId: string, id: string, channel: unknown, userId: string | null) {
    if (channel !== 'sms' && channel !== 'email') throw refuse('Choose text or email.')
    const a = await applicationOf(companyId, id)
    if (FINAL.includes(a.status)) throw refuse('This application is closed. Start a new one from the quote or invoice.', 409)
    const [person] = await db.select().from(contact).where(and(eq(contact.id, a.contactId), eq(contact.companyId, companyId))).limit(1)
    const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
    if (!person) throw refuse('The customer was not found.', 409)
    const amount = '$' + Number(a.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    if (channel === 'sms') {
      if (!person.mobile && !person.phone) throw refuse(`${person.name} has no phone number.`, 409)
      const message = `${co?.name || 'We'}: you can apply to pay your ${amount} job over time with ${LENDER.name}. Checking your options won't affect your credit score: ${a.applicationUrl}`
      const sent: any = await d.services.sms.sendSMS(companyId, { contactId: person.id, message, userId: userId || undefined })
      if (!sent) throw refuse(`${person.name} has asked not to be texted.`, 409)
      if (sent.refused) throw refuse(sent.errorMessage || 'The text was not sent.', 409)
      if (sent.status === 'failed') throw refuse(sent.errorMessage || 'The text did not go through.', 502)
    } else {
      if (!person.email) throw refuse(`${person.name} has no email address.`, 409)
      if (person.emailOptOut) throw refuse(`${person.name} has asked not to be emailed.`, 409)
      await d.services.emailService.send(person.email, 'financingApplication', { contactName: person.name, companyName: co?.name || '', amount, lender: LENDER.name, url: a.applicationUrl, disclosure: DISCLOSURE })
    }
    const [row] = await db.update(financingApplication).set({ sentAt: new Date(), sentVia: channel, updatedAt: new Date() } as any).where(eq(financingApplication.id, a.id)).returning()
    return row
  }

  /** The office's own update, for a link-only application the lender reports nothing back on. */
  async function setStatus(companyId: string, id: string, next: unknown) {
    const a = await applicationOf(companyId, id)
    if (a.externalId) throw refuse(`${LENDER.name} reports this application's status itself.`, 409)
    const st = normalizeStatus(next)
    if (!st || st === 'funded') throw refuse('Choose pending, approved, declined, expired or canceled. A funded loan is recorded when the lender reports it.')
    const [row] = await db.update(financingApplication).set({ status: st, updatedAt: new Date() } as any).where(eq(financingApplication.id, a.id)).returning()
    return row
  }

  /**
   * The money the lender paid, recorded once as a payment on the invoice: the application's own, or the invoice made
   * from its quote. Safe to run again: the payment carries the lender's transaction as its reference.
   */
  async function settle(app: any): Promise<{ paymentId: string | null; reason?: string }> {
    if (app.status !== 'funded') return { paymentId: null, reason: 'not funded' }
    if (app.paymentId) return { paymentId: app.paymentId }
    let invoiceId: string | null = app.invoiceId
    if (!invoiceId && app.quoteId) {
      const [i] = await db.select({ id: invoice.id }).from(invoice).where(and(eq(invoice.quoteId, app.quoteId), eq(invoice.companyId, app.companyId))).limit(1)
      invoiceId = i?.id ?? null
    }
    if (!invoiceId) return { paymentId: null, reason: 'Funded — create the invoice for this quote, then record the payment from the Financing page.' }
    const amount = Math.round(Number(app.fundedAmount ?? app.amount) * 100) / 100
    const out = await recordInvoicePayment(db, { invoice, payment }, false, {
      invoiceId, companyId: app.companyId, amount, method: 'financing', reference: `${app.provider}:${app.externalId || app.id}`,
      notes: `Paid by ${LENDER.name} (customer financing)`, allowOverpayment: true, idempotentByReference: true,
    })
    if (!out.ok) {
      logger.warn('[financing] funded payment not recorded', { applicationId: app.id, invoiceId, error: out.error })
      return { paymentId: null, reason: out.error }
    }
    await db.update(financingApplication).set({ paymentId: out.payment.id, invoiceId, updatedAt: new Date() } as any).where(eq(financingApplication.id, app.id))
    return { paymentId: out.payment.id }
  }

  async function recordPayment(companyId: string, id: string) {
    const a = await applicationOf(companyId, id)
    if (a.status !== 'funded') throw refuse('Only a funded application is recorded as a payment.', 409)
    const r = await settle(a)
    if (!r.paymentId) throw refuse(r.reason || 'The payment was not recorded.', 409)
    return applicationOf(companyId, id)
  }

  /**
   * The lender's webhook: signature first (on the raw bytes), then the event, applied once. A retried delivery is
   * answered as already applied — and settles a funded application whose payment did not land the first time.
   */
  async function webhook(rawBody: string, signature: string | null | undefined): Promise<{ status: number; body: Record<string, unknown> }> {
    const secret = lender.webhookSecret()
    if (!secret) return { status: 503, body: { error: 'Lender webhooks are not set up on this server.' } }
    if (!lender.verifyWebhook(rawBody, signature, secret)) return { status: 401, body: { error: 'Invalid signature' } }
    let body: any
    try { body = JSON.parse(rawBody) } catch { return { status: 400, body: { error: 'The body is not JSON' } } }
    const ev = lender.parseEvent(body)
    if ('error' in ev) return { status: 400, body: { error: ev.error } }
    const [app] = await db.select().from(financingApplication).where(and(eq(financingApplication.provider, LENDER.id), eq(financingApplication.externalId, ev.transactionId))).limit(1)
    if (!app) {
      logger.warn('[financing] webhook for an unknown application', { transactionId: ev.transactionId })
      return { status: 200, body: { processed: false, reason: 'unknown application' } }
    }
    const inserted = await db.insert(financingEvent).values({
      provider: LENDER.id, eventId: ev.eventId, companyId: app.companyId, applicationId: app.id, status: ev.status, lenderStatus: ev.rawStatus,
      amount: ev.amount == null ? null : ev.amount.toFixed(2),
    } as any).onConflictDoNothing().returning({ id: financingEvent.id })
    let current = app
    if (inserted.length && moves(app.status as FinancingStatus, ev.status)) {
      const set: Record<string, unknown> = { status: ev.status, lenderStatus: ev.rawStatus, updatedAt: new Date() }
      if (ev.status === 'approved' && ev.amount != null) set.approvedAmount = ev.amount.toFixed(2)
      if (ev.status === 'funded') { set.fundedAmount = (ev.amount ?? Number(app.amount)).toFixed(2); set.fundedAt = new Date() }
      ;[current] = await db.update(financingApplication).set(set as any).where(eq(financingApplication.id, app.id)).returning()
    } else if (inserted.length) {
      await db.update(financingApplication).set({ lenderStatus: ev.rawStatus, updatedAt: new Date() } as any).where(eq(financingApplication.id, app.id))
    }
    const settled = current.status === 'funded' ? await settle(current) : null
    return { status: 200, body: { processed: true, duplicate: !inserted.length, applicationId: app.id, status: current.status, paymentId: settled?.paymentId ?? null } }
  }

  return { connection, connect, disconnect, status, documentOf, offerOn, open, list, applicationOf, send, setStatus, settle, recordPayment, webhook }
}

export type FinancingService = ReturnType<typeof createFinancingService>
