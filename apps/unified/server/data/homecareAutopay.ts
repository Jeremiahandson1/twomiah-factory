// The SQL of autopay (core/autopay.ts): which sent invoices are due a charge, the claim row that makes each try happen
// once, and the reads the office screen shows. Every read is the company's; each returns camelCase.
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { camelFirst, camelRows, rowsOf } from '@twomiah/tenant-backend'
import type { Q } from './homecareCore.ts'

/**
 * Sent invoices of clients with a card on file that still owe something and have no try that stops another one:
 * a try that worked, one that needs the family (their bank asked for more), a hard decline, the last allowed try, a failed
 * try whose wait is not over, or a try that started less than `staleMinutes` ago (it is still being asked of Stripe).
 * One company's when `companyId` is given. A draft (sent_at empty) is never charged, nor an invoice billed to a payer:
 * the family's card pays what the family owes (0051 bill_to — an insurer's invoice, or a payer's share of split visits).
 */
export async function invoicesDueForCharge(q: Q, companyId: string | null, maxAttempts: number, staleMinutes: number, limit = 200): Promise<{ id: string; companyId: string }[]> {
  return camelRows(await q.execute(sql`
    SELECT i.id, i.company_id
      FROM invoices i
      JOIN client_autopay a ON a.client_id = i.client_id AND a.company_id = i.company_id AND a.status = 'active'
     WHERE i.sent_at IS NOT NULL AND i.payment_status <> 'paid' AND i.bill_to = 'family'
       AND (i.total - COALESCE(i.amount_paid, 0) - COALESCE(i.amount_adjusted, 0)) > 0
       ${companyId ? sql`AND i.company_id = ${companyId}` : sql``}
       -- an invoice with a scheduled charge or an instalment plan is charged only by its plan (row 22)
       AND NOT EXISTS (SELECT 1 FROM autopay_schedule s WHERE s.invoice_id = i.id AND s.status <> 'cancelled')
       AND NOT EXISTS (
         SELECT 1 FROM autopay_attempt t
          WHERE t.invoice_id = i.id AND t.schedule_id IS NULL AND (
            t.status IN ('succeeded', 'needs_action')
            OR (t.status = 'failed' AND (t.hard_decline OR t.attempt_no >= ${maxAttempts} OR t.next_attempt_at > NOW()))
            OR (t.status = 'pending' AND t.updated_at > NOW() - (${staleMinutes}::int * INTERVAL '1 minute'))
          ))
     ORDER BY i.sent_at, i.id
     LIMIT ${limit}`)) as any
}

/**
 * Row 22: the scheduled charges of one company that are due on the agency's day `today` ('YYYY-MM-DD') and have no try that
 * stops another one (the same stops as above, keyed on the schedule row), on sent invoices that still owe something.
 */
export async function schedulesDue(q: Q, companyId: string, today: string, maxAttempts: number, staleMinutes: number, limit = 200): Promise<{ id: string; invoiceId: string }[]> {
  return camelRows(await q.execute(sql`
    SELECT s.id, s.invoice_id
      FROM autopay_schedule s
      JOIN invoices i ON i.id = s.invoice_id AND i.company_id = s.company_id
      JOIN client_autopay a ON a.client_id = i.client_id AND a.company_id = i.company_id AND a.status = 'active'
     WHERE s.company_id = ${companyId} AND s.status = 'waiting' AND s.charge_on <= ${today}::date
       AND i.sent_at IS NOT NULL AND i.payment_status <> 'paid' AND i.bill_to = 'family'
       AND (i.total - COALESCE(i.amount_paid, 0) - COALESCE(i.amount_adjusted, 0)) > 0
       AND NOT EXISTS (
         SELECT 1 FROM autopay_attempt t
          WHERE t.schedule_id = s.id AND (
            t.status IN ('succeeded', 'needs_action')
            OR (t.status = 'failed' AND (t.hard_decline OR t.attempt_no >= ${maxAttempts} OR t.next_attempt_at > NOW()))
            OR (t.status = 'pending' AND t.updated_at > NOW() - (${staleMinutes}::int * INTERVAL '1 minute'))
          ))
     ORDER BY s.charge_on, s.created_at
     LIMIT ${limit}`)) as any
}

/** Row 22: the company's scheduled charges and instalments (not cancelled), soonest first, with the client and invoice. */
export async function scheduleRows(q: Q, companyId: string, invoiceId: string | null = null): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT s.id, s.invoice_id, s.client_id, to_char(s.charge_on, 'YYYY-MM-DD') AS charge_on, s.amount_cents, s.label, s.status, s.created_at,
           c.first_name, c.last_name, COALESCE(i.seq_number::text, i.invoice_number) AS invoice_number,
           ROUND((i.total - COALESCE(i.amount_paid, 0) - COALESCE(i.amount_adjusted, 0)) * 100)::int AS owed_cents
      FROM autopay_schedule s
      JOIN clients c ON c.id = s.client_id AND c.company_id = ${companyId}
      JOIN invoices i ON i.id = s.invoice_id AND i.company_id = ${companyId}
     WHERE s.company_id = ${companyId} AND s.status <> 'cancelled'
       ${invoiceId ? sql`AND s.invoice_id = ${invoiceId}` : sql``}
     ORDER BY s.charge_on, s.created_at`))
}

/**
 * Row 22: cards on file whose expiry month ends within `withinDays` days (or has passed) and that were not yet warned about for
 * that month. A bank account has no expiry.
 */
export async function cardsExpiringSoon(q: Q, withinDays: number, limit = 500): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT a.id, a.company_id, a.client_id, a.brand, a.last4, a.exp_month, a.exp_year, c.first_name, c.last_name
      FROM client_autopay a JOIN clients c ON c.id = a.client_id AND c.company_id = a.company_id
     WHERE a.status = 'active' AND a.method = 'card' AND a.exp_month IS NOT NULL AND a.exp_year IS NOT NULL
       AND (make_date(a.exp_year, a.exp_month, 1) + INTERVAL '1 month' - INTERVAL '1 day') <= NOW() + (${withinDays}::int * INTERVAL '1 day')
       AND COALESCE(a.expiry_warned_for, '') <> to_char(make_date(a.exp_year, a.exp_month, 1), 'YYYY-MM')
     ORDER BY a.exp_year, a.exp_month
     LIMIT ${limit}`))
}

/**
 * Row 22: tries waiting on the card's owner (the bank asked for approval) on invoices still owed, with how many reminders went out and
 * how many days ago the notice was sent, so the reminder schedule can be read against them.
 */
export async function attemptsNeedingReminder(q: Q, limit = 500): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT t.id, t.company_id, t.invoice_id, t.client_id, t.attempt_no, t.amount_cents, t.failure_code, t.reminders_sent, t.created_at,
           EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 86400 AS days_since
      FROM autopay_attempt t JOIN invoices i ON i.id = t.invoice_id
     WHERE t.status = 'needs_action' AND i.payment_status <> 'paid'
       AND (i.total - COALESCE(i.amount_paid, 0) - COALESCE(i.amount_adjusted, 0)) > 0
     ORDER BY t.created_at
     LIMIT ${limit}`))
}

/** The highest try number made on an invoice (0 when none). */
export async function lastAttemptNo(q: Q, invoiceId: string): Promise<number> {
  const r = camelFirst(await q.execute(sql`SELECT COALESCE(MAX(attempt_no), 0)::int AS n FROM autopay_attempt WHERE invoice_id = ${invoiceId}`)) as any
  return Number(r?.n ?? 0)
}

/** Claim try number `attemptNo` of an invoice: the row exists once; true only for the caller that inserted it. */
export async function claimAttempt(q: Q, companyId: string, invoiceId: string, clientId: string, attemptNo: number, amountCents: number, scheduleId: string | null = null): Promise<string | null> {
  const r = rowsOf(await q.execute(sql`INSERT INTO autopay_attempt (id, company_id, invoice_id, client_id, attempt_no, status, amount_cents, schedule_id)
    VALUES (${createId()}, ${companyId}, ${invoiceId}, ${clientId}, ${attemptNo}, 'pending', ${amountCents}, ${scheduleId})
    ON CONFLICT (invoice_id, attempt_no) DO NOTHING RETURNING id`))
  return r.length ? String(r[0].id) : null
}

/**
 * Take over a try that was claimed but never finished (the server stopped between the claim and Stripe's answer). Only a
 * 'pending' try older than `staleMinutes` can be taken, and only by one caller: it moves its clock forward.
 */
export async function reclaimStaleAttempt(q: Q, companyId: string, invoiceId: string, attemptNo: number, staleMinutes: number): Promise<string | null> {
  const r = rowsOf(await q.execute(sql`UPDATE autopay_attempt SET updated_at = NOW()
    WHERE company_id = ${companyId} AND invoice_id = ${invoiceId} AND attempt_no = ${attemptNo} AND status = 'pending'
      AND updated_at <= NOW() - (${staleMinutes}::int * INTERVAL '1 minute') RETURNING id`))
  return r.length ? String(r[0].id) : null
}

/** The attempt row of a payment intent (the webhook knows only this). */
export async function attemptByIntent(q: Q, paymentIntentId: string): Promise<{ id: string; companyId: string; invoiceId: string; clientId: string; status: string; amountCents: number; scheduleId: string | null } | null> {
  return camelFirst(await q.execute(sql`SELECT id, company_id, invoice_id, client_id, status, amount_cents, schedule_id FROM autopay_attempt WHERE payment_intent_id = ${paymentIntentId} LIMIT 1`)) as any
}

/** The office's list: tries that failed or need the family, newest first, with the client and the invoice's number. */
export async function attemptsNeedingAttention(q: Q, companyId: string, limit = 200): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT t.id, t.invoice_id, t.client_id, t.attempt_no, t.status, t.amount_cents, t.failure_code, t.failure_message,
           t.hard_decline, t.next_attempt_at, t.created_at, c.first_name, c.last_name, COALESCE(i.seq_number::text, i.invoice_number) AS invoice_number
      FROM autopay_attempt t
      JOIN clients c ON c.id = t.client_id AND c.company_id = ${companyId}
      JOIN invoices i ON i.id = t.invoice_id AND i.company_id = ${companyId}
     WHERE t.company_id = ${companyId} AND t.status IN ('failed', 'needs_action')
       AND i.payment_status <> 'paid'
       AND t.attempt_no = (SELECT MAX(attempt_no) FROM autopay_attempt WHERE invoice_id = t.invoice_id)
     ORDER BY t.created_at DESC
     LIMIT ${limit}`))
}

/** Every try on one invoice, oldest first. */
export async function attemptsForInvoice(q: Q, companyId: string, invoiceId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT id, attempt_no, status, amount_cents, payment_intent_id, failure_code, failure_message, hard_decline, next_attempt_at, created_at, schedule_id, reminders_sent, receipt_sent_at
      FROM autopay_attempt WHERE company_id = ${companyId} AND invoice_id = ${invoiceId} ORDER BY attempt_no`))
}

/** The clients of the company that have a card on file or a link out, with the card's brand and last four. */
export async function autopayClients(q: Q, companyId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT a.client_id, a.status, a.paused_reason, a.brand, a.last4, a.exp_month, a.exp_year, a.consent_at, a.method, a.bank_name, a.saved_by, c.first_name, c.last_name
      FROM client_autopay a JOIN clients c ON c.id = a.client_id AND c.company_id = ${companyId}
     WHERE a.company_id = ${companyId} AND a.status <> 'removed'
     ORDER BY c.last_name, c.first_name`))
}

/** The companies with at least one card on file (the ones a scan could charge for). */
export async function companiesWithAutopay(q: Q): Promise<string[]> {
  return rowsOf(await q.execute(sql`SELECT DISTINCT company_id FROM client_autopay WHERE status = 'active'`)).map((r) => String(r.company_id))
}

/** A new card was saved: tries that stopped for the OLD card being finished may be made again, with the new one, now. */
export async function releaseHardDeclines(q: Q, companyId: string, clientId: string, maxAttempts: number): Promise<number> {
  return rowsOf(await q.execute(sql`UPDATE autopay_attempt SET hard_decline = false, next_attempt_at = NOW(), updated_at = NOW()
    WHERE company_id = ${companyId} AND client_id = ${clientId} AND status = 'failed' AND hard_decline AND attempt_no < ${maxAttempts}
    RETURNING id`)).length
}

/**
 * The stored billing contact (name, email) of the client's payer, when the payer is a private-pay one and the contact has an email;
 * otherwise null. Who is told first when a charge to the client's card fails. Only a private-pay payer: an insurer's or a referral
 * source's billing office is never told about a family's card.
 */
export async function billingContactOf(q: Q, companyId: string, clientId: string): Promise<{ name: string | null; email: string } | null> {
  const r = camelFirst(await q.execute(sql`SELECT rs.billing_contact_name, rs.billing_contact_email
      FROM clients c JOIN referral_sources rs ON rs.id = c.referred_by_id AND rs.company_id = ${companyId}
     WHERE c.id = ${clientId} AND c.company_id = ${companyId} AND rs.payer_type = 'private_pay'`)) as any
  const email = String(r?.billingContactEmail ?? '').trim()
  return email ? { name: String(r?.billingContactName ?? '').trim() || null, email } : null
}
