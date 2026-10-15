// Client invoicing — ported from CVHC routes/billingRoutes.js. The numbers are decided in
// services/invoiceEngine.ts; this file is the HTTP surface.
//
// The whole router is the office's: authenticate + requireAdmin (admin/owner), as it always was in
// this template. A caregiver never reaches billing.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../../db/index.ts'
import { agencies } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import emailService from '../services/email.ts'
import {
  BillingRefusal, generateLineItems, loadBillingClient, resolveClientRate, noRateRefusal, applyRate,
  createInvoiceWithLines, insertLineItems, clampLineItemDescription, reformatTimesIn, to12h, round2,
  fmtTime12, generateInvoiceNumber,
} from '../services/invoiceEngine.ts'
import { agencyTimezone, agencyToday, ymdIn, addDays } from '../services/agencyTime.ts'
import { occurrencesCte } from '../services/scheduleOccurrences.ts'
import { portalClaimWeek, parseClaimPortal, WISCONSIN_PRESETS } from '../services/portalClaimDays.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)

const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[]
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/
const isDate = (v: any) => typeof v === 'string' && DATE_RE.test(v)
const body = async (c: any) => { try { return (await c.req.json()) || {} } catch { return {} } }
const num = (v: any) => Number(v || 0)
const userId = (c: any) => (c.get('user') as any)?.userId || (c.get('user') as any)?.id || null

/** Run a handler; a BillingRefusal becomes its 4xx, anything else propagates to the error handler. */
const refusalAware = (fn: (c: any) => Promise<Response>) => async (c: any) => {
  try { return await fn(c) } catch (e: any) {
    if (e instanceof BillingRefusal) return c.json(e.body, e.status as any)
    throw e
  }
}

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

async function agencyRow() {
  const [a] = await db.select().from(agencies).limit(1)
  return a || null
}

// ════════════════════════════════════════════════ INVOICES ════════════════════════════════════════

// GET /invoices — newest first, with the client, payer and billed hours.
app.get('/invoices', async (c) => {
  const { paymentStatus, status, clientId, startDate, endDate, page = '1', limit = '200' } = c.req.query()
  const lim = Math.min(Math.max(parseInt(limit) || 200, 1), 1000)
  const off = (Math.max(parseInt(page) || 1, 1) - 1) * lim
  const ps = paymentStatus || status || null
  const where = sql`
    WHERE (${ps}::text IS NULL OR i.payment_status = ${ps}::text)
      AND (${clientId || null}::text IS NULL OR i.client_id = ${clientId || null}::text)
      AND (${isDate(startDate) ? startDate : null}::date IS NULL OR i.billing_period_start >= ${isDate(startDate) ? startDate : null}::date)
      AND (${isDate(endDate) ? endDate : null}::date IS NULL OR i.billing_period_start <= ${isDate(endDate) ? endDate : null}::date)`
  const rows = rowsOf(await db.execute(sql`
    SELECT i.*, to_char(i.billing_period_start, 'YYYY-MM-DD') AS billing_period_start,
           to_char(i.billing_period_end, 'YYYY-MM-DD') AS billing_period_end,
           to_char(i.payment_due_date, 'YYYY-MM-DD') AS payment_due_date,
           c.first_name, c.last_name, c.email,
           rs.name AS referral_source_name,
           (SELECT COALESCE(SUM(hours), 0) FROM invoice_line_items WHERE invoice_id = i.id) AS total_hours
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      LEFT JOIN referral_sources rs ON i.referral_source_id = rs.id
      ${where}
     ORDER BY i.created_at DESC
     LIMIT ${lim} OFFSET ${off}`))
  const [{ n }] = rowsOf(await db.execute(sql`SELECT COUNT(*)::int AS n FROM invoices i ${where}`))
  return c.json({ invoices: rows, total: n })
})

// GET /invoices/billing-schedule — every active client's cadence and where their billing stands.
app.get('/invoices/billing-schedule', async (c) => {
  const tz = await agencyTimezone()
  const today = ymdIn(new Date(), tz)
  const rows = rowsOf(await db.execute(sql`
    SELECT c.id, c.first_name, c.last_name, c.is_private_pay, c.billing_frequency_weeks,
           to_char(c.billed_through, 'YYYY-MM-DD') AS billed_through, rs.name AS payer_name
      FROM clients c
      LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id
     WHERE c.is_active = true
     ORDER BY (c.billing_frequency_weeks IS NULL), c.last_name, c.first_name`))
  return c.json(rows.map((r) => {
    let periodsDue = 0
    if (r.billing_frequency_weeks && r.billed_through) {
      const span = (new Date(today + 'T12:00:00Z').getTime() - new Date(r.billed_through + 'T12:00:00Z').getTime()) / 86400000 - 1
      periodsDue = Math.max(0, Math.floor(span / (r.billing_frequency_weeks * 7)))
    }
    return { ...r, today, periods_due: periodsDue }
  }))
})

// PATCH /invoices/billing-schedule/:clientId — set a cadence in weeks (1-8), or null for manual.
app.patch('/invoices/billing-schedule/:clientId', async (c) => {
  const { weeks } = await body(c)
  const w = weeks == null || weeks === '' ? null : Number(weeks)
  if (w != null && (!Number.isInteger(w) || w < 1 || w > 8)) return c.json({ error: 'weeks must be 1-8 or null' }, 400)
  const r = rowsOf(await db.execute(sql`
    UPDATE clients SET billing_frequency_weeks = ${w}, updated_at = NOW() WHERE id = ${c.req.param('clientId')}
    RETURNING id, billing_frequency_weeks`))
  if (!r.length) return c.json({ error: 'Client not found' }, 404)
  return c.json(r[0])
})

// POST /invoices/preview — the line items generation WOULD produce, saving nothing. The manual form's
// "Import from Schedule + EVV" button fills its lines from this.
app.post('/invoices/preview', refusalAware(async (c) => {
  const { clientId, start, end } = periodFrom(await body(c))
  if (!clientId || periodRefusal(start, end)) return c.json({ error: 'clientId, billingPeriodStart, billingPeriodEnd are required' }, 400)
  const client = await loadBillingClient(db, clientId)
  if (!client) return c.json({ error: 'Client not found' }, 404)
  const { lineItems, total, rate } = await generateLineItems(db, client, start, end)
  return c.json({
    lineItems, total, rate,
    counts: {
      total: lineItems.length,
      evvConfirmed: lineItems.filter((li) => li.source === 'evv_confirmed').length,
      scheduled: lineItems.filter((li) => li.source === 'scheduled').length,
      unscheduled: lineItems.filter((li) => li.source === 'unscheduled_evv').length,
    },
  })
}))

// POST /invoices/reconcile — the review step BEFORE an invoice exists. One row per billable day: the
// shift as scheduled, the punch as recorded, and what each would bill.
app.post('/invoices/reconcile', refusalAware(async (c) => {
  const b = await body(c)
  const { clientId, start, end } = periodFrom(b)
  if (!clientId || periodRefusal(start, end)) return c.json({ error: 'clientId, billingPeriodStart, billingPeriodEnd are required' }, 400)
  const client = await loadBillingClient(db, clientId)
  if (!client) return c.json({ error: 'Client not found' }, 404)
  const { reconcile, total, skipped, rate } = await generateLineItems(db, client, start, end, { choices: b.choices || {} })
  return c.json({
    reconcile, skipped, total, rate,
    counts: {
      days: reconcile.length,
      skipped: skipped.length,
      needsChoice: reconcile.filter((r) => r.needs_choice).length,
      match: reconcile.filter((r) => r.status === 'match').length,
      noPunch: reconcile.filter((r) => r.status === 'no_punch').length,
      short: reconcile.filter((r) => r.status === 'short').length,
      long: reconcile.filter((r) => r.status === 'long').length,
      unscheduled: reconcile.filter((r) => r.status === 'unscheduled').length,
    },
  })
}))

// POST /invoices/generate-with-rates — one invoice, with the reviewer's per-day choices. Atomic.
const generateOne = refusalAware(async (c) => {
  const b = await body(c)
  const { clientId, start, end } = periodFrom(b)
  if (!clientId || periodRefusal(start, end)) return c.json({ error: 'Client and billing period are required' }, 400)
  const client = await loadBillingClient(db, clientId)
  if (!client) return c.json({ error: 'Client not found' }, 404)
  const { lineItems, total } = await generateLineItems(db, client, start, end, { choices: b.choices || {} })
  if (lineItems.length === 0) {
    return c.json({ error: 'No scheduled visits or completed EVV entries found for this client in the selected period' }, 400)
  }
  const invoice = await createInvoiceWithLines({ client, periodStart: start, periodEnd: end, lineItems, total, notes: b.notes || null })
  const rs = client.referred_by_id && !client.is_private_pay
    ? rowsOf(await db.execute(sql`SELECT name FROM referral_sources WHERE id = ${client.referred_by_id}`))[0]
    : null
  return c.json({
    ...invoice,
    first_name: client.first_name, last_name: client.last_name,
    referral_source_name: rs?.name || null,
    line_items: lineItems,
    total_hours: lineItems.reduce((s, li) => s + li.hours, 0),
  }, 201)
})
app.post('/invoices/generate-with-rates', generateOne)
// The older path (frontend config.generateInvoice) — the same engine, not a second one.
app.post('/invoices/generate', generateOne)

// POST /invoices/manual — custom lines. The RATE comes from the client record, never the request.
app.post('/invoices/manual', refusalAware(async (c) => {
  const b = await body(c)
  const { clientId, start, end } = periodFrom(b)
  if (!clientId || periodRefusal(start, end)) return c.json({ error: 'Client and billing period are required' }, 400)
  const items: any[] = Array.isArray(b.lineItems) ? b.lineItems : []
  if (items.length === 0) return c.json({ error: 'At least one line item is required' }, 400)
  // caregiver_id is NOT NULL on a line; refusing up front keeps a blank caregiver from failing the
  // insert after the header was written.
  if (items.some((li) => !(li.caregiverId || li.caregiver_id))) return c.json({ error: 'Each line item needs a caregiver.' }, 400)
  const client = await loadBillingClient(db, clientId)
  if (!client) return c.json({ error: 'Client not found' }, 404)
  const resolved = await resolveClientRate(db, client, start, end)
  if (!resolved || !(resolved.rate > 0)) throw noRateRefusal(client)

  const lines = items.map((item) => {
    const { hours, rate, amount } = applyRate(item, resolved)
    let description = item.description || 'Home Care Services'
    if (b.detailedMode && item.startTime && item.endTime) description = `${description} (${to12h(item.startTime)} - ${to12h(item.endTime)})`
    const hhmm = (t: any) => (typeof t === 'string' && TIME_RE.test(t) ? (t.length === 5 ? `${t}:00` : t) : null)
    return {
      caregiver_id: item.caregiverId || item.caregiver_id,
      caregiver_name: item.caregiverName || '',
      time_entry_id: item.timeEntryId || item.time_entry_id || null,
      description, hours, rate, amount,
      service_date: isDate(item.serviceDate) ? item.serviceDate : null,
      visit_start: hhmm(item.startTime), visit_end: hhmm(item.endTime),
      billed_basis: null, scheduled_minutes: null, clocked_minutes: null,
    }
  })
  const total = round2(lines.reduce((s, l) => s + l.amount, 0))
  const invoice = await createInvoiceWithLines({ client, periodStart: start, periodEnd: end, lineItems: lines, total, notes: b.notes || null })
  return c.json({
    ...invoice,
    first_name: client.first_name, last_name: client.last_name,
    line_items: lines.map((l) => ({
      ...l,
      caregiver_first_name: String(l.caregiver_name).split(' ')[0] || '',
      caregiver_last_name: String(l.caregiver_name).split(' ').slice(1).join(' ') || '',
    })),
    total_hours: lines.reduce((s, l) => s + l.hours, 0),
  }, 201)
}))

/** Clients who have something to bill in a period: a completed punch OR a scheduled occurrence. */
async function clientsWithActivity(start: string, end: string, filter: { clientFilter?: string; referralSourceId?: string; clientIds?: string[] }) {
  const tz = await agencyTimezone()
  const ids = Array.isArray(filter.clientIds) && filter.clientIds.length ? filter.clientIds.map(String) : null
  return rowsOf(await db.execute(sql`
    WITH ${occurrencesCte(start, end, 'occ')},
    active AS (
      SELECT client_id FROM occ
      UNION
      SELECT te.client_id FROM time_entries te
       WHERE te.is_complete = true
         AND ((te.start_time AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date BETWEEN ${start}::date AND ${end}::date
    )
    SELECT c.id, c.first_name, c.last_name
      FROM clients c
     WHERE c.is_active = true
       AND c.id IN (SELECT client_id FROM active)
       AND (${filter.clientFilter === 'insurance'} = false OR (c.referred_by_id IS NOT NULL AND c.is_private_pay IS NOT TRUE))
       AND (${filter.clientFilter === 'private'} = false OR (c.referred_by_id IS NULL OR c.is_private_pay = TRUE))
       AND (${filter.referralSourceId || null}::text IS NULL OR c.referred_by_id = ${filter.referralSourceId || null}::text)
       AND (${ids ? ids.join(',') : null}::text IS NULL OR c.id = ANY(string_to_array(${ids ? ids.join(',') : null}::text, ',')))
     ORDER BY c.last_name, c.first_name`))
}

// POST /invoices/batch-generate — every client with activity in the period. A batch has nowhere to
// ask "scheduled or clocked?", so a client with an unresolved day is skipped, never billed on a guess.
app.post('/invoices/batch-generate', async (c) => {
  const b = await body(c)
  const start = b.billingPeriodStart, end = b.billingPeriodEnd
  if (periodRefusal(start, end)) return c.json({ error: 'Billing period is required' }, 400)
  const candidates = await clientsWithActivity(start, end, b)
  let count = 0, totalAmount = 0, totalHours = 0
  const invoicesOut: any[] = [], skippedClients: any[] = []
  for (const row of candidates) {
    const name = `${row.first_name} ${row.last_name}`
    try {
      const client = await loadBillingClient(db, row.id)
      const { lineItems, total, reconcile } = await generateLineItems(db, client, start, end)
      if (lineItems.length === 0 || total <= 0) { skippedClients.push({ name, reason: 'No billable hours found' }); continue }
      const unresolved = reconcile.filter((r) => r.needs_choice)
      if (unresolved.length) {
        skippedClients.push({
          name, needsReview: true, days: unresolved.map((r) => r.service_date),
          reason: `${unresolved.length} day${unresolved.length === 1 ? '' : 's'} where the clock-in doesn't match the schedule — generate this client on its own to review them`,
        })
        continue
      }
      const inv = await createInvoiceWithLines({ client, periodStart: start, periodEnd: end, lineItems, total })
      const hours = lineItems.reduce((s, li) => s + li.hours, 0)
      count++; totalAmount += total; totalHours += hours
      invoicesOut.push({ invoiceNumber: inv.invoice_number, seqNumber: inv.seq_number, clientName: name, total, hours })
    } catch (e: any) {
      if (e instanceof BillingRefusal) skippedClients.push({ name, reason: String(e.body.error) + (e.body.message ? ` — ${e.body.message}` : '') })
      else skippedClients.push({ name, reason: `Failed: ${e.message}` })
    }
  }
  return c.json({
    count, skipped: skippedClients.length, total: round2(totalAmount), totalHours,
    invoices: invoicesOut, skippedClients,
    // the older response shape
    generated: count,
  })
})

// POST /invoices/generate-due — for every client with a cadence, a DRAFT invoice for each COMPLETE
// period since billed_through. Never bills a period in progress, never regenerates covered ground,
// never bills on a guess. { dryRun: true } previews without writing.
app.post('/invoices/generate-due', async (c) => {
  const MAX_PERIODS_PER_CLIENT = 6 // catch-up backstop
  const b = await body(c)
  const dryRun = b.dryRun === true
  const today = await agencyToday()
  const list = rowsOf(await db.execute(sql`
    SELECT id FROM clients WHERE is_active = true AND billing_frequency_weeks IS NOT NULL ORDER BY last_name, first_name`))
  const created: any[] = [], skipped: any[] = [], emptyPeriods: any[] = []
  for (const { id } of list) {
    const client = await loadBillingClient(db, id)
    const name = `${client.first_name} ${client.last_name}`
    if (!client.billed_through) {
      skipped.push({ name, reason: 'No previous invoice — generate the first one manually to set the starting point' })
      continue
    }
    let anchor = client.billed_through as string
    for (let p = 0; p < MAX_PERIODS_PER_CLIENT; p++) {
      const periodStart = addDays(anchor, 1)
      const periodEnd = addDays(anchor, client.billing_frequency_weeks * 7)
      if (periodEnd >= today) break // period not complete yet
      const existing = rowsOf(await db.execute(sql`
        SELECT invoice_number FROM invoices WHERE client_id = ${id} AND billing_period_start = ${periodStart}::date AND billing_period_end = ${periodEnd}::date`))
      if (existing.length) {
        if (!dryRun) await db.execute(sql`UPDATE clients SET billed_through = ${periodEnd}::date WHERE id = ${id}`)
        anchor = periodEnd
        continue
      }
      let gen
      try { gen = await generateLineItems(db, client, periodStart, periodEnd) } catch (e: any) {
        if (e instanceof BillingRefusal) { skipped.push({ name, period: `${periodStart} – ${periodEnd}`, reason: String(e.body.error), needsReview: true }); break }
        throw e
      }
      const { lineItems, total, reconcile } = gen
      const unresolved = reconcile.filter((r) => r.needs_choice)
      const overlaps = reconcile.filter((r) => r.overlap_minutes > 0)
      if (unresolved.length || overlaps.length) {
        const why: string[] = []
        if (unresolved.length) why.push(`${unresolved.length} day(s) where the clock-in doesn't match the schedule`)
        if (overlaps.length) why.push(`overlapping schedules on ${[...new Set(overlaps.map((o) => o.service_date))].join(', ')}`)
        skipped.push({ name, period: `${periodStart} – ${periodEnd}`, reason: why.join('; ') + ' — generate this client on its own to review', needsReview: true })
        break // don't advance, don't try later periods out of order
      }
      if (lineItems.length === 0 || total <= 0) {
        if (!dryRun) await db.execute(sql`UPDATE clients SET billed_through = ${periodEnd}::date WHERE id = ${id}`)
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
        const inv = await createInvoiceWithLines({ client, periodStart, periodEnd, lineItems, total, advanceBilledThrough: 'set' })
        created.push({ name, invoiceNumber: inv.invoice_number, seqNumber: inv.seq_number, period: `${periodStart} – ${periodEnd}`, total, hours })
        anchor = periodEnd
      } catch (e: any) {
        skipped.push({ name, period: `${periodStart} – ${periodEnd}`, reason: `Failed: ${e instanceof BillingRefusal ? e.body.error : e.message}` })
        break
      }
    }
  }
  return c.json({
    created, skipped, emptyPeriods, dryRun,
    summary: `${created.length} invoice(s) ${dryRun ? 'would be ' : ''}created · ${skipped.length} skipped · ${emptyPeriods.length} empty period(s) advanced`,
  })
})

// GET /scheduled-visits?clientId&from&to — the client's scheduled (non-cancelled) visits, each marked
// with the invoice that already bills it, for "Invoice picked visits".
app.get('/scheduled-visits', async (c) => {
  const { clientId, from, to } = c.req.query()
  if (!clientId || periodRefusal(from, to)) return c.json({ error: 'clientId, from and to are required' }, 400)
  const visits = await scheduledVisits(clientId, from, to)
  const billed = await billedVisitMap(clientId, from, to)
  return c.json(visits.map((v) => ({ ...v, billed_on: billed.byLine.get(visitKey(v)) || billed.byPeriod(v.visit_date) || null })))
})

const hms = (t: string) => (t && t.length === 5 ? `${t}:00` : t)
const visitKey = (v: any) => `${v.visit_date}|${hms(String(v.start_time))}|${v.caregiver_id}`
async function scheduledVisits(clientId: string, from: string, to: string) {
  return rowsOf(await db.execute(sql`
    WITH ${occurrencesCte(from, to, 'o')}
    SELECT to_char(o.occ_date, 'YYYY-MM-DD') AS visit_date, o.start_time::text AS start_time, o.end_time::text AS end_time,
           o.minutes, o.caregiver_id, o.schedule_id, u.first_name || ' ' || u.last_name AS caregiver_name
      FROM o LEFT JOIN users u ON u.id = o.caregiver_id
     WHERE o.client_id = ${clientId}
       AND o.is_training IS NOT TRUE -- a training shift is paid, never billed
     ORDER BY o.occ_date, o.start_time`))
}
async function billedVisitMap(clientId: string, from: string, to: string) {
  const lines = rowsOf(await db.execute(sql`
    SELECT i.invoice_number, to_char(ili.service_date, 'YYYY-MM-DD') AS visit_date, ili.start_time::text AS start_time, ili.caregiver_id
      FROM invoice_line_items ili JOIN invoices i ON i.id = ili.invoice_id
     WHERE i.client_id = ${clientId} AND ili.service_date BETWEEN ${from}::date AND ${to}::date AND ili.start_time IS NOT NULL`))
  const periods = rowsOf(await db.execute(sql`
    SELECT invoice_number, to_char(billing_period_start, 'YYYY-MM-DD') AS s, to_char(billing_period_end, 'YYYY-MM-DD') AS e
      FROM invoices WHERE client_id = ${clientId} AND billing_period_start <= ${to}::date AND billing_period_end >= ${from}::date`))
  const byLine = new Map(lines.map((l) => [visitKey(l), l.invoice_number as string]))
  return { byLine, byPeriod: (d: string) => periods.find((p) => p.s <= d && p.e >= d)?.invoice_number || null }
}

// POST /invoices/from-visits — an invoice built from visits the office picks one by one (CVHC's
// Visit Documentation invoice, for clients whose caregiver doesn't use the app). Each visit is
// re-checked against the schedule and refused if an invoice already bills it. Created as a draft.
// Body: { clientId, visits: [{ visitDate, startTime, caregiverId }] }
app.post('/invoices/from-visits', refusalAware(async (c) => {
  const b = await body(c)
  const clientId = b.clientId
  const picked: any[] = Array.isArray(b.visits) ? b.visits : []
  if (!clientId) return c.json({ error: 'clientId is required' }, 400)
  if (picked.length === 0) return c.json({ error: 'Pick at least one visit.' }, 400)
  if (picked.some((p) => !isDate(p?.visitDate) || !TIME_RE.test(p?.startTime || '') || !p?.caregiverId)) {
    return c.json({ error: 'Each visit needs visitDate, startTime and caregiverId.' }, 400)
  }
  const dates = picked.map((p) => p.visitDate).sort()
  const from = dates[0], to = dates[dates.length - 1]
  const client = await loadBillingClient(db, clientId)
  if (!client) return c.json({ error: 'Client not found' }, 404)
  const resolved = await resolveClientRate(db, client, from, to)
  if (!resolved || !(resolved.rate > 0) || resolved.rateType !== 'hourly') {
    return c.json({ error: `No hourly billing rate is set for ${client.first_name} ${client.last_name}. Set the payer's rate (Billing → Rates) or the client's private-pay rate.` }, 400)
  }
  const fmtD = (d: string) => { const [y, m, day] = d.split('-'); return `${Number(m)}/${Number(day)}/${y}` }
  const scheduled = new Map((await scheduledVisits(clientId, from, to)).map((v) => [visitKey(v), v]))
  const wanted: any[] = []
  const seen = new Set<string>()
  for (const p of picked) {
    const key = visitKey({ visit_date: p.visitDate, start_time: p.startTime, caregiver_id: p.caregiverId })
    if (seen.has(key)) continue
    seen.add(key)
    const v = scheduled.get(key)
    if (!v) return c.json({ error: `${fmtD(p.visitDate)} ${fmtTime12(p.startTime)} is not a scheduled visit (it may have been cancelled).` }, 400)
    wanted.push(v)
  }
  const billed = await billedVisitMap(clientId, from, to)
  for (const v of wanted) {
    const on = billed.byLine.get(visitKey(v)) || billed.byPeriod(v.visit_date)
    if (on) return c.json({ error: `${fmtD(v.visit_date)} is already billed on invoice ${on}.` }, 409)
  }
  // Homemaking split: the per-visit minutes of the client's active homemaking (IADL) care tasks bill
  // as "Homemaking", the rest of the visit as "Home health aide" (care's client_task_templates).
  const hmRow = rowsOf(await db.execute(sql`
    SELECT COALESCE(SUM(allotted_minutes), 0)::int AS m FROM client_task_templates
     WHERE client_id = ${clientId} AND is_active = true AND category = 'iadl'`))
  const homemakingMin = Number(hmRow[0]?.m || 0)
  const lines: any[] = []
  for (const v of wanted) {
    const hm = Math.min(Math.max(homemakingMin, 0), Number(v.minutes))
    const parts = [{ service: 'Home health aide', minutes: Number(v.minutes) - hm }, { service: 'Homemaking', minutes: hm }].filter((p) => p.minutes > 0)
    for (const part of parts) {
      const hours = round2(part.minutes / 60)
      lines.push({
        caregiver_id: v.caregiver_id,
        description: `${part.service} (${fmtTime12(v.start_time)} - ${fmtTime12(v.end_time)})`,
        hours, rate: resolved.rate, amount: round2(hours * resolved.rate),
        service_date: v.visit_date, visit_start: hms(v.start_time), visit_end: hms(v.end_time),
        billed_basis: 'scheduled', scheduled_minutes: part.minutes, clocked_minutes: null,
      })
    }
  }
  const total = round2(lines.reduce((s, l) => s + l.amount, 0))
  const inv = await createInvoiceWithLines({
    client, periodStart: from, periodEnd: to, lineItems: lines, total, advanceBilledThrough: false,
    notes: `Built from ${wanted.length} visit${wanted.length === 1 ? '' : 's'} picked in Billing`,
  })
  return c.json({ ...inv, visits: wanted.length, lines: lines.length }, 201)
}))

// GET /invoices/:id — one invoice with its lines, and each visit's care note when one is recorded.
app.get('/invoices/:id', async (c) => {
  const id = c.req.param('id')
  const inv = rowsOf(await db.execute(sql`
    SELECT i.*, to_char(i.billing_period_start, 'YYYY-MM-DD') AS billing_period_start,
           to_char(i.billing_period_end, 'YYYY-MM-DD') AS billing_period_end,
           to_char(i.payment_due_date, 'YYYY-MM-DD') AS payment_due_date,
           c.first_name, c.last_name, c.referred_by_id AS referral_source_id, c.care_type_id, c.is_private_pay,
           c.email, c.phone, c.address, c.city, c.state, c.zip,
           rs.name AS referral_source_name
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      LEFT JOIN referral_sources rs ON i.referral_source_id = rs.id
     WHERE i.id = ${id}`))[0]
  if (!inv) return c.json({ error: 'Invoice not found' }, 404)
  // Each visit's care note (visits' visit_documentation), matched on client, day, start and caregiver.
  const docCols = sql.raw(`, vd.note AS visit_note, vd.tasks AS visit_tasks`)
  const docJoin = sql`LEFT JOIN visit_documentation vd ON vd.client_id = ${inv.client_id} AND vd.visit_date = ili.service_date
            AND vd.start_time = ili.start_time AND vd.caregiver_id = ili.caregiver_id`
  const lineItems = rowsOf(await db.execute(sql`
    SELECT ili.*, u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name,
           to_char(COALESCE(ili.service_date, te.start_time::date), 'YYYY-MM-DD') AS service_date,
           ili.start_time::text AS start_time, ili.end_time::text AS end_time
           ${docCols}
      FROM invoice_line_items ili
      LEFT JOIN users u ON ili.caregiver_id = u.id
      LEFT JOIN time_entries te ON ili.time_entry_id = te.id
      ${docJoin}
     WHERE ili.invoice_id = ${id}
     ORDER BY COALESCE(ili.service_date, te.start_time::date), ili.start_time NULLS LAST, u.last_name`))
  const lines = lineItems.map((li) => ({ ...li, description: reformatTimesIn(li.description) }))
  return c.json({
    ...inv,
    client: { firstName: inv.first_name, lastName: inv.last_name, address: inv.address, city: inv.city, state: inv.state, zip: inv.zip },
    line_items: lines,
    lineItems: lines,
    total_hours: Number(lines.reduce((s, li) => s + num(li.hours), 0).toFixed(2)),
  })
})

// PUT /invoices/:id/payment-status — mark paid (stamps amount_paid = total) or another status.
app.put('/invoices/:id/payment-status', async (c) => {
  const id = c.req.param('id')
  const b = await body(c)
  const status = b.status || b.paymentStatus
  if (!['pending', 'paid', 'partial', 'overdue'].includes(status)) return c.json({ error: 'status must be pending, paid, partial or overdue' }, 400)
  const pd = isDate(String(b.paymentDate || '').slice(0, 10)) ? String(b.paymentDate).slice(0, 10) : null
  const r = rowsOf(await db.execute(sql`
    UPDATE invoices
       SET payment_status = ${status}::text,
           payment_date = COALESCE(${pd}::date, CASE WHEN ${status}::text = 'paid' THEN CURRENT_DATE ELSE payment_date END),
           paid_at = CASE WHEN ${status}::text = 'paid' THEN NOW() ELSE paid_at END,
           amount_paid = CASE WHEN ${status}::text = 'paid' THEN total ELSE amount_paid END,
           updated_at = NOW()
     WHERE id = ${id}
     RETURNING *`))
  if (!r.length) return c.json({ error: 'Invoice not found' }, 404)
  return c.json(r[0])
})
// The older verb for the same thing.
app.patch('/invoices/:id/status', async (c) => {
  const b = await body(c)
  const status = b.status || b.paymentStatus
  if (!['pending', 'paid', 'partial', 'overdue'].includes(status)) return c.json({ error: 'status must be pending, paid, partial or overdue' }, 400)
  const r = rowsOf(await db.execute(sql`
    UPDATE invoices SET payment_status = ${status}::text, updated_at = NOW(),
           paid_at = CASE WHEN ${status}::text = 'paid' THEN NOW() ELSE paid_at END,
           amount_paid = CASE WHEN ${status}::text = 'paid' THEN total ELSE amount_paid END
     WHERE id = ${c.req.param('id')} RETURNING *`))
  if (!r.length) return c.json({ error: 'Invoice not found' }, 404)
  return c.json(r[0])
})

// DELETE /invoices/:id — the invoice and its dependent rows. When it was the client's latest billed
// period, billed_through steps back to before it, so "Create Due Invoices" bills that period again
// instead of skipping it for ever.
app.delete('/invoices/:id', async (c) => {
  const id = c.req.param('id')
  const inv = rowsOf(await db.execute(sql`
    SELECT id, invoice_number, client_id, to_char(billing_period_start, 'YYYY-MM-DD') AS s, to_char(billing_period_end, 'YYYY-MM-DD') AS e
      FROM invoices WHERE id = ${id}`))[0]
  if (!inv) return c.json({ error: 'Invoice not found' }, 404)
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM invoice_payments WHERE invoice_id = ${id}`)
    await tx.execute(sql`DELETE FROM invoice_adjustments WHERE invoice_id = ${id}`)
    await tx.execute(sql`DELETE FROM invoice_line_items WHERE invoice_id = ${id}`)
    await tx.execute(sql`UPDATE claims SET invoice_id = NULL WHERE invoice_id = ${id}`)
    await tx.execute(sql`DELETE FROM invoices WHERE id = ${id}`)
    await tx.execute(sql`
      UPDATE clients SET billed_through = ${inv.s}::date - 1
       WHERE id = ${inv.client_id} AND billed_through = ${inv.e}::date`)
  })
  return c.json({ message: `Invoice ${inv.invoice_number} deleted successfully` })
})

// PUT /invoices/:id/line-items — replace an unpaid invoice's lines and recompute its totals.
// Refused once any money has been collected. Same rate rule as creation.
app.put('/invoices/:id/line-items', refusalAware(async (c) => {
  const id = c.req.param('id')
  const b = await body(c)
  const items: any[] = Array.isArray(b.lineItems) ? b.lineItems : []
  if (items.length === 0) return c.json({ error: 'At least one line item is required' }, 400)
  const inv = rowsOf(await db.execute(sql`
    SELECT i.id, i.client_id, i.payment_status, i.amount_paid, i.tax,
           to_char(i.billing_period_start, 'YYYY-MM-DD') AS s, to_char(i.billing_period_end, 'YYYY-MM-DD') AS e
      FROM invoices i WHERE i.id = ${id}`))[0]
  if (!inv) return c.json({ error: 'Invoice not found' }, 404)
  if (inv.payment_status === 'paid' || num(inv.amount_paid) > 0) {
    return c.json({ error: 'This invoice has a payment recorded and can no longer be edited.' }, 409)
  }
  const client = await loadBillingClient(db, inv.client_id)
  const resolved = await resolveClientRate(db, client, inv.s, inv.e)
  if (!resolved || !(resolved.rate > 0)) throw noRateRefusal(client, 'edit these lines')
  // A line keeps its caregiver; a NEW line with none falls back to the invoice's first caregiver
  // (caregiver_id is NOT NULL on a line).
  const existing = rowsOf(await db.execute(sql`SELECT caregiver_id FROM invoice_line_items WHERE invoice_id = ${id} LIMIT 1`))
  const fallbackCaregiver = existing[0]?.caregiver_id || null
  let subtotal = 0
  const prepared = items.map((item) => {
    const { hours, rate, amount } = applyRate(item, resolved)
    subtotal += amount
    let description = item.description || 'Home Care Services'
    if (b.detailedMode && item.startTime && item.endTime) description = `${description} (${to12h(item.startTime)} - ${to12h(item.endTime)})`
    return {
      caregiver_id: item.caregiverId || item.caregiver_id || fallbackCaregiver,
      description: clampLineItemDescription(description), hours, rate, amount,
      service_date: isDate(String(item.serviceDate || item.service_date || '').slice(0, 10)) ? String(item.serviceDate || item.service_date).slice(0, 10) : null,
      time_entry_id: item.timeEntryId || item.time_entry_id || null,
      visit_start: TIME_RE.test(item.start_time || '') ? hms(item.start_time) : null,
      visit_end: TIME_RE.test(item.end_time || '') ? hms(item.end_time) : null,
      billed_basis: ['scheduled', 'clocked', 'unscheduled'].includes(item.billed_basis) ? item.billed_basis : null,
      scheduled_minutes: item.scheduled_minutes ?? null, clocked_minutes: item.clocked_minutes ?? null,
    }
  })
  if (prepared.some((p) => !p.caregiver_id)) return c.json({ error: 'Each line item needs a caregiver.' }, 400)
  subtotal = round2(subtotal)
  const total = round2(subtotal + num(inv.tax))
  const updated = await db.transaction(async (tx) => {
    const locked = rowsOf(await tx.execute(sql`SELECT payment_status, amount_paid FROM invoices WHERE id = ${id} FOR UPDATE`))[0]
    if (locked.payment_status === 'paid' || num(locked.amount_paid) > 0) {
      throw new BillingRefusal(409, { error: 'This invoice has a payment recorded and can no longer be edited.' })
    }
    await tx.execute(sql`DELETE FROM invoice_line_items WHERE invoice_id = ${id}`)
    await insertLineItems(tx as any, id, prepared)
    return rowsOf(await tx.execute(sql`UPDATE invoices SET subtotal = ${subtotal}, total = ${total}, updated_at = NOW() WHERE id = ${id} RETURNING *`))[0]
  })
  const lines = rowsOf(await db.execute(sql`
    SELECT ili.*, to_char(ili.service_date, 'YYYY-MM-DD') AS service_date FROM invoice_line_items ili
     WHERE ili.invoice_id = ${id} ORDER BY ili.service_date NULLS LAST, ili.created_at`))
  return c.json({ ...updated, line_items: lines })
}))

// POST /invoices/:id/release — make a reviewed draft visible in the family portal without emailing.
app.post('/invoices/:id/release', async (c) => {
  const r = rowsOf(await db.execute(sql`
    UPDATE invoices SET sent_at = COALESCE(sent_at, NOW()), updated_at = NOW() WHERE id = ${c.req.param('id')}
    RETURNING id, sent_at`))
  if (!r.length) return c.json({ error: 'Invoice not found' }, 404)
  return c.json({ success: true, sent_at: r[0].sent_at })
})

// POST /invoices/:id/rescind — back to draft: hidden from the portal, its pay link stops working.
// Refused once a payment is recorded (the portal shows paid/partial invoices regardless).
app.post('/invoices/:id/rescind', async (c) => {
  const id = c.req.param('id')
  const inv = rowsOf(await db.execute(sql`SELECT id, sent_at, payment_status, amount_paid FROM invoices WHERE id = ${id}`))[0]
  if (!inv) return c.json({ error: 'Invoice not found' }, 404)
  if (!inv.sent_at) return c.json({ error: 'Invoice is already a draft — nothing to rescind.' }, 400)
  if (num(inv.amount_paid) > 0 || ['paid', 'partial'].includes(inv.payment_status)) {
    return c.json({ error: 'A payment has been recorded on this invoice, so the portal will show it regardless. Adjust or refund the payment first.' }, 400)
  }
  const tz = await agencyTimezone()
  await db.execute(sql`
    UPDATE invoices SET sent_at = NULL, notes = COALESCE(notes, '') || ${`\nRescinded (returned to draft) on ${ymdIn(new Date(), tz)}`}, updated_at = NOW()
     WHERE id = ${id}`)
  return c.json({ success: true })
})

async function invoiceForEmail(id: string) {
  return rowsOf(await db.execute(sql`
    SELECT i.*, to_char(i.payment_due_date, 'YYYY-MM-DD') AS due_text,
           c.first_name, c.last_name, COALESCE(c.portal_email, c.email) AS client_email
      FROM invoices i JOIN clients c ON i.client_id = c.id WHERE i.id = ${id}`))[0]
}
const fmtUsDate = (d: string | null) => {
  if (!d) return 'N/A'
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day, 12)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
const payUrlFor = (id: string) => (process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/pay/${id}` : undefined)

// POST /invoices/:id/send-email — email the invoice with a pay link. Sending releases the draft.
app.post('/invoices/:id/send-email', async (c) => {
  const id = c.req.param('id')
  const invoice = await invoiceForEmail(id)
  if (!invoice) return c.json({ error: 'Invoice not found' }, 404)
  const b = await body(c)
  const to = b.email || invoice.client_email
  if (!to) return c.json({ error: 'No email address found for this client. Please provide an email.' }, 400)
  if (!emailService.isConfigured) return c.json({ error: 'Email service not configured on server.' }, 503)
  const amountDue = num(invoice.total) - num(invoice.amount_paid) - num(invoice.amount_adjusted)
  const lines = rowsOf(await db.execute(sql`
    SELECT to_char(service_date, 'YYYY-MM-DD') AS service_date, description, hours, amount
      FROM invoice_line_items WHERE invoice_id = ${id} ORDER BY service_date NULLS LAST, created_at`))
  const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string))
  const lineItemsHtml = lines.map((li) =>
    `<tr><td>${li.service_date ? fmtUsDate(li.service_date) : ''}</td><td>${esc(reformatTimesIn(li.description))}</td><td>${num(li.hours).toFixed(2)}h</td><td>$${num(li.amount).toFixed(2)}</td></tr>`).join('')
  const agency = await agencyRow()
  try {
    await emailService.sendInvoiceEmail(to, {
      companyName: agency?.name || process.env.COMPANY_NAME || '{{COMPANY_NAME}}',
      contactName: `${invoice.first_name} ${invoice.last_name}`,
      invoiceNumber: invoice.seq_number ?? invoice.invoice_number,
      total: num(invoice.total).toFixed(2),
      amountDue: amountDue.toFixed(2),
      dueDate: fmtUsDate(invoice.due_text),
      lineItems: lineItemsHtml,
      payUrl: payUrlFor(id),
    })
  } catch (e: any) {
    return c.json({ error: `Email send failed: ${e.message}` }, 502)
  }
  const tz = await agencyTimezone()
  await db.execute(sql`
    UPDATE invoices SET notes = COALESCE(notes, '') || ${`\nEmailed to ${to} on ${ymdIn(new Date(), tz)}`},
           sent_at = COALESCE(sent_at, NOW()), updated_at = NOW()
     WHERE id = ${id}`)
  return c.json({ success: true, sentTo: to })
})

// POST /invoices/:id/send-reminder — "due soon" / "N days past due". Refused on a paid invoice.
app.post('/invoices/:id/send-reminder', async (c) => {
  const id = c.req.param('id')
  const invoice = await invoiceForEmail(id)
  if (!invoice) return c.json({ error: 'Invoice not found' }, 404)
  if (invoice.payment_status === 'paid') return c.json({ error: 'This invoice is already paid — no reminder needed.' }, 400)
  const b = await body(c)
  const to = b.email || invoice.client_email
  if (!to) return c.json({ error: 'No email address found for this client. Please provide an email.' }, 400)
  if (!emailService.isConfigured) return c.json({ error: 'Email service not configured on server.' }, 503)
  const amountDue = num(invoice.total) - num(invoice.amount_paid) - num(invoice.amount_adjusted)
  if (amountDue <= 0) return c.json({ error: 'No balance due on this invoice.' }, 400)
  const tz = await agencyTimezone()
  const today = ymdIn(new Date(), tz)
  const daysOverdue = invoice.due_text
    ? Math.floor((new Date(today + 'T12:00:00Z').getTime() - new Date(invoice.due_text + 'T12:00:00Z').getTime()) / 86400000)
    : 0
  const agency = await agencyRow()
  try {
    await emailService.sendInvoiceReminder(to, {
      companyName: agency?.name || process.env.COMPANY_NAME || '{{COMPANY_NAME}}',
      contactName: `${invoice.first_name} ${invoice.last_name}`,
      invoiceNumber: invoice.seq_number ?? invoice.invoice_number,
      amountDue: amountDue.toFixed(2),
      dueDate: fmtUsDate(invoice.due_text),
      daysOverdue,
      payUrl: payUrlFor(id),
    })
  } catch (e: any) {
    return c.json({ error: `Email send failed: ${e.message}` }, 502)
  }
  const label = daysOverdue > 0 ? `${daysOverdue}d overdue` : 'pre-due'
  await db.execute(sql`
    UPDATE invoices SET notes = COALESCE(notes, '') || ${`\nReminder sent to ${to} on ${today} (${label})`},
           sent_at = COALESCE(sent_at, NOW()), updated_at = NOW()
     WHERE id = ${id}`)
  return c.json({ success: true, sentTo: to, daysOverdue })
})

// ═══════════════════════════════════════════ PAYMENTS & ADJUSTMENTS ═══════════════════════════════

app.get('/invoice-payments', async (c) => {
  const { invoiceId, startDate, endDate } = c.req.query()
  const rows = rowsOf(await db.execute(sql`
    SELECT ip.*, to_char(ip.payment_date, 'YYYY-MM-DD') AS payment_date, ip.payment_method AS method,
           ip.reference_number AS reference, i.invoice_number, i.seq_number,
           c.first_name || ' ' || c.last_name AS client_name
      FROM invoice_payments ip
      JOIN invoices i ON ip.invoice_id = i.id
      JOIN clients c ON i.client_id = c.id
     WHERE (${invoiceId || null}::text IS NULL OR ip.invoice_id = ${invoiceId || null}::text)
       AND (${isDate(startDate) ? startDate : null}::date IS NULL OR ip.payment_date >= ${isDate(startDate) ? startDate : null}::date)
       AND (${isDate(endDate) ? endDate : null}::date IS NULL OR ip.payment_date <= ${isDate(endDate) ? endDate : null}::date)
     ORDER BY ip.payment_date DESC NULLS LAST, ip.created_at DESC`))
  return c.json(rows)
})

/** Recompute amount_paid and the status from the payments that exist (inside the caller's tx). */
async function rollUpPayments(tx: any, invoiceId: string, paymentDate: string | null) {
  await tx.execute(sql`
    UPDATE invoices i SET
      amount_paid = p.paid,
      payment_status = CASE WHEN p.paid + COALESCE(i.amount_adjusted, 0) >= i.total THEN 'paid'
                            WHEN p.paid > 0 THEN 'partial' ELSE 'pending' END,
      payment_date = CASE WHEN p.paid + COALESCE(i.amount_adjusted, 0) >= i.total THEN COALESCE(${paymentDate}::date, i.payment_date, CURRENT_DATE) ELSE i.payment_date END,
      paid_at = CASE WHEN p.paid + COALESCE(i.amount_adjusted, 0) >= i.total THEN COALESCE(i.paid_at, NOW()) ELSE NULL END,
      updated_at = NOW()
    FROM (SELECT COALESCE(SUM(amount), 0)::numeric AS paid FROM invoice_payments WHERE invoice_id = ${invoiceId}) p
    WHERE i.id = ${invoiceId}`)
}

// POST /invoice-payments — record a payment. One transaction with the invoice row locked, so two
// concurrent payments cannot both pass the balance check, and a payment past the balance is refused
// (a check entered twice once doubled an invoice) unless allowOverpayment is sent.
app.post('/invoice-payments', refusalAware(async (c) => {
  const b = await body(c)
  const invoiceId = b.invoiceId || b.invoice_id
  const amt = Number(b.amount)
  if (!invoiceId) return c.json({ error: 'invoiceId is required' }, 400)
  if (!Number.isFinite(amt) || amt <= 0) return c.json({ error: 'Payment amount must be a positive number' }, 400)
  const paymentDate = isDate(b.paymentDate || b.payment_date) ? (b.paymentDate || b.payment_date) : await agencyToday()
  const payment = await db.transaction(async (tx) => {
    const inv = rowsOf(await tx.execute(sql`
      SELECT total, COALESCE(amount_paid, 0) AS amount_paid, COALESCE(amount_adjusted, 0) AS amount_adjusted
        FROM invoices WHERE id = ${invoiceId} FOR UPDATE`))[0]
    if (!inv) throw new BillingRefusal(404, { error: 'Invoice not found' })
    const total = num(inv.total), alreadyPaid = num(inv.amount_paid), adjusted = num(inv.amount_adjusted)
    const balanceDue = +(total - alreadyPaid - adjusted).toFixed(2)
    const newPaid = +(alreadyPaid + amt).toFixed(2)
    if (!b.allowOverpayment && newPaid > total - adjusted + 0.01) {
      throw new BillingRefusal(409, {
        error: `Payment of $${amt.toFixed(2)} exceeds the $${balanceDue.toFixed(2)} balance due on this invoice. It may already be recorded. To record an intentional overpayment, resubmit with allowOverpayment: true.`,
        balanceDue, alreadyPaid, total,
      })
    }
    const p = rowsOf(await tx.execute(sql`
      INSERT INTO invoice_payments (id, invoice_id, amount, payment_date, payment_method, reference_number, notes, created_by_id)
      VALUES (${createId()}, ${invoiceId}, ${amt}, ${paymentDate}::date, ${b.paymentMethod || b.payment_method || 'check'},
              ${b.referenceNumber || b.reference_number || null}, ${b.notes || null}, ${userId(c)})
      RETURNING *`))[0]
    await tx.execute(sql`UPDATE invoices SET payment_method = ${p.payment_method} WHERE id = ${invoiceId}`)
    await rollUpPayments(tx, invoiceId, paymentDate)
    return p
  })
  return c.json(payment, 201)
}))

app.delete('/invoice-payments/:id', async (c) => {
  const id = c.req.param('id')
  const p = rowsOf(await db.execute(sql`SELECT invoice_id FROM invoice_payments WHERE id = ${id}`))[0]
  if (!p) return c.json({ error: 'Payment not found' }, 404)
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM invoices WHERE id = ${p.invoice_id} FOR UPDATE`)
    await tx.execute(sql`DELETE FROM invoice_payments WHERE id = ${id}`)
    await rollUpPayments(tx, p.invoice_id, null)
  })
  return c.json({ success: true })
})

const ADJUSTMENT_TYPES = ['write_off', 'discount', 'adjustment', 'refund', 'credit', 'other']
async function recordAdjustment(c: any, invoiceId: string, b: any) {
  const amount = Number(b.amount)
  const type = b.type || b.adjustmentType || b.adjustment_type
  if (!invoiceId) return c.json({ error: 'invoiceId is required' }, 400)
  if (!Number.isFinite(amount) || amount <= 0) return c.json({ error: 'Adjustment amount must be a positive number' }, 400)
  if (!ADJUSTMENT_TYPES.includes(type)) return c.json({ error: `type must be one of ${ADJUSTMENT_TYPES.join(', ')}` }, 400)
  const out = await db.transaction(async (tx) => {
    const inv = rowsOf(await tx.execute(sql`SELECT id FROM invoices WHERE id = ${invoiceId} FOR UPDATE`))[0]
    if (!inv) return null
    const a = rowsOf(await tx.execute(sql`
      INSERT INTO invoice_adjustments (id, invoice_id, amount, adjustment_type, reason, notes, created_by_id)
      VALUES (${createId()}, ${invoiceId}, ${amount}, ${type}, ${b.reason || null}, ${b.notes || null}, ${userId(c)})
      RETURNING *`))[0]
    // A write-off or discount reduces what is owed; once paid + adjusted covers the total it is paid.
    if (type === 'write_off' || type === 'discount') {
      await tx.execute(sql`
        UPDATE invoices SET amount_adjusted = COALESCE(amount_adjusted, 0) + ${amount},
               payment_status = CASE WHEN COALESCE(amount_paid, 0) + COALESCE(amount_adjusted, 0) + ${amount} >= total THEN 'paid' ELSE payment_status END,
               updated_at = NOW()
         WHERE id = ${invoiceId}`)
    }
    return a
  })
  if (!out) return c.json({ error: 'Invoice not found' }, 404)
  return c.json(out, 201)
}

app.get('/invoice-adjustments', async (c) => {
  return c.json(rowsOf(await db.execute(sql`
    SELECT ia.*, i.invoice_number, i.seq_number, c.first_name || ' ' || c.last_name AS client_name
      FROM invoice_adjustments ia JOIN invoices i ON ia.invoice_id = i.id JOIN clients c ON i.client_id = c.id
     ORDER BY ia.created_at DESC`)))
})
app.post('/invoice-adjustments', async (c) => {
  const b = await body(c)
  return recordAdjustment(c, b.invoiceId || b.invoice_id, b)
})
app.get('/invoices/:id/adjustments', async (c) => {
  return c.json(rowsOf(await db.execute(sql`
    SELECT * FROM invoice_adjustments WHERE invoice_id = ${c.req.param('id')} ORDER BY created_at DESC`)))
})
app.post('/invoices/:id/adjustments', async (c) => recordAdjustment(c, c.req.param('id'), await body(c)))

// ═══════════════════════════════════════════ PAYER CONTRACT RATES ═════════════════════════════════

const ratesQuery = () => db.execute(sql`
  SELECT rsr.*, to_char(rsr.effective_date, 'YYYY-MM-DD') AS effective_date, to_char(rsr.end_date, 'YYYY-MM-DD') AS end_date,
         rs.name AS referral_source_name, ct.name AS care_type_name,
         (SELECT COUNT(*)::int FROM clients c
           WHERE c.is_active = true AND c.is_private_pay IS NOT TRUE
             AND c.referred_by_id = rsr.referral_source_id
             AND (rsr.care_type_id IS NULL OR c.care_type_id = rsr.care_type_id)) AS client_count
    FROM referral_source_rates rsr
    LEFT JOIN referral_sources rs ON rsr.referral_source_id = rs.id
    LEFT JOIN care_types ct ON rsr.care_type_id = ct.id
   ORDER BY rs.name, ct.name`)
app.get('/referral-source-rates', async (c) => c.json(rowsOf(await ratesQuery())))
app.get('/rates', async (c) => c.json(rowsOf(await ratesQuery())))

// GET /missing-rates — payer × care-type combinations with active clients and no active rate:
// exactly the gaps that would otherwise refuse (or, before, silently mis-bill) at invoice time.
app.get('/missing-rates', async (c) => {
  return c.json(rowsOf(await db.execute(sql`
    SELECT rs.id AS payer_id, rs.name AS payer_name, ct.id AS care_type_id, ct.name AS care_type_name,
           COUNT(DISTINCT c.id)::int AS affected_clients
      FROM clients c
      JOIN referral_sources rs ON c.referred_by_id = rs.id
      JOIN care_types ct ON c.care_type_id = ct.id
     WHERE c.is_active = true AND c.is_private_pay IS NOT TRUE
       AND NOT EXISTS (
         SELECT 1 FROM referral_source_rates rsr
          WHERE rsr.referral_source_id = rs.id
            AND (rsr.care_type_id IS NULL OR rsr.care_type_id = ct.id)
            AND rsr.is_active = true)
     GROUP BY rs.id, rs.name, ct.id, ct.name
     ORDER BY rs.name, ct.name`)))
})

// POST /referral-source-rates — a new rate for a payer (+ care type) retires the active one, ending
// it on the new rate's effective date, so the history of what was billed when stays intact.
const createRate = async (c: any) => {
  const b = await body(c)
  const referralSourceId = b.referralSourceId || b.referral_source_id
  const careTypeId = b.careTypeId || b.care_type_id || null
  const rateAmount = Number(b.rateAmount ?? b.rate_amount)
  const rateType = b.rateType || b.rate_type || 'hourly'
  if (!referralSourceId) return c.json({ error: 'Choose a payer' }, 400)
  if (!Number.isFinite(rateAmount) || rateAmount <= 0) return c.json({ error: 'Rate must be a positive amount' }, 400)
  if (!['hourly', '15min'].includes(rateType)) return c.json({ error: "rateType must be 'hourly' or '15min'" }, 400)
  const effective = isDate(b.effectiveDate || b.effective_date) ? (b.effectiveDate || b.effective_date) : await agencyToday()
  const rate = await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE referral_source_rates SET is_active = false, end_date = ${effective}::date, updated_at = NOW()
       WHERE referral_source_id = ${referralSourceId}
         AND (care_type_id = ${careTypeId}::text OR (care_type_id IS NULL AND ${careTypeId}::text IS NULL))
         AND (is_active = true OR is_active IS NULL)`)
    return rowsOf(await tx.execute(sql`
      INSERT INTO referral_source_rates (id, referral_source_id, care_type_id, rate_amount, rate_type, effective_date, end_date, is_active)
      VALUES (${createId()}, ${referralSourceId}, ${careTypeId}, ${rateAmount}, ${rateType}, ${effective}::date,
              ${isDate(b.endDate || b.end_date) ? (b.endDate || b.end_date) : null}::date, true)
      RETURNING *`))[0]
  })
  return c.json(rate, 201)
}
app.post('/referral-source-rates', createRate)
app.post('/rates', createRate)

const updateRate = async (c: any) => {
  const b = await body(c)
  const set: any = {}
  if (b.rateAmount != null || b.rate_amount != null) {
    const v = Number(b.rateAmount ?? b.rate_amount)
    if (!Number.isFinite(v) || v <= 0) return c.json({ error: 'Rate must be a positive amount' }, 400)
    set.rate_amount = v
  }
  const r = rowsOf(await db.execute(sql`
    UPDATE referral_source_rates SET
      rate_amount = COALESCE(${set.rate_amount ?? null}::numeric, rate_amount),
      rate_type = COALESCE(${['hourly', '15min'].includes(b.rateType || b.rate_type) ? (b.rateType || b.rate_type) : null}::text, rate_type),
      is_active = COALESCE(${typeof (b.isActive ?? b.is_active) === 'boolean' ? (b.isActive ?? b.is_active) : null}::boolean, is_active),
      end_date = CASE WHEN ${isDate(b.endDate || b.end_date)} THEN ${isDate(b.endDate || b.end_date) ? (b.endDate || b.end_date) : null}::date ELSE end_date END,
      updated_at = NOW()
    WHERE id = ${c.req.param('id')} RETURNING *`))
  if (!r.length) return c.json({ error: 'Rate not found' }, 404)
  return c.json(r[0])
}
app.put('/referral-source-rates/:id', updateRate)
app.put('/rates/:id', updateRate)

app.delete('/referral-source-rates/:id', async (c) => {
  const r = rowsOf(await db.execute(sql`DELETE FROM referral_source_rates WHERE id = ${c.req.param('id')} RETURNING id`))
  if (!r.length) return c.json({ error: 'Rate not found' }, 404)
  return c.json({ message: 'Rate deleted' })
})

// ═══════════════════════════════════════════════ EXPORTS ═════════════════════════════════════════

const csvCell = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
const csvResponse = (c: any, filename: string, rows: any[][]) => {
  c.header('Content-Type', 'text/csv')
  c.header('Content-Disposition', `attachment; filename=${filename}`)
  return c.body(rows.map((r) => r.map(csvCell).join(',')).join('\n'))
}

app.get('/export/invoices-csv', async (c) => {
  const rows = rowsOf(await db.execute(sql`
    SELECT i.seq_number, i.invoice_number, to_char(i.billing_period_start, 'YYYY-MM-DD') AS s, to_char(i.billing_period_end, 'YYYY-MM-DD') AS e,
           c.first_name || ' ' || c.last_name AS client_name, COALESCE(rs.name, 'Private Pay') AS payer,
           i.total, COALESCE(i.amount_paid, 0) AS amount_paid,
           i.total - COALESCE(i.amount_paid, 0) - COALESCE(i.amount_adjusted, 0) AS balance,
           i.payment_status, to_char(i.payment_due_date, 'YYYY-MM-DD') AS due,
           CASE WHEN i.sent_at IS NULL THEN 'draft' ELSE 'sent' END AS sent, to_char(i.created_at, 'YYYY-MM-DD') AS created
      FROM invoices i JOIN clients c ON i.client_id = c.id LEFT JOIN referral_sources rs ON i.referral_source_id = rs.id
     ORDER BY i.created_at DESC`))
  const today = await agencyToday()
  return csvResponse(c, `invoices-${today}.csv`, [
    ['Invoice #', 'Invoice Number', 'Period Start', 'Period End', 'Client', 'Payer', 'Total', 'Paid', 'Balance', 'Status', 'Due Date', 'Sent', 'Created'],
    ...rows.map((r) => [r.seq_number, r.invoice_number, r.s, r.e, r.client_name, r.payer, num(r.total).toFixed(2), num(r.amount_paid).toFixed(2), num(r.balance).toFixed(2), r.payment_status, r.due, r.sent, r.created]),
  ])
})

// GET /export/evv — the last 30 days of completed visits in the state-EVV CSV layout.
app.get('/export/evv', async (c) => {
  const rows = rowsOf(await db.execute(sql`
    SELECT to_char(te.start_time, 'YYYY-MM-DD') AS service_date,
           to_char(te.start_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS clock_in,
           CASE WHEN te.end_time IS NULL THEN '' ELSE to_char(te.end_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END AS clock_out,
           CASE WHEN te.duration_minutes IS NOT NULL THEN te.duration_minutes / 60.0
                WHEN te.end_time IS NOT NULL THEN EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600.0 ELSE 0 END AS hours,
           te.clock_in_location, te.clock_out_location,
           c.first_name AS client_first_name, c.last_name AS client_last_name, c.medicaid_id,
           u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name, cp.npi_number
      FROM time_entries te
      JOIN clients c ON te.client_id = c.id
      JOIN users u ON te.caregiver_id = u.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
     WHERE te.start_time >= NOW() - INTERVAL '30 days' AND te.is_complete = true
     ORDER BY te.start_time DESC`))
  const loc = (v: any) => { let o = v; if (typeof o === 'string') { try { o = JSON.parse(o) } catch { o = {} } } return o || {} }
  const today = await agencyToday()
  return csvResponse(c, `evv-export-${today}.csv`, [
    ['ServiceDate', 'ClientFirstName', 'ClientLastName', 'MedicaidID', 'ProviderFirstName', 'ProviderLastName', 'NPI',
      'ClockInTime', 'ClockOutTime', 'TotalHours', 'ClockInLatitude', 'ClockInLongitude', 'ClockOutLatitude', 'ClockOutLongitude', 'VerificationMethod'],
    ...rows.map((r) => {
      const i = loc(r.clock_in_location), o = loc(r.clock_out_location)
      return [r.service_date, r.client_first_name, r.client_last_name, r.medicaid_id || '', r.caregiver_first_name, r.caregiver_last_name,
        r.npi_number || '', r.clock_in, r.clock_out, num(r.hours).toFixed(2), i.latitude || i.lat || '', i.longitude || i.lng || '',
        o.latitude || o.lat || '', o.longitude || o.lng || '', 'GPS']
    }),
  ])
})

// GET /billing-summary?startDate&endDate — billed / collected / outstanding, by payer and caregiver.
app.get('/billing-summary', async (c) => {
  const { startDate, endDate } = c.req.query()
  const s = isDate(startDate) ? startDate : null, e = isDate(endDate) ? endDate : null
  const where = sql`(${s}::date IS NULL OR i.created_at >= ${s}::date) AND (${e}::date IS NULL OR i.created_at < (${e}::date + 1))`
  const summary = rowsOf(await db.execute(sql`
    SELECT COUNT(*)::int AS invoice_count, COALESCE(SUM(total), 0) AS total_billed, COALESCE(SUM(amount_paid), 0) AS total_collected,
           COALESCE(SUM(total - COALESCE(amount_paid, 0) - COALESCE(amount_adjusted, 0)), 0) AS total_outstanding
      FROM invoices i WHERE ${where}`))[0]
  const byPayer = rowsOf(await db.execute(sql`
    SELECT COALESCE(rs.name, 'Private Pay') AS payer, COUNT(*)::int AS invoice_count,
           COALESCE(SUM(i.total), 0) AS total_billed, COALESCE(SUM(i.amount_paid), 0) AS total_collected
      FROM invoices i LEFT JOIN referral_sources rs ON i.referral_source_id = rs.id
     WHERE ${where} GROUP BY rs.name ORDER BY total_billed DESC`))
  const byCaregiver = rowsOf(await db.execute(sql`
    SELECT u.first_name || ' ' || u.last_name AS caregiver_name, COALESCE(SUM(ili.hours), 0) AS total_hours,
           COALESCE(SUM(ili.amount), 0) AS total_billed
      FROM invoice_line_items ili JOIN invoices i ON ili.invoice_id = i.id LEFT JOIN users u ON ili.caregiver_id = u.id
     WHERE ${where} GROUP BY u.first_name, u.last_name ORDER BY total_hours DESC`))
  return c.json({ summary, byPayer, byCaregiver })
})

// ═══════════════════════════════════════════════ CSV IMPORT ══════════════════════════════════════

// POST /import-csv — invoices from an insurer-portal / spreadsheet export, one invoice per client per
// calendar month of service. Rows arrive already matched to clients (and caregivers) by the screen.
// Body: { rows: [{ clientId, caregiverId, serviceDate, hours, rate, amount, description }], source }
app.post('/import-csv', async (c) => {
  const b = await body(c)
  const rows: any[] = Array.isArray(b.rows) ? b.rows : []
  const source = typeof b.source === 'string' && b.source.trim() ? b.source.trim() : 'CSV'
  if (rows.length === 0) return c.json({ error: 'No rows provided' }, 400)
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
      time_entry_id: null, caregiver_id: row.caregiverId,
      description: row.description || `Imported from ${source}`,
      hours, rate, amount, service_date: sd, billed_basis: null,
    })
  })
  for (const g of groups.values()) {
    const client = await loadBillingClient(db, g.clientId)
    if (!client) { skipped += g.lineItems.length; errors.push({ row: null, error: `Client ${g.clientId} not found` }); continue }
    try {
      const total = round2(g.lineItems.reduce((s, li) => s + li.amount, 0))
      await createInvoiceWithLines({ client, periodStart: g.periodStart, periodEnd: g.periodEnd, lineItems: g.lineItems, total, notes: `Imported from ${source}` })
      imported += g.lineItems.length
      invoicesCreated++
    } catch (e: any) {
      skipped += g.lineItems.length
      errors.push({ row: null, error: e instanceof BillingRefusal ? `${client.first_name} ${client.last_name}: ${e.body.error}` : `Invoice creation failed: ${e.message}` })
    }
  }
  return c.json({ imported, skipped, invoicesCreated, errors: errors.slice(0, 50), source })
})

// ═══════════════════════════════════════ INSURER-PORTAL CLAIM DAYS ═══════════════════════════════

// GET /claim-portals — payers, their portal export settings, and the presets this agency's state has.
app.get('/claim-portals', async (c) => {
  const agency = await agencyRow()
  const payers = rowsOf(await db.execute(sql`
    SELECT id, name, payer_type, claim_portal FROM referral_sources WHERE is_active = true ORDER BY name`))
  const state = String(agency?.state || '').trim().toUpperCase()
  return c.json({
    payers: payers.map((p) => ({ ...p, claim_portal: parseClaimPortal(p.claim_portal) })),
    presets: state === 'WI' ? WISCONSIN_PRESETS : [],
  })
})

// PUT /claim-portals/:payerId — set (or clear, with { claimPortal: null }) a payer's portal export.
app.put('/claim-portals/:payerId', async (c) => {
  const b = await body(c)
  const raw = b.claimPortal === undefined ? b : b.claimPortal
  let cfg = null
  if (raw !== null) {
    cfg = parseClaimPortal(raw)
    if (!cfg) return c.json({ error: 'A portal export needs a portal name and both procedure codes.' }, 400)
  }
  const r = rowsOf(await db.execute(sql`
    UPDATE referral_sources SET claim_portal = ${cfg ? JSON.stringify(cfg) : null}::json, updated_at = NOW()
     WHERE id = ${c.req.param('payerId')} RETURNING id, name, claim_portal`))
  if (!r.length) return c.json({ error: 'Payer not found' }, 404)
  return c.json({ ...r[0], claim_portal: parseClaimPortal(r[0].claim_portal) })
})

// GET /portal-claim-days?payerId&weekStart=YYYY-MM-DD — per client, per day of one Sun–Sat week, the
// EVV-code units and the other-code units to key into the payer's portal. weekStart snaps to its
// Sunday; default = the last full week.
app.get('/portal-claim-days', async (c) => {
  const { payerId, weekStart } = c.req.query()
  if (!payerId) return c.json({ error: 'payerId is required' }, 400)
  const payer = rowsOf(await db.execute(sql`SELECT id, name, claim_portal FROM referral_sources WHERE id = ${payerId}`))[0]
  if (!payer) return c.json({ error: 'Payer not found' }, 404)
  const cfg = parseClaimPortal(payer.claim_portal)
  if (!cfg) return c.json({ error: `${payer.name} has no portal export set up yet.` }, 400)
  const tz = await agencyTimezone()
  const day = isDate(weekStart) ? weekStart : addDays(ymdIn(new Date(), tz), -7)
  const week = await portalClaimWeek(db, payerId, day, tz)
  return c.json({ payer: { id: payer.id, name: payer.name }, portal: cfg, ...week })
})

export default app
