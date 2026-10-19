// Home care's visit-billing SQL: the invoice engine's reads and writes, and the money reports' fragments. Moved from
// templates/crm-homecare/backend/src/services/invoiceEngine.ts and services/invoiceMoney.ts (raw SQL lives in
// server/data/, RULEBOOK §2). Every query is the company's; the reads return camelCase.
//
// What the money reports count for INVOICES (services/invoiceMoney.ts) — one rule for Reports, the Revenue Forecast,
// the dashboard tiles and the Billing screen:
//   · BILLED = RELEASED invoices only (sent, released to the portal, or with a payment on it). A draft is neither
//     billed nor owed.
//   · An invoice is DATED by its first day of service (the earliest service_date on its lines; the billing period's
//     start for an invoice with no dated line) and counts WHOLE in the range that day falls in. Never prorated.
//   · COLLECTED = the payments recorded (invoice_payments) on those invoices.
//   · OUTSTANDING / A/R = total − amount_paid − amount_adjusted of released invoices.
import { sql, type SQL } from 'drizzle-orm'
import { camelRows, camelFirst } from '@twomiah/tenant-backend'
import { invoices } from '../db/schema/index.ts'
import { occurrencesCte, privatePaySql, type Q } from './homecareCore.ts'

const alias = (a: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(a)) throw new Error(`bad alias: ${a}`)
  return a
}

// ── Who outside the office may see an invoice (invoiceEngine.ts) ─────────────────────────────

/** WHERE fragment over the `invoices` table (query builder): released to the client. */
export function clientVisibleInvoiceSql(): SQL {
  return sql`(${invoices.sentAt} IS NOT NULL OR ${invoices.paymentStatus} IN ('paid', 'partial'))`
}

/** The same rule for raw SQL over an aliased invoices table. A RELEASED invoice is what every money report counts as billed. */
export function releasedInvoiceSql(i = 'i'): SQL {
  return sql.raw(`(${alias(i)}.sent_at IS NOT NULL OR ${i}.payment_status IN ('paid', 'partial'))`)
}

// ── The money reports' fragments (invoiceMoney.ts) ──────────────────────────────────────────

/** An invoice's service date (see above). `i` = an invoices alias. */
export function invoiceServiceDateSql(i = 'i'): SQL {
  return sql.raw(`COALESCE((SELECT MIN(ili_d.service_date) FROM invoice_line_items ili_d WHERE ili_d.invoice_id = ${alias(i)}.id), ${i}.billing_period_start)`)
}

/** WHERE fragment: a released invoice whose service date falls in [start, end]. */
export function billedInRangeSql(start: string, end: string, i = 'i'): SQL {
  return sql`(${releasedInvoiceSql(i)} AND ${invoiceServiceDateSql(i)} BETWEEN (${start})::date AND (${end})::date)`
}

/** An invoice's open balance, net of payments and write-offs. */
export function invoiceBalanceSql(i = 'i'): SQL {
  return sql.raw(`(${alias(i)}.total - COALESCE(${i}.amount_paid, 0) - COALESCE(${i}.amount_adjusted, 0))`)
}

// ── Rates ────────────────────────────────────────────────────────────────────────────────────

/**
 * The payer's rate for a period, preferring the client's care type and the one effective for the period. A rate
 * RETIRED by a newer one (is_active false, end_date set) still prices the days before its end date. null when none.
 */
export async function referralSourceRateFor(q: Q, companyId: string, payerId: string, careTypeId: string | null,
  periodStart: string, periodEnd: string): Promise<{ rateAmount: string; rateType: string | null } | null> {
  return camelFirst(await q.execute(sql`
    SELECT rate_amount, rate_type FROM referral_source_rates
     WHERE company_id = ${companyId}
       AND referral_source_id = ${payerId}
       AND (care_type_id = ${careTypeId}::text OR care_type_id IS NULL)
       AND (is_active = true OR is_active IS NULL OR end_date IS NOT NULL)
       AND (effective_date IS NULL OR effective_date <= ${periodEnd}::date)
       AND (end_date IS NULL OR end_date >= ${periodStart}::date)
     ORDER BY CASE WHEN care_type_id = ${careTypeId}::text THEN 0 ELSE 1 END,
              effective_date DESC NULLS LAST
     LIMIT 1`)) ?? null
}

// ── The generator's reads ────────────────────────────────────────────────────────────────────

/** The client row every generator reads, or null. `privatePayByRule`: the box OR a payer whose payer_type is private_pay. */
export async function billingClient(q: Q, companyId: string, clientId: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    SELECT c.id, c.first_name, c.last_name, c.email, c.referred_by_id, c.care_type_id, c.is_private_pay,
           c.private_pay_rate, c.private_pay_rate_type, c.is_active, c.billing_frequency_weeks,
           to_char(c.billed_through, 'YYYY-MM-DD') AS billed_through,
           ${privatePaySql('c')} AS private_pay_by_rule
      FROM clients c WHERE c.id = ${clientId} AND c.company_id = ${companyId}`)) ?? null
}

/**
 * The client's completed punches whose clock-in falls in [from, to] on the agency's clock (`tz`), with their local
 * date and minutes, labels and instants. Training shifts' punches are left out (paid, never billed).
 */
export async function billingTimeEntries(q: Q, companyId: string, clientId: string, from: string, to: string, tz: string): Promise<any[]> {
  // time_entries.start_time is a naive UTC instant; read it on the agency's clock.
  const local = (col: string) => sql.raw(`((${col} AT TIME ZONE 'UTC') AT TIME ZONE `)
  return camelRows(await q.execute(sql`
    SELECT te.id AS time_entry_id, te.caregiver_id,
           u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name,
           to_char(${local('te.start_time')}${tz}), 'YYYY-MM-DD') AS local_date,
           (EXTRACT(HOUR FROM ${local('te.start_time')}${tz})) * 60 + EXTRACT(MINUTE FROM ${local('te.start_time')}${tz})))::int AS start_min,
           CASE WHEN te.end_time IS NULL THEN NULL
                ELSE (EXTRACT(HOUR FROM ${local('te.end_time')}${tz})) * 60 + EXTRACT(MINUTE FROM ${local('te.end_time')}${tz})))::int END AS end_min,
           to_char(${local('te.start_time')}${tz}), 'FMHH12:MI AM') AS start_label,
           CASE WHEN te.end_time IS NULL THEN NULL ELSE to_char(${local('te.end_time')}${tz}), 'FMHH12:MI AM') END AS end_label,
           to_char(${local('te.start_time')}${tz}), 'HH24:MI') AS start_hhmm,
           CASE WHEN te.end_time IS NULL THEN NULL ELSE to_char(${local('te.end_time')}${tz}), 'HH24:MI') END AS end_hhmm,
           to_char(te.start_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_iso,
           CASE WHEN te.end_time IS NULL THEN NULL ELSE to_char(te.end_time, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END AS end_iso,
           te.duration_minutes, te.billable_minutes,
           CASE WHEN te.end_time IS NULL THEN NULL ELSE EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 60.0 END AS raw_minutes
      FROM time_entries te
      JOIN "user" u ON te.caregiver_id = u.id
      LEFT JOIN schedules ts ON te.schedule_id = ts.id
     WHERE te.company_id = ${companyId}
       AND te.client_id = ${clientId}
       AND te.is_complete = true
       AND (${local('te.start_time')}${tz}))::date BETWEEN ${from}::date AND ${to}::date
       AND (ts.is_training IS NOT TRUE OR ts.id IS NULL)
     ORDER BY te.start_time`))
}

/** The client's scheduled visits in [from, to] (the shared engine), training shifts left out, with the caregiver's name. */
export async function billingOccurrences(q: Q, companyId: string, clientId: string, from: string, to: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    WITH ${occurrencesCte(companyId, from, to, 'occ')}
    SELECT occ.schedule_id, to_char(occ.occ_date, 'YYYY-MM-DD') AS occ_date, occ.caregiver_id,
           occ.start_time::text AS start_time, occ.end_time::text AS end_time,
           s.notes, u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name
      FROM occ
      JOIN schedules s ON s.id = occ.schedule_id
      JOIN "user" u ON u.id = occ.caregiver_id
     WHERE occ.client_id = ${clientId}
       AND occ.is_training IS NOT TRUE
     ORDER BY occ.occ_date, occ.start_time`))
}

/** Days deliberately NOT billed: reason-coded cancellations of the client's visits in [from, to]. */
export async function cancelledBillingDays(q: Q, companyId: string, clientId: string, from: string, to: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT to_char(se.exception_date, 'YYYY-MM-DD') AS service_date, se.cancel_reason AS reason,
           se.override_notes AS notes, se.created_at AS reported_at,
           s.start_time::time::text AS scheduled_start, s.end_time::time::text AS scheduled_end,
           TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS caregiver_name,
           TRIM(COALESCE(cu.first_name, '') || ' ' || COALESCE(cu.last_name, '')) AS reported_by,
           cu.role AS reported_by_role
      FROM schedule_exceptions se
      JOIN schedules s ON s.id = se.schedule_id
      LEFT JOIN "user" u  ON u.id  = s.caregiver_id
      LEFT JOIN "user" cu ON cu.id = se.created_by
     WHERE s.company_id = ${companyId}
       AND se.exception_type = 'cancelled'
       AND se.cancel_reason IS NOT NULL
       AND COALESCE(se.override_client_id, s.client_id) = ${clientId}
       AND se.exception_date BETWEEN ${from}::date AND ${to}::date
     ORDER BY se.exception_date, s.start_time`))
}

// ── Writing an invoice (inside the caller's transaction) ────────────────────────────────────

/** Lock the client row, so two "Create" clicks cannot both pass the "already invoiced for this period" check. */
export async function lockClientForBilling(tx: Q, companyId: string, clientId: string): Promise<void> {
  await tx.execute(sql`SELECT id FROM clients WHERE id = ${clientId} AND company_id = ${companyId} FOR UPDATE`)
}

/** Move the client's billed_through to the period's end: 'set' writes it, 'greatest' only moves it forward. */
export async function advanceBilledThrough(tx: Q, companyId: string, clientId: string, periodEnd: string, mode: 'set' | 'greatest'): Promise<void> {
  if (mode === 'set') {
    await tx.execute(sql`UPDATE clients SET billed_through = ${periodEnd}::date WHERE id = ${clientId} AND company_id = ${companyId}`)
  } else {
    await tx.execute(sql`UPDATE clients SET billed_through = GREATEST(COALESCE(billed_through, ${periodEnd}::date), ${periodEnd}::date) WHERE id = ${clientId} AND company_id = ${companyId}`)
  }
}

// ── Payments: the ledger is invoice_payments ───────────────────────────────────────────────

/** Lock one of the company's invoices and read its money (null when there is no such invoice). */
export async function lockInvoiceMoney(tx: Q, companyId: string, invoiceId: string): Promise<{ total: string; amountPaid: string; amountAdjusted: string } | null> {
  return camelFirst(await tx.execute(sql`
    SELECT total, COALESCE(amount_paid, 0) AS amount_paid, COALESCE(amount_adjusted, 0) AS amount_adjusted
      FROM invoices WHERE id = ${invoiceId} AND company_id = ${companyId} FOR UPDATE`)) ?? null
}

/** Recompute amount_paid and the status from the payments that exist (inside the caller's tx). */
export async function rollUpInvoicePayments(tx: Q, companyId: string, invoiceId: string, paymentDate: string | null): Promise<void> {
  await tx.execute(sql`
    UPDATE invoices i SET
      amount_paid = p.paid,
      payment_status = CASE WHEN p.paid + COALESCE(i.amount_adjusted, 0) >= i.total THEN 'paid'
                            WHEN p.paid > 0 THEN 'partial' ELSE 'pending' END,
      payment_date = CASE WHEN p.paid + COALESCE(i.amount_adjusted, 0) >= i.total THEN COALESCE(${paymentDate}::date, i.payment_date, CURRENT_DATE) ELSE i.payment_date END,
      paid_at = CASE WHEN p.paid + COALESCE(i.amount_adjusted, 0) >= i.total THEN COALESCE(i.paid_at, NOW()) ELSE NULL END,
      updated_at = NOW()
    FROM (SELECT COALESCE(SUM(amount), 0)::numeric AS paid FROM invoice_payments WHERE invoice_id = ${invoiceId} AND company_id = ${companyId}) p
    WHERE i.id = ${invoiceId} AND i.company_id = ${companyId}`)
}
