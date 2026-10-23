// The lender: Wisetack — the consumer-financing lender Jobber and Housecall Pro build in (wisetack.com lists both as
// software partners; ServiceTitan instead integrates GreenSky, Synchrony, Service Finance and others).
//
// WHAT IS PUBLIC, and what this file takes from it (read 2026-10-23):
//   · loans for jobs of $500–$65,000 (wisetack.com/merchants/home-services);
//   · the business pays a flat 3.9% per financed job, nothing to sign up; customers see 0–35.9% APR over 3–120 months
//     after a soft credit check (wisetack.com/faqs, /faqs-merchants);
//   · every business has its own prequalification link, in Wisetack's merchant portal under Account settings ›
//     Merchant information, made to be put on a website or a quote (support.wisetack.com article 8500513584411);
//   · statuses as the merchant portal names them: Prequal Started, Prequalified, Prequal declined, Prequal expired,
//     Prequal canceled; Pending, Action required, Offer locked, Confirmed, Paid, Declined, Expired, Canceled
//     (support.wisetack.com article 29370744202011) — the customer confirms ("Done - Release Payment") and Wisetack
//     pays the business by ACH the next business day;
//   · any mention of a monthly payment, an APR or a term is a "trigger term" that needs Wisetack's full disclosure,
//     and wording other than the marketing toolkit's must be approved by support@wisetack.com
//     (wisetack.com/marketing-toolkit/hs/compliance). DISCLOSURE below is the toolkit's text, word for word.
//
// WHAT IS NOT PUBLIC: the partner API. Its address, authentication, request and response bodies, webhook event body
// and webhook signature scheme are published only to signed integration partners (wisetack.com/partnerships; no
// public reference exists). Everything in this file marked SPEC-PENDING is this app's own contract for that API —
// the one place to change when Wisetack's partner documentation arrives — and it is why Consumer Financing is
// registered NOT READY (packages/tenant-backend featureRegistry.ts): nothing here has met the real API.
import crypto from 'node:crypto'

export const LENDER = {
  id: 'wisetack',
  name: 'Wisetack',
  /** The job sizes Wisetack lends on (wisetack.com/merchants/home-services). */
  minAmount: 500,
  maxAmount: 65_000,
  /** The representative example in Wisetack's own disclosure: $5,500 over 24 months at 9.9% APR. */
  exampleApr: 9.9,
  exampleTermMonths: 24,
  merchantSignupUrl: 'https://www.wisetack.com/merchants/home-services',
} as const

/** Wisetack's required disclosure (marketing toolkit, home services), verbatim. */
export const DISCLOSURE = 'All financing is subject to credit approval. Your terms may vary. Payment options through Wisetack are provided by our lending partners. For example, a $5,500 purchase could cost $253.54 per month for 24 months, based on a 9.9% APR, or $1,833.33 per month for 3 months, based on a 0% APR. Offers range from 0 to 35.9% APR based on amount requested and creditworthiness. Not all merchants and lending partners participate in 0% interest programs. Terms range from 3 - 120 months and may vary based on merchant, lending partner, or transaction size. State interest rate caps may apply. No prepaid finance charges or participation fees. See additional terms at wisetack.com/faqs.'

/** The monthly payment on `amount` over `months` at `apr` percent (standard amortisation), to the cent. */
export function monthlyPayment(amount: number, apr: number, months: number): number {
  const r = apr / 100 / 12
  const p = r === 0 ? amount / months : (amount * r) / (1 - Math.pow(1 + r, -months))
  return Math.round(p * 100) / 100
}

/** Our status for an application — the merchant portal's, one word each. */
export type FinancingStatus = 'not_started' | 'pending' | 'prequalified' | 'action_required' | 'approved' | 'confirmed' | 'funded' | 'declined' | 'expired' | 'canceled'

/** Statuses after which nothing more happens to the application. */
export const FINAL: FinancingStatus[] = ['funded', 'declined', 'expired', 'canceled']

/** A lender status (the merchant portal's words, in any case, with spaces, dashes or underscores) as ours; null if unknown. */
export function normalizeStatus(raw: unknown): FinancingStatus | null {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ')
  const map: Record<string, FinancingStatus> = {
    'prequal started': 'pending', pending: 'pending', initiated: 'pending',
    prequalified: 'prequalified',
    'action required': 'action_required', 'actions required': 'action_required',
    'offer locked': 'approved', approved: 'approved', authorized: 'approved',
    confirmed: 'confirmed',
    paid: 'funded', funded: 'funded', settled: 'funded',
    declined: 'declined', 'prequal declined': 'declined',
    expired: 'expired', 'prequal expired': 'expired',
    canceled: 'canceled', cancelled: 'canceled', 'prequal canceled': 'canceled', 'prequal cancelled': 'canceled',
  }
  return map[s] ?? null
}

/** The order an application moves in: a late or repeated event never moves it backwards. */
const RANK: Record<FinancingStatus, number> = { not_started: 0, pending: 1, prequalified: 2, action_required: 3, approved: 4, confirmed: 5, funded: 6, declined: 6, expired: 6, canceled: 6 }
export function moves(from: FinancingStatus, to: FinancingStatus): boolean {
  if (FINAL.includes(from)) return false
  return RANK[to] >= RANK[from] && to !== from
}

// ── SPEC-PENDING: the partner API ────────────────────────────────────────────────────────────────────────────────────

/** Twomiah's partner credentials, from the server's environment. Null until Wisetack issues them. */
export function partnerApi(): { url: string; key: string } | null {
  const url = (process.env.WISETACK_API_URL || '').replace(/\/+$/, '')
  const key = process.env.WISETACK_API_KEY || ''
  return url && key ? { url, key } : null
}

/** The signing secret for Wisetack's webhooks. Null until Wisetack issues it. */
export const webhookSecret = () => process.env.WISETACK_WEBHOOK_SECRET || null

/** SPEC-PENDING: the header Wisetack signs its webhooks in. */
export const SIGNATURE_HEADER = 'x-wisetack-signature'

/**
 * SPEC-PENDING: a webhook is genuine when its signature header is the HMAC-SHA256 of the RAW request body, hex, under
 * the webhook secret (compared in constant time). Read the body as text and verify BEFORE parsing it: a body parsed
 * and re-serialised is not the bytes that were signed.
 */
export function verifyWisetackWebhook(rawBody: string, signature: string | null | undefined, secret: string): boolean {
  if (!signature || !secret) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const given = String(signature).trim().replace(/^sha256=/i, '').toLowerCase()
  const a = Buffer.from(given, 'utf8'), b = Buffer.from(expected, 'utf8')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** SPEC-PENDING: one webhook delivery, as this app reads it. */
export interface LenderEvent {
  /** The delivery's own id: a retried delivery carries the same one and is applied once. */
  eventId: string
  /** The lender's id for the application (what createTransaction returned). */
  transactionId: string
  status: FinancingStatus
  /** The lender's status as sent, kept on the application. */
  rawStatus: string
  /** Dollars, when the event carries an amount (the amount approved or paid). */
  amount: number | null
}

/** SPEC-PENDING: a delivery's body as a LenderEvent, or why it is not one. */
export function parseLenderEvent(body: any): LenderEvent | { error: string } {
  const eventId = String(body?.eventId ?? '').trim()
  const transactionId = String(body?.transactionId ?? '').trim()
  const rawStatus = String(body?.status ?? '').trim()
  if (!eventId || !transactionId || !rawStatus) return { error: 'eventId, transactionId and status are required' }
  const status = normalizeStatus(rawStatus)
  if (!status) return { error: `Unknown status "${rawStatus.slice(0, 40)}"` }
  const amount = body?.amount == null || body.amount === '' ? null : Number(body.amount)
  if (amount !== null && !(Number.isFinite(amount) && amount >= 0)) return { error: 'amount must be a number of dollars' }
  return { eventId: eventId.slice(0, 200), transactionId: transactionId.slice(0, 200), status, rawStatus: rawStatus.slice(0, 60), amount }
}

/**
 * SPEC-PENDING: open an application for one customer and one job at the lender, for the business's merchant account.
 * POST {url}/transactions with the partner key as a bearer token; the answer names the transaction and the customer's
 * application link. The callback the lender posts status changes to is this tenant's webhook address.
 */
export async function createTransaction(api: { url: string; key: string }, input: {
  merchantId: string; amount: number; reference: string; callbackUrl: string
  customer: { firstName: string; lastName: string; email: string | null; phone: string | null }
}, fetcher: typeof fetch = fetch): Promise<{ transactionId: string; applyUrl: string; status: FinancingStatus }> {
  const res = await fetcher(`${api.url}/transactions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${api.key}` },
    body: JSON.stringify({
      merchantId: input.merchantId, amount: input.amount.toFixed(2), reference: input.reference, callbackUrl: input.callbackUrl,
      customer: input.customer,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const data: any = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(`${LENDER.name} did not open the application (${res.status}${data?.message ? ': ' + String(data.message).slice(0, 160) : ''})`), { status: 502 })
  const transactionId = String(data?.transactionId ?? '')
  const applyUrl = String(data?.applyUrl ?? '')
  if (!transactionId || !/^https:\/\//.test(applyUrl)) throw Object.assign(new Error(`${LENDER.name} answered without an application link`), { status: 502 })
  return { transactionId, applyUrl, status: normalizeStatus(data?.status) ?? 'pending' }
}
