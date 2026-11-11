// Parity tier 2 #12 (11/10): texting for the store (Shopify's SMS) — the shared two-way texting, offered to the store and OFF until
// the owner switches it on (it uses a number and the usage wallet), as the store's email marketing is. Through the real server as
// the store: a new store does not get it; switched on, the owner texts a customer and the thread is in the inbox; off, closed.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { getDefaultFeaturesForTemplate, getFeaturesForPlan } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', owner = '', shopper = ''
const carrier: any[] = []
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const setFeatures = async (list: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}

beforeAll(async () => {
  process.env.TWILIO_ACCOUNT_SID = 'ACtest'
  process.env.TWILIO_AUTH_TOKEN = 'test-token'
  process.env.TWILIO_PHONE_NUMBER = '+16085550100'
  t = await bootTenant({ vertical: 'store' })
  const s = await seedOwner(t)
  companyId = s.company.id
  owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
  ;(t.services as any).crm.sms.setTransport(async (params: any) => { carrier.push(params); return { sid: `SM${carrier.length}`, numSegments: '1' } })
  shopper = ((await (t.db as any).insert(t.schema.contact).values({ companyId, name: 'Sam Shopper', type: 'client', mobile: '+16085550123' }).returning())[0]).id
}, 120_000)

test('offered to the store, off until switched on', () => {
  expect(getFeaturesForPlan('crm-store')).toContain('two_way_texting')
  expect(getDefaultFeaturesForTemplate('crm-store')).not.toContain('two_way_texting')
})

test('off: the inbox is closed', async () => {
  await setFeatures([])
  expect([403, 404]).toContain((await call('/api/sms/conversations')).status)
})

test('on: the owner texts a customer, and the thread is in the inbox', async () => {
  await setFeatures(['two_way_texting'])
  const sent = await call('/api/sms/send', { method: 'POST', json: { contactId: shopper, message: 'Your order is ready for pickup.' } })
  expect(sent.status).toBeLessThan(300)
  expect(carrier.at(-1)?.Body ?? carrier.at(-1)?.body).toContain('ready for pickup')
  const list = await (await call('/api/sms/conversations')).json() as any
  const rows = Array.isArray(list) ? list : (list.data ?? list.conversations ?? [])
  expect(rows.some((r: any) => r.contactId === shopper || r.contact?.id === shopper)).toBe(true)
})
