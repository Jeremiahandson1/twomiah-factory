// The SQL of the long-term-care claim packet (core/ltc.ts): the invoice with its client, payer and agency, its service lines
// with the caregiver's name, and the invoices billed to long-term-care payers. Every read is the company's; each returns camelCase.
import { sql } from 'drizzle-orm'
import { camelFirst, camelRows } from '@twomiah/tenant-backend'
import type { Q } from './homecareCore.ts'

export const LTC_PAYER_TYPE = 'ltc_insurance'

/** The invoice, its client, the payer it is billed to and the agency, or null. */
export async function packetHeader(q: Q, companyId: string, invoiceId: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    SELECT i.id, i.invoice_number, i.seq_number, to_char(i.billing_period_start, 'YYYY-MM-DD') AS period_start, to_char(i.billing_period_end, 'YYYY-MM-DD') AS period_end,
           i.total, i.amount_paid, i.amount_adjusted, i.payment_status, i.sent_at, i.client_id,
           c.first_name AS client_first, c.last_name AS client_last, to_char(c.date_of_birth, 'YYYY-MM-DD') AS client_dob,
           c.address AS client_address, c.city AS client_city, c.state AS client_state, c.zip AS client_zip,
           rs.id AS payer_id, rs.name AS payer_name, rs.payer_type, rs.address AS payer_address, rs.city AS payer_city, rs.state AS payer_state, rs.zip AS payer_zip, rs.payer_id_number,
           co.name AS agency_name, co.address AS agency_address, co.city AS agency_city, co.state AS agency_state, co.zip AS agency_zip, co.phone AS agency_phone, co.email AS agency_email
      FROM invoices i
      JOIN clients c ON c.id = i.client_id AND c.company_id = ${companyId}
      JOIN company co ON co.id = i.company_id
      LEFT JOIN referral_sources rs ON rs.id = i.referral_source_id AND rs.company_id = ${companyId}
     WHERE i.id = ${invoiceId} AND i.company_id = ${companyId}`)) ?? null
}

/** The invoice's service lines, in date order, with the caregiver's name. */
export async function packetLines(q: Q, companyId: string, invoiceId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT to_char(l.service_date, 'YYYY-MM-DD') AS service_date, l.description, l.hours, l.rate, l.rate_type, l.amount,
           to_char(l.start_time, 'HH24:MI') AS start_time, to_char(l.end_time, 'HH24:MI') AS end_time, l.clocked_minutes, l.scheduled_minutes,
           u.first_name AS caregiver_first, u.last_name AS caregiver_last
      FROM invoice_line_items l LEFT JOIN "user" u ON u.id = l.caregiver_id AND u.company_id = ${companyId}
     WHERE l.invoice_id = ${invoiceId} AND l.company_id = ${companyId}
     ORDER BY l.service_date NULLS LAST, l.start_time NULLS LAST, l.created_at`))
}

/** Invoices billed to a long-term-care payer, newest first, and whether the client has a policy on file. */
export async function ltcInvoices(q: Q, companyId: string, limit = 200): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT i.id, COALESCE(i.seq_number::text, i.invoice_number) AS invoice_number, to_char(i.billing_period_start, 'YYYY-MM-DD') AS period_start,
           to_char(i.billing_period_end, 'YYYY-MM-DD') AS period_end, i.total, i.amount_paid, i.payment_status, i.sent_at, i.client_id,
           c.first_name, c.last_name, rs.name AS payer_name, (p.id IS NOT NULL) AS has_policy
      FROM invoices i
      JOIN referral_sources rs ON rs.id = i.referral_source_id AND rs.company_id = ${companyId} AND rs.payer_type = ${LTC_PAYER_TYPE}
      JOIN clients c ON c.id = i.client_id AND c.company_id = ${companyId}
      LEFT JOIN client_ltc_policy p ON p.client_id = i.client_id AND p.company_id = ${companyId}
     WHERE i.company_id = ${companyId}
     ORDER BY i.billing_period_end DESC, i.id
     LIMIT ${limit}`))
}
