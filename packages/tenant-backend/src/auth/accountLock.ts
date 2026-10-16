// IS THIS COMPANY LOCKED? — one rule, enforced by the server, shown by the browser. (10/14)
//
//   Owner, after cancelling the test company from the Factory: "i dont seem to be locked out".
//
// The Factory's panel said "Ended. The CRM is locked". It was not. The only lock was a browser check that
// fired when a FREE-TRIAL end date had passed — so a company that paid and then cancelled (no trial date)
// was never locked, and even a locked screen left the API answering every request.
//
// The Factory decides the state and mirrors it into company.settings (billing.ts → applySubscriptionToCompany):
//   - subscriptionStatus 'canceled'                 → locked. The Factory sends this for an ended subscription,
//                                                     a suspended or offboarded company, and an expired trial.
//   - 'trialing' with trialEndsAt in the past       → locked. The trial ran out before the next push said so.
// Anything else — 'active', 'past_due' (Stripe is still retrying the card), or no status at all (a company
// provisioned without a checkout) — is open. Only the Factory may lock a company; a tenant never guesses.
//
// While locked, a signed-in person can still reach the doors that let them come back: signing in and out,
// two-factor, and billing. Everything else answers 402 { code: 'ACCOUNT_LOCKED' } and the browser goes to
// the lock page. The public doors (customer portal, webhooks) never pass through `authenticate`, so the
// business's own customers and payment providers are not cut off by a lapsed Twomiah subscription.

export type AccountLock = 'subscription_ended' | 'trial_ended'

export function accountLockOf(settings: any, now: number = Date.now()): AccountLock | null {
  let s = settings
  if (typeof s === 'string') { try { s = JSON.parse(s) } catch { return null } }
  if (!s || typeof s !== 'object') return null
  const status = s.subscriptionStatus
  if (status === 'canceled') {
    // The words on the lock page. A trial that ran out never had a subscription to end.
    return s.billingStatus === 'canceled' || s.billingStatus === 'active' || s.billingStatus === 'past_due' ? 'subscription_ended' : 'trial_ended'
  }
  if (status === 'trialing' && s.trialEndsAt) {
    const end = new Date(s.trialEndsAt).getTime()
    if (!isNaN(end) && end < now) return 'trial_ended'
  }
  return null
}

/**
 * The doors a locked company keeps: the way back in, and nothing else.
 *
 * Billing is named door by door — the three routes of the shared subscription router (billing.ts) — not as the whole of
 * /api/billing. In home care /api/billing is ALSO the agency's own client invoicing (invoices, payments, rates, claim
 * portals), and a prefix would have left every one of those open to a cancelled agency (Run 3, 10/16). In every other
 * CRM /api/billing holds only these three, so the doors there are unchanged.
 */
export const LOCK_OPEN_PREFIXES = ['/api/auth', '/api/billing/subscription', '/api/billing/portal-link', '/api/billing/restart-checkout', '/api/messaging-billing'] as const

export function isLockOpenPath(path: string): boolean {
  return LOCK_OPEN_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))
}

export const ACCOUNT_LOCKED_MESSAGE = {
  subscription_ended: 'This account’s subscription has ended. The account owner can subscribe again to unlock it.',
  trial_ended: 'This account’s free trial has ended. The account owner can choose a plan to unlock it.',
} as const

// One company per tenant database, so one cached answer per process. Refreshed every 15 seconds and
// cleared the moment a Factory push lands (applySubscriptionToCompany), so a lock or an unlock takes
// effect on the next request rather than up to 15 seconds later.
const CACHE_MS = 15_000
let cached: { at: number; settings: any } | null = null

export function forgetAccountLock(): void { cached = null }

/**
 * `column` is where the Factory's summary is mirrored: company.settings in every CRM with a company row, and
 * store_settings.subscription in crm-store, which is single-tenant and has none (10/14).
 */
export async function currentAccountLock(db: any, companyTable: any, column: any = companyTable.settings): Promise<AccountLock | null> {
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    const [row] = await db.select({ settings: column }).from(companyTable).limit(1)
    cached = { at: Date.now(), settings: row?.settings ?? null }
  }
  return accountLockOf(cached.settings)
}

/**
 * The check `authenticate` runs after it knows who is asking. Returns the 402 to send, or null to go on.
 * Every authenticate in every template calls this — the shared one and the three templates that keep their own.
 */
export async function refuseWhileLocked(c: any, db: any, companyTable: any, column?: any): Promise<Response | null> {
  if (isLockOpenPath(c.req.path)) return null
  const lock = await currentAccountLock(db, companyTable, column ?? companyTable.settings)
  if (!lock) return null
  return c.json({ error: ACCOUNT_LOCKED_MESSAGE[lock], code: 'ACCOUNT_LOCKED', lock }, 402)
}
