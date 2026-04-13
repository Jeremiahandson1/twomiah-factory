/**
 * Consumer financing lender service — Wisetack / GreenSky / Sunlight
 *
 * Unified interface for submitting roofing financing applications to
 * multiple lenders. Each lender has its own API; this file abstracts
 * them into a common shape and delegates to the correct client based
 * on the application's `lender` field.
 *
 * ──────────────────────────────────────────────────────────────────────
 * TO GO LIVE — WISETACK:
 * ──────────────────────────────────────────────────────────────────────
 *
 * 1) Sign up for a Wisetack merchant account + request API access:
 *    https://www.wisetack.com/ → partner program
 *
 * 2) You'll get:
 *    - WISETACK_MERCHANT_ID
 *    - WISETACK_API_KEY (or OAuth client_id + client_secret)
 *    - WISETACK_WEBHOOK_SECRET (for signature verification)
 *
 * 3) Put them in .env:
 *    WISETACK_API_KEY=...
 *    WISETACK_MERCHANT_ID=...
 *    WISETACK_WEBHOOK_SECRET=...
 *    WISETACK_API_BASE=https://api.wisetack.com (or sandbox)
 *
 * 4) Implement `submitToWisetack()` below. Wisetack returns a hosted
 *    application URL that you SMS/email to the customer.
 *
 * 5) Set up a webhook endpoint at /api/financing/webhooks/wisetack
 *    (see routes/financing.ts — you'll need to add the webhook handler).
 *    Wisetack will POST application status updates (approved, declined,
 *    funded). Verify the signature using WISETACK_WEBHOOK_SECRET.
 *
 * ──────────────────────────────────────────────────────────────────────
 * TO GO LIVE — GREENSKY:
 * ──────────────────────────────────────────────────────────────────────
 *
 * Similar flow. GreenSky uses a merchant portal + API. Contact their
 * partner team for API access. Env vars: GREENSKY_MERCHANT_ID,
 * GREENSKY_API_KEY, GREENSKY_API_BASE.
 *
 * ──────────────────────────────────────────────────────────────────────
 * TO GO LIVE — SUNLIGHT FINANCIAL:
 * ──────────────────────────────────────────────────────────────────────
 *
 * Sunlight is solar-focused but offers roofing loans. Contact partners.
 * Env vars: SUNLIGHT_API_KEY, SUNLIGHT_DEALER_ID.
 *
 * Until a lender is configured, the financing route stores the
 * application but the "Send to Lender" action returns a "not configured"
 * error. Admins can still manually track status via the UI.
 */

export class LenderNotConfiguredError extends Error {
  constructor(lender: string) {
    super(
      `Lender "${lender}" is not configured. See services/lenders.ts header ` +
      `for setup instructions. Until configured, mark applications as sent/` +
      `approved/funded manually in the UI.`
    )
  }
}

export interface SubmitApplicationInput {
  lender: 'wisetack' | 'greensky' | 'sunlight' | 'other'
  amountRequested: number
  termMonths?: number
  contactName: string
  contactEmail: string
  contactPhone: string
  contactAddress?: string
  jobDescription?: string
}

export interface SubmittedApplicationResult {
  applicationUrl: string
  lenderReference: string
  expiresAt?: Date
}

// ─────────────────────────────────────────────────────────────
// WISETACK
// ─────────────────────────────────────────────────────────────

async function submitToWisetack(input: SubmitApplicationInput): Promise<SubmittedApplicationResult> {
  const apiKey = process.env.WISETACK_API_KEY
  const merchantId = process.env.WISETACK_MERCHANT_ID
  const apiBase = process.env.WISETACK_API_BASE || 'https://api.wisetack.com'

  if (!apiKey || !merchantId) throw new LenderNotConfiguredError('wisetack')

  // TODO: Implement Wisetack application submission. Skeleton:
  // const res = await fetch(`${apiBase}/v1/applications`, {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //     'Authorization': `Bearer ${apiKey}`,
  //   },
  //   body: JSON.stringify({
  //     merchantId,
  //     amount: input.amountRequested,
  //     borrowerFirstName: input.contactName.split(' ')[0],
  //     borrowerLastName: input.contactName.split(' ').slice(1).join(' '),
  //     borrowerEmail: input.contactEmail,
  //     borrowerPhone: input.contactPhone,
  //     purpose: 'home_improvement',
  //   }),
  // })
  // const json = await res.json()
  // return {
  //   applicationUrl: json.application_url,
  //   lenderReference: json.application_id,
  //   expiresAt: new Date(json.expires_at),
  // }

  throw new LenderNotConfiguredError('wisetack')
}

export interface WisetackWebhookPayload {
  application_id: string
  event_type: 'approved' | 'declined' | 'funded' | 'expired'
  amount_approved?: number
  term_months?: number
  apr?: number
  monthly_payment?: number
  decline_reason?: string
}

/** Verify + parse a Wisetack webhook. Returns null if signature invalid. */
export function verifyWisetackWebhook(rawBody: string, signature: string): WisetackWebhookPayload | null {
  const secret = process.env.WISETACK_WEBHOOK_SECRET
  if (!secret) throw new LenderNotConfiguredError('wisetack')

  // TODO: Implement HMAC signature verification per Wisetack docs.
  // const crypto = require('crypto')
  // const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  // if (expected !== signature) return null
  // return JSON.parse(rawBody)

  throw new LenderNotConfiguredError('wisetack')
}

// ─────────────────────────────────────────────────────────────
// GREENSKY (stub)
// ─────────────────────────────────────────────────────────────

async function submitToGreensky(input: SubmitApplicationInput): Promise<SubmittedApplicationResult> {
  if (!process.env.GREENSKY_API_KEY) throw new LenderNotConfiguredError('greensky')
  throw new LenderNotConfiguredError('greensky')
}

// ─────────────────────────────────────────────────────────────
// SUNLIGHT (stub)
// ─────────────────────────────────────────────────────────────

async function submitToSunlight(input: SubmitApplicationInput): Promise<SubmittedApplicationResult> {
  if (!process.env.SUNLIGHT_API_KEY) throw new LenderNotConfiguredError('sunlight')
  throw new LenderNotConfiguredError('sunlight')
}

// ─────────────────────────────────────────────────────────────
// PUBLIC — route.ts calls this, it dispatches to the right lender
// ─────────────────────────────────────────────────────────────

export async function submitApplication(input: SubmitApplicationInput): Promise<SubmittedApplicationResult> {
  switch (input.lender) {
    case 'wisetack': return submitToWisetack(input)
    case 'greensky': return submitToGreensky(input)
    case 'sunlight': return submitToSunlight(input)
    case 'other': throw new LenderNotConfiguredError('other (pick a specific lender)')
  }
}

export const isConfigured = (lender: string): boolean => {
  if (lender === 'wisetack') return !!(process.env.WISETACK_API_KEY && process.env.WISETACK_MERCHANT_ID)
  if (lender === 'greensky') return !!process.env.GREENSKY_API_KEY
  if (lender === 'sunlight') return !!process.env.SUNLIGHT_API_KEY
  return false
}

export const configuredLenders = (): string[] => {
  const list: string[] = []
  if (isConfigured('wisetack')) list.push('wisetack')
  if (isConfigured('greensky')) list.push('greensky')
  if (isConfigured('sunlight')) list.push('sunlight')
  return list
}

export default { submitApplication, verifyWisetackWebhook, isConfigured, configuredLenders }
