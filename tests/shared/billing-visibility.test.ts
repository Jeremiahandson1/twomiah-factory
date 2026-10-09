// Who sees the bill, and when a trial locks the door. (T60)
//
//   "Subscription billing details reach the manager through /api/company … the nested settings object
//    still returns plan, monthlyAmount (99), billing status, subscriptionStatus, seatLimit and
//    hasStripeCustomer."
//   "A false 'N days left in your free trial – Upgrade' banner shows for the manager … the app falls
//    back to a 30-day countdown from the sign-up date."
//
// One rule on the server (auth/redactSettings.ts, run by /api/auth, /api/company and the roof and
// dispensary forks) and one on the client (trialEndDate, used by BOTH the paywall gate and the banner).
//   bun run tests/shared/billing-visibility.test.ts
import { redactCompanySettings, PRIVATE_SETTING_KEYS } from '../../packages/tenant-backend/src/auth/redactSettings.ts'
import { redactCompanyCommercial } from '../../packages/tenant-backend/src/auth/redactSettings.ts'
import * as shared from '../../packages/tenant-ui/src/auth/trialStatus.ts'
import * as roof from '../../templates/crm-roof/frontend/src/components/auth/trialStatus.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}

const DAY = 86_400_000
const iso = (ms: number) => new Date(Date.now() + ms).toISOString()
// What billing.ts mirrors into company.settings for a paid shop — the live shape on the test fleet.
const paid = {
  timezone: 'America/New_York', taxRate: 5.5,
  plan: 'starter10', planName: 'Starter', product: 'crm', subscriptionStatus: 'active', billingStatus: 'pending',
  billingType: 'subscription', billingCycle: 'monthly', monthlyAmount: 99, nextBillingDate: iso(20 * DAY),
  trialEndsAt: iso(-40 * DAY), seatLimit: 10, hasStripeCustomer: false, subscriptionSyncedAt: iso(0),
}

// ─────────────────────────────────────────────── the bill stays with whoever settles it
{
  const mgr = redactCompanySettings(paid, { privileged: false })
  const leaked = PRIVATE_SETTING_KEYS.filter((k) => k in mgr)
  check('manager: no commercial key survives in settings', leaked.length === 0, leaked)
  check('manager: billingType and nextBillingDate are commercial too', !('billingType' in mgr) && !('nextBillingDate' in mgr))
  check('manager: the shop\'s operating settings are untouched', mgr.timezone === 'America/New_York' && mgr.taxRate === 5.5)
  check('manager: a paid shop\'s stale trial date is NOT sent (it would lock them out)', !('trialEndsAt' in mgr), mgr)
  const own = redactCompanySettings(paid, { privileged: true })
  check('owner: keeps every commercial key', PRIVATE_SETTING_KEYS.filter((k) => k !== 'stripeCustomerId').every((k) => k in own))
  check('owner: keeps the trial date', own.trialEndsAt === paid.trialEndsAt)
  check('the caller\'s row is never mutated', paid.monthlyAmount === 99 && paid.subscriptionStatus === 'active')
}

// ─────────────────────────────────────────────── a trial that really decides access reaches everyone
for (const [status, ms] of [['trialing', 3 * DAY], ['canceled', -2 * DAY]] as const) {
  const s = { ...paid, subscriptionStatus: status, trialEndsAt: iso(ms) }
  const mgr = redactCompanySettings(s, { privileged: false })
  check(`manager, ${status}: the trial date is kept, the status word is not`, mgr.trialEndsAt === s.trialEndsAt && !('subscriptionStatus' in mgr))
}
check('manager, past_due: no trial date (a late payment is not a trial)', !('trialEndsAt' in redactCompanySettings({ ...paid, subscriptionStatus: 'past_due' }, { privileged: false })))
check('a settings string is parsed, not passed through raw', !('plan' in redactCompanySettings(JSON.stringify(paid), { privileged: false })))

// ─────────────────────────────────────────────── /api/company for a non-updater: columns AND blob
{
  const row = { id: 'c1', name: 'Shop', subscriptionTier: 'starter10', seatLimit: 10, integrations: { stripeAccountId: 'acct_1' }, settings: paid }
  const out: any = redactCompanyCommercial(row)
  check('company: the commercial columns go', !('subscriptionTier' in out) && !('seatLimit' in out) && !('integrations' in out))
  check('company: …and so does the copy inside settings', PRIVATE_SETTING_KEYS.every((k) => !(k in out.settings)), out.settings)
  check('company: the name and operating settings stay', out.name === 'Shop' && out.settings.timezone === 'America/New_York')
  check('company: the row passed in still holds its settings', (row.settings as any).monthlyAmount === 99)
  check('company: a row with no settings is fine', redactCompanyCommercial({ id: 'c2', settings: null } as any).settings === null)
}

// ─────────────────────────────────────────────── the client gate and banner, in BOTH copies
for (const [name, lib] of [['tenant-ui', shared], ['crm-roof', roof]] as const) {
  const createdLongAgo = new Date(Date.now() - 45 * DAY).toISOString()
  // The exact T60 shape: what a manager receives on a paid shop created 45 days ago.
  const managerView = { createdAt: createdLongAgo, settings: redactCompanySettings(paid, { privileged: false }) }
  check(`${name}: a manager on a paid shop is not locked out`, lib.isTrialExpired(managerView) === false)
  check(`${name}: …and is shown no trial countdown`, lib.trialEndDate(managerView) === null)
  check(`${name}: sign-up date alone is never a trial`, lib.trialEndDate({ createdAt: createdLongAgo, settings: {} }) === null)
  const trialing = { ...paid, subscriptionStatus: 'trialing', trialEndsAt: iso(3 * DAY) }
  check(`${name}: a real trial counts down for the manager`, lib.trialEndDate({ settings: redactCompanySettings(trialing, { privileged: false }) })?.toISOString() === trialing.trialEndsAt)
  const ended = { ...paid, subscriptionStatus: 'canceled', trialEndsAt: iso(-1 * DAY) }
  check(`${name}: an ended trial still locks the manager`, lib.isTrialExpired({ settings: redactCompanySettings(ended, { privileged: false }) }) === true)
  check(`${name}: …and the owner`, lib.isTrialExpired({ settings: ended }) === true)
  check(`${name}: an active owner is never locked, stale trial date or not`, lib.isTrialExpired({ settings: paid }) === false)
  check(`${name}: an unparseable date locks nobody`, lib.isTrialExpired({ settings: { trialEndsAt: 'soon' } }) === false)
}

console.log(`\nbilling visibility: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
