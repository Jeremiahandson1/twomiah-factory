// Claims management — ported from CVHC routes/claimsRoutes.js: generate from EVV, the denial queue
// and resubmission, manual status updates (with idempotent authorization deduction on submit),
// payer routing, 837P / insurer-portal / IRIS exports, and the dashboard summary.
//
// The office's surface: authenticate + requireAdmin for every route, as this template always had it.
//
// Rows come back in CVHC's shape so its screens read them unchanged: the template stores
// charge_amount as billed_amount, procedure_code as service_code, units as units_billed and
// submitted_date as submission_date, and each is ALSO returned under the CVHC name.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../../db/index.ts'
import { agencies } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import {
  generateClaimFromEVV, batchGenerateClaims, checkAuthorizationForSubmission, deductAuthorizationUnits,
} from '../services/claimsEngine.ts'
import { generate837P, getProviderInfo } from '../services/edi837Generator.ts'
import { routeClaim, generateMidasExport, generateIRISExport } from '../services/payerRouter.ts'
import { parseClaimPortal } from '../services/portalClaimDays.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)

const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[]
const body = async (c: any) => { try { return (await c.req.json()) || {} } catch { return {} } }
const isDate = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const userId = (c: any) => (c.get('user') as any)?.userId || (c.get('user') as any)?.id || null
const STATUSES = ['draft', 'pending', 'ready', 'submitted', 'accepted', 'paid', 'partial', 'denied', 'voided', 'appealed']

/** The CVHC column names, alongside the template's own. */
const CVHC_ALIASES = sql.raw(`
  cl.billed_amount AS charge_amount, cl.billed_amount AS total_amount, cl.service_code AS procedure_code,
  cl.units_billed AS units, cl.submission_date AS submitted_date,
  to_char(cl.service_date, 'YYYY-MM-DD') AS service_date,
  to_char(cl.service_date_from, 'YYYY-MM-DD') AS service_date_from,
  to_char(cl.service_date_to, 'YYYY-MM-DD') AS service_date_to`)

// GET / — claims, newest first (500 max), filtered by status / payer / service dates.
app.get('/', async (c) => {
  const { status, payerId, startDate, endDate } = c.req.query()
  const s = isDate(startDate) ? startDate : null, e = isDate(endDate) ? endDate : null
  return c.json(rowsOf(await db.execute(sql`
    SELECT cl.*, ${CVHC_ALIASES},
           rs.name AS payer_name, rs.payer_type AS rs_payer_type,
           c.first_name AS client_first_name, c.last_name AS client_last_name, c.medicaid_id,
           u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name,
           i.invoice_number, i.seq_number AS invoice_seq_number, a.auth_number, eb.batch_number,
           CASE WHEN cl.submission_date IS NULL THEN NULL ELSE (CURRENT_DATE - cl.submission_date) END AS days_since_submission
      FROM claims cl
      LEFT JOIN referral_sources rs ON cl.payer_id = rs.id
      LEFT JOIN clients c ON cl.client_id = c.id
      LEFT JOIN users u ON cl.caregiver_id = u.id
      LEFT JOIN invoices i ON cl.invoice_id = i.id
      LEFT JOIN authorizations a ON cl.authorization_id = a.id
      LEFT JOIN edi_batches eb ON cl.edi_batch_id = eb.id
     WHERE (${status || null}::text IS NULL OR cl.status = ${status || null}::text)
       AND (${payerId || null}::text IS NULL OR cl.payer_id = ${payerId || null}::text)
       AND (${s}::date IS NULL OR COALESCE(cl.service_date, cl.service_date_from) >= ${s}::date)
       AND (${e}::date IS NULL OR COALESCE(cl.service_date, cl.service_date_to) <= ${e}::date)
     ORDER BY cl.created_at DESC
     LIMIT 500`)))
})

// GET /reports/summary — status rollup, by payer, aging of what is out, A/R, paid this month, denied.
app.get('/reports/summary', async (c) => {
  const byStatus = rowsOf(await db.execute(sql`
    SELECT status, COUNT(*)::int AS count, COALESCE(SUM(billed_amount), 0) AS total_charged, COALESCE(SUM(paid_amount), 0) AS total_paid
      FROM claims GROUP BY status`))
  const byPayer = rowsOf(await db.execute(sql`
    SELECT rs.name AS payer_name, COUNT(*)::int AS claim_count,
           COALESCE(SUM(cl.billed_amount), 0) AS total_charged, COALESCE(SUM(cl.paid_amount), 0) AS total_paid,
           COALESCE(SUM(CASE WHEN cl.status = 'denied' THEN cl.billed_amount ELSE 0 END), 0) AS total_denied
      FROM claims cl JOIN referral_sources rs ON cl.payer_id = rs.id
     GROUP BY rs.id, rs.name ORDER BY total_charged DESC`))
  const aging = rowsOf(await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN submission_date > CURRENT_DATE - 30 THEN billed_amount ELSE 0 END), 0) AS under_30,
      COALESCE(SUM(CASE WHEN submission_date BETWEEN CURRENT_DATE - 60 AND CURRENT_DATE - 30 THEN billed_amount ELSE 0 END), 0) AS days_30_60,
      COALESCE(SUM(CASE WHEN submission_date BETWEEN CURRENT_DATE - 90 AND CURRENT_DATE - 61 THEN billed_amount ELSE 0 END), 0) AS days_60_90,
      COALESCE(SUM(CASE WHEN submission_date < CURRENT_DATE - 90 THEN billed_amount ELSE 0 END), 0) AS over_90
      FROM claims WHERE status IN ('submitted', 'accepted')`))[0]
  const ar = rowsOf(await db.execute(sql`
    SELECT COALESCE(SUM(billed_amount - COALESCE(paid_amount, 0)), 0) AS total_ar
      FROM claims WHERE status IN ('draft', 'pending', 'submitted', 'accepted')`))[0]
  const paidThisMonth = rowsOf(await db.execute(sql`
    SELECT COALESCE(SUM(paid_amount), 0) AS amount, COUNT(*)::int AS count
      FROM claims WHERE status = 'paid' AND paid_date >= DATE_TRUNC('month', CURRENT_DATE)`))[0]
  const denied = rowsOf(await db.execute(sql`
    SELECT COUNT(*)::int AS count, COALESCE(SUM(billed_amount), 0) AS total FROM claims WHERE status = 'denied'`))[0]
  const totals = rowsOf(await db.execute(sql`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(billed_amount), 0) AS billed, COALESCE(SUM(paid_amount), 0) AS paid FROM claims`))[0]
  return c.json({
    byStatus, byPayer, aging, totalAR: Number(ar?.total_ar || 0), paidThisMonth, deniedClaims: denied,
    // the template's earlier summary fields, kept for its dashboard tiles
    totalClaims: totals.n, totalBilled: Number(totals.billed), totalPaid: Number(totals.paid),
    outstanding: Number((Number(totals.billed) - Number(totals.paid)).toFixed(2)),
  })
})

// GET /denial-queue — denied claims with the denial code's description and its usual fix.
app.get('/denial-queue', async (c) => {
  const hasFix = rowsOf(await db.execute(sql`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'denial_code_lookup' AND column_name IN ('common_fix', 'remediation')`)).map((r) => r.column_name)
  const fix = sql.raw(hasFix.includes('common_fix') && hasFix.includes('remediation') ? 'COALESCE(dcl.common_fix, dcl.remediation)'
    : hasFix.includes('common_fix') ? 'dcl.common_fix' : hasFix.includes('remediation') ? 'dcl.remediation' : 'NULL::text')
  return c.json(rowsOf(await db.execute(sql`
    SELECT cl.*, ${CVHC_ALIASES},
           rs.name AS payer_name, c.first_name AS client_first_name, c.last_name AS client_last_name, c.medicaid_id,
           u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name, a.auth_number,
           to_char(ev.service_date, 'YYYY-MM-DD') AS evv_service_date, ev.actual_start, ev.actual_end,
           dcl.description AS denial_description, ${fix} AS common_fix
      FROM claims cl
      LEFT JOIN referral_sources rs ON cl.payer_id = rs.id
      LEFT JOIN clients c ON cl.client_id = c.id
      LEFT JOIN users u ON cl.caregiver_id = u.id
      LEFT JOIN authorizations a ON cl.authorization_id = a.id
      LEFT JOIN evv_visits ev ON cl.evv_visit_id = ev.id
      LEFT JOIN denial_code_lookup dcl ON cl.denial_code = dcl.code
     WHERE cl.status = 'denied'
     ORDER BY cl.updated_at DESC`)))
})

// GET /lookup/denial-codes
app.get('/lookup/denial-codes', async (c) => c.json(rowsOf(await db.execute(sql`SELECT * FROM denial_code_lookup ORDER BY code`))))

// POST /:id/resubmit — a denied claim becomes a new pending claim; the original is voided.
app.post('/:id/resubmit', async (c) => {
  const id = c.req.param('id')
  const out = await db.transaction(async (tx) => {
    const orig = rowsOf(await tx.execute(sql`SELECT * FROM claims WHERE id = ${id} AND status = 'denied' FOR UPDATE`))[0]
    if (!orig) return null
    const newId = createId()
    // Copied in SQL, so dates and amounts move as the database holds them.
    const fresh = rowsOf(await tx.execute(sql`
      INSERT INTO claims (
        id, evv_visit_id, invoice_id, client_id, caregiver_id, authorization_id, payer_id, payer_type, claim_number,
        service_code, modifier, diagnosis_code, service_date, service_date_from, service_date_to, place_of_service,
        units_billed, billed_amount, submission_method, status, resubmitted_from, created_by_id
      )
      SELECT ${newId}, evv_visit_id, invoice_id, client_id, caregiver_id, authorization_id, payer_id, payer_type,
             COALESCE(claim_number, 'CLM') || '-R', service_code, modifier, diagnosis_code, service_date,
             service_date_from, service_date_to, place_of_service, units_billed, billed_amount, submission_method,
             'pending', id, ${userId(c)}
        FROM claims WHERE id = ${id}
      RETURNING *`))[0]
    await tx.execute(sql`UPDATE claims SET status = 'voided', voided_at = NOW(), voided_by = ${userId(c)}, updated_at = NOW() WHERE id = ${id}`)
    await tx.execute(sql`
      INSERT INTO claim_status_history (id, claim_id, status, notes, created_by)
      VALUES (${createId()}, ${newId}, 'pending', ${`Resubmitted from denied claim ${orig.claim_number}`}, ${userId(c)})`)
    return fresh
  })
  if (!out) return c.json({ error: 'Denied claim not found' }, 404)
  return c.json(out, 201)
})

// POST /from-evv (and the template's older /generate-from-evv) — one draft claim from an EVV visit.
const fromEvv = async (c: any) => {
  const { evvVisitId } = await body(c)
  if (!evvVisitId) return c.json({ error: 'EVV visit ID is required' }, 400)
  try {
    return c.json(await generateClaimFromEVV(evvVisitId, userId(c)), 201)
  } catch (e: any) {
    return c.json({ error: e.message }, (e?.status === 404 ? 404 : 400) as any)
  }
}
app.post('/from-evv', fromEvv)
app.post('/generate-from-evv', fromEvv)

// POST /batch-generate — draft claims for every claimable visit in the range.
app.post('/batch-generate', async (c) => {
  const { startDate, endDate } = await body(c)
  if (!isDate(startDate) || !isDate(endDate)) return c.json({ error: 'Start date and end date are required' }, 400)
  return c.json(await batchGenerateClaims(startDate, endDate, userId(c)))
})

/**
 * Set a claim's status with its side effects: submitted/accepted/paid dates, paid amount, denial
 * code/reason, EOB notes; on submission the authorization's units are deducted ONCE.
 */
async function setClaimStatus(c: any, claimId: string, b: any, historyNote: string | null) {
  const status = b.status
  if (!STATUSES.includes(status)) return c.json({ error: `status must be one of ${STATUSES.join(', ')}` }, 400)
  const paid = b.paidAmount != null && b.paidAmount !== '' ? Number(b.paidAmount) : null
  if (paid != null && (!Number.isFinite(paid) || paid < 0)) return c.json({ error: 'paidAmount must be a non-negative number' }, 400)
  const r = rowsOf(await db.execute(sql`
    UPDATE claims SET
      status = ${status}::text,
      submission_date = CASE WHEN ${status}::text = 'submitted' THEN CURRENT_DATE ELSE submission_date END,
      accepted_date = CASE WHEN ${status}::text = 'accepted' THEN CURRENT_DATE ELSE accepted_date END,
      paid_date = CASE WHEN ${status}::text = 'paid' THEN CURRENT_DATE ELSE paid_date END,
      paid_amount = CASE WHEN ${status}::text = 'paid' AND ${paid}::numeric IS NOT NULL THEN ${paid}::numeric ELSE paid_amount END,
      denial_code = CASE WHEN ${status}::text = 'denied' AND ${b.denialCode || null}::text IS NOT NULL THEN ${b.denialCode || null}::text ELSE denial_code END,
      denial_reason = CASE WHEN ${status}::text = 'denied' AND ${b.denialReason || null}::text IS NOT NULL THEN ${b.denialReason || null}::text ELSE denial_reason END,
      eob_notes = COALESCE(${b.eobNotes || null}::text, eob_notes),
      updated_at = NOW()
    WHERE id = ${claimId} RETURNING id`))
  if (!r.length) return c.json({ error: 'Claim not found' }, 404)
  await db.execute(sql`
    INSERT INTO claim_status_history (id, claim_id, status, notes, created_by)
    VALUES (${createId()}, ${claimId}, ${status},
            ${historyNote ?? `Manual status update${b.denialCode ? ` (${b.denialCode})` : ''}${b.denialReason ? `: ${b.denialReason}` : ''}`},
            ${userId(c)})`)
  let unitsDeducted = false
  if (status === 'submitted') unitsDeducted = await deductAuthorizationUnits(claimId)
  return c.json({ success: true, unitsDeducted })
}

// POST /update-status { claimId, status, … }
app.post('/update-status', async (c) => {
  const b = await body(c)
  if (!b.claimId || !b.status) return c.json({ error: 'claimId and status are required' }, 400)
  return setClaimStatus(c, b.claimId, b, null)
})
// PUT /:id/status { status, notes, … }
app.put('/:id/status', async (c) => {
  const b = await body(c)
  return setClaimStatus(c, c.req.param('id'), b, b.notes || null)
})

// GET /:id/auth-check
app.get('/:id/auth-check', async (c) => c.json(await checkAuthorizationForSubmission(c.req.param('id'))))

// POST /:id/submit — refuses when the authorization blocks it; deducts its units once.
app.post('/:id/submit', async (c) => {
  const id = c.req.param('id')
  const check = await checkAuthorizationForSubmission(id)
  if (check.blockers?.includes('Claim not found')) return c.json({ error: 'Claim not found' }, 404)
  if (!check.canSubmit) return c.json({ error: 'Cannot submit claim', blockers: check.blockers }, 400)
  const r = await setClaimStatus(c, id, { status: 'submitted' },
    check.warnings.length ? `Submitted with warnings: ${check.warnings.join('; ')}` : 'Claim submitted')
  if (r.status !== 200) return r
  const claim = rowsOf(await db.execute(sql`SELECT * FROM claims WHERE id = ${id}`))[0]
  return c.json({ claim, warnings: check.warnings })
})

// GET /:id/route — where this claim's payer submits.
app.get('/:id/route', async (c) => {
  const rs = rowsOf(await db.execute(sql`
    SELECT rs.* FROM claims cl JOIN referral_sources rs ON cl.payer_id = rs.id WHERE cl.id = ${c.req.param('id')}`))[0]
  if (!rs) return c.json({ error: 'Claim or payer not found' }, 404)
  return c.json(routeClaim(rs))
})

// GET /:id/history
app.get('/:id/history', async (c) => c.json(rowsOf(await db.execute(sql`
  SELECT * FROM claim_status_history WHERE claim_id = ${c.req.param('id')} ORDER BY created_at DESC`))))

async function claimsForExport(ids: string[]) {
  return rowsOf(await db.execute(sql`
    SELECT cl.*, ${CVHC_ALIASES},
           rs.name AS payer_name, rs.edi_payer_id, rs.npi AS payer_npi, rs.fea_organization, rs.claim_portal,
           c.first_name AS client_first_name, c.last_name AS client_last_name, c.medicaid_id, c.mco_member_id,
           to_char(c.date_of_birth, 'YYYY-MM-DD') AS date_of_birth, c.address AS client_address, c.city AS client_city,
           c.state AS client_state, c.zip AS client_zip, c.gender, c.primary_diagnosis_code,
           u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name,
           cp.npi_number AS caregiver_npi, cp.taxonomy_code, a.auth_number,
           ev.sandata_visit_id, ev.units_of_service
      FROM claims cl
      JOIN clients c ON cl.client_id = c.id
      LEFT JOIN referral_sources rs ON cl.payer_id = rs.id
      LEFT JOIN users u ON cl.caregiver_id = u.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      LEFT JOIN authorizations a ON cl.authorization_id = a.id
      LEFT JOIN evv_visits ev ON cl.evv_visit_id = ev.id
     WHERE cl.id = ANY(string_to_array(${ids.join(',')}::text, ','))`))
}
const idsOf = (b: any): string[] => (Array.isArray(b?.claimIds) ? b.claimIds.filter((x: any) => typeof x === 'string' && x) : [])
const exportDay = () => new Date().toISOString().slice(0, 10)
const download = (c: any, type: string, filename: string, content: string) => {
  c.header('Content-Type', type)
  c.header('Content-Disposition', `attachment; filename=${filename}`)
  return c.body(content)
}
async function markExported(ids: string[], method: string) {
  await db.execute(sql`
    UPDATE claims SET submission_method = ${method}, status = 'submitted', submission_date = CURRENT_DATE, updated_at = NOW()
     WHERE id = ANY(string_to_array(${ids.join(',')}::text, ',')) AND status IN ('pending', 'draft', 'ready')`)
}

// POST /export/837p — an EDI 837P file for the selected claims; they become submitted and their
// authorization units are deducted (once each).
app.post('/export/837p', async (c) => {
  const ids = idsOf(await body(c))
  if (!ids.length) return c.json({ error: 'No claims selected' }, 400)
  const claims = await claimsForExport(ids)
  if (!claims.length) return c.json({ error: 'No claims found' }, 400)
  const [agency] = await db.select().from(agencies).limit(1)
  const provider = getProviderInfo((agency as any) || undefined)
  const payer = { name: claims[0].payer_name || 'PAYER', edi_payer_id: claims[0].edi_payer_id || '', npi: claims[0].payer_npi || '' }
  const edi = generate837P({ claims: claims as any, provider, payer: payer as any, interchangeControlNum: Date.now() })
  await markExported(ids, 'edi837')
  for (const cl of claims) { try { await deductAuthorizationUnits(cl.id) } catch { /* non-fatal, as in CVHC */ } }
  return download(c, 'text/plain', `claims-837p-${Date.now()}.edi`, edi)
})

// POST /export/portal (and CVHC's /export/midas) — the insurer-portal upload packet for the selected
// claims, titled with their payer's configured portal.
const portalExport = async (c: any) => {
  const ids = idsOf(await body(c))
  if (!ids.length) return c.json({ error: 'No claims selected' }, 400)
  const claims = await claimsForExport(ids)
  if (!claims.length) return c.json({ error: 'No claims found' }, 400)
  const portals = [...new Set(claims.map((cl) => parseClaimPortal(cl.claim_portal)?.name || null))]
  const portalName = portals.length === 1 && portals[0] ? portals[0] : 'Insurer Portal'
  const [agency] = await db.select().from(agencies).limit(1)
  const csv = generateMidasExport(claims as any, getProviderInfo((agency as any) || undefined), portalName)
  await markExported(ids, 'portal_export')
  return download(c, 'text/csv', `${portalName.replace(/[^A-Za-z0-9]+/g, '-')}-Upload-Packet-${exportDay()}.csv`, csv)
}
app.post('/export/portal', portalExport)
app.post('/export/midas', portalExport)

// POST /export/iris — the IRIS FEA export.
app.post('/export/iris', async (c) => {
  const ids = idsOf(await body(c))
  if (!ids.length) return c.json({ error: 'No claims selected' }, 400)
  const claims = await claimsForExport(ids)
  if (!claims.length) return c.json({ error: 'No claims found' }, 400)
  const csv = generateIRISExport(claims as any)
  await markExported(ids, 'iris_export')
  return download(c, 'text/csv', `IRIS-FEA-Export-${exportDay()}.csv`, csv)
})

// GET /:id — one claim with its payer, client, invoice, authorization, denial lookup and history.
app.get('/:id', async (c) => {
  const id = c.req.param('id')
  const claim = rowsOf(await db.execute(sql`
    SELECT cl.*, ${CVHC_ALIASES},
           rs.name AS payer_name, rs.payer_type AS rs_payer_type, rs.billing_address, rs.billing_contact_name AS billing_contact,
           c.first_name AS client_first_name, c.last_name AS client_last_name, c.medicaid_id, c.mco_member_id,
           u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name,
           i.invoice_number, i.total AS invoice_total,
           a.auth_number, a.authorized_units, a.used_units, to_char(a.end_date, 'YYYY-MM-DD') AS auth_end_date,
           dcl.description AS denial_description
      FROM claims cl
      LEFT JOIN referral_sources rs ON cl.payer_id = rs.id
      LEFT JOIN clients c ON cl.client_id = c.id
      LEFT JOIN users u ON cl.caregiver_id = u.id
      LEFT JOIN invoices i ON cl.invoice_id = i.id
      LEFT JOIN authorizations a ON cl.authorization_id = a.id
      LEFT JOIN denial_code_lookup dcl ON cl.denial_code = dcl.code
     WHERE cl.id = ${id}`))[0]
  if (!claim) return c.json({ error: 'Claim not found' }, 404)
  const history = rowsOf(await db.execute(sql`SELECT * FROM claim_status_history WHERE claim_id = ${id} ORDER BY created_at DESC`))
  return c.json({ ...claim, status_history: history })
})

// POST / — a draft claim from an invoice (CVHC "create claim from invoice").
app.post('/', async (c) => {
  const b = await body(c)
  if (!b.invoiceId) return c.json({ error: 'invoiceId is required' }, 400)
  const inv = rowsOf(await db.execute(sql`
    SELECT i.id, i.client_id, i.total, to_char(i.billing_period_start, 'YYYY-MM-DD') AS s, to_char(i.billing_period_end, 'YYYY-MM-DD') AS e,
           COALESCE(i.referral_source_id, c.referred_by_id) AS payer_id, rs.payer_type,
           (SELECT COALESCE(SUM(hours), 0) FROM invoice_line_items WHERE invoice_id = i.id) AS hours,
           -- The dates of service are the invoice's LINES, not its billing period: the claim's
           -- service_date is the first day served (837P and the portal exports read it).
           (SELECT to_char(MIN(service_date), 'YYYY-MM-DD') FROM invoice_line_items WHERE invoice_id = i.id) AS first_day,
           (SELECT to_char(MAX(service_date), 'YYYY-MM-DD') FROM invoice_line_items WHERE invoice_id = i.id) AS last_day
      FROM invoices i JOIN clients c ON i.client_id = c.id LEFT JOIN referral_sources rs ON rs.id = COALESCE(i.referral_source_id, c.referred_by_id)
     WHERE i.id = ${b.invoiceId}`))[0]
  if (!inv) return c.json({ error: 'Invoice not found' }, 404)
  const claimId = createId()
  const units = Math.round(Number(inv.hours) * 4 * 100) / 100 // 15-minute units
  const claim = rowsOf(await db.execute(sql`
    INSERT INTO claims (
      id, invoice_id, claim_number, payer_id, payer_type, client_id, service_date, service_date_from, service_date_to, place_of_service,
      service_code, modifier, diagnosis_code, units_billed, billed_amount, status, created_by_id
    ) VALUES (
      ${claimId}, ${inv.id}, ${`CLM-${Date.now().toString(36).toUpperCase()}`}, ${inv.payer_id}, ${inv.payer_type || null}, ${inv.client_id},
      ${inv.first_day || inv.s}::date, ${inv.first_day || inv.s}::date, ${inv.last_day || inv.e}::date, ${b.placeOfService || '12'}, ${b.procedureCode || null}, ${b.modifier || null},
      ${b.diagnosisCode || null}, ${units}, ${inv.total}, 'draft', ${userId(c)}
    ) RETURNING *`))[0]
  await db.execute(sql`
    INSERT INTO claim_status_history (id, claim_id, status, notes, created_by)
    VALUES (${createId()}, ${claimId}, 'draft', 'Claim created', ${userId(c)})`)
  return c.json(claim, 201)
})

// PATCH /:id — the template's older edit path, kept to the fields an office edits by hand.
app.patch('/:id', async (c) => {
  const b = await body(c)
  if (b.status) return setClaimStatus(c, c.req.param('id'), b, b.statusNotes || null)
  const r = rowsOf(await db.execute(sql`
    UPDATE claims SET notes = COALESCE(${b.notes ?? null}::text, notes), eob_notes = COALESCE(${b.eobNotes ?? null}::text, eob_notes),
           check_number = COALESCE(${b.checkNumber ?? null}::text, check_number), updated_at = NOW()
     WHERE id = ${c.req.param('id')} RETURNING *`))
  if (!r.length) return c.json({ error: 'Claim not found' }, 404)
  return c.json(r[0])
})

export default app
