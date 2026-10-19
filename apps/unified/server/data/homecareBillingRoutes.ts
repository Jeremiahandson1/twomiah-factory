// Home care's billing routes' SQL: visit invoices, payments and adjustments, payer rates, exports, claims, EDI and
// payer payments. Moved from templates/crm-homecare/backend/src/routes/{billing,claims,payments,authorizations}.ts
// (raw SQL lives in server/data/, RULEBOOK §2). Every query is the company's; every read returns camelCase. The invoice
// and claims engines' own SQL is in homecareBilling.ts and homecareClaims.ts.
import { sql, type SQL } from 'drizzle-orm'
import { camelRows, camelFirst } from '@twomiah/tenant-backend'
import { occurrencesCte, type Q } from './homecareCore.ts'
import { billedInRangeSql } from './homecareBilling.ts'

const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const ymdOrNull = (v: unknown) => (isYmd(v) ? v : null)

// ══ Invoices ═════════════════════════════════════════════════════════════════════════════════════

export interface InvoiceFilter { paymentStatus?: string | null; clientId?: string | null; startDate?: string | null; endDate?: string | null }

const invoiceWhere = (companyId: string, f: InvoiceFilter): SQL => {
  const ps = f.paymentStatus || null, cl = f.clientId || null, s = ymdOrNull(f.startDate), e = ymdOrNull(f.endDate)
  return sql`
    WHERE i.company_id = ${companyId}
      AND (${ps}::text IS NULL OR i.payment_status = ${ps}::text)
      AND (${cl}::text IS NULL OR i.client_id = ${cl}::text)
      AND (${s}::date IS NULL OR i.billing_period_start >= ${s}::date)
      AND (${e}::date IS NULL OR i.billing_period_start <= ${e}::date)`
}

/** A page of the company's visit invoices, newest first, with the client, payer and billed hours; and the total count. */
export async function visitInvoicePage(q: Q, companyId: string, f: InvoiceFilter, limit: number, offset: number): Promise<{ rows: any[]; total: number }> {
  const where = invoiceWhere(companyId, f)
  const rows = camelRows(await q.execute(sql`
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
     LIMIT ${limit} OFFSET ${offset}`))
  const n = camelFirst(await q.execute(sql`SELECT COUNT(*)::int AS n FROM invoices i ${where}`))
  return { rows, total: Number(n?.n) || 0 }
}

/**
 * The Billing page's headline figures over EVERY invoice of the company (the page summed its first page of 200, so an
 * agency with more had its outstanding, aging and drafts short). The page's own rules:
 *   · released: sent, or paid in part or in full; a draft is anything else;
 *   · balance: total − paid − adjusted; outstanding is the released invoices' positive balances;
 *   · aging: a released invoice with a balance, by days past its due date on the agency's day `today` (the page used the
 *     browser's clock); one with no due date counts from the day it was sent (the page put it over 90 days, measuring
 *     from 1970).
 */
export async function visitInvoiceTotals(q: Q, companyId: string, today: string): Promise<{
  outstanding: number; draftCount: number; draftTotal: number
  aging: { current: number; thirtyDays: number; sixtyDays: number; ninetyDays: number; over90: number }
}> {
  const r = camelFirst(await q.execute(sql`
    WITH inv AS (
      SELECT (i.sent_at IS NOT NULL OR i.payment_status IN ('paid', 'partial')) AS released,
             i.total::numeric AS total,
             i.total::numeric - COALESCE(i.amount_paid, 0) - COALESCE(i.amount_adjusted, 0) AS balance,
             ${today}::date - COALESCE(i.payment_due_date, i.sent_at::date, ${today}::date) AS days_over
        FROM invoices i
       WHERE i.company_id = ${companyId}
    )
    SELECT COALESCE(SUM(GREATEST(balance, 0)) FILTER (WHERE released), 0) AS outstanding,
           COUNT(*) FILTER (WHERE NOT released)::int AS draft_count,
           COALESCE(SUM(total) FILTER (WHERE NOT released), 0) AS draft_total,
           COALESCE(SUM(balance) FILTER (WHERE released AND balance > 0.005 AND days_over <= 0), 0) AS current,
           COALESCE(SUM(balance) FILTER (WHERE released AND balance > 0.005 AND days_over BETWEEN 1 AND 30), 0) AS thirty_days,
           COALESCE(SUM(balance) FILTER (WHERE released AND balance > 0.005 AND days_over BETWEEN 31 AND 60), 0) AS sixty_days,
           COALESCE(SUM(balance) FILTER (WHERE released AND balance > 0.005 AND days_over BETWEEN 61 AND 90), 0) AS ninety_days,
           COALESCE(SUM(balance) FILTER (WHERE released AND balance > 0.005 AND days_over > 90), 0) AS over90
      FROM inv`))
  const n = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100
  return {
    outstanding: n(r?.outstanding), draftCount: Number(r?.draftCount) || 0, draftTotal: n(r?.draftTotal),
    aging: { current: n(r?.current), thirtyDays: n(r?.thirtyDays), sixtyDays: n(r?.sixtyDays), ninetyDays: n(r?.ninetyDays), over90: n(r?.over90) },
  }
}

/** Every active client's billing cadence and where their billing stands. */
export async function billingScheduleRows(q: Q, companyId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT c.id, c.first_name, c.last_name, c.is_private_pay, c.billing_frequency_weeks,
           to_char(c.billed_through, 'YYYY-MM-DD') AS billed_through, rs.name AS payer_name
      FROM clients c
      LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id
     WHERE c.company_id = ${companyId} AND c.is_active = true
     ORDER BY (c.billing_frequency_weeks IS NULL), c.last_name, c.first_name`))
}

/** Clients who have something to bill in a period: a completed punch (on the agency's clock `tz`) or a scheduled occurrence. */
export async function clientsWithBillableActivity(q: Q, companyId: string, start: string, end: string, tz: string,
  filter: { clientFilter?: string; referralSourceId?: string | null; clientIds?: string[] | null }): Promise<any[]> {
  const ids = Array.isArray(filter.clientIds) && filter.clientIds.length ? filter.clientIds.map(String).join(',') : null
  const payer = filter.referralSourceId || null
  return camelRows(await q.execute(sql`
    WITH ${occurrencesCte(companyId, start, end, 'occ')},
    active AS (
      SELECT client_id FROM occ
      UNION
      SELECT te.client_id FROM time_entries te
       WHERE te.company_id = ${companyId}
         AND te.is_complete = true
         AND ((te.start_time AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date BETWEEN ${start}::date AND ${end}::date
    )
    SELECT c.id, c.first_name, c.last_name
      FROM clients c
     WHERE c.company_id = ${companyId}
       AND c.is_active = true
       AND c.id IN (SELECT client_id FROM active)
       AND (${filter.clientFilter === 'insurance'} = false OR (c.referred_by_id IS NOT NULL AND c.is_private_pay IS NOT TRUE))
       AND (${filter.clientFilter === 'private'} = false OR (c.referred_by_id IS NULL OR c.is_private_pay = TRUE))
       AND (${payer}::text IS NULL OR c.referred_by_id = ${payer}::text)
       AND (${ids}::text IS NULL OR c.id = ANY(string_to_array(${ids}::text, ',')))
     ORDER BY c.last_name, c.first_name`))
}

/** The client's scheduled (non-cancelled, non-training) visits in [from, to], for picking visits to invoice. */
export async function pickableScheduledVisits(q: Q, companyId: string, clientId: string, from: string, to: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    WITH ${occurrencesCte(companyId, from, to, 'o')}
    SELECT to_char(o.occ_date, 'YYYY-MM-DD') AS visit_date, o.start_time::text AS start_time, o.end_time::text AS end_time,
           o.minutes, o.caregiver_id, o.schedule_id, u.first_name || ' ' || u.last_name AS caregiver_name
      FROM o LEFT JOIN "user" u ON u.id = o.caregiver_id
     WHERE o.client_id = ${clientId}
       AND o.is_training IS NOT TRUE -- a training shift is paid, never billed
     ORDER BY o.occ_date, o.start_time`))
}

/** The invoice lines that already bill one of the client's visits in [from, to] (by day, scheduled start, caregiver). */
export async function billedVisitLines(q: Q, companyId: string, clientId: string, from: string, to: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT i.invoice_number, to_char(ili.service_date, 'YYYY-MM-DD') AS visit_date, ili.start_time::text AS start_time, ili.caregiver_id
      FROM invoice_line_items ili JOIN invoices i ON i.id = ili.invoice_id
     WHERE i.company_id = ${companyId} AND i.client_id = ${clientId}
       AND ili.service_date BETWEEN ${from}::date AND ${to}::date AND ili.start_time IS NOT NULL`))
}

/** The client's invoices whose billing period overlaps [from, to]. */
export async function invoicePeriodsOverlapping(q: Q, companyId: string, clientId: string, from: string, to: string): Promise<{ invoiceNumber: string; s: string; e: string }[]> {
  return camelRows(await q.execute(sql`
    SELECT invoice_number, to_char(billing_period_start, 'YYYY-MM-DD') AS s, to_char(billing_period_end, 'YYYY-MM-DD') AS e
      FROM invoices WHERE company_id = ${companyId} AND client_id = ${clientId}
       AND billing_period_start <= ${to}::date AND billing_period_end >= ${from}::date`))
}

/** The per-visit minutes of the client's active homemaking (IADL) care tasks. */
export async function homemakingMinutes(q: Q, companyId: string, clientId: string): Promise<number> {
  const r = camelFirst(await q.execute(sql`
    SELECT COALESCE(SUM(allotted_minutes), 0)::int AS m FROM client_task_templates
     WHERE company_id = ${companyId} AND client_id = ${clientId} AND is_active = true AND category = 'iadl'`))
  return Number(r?.m || 0)
}

/** One invoice with its client's name, address and payer, or null. */
export async function visitInvoiceDetail(q: Q, companyId: string, id: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    SELECT i.*, to_char(i.billing_period_start, 'YYYY-MM-DD') AS billing_period_start,
           to_char(i.billing_period_end, 'YYYY-MM-DD') AS billing_period_end,
           to_char(i.payment_due_date, 'YYYY-MM-DD') AS payment_due_date,
           c.first_name, c.last_name, c.referred_by_id AS referral_source_id, c.care_type_id, c.is_private_pay,
           c.email, c.phone, c.address, c.city, c.state, c.zip,
           rs.name AS referral_source_name
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      LEFT JOIN referral_sources rs ON i.referral_source_id = rs.id
     WHERE i.id = ${id} AND i.company_id = ${companyId}`)) ?? null
}

/** An invoice's lines with the caregiver's name and each visit's own care note (matched on client, day, start, caregiver). */
export async function visitInvoiceLines(q: Q, companyId: string, invoiceId: string, clientId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT ili.*, u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name,
           to_char(COALESCE(ili.service_date, te.start_time::date), 'YYYY-MM-DD') AS service_date,
           ili.start_time::text AS start_time, ili.end_time::text AS end_time,
           vd.note AS visit_note, vd.tasks AS visit_tasks
      FROM invoice_line_items ili
      JOIN invoices i ON i.id = ili.invoice_id
      LEFT JOIN "user" u ON ili.caregiver_id = u.id
      LEFT JOIN time_entries te ON ili.time_entry_id = te.id
      LEFT JOIN visit_documentation vd ON vd.company_id = i.company_id AND vd.client_id = ${clientId} AND vd.visit_date = ili.service_date
            AND vd.start_time = ili.start_time AND vd.caregiver_id = ili.caregiver_id
     WHERE ili.invoice_id = ${invoiceId} AND i.company_id = ${companyId}
     ORDER BY COALESCE(ili.service_date, te.start_time::date), ili.start_time NULLS LAST, u.last_name`))
}

/** An invoice's period, for deleting it (null when there is no such invoice). */
export async function invoicePeriodOf(q: Q, companyId: string, id: string): Promise<{ id: string; invoiceNumber: string; clientId: string; s: string; e: string } | null> {
  return camelFirst(await q.execute(sql`
    SELECT id, invoice_number, client_id, to_char(billing_period_start, 'YYYY-MM-DD') AS s, to_char(billing_period_end, 'YYYY-MM-DD') AS e
      FROM invoices WHERE id = ${id} AND company_id = ${companyId}`)) ?? null
}

/**
 * Delete an invoice and its dependent rows (inside the caller's transaction). When it was the client's latest billed
 * period, billed_through steps back to before it, so "Create Due Invoices" bills that period again.
 */
export async function deleteVisitInvoice(tx: Q, companyId: string, inv: { id: string; clientId: string; s: string; e: string }): Promise<void> {
  await tx.execute(sql`DELETE FROM invoice_payments WHERE invoice_id = ${inv.id} AND company_id = ${companyId}`)
  await tx.execute(sql`DELETE FROM invoice_adjustments WHERE invoice_id = ${inv.id} AND company_id = ${companyId}`)
  await tx.execute(sql`DELETE FROM invoice_line_items WHERE invoice_id = ${inv.id} AND company_id = ${companyId}`)
  await tx.execute(sql`UPDATE claims SET invoice_id = NULL WHERE invoice_id = ${inv.id} AND company_id = ${companyId}`)
  await tx.execute(sql`DELETE FROM invoices WHERE id = ${inv.id} AND company_id = ${companyId}`)
  await tx.execute(sql`
    UPDATE clients SET billed_through = ${inv.s}::date - 1
     WHERE id = ${inv.clientId} AND company_id = ${companyId} AND billed_through = ${inv.e}::date`)
}

/** What a line-item edit needs to know about the invoice (null when there is none). */
export async function invoiceForLineEdit(q: Q, companyId: string, id: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    SELECT i.id, i.client_id, i.payment_status, i.amount_paid, i.tax,
           to_char(i.billing_period_start, 'YYYY-MM-DD') AS s, to_char(i.billing_period_end, 'YYYY-MM-DD') AS e
      FROM invoices i WHERE i.id = ${id} AND i.company_id = ${companyId}`)) ?? null
}

/** Lock the invoice row inside the caller's transaction and read whether money is on it. */
export async function lockInvoicePaymentState(tx: Q, companyId: string, id: string): Promise<{ paymentStatus: string; amountPaid: string | null } | null> {
  return camelFirst(await tx.execute(sql`
    SELECT payment_status, amount_paid FROM invoices WHERE id = ${id} AND company_id = ${companyId} FOR UPDATE`)) ?? null
}

/** An invoice's lines in service order (after an edit). */
export async function invoiceLinesInOrder(q: Q, companyId: string, invoiceId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT ili.*, to_char(ili.service_date, 'YYYY-MM-DD') AS service_date FROM invoice_line_items ili
     WHERE ili.invoice_id = ${invoiceId} AND ili.company_id = ${companyId} ORDER BY ili.service_date NULLS LAST, ili.created_at`))
}

/** Release a draft: stamp sent_at once. Null when there is no such invoice. */
export async function releaseVisitInvoice(q: Q, companyId: string, id: string): Promise<{ id: string; sentAt: Date } | null> {
  return camelFirst(await q.execute(sql`
    UPDATE invoices SET sent_at = COALESCE(sent_at, NOW()), updated_at = NOW() WHERE id = ${id} AND company_id = ${companyId}
    RETURNING id, sent_at`)) ?? null
}

/** Append a line to an invoice's notes; `sent` 'clear' returns it to draft, 'stamp' releases it. */
export async function appendInvoiceNote(q: Q, companyId: string, id: string, line: string, sent: 'clear' | 'stamp' | 'keep'): Promise<void> {
  const sentSql = sent === 'clear' ? sql`sent_at = NULL,` : sent === 'stamp' ? sql`sent_at = COALESCE(sent_at, NOW()),` : sql``
  await q.execute(sql`
    UPDATE invoices SET ${sentSql} notes = COALESCE(notes, '') || ${line}, updated_at = NOW()
     WHERE id = ${id} AND company_id = ${companyId}`)
}

/** An invoice with its client's name and the address its email goes to, or null. */
export async function invoiceForEmail(q: Q, companyId: string, id: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    SELECT i.*, to_char(i.payment_due_date, 'YYYY-MM-DD') AS due_text,
           c.first_name, c.last_name, COALESCE(c.portal_email, c.email) AS client_email
      FROM invoices i JOIN clients c ON i.client_id = c.id WHERE i.id = ${id} AND i.company_id = ${companyId}`)) ?? null
}

/** An invoice's lines as its email lists them. */
export async function invoiceEmailLines(q: Q, companyId: string, invoiceId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT to_char(service_date, 'YYYY-MM-DD') AS service_date, description, hours, rate, rate_type, amount
      FROM invoice_line_items WHERE invoice_id = ${invoiceId} AND company_id = ${companyId} ORDER BY service_date NULLS LAST, created_at`))
}

// ══ Payments and adjustments ═════════════════════════════════════════════════════════════════════

/** The company's invoice payments, newest first, filtered by invoice and payment dates. */
export async function invoicePaymentRows(q: Q, companyId: string, f: { invoiceId?: string | null; startDate?: string | null; endDate?: string | null }): Promise<any[]> {
  const inv = f.invoiceId || null, s = ymdOrNull(f.startDate), e = ymdOrNull(f.endDate)
  return camelRows(await q.execute(sql`
    SELECT ip.*, to_char(ip.payment_date, 'YYYY-MM-DD') AS payment_date, ip.payment_method AS method,
           ip.reference_number AS reference, i.invoice_number, i.seq_number,
           c.first_name || ' ' || c.last_name AS client_name
      FROM invoice_payments ip
      JOIN invoices i ON ip.invoice_id = i.id
      JOIN clients c ON i.client_id = c.id
     WHERE ip.company_id = ${companyId}
       AND (${inv}::text IS NULL OR ip.invoice_id = ${inv}::text)
       AND (${s}::date IS NULL OR ip.payment_date >= ${s}::date)
       AND (${e}::date IS NULL OR ip.payment_date <= ${e}::date)
     ORDER BY ip.payment_date DESC NULLS LAST, ip.created_at DESC`))
}

/** Lock an invoice row inside the caller's transaction (a payment removed or an adjustment recorded against it). */
export async function lockInvoiceRow(tx: Q, companyId: string, invoiceId: string): Promise<boolean> {
  return camelRows(await tx.execute(sql`SELECT id FROM invoices WHERE id = ${invoiceId} AND company_id = ${companyId} FOR UPDATE`)).length > 0
}

/** A write-off or discount reduces what is owed; once paid + adjusted covers the total, the invoice is paid. */
export async function applyInvoiceWriteDown(tx: Q, companyId: string, invoiceId: string, amount: number): Promise<void> {
  await tx.execute(sql`
    UPDATE invoices SET amount_adjusted = COALESCE(amount_adjusted, 0) + ${amount},
           payment_status = CASE WHEN COALESCE(amount_paid, 0) + COALESCE(amount_adjusted, 0) + ${amount} >= total THEN 'paid' ELSE payment_status END,
           updated_at = NOW()
     WHERE id = ${invoiceId} AND company_id = ${companyId}`)
}

/** The company's invoice adjustments with the invoice and client, newest first. */
export async function invoiceAdjustmentRows(q: Q, companyId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT ia.*, i.invoice_number, i.seq_number, c.first_name || ' ' || c.last_name AS client_name
      FROM invoice_adjustments ia JOIN invoices i ON ia.invoice_id = i.id JOIN clients c ON i.client_id = c.id
     WHERE ia.company_id = ${companyId}
     ORDER BY ia.created_at DESC`))
}

// ══ Payer contract rates ═════════════════════════════════════════════════════════════════════════

/** Every payer rate with its payer, care type and how many active clients it prices. */
export async function payerRateRows(q: Q, companyId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT rsr.*, to_char(rsr.effective_date, 'YYYY-MM-DD') AS effective_date, to_char(rsr.end_date, 'YYYY-MM-DD') AS end_date,
           rs.name AS referral_source_name, ct.name AS care_type_name,
           (SELECT COUNT(*)::int FROM clients c
             WHERE c.company_id = rsr.company_id AND c.is_active = true AND c.is_private_pay IS NOT TRUE
               AND c.referred_by_id = rsr.referral_source_id
               AND (rsr.care_type_id IS NULL OR c.care_type_id = rsr.care_type_id)) AS client_count
      FROM referral_source_rates rsr
      LEFT JOIN referral_sources rs ON rsr.referral_source_id = rs.id
      LEFT JOIN care_types ct ON rsr.care_type_id = ct.id
     WHERE rsr.company_id = ${companyId}
     ORDER BY rs.name, ct.name`))
}

/**
 * Payer × care-type combinations with active clients and no rate in force on `today` — the invoice engine's own test
 * (referralSourceRateFor): a rate for the payer and the client's care type, or for any care type.
 */
export async function missingPayerRates(q: Q, companyId: string, today: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT rs.id AS payer_id, rs.name AS payer_name, ct.id AS care_type_id, COALESCE(ct.name, 'No care type') AS care_type_name,
           COUNT(DISTINCT c.id)::int AS affected_clients
      FROM clients c
      JOIN referral_sources rs ON c.referred_by_id = rs.id
      LEFT JOIN care_types ct ON c.care_type_id = ct.id
     WHERE c.company_id = ${companyId} AND c.is_active = true AND c.is_private_pay IS NOT TRUE
       AND NOT EXISTS (
         SELECT 1 FROM referral_source_rates rsr
          WHERE rsr.company_id = ${companyId}
            AND rsr.referral_source_id = rs.id
            AND (rsr.care_type_id IS NULL OR rsr.care_type_id = c.care_type_id)
            AND (rsr.is_active = true OR rsr.is_active IS NULL OR rsr.end_date IS NOT NULL)
            AND (rsr.effective_date IS NULL OR rsr.effective_date <= ${today}::date)
            AND (rsr.end_date IS NULL OR rsr.end_date >= ${today}::date))
     GROUP BY rs.id, rs.name, ct.id, ct.name
     ORDER BY rs.name, ct.name`))
}

/** Retire the payer's (and care type's) rate in force, ending it on `effective` — inside the caller's transaction. */
export async function retirePayerRate(tx: Q, companyId: string, referralSourceId: string, careTypeId: string | null, effective: string): Promise<void> {
  await tx.execute(sql`
    UPDATE referral_source_rates SET is_active = false, end_date = ${effective}::date, updated_at = NOW()
     WHERE company_id = ${companyId}
       AND referral_source_id = ${referralSourceId}
       AND (care_type_id = ${careTypeId}::text OR (care_type_id IS NULL AND ${careTypeId}::text IS NULL))
       AND (is_active = true OR is_active IS NULL)`)
}

/** Change a rate's amount, unit, active flag or end date (each only when given). Null when there is no such rate. */
export async function updatePayerRate(q: Q, companyId: string, id: string, set: { rateAmount: number | null; rateType: string | null; isActive: boolean | null; endDate: string | null }): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    UPDATE referral_source_rates SET
      rate_amount = COALESCE(${set.rateAmount}::numeric, rate_amount),
      rate_type = COALESCE(${set.rateType}::text, rate_type),
      is_active = COALESCE(${set.isActive}::boolean, is_active),
      end_date = CASE WHEN ${set.endDate !== null} THEN ${set.endDate}::date ELSE end_date END,
      updated_at = NOW()
    WHERE id = ${id} AND company_id = ${companyId} RETURNING *`)) ?? null
}

// ══ Exports and the summary ══════════════════════════════════════════════════════════════════════

/** Every invoice as the invoices CSV lists it. */
export async function invoiceCsvRows(q: Q, companyId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT i.seq_number, i.invoice_number, to_char(i.billing_period_start, 'YYYY-MM-DD') AS s, to_char(i.billing_period_end, 'YYYY-MM-DD') AS e,
           c.first_name || ' ' || c.last_name AS client_name, COALESCE(rs.name, 'Private Pay') AS payer,
           i.total, COALESCE(i.amount_paid, 0) AS amount_paid,
           i.total - COALESCE(i.amount_paid, 0) - COALESCE(i.amount_adjusted, 0) AS balance,
           i.payment_status, to_char(i.payment_due_date, 'YYYY-MM-DD') AS due,
           CASE WHEN i.sent_at IS NULL THEN 'draft' ELSE 'sent' END AS sent, to_char(i.created_at, 'YYYY-MM-DD') AS created
      FROM invoices i JOIN clients c ON i.client_id = c.id LEFT JOIN referral_sources rs ON i.referral_source_id = rs.id
     WHERE i.company_id = ${companyId}
     ORDER BY i.created_at DESC`))
}

/** The last 30 days of completed visits, in the state-EVV CSV layout's order. */
export async function evvExportRows(q: Q, companyId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
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
      JOIN "user" u ON te.caregiver_id = u.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
     WHERE te.company_id = ${companyId} AND te.start_time >= NOW() - INTERVAL '30 days' AND te.is_complete = true
     ORDER BY te.start_time DESC`))
}

/**
 * Billed / collected / outstanding in [start, end], by payer and by caregiver — the money reports' one rule
 * (homecareBilling.ts): released invoices, dated by their first day of service, counted whole.
 */
export async function billingSummaryFigures(q: Q, companyId: string, start: string, end: string) {
  const where = sql`i.company_id = ${companyId} AND ${billedInRangeSql(start, end)}`
  const summary = camelFirst(await q.execute(sql`
    SELECT COUNT(*)::int AS invoice_count, COALESCE(SUM(total), 0) AS total_billed, COALESCE(SUM(amount_paid), 0) AS total_collected,
           COALESCE(SUM(total - COALESCE(amount_paid, 0) - COALESCE(amount_adjusted, 0)), 0) AS total_outstanding
      FROM invoices i WHERE ${where}`))
  const byPayer = camelRows(await q.execute(sql`
    SELECT COALESCE(rs.name, 'Private Pay') AS payer, COUNT(*)::int AS invoice_count,
           COALESCE(SUM(i.total), 0) AS total_billed, COALESCE(SUM(i.amount_paid), 0) AS total_collected
      FROM invoices i LEFT JOIN referral_sources rs ON i.referral_source_id = rs.id
     WHERE ${where} GROUP BY rs.name ORDER BY total_billed DESC`))
  const byCaregiver = camelRows(await q.execute(sql`
    SELECT u.first_name || ' ' || u.last_name AS caregiver_name, COALESCE(SUM(ili.hours), 0) AS total_hours,
           COALESCE(SUM(ili.amount), 0) AS total_billed
      FROM invoice_line_items ili JOIN invoices i ON ili.invoice_id = i.id LEFT JOIN "user" u ON ili.caregiver_id = u.id
     WHERE ${where} GROUP BY u.first_name, u.last_name ORDER BY total_hours DESC`))
  return { summary, byPayer, byCaregiver }
}

// ══ Claims ═══════════════════════════════════════════════════════════════════════════════════════

/** CVHC's column names for a claim, alongside the table's own (the screens read either). */
const CVHC_ALIASES = sql.raw(`
  cl.billed_amount AS charge_amount, cl.billed_amount AS total_amount, cl.service_code AS procedure_code,
  cl.units_billed AS units, cl.submission_date AS submitted_date,
  to_char(cl.service_date, 'YYYY-MM-DD') AS service_date,
  to_char(cl.service_date_from, 'YYYY-MM-DD') AS service_date_from,
  to_char(cl.service_date_to, 'YYYY-MM-DD') AS service_date_to`)

/** The company's claims, newest first (500 at most), filtered by status, payer and service dates. */
export async function claimRows(q: Q, companyId: string, f: { status?: string | null; payerId?: string | null; startDate?: string | null; endDate?: string | null }): Promise<any[]> {
  const st = f.status || null, payer = f.payerId || null, s = ymdOrNull(f.startDate), e = ymdOrNull(f.endDate)
  return camelRows(await q.execute(sql`
    SELECT cl.*, ${CVHC_ALIASES},
           rs.name AS payer_name, rs.payer_type AS rs_payer_type,
           c.first_name AS client_first_name, c.last_name AS client_last_name, c.medicaid_id,
           u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name,
           i.invoice_number, i.seq_number AS invoice_seq_number, a.auth_number, eb.batch_number,
           CASE WHEN cl.submission_date IS NULL THEN NULL ELSE (CURRENT_DATE - cl.submission_date) END AS days_since_submission
      FROM claims cl
      LEFT JOIN referral_sources rs ON cl.payer_id = rs.id
      LEFT JOIN clients c ON cl.client_id = c.id
      LEFT JOIN "user" u ON cl.caregiver_id = u.id
      LEFT JOIN invoices i ON cl.invoice_id = i.id
      LEFT JOIN authorizations a ON cl.authorization_id = a.id
      LEFT JOIN edi_batches eb ON cl.edi_batch_id = eb.id
     WHERE cl.company_id = ${companyId}
       AND (${st}::text IS NULL OR cl.status = ${st}::text)
       AND (${payer}::text IS NULL OR cl.payer_id = ${payer}::text)
       AND (${s}::date IS NULL OR COALESCE(cl.service_date, cl.service_date_from) >= ${s}::date)
       AND (${e}::date IS NULL OR COALESCE(cl.service_date, cl.service_date_to) <= ${e}::date)
     ORDER BY cl.created_at DESC
     LIMIT 500`))
}

/** The claims dashboard: status rollup, by payer, aging of what is out, A/R, paid this month, denied, totals. */
export async function claimsSummaryFigures(q: Q, companyId: string) {
  const byStatus = camelRows(await q.execute(sql`
    SELECT status, COUNT(*)::int AS count, COALESCE(SUM(billed_amount), 0) AS total_charged, COALESCE(SUM(paid_amount), 0) AS total_paid
      FROM claims WHERE company_id = ${companyId} GROUP BY status`))
  const byPayer = camelRows(await q.execute(sql`
    SELECT rs.name AS payer_name, COUNT(*)::int AS claim_count,
           COALESCE(SUM(cl.billed_amount), 0) AS total_charged, COALESCE(SUM(cl.paid_amount), 0) AS total_paid,
           COALESCE(SUM(CASE WHEN cl.status = 'denied' THEN cl.billed_amount ELSE 0 END), 0) AS total_denied
      FROM claims cl JOIN referral_sources rs ON cl.payer_id = rs.id
     WHERE cl.company_id = ${companyId}
     GROUP BY rs.id, rs.name ORDER BY total_charged DESC`))
  // Named in camelCase here: the template's under_30 / days_30_60 … would camelise to under30 / days3060.
  const aging = camelFirst(await q.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN submission_date > CURRENT_DATE - 30 THEN billed_amount ELSE 0 END), 0) AS "under30",
      COALESCE(SUM(CASE WHEN submission_date BETWEEN CURRENT_DATE - 60 AND CURRENT_DATE - 30 THEN billed_amount ELSE 0 END), 0) AS "days30To60",
      COALESCE(SUM(CASE WHEN submission_date BETWEEN CURRENT_DATE - 90 AND CURRENT_DATE - 61 THEN billed_amount ELSE 0 END), 0) AS "days60To90",
      COALESCE(SUM(CASE WHEN submission_date < CURRENT_DATE - 90 THEN billed_amount ELSE 0 END), 0) AS "over90"
      FROM claims WHERE company_id = ${companyId} AND status IN ('submitted', 'accepted')`))
  const ar = camelFirst(await q.execute(sql`
    SELECT COALESCE(SUM(billed_amount - COALESCE(paid_amount, 0)), 0) AS total_ar
      FROM claims WHERE company_id = ${companyId} AND status IN ('draft', 'pending', 'submitted', 'accepted')`))
  const paidThisMonth = camelFirst(await q.execute(sql`
    SELECT COALESCE(SUM(paid_amount), 0) AS amount, COUNT(*)::int AS count
      FROM claims WHERE company_id = ${companyId} AND status = 'paid' AND paid_date >= DATE_TRUNC('month', CURRENT_DATE)`))
  const denied = camelFirst(await q.execute(sql`
    SELECT COUNT(*)::int AS count, COALESCE(SUM(billed_amount), 0) AS total FROM claims WHERE company_id = ${companyId} AND status = 'denied'`))
  const totals = camelFirst(await q.execute(sql`
    SELECT COUNT(*)::int AS n, COALESCE(SUM(billed_amount), 0) AS billed, COALESCE(SUM(paid_amount), 0) AS paid
      FROM claims WHERE company_id = ${companyId}`))
  return { byStatus, byPayer, aging, ar, paidThisMonth, denied, totals }
}

/** Denied claims with the denial code's description and its usual fix. */
export async function denialQueueRows(q: Q, companyId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT cl.*, ${CVHC_ALIASES},
           rs.name AS payer_name, c.first_name AS client_first_name, c.last_name AS client_last_name, c.medicaid_id,
           u.first_name AS caregiver_first_name, u.last_name AS caregiver_last_name, a.auth_number,
           to_char(ev.service_date, 'YYYY-MM-DD') AS evv_service_date, ev.actual_start, ev.actual_end,
           dcl.description AS denial_description, dcl.remediation AS common_fix
      FROM claims cl
      LEFT JOIN referral_sources rs ON cl.payer_id = rs.id
      LEFT JOIN clients c ON cl.client_id = c.id
      LEFT JOIN "user" u ON cl.caregiver_id = u.id
      LEFT JOIN authorizations a ON cl.authorization_id = a.id
      LEFT JOIN evv_visits ev ON cl.evv_visit_id = ev.id
      LEFT JOIN denial_code_lookup dcl ON cl.denial_code = dcl.code AND dcl.company_id = cl.company_id
     WHERE cl.company_id = ${companyId} AND cl.status = 'denied'
     ORDER BY cl.updated_at DESC`))
}

/**
 * Resubmit a denied claim (inside the caller's transaction): a pending copy under `newId`, the original voided. Null
 * when there is no denied claim with that id. Copied in SQL, so dates and amounts move as the database holds them.
 */
export async function resubmitDeniedClaim(tx: Q, companyId: string, id: string, newId: string, userId: string | null): Promise<{ fresh: any; claimNumber: string | null } | null> {
  const orig = camelFirst(await tx.execute(sql`
    SELECT id, claim_number FROM claims WHERE id = ${id} AND company_id = ${companyId} AND status = 'denied' FOR UPDATE`))
  if (!orig) return null
  const fresh = camelFirst(await tx.execute(sql`
    INSERT INTO claims (
      id, company_id, evv_visit_id, invoice_id, client_id, caregiver_id, authorization_id, payer_id, payer_type, claim_number,
      service_code, modifier, diagnosis_code, service_date, service_date_from, service_date_to, place_of_service,
      units_billed, billed_amount, submission_method, status, resubmitted_from, created_by_id
    )
    SELECT ${newId}, company_id, evv_visit_id, invoice_id, client_id, caregiver_id, authorization_id, payer_id, payer_type,
           COALESCE(claim_number, 'CLM') || '-R', service_code, modifier, diagnosis_code, service_date,
           service_date_from, service_date_to, place_of_service, units_billed, billed_amount, submission_method,
           'pending', id, ${userId}
      FROM claims WHERE id = ${id} AND company_id = ${companyId}
    RETURNING *`))
  await tx.execute(sql`UPDATE claims SET status = 'voided', voided_at = NOW(), voided_by = ${userId}, updated_at = NOW() WHERE id = ${id} AND company_id = ${companyId}`)
  return { fresh, claimNumber: orig.claimNumber ?? null }
}

/**
 * Set a claim's status with its dates: submitted/accepted/paid stamp today, paid sets the paid amount, denied the
 * denial code and reason; EOB notes when given. False when there is no such claim.
 */
export async function setClaimStatusRow(q: Q, companyId: string, claimId: string, s: {
  status: string; paidAmount: number | null; denialCode: string | null; denialReason: string | null; eobNotes: string | null
}): Promise<boolean> {
  return camelRows(await q.execute(sql`
    UPDATE claims SET
      status = ${s.status}::text,
      submission_date = CASE WHEN ${s.status}::text = 'submitted' THEN CURRENT_DATE ELSE submission_date END,
      accepted_date = CASE WHEN ${s.status}::text = 'accepted' THEN CURRENT_DATE ELSE accepted_date END,
      paid_date = CASE WHEN ${s.status}::text = 'paid' THEN CURRENT_DATE ELSE paid_date END,
      paid_amount = CASE WHEN ${s.status}::text = 'paid' AND ${s.paidAmount}::numeric IS NOT NULL THEN ${s.paidAmount}::numeric ELSE paid_amount END,
      denial_code = CASE WHEN ${s.status}::text = 'denied' AND ${s.denialCode}::text IS NOT NULL THEN ${s.denialCode}::text ELSE denial_code END,
      denial_reason = CASE WHEN ${s.status}::text = 'denied' AND ${s.denialReason}::text IS NOT NULL THEN ${s.denialReason}::text ELSE denial_reason END,
      eob_notes = COALESCE(${s.eobNotes}::text, eob_notes),
      updated_at = NOW()
    WHERE id = ${claimId} AND company_id = ${companyId} RETURNING id`)).length > 0
}

/** The selected claims with everything an export file prints. */
export async function claimsForExport(q: Q, companyId: string, ids: string[]): Promise<any[]> {
  return camelRows(await q.execute(sql`
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
      LEFT JOIN "user" u ON cl.caregiver_id = u.id
      LEFT JOIN caregiver_profiles cp ON cp.caregiver_id = u.id
      LEFT JOIN authorizations a ON cl.authorization_id = a.id
      LEFT JOIN evv_visits ev ON cl.evv_visit_id = ev.id
     WHERE cl.company_id = ${companyId} AND cl.id = ANY(string_to_array(${ids.join(',')}::text, ','))`))
}

/** Exported claims become submitted, by `method` (only those not already past pending). */
export async function markClaimsExported(q: Q, companyId: string, ids: string[], method: string): Promise<void> {
  await q.execute(sql`
    UPDATE claims SET submission_method = ${method}, status = 'submitted', submission_date = CURRENT_DATE, updated_at = NOW()
     WHERE company_id = ${companyId} AND id = ANY(string_to_array(${ids.join(',')}::text, ',')) AND status IN ('pending', 'draft', 'ready')`)
}

/** One claim with its payer, client, invoice, authorization and denial lookup, or null. */
export async function claimDetail(q: Q, companyId: string, id: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`
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
      LEFT JOIN "user" u ON cl.caregiver_id = u.id
      LEFT JOIN invoices i ON cl.invoice_id = i.id
      LEFT JOIN authorizations a ON cl.authorization_id = a.id
      LEFT JOIN denial_code_lookup dcl ON cl.denial_code = dcl.code AND dcl.company_id = cl.company_id
     WHERE cl.id = ${id} AND cl.company_id = ${companyId}`)) ?? null
}

/**
 * What a claim made from an invoice needs: its client, total, payer and the days its LINES cover (the claim's service
 * date is the first day served, not the billing period's start). Null when there is no such invoice.
 */
export async function invoiceForClaim(q: Q, companyId: string, invoiceId: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    SELECT i.id, i.client_id, i.total, to_char(i.billing_period_start, 'YYYY-MM-DD') AS s, to_char(i.billing_period_end, 'YYYY-MM-DD') AS e,
           COALESCE(i.referral_source_id, c.referred_by_id) AS payer_id, rs.payer_type,
           (SELECT COALESCE(SUM(hours), 0) FROM invoice_line_items WHERE invoice_id = i.id) AS hours,
           (SELECT to_char(MIN(service_date), 'YYYY-MM-DD') FROM invoice_line_items WHERE invoice_id = i.id) AS first_day,
           (SELECT to_char(MAX(service_date), 'YYYY-MM-DD') FROM invoice_line_items WHERE invoice_id = i.id) AS last_day
      FROM invoices i JOIN clients c ON i.client_id = c.id LEFT JOIN referral_sources rs ON rs.id = COALESCE(i.referral_source_id, c.referred_by_id)
     WHERE i.id = ${invoiceId} AND i.company_id = ${companyId}`)) ?? null
}

/** The office's hand edits to a claim: notes, EOB notes, check number (each only when given). Null when there is none. */
export async function editClaimNotes(q: Q, companyId: string, id: string, b: { notes: string | null; eobNotes: string | null; checkNumber: string | null }): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    UPDATE claims SET notes = COALESCE(${b.notes}::text, notes), eob_notes = COALESCE(${b.eobNotes}::text, eob_notes),
           check_number = COALESCE(${b.checkNumber}::text, check_number), updated_at = NOW()
     WHERE id = ${id} AND company_id = ${companyId} RETURNING *`)) ?? null
}

// ══ Authorizations ═══════════════════════════════════════════════════════════════════════════════

/** Counts for the Claims & EVV Engine's authorizations tab. */
export async function authorizationSummary(q: Q, companyId: string): Promise<any> {
  return camelFirst(await q.execute(sql`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'active')::int AS active,
           COUNT(*) FILTER (WHERE end_date < CURRENT_DATE)::int AS expired,
           COUNT(*) FILTER (WHERE status = 'active' AND end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30)::int AS expiring_soon,
           COUNT(*) FILTER (WHERE status = 'active' AND (authorized_units - used_units) <= low_units_alert_threshold)::int AS low_units,
           COUNT(*) FILTER (WHERE status = 'exhausted')::int AS exhausted
      FROM authorizations WHERE company_id = ${companyId}`))
}

// ══ Payer payments (check receipts matched to claims) ════════════════════════════════════════════

/** The first active payer whose name contains `word` (the check scanner's payer guess), or null. */
export async function payerNamed(q: Q, companyId: string, word: string): Promise<{ id: string; name: string; payerType: string | null } | null> {
  return camelFirst(await q.execute(sql`
    SELECT id, name, payer_type FROM referral_sources
     WHERE company_id = ${companyId} AND LOWER(name) LIKE ${'%' + word + '%'} AND is_active_payer = true
     LIMIT 1`)) ?? null
}

/** The payer's submitted or accepted claims, newest service first (20), for matching a check against. */
export async function openClaimsOfPayer(q: Q, companyId: string, payerId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT c.id, c.claim_number, c.billed_amount AS charge_amount, to_char(c.service_date, 'YYYY-MM-DD') AS service_date,
           cl.first_name AS client_first, cl.last_name AS client_last
      FROM claims c
      JOIN clients cl ON c.client_id = cl.id
     WHERE c.company_id = ${companyId} AND c.payer_id = ${payerId}
       AND c.status IN ('submitted', 'accepted')
     ORDER BY c.service_date DESC
     LIMIT 20`))
}

/** A claim paid by a matched check: paid amount and date, and an underpayment noted when it fell short. */
export async function markClaimPaid(q: Q, companyId: string, claimId: string, paid: number, paidDate: string, underpaymentNote: string | null): Promise<void> {
  await q.execute(sql`
    UPDATE claims SET
      status = 'paid', paid_amount = ${paid}, paid_date = ${paidDate}::date,
      notes = CASE WHEN ${underpaymentNote}::text IS NULL THEN notes ELSE COALESCE(notes, '') || ${underpaymentNote}::text END,
      updated_at = NOW()
    WHERE id = ${claimId} AND company_id = ${companyId}`)
}

/** The company's payer payments (100, newest first), filtered by reconciliation status, payer and dates. */
export async function payerPaymentRows(q: Q, companyId: string, f: { status?: string | null; payerId?: string | null; startDate?: string | null; endDate?: string | null }): Promise<any[]> {
  const st = f.status || null, payer = f.payerId || null, s = ymdOrNull(f.startDate), e = ymdOrNull(f.endDate)
  return camelRows(await q.execute(sql`
    SELECT p.*, to_char(p.payment_date, 'YYYY-MM-DD') AS payment_date, to_char(p.check_date, 'YYYY-MM-DD') AS check_date,
           rs.name AS payer_display_name,
           (SELECT COUNT(*)::int FROM payment_claim_matches WHERE payment_id = p.id) AS match_count
      FROM payments p
      LEFT JOIN referral_sources rs ON p.payer_id = rs.id
     WHERE p.company_id = ${companyId}
       AND (${st}::text IS NULL OR p.reconciliation_status = ${st}::text)
       AND (${payer}::text IS NULL OR p.payer_id = ${payer}::text)
       AND (${s}::date IS NULL OR p.payment_date >= ${s}::date)
       AND (${e}::date IS NULL OR p.payment_date <= ${e}::date)
     ORDER BY p.payment_date DESC LIMIT 100`))
}

/** One payer payment with its payer's name, or null. */
export async function payerPaymentDetail(q: Q, companyId: string, id: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    SELECT p.*, to_char(p.payment_date, 'YYYY-MM-DD') AS payment_date, to_char(p.check_date, 'YYYY-MM-DD') AS check_date,
           rs.name AS payer_display_name
      FROM payments p LEFT JOIN referral_sources rs ON p.payer_id = rs.id
     WHERE p.id = ${id} AND p.company_id = ${companyId}`)) ?? null
}

/** The claims a payer payment was matched to, in service order. */
export async function payerPaymentMatches(q: Q, companyId: string, paymentId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT pcm.*, c.claim_number, c.billed_amount AS charge_amount, to_char(c.service_date, 'YYYY-MM-DD') AS service_date,
           cl.first_name AS client_first, cl.last_name AS client_last
      FROM payment_claim_matches pcm
      JOIN claims c ON pcm.claim_id = c.id
      JOIN clients cl ON c.client_id = cl.id
     WHERE pcm.payment_id = ${paymentId} AND pcm.company_id = ${companyId}
     ORDER BY c.service_date`))
}

/** Payer payments received in [start, end]: totals and by payer. */
export async function reconciliationFigures(q: Q, companyId: string, start: string, end: string) {
  const summary = camelFirst(await q.execute(sql`
    SELECT
      COUNT(*)::int AS total_payments,
      COALESCE(SUM(check_amount), 0) AS total_received,
      COALESCE(SUM(total_matched), 0) AS total_matched,
      COALESCE(SUM(underpayment_amount), 0) AS total_underpayments,
      COUNT(CASE WHEN reconciliation_status = 'reconciled' THEN 1 END)::int AS reconciled_count,
      COUNT(CASE WHEN reconciliation_status = 'partial' THEN 1 END)::int AS partial_count,
      COUNT(CASE WHEN reconciliation_status = 'unreconciled' THEN 1 END)::int AS unreconciled_count
      FROM payments
     WHERE company_id = ${companyId} AND payment_date BETWEEN ${start}::date AND ${end}::date`))
  const byPayer = camelRows(await q.execute(sql`
    SELECT
      COALESCE(rs.name, p.payer_name) AS payer_name,
      COUNT(*)::int AS payment_count,
      COALESCE(SUM(p.check_amount), 0) AS total_received,
      COALESCE(SUM(p.total_matched), 0) AS total_matched
      FROM payments p
      LEFT JOIN referral_sources rs ON p.payer_id = rs.id
     WHERE p.company_id = ${companyId} AND p.payment_date BETWEEN ${start}::date AND ${end}::date
     GROUP BY COALESCE(rs.name, p.payer_name)
     ORDER BY total_received DESC`))
  return { summary, byPayer }
}
