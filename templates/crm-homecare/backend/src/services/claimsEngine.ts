/**
 * Claims Generation Engine — ported from CVHC services/claimsEngine.js as it runs today.
 *
 * Creates claims from EVV visits, handles authorization burn-down, payer routing, and batch
 * processing. The three things CVHC fixed after this template was copied, and why:
 *
 *   · UNITS come from the time entry's CLEAN billable minutes (billable_minutes / 15, to 2dp), not
 *     the raw units_of_service — raw clocked time is inflated by missed clock-outs (one CVHC visit
 *     read 481 hours). Raw duration is the fallback only when billable minutes are absent.
 *   · An HOURLY payer rate is a quarter per 15-minute unit. The old code multiplied units by the
 *     hourly rate: a 4× overbill. A per-unit rate is used as it is. The rate is the one effective
 *     on the service date.
 *   · Claims are generated as DRAFTS (the review queue before submission), and batch generation no
 *     longer requires Sandata flags nothing ever set: a visit is claimable when its time entry is
 *     complete with billable time, the client's payer is a claim payer (not private pay), and it is
 *     not already claimed.
 *   · Unit deduction is IDEMPOTENT: units_deducted_at is claimed with one conditional UPDATE, so a
 *     retried or re-submitted claim never burns its authorization twice.
 *
 * Column mapping (template ← CVHC): billed_amount ← charge_amount/total_amount,
 * service_code ← procedure_code, units_billed ← units, submission_date ← submitted_date.
 */
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../../db/index.ts'
import { routeClaim } from './payerRouter.ts'
import logger from './logger.ts'
import { notFound } from '../utils/errors.ts'

const rowsOf = (r: any): any[] => (r?.rows ?? r ?? []) as any[]

/** Units and charge for one visit — pure, so the arithmetic can be asserted on its own. */
export function claimUnitsAndCharge(input: {
  billableMinutes: number | string | null | undefined
  durationMinutes?: number | string | null
  unitsOfService?: number | string | null
  payerRate?: { rateAmount: number | string; rateType?: string | null } | null
  serviceCodeRatePerUnit?: number | string | null
}) {
  const billableMinutes = input.billableMinutes != null
    ? parseFloat(String(input.billableMinutes))
    : parseFloat(String(input.durationMinutes || (Number(input.unitsOfService || 0) * 15) || 0))
  const units = Math.round((billableMinutes / 15) * 100) / 100
  let charge = 0
  if (input.payerRate) {
    const rate = parseFloat(String(input.payerRate.rateAmount))
    const perUnit = (input.payerRate.rateType || 'hourly') === 'hourly' ? rate / 4 : rate
    charge = units * perUnit
  }
  if (charge === 0 && input.serviceCodeRatePerUnit) charge = units * parseFloat(String(input.serviceCodeRatePerUnit))
  return { units, charge: Math.round(charge * 100) / 100 }
}

/**
 * Generate a (draft) claim from an EVV visit
 */
export async function generateClaimFromEVV(evvVisitId: string, userId: string) {
  const visit = rowsOf(await db.execute(sql`
    SELECT ev.*, to_char(ev.service_date, 'YYYY-MM-DD') AS service_date_text,
           c.referred_by_id, c.care_type_id, c.primary_diagnosis_code,
           te.billable_minutes, te.duration_minutes,
           rs.name AS payer_name, rs.payer_type, rs.payer_id_number, rs.submission_method, rs.claim_portal
      FROM evv_visits ev
      JOIN clients c ON ev.client_id = c.id
      JOIN users u ON ev.caregiver_id = u.id
      LEFT JOIN referral_sources rs ON c.referred_by_id = rs.id
      LEFT JOIN time_entries te ON te.id = ev.time_entry_id
     WHERE ev.id = ${evvVisitId}`))[0]
  if (!visit) throw notFound('EVV visit not found')

  const existing = rowsOf(await db.execute(sql`SELECT id FROM claims WHERE evv_visit_id = ${evvVisitId}`))
  if (existing.length) throw new Error('Claim already exists for this EVV visit')

  const route = routeClaim({
    payer_type: visit.payer_type,
    payer_id_number: visit.payer_id_number,
    name: visit.payer_name,
    submission_method: visit.submission_method,
    claim_portal: visit.claim_portal,
  })

  // The rate in force on the service date, preferring the client's care type — the same choice
  // invoicing makes (CVHC's claim lookup ignored the care type, so a payer with a care-type rate
  // and a default rate priced claims by whichever row came back first).
  let payerRate: any = null
  if (visit.referred_by_id) {
    payerRate = rowsOf(await db.execute(sql`
      SELECT rate_amount AS "rateAmount", rate_type AS "rateType" FROM referral_source_rates
       WHERE referral_source_id = ${visit.referred_by_id}
         AND (care_type_id = ${visit.care_type_id ?? null}::text OR care_type_id IS NULL)
         AND (is_active = true OR is_active IS NULL OR end_date IS NOT NULL)
         AND (effective_date IS NULL OR effective_date <= ${visit.service_date_text}::date)
         AND (end_date IS NULL OR end_date >= ${visit.service_date_text}::date)
       ORDER BY CASE WHEN care_type_id = ${visit.care_type_id ?? null}::text THEN 0 ELSE 1 END,
                effective_date DESC NULLS LAST
       LIMIT 1`))[0] || null
  }
  const serviceCode = visit.service_code || 'T1019'
  const sc = rowsOf(await db.execute(sql`
    SELECT rate_per_unit FROM service_codes WHERE code = ${serviceCode} AND is_active = true LIMIT 1`))[0]
  const { units, charge } = claimUnitsAndCharge({
    billableMinutes: visit.billable_minutes,
    durationMinutes: visit.duration_minutes,
    unitsOfService: visit.units_of_service,
    payerRate,
    serviceCodeRatePerUnit: sc?.rate_per_unit ?? null,
  })

  const claimId = createId()
  const claimNumber = `CLM-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 4).toUpperCase()}`
  const claim = rowsOf(await db.execute(sql`
    INSERT INTO claims (
      id, evv_visit_id, client_id, caregiver_id, authorization_id, payer_id, payer_type, claim_number,
      service_code, modifier, diagnosis_code, service_date, service_date_from, service_date_to,
      place_of_service, units_billed, billed_amount, submission_method, status, created_by_id
    ) VALUES (
      ${claimId}, ${evvVisitId}, ${visit.client_id}, ${visit.caregiver_id}, ${visit.authorization_id || null},
      ${visit.referred_by_id || null}, ${visit.payer_type || null}, ${claimNumber},
      ${serviceCode}, ${visit.modifier || null}, ${visit.primary_diagnosis_code || 'Z7689'},
      ${visit.service_date_text}::date, ${visit.service_date_text}::date, ${visit.service_date_text}::date,
      '12', ${units}, ${charge}, ${route.method}, 'draft', ${userId}
    ) RETURNING *`))[0]

  await db.execute(sql`
    INSERT INTO claim_status_history (id, claim_id, status, notes, created_by)
    VALUES (${createId()}, ${claimId}, 'draft', 'Claim generated from EVV visit', ${userId})`)

  return { claim, route }
}

/**
 * Batch generate draft claims for every claimable EVV visit in a date range
 */
export async function batchGenerateClaims(startDate: string, endDate: string, userId: string) {
  const visits = rowsOf(await db.execute(sql`
    SELECT ev.id
      FROM evv_visits ev
      JOIN time_entries te ON te.id = ev.time_entry_id
      JOIN clients c ON c.id = ev.client_id
      JOIN referral_sources rs ON rs.id = c.referred_by_id
      LEFT JOIN claims cl ON cl.evv_visit_id = ev.id
     WHERE ev.service_date BETWEEN ${startDate}::date AND ${endDate}::date
       AND te.is_complete = true
       AND COALESCE(te.billable_minutes, te.duration_minutes) > 0
       AND COALESCE(c.is_private_pay, false) = false
       AND rs.payer_type IS NOT NULL
       AND rs.payer_type <> 'private_pay'
       AND cl.id IS NULL
     ORDER BY ev.service_date ASC`))

  const results = { generated: 0, skipped: 0, errors: [] as { visitId: string; error: string }[] }
  for (const v of visits) {
    try {
      await generateClaimFromEVV(v.id, userId)
      results.generated++
    } catch (e: any) {
      results.skipped++
      results.errors.push({ visitId: v.id, error: e.message })
    }
  }
  return results
}

/**
 * Check authorization before claim submission
 * Returns { canSubmit, warnings, blockers }
 */
export async function checkAuthorizationForSubmission(claimId: string) {
  const c = rowsOf(await db.execute(sql`
    SELECT cl.authorization_id, cl.units_billed, a.authorized_units, a.used_units,
           to_char(a.end_date, 'YYYY-MM-DD') AS end_date, a.status AS auth_status
      FROM claims cl LEFT JOIN authorizations a ON cl.authorization_id = a.id
     WHERE cl.id = ${claimId}`))[0]
  if (!c) return { canSubmit: false, blockers: ['Claim not found'], warnings: [] as string[] }

  const warnings: string[] = []
  const blockers: string[] = []
  if (!c.authorization_id) {
    warnings.push('No authorization linked to this claim')
    return { canSubmit: true, warnings, blockers }
  }
  const remaining = parseFloat(c.authorized_units || '0') - parseFloat(c.used_units || '0')
  const unitsToBill = parseFloat(c.units_billed || '0')
  const totalAuth = parseFloat(c.authorized_units || '0')
  if (remaining <= 0 || c.auth_status === 'exhausted') blockers.push('Authorization has no remaining units. Request a renewal before submitting.')
  if (unitsToBill > remaining && remaining > 0) blockers.push(`Claim requires ${unitsToBill} units but only ${remaining.toFixed(1)} remain on authorization.`)
  if (remaining > 0 && remaining < totalAuth * 0.1) warnings.push(`Only ${remaining.toFixed(1)} units remaining (${((remaining / totalAuth) * 100).toFixed(0)}% of ${totalAuth}). Consider requesting renewal.`)
  if (c.end_date) {
    const daysUntilExpiry = Math.ceil((new Date(c.end_date + 'T23:59:59Z').getTime() - Date.now()) / 86400000)
    if (daysUntilExpiry <= 0) blockers.push('Authorization has expired.')
    else if (daysUntilExpiry <= 30) warnings.push(`Authorization expires in ${daysUntilExpiry} days.`)
  }
  return { canSubmit: blockers.length === 0, warnings, blockers, remainingUnits: remaining, unitsToBill }
}

/**
 * Take a submitted claim's units off its authorization — once. units_deducted_at is claimed with
 * one conditional UPDATE, so a retry (or two concurrent submits) deducts nothing the second time.
 * Returns true when units were deducted by THIS call.
 */
export async function deductAuthorizationUnits(claimId: string): Promise<boolean> {
  const c = rowsOf(await db.execute(sql`
    SELECT cl.units_billed, cl.authorization_id, cl.client_id, cl.units_deducted_at,
           a.authorized_units, a.used_units, a.low_units_alert_threshold, a.auth_number,
           to_char(a.end_date, 'YYYY-MM-DD') AS end_date
      FROM claims cl JOIN authorizations a ON cl.authorization_id = a.id
     WHERE cl.id = ${claimId}`))[0]
  if (!c) return false
  const units = parseFloat(c.units_billed || '0')
  if (units <= 0 || !c.authorization_id || c.units_deducted_at) return false

  const won = rowsOf(await db.execute(sql`
    UPDATE claims SET units_deducted_at = NOW() WHERE id = ${claimId} AND units_deducted_at IS NULL RETURNING id`))
  if (!won.length) return false

  await db.execute(sql`
    UPDATE authorizations SET
      used_units = used_units + ${units},
      status = CASE WHEN used_units + ${units} >= authorized_units THEN 'exhausted' ELSE status END,
      updated_at = NOW()
    WHERE id = ${c.authorization_id}`)

  const remaining = parseFloat(c.authorized_units || '0') - (parseFloat(c.used_units || '0') + units)
  const threshold = parseFloat(c.low_units_alert_threshold || '20')
  const totalAuth = parseFloat(c.authorized_units || '0')
  if (remaining <= threshold || remaining <= totalAuth * 0.1) {
    const admins = rowsOf(await db.execute(sql`SELECT id FROM users WHERE role IN ('admin', 'owner') AND is_active = true`))
    const ci = rowsOf(await db.execute(sql`SELECT first_name, last_name FROM clients WHERE id = ${c.client_id}`))[0]
    const clientName = ci ? `${ci.first_name} ${ci.last_name}` : 'Client'
    const title = remaining <= 0 ? 'Authorization Exhausted' : 'Low Authorization Units'
    const message = remaining <= 0
      ? `${clientName}: Authorization #${c.auth_number || 'N/A'} has been exhausted. No units remaining. Renewal required.`
      : `${clientName}: Only ${remaining.toFixed(1)} units remaining on auth #${c.auth_number || 'N/A'} (expires ${c.end_date || 'N/A'})`
    for (const a of admins) {
      await db.execute(sql`
        INSERT INTO notifications (id, user_id, type, title, message, is_read)
        VALUES (${createId()}, ${a.id}, 'authorization_alert', ${title}, ${message}, false)`)
    }
    logger.warn('Authorization alert', { claimId, remaining, threshold, title })
  }
  return true
}
