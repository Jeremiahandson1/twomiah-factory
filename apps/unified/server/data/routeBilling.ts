// Billing a route's visits, the way the field-service leaders do (Jobber: per visit, monthly, or batch one draft per client;
// Yardbook: completed jobs in a date range, one invoice per customer, grouped by property, the whole batch undoable; LMN:
// per-visit invoice when the crew marks the service complete). A visit is billed through the shared invoice engine
// (insertInvoice), is billed ONCE (route_visit_invoice.job_id is unique), and a per-visit invoice carries the same
// invoice.job_id link as any job. Raw SQL lives here (RULEBOOK §2); every function returns camelCase objects.
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm'
import { insertInvoice, defaultTaxRateFrom, dueDateFromTerms, businessToday, companyTimeZone } from '@twomiah/tenant-backend'
import {
  job, site, contact, company, invoice, invoiceLineItem, serviceAgreement, recurringInvoice,
  recurringRoute, recurringRouteStop, routeVisitInvoice, routeBillingBatch,
} from '../db/schema/index.ts'

// The same numbering as the CRM's invoices (the shared default INV-00001), as snow billing uses.
const INVOICE_NUMBERING = { prefix: 'INV', pad: 5, seed: 0 }

export const BILLING_MODES = ['per_visit', 'monthly', 'elsewhere'] as const
export type BillingMode = typeof BILLING_MODES[number]

const dayDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)
const dayWords = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const round2 = (n: number) => Math.round(n * 100) / 100
const billingLock = (tx: any, companyId: string) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId + ':route-billing'}))`)

/** The customers a route visits: the stop's own customer, else the property's. */
async function routeCustomers(db: any, companyId: string, routeId: string): Promise<Array<{ id: string; name: string }>> {
  const rows = await db.selectDistinct({ id: contact.id, name: contact.name })
    .from(recurringRouteStop)
    .innerJoin(site, eq(recurringRouteStop.siteId, site.id))
    .innerJoin(contact, eq(contact.id, sql`COALESCE(${recurringRouteStop.contactId}, ${site.contactId})`))
    .where(and(eq(recurringRouteStop.recurringRouteId, routeId), eq(recurringRouteStop.companyId, companyId)))
  return rows
}

/** Which of these customers already have something billing them: an active service agreement or recurring invoice. */
async function alreadyBilledBy(db: any, companyId: string, contactIds: string[]): Promise<Map<string, 'agreement' | 'recurring_invoice'>> {
  const by = new Map<string, 'agreement' | 'recurring_invoice'>()
  if (!contactIds.length) return by
  const agreements = await db.select({ contactId: serviceAgreement.contactId }).from(serviceAgreement)
    .where(and(eq(serviceAgreement.companyId, companyId), eq(serviceAgreement.status, 'active'), inArray(serviceAgreement.contactId, contactIds)))
  for (const a of agreements) by.set(a.contactId, 'agreement')
  const recurring = await db.select({ contactId: recurringInvoice.contactId }).from(recurringInvoice)
    .where(and(eq(recurringInvoice.companyId, companyId), eq(recurringInvoice.status, 'active'), inArray(recurringInvoice.contactId, contactIds)))
  for (const r of recurring) if (r.contactId && !by.has(r.contactId)) by.set(r.contactId, 'recurring_invoice')
  return by
}

/**
 * How a route's visits are billed. A route the owner has not chosen for reads as 'elsewhere' when any customer on it has an
 * active agreement or recurring invoice — so nothing already billing bills a second time — and as 'monthly' otherwise.
 * A choice the owner made always wins.
 */
export async function billingFor(db: any, companyId: string, route: { id: string; billingMode: string | null }) {
  const customers = await routeCustomers(db, companyId, route.id)
  const by = await alreadyBilledBy(db, companyId, customers.map((c) => c.id))
  const covered = customers.filter((c) => by.has(c.id)).map((c) => ({ contactId: c.id, name: c.name, by: by.get(c.id)! }))
  const chosen = (BILLING_MODES as readonly string[]).includes(String(route.billingMode))
  const mode: BillingMode = chosen ? (route.billingMode as BillingMode) : covered.length ? 'elsewhere' : 'monthly'
  const note = chosen ? null
    : covered.length
      ? `Billed elsewhere until you choose: ${covered.map((c) => c.name).join(', ')} already ${covered.length === 1 ? 'has' : 'have'} an active agreement or recurring invoice.`
      : 'No customer on this route has an agreement or recurring invoice, so the monthly run bills its completed visits.'
  return { mode, chosen, covered, note }
}

/** A visit's live bill, if any: its link to an invoice that is not void, or an invoice made for the job by hand. */
export async function billedVisits(db: any, companyId: string, jobIds: string[]) {
  const billed = new Map<string, { invoiceId: string; number: string; status: string }>()
  const stale: string[] = [] // links to a voided invoice: the visit is billable again
  if (!jobIds.length) return { billed, stale }
  const links = await db.select({ id: routeVisitInvoice.id, jobId: routeVisitInvoice.jobId, invoiceId: invoice.id, number: invoice.number, status: invoice.status })
    .from(routeVisitInvoice).innerJoin(invoice, eq(routeVisitInvoice.invoiceId, invoice.id))
    .where(and(eq(routeVisitInvoice.companyId, companyId), inArray(routeVisitInvoice.jobId, jobIds)))
  for (const l of links) { if (l.status === 'void') stale.push(l.id); else billed.set(l.jobId, { invoiceId: l.invoiceId, number: l.number, status: l.status }) }
  const direct = await db.select({ jobId: invoice.jobId, invoiceId: invoice.id, number: invoice.number, status: invoice.status }).from(invoice)
    .where(and(eq(invoice.companyId, companyId), inArray(invoice.jobId, jobIds), ne(invoice.status, 'void')))
  for (const d of direct) if (d.jobId && !billed.has(d.jobId)) billed.set(d.jobId, { invoiceId: d.invoiceId, number: d.number, status: d.status })
  return { billed, stale }
}

const lineOf = (v: { title: string; number: string; scheduledDate: Date; siteName: string | null; amount: number }, byProperty: boolean) => ({
  description: byProperty
    ? `${v.siteName || 'Property'} · ${String(v.title).split(' — ')[0]} · ${dayWords(v.scheduledDate)}`
    : `${v.title} · ${dayWords(v.scheduledDate)}`,
  quantity: 1, unitPrice: v.amount,
})

export interface BatchOptions { from: string; to: string; groupBy: 'none' | 'property' }

/**
 * What a monthly run would bill, and what it leaves out and why: completed visits of routes billed monthly, in the date range
 * (their service days), not already billed, with a customer and a price. Pass a transaction to read inside one.
 */
export async function previewBatch(db: any, companyId: string, opts: BatchOptions) {
  const rows: any[] = await db.select({
    jobId: job.id, number: job.number, title: job.title, scheduledDate: job.scheduledDate, estimatedValue: job.estimatedValue,
    contactId: job.contactId, siteId: job.siteId, siteName: site.name, stopId: job.recurringRouteStopId, routeId: recurringRouteStop.recurringRouteId,
  }).from(job)
    .leftJoin(recurringRouteStop, eq(job.recurringRouteStopId, recurringRouteStop.id))
    .leftJoin(site, eq(job.siteId, site.id))
    .where(and(
      eq(job.companyId, companyId), eq(job.status, 'completed'),
      sql`${job.recurringRouteStopId} IS NOT NULL`,
      gte(job.scheduledDate, dayDate(opts.from)), lte(job.scheduledDate, dayDate(opts.to)),
    ))
    .orderBy(asc(job.scheduledDate), asc(job.scheduledTime))
  const { billed, stale } = await billedVisits(db, companyId, rows.map((r) => r.jobId))
  const routeIds = [...new Set(rows.map((r) => r.routeId).filter(Boolean))] as string[]
  const routes: any[] = routeIds.length ? await db.select().from(recurringRoute).where(and(eq(recurringRoute.companyId, companyId), inArray(recurringRoute.id, routeIds))) : []
  const modeOf = new Map<string, { name: string; mode: BillingMode }>()
  for (const r of routes) modeOf.set(r.id, { name: r.name, mode: (await billingFor(db, companyId, r)).mode })

  const skipped = { alreadyBilled: 0, noRoute: 0, notMonthly: 0, noCustomer: 0, noPrice: 0 }
  const leftOut = new Map<string, { routeId: string; name: string; mode: BillingMode; visits: number }>()
  const byCustomer = new Map<string, any[]>()
  for (const r of rows) {
    const amount = round2(Number(r.estimatedValue || 0))
    if (billed.has(r.jobId)) { skipped.alreadyBilled++; continue }
    const route = r.routeId ? modeOf.get(r.routeId) : undefined
    if (!route) { skipped.noRoute++; continue }
    if (route.mode !== 'monthly') {
      skipped.notMonthly++
      const e = leftOut.get(r.routeId) ?? { routeId: r.routeId, name: route.name, mode: route.mode, visits: 0 }
      e.visits++; leftOut.set(r.routeId, e)
      continue
    }
    if (!r.contactId) { skipped.noCustomer++; continue }
    if (!(amount > 0)) { skipped.noPrice++; continue }
    const list = byCustomer.get(r.contactId) ?? []
    list.push({ jobId: r.jobId, number: r.number, title: r.title, scheduledDate: r.scheduledDate, siteId: r.siteId, siteName: r.siteName, amount, routeId: r.routeId })
    byCustomer.set(r.contactId, list)
  }
  const names: any[] = byCustomer.size
    ? await db.select({ id: contact.id, name: contact.name }).from(contact).where(and(eq(contact.companyId, companyId), inArray(contact.id, [...byCustomer.keys()])))
    : []
  const nameOf = new Map(names.map((n) => [n.id, n.name]))
  const customers = [...byCustomer.entries()].map(([contactId, visits]) => {
    // Grouped by property: a property's visits together (then by day); otherwise simply by day.
    const sorted = opts.groupBy === 'property'
      ? visits.slice().sort((a, b) => String(a.siteName).localeCompare(String(b.siteName)) || a.scheduledDate - b.scheduledDate)
      : visits.slice().sort((a, b) => a.scheduledDate - b.scheduledDate)
    return { contactId, name: nameOf.get(contactId) ?? 'Customer', visits: sorted, subtotal: round2(sorted.reduce((t, v) => t + v.amount, 0)) }
  }).sort((a, b) => a.name.localeCompare(b.name))
  return {
    customers, skipped, leftOutRoutes: [...leftOut.values()], staleLinkIds: stale,
    totals: { invoices: customers.length, visits: customers.reduce((t, c) => t + c.visits.length, 0), subtotal: round2(customers.reduce((t, c) => t + c.subtotal, 0)) },
  }
}

/** The company's own calendar day, terms and tax, read before a transaction opens (a pool read inside one deadlocks). */
async function invoiceContext(db: any, companyId: string) {
  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
  const settings = (co?.settings as any) || {}
  const today = businessToday(await companyTimeZone(db, companyId))
  return { settings, today, dueDate: dueDateFromTerms(settings, today), taxRate: defaultTaxRateFrom(settings) }
}

/** Make the monthly run: one DRAFT invoice per customer, a line per visit, all in one transaction under the billing lock. */
export async function createBatch(db: any, companyId: string, userId: string, opts: BatchOptions) {
  const ctx = await invoiceContext(db, companyId)
  return db.transaction(async (tx: any) => {
    await billingLock(tx, companyId)
    // Worked out again INSIDE the lock, so two runs at once cannot both bill the same visit.
    const plan = await previewBatch(tx, companyId, opts)
    if (!plan.customers.length) return { error: 'There are no completed, unbilled visits to bill in those dates.' as const }
    if (plan.staleLinkIds.length) await tx.delete(routeVisitInvoice).where(inArray(routeVisitInvoice.id, plan.staleLinkIds))
    const [batch] = await tx.insert(routeBillingBatch).values({
      companyId, fromDate: opts.from, toDate: opts.to, groupBy: opts.groupBy, createdById: userId,
    }).returning()
    const made: any[] = []
    for (const c of plan.customers) {
      const inv = await insertInvoice(tx, { invoice, invoiceLineItem } as any, INVOICE_NUMBERING, {
        companyId, contactId: c.contactId, notes: `Service visits ${opts.from} to ${opts.to}`,
        dueDate: ctx.dueDate, issueDate: ctx.today, taxRate: ctx.taxRate, status: 'draft',
      } as any, c.visits.map((v: any) => lineOf(v, opts.groupBy === 'property')) as any)
      const items = [...inv.lineItems].sort((a: any, b: any) => Number(a.sortOrder) - Number(b.sortOrder))
      await tx.insert(routeVisitInvoice).values(c.visits.map((v: any, i: number) => ({
        companyId, jobId: v.jobId, invoiceId: inv.id, invoiceLineItemId: items[i]?.id ?? null, batchId: batch.id, amount: String(v.amount),
      })))
      made.push({ id: inv.id, number: inv.number, contactId: c.contactId, customer: c.name, visits: c.visits.length, subtotal: c.subtotal, total: inv.total })
    }
    await tx.update(routeBillingBatch).set({ invoiceCount: made.length, visitCount: plan.totals.visits }).where(eq(routeBillingBatch.id, batch.id))
    return { batch: { ...batch, invoiceCount: made.length, visitCount: plan.totals.visits }, invoices: made, skipped: plan.skipped }
  })
}

/**
 * Bill ONE visit: a draft invoice through the shared engine, carrying the same invoice.job_id as any job's invoice. The visit
 * must be done, have a customer and a price, and not be billed already; a route billed elsewhere refuses, so an agreement's
 * customer is not billed twice by a click.
 */
export async function billVisit(db: any, companyId: string, jobId: string) {
  const ctx = await invoiceContext(db, companyId)
  return db.transaction(async (tx: any) => {
    await billingLock(tx, companyId)
    const [v] = await tx.select().from(job).where(and(eq(job.id, jobId), eq(job.companyId, companyId))).for('update')
    if (!v) return { status: 404 as const, error: 'Visit not found' }
    if (!v.recurringRouteStopId) return { status: 400 as const, error: 'This job is not a route visit. Bill it from its own invoice.' }
    if (v.status !== 'completed') return { status: 400 as const, error: 'Finish the visit first, then bill it.' }
    if (!v.contactId) return { status: 400 as const, error: 'This visit has no customer to bill. Add one to the property first.' }
    const amount = round2(Number(v.estimatedValue || 0))
    if (!(amount > 0)) return { status: 400 as const, error: 'This stop has no price. Set its price on the route, then bill the visit.' }
    const [stop] = await tx.select().from(recurringRouteStop).where(eq(recurringRouteStop.id, v.recurringRouteStopId)).limit(1)
    if (stop) {
      const [route] = await tx.select().from(recurringRoute).where(eq(recurringRoute.id, stop.recurringRouteId)).limit(1)
      if (route && (await billingFor(tx, companyId, route)).mode === 'elsewhere') {
        return { status: 409 as const, error: 'This route is billed by an agreement or recurring invoice. Change the route\'s billing first if you want its visits billed here.' }
      }
    }
    const { billed, stale } = await billedVisits(tx, companyId, [v.id])
    const already = billed.get(v.id)
    if (already) return { status: 409 as const, error: `This visit is already billed on invoice ${already.number}.`, invoiceId: already.invoiceId }
    if (stale.length) await tx.delete(routeVisitInvoice).where(inArray(routeVisitInvoice.id, stale))
    const [siteRow] = v.siteId ? await tx.select({ name: site.name }).from(site).where(eq(site.id, v.siteId)).limit(1) : [null]
    const visit = { title: v.title, number: v.number, scheduledDate: v.scheduledDate as Date, siteName: siteRow?.name ?? null, amount }
    const inv = await insertInvoice(tx, { invoice, invoiceLineItem } as any, INVOICE_NUMBERING, {
      companyId, contactId: v.contactId, dueDate: ctx.dueDate, issueDate: ctx.today, taxRate: ctx.taxRate, status: 'draft',
      extra: { jobId: v.id },
    } as any, [lineOf(visit, false)] as any)
    await tx.insert(routeVisitInvoice).values({ companyId, jobId: v.id, invoiceId: inv.id, invoiceLineItemId: inv.lineItems[0]?.id ?? null, amount: String(amount) })
    return { status: 201 as const, invoice: inv }
  })
}

/** A visit just finished: if its route bills per visit, the draft invoice is made now. Never throws into the job's completion. */
export async function billOnComplete(db: any, companyId: string, done: { id: string; recurringRouteStopId?: string | null }) {
  if (!done.recurringRouteStopId) return null
  const [row] = await db.select({ route: recurringRoute }).from(recurringRouteStop)
    .innerJoin(recurringRoute, eq(recurringRouteStop.recurringRouteId, recurringRoute.id))
    .where(and(eq(recurringRouteStop.id, done.recurringRouteStopId), eq(recurringRouteStop.companyId, companyId))).limit(1)
  if (!row || row.route.billingMode !== 'per_visit') return null
  const out = await billVisit(db, companyId, done.id)
  return 'invoice' in out ? out.invoice : null
}

/**
 * Undo a run: its invoices that are still untouched drafts are deleted (their visits become billable again); any that were
 * sent, paid or edited into something else are kept and named, so nothing a customer has seen is removed.
 */
export async function undoBatch(db: any, companyId: string, batchId: string) {
  const [batch] = await db.select().from(routeBillingBatch).where(and(eq(routeBillingBatch.id, batchId), eq(routeBillingBatch.companyId, companyId))).limit(1)
  if (!batch) return { status: 404 as const, error: 'Batch not found' }
  if (batch.undoneAt) return { status: 409 as const, error: 'This batch was already undone.' }
  const links = await db.select({ invoiceId: routeVisitInvoice.invoiceId }).from(routeVisitInvoice)
    .where(and(eq(routeVisitInvoice.batchId, batchId), eq(routeVisitInvoice.companyId, companyId)))
  const ids = [...new Set(links.map((l: any) => l.invoiceId))] as string[]
  const invoices: any[] = ids.length ? await db.select({ id: invoice.id, number: invoice.number, status: invoice.status, amountPaid: invoice.amountPaid, sentAt: invoice.sentAt })
    .from(invoice).where(and(eq(invoice.companyId, companyId), inArray(invoice.id, ids))) : []
  const untouched = (i: any) => i.status === 'draft' && Number(i.amountPaid) === 0 && !i.sentAt
  const kept: Array<{ id: string; number: string; status: string }> = []
  let removed = 0
  for (const i of invoices) {
    if (!untouched(i)) { kept.push({ id: i.id, number: i.number, status: i.status }); continue }
    try { await db.delete(invoice).where(and(eq(invoice.id, i.id), eq(invoice.companyId, companyId))); removed++ }
    catch { kept.push({ id: i.id, number: i.number, status: i.status }) }
  }
  if (!kept.length) await db.update(routeBillingBatch).set({ undoneAt: new Date() }).where(eq(routeBillingBatch.id, batchId))
  return { status: 200 as const, removed, kept, undone: kept.length === 0 }
}

/** The recent runs, newest first, each with how many of its invoices are still drafts (so the screen can offer Undo). */
export async function recentBatches(db: any, companyId: string, limit = 20) {
  const batches: any[] = await db.select().from(routeBillingBatch).where(eq(routeBillingBatch.companyId, companyId)).orderBy(desc(routeBillingBatch.createdAt)).limit(limit)
  if (!batches.length) return []
  const links: any[] = await db.select({ batchId: routeVisitInvoice.batchId, invoiceId: invoice.id, status: invoice.status }).from(routeVisitInvoice)
    .innerJoin(invoice, eq(routeVisitInvoice.invoiceId, invoice.id))
    .where(and(eq(routeVisitInvoice.companyId, companyId), inArray(routeVisitInvoice.batchId, batches.map((b) => b.id))))
  return batches.map((b) => {
    const mine = new Map<string, string>()
    for (const l of links) if (l.batchId === b.id) mine.set(l.invoiceId, l.status)
    return { ...b, invoicesLeft: mine.size, draftsLeft: [...mine.values()].filter((s) => s === 'draft').length }
  })
}
