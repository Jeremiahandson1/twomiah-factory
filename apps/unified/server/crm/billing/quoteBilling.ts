// Billing a quote in parts — a deposit on approval, progress invoices, then the final invoice — the way Jobber and
// Housecall Pro do it. Every vertical whose quotes become invoices.
//
//   DEPOSIT. A quote may ask one (quote.deposit_type 'percent' | 'fixed', invoicing/quoteOptions.ts depositAmount). When
//   it is approved — by the customer on its own link or the office — the deposit becomes an invoice of its own (bill_kind
//   'deposit', billed_quote_id the quote), due that day: the customer pays it on that invoice's own link through the
//   business's own Stripe, or is told how to pay (the invoice page's rule), and the office records it like any payment.
//
//   PROGRESS. From an approved quote — or its job — bill a percent of the quote, or chosen lines, now (bill_kind
//   'progress'). Each is linked to the quote; a line billed once is not offered again. Amounts are shares of the quote's
//   TOTAL, tax included (taxed once, on the quote): a line's share is its price × total ÷ subtotal.
//
//   FINAL. The quote's "Create Invoice" (convert-to-invoice) is the final invoice once anything was billed in parts: the
//   quote's whole work, less a credit for every deposit and progress invoice (invoice.credit_applied, billedBefore). A
//   progress invoice that bills the very last of it is the final one itself.
//
// Never more than the quote's total: every raise is under the quote's row lock (data/quoteBilling.ts — the lock
// convert-to-invoice takes too), checked against what is billed already, and an edit to any of these invoices is held to
// the same sum (checkTotal, wired into the invoice routes). Voided invoices bill nothing.
//
// Draw schedules and AIA billing (crm/projects) are a construction lender's draws against a project's schedule of
// values; this is the customer's own invoices against a quote, so neither is copied here.
//
//   GET  /api/quote-billing/quotes/:id            billed against remaining, the invoices, the lines   invoices:read
//   POST /api/quote-billing/quotes/:id/progress   { percent } or { lineItemIds }                        invoices:create
//   GET  /api/quote-billing/jobs/:id              the same, for the job's approved quote ({ quoteId: null } without one)
//   POST /api/quote-billing/jobs/:id/progress     the same, for the job's approved quote                jobs:read + invoices:create
import { Hono } from 'hono'
import { and, asc, eq, inArray, isNotNull, ne, or } from 'drizzle-orm'
import {
  insertInvoice, round2, money, businessToday, dueDateFromTerms, companyTimeZone, documentLinkToken, documentLinkPath,
  invoiceBalance, resolveCustomer, depositAmount, includedLines,
} from '@twomiah/tenant-backend'
import { quote, quoteLineItem, invoice, invoiceLineItem, company, contact, project, job } from '../../db/schema/index.ts'
import { lockQuoteRow } from '../../data/quoteBilling.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

const DEFAULT_NUMBERING = { prefix: 'INV', pad: 5, seed: 0 }
const EPS = 0.005

/** A deposit or progress invoice as the screens show it. */
type Billed = { id: string; number: string; status: string; billKind: string | null; total: string; balance: number; isFinal: boolean }

export function createQuoteBilling(d: CrmDeps, opts: { canTakeCardPayments: (companyId: string) => Promise<boolean> }) {
  const { db } = d
  const numbering = d.settings?.invoices?.numbering || DEFAULT_NUMBERING

  /** Every live invoice that bills part of this quote: its deposit, its progress invoices and its final one. */
  const billedRows = async (dbx: any, companyId: string, quoteId: string) =>
    dbx.select().from(invoice).where(and(eq(invoice.companyId, companyId), ne(invoice.status, 'void'), or(eq(invoice.billedQuoteId, quoteId), eq(invoice.quoteId, quoteId))))
      .orderBy(asc(invoice.createdAt), asc(invoice.id))
  const sum = (rows: any[]) => round2(rows.reduce((s, r) => s + Number(r.total || 0), 0))
  const shape = (r: any): Billed => ({ id: r.id, number: r.number, status: r.status, billKind: r.billKind ?? null, total: r.total, balance: invoiceBalance(r), isFinal: !!r.quoteId })
  /** The quote lines a progress invoice already billed. */
  const billedLineIds = async (dbx: any, invoiceIds: string[]): Promise<Set<string>> => {
    if (!invoiceIds.length) return new Set()
    const rows = await dbx.select({ id: invoiceLineItem.quoteLineItemId }).from(invoiceLineItem).where(and(inArray(invoiceLineItem.invoiceId, invoiceIds), isNotNull(invoiceLineItem.quoteLineItemId)))
    return new Set(rows.map((r: any) => r.id))
  }
  const ownQuote = async (dbx: any, companyId: string, id: string) => (await dbx.select().from(quote).where(and(eq(quote.id, id), eq(quote.companyId, companyId))).limit(1))[0] || null
  const linesOf = (dbx: any, quoteId: string) => dbx.select().from(quoteLineItem).where(eq(quoteLineItem.quoteId, quoteId)).orderBy(asc(quoteLineItem.sortOrder), asc(quoteLineItem.id))
  /** The job a quote's invoices belong to: the job it became, or the job it was written for. */
  const jobOf = (q: any) => q.convertedToJobId || q.jobId || null
  const settingsOf = async (companyId: string) => ((await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1))[0]?.settings as any) || {}
  const customerOf = async (companyId: string, q: any) => {
    if (q.contactId) return q.contactId as string
    const r = await resolveCustomer(db, { contact, project }, companyId, { projectId: q.projectId })
    return r.ok && r.contactId ? r.contactId : null
  }

  /** A deposit invoice as the customer's page and the office's approval show it: what it is, what is owed, its own link. */
  async function depositView(companyId: string, row: any) {
    const token = await documentLinkToken(db, invoice, row.id)
    return { ...shape(row), path: token ? documentLinkPath(token) : null, payOnline: await opts.canTakeCardPayments(companyId).catch(() => false) }
  }
  const depositRowOf = async (dbx: any, companyId: string, quoteId: string) =>
    (await dbx.select().from(invoice).where(and(eq(invoice.companyId, companyId), eq(invoice.billedQuoteId, quoteId), eq(invoice.billKind, 'deposit'), ne(invoice.status, 'void'))).limit(1))[0] || null

  /**
   * The quote was approved: raise the deposit it asks, once. Nothing when it asks none, has no customer to bill, or was
   * already invoiced in full. Approving twice returns the deposit invoice raised the first time.
   */
  async function raiseDeposit(companyId: string, quoteId: string) {
    const first = await ownQuote(db, companyId, quoteId)
    if (!first || first.status !== 'approved' || depositAmount(first) <= 0) return null
    const contactId = await customerOf(companyId, first)
    if (!contactId) return null
    const today = businessToday(await companyTimeZone(db, companyId))
    const row = await db.transaction(async (tx: any) => {
      await lockQuoteRow(tx, companyId, quoteId)
      const q = await ownQuote(tx, companyId, quoteId)
      const amount = depositAmount(q)
      if (!q || q.status !== 'approved' || amount <= 0) return null
      const had = await depositRowOf(tx, companyId, quoteId)
      if (had) return had
      const billed = await billedRows(tx, companyId, quoteId)
      if (billed.some((r: any) => r.quoteId === quoteId) || sum(billed) + amount > Number(q.total) + EPS) return null
      const created = await insertInvoice(tx, { invoice, invoiceLineItem } as any, numbering, {
        companyId, contactId, projectId: q.projectId ?? undefined, dueDate: today, issueDate: today, taxRate: 0, status: 'sent',
        notes: `Deposit on quote ${q.number}. It is credited on the final invoice.`, terms: q.terms ?? undefined,
        extra: { billKind: 'deposit', billedQuoteId: q.id, ...(jobOf(q) ? { jobId: jobOf(q) } : {}) },
      }, [{ description: `Deposit on ${q.number} — ${q.name}`, quantity: 1, unitPrice: amount }])
      return created
    })
    if (!row) return null
    d.realtime.emitToCompany(companyId, d.realtime.EVENTS.INVOICE_CREATED, { id: row.id, number: row.number })
    return depositView(companyId, row)
  }

  /** Billed against remaining, for the quote's page and its job's. */
  async function summary(companyId: string, q: any) {
    const rows = await billedRows(db, companyId, q.id)
    const lines: any[] = includedLines(await linesOf(db, q.id))
    const billedIds = await billedLineIds(db, rows.map((r: any) => r.id))
    const total = round2(Number(q.total))
    const billed = sum(rows)
    const subtotal = Number(q.subtotal) || 0
    return {
      quoteId: q.id, number: q.number, name: q.name, status: q.status, total: total.toFixed(2), billed: billed.toFixed(2),
      remaining: round2(Math.max(0, total - billed)).toFixed(2),
      depositAsked: depositAmount(q).toFixed(2), depositType: q.depositType ?? null, depositValue: q.depositValue ?? null,
      invoicedInFull: rows.some((r: any) => r.quoteId === q.id),
      invoices: rows.map(shape),
      // A line's share of the total (tax and discount included), and whether a progress invoice billed it already.
      lines: lines.map((l: any) => ({ id: l.id, description: l.description, total: l.total, share: (subtotal > 0 ? round2(Number(l.total) * total / subtotal) : 0).toFixed(2), billed: billedIds.has(l.id) })),
    }
  }

  /** Bill part of an approved quote now: a percent of its total, or chosen lines. */
  async function raiseProgress(companyId: string, quoteId: string, body: any): Promise<{ error: string; status: 400 | 404 | 409 } | { invoice: any }> {
    const pct = body?.percent === undefined || body?.percent === null || body?.percent === '' ? null : Number(body.percent)
    const ids: string[] | null = Array.isArray(body?.lineItemIds) ? body.lineItemIds.filter((x: unknown) => typeof x === 'string') : null
    if ((pct === null) === (ids === null)) return { error: 'Bill a percent of the quote, or choose its lines — one of the two.', status: 400 }
    if (pct !== null && (!Number.isFinite(pct) || pct <= 0 || pct > 100)) return { error: 'The percent is more than 0 and at most 100.', status: 400 }
    if (ids !== null && !ids.length) return { error: 'Choose at least one line to bill.', status: 400 }
    const first = await ownQuote(db, companyId, quoteId)
    if (!first) return { error: 'Quote not found', status: 404 }
    if (first.status !== 'approved') return { error: 'Only an approved quote is billed in parts.', status: 400 }
    const contactId = await customerOf(companyId, first)
    if (!contactId) return { error: 'This quote has no customer to bill. Add one to the quote first.', status: 400 }
    const [settings, tz] = await Promise.all([settingsOf(companyId), companyTimeZone(db, companyId)])
    const today = businessToday(tz)
    const out = await db.transaction(async (tx: any) => {
      await lockQuoteRow(tx, companyId, quoteId)
      const q = await ownQuote(tx, companyId, quoteId)
      const rows = await billedRows(tx, companyId, quoteId)
      const whole = rows.find((r: any) => r.quoteId === quoteId)
      if (whole) return { error: `${q.number} is invoiced in full already (${whole.number}).`, status: 409 as const }
      const total = round2(Number(q.total))
      const remaining = round2(total - sum(rows))
      const taxNote = Number(q.taxAmount) > 0 ? ', tax included' : ''
      let lines: Array<{ description: string; quantity: number; unitPrice: number; quoteLineItemId?: string }>
      if (pct !== null) {
        lines = [{ description: `${round2(pct)}% of ${q.number} — ${q.name}${taxNote}`, quantity: 1, unitPrice: round2(total * pct / 100) }]
      } else {
        const included: any[] = includedLines(await linesOf(tx, quoteId))
        const billedIds = await billedLineIds(tx, rows.map((r: any) => r.id))
        const subtotal = Number(q.subtotal) || 0
        if (subtotal <= 0) return { error: `${q.number} has nothing priced to bill by line.`, status: 400 as const }
        const chosen = [...new Set(ids!)].map((id) => included.find((l: any) => l.id === id))
        if (chosen.some((l) => !l)) return { error: 'That line is not one this quote bills.', status: 400 as const }
        const again = chosen.find((l: any) => billedIds.has(l.id))
        if (again) return { error: `"${again.description}" was billed already.`, status: 409 as const }
        lines = chosen.map((l: any) => ({ description: `${l.description} — ${q.number}${taxNote}`, quantity: 1, unitPrice: round2(Number(l.total) * total / subtotal), quoteLineItemId: l.id }))
      }
      const amount = round2(lines.reduce((s, l) => s + l.unitPrice, 0))
      if (amount <= 0) return { error: 'That bills nothing.', status: 400 as const }
      if (amount > remaining + EPS) return { error: `That would bill ${money(amount)}; ${money(Math.max(0, remaining))} of ${q.number}'s ${money(total)} is left to bill.`, status: 409 as const }
      // The invoice that bills the very last of the quote is its final one: the quote shows it as invoiced in full.
      const last = remaining - amount <= EPS
      const created = await insertInvoice(tx, { invoice, invoiceLineItem } as any, numbering, {
        companyId, contactId, projectId: q.projectId ?? undefined, dueDate: dueDateFromTerms(settings, today), issueDate: today, taxRate: 0,
        notes: `Progress billing on quote ${q.number}.`, terms: q.terms ?? undefined,
        extra: { billKind: 'progress', billedQuoteId: q.id, ...(last ? { quoteId: q.id } : {}), ...(jobOf(q) ? { jobId: jobOf(q) } : {}) },
      }, lines.map(({ quoteLineItemId: _id, ...l }) => l))
      // Each line names the quote line it bills, so it is never offered again.
      for (const [i, l] of lines.entries()) {
        if (l.quoteLineItemId && created.lineItems[i]) await tx.update(invoiceLineItem).set({ quoteLineItemId: l.quoteLineItemId }).where(eq(invoiceLineItem.id, created.lineItems[i].id))
      }
      return { invoice: created }
    })
    if ('invoice' in out) d.realtime.emitToCompany(companyId, d.realtime.EVENTS.INVOICE_CREATED, { id: out.invoice.id, number: out.invoice.number })
    return out
  }

  /**
   * convert-to-invoice's question (packages/tenant-backend quotes.ts billedBefore), inside its transaction under the
   * quote's lock: was part of this quote billed already? Then this invoice is the final one, crediting what was.
   */
  async function billedBefore(tx: any, q: any) {
    const rows = await billedRows(tx, q.companyId, q.id)
    if (!rows.length) return null
    const credit = sum(rows)
    const total = round2(Number(q.total))
    if (total - credit <= EPS) return { error: `Everything on ${q.number} is billed already (${rows.map((r: any) => r.number).join(', ')}).` }
    return { credit, values: { billKind: 'final', billedQuoteId: q.id, creditApplied: credit.toFixed(2), ...(jobOf(q) ? { jobId: jobOf(q) } : {}) } }
  }

  /** The invoice routes' edit check: a deposit, progress or final invoice never takes its quote above its total. */
  async function checkTotal(existing: any, total: number): Promise<string | null> {
    const quoteId = existing?.billedQuoteId || (existing?.billKind ? existing?.quoteId : null)
    if (!quoteId) return null
    const q = await ownQuote(db, existing.companyId, quoteId)
    if (!q) return null
    const others = sum((await billedRows(db, existing.companyId, quoteId)).filter((r: any) => r.id !== existing.id))
    const most = round2(Number(q.total) - others)
    return total > most + EPS ? `${existing.number} bills part of quote ${q.number}: it can be at most ${money(Math.max(0, most))}, or the quote would be billed more than its ${money(q.total)}.` : null
  }

  /** The approved quote a job is billed against: the quote it was made from, or the one written for it. */
  async function quoteOfJob(companyId: string, jobId: string): Promise<{ error: string; status: 404 } | { quote: any }> {
    const [j] = await db.select({ id: job.id, quoteId: job.quoteId }).from(job).where(and(eq(job.id, jobId), eq(job.companyId, companyId))).limit(1)
    if (!j) return { error: 'Job not found', status: 404 as const }
    const rows = await db.select().from(quote).where(and(eq(quote.companyId, companyId), eq(quote.status, 'approved'), or(eq(quote.convertedToJobId, jobId), eq(quote.jobId, jobId), ...(j.quoteId ? [eq(quote.id, j.quoteId)] : [])))).orderBy(asc(quote.createdAt), asc(quote.id)).limit(1)
    return rows[0] ? { quote: rows[0] } : { error: 'This job has no approved quote to bill against. Bill it with an invoice instead.', status: 404 as const }
  }

  const routes = () => {
    const { requirePermission } = d.permissions
    const app = new Hono<AppEnv>()
    app.get('/quotes/:id', requirePermission('invoices:read'), async (c) => {
      const q = await ownQuote(db, c.get('user').companyId, c.req.param('id'))
      return q ? one(c, await summary(c.get('user').companyId, q)) : fail(c, 404, 'Quote not found')
    })
    app.post('/quotes/:id/progress', requirePermission('invoices:create'), async (c) => {
      const r = await raiseProgress(c.get('user').companyId, c.req.param('id'), await c.req.json().catch(() => ({})))
      return 'error' in r ? fail(c, r.status, r.error) : one(c, r.invoice, 201)
    })
    app.get('/jobs/:id', requirePermission('jobs:read'), requirePermission('invoices:read'), async (c) => {
      const cid = c.get('user').companyId
      const r = await quoteOfJob(cid, c.req.param('id'))
      if ('error' in r) return r.error === 'Job not found' ? fail(c, 404, r.error) : one(c, { quoteId: null, reason: r.error })
      return one(c, await summary(cid, r.quote))
    })
    app.post('/jobs/:id/progress', requirePermission('jobs:read'), requirePermission('invoices:create'), async (c) => {
      const cid = c.get('user').companyId
      const found = await quoteOfJob(cid, c.req.param('id'))
      if ('error' in found) return fail(c, found.status, found.error, 'no_quote')
      const r = await raiseProgress(cid, found.quote.id, await c.req.json().catch(() => ({})))
      return 'error' in r ? fail(c, r.status, r.error) : one(c, r.invoice, 201)
    })
    return app
  }

  return {
    raiseDeposit,
    depositFor: async (companyId: string, quoteId: string) => { const r = await depositRowOf(db, companyId, quoteId); return r ? depositView(companyId, r) : null },
    billedBefore, checkTotal, summary, raiseProgress, routes,
  }
}
