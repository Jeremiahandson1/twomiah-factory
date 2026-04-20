// Default FactoryApiClient implementation — HTTP against the factory with
// X-Factory-Key auth. Reads FACTORY_URL + TENANT_ID + FACTORY_SYNC_KEY from
// env vars the factory sets on the tenant backend at deploy time.
//
// Tenant template glue typically does:
//
//   import { createFactoryApiClient } from '../shared/factoryClient'
//   const factoryClient = createFactoryApiClient()
//   const emailAliasesRoutes = createEmailAliasesRoutes({ db, emailAliasesTable, factoryApiClient: factoryClient })

import type { FactoryApiClient } from './types'

interface FullFactoryApiClient extends FactoryApiClient {
  getOffboardStatus(): Promise<{ status: string; offboardStartedAt: string | null; offboardGraceEndsAt: string | null; domain?: string | null; domainRegistrar?: string | null }>
  startOffboard(confirm: true): Promise<{ success: boolean; offboardGraceEndsAt?: string; steps?: any[]; error?: string }>
  reactivate(): Promise<{ success: boolean; error?: string }>
}

function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error('Missing env var: ' + name)
  return v
}

async function call(method: 'GET' | 'POST', path: string, body?: any): Promise<any> {
  const url = env('FACTORY_URL').replace(/\/$/, '') + path
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Factory-Key': env('FACTORY_SYNC_KEY'),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  if (!res.ok) {
    const msg = (data && data.error) ? data.error : ('Factory HTTP ' + res.status)
    throw new Error(msg)
  }
  return data
}

export function createFactoryApiClient(): FullFactoryApiClient {
  const tenantBase = () => '/api/v1/factory/customers/' + env('TENANT_ID')
  return {
    async syncEmailAlias(alias) {
      return call('POST', tenantBase() + '/email-alias-sync', alias)
    },
    async getEmailDomainStatus() {
      return call('GET', tenantBase() + '/email-domain/status')
    },
    async verifyEmailDomain() {
      return call('POST', tenantBase() + '/email-domain/verify')
    },
    async getOffboardStatus() {
      return call('GET', tenantBase() + '/offboard/status')
    },
    async startOffboard(_confirm) {
      return call('POST', tenantBase() + '/offboard', { confirm: true })
    },
    async reactivate() {
      return call('POST', tenantBase() + '/reactivate')
    },
  }
}
