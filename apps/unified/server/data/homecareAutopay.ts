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
 * One company's when `companyId` is given. A draft (sent_at empty) is never charged.
 */
export async function invoicesDueForCharge(q: Q, companyId: string | null, maxAttempts: number, staleMinutes: number, limit = 200): Promise<{ id: string; companyId: string }[]> {
  return camelRows(await q.execute(sql`
    SELECT i.id, i.company_id
      FROM invoices i
      JOIN client_autopay a ON a.client_id = i.client_id AND a.company_id = i.company_id AND a.status = 'active'
     WHERE i.sent_at IS NOT NULL AND i.payment_status <> 'paid'
       AND (i.total - COALESCE(i.amount_paid, 0) - COALESCE(i.amount_adjusted, 0)) > 0
       ${companyId ? sql`AND i.company_id = ${companyId}` : sql``}
       AND NOT EXISTS (
         SELECT 1 FROM autopay_attempt t
          WHERE t.invoice_id = i.id AND (
            t.status IN ('succeeded', 'needs_action')
            OR (t.status = 'failed' AND (t.hard_decline OR t.attempt_no >= ${maxAttempts} OR t.next_attempt_at > NOW()))
            OR (t.status = 'pending' AND t.updated_at > NOW() - (${staleMinutes}::int * INTERVAL '1 minute'))
          ))
     ORDER BY i.sent_at, i.id
     LIMIT ${limit}`)) as any
}

/** The highest try number made on an invoice (0 when none). */
export async function lastAttemptNo(q: Q, invoiceId: string): Promise<number> {
  const r = camelFirst(await q.execute(sql`SELECT COALESCE(MAX(attempt_no), 0)::int AS n FROM autopay_attempt WHERE invoice_id = ${invoiceId}`)) as any
  return Number(r?.n ?? 0)
}

/** Claim try number `attemptNo` of an invoice: the row exists once; true only for the caller that inserted it. */
export async function claimAttempt(q: Q, companyId: string, invoiceId: string, clientId: string, attemptNo: number, amountCents: number): Promise<string | null> {
  const r = rowsOf(await q.execute(sql`INSERT INTO autopay_attempt (id, company_id, invoice_id, client_id, attempt_no, status, amount_cents)
    VALUES (${createId()}, ${companyId}, ${invoiceId}, ${clientId}, ${attemptNo}, 'pending', ${amountCents})
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
export async function attemptByIntent(q: Q, paymentIntentId: string): Promise<{ id: string; companyId: string; invoiceId: string; clientId: string; status: string; amountCents: number } | null> {
  return camelFirst(await q.execute(sql`SELECT id, company_id, invoice_id, client_id, status, amount_cents FROM autopay_attempt WHERE payment_intent_id = ${paymentIntentId} LIMIT 1`)) as any
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
    SELECT id, attempt_no, status, amount_cents, payment_intent_id, failure_code, failure_message, hard_decline, next_attempt_at, created_at
      FROM autopay_attempt WHERE company_id = ${companyId} AND invoice_id = ${invoiceId} ORDER BY attempt_no`))
}

/** The clients of the company that have a card on file or a link out, with the card's brand and last four. */
export async function autopayClients(q: Q, companyId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT a.client_id, a.status, a.paused_reason, a.brand, a.last4, a.exp_month, a.exp_year, a.consent_at, c.first_name, c.last_name
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
