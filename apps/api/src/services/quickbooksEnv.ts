// The ONE place that decides which QuickBooks (Intuit) credentials and environment a tenant CRM gets.
//
// Before: deployCustomer pushed QBO_* with QBO_SANDBOX defaulting to "true" while platformIntegrationEnv
// pushed QUICKBOOKS_* with QUICKBOOKS_ENVIRONMENT defaulting to "production" — for the same tenant. The
// production Factory sets neither flag, so every tenant it deployed was pointed at Intuit's sandbox by one
// variable and at production by the other. Both spellings still have readers (the shared integrations
// module prefers QBO_*, crm-dispensary reads QUICKBOOKS_*), so both are emitted — from one decision.
//
// Sandbox is opt-in: QBO_SANDBOX=true (explicit flag wins when set) or QBO_ENVIRONMENT=sandbox. Default production.
export interface TenantEnvVar { key: string; value: string }

/** Env keys the backfill may CORRECT on an existing tenant (they are not tenant secrets and must track the Factory). */
export const QBO_ENVIRONMENT_KEYS: ReadonlyArray<string> = ['QBO_SANDBOX', 'QUICKBOOKS_ENVIRONMENT']

export function quickbooksSandbox(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = (env.QBO_SANDBOX ?? '').trim()
  if (flag) return flag === 'true'
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
  // The redirect URI is the tenant's own backend host (it must also be registered in the Intuit app).
  if (backendUrl) out.push({ key: 'QBO_REDIRECT_URI', value: backendUrl.replace(/\/+$/, '') + '/api/quickbooks/callback' })
  return out
}
