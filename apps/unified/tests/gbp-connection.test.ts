// Google Business Profile's connection (packages/tenant-backend/src/gbp.ts as the unified app mounts it): Google's tokens
// sealed at rest with the tenant's own key — as the privacy policy says and as the calendar tokens are — a row stored
// before sealing still read, and Disconnect revoking the access at Google before deleting it. Google is a stand-in.
import { test, expect, beforeAll, afterEach } from 'bun:test'
import { bootTenant, seedOwner } from './harness.ts'
import { decrypt } from '../server/core/crypto.ts'

process.env.ENCRYPTION_KEY ||= 'test-encryption-key'
process.env.FACTORY_SYNC_KEY = 'factory-key'

let t: Awaited<ReturnType<typeof bootTenant>>
let owner = ''
const realFetch = globalThis.fetch
const revoked: string[] = []

beforeAll(async () => {
  t = await bootTenant()
  const { password } = await seedOwner(t)
  owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password } })).json()).accessToken
}, 120_000)
afterEach(() => { globalThis.fetch = realFetch })

/** Google's revoke endpoint, stood in; everything else goes to the real fetch (the app's own calls). */
function googleRevokes(status = 200) {
  globalThis.fetch = (async (url: any, init?: any) => {
    if (String(url).startsWith('https://oauth2.googleapis.com/revoke')) { revoked.push(new URLSearchParams(String(init?.body)).get('token') || ''); return new Response('{}', { status }) }
    return realFetch(url, init)
  }) as any
}

const asOwner = (path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const store = (body: any) => t.call('/api/internal/gbp/store-tokens', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Factory-Key': 'factory-key' }, body: JSON.stringify(body) })
const row = async () => (await t.db.select().from(t.schema.gbpConnection))[0]

test("Google's tokens are stored sealed with the tenant's key, never as they came", async () => {
  expect((await store({ accessToken: 'ya29.access-one', refreshToken: '1//refresh-one', externalAccountEmail: 'owner@gmail.example' })).status).toBe(200)
  const r = await row()
  expect(r.accessToken).toMatch(/^v1\./)
  expect(r.refreshToken).toMatch(/^v1\./)
  expect(decrypt(r.accessToken)).toBe('ya29.access-one')
  expect(decrypt(r.refreshToken!)).toBe('1//refresh-one')
  const s = await (await asOwner('/api/gbp/status')).json()
  expect(s.connected).toBe(true)
})

test('Disconnect revokes the access at Google, then deletes it — and says Google confirmed', async () => {
  googleRevokes()
  const r = await asOwner('/api/gbp/disconnect', { method: 'POST' })
  expect(await r.json()).toEqual({ ok: true, revokedAtGoogle: true })
  expect(revoked.at(-1)).toBe('1//refresh-one')
  expect(await row()).toBeUndefined()
  expect((await (await asOwner('/api/gbp/status')).json()).connected).toBe(false)
})

test('a row stored before sealing still disconnects with its own token; Google unreachable still deletes it', async () => {
  await t.db.insert(t.schema.gbpConnection).values({ accessToken: 'ya29.plain-old', refreshToken: null })
  googleRevokes()
  expect(await (await asOwner('/api/gbp/disconnect', { method: 'POST' })).json()).toEqual({ ok: true, revokedAtGoogle: true })
  expect(revoked.at(-1)).toBe('ya29.plain-old')
  await store({ accessToken: 'ya29.access-two', refreshToken: '1//refresh-two' })
  globalThis.fetch = (async (url: any, init?: any) => (String(url).startsWith('https://oauth2.googleapis.com/revoke') ? Promise.reject(new Error('offline')) : realFetch(url, init))) as any
  expect(await (await asOwner('/api/gbp/disconnect', { method: 'POST' })).json()).toEqual({ ok: true, revokedAtGoogle: false })
  expect(await row()).toBeUndefined()
})
