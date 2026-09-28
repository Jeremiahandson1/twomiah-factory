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

/** Top-level settings keys that are the OWNER's business, not the whole shop's. */
export const PRIVATE_SETTING_KEYS = [
  'plan', 'planName', 'monthlyAmount', 'billingStatus', 'billingCycle', 'subscriptionStatus',
  'seatLimit', 'hasStripeCustomer', 'subscriptionSyncedAt', 'stripeCustomerId',
] as const

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

  if (!options.privileged) for (const k of PRIVATE_SETTING_KEYS) delete (out as any)[k]

  return out
}

/** Does this role settle the bill? Kept here so the two lists travel together. */
export const isPrivilegedRole = (role: unknown): boolean =>
  role === 'owner' || role === 'admin'
