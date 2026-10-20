// The CRM add-on (apps/api/src/services/crmAddonProvision.ts) is a premium-site upgrade. A unified tenant's one service
// already is its CRM: the add-on answers "provisioned" and calls nothing — no premium site, no Render. A premium tenant
// still goes the old way (its first refusals are unchanged).
import { test, expect, mock } from 'bun:test'
import path from 'node:path'

let tenant: any = null
const supabase = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: tenant, error: null }) }) }) }) }
mock.module(path.resolve(import.meta.dir, '../../../apps/api/src/middleware/auth.ts'), () => ({ supabase, authenticate: async () => {}, requireRole: () => async () => {} }))
const fetched: string[] = []
globalThis.fetch = (async (input: any) => { fetched.push(String(input?.url ?? input)); return new Response('{}', { status: 500 }) }) as any
delete process.env.RESEND_API_KEY

const { provisionCrmAddonForTenant } = await import('../../../apps/api/src/services/crmAddonProvision')

test('a unified tenant: already has its CRM; nothing is called', async () => {
  tenant = { id: 't1', slug: 'acme', engine: 'unified', products: ['crm', 'website'], factory_sync_key: 'k' }
  expect(await provisionCrmAddonForTenant('t1')).toEqual({ success: true })
  tenant = { id: 't1', slug: 'acme', engine: 'unified', products: ['website'], factory_sync_key: 'k' }
  expect(await provisionCrmAddonForTenant('t1')).toEqual({ success: true })
  expect(fetched).toEqual([])
})

test('a template tenant: as before', async () => {
  tenant = { id: 't2', slug: 'acme', products: ['website-premium', 'crm'] }
  expect(await provisionCrmAddonForTenant('t2')).toEqual({ success: true })
  tenant = { id: 't2', slug: 'acme', products: ['website'] }
  const r = await provisionCrmAddonForTenant('t2')
  expect(r.success).toBe(false)
  expect(r.error).toContain('premium-only upgrade path')
})
