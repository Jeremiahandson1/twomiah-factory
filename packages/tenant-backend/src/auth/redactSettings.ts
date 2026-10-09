// A company's settings blob, safe to hand to a browser.
//
// The blob is free-form JSON that every vertical's Settings screen writes into, and the whole of it
// goes to the client on login and on /me — to EVERY signed-in role, budtender included. That is fine
// for a tax rate and a set of store hours. It is not fine for a payment processor's secret key, and
// crm-dispensary's Merch tab writes one straight into it (settings.merch.stripeSecretKey).
//
// The company row's own secret COLUMNS were already stripped on the way out; nothing looked inside
// the blob. Run T45 M27 asked, in as many words, for confirmation that the secret is never returned.
// It was: any budtender could read it the moment an owner filled that field in.
//
// Two rules, and they are different:
//
//   SECRET   never leaves the server for anybody, owner included. A secret you can read back is a
//            secret in every browser session, every screenshot and every support ticket. The screen
//            does not need the value to show that one is configured — it needs to know THAT one is,
//            which is what the `…Configured` flag beside it says.
//   PRIVATE  the shop's commercial terms — what it pays, what plan it is on, how many seats. The
//            owner and admins settle the bill; the floor does not need to know what the shop pays,
//            and T45 found a budtender reading monthlyAmount, plan and billingStatus.
//
// Redaction happens where the payload is BUILT, not at each call site, because the next person to
// add a settings key will not think about this file.

/** Dotted paths inside settings whose value must never reach a client. */
export const SECRET_SETTING_PATHS = [
  'merch.stripeSecretKey',
  'stripeSecretKey',
  'smtpPassword',
  'twilioAuthToken',
  'sendgridApiKey',
  'metrc.apiKey',
  'metrc.userKey',
  'biotrack.password',
  'quickbooks.clientSecret',
  'integrations.stripeSecretKey',
] as const

/**
 * Top-level settings keys that are the OWNER's business, not the whole shop's.
 *
 * billingType and nextBillingDate joined in T60: billing.ts mirrors them from the Factory beside the
 * rest, and they say how and when the shop pays just as plainly as monthlyAmount does.
 */
export const PRIVATE_SETTING_KEYS = [
  'plan', 'planName', 'monthlyAmount', 'billingStatus', 'billingCycle', 'subscriptionStatus',
  'seatLimit', 'hasStripeCustomer', 'subscriptionSyncedAt', 'stripeCustomerId',
  'billingType', 'nextBillingDate',
] as const

/**
 * The trial end date reaches EVERY role — but only while it is the thing deciding access. (T60)
 *
 *   Manager: "A false 'N days left in your free trial — Upgrade' banner … /api/auth/me strips
 *   subscriptionStatus for the manager, so the app falls back to a 30-day countdown from the sign-up
 *   date." At zero, ProtectedRoute sends that manager to the paywall — on a shop the Factory says is paid.
 *
 * The browser's trial gate needs one fact for a person who may not see the commercial terms: is a
 * trial deciding whether this shop is open? So trialEndsAt is kept for them exactly when the status is
 * `trialing` (the countdown) or `canceled` (the lock), and removed otherwise. A paid shop's stale trial
 * date — the Factory keeps trial_ends_at after the first payment — therefore never locks anyone, while
 * the status word itself, and everything else about the bill, stays with the owner and admins.
 */
const TRIAL_DECIDES_ACCESS = ['trialing', 'canceled']

const getPath = (obj: any, path: string) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)

/** Set `path` to undefined, cloning only the objects along the way. */
function clearPath(root: any, path: string): void {
  const parts = path.split('.')
  let node = root
  for (let i = 0; i < parts.length - 1; i++) {
    if (node == null || typeof node !== 'object') return
    node = node[parts[i]]
  }
  if (node && typeof node === 'object') delete node[parts[parts.length - 1]]
}

export interface RedactOptions {
  /** True for owner/admin. Commercial terms are kept for them and withheld from everyone else. */
  privileged?: boolean
}

/**
 * The settings a client may see. Always returns a copy — the caller's row is never mutated, because
 * these objects come straight off a query and are reused.
 */
export function redactCompanySettings(settings: any, options: RedactOptions = {}): any {
  let source = settings
  if (typeof source === 'string') { try { source = JSON.parse(source) } catch { return settings } }
  if (!source || typeof source !== 'object') return source

  // structuredClone keeps nested objects independent; a shallow copy would let `delete` reach the row.
  const out = typeof structuredClone === 'function'
    ? structuredClone(source)
    : JSON.parse(JSON.stringify(source))

  for (const path of SECRET_SETTING_PATHS) {
    if (getPath(out, path) === undefined) continue
    clearPath(out, path)
    // …and say that one IS set, so a Settings screen can show "configured" rather than an empty box
    // that looks like nothing was ever saved — which is how an owner ends up overwriting a good key
    // with a blank one.
    const parts = path.split('.')
    const parent = parts.length > 1 ? getPath(out, parts.slice(0, -1).join('.')) : out
    if (parent && typeof parent === 'object') parent[`${parts[parts.length - 1]}Configured`] = true
  }

  if (!options.privileged) {
    if (!TRIAL_DECIDES_ACCESS.includes((out as any).subscriptionStatus)) delete (out as any).trialEndsAt
    for (const k of PRIVATE_SETTING_KEYS) delete (out as any)[k]
  }

  return out
}

/** Does this role settle the bill? Kept here so the two lists travel together. */
export const isPrivilegedRole = (role: unknown): boolean =>
  role === 'owner' || role === 'admin'

/**
 * WHAT THE COMPANY OWES US, AND WHO IT BANKS WITH, IS NOT PART OF READING THE COMPANY. (T41)
 *
 * GET /api/company carries no role gate at all — every signed-in person reads the row, which is
 * right for the name, address, logo and brand colour that the whole app renders. COMPANY_SECRETS
 * above already removes the provider credentials (VET-41 / F-26). What it does not remove is the
 * commercial relationship, and T41 found that reaching the wrong people on two verticals:
 *
 *   "Staff sees ... subscription plan / Stripe account ID in /api/company."  — Field service
 *   "/api/company gives the manager billing details while /api/billing is 403."  — Contractor
 *
 * The second is the clearer statement of the fault: the dedicated billing endpoint refuses the
 * manager, and this one hands over the same facts as a side effect of loading the shell.
 *
 * `integrations` goes in full rather than key by key, because it is an open JSON bag that providers
 * write their own account identifiers into (stripeAccountId is the one the report names, and the
 * next connector adds another without anybody revisiting this list). A denylist of keys inside an
 * extensible object is a list that is wrong as soon as it is written.
 *
 * Nothing on any screen reads either field — checked across every template's frontend and the
 * shared tenant-ui before removing them — so this costs no UI.
 */
// licenseType and lifetimeAccess joined in T61: they say which licence the shop bought, beside subscriptionTier.
export const COMPANY_COMMERCIAL = ['integrations', 'subscriptionTier', 'subscriptionStatus', 'seatLimit', 'trialEndsAt', 'billingEmail', 'licenseType', 'lifetimeAccess'] as const

/**
 * …AND THE SAME TERMS INSIDE `settings`. (T60)
 *
 *   Manager: "The top-level fields are stripped, but the nested settings object still returns plan,
 *   monthlyAmount (99), billing status, subscriptionStatus, seatLimit and hasStripeCustomer."
 *
 * billing.ts mirrors the Factory's subscription INTO company.settings, so the columns above were only
 * half of it. Measured on the live fleet, 9 of 10 tenants handed a manager the whole bill this way;
 * dispensary was clean only because its own company route already ran redactCompanySettings. It now
 * runs here too, so /api/company and /api/auth/me apply ONE rule to the blob instead of two.
 */
export function redactCompanyCommercial<T extends Record<string, any>>(row: T): T {
  if (!row) return row
  const clone: any = { ...row }
  for (const f of COMPANY_COMMERCIAL) delete clone[f]
  if (clone.settings != null) clone.settings = redactCompanySettings(clone.settings, { privileged: false })
  return clone
}
