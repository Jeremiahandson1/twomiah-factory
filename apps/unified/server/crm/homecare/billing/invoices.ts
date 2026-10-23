// Client invoicing for visits — the agency's Medicaid and private-pay invoices, their payments and write-offs, the
// payers' contract rates, the exports and the insurer-portal claim days. Moved from
// templates/crm-homecare/backend/src/routes/billing.ts (ported there from CVHC routes/billingRoutes.js). The numbers are
// decided in core/invoiceEngine.ts; this file is the HTTP surface. Its SQL is in server/data/homecareBillingRoutes.ts.
//
// Mounted at /api/billing beside the Factory subscription's three doors (modules/company.ts createSubscriptionRoutes),
// which the template's router composed the same way.
//
// Who: the template's whole router was requireAdmin (owner/admin). Each action now checks care-billing: reading
// (care-billing:read — the office manager holds it) or writing (create / update / delete — owner and admin). A
// caregiver holds none of it, so is refused every route, as before.
//
// Changes from the template (each reported in the move):
//   · every read and write is the signed-in person's company;
//   · replies are camelCase (the template's raw rows were snake_case, and its index.ts added snake aliases);
//   · lists are { data, pagination } (GET /invoices was { invoices, total });
//   · an engine refusal is { error, code }: the no-rate fix is in the sentence (it was a `message` field), a duplicate
//     period's invoice id and an overpayment's figures are a code (invoice_exists / overpayment), the figures in the
//     sentence as they already were.
import { Hono } from 'hono'
import { documentLinkToken, documentLinkPath } from '@twomiah/tenant-backend'
import { and, eq, asc, isNotNull } from 'drizzle-orm'
import {
  invoices, invoiceLineItems, invoiceAdjustments, invoicePayments, referralSources, referralSourceRates, clients, company,
} from '../../../db/schema/index.ts'
import {
  visitInvoicePage, visitInvoiceTotals, billingScheduleRows, clientsWithBillableActivity, pickableScheduledVisits, billedVisitLines,
  invoicePeriodsOverlapping, homemakingMinutes, visitInvoiceDetail, visitInvoiceLines, invoicePeriodOf, deleteVisitInvoice,
  invoiceForLineEdit, lockInvoicePaymentState, invoiceLinesInOrder, releaseVisitInvoice, appendInvoiceNote, invoiceForEmail,
  invoiceEmailLines, invoicePaymentRows, lockInvoiceRow, applyInvoiceWriteDown, invoiceAdjustmentRows, payerRateRows,
  missingPayerRates, retirePayerRate, updatePayerRate, invoiceCsvRows, evvExportRows, billingSummaryFigures,
} from '../../../data/homecareBillingRoutes.ts'
import { advanceBilledThrough, lockInvoiceMoney } from '../../../data/homecareBilling.ts'
import { BillingRefusal, noRateRefusal, applyRate, clampLineItemDescription, reformatTimesIn, to12h, round2, fmtTime12, lineQuantity } from '../core/invoiceEngine.ts'
import { ymdIn, addDays } from '../core/agencyTime.ts'
import { parseClaimPortal, WISCONSIN_PRESETS } from '../core/portalClaimDays.ts'
import type { HomecareCore } from '../core/index.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one, done, listAll } from '../../../http/reply.ts'
import { TIME_RE, isDate, num, body, who, refusalAware, csvDownload } from './shared.ts'

const periodFrom = (b: any) => ({
  clientId: b.clientId || b.client_id,
  start: b.billingPeriodStart || b.startDate,
  end: b.billingPeriodEnd || b.endDate,
})
const periodRefusal = (start: any, end: any) => {
  if (!isDate(start) || !isDate(end)) return 'Client and billing period are required'
  if (end < start) return 'The billing period ends before it starts'
  return null
}
const hms = (t: string) => (t && t.length === 5 ? `${t}:00` : t)
const visitKey = (v: { visitDate: string; startTime: string; caregiverId: string }) => `${v.visitDate}|${hms(String(v.startTime))}|${v.caregiverId}`
const fmtUsDate = (d: string | null) => {
  if (!d) return 'N/A'
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day, 12)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string))
const ADJUSTMENT_TYPES = ['write_off', 'discount', 'adjustment', 'refund', 'credit', 'other']

export function createVisitInvoiceRoutes(core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const engine = core.invoices
  const app = new Hono<AppEnv>()
  const read = requirePermission('care-billing:read')
  const create = requirePermission('care-billing:create')
  const update = requirePermission('care-billing:update')
  /**
   * The invoice's own private link (/d/<token>), minted the first time it is emailed and never changed — the CRM's
   * invoices' rule (packages/tenant-backend portal/documentLinks.ts). The email service puts the app's address in front,
   * as it does for every other invoice. The email linked /pay/<invoice id>, and only when FRONTEND_URL was set.
   */
  const documentPathFor = async (id: string) => {
    const token = await documentLinkToken(db, invoices, id)
    return token ? documentLinkPath(token) : null
  }
  const remove = requirePermission('care-billing:delete')

  async function companyName(companyId: string): Promise<string | null> {
    const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
    return co?.name ?? null
  }

  // ══════════════════════════════════════════════ INVOICES ══════════════════════════════════════════

  // GET /invoices — newest first, with the client, payer and billed hours. A list reply (the template: { invoices, total }).
  app.get('/invoices', read, async (c) => {
    const { companyId } = who(c)
    const { paymentStatus, status, clientId, startDate, endDate, page = '1', limit = '200' } = c.req.query()
    const lim = Math.min(Math.max(parseInt(limit) || 200, 1), 1000)
    const pg = Math.max(parseInt(page) || 1, 1)
    const { rows, total } = await visitInvoicePage(db, companyId, { paymentStatus: paymentStatus || status || null, clientId, startDate, endDate }, lim, (pg - 1) * lim)
    return list(c, rows, { page: pg, limit: lim, total })
  })

  // GET /invoices/totals — the Billing page's outstanding, aging and drafts over every invoice (data/homecareBillingRoutes.ts
  // visitInvoiceTotals). Before /invoices/:id.
  app.get('/invoices/totals', read, async (c) => {
    const { companyId } = who(c)
    return one(c, await visitInvoiceTotals(db, companyId, await core.time.today(companyId)))
  })

  // GET /invoices/billing-schedule — every active client's cadence and where their billing stands. A list reply.
  app.get('/invoices/billing-schedule', read, async (c) => {
    const { companyId } = who(c)
    const today = await core.time.today(companyId)
    const rows = (await billingScheduleRows(db, companyId)).map((r) => {
      let periodsDue = 0
      if (r.billingFrequencyWeeks && r.billedThrough) {
        const span = (new Date(today + 'T12:00:00Z').getTime() - new Date(r.billedThrough + 'T12:00:00Z').getTime()) / 86400000 - 1
        periodsDue = Math.max(0, Math.floor(span / (r.billingFrequencyWeeks * 7)))
      }
      return { ...r, today, periodsDue }
    })
    return listAll(c, rows)
  })

  // PATCH /invoices/billing-schedule/:clientId — set a cadence in weeks (1-8), or null for manual.
  app.patch('/invoices/billing-schedule/:clientId', update, async (c) => {
    const { companyId } = who(c)
    const { weeks } = await body(c)
    const w = weeks == null || weeks === '' ? null : Number(weeks)
    if (w != null && (!Number.isInteger(w) || w < 1 || w > 8)) return fail(c, 400, 'weeks must be 1-8 or null')
    const [r] = await db.update(clients).set({ billingFrequencyWeeks: w, updatedAt: new Date() })
      .where(and(eq(clients.id, c.req.param('clientId')), eq(clients.companyId, companyId)))
      .returning({ id: clients.id, billingFrequencyWeeks: clients.billingFrequencyWeeks })
    if (!r) return fail(c, 404, 'Client not found')
    return one(c, r)
  })

  // POST /invoices/preview — the line items generation WOULD produce, saving nothing. The manual form's "Import from
  // Schedule + EVV" button fills its lines from this.
  app.post('/invoices/preview', read, refusalAware(async (c) => {
    const { companyId } = who(c)
    const { clientId, start, end } = periodFrom(await body(c))
    if (!clientId || periodRefusal(start, end)) return fail(c, 400, 'clientId, billingPeriodStart, billingPeriodEnd are required')
    const client = await engine.loadBillingClient(companyId, clientId)
    if (!client) return fail(c, 404, 'Client not found')
    const { lineItems, total, rate } = await engine.generateLineItems(companyId, client, start, end)
    return one(c, {
      lineItems, total, rate,
      counts: {
        total: lineItems.length,
        evvConfirmed: lineItems.filter((li) => li.source === 'evv_confirmed').length,
        scheduled: lineItems.filter((li) => li.source === 'scheduled').length,
        unscheduled: lineItems.filter((li) => li.source === 'unscheduled_evv').length,
      },
    })
  }))

  // POST /invoices/reconcile — the review step BEFORE an invoice exists. One row per billable day: the shift as
  // scheduled, the punch as recorded, and what each would bill.
  app.post('/invoices/reconcile', read, refusalAware(async (c) => {
    const { companyId } = who(c)
    const b = await body(c)
    const { clientId, start, end } = periodFrom(b)
    if (!clientId || periodRefusal(start, end)) return fail(c, 400, 'clientId, billingPeriodStart, billingPeriodEnd are required')
    const client = await engine.loadBillingClient(companyId, clientId)
    if (!client) return fail(c, 404, 'Client not found')
    const { reconcile, total, skipped, rate } = await engine.generateLineItems(companyId, client, start, end, { choices: b.choices || {} })
    return one(c, {
      reconcile, skipped, total, rate,
      counts: {
        days: reconcile.length,
        skipped: skipped.length,
        needsChoice: reconcile.filter((r) => r.needsChoice).length,
        match: reconcile.filter((r) => r.status === 'match').length,
        noPunch: reconcile.filter((r) => r.status === 'no_punch').length,
        short: reconcile.filter((r) => r.status === 'short').length,
        long: reconcile.filter((r) => r.status === 'long').length,
        unscheduled: reconcile.filter((r) => r.status === 'unscheduled').length,
      },
    })
  }))

  // POST /invoices/generate-with-rates — one invoice, with the reviewer's per-day choices. Atomic.
  const generateOne = refusalAware(async (c: any) => {
    const { companyId } = who(c)
    const b = await body(c)
    const { clientId, start, end } = periodFrom(b)
    if (!clientId || periodRefusal(start, end)) return fail(c, 400, 'Client and billing period are required')
    const client = await engine.loadBillingClient(companyId, clientId)
    if (!client) return fail(c, 404, 'Client not found')
    const { lineItems, total } = await engine.generateLineItems(companyId, client, start, end, { choices: b.choices || {} })
    if (lineItems.length === 0) {
      return fail(c, 400, 'No scheduled visits or completed EVV entries found for this client in the selected period')
    }
    const invoice = await engine.createInvoiceWithLines({ companyId, client, periodStart: start, periodEnd: end, lineItems, total, notes: b.notes || null })
    let referralSourceName: string | null = null
    if (client.referredById && !client.isPrivatePay) {
      const [rs] = await db.select({ name: referralSources.name }).from(referralSources)
        .where(and(eq(referralSources.id, client.referredById), eq(referralSources.companyId, companyId))).limit(1)
      referralSourceName = rs?.name ?? null
    }
    return one(c, {
      ...invoice,
      firstName: client.firstName, lastName: client.lastName,
      referralSourceName,
      lineItems,
      totalHours: lineItems.reduce((s, li) => s + li.hours, 0),
    }, 201)
  })
  app.post('/invoices/generate-with-rates', create, generateOne)
  // The older path (frontend config.generateInvoice) — the same engine, not a second one.
  app.post('/invoices/generate', create, generateOne)

  // POST /invoices/manual — custom lines. The RATE comes from the client record, never the request.
  app.post('/invoices/manual', create, refusalAware(async (c) => {
    const { companyId } = who(c)
    const b = await body(c)
    const { clientId, start, end } = periodFrom(b)
    if (!clientId || periodRefusal(start, end)) return fail(c, 400, 'Client and billing period are required')
    const items: any[] = Array.isArray(b.lineItems) ? b.lineItems : []
    if (items.length === 0) return fail(c, 400, 'At least one line item is required')
    // caregiver_id is NOT NULL on a line; refusing up front keeps a blank caregiver from failing the insert after the
    // header was written.
    if (items.some((li) => !(li.caregiverId || li.caregiver_id))) return fail(c, 400, 'Each line item needs a caregiver.')
    const client = await engine.loadBillingClient(companyId, clientId)
    if (!client) return fail(c, 404, 'Client not found')
    const resolved = await engine.resolveClientRate(companyId, client, start, end)
    if (!resolved || !(resolved.rate > 0)) throw noRateRefusal(client)

    const hhmm = (t: any) => (typeof t === 'string' && TIME_RE.test(t) ? (t.length === 5 ? `${t}:00` : t) : null)
    const lines = items.map((item) => {
      const { hours, rate, rateType, amount } = applyRate(item, resolved)
      let description = item.description || 'Home Care Services'
      if (b.detailedMode && item.startTime && item.endTime) description = `${description} (${to12h(item.startTime)} - ${to12h(item.endTime)})`
      return {
        caregiverId: item.caregiverId || item.caregiver_id,
        caregiverName: item.caregiverName || '',
        timeEntryId: item.timeEntryId || item.time_entry_id || null,
        description, hours, rate, rateType, amount,
        serviceDate: isDate(item.serviceDate) ? item.serviceDate : null,
        visitStart: hhmm(item.startTime), visitEnd: hhmm(item.endTime),
        billedBasis: null, scheduledMinutes: null, clockedMinutes: null,
      }
    })
    const total = round2(lines.reduce((s, l) => s + l.amount, 0))
    const invoice = await engine.createInvoiceWithLines({ companyId, client, periodStart: start, periodEnd: end, lineItems: lines, total, notes: b.notes || null })
    return one(c, {
      ...invoice,
      firstName: client.firstName, lastName: client.lastName,
      lineItems: lines.map((l) => ({
        ...l,
        caregiverFirstName: String(l.caregiverName).split(' ')[0] || '',
        caregiverLastName: String(l.caregiverName).split(' ').slice(1).join(' ') || '',
      })),
      totalHours: lines.reduce((s, l) => s + l.hours, 0),
    }, 201)
  }))

  // POST /invoices/batch-generate — every client with activity in the period. A batch has nowhere to ask "scheduled or
  // clocked?", so a client with an unresolved day is skipped, never billed on a guess.
  app.post('/invoices/batch-generate', create, async (c) => {
    const { companyId } = who(c)
    const b = await body(c)
    const start = b.billingPeriodStart, end = b.billingPeriodEnd
    if (periodRefusal(start, end)) return fail(c, 400, 'Billing period is required')
    const tz = await core.time.timezone(companyId)
    const candidates = await clientsWithBillableActivity(db, companyId, start, end, tz, b)
    let count = 0, totalAmount = 0, totalHours = 0
    const invoicesOut: any[] = [], skippedClients: any[] = []
    for (const row of candidates) {
      const name = `${row.firstName} ${row.lastName}`
      try {
        const client = await engine.loadBillingClient(companyId, row.id)
        const { lineItems, total, reconcile } = await engine.generateLineItems(companyId, client, start, end)
        if (lineItems.length === 0 || total <= 0) { skippedClients.push({ name, reason: 'No billable hours found' }); continue }
        const unresolved = reconcile.filter((r) => r.needsChoice)
        if (unresolved.length) {
          skippedClients.push({
            name, needsReview: true, days: unresolved.map((r) => r.serviceDate),
            reason: `${unresolved.length} day${unresolved.length === 1 ? '' : 's'} where the clock-in doesn't match the schedule — generate this client on its own to review them`,
          })
          continue
        }
        const inv = await engine.createInvoiceWithLines({ companyId, client, periodStart: start, periodEnd: end, lineItems, total })
        const hours = lineItems.reduce((s, li) => s + li.hours, 0)
        count++; totalAmount += total; totalHours += hours
        invoicesOut.push({ invoiceNumber: inv.invoiceNumber, seqNumber: inv.seqNumber, clientName: name, total, hours })
      } catch (e: any) {
        if (e instanceof BillingRefusal) skippedClients.push({ name, reason: String(e.body.error) + (e.body.message ? ` — ${e.body.message}` : '') })
        else skippedClients.push({ name, reason: `Failed: ${e.message}` })
      }
    }
    return one(c, {
      count, skipped: skippedClients.length, total: round2(totalAmount), totalHours,
      invoices: invoicesOut, skippedClients,
      // the older response shape
      generated: count,
    })
  })

  // POST /invoices/generate-due — for every client with a cadence, a DRAFT invoice for each COMPLETE period since
  // billedThrough. Never bills a period in progress, never regenerates covered ground, never bills on a guess.
  // { dryRun: true } previews without writing.
  app.post('/invoices/generate-due', create, async (c) => {
    const { companyId } = who(c)
    const MAX_PERIODS_PER_CLIENT = 6 // catch-up backstop
    const b = await body(c)
    const dryRun = b.dryRun === true
    const today = await core.time.today(companyId)
    const cadenced = await db.select({ id: clients.id }).from(clients)
      .where(and(eq(clients.companyId, companyId), eq(clients.isActive, true), isNotNull(clients.billingFrequencyWeeks)))
      .orderBy(asc(clients.lastName), asc(clients.firstName))
    const created: any[] = [], skipped: any[] = [], emptyPeriods: any[] = []
    for (const { id } of cadenced) {
      const client = await engine.loadBillingClient(companyId, id)
      if (!client) continue
      const name = `${client.firstName} ${client.lastName}`
      if (!client.billedThrough) {
        skipped.push({ name, reason: 'No previous invoice — generate the first one manually to set the starting point' })
        continue
      }
      let anchor = client.billedThrough as string
      for (let p = 0; p < MAX_PERIODS_PER_CLIENT; p++) {
        const periodStart = addDays(anchor, 1)
        const periodEnd = addDays(anchor, client.billingFrequencyWeeks * 7)
        if (periodEnd >= today) break // period not complete yet
        const existing = await db.select({ id: invoices.id }).from(invoices)
          .where(and(eq(invoices.companyId, companyId), eq(invoices.clientId, id), eq(invoices.billingPeriodStart, periodStart), eq(invoices.billingPeriodEnd, periodEnd)))
        if (existing.length) {
          if (!dryRun) await advanceBilledThrough(db, companyId, id, periodEnd, 'set')
          anchor = periodEnd
          continue
        }
        let gen
        try { gen = await engine.generateLineItems(companyId, client, periodStart, periodEnd) } catch (e: any) {
          if (e instanceof BillingRefusal) { skipped.push({ name, period: `${periodStart} – ${periodEnd}`, reason: String(e.body.error), needsReview: true }); break }
          throw e
        }
        const { lineItems, total, reconcile } = gen
        const unresolved = reconcile.filter((r) => r.needsChoice)
        const overlaps = reconcile.filter((r) => r.overlapMinutes > 0)
        if (unresolved.length || overlaps.length) {
          const why: string[] = []
          if (unresolved.length) why.push(`${unresolved.length} day${unresolved.length === 1 ? '' : 's'} where the clock-in doesn't match the schedule`)
          if (overlaps.length) why.push(`overlapping schedules on ${[...new Set(overlaps.map((o) => o.serviceDate))].join(', ')}`)
          skipped.push({ name, period: `${periodStart} – ${periodEnd}`, reason: why.join('; ') + ' — generate this client on its own to review', needsReview: true })
          break // don't advance, don't try later periods out of order
        }
        if (lineItems.length === 0 || total <= 0) {
          if (!dryRun) await advanceBilledThrough(db, companyId, id, periodEnd, 'set')
          emptyPeriods.push({ name, period: `${periodStart} – ${periodEnd}` })
          anchor = periodEnd
          continue
        }
        const hours = lineItems.reduce((s, li) => s + li.hours, 0)
        if (dryRun) {
          created.push({ name, invoiceNumber: '(preview)', period: `${periodStart} – ${periodEnd}`, total, hours })
          anchor = periodEnd
          continue
        }
        try {
          const inv = await engine.createInvoiceWithLines({ companyId, client, periodStart, periodEnd, lineItems, total, advanceBilledThrough: 'set' })
          created.push({ name, invoiceNumber: inv.invoiceNumber, seqNumber: inv.seqNumber, period: `${periodStart} – ${periodEnd}`, total, hours })
          anchor = periodEnd
        } catch (e: any) {
          skipped.push({ name, period: `${periodStart} – ${periodEnd}`, reason: `Failed: ${e instanceof BillingRefusal ? e.body.error : e.message}` })
          break
        }
      }
    }
    return one(c, {
      created, skipped, emptyPeriods, dryRun,
      summary: `${created.length} invoice${created.length === 1 ? '' : 's'} ${dryRun ? 'would be ' : ''}created · ${skipped.length} skipped · ${emptyPeriods.length} empty period${emptyPeriods.length === 1 ? '' : 's'} ${dryRun ? 'would be ' : ''}advanced`,
    })
  })

  /** Which invoice already bills each visit: by its line (day, start, caregiver), else by an overlapping period. */
  async function billedVisitMap(companyId: string, clientId: string, from: string, to: string) {
    const lines = await billedVisitLines(db, companyId, clientId, from, to)
    const periods = await invoicePeriodsOverlapping(db, companyId, clientId, from, to)
    const byLine = new Map(lines.map((l: any) => [visitKey(l), l.invoiceNumber as string]))
    return { byLine, byPeriod: (day: string) => periods.find((p) => p.s <= day && p.e >= day)?.invoiceNumber || null }
  }

  // GET /scheduled-visits?clientId&from&to — the client's scheduled (non-cancelled) visits, each marked with the invoice
  // that already bills it, for "Invoice picked visits". A list reply.
  app.get('/scheduled-visits', read, async (c) => {
    const { companyId } = who(c)
    const { clientId, from, to } = c.req.query()
    if (!clientId || periodRefusal(from, to)) return fail(c, 400, 'clientId, from and to are required')
    const visits = await pickableScheduledVisits(db, companyId, clientId, from, to)
    const billed = await billedVisitMap(companyId, clientId, from, to)
    const rows = visits.map((v) => ({ ...v, billedOn: billed.byLine.get(visitKey(v)) || billed.byPeriod(v.visitDate) || null }))
    return listAll(c, rows)
  })

  // POST /invoices/from-visits — an invoice built from visits the office picks one by one (CVHC's Visit Documentation
  // invoice, for clients whose caregiver doesn't use the app). Each visit is re-checked against the schedule and refused
  // if an invoice already bills it. Created as a draft. Body: { clientId, visits: [{ visitDate, startTime, caregiverId }] }
  app.post('/invoices/from-visits', create, refusalAware(async (c) => {
    const { companyId } = who(c)
    const b = await body(c)
    const clientId = b.clientId
    const picked: any[] = Array.isArray(b.visits) ? b.visits : []
    if (!clientId) return fail(c, 400, 'clientId is required')
    if (picked.length === 0) return fail(c, 400, 'Pick at least one visit.')
    if (picked.some((p) => !isDate(p?.visitDate) || !TIME_RE.test(p?.startTime || '') || !p?.caregiverId)) {
      return fail(c, 400, 'Each visit needs visitDate, startTime and caregiverId.')
    }
    const dates = picked.map((p) => p.visitDate).sort()
    const from = dates[0], to = dates[dates.length - 1]
    const client = await engine.loadBillingClient(companyId, clientId)
    if (!client) return fail(c, 404, 'Client not found')
    const resolved = await engine.resolveClientRate(companyId, client, from, to)
    if (!resolved || !(resolved.rate > 0) || resolved.rateType !== 'hourly') {
      return fail(c, 400, `No hourly billing rate is set for ${client.firstName} ${client.lastName}. Set the payer's rate (Billing → Rates) or the client's private-pay rate.`, 'no_billing_rate')
    }
    const fmtD = (day: string) => { const [y, m, dd] = day.split('-'); return `${Number(m)}/${Number(dd)}/${y}` }
    const scheduled = new Map((await pickableScheduledVisits(db, companyId, clientId, from, to)).map((v) => [visitKey(v), v]))
    const wanted: any[] = []
    const seen = new Set<string>()
    for (const p of picked) {
      const key = visitKey({ visitDate: p.visitDate, startTime: p.startTime, caregiverId: p.caregiverId })
      if (seen.has(key)) continue
      seen.add(key)
      const v = scheduled.get(key)
      if (!v) return fail(c, 400, `${fmtD(p.visitDate)} ${fmtTime12(p.startTime)} is not a scheduled visit (it may have been cancelled).`)
      wanted.push(v)
    }
    const billed = await billedVisitMap(companyId, clientId, from, to)
    for (const v of wanted) {
      const on = billed.byLine.get(visitKey(v)) || billed.byPeriod(v.visitDate)
      if (on) return fail(c, 409, `${fmtD(v.visitDate)} is already billed on invoice ${on}.`, 'visit_already_billed')
    }
    // Homemaking split: the per-visit minutes of the client's active homemaking (IADL) care tasks bill as "Homemaking",
    // the rest of the visit as "Home health aide" (care's client_task_templates).
    const homemakingMin = await homemakingMinutes(db, companyId, clientId)
    const lines: any[] = []
    for (const v of wanted) {
      const hm = Math.min(Math.max(homemakingMin, 0), Number(v.minutes))
      const parts = [{ service: 'Home health aide', minutes: Number(v.minutes) - hm }, { service: 'Homemaking', minutes: hm }].filter((p) => p.minutes > 0)
      for (const part of parts) {
        const hours = round2(part.minutes / 60)
        lines.push({
          caregiverId: v.caregiverId,
          description: `${part.service} (${fmtTime12(v.startTime)} - ${fmtTime12(v.endTime)})`,
          hours, rate: resolved.rate, rateType: 'hourly', amount: round2(hours * resolved.rate),
          serviceDate: v.visitDate, visitStart: hms(v.startTime), visitEnd: hms(v.endTime),
          billedBasis: 'scheduled', scheduledMinutes: part.minutes, clockedMinutes: null,
        })
      }
    }
    const total = round2(lines.reduce((s, l) => s + l.amount, 0))
    const inv = await engine.createInvoiceWithLines({
      companyId, client, periodStart: from, periodEnd: to, lineItems: lines, total, advanceBilledThrough: false,
      notes: `Built from ${wanted.length} visit${wanted.length === 1 ? '' : 's'} picked in Billing`,
    })
    return one(c, { ...inv, visits: wanted.length, lines: lines.length }, 201)
  }))

  // GET /invoices/:id — one invoice with its lines, and each visit's care note when one is recorded.
  app.get('/invoices/:id', read, async (c) => {
    const { companyId } = who(c)
    const id = c.req.param('id')
    const inv = await visitInvoiceDetail(db, companyId, id)
    if (!inv) return fail(c, 404, 'Invoice not found')
    const lines = (await visitInvoiceLines(db, companyId, id, inv.clientId)).map((li) => ({ ...li, description: reformatTimesIn(li.description) }))
    return one(c, {
      ...inv,
      client: { firstName: inv.firstName, lastName: inv.lastName, address: inv.address, city: inv.city, state: inv.state, zip: inv.zip },
      lineItems: lines,
      totalHours: Number(lines.reduce((s, li) => s + num(li.hours), 0).toFixed(2)),
    })
  })

  // PUT /invoices/:id/payment-status — Mark Paid, or set another status. "paid" RECORDS A PAYMENT for whatever is still
  // due (method 'other', dated paymentDate or today), so the payments ledger stays the one source of what was collected.
  async function setPaymentStatus(c: any, id: string, b: any) {
    const { companyId, userId } = who(c)
    const status = b.status || b.paymentStatus
    if (!['pending', 'paid', 'partial', 'overdue'].includes(status)) return fail(c, 400, 'status must be pending, paid, partial or overdue')
    const [exists] = await db.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.id, id), eq(invoices.companyId, companyId))).limit(1)
    if (!exists) return fail(c, 404, 'Invoice not found')
    if (status === 'paid') {
      const pd = isDate(String(b.paymentDate || '').slice(0, 10)) ? String(b.paymentDate).slice(0, 10) : await core.time.today(companyId)
      await engine.recordInvoicePayment({ companyId, invoiceId: id, amount: 'balance', paymentDate: pd, method: b.paymentMethod || 'other', notes: 'Marked paid', userId })
    } else {
      await db.update(invoices).set({ paymentStatus: status, updatedAt: new Date() }).where(and(eq(invoices.id, id), eq(invoices.companyId, companyId)))
    }
    const [row] = await db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.companyId, companyId))).limit(1)
    return one(c, row)
  }
  app.put('/invoices/:id/payment-status', update, refusalAware(async (c) => setPaymentStatus(c, c.req.param('id'), await body(c))))
  // The older verb for the same thing.
  app.patch('/invoices/:id/status', update, refusalAware(async (c) => setPaymentStatus(c, c.req.param('id'), await body(c))))

  // DELETE /invoices/:id — the invoice and its dependent rows. When it was the client's latest billed period,
  // billedThrough steps back to before it, so "Create Due Invoices" bills that period again instead of skipping it.
  app.delete('/invoices/:id', remove, async (c) => {
    const { companyId } = who(c)
    const inv = await invoicePeriodOf(db, companyId, c.req.param('id'))
    if (!inv) return fail(c, 404, 'Invoice not found')
    await db.transaction(async (tx: any) => { await deleteVisitInvoice(tx, companyId, inv) })
    return done(c, `Invoice ${inv.invoiceNumber} deleted successfully`)
  })

  // PUT /invoices/:id/line-items — replace an unpaid invoice's lines and recompute its totals. Refused once any money has
  // been collected. Same rate rule as creation.
  app.put('/invoices/:id/line-items', update, refusalAware(async (c) => {
    const { companyId } = who(c)
    const id = c.req.param('id')
    const b = await body(c)
    const items: any[] = Array.isArray(b.lineItems) ? b.lineItems : []
    if (items.length === 0) return fail(c, 400, 'At least one line item is required')
    const inv = await invoiceForLineEdit(db, companyId, id)
    if (!inv) return fail(c, 404, 'Invoice not found')
    if (inv.paymentStatus === 'paid' || num(inv.amountPaid) > 0) {
      return fail(c, 409, 'This invoice has a payment recorded and can no longer be edited.', 'invoice_has_payment')
    }
    const client = await engine.loadBillingClient(companyId, inv.clientId)
    const resolved = await engine.resolveClientRate(companyId, client, inv.s, inv.e)
    if (!resolved || !(resolved.rate > 0)) throw noRateRefusal(client, 'edit these lines')
    // A line keeps its caregiver; a NEW line with none falls back to the invoice's first caregiver (caregiver_id is NOT
    // NULL on a line).
    const [existing] = await db.select({ caregiverId: invoiceLineItems.caregiverId }).from(invoiceLineItems)
      .where(and(eq(invoiceLineItems.invoiceId, id), eq(invoiceLineItems.companyId, companyId))).limit(1)
    const fallbackCaregiver = existing?.caregiverId || null
    let subtotal = 0
    const prepared = items.map((item) => {
      const { hours, rate, rateType, amount } = applyRate(item, resolved)
      subtotal += amount
      let description = item.description || 'Home Care Services'
      if (b.detailedMode && item.startTime && item.endTime) description = `${description} (${to12h(item.startTime)} - ${to12h(item.endTime)})`
      const sd = String(item.serviceDate || item.service_date || '').slice(0, 10)
      // The visit's identity (its scheduled start) is start_time / visitStart; startTime is the form's detailed time.
      const st = item.start_time ?? item.visitStart, et = item.end_time ?? item.visitEnd
      const basis = item.billedBasis ?? item.billed_basis
      return {
        caregiverId: item.caregiverId || item.caregiver_id || fallbackCaregiver,
        description: clampLineItemDescription(description), hours, rate, rateType, amount,
        serviceDate: isDate(sd) ? sd : null,
        timeEntryId: item.timeEntryId || item.time_entry_id || null,
        visitStart: TIME_RE.test(st || '') ? hms(st) : null,
        visitEnd: TIME_RE.test(et || '') ? hms(et) : null,
        billedBasis: ['scheduled', 'clocked', 'unscheduled'].includes(basis) ? basis : null,
        scheduledMinutes: item.scheduledMinutes ?? item.scheduled_minutes ?? null, clockedMinutes: item.clockedMinutes ?? item.clocked_minutes ?? null,
      }
    })
    if (prepared.some((p) => !p.caregiverId)) return fail(c, 400, 'Each line item needs a caregiver.')
    subtotal = round2(subtotal)
    const total = round2(subtotal + num(inv.tax))
    const updated = await db.transaction(async (tx: any) => {
      const locked = await lockInvoicePaymentState(tx, companyId, id)
      if (!locked || locked.paymentStatus === 'paid' || num(locked.amountPaid) > 0) {
        throw new BillingRefusal(409, { error: 'This invoice has a payment recorded and can no longer be edited.' })
      }
      await tx.delete(invoiceLineItems).where(and(eq(invoiceLineItems.invoiceId, id), eq(invoiceLineItems.companyId, companyId)))
      await engine.insertLineItems(companyId, id, prepared, tx)
      const [row] = await tx.update(invoices).set({ subtotal: String(subtotal), total: String(total), updatedAt: new Date() })
        .where(and(eq(invoices.id, id), eq(invoices.companyId, companyId))).returning()
      return row
    })
    return one(c, { ...updated, lineItems: await invoiceLinesInOrder(db, companyId, id) })
  }))

  // POST /invoices/:id/release — make a reviewed draft visible in the family portal without emailing.
  app.post('/invoices/:id/release', update, async (c) => {
    const { companyId } = who(c)
    const r = await releaseVisitInvoice(db, companyId, c.req.param('id'))
    if (!r) return fail(c, 404, 'Invoice not found')
    return one(c, { success: true, sentAt: r.sentAt })
  })

  // POST /invoices/:id/rescind — back to draft: hidden from the portal, its pay link stops working. Refused once a
  // payment is recorded (the portal shows paid/partial invoices regardless).
  app.post('/invoices/:id/rescind', update, async (c) => {
    const { companyId } = who(c)
    const id = c.req.param('id')
    const [inv] = await db.select({ id: invoices.id, sentAt: invoices.sentAt, paymentStatus: invoices.paymentStatus, amountPaid: invoices.amountPaid })
      .from(invoices).where(and(eq(invoices.id, id), eq(invoices.companyId, companyId))).limit(1)
    if (!inv) return fail(c, 404, 'Invoice not found')
    if (!inv.sentAt) return fail(c, 400, 'Invoice is already a draft — nothing to rescind.')
    if (num(inv.amountPaid) > 0 || ['paid', 'partial'].includes(inv.paymentStatus)) {
      return fail(c, 400, 'A payment has been recorded on this invoice, so the portal will show it regardless. Adjust or refund the payment first.')
    }
    const tz = await core.time.timezone(companyId)
    await appendInvoiceNote(db, companyId, id, `\nRescinded (returned to draft) on ${ymdIn(new Date(), tz)}`, 'clear')
    return done(c)
  })

  // POST /invoices/:id/send-email — email the invoice with a pay link. Sending releases the draft.
  app.post('/invoices/:id/send-email', update, async (c) => {
    const { companyId } = who(c)
    const id = c.req.param('id')
    const invoice = await invoiceForEmail(db, companyId, id)
    if (!invoice) return fail(c, 404, 'Invoice not found')
    const b = await body(c)
    const to = b.email || invoice.clientEmail
    if (!to) return fail(c, 400, 'No email address found for this client. Please provide an email.')
    if (!core.email.isConfigured) return fail(c, 503, 'Email service not configured on server.')
    const amountDue = num(invoice.total) - num(invoice.amountPaid) - num(invoice.amountAdjusted)
    const lines = await invoiceEmailLines(db, companyId, id)
    const lineItemsHtml = lines.map((li) =>
      `<tr><td>${li.serviceDate ? fmtUsDate(li.serviceDate) : ''}</td><td>${esc(reformatTimesIn(li.description))}</td><td>${esc(lineQuantity(li).quantityLabel)} × ${esc(lineQuantity(li).rateLabel)}</td><td>$${num(li.amount).toFixed(2)}</td></tr>`).join('')
    try {
      await core.email.sendInvoiceEmail(to, {
        companyName: (await companyName(companyId)) || process.env.COMPANY_NAME || 'Our agency',
        contactName: `${invoice.firstName} ${invoice.lastName}`,
        invoiceNumber: invoice.seqNumber ?? invoice.invoiceNumber,
        total: num(invoice.total).toFixed(2),
        amountDue: amountDue.toFixed(2),
        dueDate: fmtUsDate(invoice.dueText),
        lineItems: lineItemsHtml,
        documentPath: await documentPathFor(id),
      })
    } catch (e: any) {
      return fail(c, 502, `Email send failed: ${e.message}`)
    }
    const tz = await core.time.timezone(companyId)
    await appendInvoiceNote(db, companyId, id, `\nEmailed to ${to} on ${ymdIn(new Date(), tz)}`, 'stamp')
    return one(c, { success: true, sentTo: to })
  })

  // POST /invoices/:id/send-reminder — "due soon" / "N days past due". Refused on a paid invoice.
  app.post('/invoices/:id/send-reminder', update, async (c) => {
    const { companyId } = who(c)
    const id = c.req.param('id')
    const invoice = await invoiceForEmail(db, companyId, id)
    if (!invoice) return fail(c, 404, 'Invoice not found')
    if (invoice.paymentStatus === 'paid') return fail(c, 400, 'This invoice is already paid — no reminder needed.')
    const b = await body(c)
    const to = b.email || invoice.clientEmail
    if (!to) return fail(c, 400, 'No email address found for this client. Please provide an email.')
    if (!core.email.isConfigured) return fail(c, 503, 'Email service not configured on server.')
    const amountDue = num(invoice.total) - num(invoice.amountPaid) - num(invoice.amountAdjusted)
    if (amountDue <= 0) return fail(c, 400, 'No balance due on this invoice.')
    const tz = await core.time.timezone(companyId)
    const today = ymdIn(new Date(), tz)
    const daysOverdue = invoice.dueText
      ? Math.floor((new Date(today + 'T12:00:00Z').getTime() - new Date(invoice.dueText + 'T12:00:00Z').getTime()) / 86400000)
      : 0
    try {
      await core.email.sendInvoiceReminder(to, {
        companyName: (await companyName(companyId)) || process.env.COMPANY_NAME || 'Our agency',
        contactName: `${invoice.firstName} ${invoice.lastName}`,
        invoiceNumber: invoice.seqNumber ?? invoice.invoiceNumber,
        amountDue: amountDue.toFixed(2),
        dueDate: fmtUsDate(invoice.dueText),
        daysOverdue,
        documentPath: await documentPathFor(id),
      })
    } catch (e: any) {
      return fail(c, 502, `Email send failed: ${e.message}`)
    }
    const label = daysOverdue > 0 ? `${daysOverdue}d overdue` : 'pre-due'
    await appendInvoiceNote(db, companyId, id, `\nReminder sent to ${to} on ${today} (${label})`, 'stamp')
    return one(c, { success: true, sentTo: to, daysOverdue })
  })

  // ═════════════════════════════════════════ PAYMENTS & ADJUSTMENTS ═════════════════════════════════

  // GET /invoice-payments — a list reply.
  app.get('/invoice-payments', read, async (c) => {
    const { companyId } = who(c)
    const { invoiceId, startDate, endDate } = c.req.query()
    const rows = await invoicePaymentRows(db, companyId, { invoiceId, startDate, endDate })
    return listAll(c, rows)
  })

  // POST /invoice-payments — record a payment. One transaction with the invoice row locked, so two concurrent payments
  // cannot both pass the balance check, and a payment past the balance is refused (a check entered twice once doubled an
  // invoice) unless allowOverpayment is sent.
  app.post('/invoice-payments', create, refusalAware(async (c) => {
    const { companyId, userId } = who(c)
    const b = await body(c)
    const invoiceId = b.invoiceId || b.invoice_id
    const amt = Number(b.amount)
    if (!invoiceId) return fail(c, 400, 'invoiceId is required')
    if (!Number.isFinite(amt) || amt <= 0) return fail(c, 400, 'Payment amount must be a positive number')
    const pd = b.paymentDate || b.payment_date
    const paymentDate = isDate(pd) ? pd : await core.time.today(companyId)
    const payment = await engine.recordInvoicePayment({
      companyId, invoiceId, amount: amt, paymentDate, method: b.paymentMethod || b.payment_method || 'check',
      reference: b.referenceNumber || b.reference_number || null, notes: b.notes || null, userId,
      allowOverpayment: !!b.allowOverpayment,
    })
    // null: a payment with this reference is already on the invoice.
    return payment ? one(c, payment, 201) : done(c, 'That payment is already recorded.')
  }))

  app.delete('/invoice-payments/:id', remove, async (c) => {
    const { companyId } = who(c)
    const id = c.req.param('id')
    const [p] = await db.select({ invoiceId: invoicePayments.invoiceId }).from(invoicePayments)
      .where(and(eq(invoicePayments.id, id), eq(invoicePayments.companyId, companyId))).limit(1)
    if (!p) return fail(c, 404, 'Payment not found')
    await db.transaction(async (tx: any) => {
      await lockInvoiceRow(tx, companyId, p.invoiceId)
      await tx.delete(invoicePayments).where(and(eq(invoicePayments.id, id), eq(invoicePayments.companyId, companyId)))
      await engine.rollUpPayments(companyId, p.invoiceId, null, tx)
    })
    return done(c)
  })

  async function recordAdjustment(c: any, invoiceId: string, b: any) {
    const { companyId, userId } = who(c)
    const amount = Number(b.amount)
    const type = b.type || b.adjustmentType || b.adjustment_type
    if (!invoiceId) return fail(c, 400, 'invoiceId is required')
    if (!Number.isFinite(amount) || amount <= 0) return fail(c, 400, 'Adjustment amount must be a positive number')
    if (!ADJUSTMENT_TYPES.includes(type)) return fail(c, 400, `type must be one of ${ADJUSTMENT_TYPES.join(', ')}`)
    const out = await db.transaction(async (tx: any) => {
      if (!(await lockInvoiceMoney(tx, companyId, invoiceId))) return null
      const [a] = await tx.insert(invoiceAdjustments).values({
        companyId, invoiceId, amount: String(amount), adjustmentType: type, reason: b.reason || null, notes: b.notes || null, createdById: userId,
      }).returning()
      // A write-off or discount reduces what is owed; once paid + adjusted covers the total it is paid.
      if (type === 'write_off' || type === 'discount') await applyInvoiceWriteDown(tx, companyId, invoiceId, amount)
      return a
    })
    if (!out) return fail(c, 404, 'Invoice not found')
    return one(c, out, 201)
  }

  // GET /invoice-adjustments — a list reply.
  app.get('/invoice-adjustments', read, async (c) => {
    const rows = await invoiceAdjustmentRows(db, who(c).companyId)
    return listAll(c, rows)
  })
  app.post('/invoice-adjustments', create, async (c) => {
    const b = await body(c)
    return recordAdjustment(c, b.invoiceId || b.invoice_id, b)
  })
  // GET /invoices/:id/adjustments — a list reply.
  app.get('/invoices/:id/adjustments', read, async (c) => {
    const rows = await db.select().from(invoiceAdjustments)
      .where(and(eq(invoiceAdjustments.invoiceId, c.req.param('id')), eq(invoiceAdjustments.companyId, who(c).companyId)))
    rows.sort((a: any, b: any) => +new Date(b.createdAt) - +new Date(a.createdAt))
    return listAll(c, rows)
  })
  app.post('/invoices/:id/adjustments', create, async (c) => recordAdjustment(c, c.req.param('id'), await body(c)))

  // ═════════════════════════════════════════ PAYER CONTRACT RATES ═══════════════════════════════════

  // GET /referral-source-rates (and /rates) — a list reply.
  const ratesList = async (c: any) => {
    const rows = await payerRateRows(db, who(c).companyId)
    return listAll(c, rows)
  }
  app.get('/referral-source-rates', read, ratesList)
  app.get('/rates', read, ratesList)

  // GET /missing-rates — payer × care-type combinations with active clients and no rate in force TODAY: exactly the gaps
  // that would refuse at invoice time. The test is the invoice engine's own (resolveClientRate). A list reply.
  app.get('/missing-rates', read, async (c) => {
    const { companyId } = who(c)
    const rows = await missingPayerRates(db, companyId, await core.time.today(companyId))
    return listAll(c, rows)
  })

  // POST /referral-source-rates — a new rate for a payer (+ care type) retires the active one, ending it on the new
  // rate's effective date, so the history of what was billed when stays intact.
  const createRate = async (c: any) => {
    const { companyId } = who(c)
    const b = await body(c)
    const referralSourceId = b.referralSourceId || b.referral_source_id
    const careTypeId = b.careTypeId || b.care_type_id || null
    const rateAmount = Number(b.rateAmount ?? b.rate_amount)
    const rateType = b.rateType || b.rate_type || 'hourly'
    if (!referralSourceId) return fail(c, 400, 'Choose a payer')
    if (!Number.isFinite(rateAmount) || rateAmount <= 0) return fail(c, 400, 'Rate must be a positive amount')
    if (!['hourly', '15min'].includes(rateType)) return fail(c, 400, "rateType must be 'hourly' or '15min'")
    // The payer must be this company's (the template trusted the id).
    const [payer] = await db.select({ id: referralSources.id }).from(referralSources)
      .where(and(eq(referralSources.id, referralSourceId), eq(referralSources.companyId, companyId))).limit(1)
    if (!payer) return fail(c, 404, 'Payer not found')
    const eff = b.effectiveDate || b.effective_date
    const effective = isDate(eff) ? eff : await core.time.today(companyId)
    const endDate = isDate(b.endDate || b.end_date) ? (b.endDate || b.end_date) : null
    const rate = await db.transaction(async (tx: any) => {
      await retirePayerRate(tx, companyId, referralSourceId, careTypeId, effective)
      const [row] = await tx.insert(referralSourceRates).values({
        companyId, referralSourceId, careTypeId, rateAmount: String(rateAmount), rateType, effectiveDate: effective, endDate, isActive: true,
      }).returning()
      return row
    })
    return one(c, rate, 201)
  }
  app.post('/referral-source-rates', create, createRate)
  app.post('/rates', create, createRate)

  const updateRate = async (c: any) => {
    const b = await body(c)
    let rateAmount: number | null = null
    if (b.rateAmount != null || b.rate_amount != null) {
      const v = Number(b.rateAmount ?? b.rate_amount)
      if (!Number.isFinite(v) || v <= 0) return fail(c, 400, 'Rate must be a positive amount')
      rateAmount = v
    }
    const rt = b.rateType || b.rate_type
    const active = b.isActive ?? b.is_active
    const end = b.endDate || b.end_date
    const r = await updatePayerRate(db, who(c).companyId, c.req.param('id'), {
      rateAmount,
      rateType: ['hourly', '15min'].includes(rt) ? rt : null,
      isActive: typeof active === 'boolean' ? active : null,
      endDate: isDate(end) ? end : null,
    })
    if (!r) return fail(c, 404, 'Rate not found')
    return one(c, r)
  }
  app.put('/referral-source-rates/:id', update, updateRate)
  app.put('/rates/:id', update, updateRate)

  app.delete('/referral-source-rates/:id', remove, async (c) => {
    const [r] = await db.delete(referralSourceRates)
      .where(and(eq(referralSourceRates.id, c.req.param('id')), eq(referralSourceRates.companyId, who(c).companyId)))
      .returning({ id: referralSourceRates.id })
    if (!r) return fail(c, 404, 'Rate not found')
    return done(c, 'Rate deleted')
  })

  // ═════════════════════════════════════════════════ EXPORTS ═══════════════════════════════════════

  app.get('/export/invoices-csv', read, async (c) => {
    const { companyId } = who(c)
    const rows = await invoiceCsvRows(db, companyId)
    const today = await core.time.today(companyId)
    return csvDownload(c, `invoices-${today}.csv`, [
      ['Invoice #', 'Invoice Number', 'Period Start', 'Period End', 'Client', 'Payer', 'Total', 'Paid', 'Balance', 'Status', 'Due Date', 'Sent', 'Created'],
      ...rows.map((r) => [r.seqNumber, r.invoiceNumber, r.s, r.e, r.clientName, r.payer, num(r.total).toFixed(2), num(r.amountPaid).toFixed(2), num(r.balance).toFixed(2), r.paymentStatus, r.due, r.sent, r.created]),
    ])
  })

  // GET /export/evv — the last 30 days of completed visits in the state-EVV CSV layout.
  app.get('/export/evv', read, async (c) => {
    const { companyId } = who(c)
    const rows = await evvExportRows(db, companyId)
    const loc = (v: any) => { let o = v; if (typeof o === 'string') { try { o = JSON.parse(o) } catch { o = {} } } return o || {} }
    const today = await core.time.today(companyId)
    return csvDownload(c, `evv-export-${today}.csv`, [
      ['ServiceDate', 'ClientFirstName', 'ClientLastName', 'MedicaidID', 'ProviderFirstName', 'ProviderLastName', 'NPI',
        'ClockInTime', 'ClockOutTime', 'TotalHours', 'ClockInLatitude', 'ClockInLongitude', 'ClockOutLatitude', 'ClockOutLongitude', 'VerificationMethod'],
      ...rows.map((r) => {
        const i = loc(r.clockInLocation), o = loc(r.clockOutLocation)
        return [r.serviceDate, r.clientFirstName, r.clientLastName, r.medicaidId || '', r.caregiverFirstName, r.caregiverLastName,
          r.npiNumber || '', r.clockIn, r.clockOut, num(r.hours).toFixed(2), i.latitude || i.lat || '', i.longitude || i.lng || '',
          o.latitude || o.lat || '', o.longitude || o.lng || '', 'GPS']
      }),
    ])
  })

  // GET /billing-summary?startDate&endDate — billed / collected / outstanding, by payer and caregiver. The money reports'
  // one rule (server/data/homecareBilling.ts): released invoices, dated by their first day of service, counted whole.
  app.get('/billing-summary', read, async (c) => {
    const { startDate, endDate } = c.req.query()
    const s = isDate(startDate) ? startDate : '1900-01-01', e = isDate(endDate) ? endDate : '2999-12-31'
    return one(c, await billingSummaryFigures(db, who(c).companyId, s, e))
  })

  // ═════════════════════════════════════════════════ CSV IMPORT ════════════════════════════════════

  // POST /import-csv — invoices from an insurer-portal / spreadsheet export, one invoice per client per calendar month of
  // service. Rows arrive already matched to clients (and caregivers) by the screen.
  // Body: { rows: [{ clientId, caregiverId, serviceDate, hours, rate, amount, description }], source }
  app.post('/import-csv', create, async (c) => {
    const { companyId } = who(c)
    const b = await body(c)
    const rows: any[] = Array.isArray(b.rows) ? b.rows : []
    const source = typeof b.source === 'string' && b.source.trim() ? b.source.trim() : 'CSV'
    if (rows.length === 0) return fail(c, 400, 'No rows provided')
    let imported = 0, skipped = 0, invoicesCreated = 0
    const errors: any[] = []
    const groups = new Map<string, { clientId: string; periodStart: string; periodEnd: string; lineItems: any[] }>()
    rows.forEach((row, idx) => {
      if (!row?.clientId) { errors.push({ row: idx + 1, error: 'No client matched' }); skipped++; return }
      if (!row.caregiverId) { errors.push({ row: idx + 1, error: 'No caregiver matched' }); skipped++; return }
      const sd = String(row.serviceDate || '').slice(0, 10)
      if (!isDate(sd) || isNaN(new Date(sd + 'T12:00:00Z').getTime())) { errors.push({ row: idx + 1, error: row.serviceDate ? 'Invalid service date' : 'Missing service date' }); skipped++; return }
      const [y, m] = sd.split('-').map(Number)
      const periodStart = `${y}-${String(m).padStart(2, '0')}-01`
      const periodEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
      const key = `${row.clientId}|${periodStart}`
      if (!groups.has(key)) groups.set(key, { clientId: row.clientId, periodStart, periodEnd, lineItems: [] })
      const hours = parseFloat(row.hours) || 0
      const rate = parseFloat(row.rate) || 0
      const amount = row.amount != null && row.amount !== '' && Number.isFinite(parseFloat(row.amount)) ? round2(parseFloat(row.amount)) : round2(hours * rate)
      groups.get(key)!.lineItems.push({
        timeEntryId: null, caregiverId: row.caregiverId,
        description: row.description || `Imported from ${source}`,
        // An imported row's rate is per hour: its amount defaults to hours × rate.
        hours, rate, rateType: 'hourly', amount, serviceDate: sd, billedBasis: null,
      })
    })
    for (const g of groups.values()) {
      const client = await engine.loadBillingClient(companyId, g.clientId)
      if (!client) { skipped += g.lineItems.length; errors.push({ row: null, error: `Client ${g.clientId} not found` }); continue }
      try {
        const total = round2(g.lineItems.reduce((s, li) => s + li.amount, 0))
        await engine.createInvoiceWithLines({ companyId, client, periodStart: g.periodStart, periodEnd: g.periodEnd, lineItems: g.lineItems, total, notes: `Imported from ${source}` })
        imported += g.lineItems.length
        invoicesCreated++
      } catch (e: any) {
        skipped += g.lineItems.length
        errors.push({ row: null, error: e instanceof BillingRefusal ? `${client.firstName} ${client.lastName}: ${e.body.error}` : `Invoice creation failed: ${e.message}` })
      }
    }
    return one(c, { imported, skipped, invoicesCreated, errors: errors.slice(0, 50), source })
  })

  // ═════════════════════════════════════ INSURER-PORTAL CLAIM DAYS ═════════════════════════════════

  // GET /claim-portals — payers, their portal export settings, and the presets this agency's state has.
  app.get('/claim-portals', read, async (c) => {
    const { companyId } = who(c)
    const payers = await db.select({ id: referralSources.id, name: referralSources.name, payerType: referralSources.payerType, claimPortal: referralSources.claimPortal })
      .from(referralSources).where(and(eq(referralSources.companyId, companyId), eq(referralSources.isActive, true))).orderBy(asc(referralSources.name))
    const state = await core.time.state(companyId)
    return one(c, {
      payers: payers.map((p: any) => ({ ...p, claimPortal: parseClaimPortal(p.claimPortal) })),
      presets: state === 'WI' ? WISCONSIN_PRESETS : [],
    })
  })

  // PUT /claim-portals/:payerId — set (or clear, with { claimPortal: null }) a payer's portal export.
  app.put('/claim-portals/:payerId', update, async (c) => {
    const b = await body(c)
    const raw = b.claimPortal === undefined ? b : b.claimPortal
    let cfg = null
    if (raw !== null) {
      cfg = parseClaimPortal(raw)
      if (!cfg) return fail(c, 400, 'A portal export needs a portal name and both procedure codes.')
    }
    const [r] = await db.update(referralSources).set({ claimPortal: cfg, updatedAt: new Date() })
      .where(and(eq(referralSources.id, c.req.param('payerId')), eq(referralSources.companyId, who(c).companyId)))
      .returning({ id: referralSources.id, name: referralSources.name, claimPortal: referralSources.claimPortal })
    if (!r) return fail(c, 404, 'Payer not found')
    return one(c, { ...r, claimPortal: parseClaimPortal(r.claimPortal) })
  })

  // GET /portal-claim-days?payerId&weekStart=YYYY-MM-DD — per client, per day of one Sun–Sat week, the EVV-code units and
  // the other-code units to key into the payer's portal. weekStart snaps to its Sunday; default = the agency's current week.
  app.get('/portal-claim-days', read, async (c) => {
    const { companyId } = who(c)
    const { payerId, weekStart } = c.req.query()
    if (!payerId) return fail(c, 400, 'payerId is required')
    const [payer] = await db.select({ id: referralSources.id, name: referralSources.name, claimPortal: referralSources.claimPortal })
      .from(referralSources).where(and(eq(referralSources.id, payerId), eq(referralSources.companyId, companyId))).limit(1)
    if (!payer) return fail(c, 404, 'Payer not found')
    const cfg = parseClaimPortal(payer.claimPortal)
    if (!cfg) return fail(c, 400, `${payer.name} has no portal export set up yet.`)
    const tz = await core.time.timezone(companyId)
    // No weekStart → THIS week on the agency's clock (the screen used to open on last week — Run 4).
    const day = isDate(weekStart) ? weekStart : await core.time.weekStart(companyId)
    const week = await core.portalClaimDays.portalClaimWeek(companyId, payerId, day, tz)
    // An empty week has to say why (Run 5): the visits come only from clients whose payer is this one.
    const linked = await db.select({ id: clients.id, isPrivatePay: clients.isPrivatePay, isActive: clients.isActive }).from(clients)
      .where(and(eq(clients.companyId, companyId), eq(clients.referredById, payerId)))
    const linkedClients = linked.filter((r: any) => !r.isPrivatePay && r.isActive !== false).length
    return one(c, { payer: { id: payer.id, name: payer.name }, portal: cfg, ...week, linkedClients })
  })

  return app
}
