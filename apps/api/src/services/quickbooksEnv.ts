// The ONE place that decides which QuickBooks (Intuit) credentials and environment a tenant CRM gets.
//
// Before: deployCustomer pushed QBO_* with QBO_SANDBOX defaulting to "true" while platformIntegrationEnv
// pushed QUICKBOOKS_* with QUICKBOOKS_ENVIRONMENT defaulting to "production" — for the same tenant. The
// production Factory sets neither flag, so every tenant it deployed was pointed at Intuit's sandbox by one
// variable and at production by the other. Both spellings still have readers (the shared integrations
// module prefers QBO_*, crm-dispensary reads QUICKBOOKS_*), so both are emitted — from one decision.
//
// Sandbox is opt-in: QBO_SANDBOX=true (explicit flag wins when set) or QBO_ENVIRONMENT=sandbox. Default production.
//
// Redirect URI — ONE URL is registered in the Intuit developer app, for every tenant:
//     https://twomiah-factory-api.onrender.com/api/v1/factory/integrations/qbo/callback
// (= quickbooksOnline.ts qboRedirectUri(): QBO_REDIRECT_URI on the Factory, else <API_URL>/api/v1/factory/integrations/qbo/callback).
// Intuit's development and production keys keep SEPARATE redirect lists — register it under each.
// Every tenant gets QBO_REDIRECT_URI = that URL (sent to Intuit on authorize AND token exchange) and QBO_RETURN_URL =
// <tenant backend>/api/quickbooks/callback, which the tenant signs into the OAuth state; the Factory's callback relays
// the browser there (services/qboRelay.ts). Before this every tenant sent its own callback as the redirect URI, so each
// new customer needed their URL added in Intuit's portal by hand before Connect QuickBooks worked.
import { qboRedirectUri } from './quickbooksOnline'

export interface TenantEnvVar { key: string; value: string }

/**
 * Env keys the backfill may CORRECT on an existing tenant (they are not tenant secrets and must track the Factory).
 * QBO_REDIRECT_URI and QBO_RETURN_URL are here so a code update moves an existing tenant off its own per-tenant redirect
 * URI and onto the relay (refreshPlatformIntegrationEnv, then the redeploy that loads them).
 */
export const QBO_ENVIRONMENT_KEYS: ReadonlyArray<string> = ['QBO_SANDBOX', 'QUICKBOOKS_ENVIRONMENT', 'QBO_REDIRECT_URI', 'QBO_RETURN_URL']

export function quickbooksSandbox(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = (env.QBO_SANDBOX ?? '').trim()
  // '1' means sandbox to the Factory's own connection (quickbooksOnline.ts); read as production here, the same flag
  // pointed tenants at Intuit's production API while the Factory itself used the sandbox.
  if (flag) return flag === 'true' || flag === '1'
  return (env.QBO_ENVIRONMENT ?? '').trim().toLowerCase() === 'sandbox'
}

/** Everything a tenant backend needs for QuickBooks; empty when the Factory has no Intuit app configured. */
export function quickbooksTenantEnv(backendUrl: string, env: NodeJS.ProcessEnv = process.env): TenantEnvVar[] {
  const clientId = env.QBO_CLIENT_ID, clientSecret = env.QBO_CLIENT_SECRET
  if (!clientId || !clientSecret) return []
  const sandbox = quickbooksSandbox(env)
  const out: TenantEnvVar[] = [
    { key: 'QBO_CLIENT_ID', value: clientId },
    { key: 'QBO_CLIENT_SECRET', value: clientSecret },
    { key: 'QBO_SANDBOX', value: sandbox ? 'true' : 'false' },
    { key: 'QUICKBOOKS_CLIENT_ID', value: clientId },
    { key: 'QUICKBOOKS_CLIENT_SECRET', value: clientSecret },
    { key: 'QUICKBOOKS_ENVIRONMENT', value: sandbox ? 'sandbox' : 'production' },
  ]
  // The redirect URI is the Factory's relay — the one URL registered with Intuit — and the tenant's own callback rides
  // in the signed state. No backend URL, no return URL: the tenant then cannot be relayed to, so it gets neither.
  if (backendUrl) {
    out.push({ key: 'QBO_REDIRECT_URI', value: qboRedirectUri(env) })
    out.push({ key: 'QBO_RETURN_URL', value: backendUrl.replace(/\/+$/, '') + '/api/quickbooks/callback' })
  }
  return out
}
