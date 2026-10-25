// Tests never reach a live outside service. The developer's shell can hold real keys (ANTHROPIC_API_KEY is set on the
// owner's machine): a test that inherits one makes billed calls, asserts on text a model wrote fresh, and runs a code
// path CI (no keys) never runs. rv-permissions "a manager gets past every gate" called the real Anthropic API twice per
// run and timed out (2026-10-19). Every credential and address of an outside service the app reads is blanked here;
// a test that needs one sets its own stand-in after the harness loads.
//
// The rule, not a list alone: any variable named like a credential is blanked, plus the outside services' addresses and
// ids that do not look like one. Our own secrets the app needs to boot (JWT_*, PAYMENT_ENC_KEY, ENCRYPTION_KEY,
// FACTORY_SYNC_KEY, CRON_SECRET) are left for the harness and the tests to set.
const OURS = new Set(['JWT_SECRET', 'JWT_REFRESH_SECRET', 'PAYMENT_ENC_KEY', 'ENCRYPTION_KEY', 'FACTORY_SYNC_KEY', 'CRON_SECRET', 'QBO_STATE_SECRET', 'VAPID_PRIVATE_KEY', 'VAPID_PUBLIC_KEY'])
const CREDENTIAL = /(_API_KEY|_API_TOKEN|_SECRET_KEY|_SECRET|_AUTH_TOKEN|_ACCESS_KEY|_ACCESS_KEY_ID|_CLIENT_ID|_PASSWORD|_ACCOUNT_SID|_SERVICE_SID|_BROWSER_KEY|_PUBLISHABLE_KEY)$/
const ADDRESSES = ['DATABASE_URL', 'NEARMAP_BASE_URL', 'WISETACK_API_URL', 'OSRM_URL', 'FACTORY_URL', 'FACTORY_API_URL', 'FACTORY_SYNC_URL']

/** The names to blank, from an environment. */
export function liveKeys(env: Record<string, string | undefined>): string[] {
  return Object.keys(env).filter((k) => !OURS.has(k) && (CREDENTIAL.test(k) || ADDRESSES.includes(k)))
}

/** Blank them in this process. */
export function blankLiveKeys(env: Record<string, string | undefined> = process.env) {
  for (const k of liveKeys(env)) env[k] = ''
}

/** A copy of an environment with them blanked — for a spawned test process. */
export function withoutLiveKeys(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) if (v !== undefined) out[k] = v
  for (const k of liveKeys(out)) out[k] = ''
  return out
}
