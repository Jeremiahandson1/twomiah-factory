// What the money reports count for INVOICES — one rule for Reports (Overview, Revenue, P&L, client
// revenue by month, the PDF), the Revenue Forecast, the dashboard tiles and the Billing screen.
//
//   · BILLED = RELEASED invoices only. An invoice starts as a draft (sent_at NULL); it is released
//     when the office sends it, releases it to the portal, or records a payment on it
//     (invoiceEngine.releasedInvoiceSql — the same rule that decides what the family can see). A
//     draft is work in progress: it is neither billed nor owed. The Billing screen shows drafts as
//     their own figure.
//   · An invoice is DATED by its first day of service (the earliest service_date on its lines; the
//     billing period's start for an invoice with no dated line) and counts WHOLE in the range that
//     day falls in. Never prorated: a biweekly invoice is not 6/7ths billed. (Reports used to want
//     the whole billing period inside the range, so an invoice whose period ended tomorrow counted
//     nowhere, while P&L prorated by days.)
//   · COLLECTED = the payments recorded (invoice_payments) on those invoices — equal to their
//     amount_paid, because every payment path writes the ledger (invoiceEngine.recordInvoicePayment).
//   · OUTSTANDING / A/R = total − amount_paid − amount_adjusted of released invoices.
//
// Claims keep their own rule (dated by service date; a claim made from an invoice is left out
// wherever invoices are counted, because the invoice already counts that money).
import { sql, type SQL } from 'drizzle-orm'
import { releasedInvoiceSql } from './invoiceEngine.ts'

export { releasedInvoiceSql }

/** An invoice's service date (see above). `i` = an invoices alias. */
export function invoiceServiceDateSql(i = 'i'): SQL {
  return sql.raw(`COALESCE((SELECT MIN(ili_d.service_date) FROM invoice_line_items ili_d WHERE ili_d.invoice_id = ${i}.id), ${i}.billing_period_start)`)
}

/** WHERE fragment: a released invoice whose service date falls in [start, end]. */
export function billedInRangeSql(start: string, end: string, i = 'i'): SQL {
  return sql`(${releasedInvoiceSql(i)} AND ${invoiceServiceDateSql(i)} BETWEEN (${start})::date AND (${end})::date)`
}

/** An invoice's open balance, net of payments and write-offs. */
export function invoiceBalanceSql(i = 'i'): SQL {
  return sql.raw(`(${i}.total - COALESCE(${i}.amount_paid, 0) - COALESCE(${i}.amount_adjusted, 0))`)
}
