// Parity row 8 against Shopify's app list, Admin API and webhooks (2026-10-31): Apps & integrations — a catalogue of the shop's
// connected accounts with their state and settings, a public store API with per-shop keys and scopes, and outgoing signed webhooks
// (order created, paid, fulfilled, refunded; product and stock changed) with retries and a delivery log. Behind store_apps,
// store_api and store_webhooks (registered not ready), against the real server; the receiver is a stand-in (nothing leaves the
// machine), so what is checked is what the shop SENDS and how it behaves when the receiver fails — not any real receiver.
//   · a key is shown once, only its hash is kept, it can do only what its scopes say, and a revoked or unknown key is not a key;
//   · the API and the webhooks show what a buyer-facing system may know — never costs, internal notes or supplier details;
//   · every webhook is signed (timestamp + HMAC of the exact body), carries its event id, and is sent to a public https address only —
//     checked when saved and again before each send; a failure never touches the order;
//   · a failed delivery is tried again after 1 min, 5 min, 30 min, 2 h, 6 h, then given up, and stays in the log for "Send again".
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { bootStore, paidSession } from './storeKit.ts'
import { FEATURE_MAP, getDefaultFeaturesForTemplate } from '@twomiah/tenant-backend'
import { storeEventsFor } from '../server/crm/store/apps/events.ts'
import { MAX_ATTEMPTS, RETRY_MINUTES, verifySignature } from '../server/crm/store/apps/webhooks.ts'
import { decrypt } from '../server/core/crypto.ts'

let k: Awaited<ReturnType<typeof bootStore>>
const db = () => k.t.db as any
const BASE = ['dashboard', 'orders', 'products', 'contacts']
const ALL = [...BASE, 'store_apps', 'store_api', 'store_webhooks']
const features = async (list: string[]) => {
  await db().update(k.S.company).set({ enabledFeatures: list }).where(eq(k.S.company.id, k.companyId))
  k.t.services.features.forgetFeatures()
}
const hub = () => storeEventsFor(k.t.services.crm)!
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

// ── the stand-in receiver ──────────────────────────────────────────────────────────────────────────────────────────
interface Hit { url: string; headers: Record<string, string>; body: string }
const hits: Hit[] = []
let answer: (hit: Hit) => number | Error = () => 200
const realFetch = globalThis.fetch
const GOOD = 'https://8.8.8.8/hooks/shop'
const hitsFor = (url: string, type?: string) => hits.filter((h) => h.url === url && (!type || h.headers['x-twomiah-event'] === type))
const sent = async (url = GOOD) => { await hub().webhooks.idle(); return hits.filter((h) => h.url === url).map((h) => ({ ...h, json: JSON.parse(h.body) })) }
const types = async (url = GOOD) => (await sent(url)).map((h) => h.headers['x-twomiah-event'])

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────
let mug: any, bowl: any, seq = 0
async function paidOrder(sku = 'MUG-1', quantity = 2) {
  const r = await k.pub('POST', '/api/public/checkout', { items: [{ sku, quantity }] })
  expect(r.status).toBe(200)
  const sid = (r.json.url as string).split('/').pop()!
  const o = await k.orderBySession(sid)
  await k.webhook('checkout.session.completed', paidSession(sid, { amountTotal: o.totalCents, email: `buyer${++seq}@example.com`, paymentIntent: `pi_apps_${seq}` }))
  await k.settle()
  return k.order(o.id)
}
const addHook = async (url = GOOD, events = ['order.created', 'order.paid', 'order.fulfilled', 'order.refunded', 'product.changed', 'stock.changed']) => {
  const r = await k.O('POST', '/api/admin/store-webhooks', { url, events })
  expect(r.status).toBe(201)
  return { id: r.json.webhook.id as string, secret: r.json.secret as string }
}
const clearHooks = async () => { await db().delete(k.S.storeWebhook); hits.length = 0; answer = () => 200 }
const makeKey = async (scopes: string[], name = 'Test key') => {
  const r = await k.O('POST', '/api/admin/store-api-keys', { name, scopes })
  expect(r.status).toBe(201)
  return { key: r.json.secret as string, id: r.json.key.id as string }
}
const api = (key: string | null, method: string, path: string, body?: unknown) =>
  k.pub(method, `/api/store/v1${path}`, body, key ? { authorization: `Bearer ${key}` } : {})

beforeAll(async () => {
  k = await bootStore()
  const inner = globalThis.fetch
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input)
    if (url.startsWith('https://8.8.8.8/')) {
      const hit: Hit = { url, headers: Object.fromEntries(new Headers(init?.headers || {}).entries()), body: String(init?.body ?? '') }
      hits.push(hit)
      const r = answer(hit)
      if (r instanceof Error) throw r
      return new Response('ok', { status: r })
    }
    return inner(input, init)
  }) as any
  await db().insert(k.S.storeSettings).values({ companyId: k.companyId, currency: 'usd', flatShippingCents: 500, taxRateBps: 0 })
  await k.connectStripe()
  mug = await k.product({ slug: 'mug', name: 'Mug', sku: 'MUG-1', priceCents: 2000, qty: 50 })
  bowl = await k.product({ slug: 'bowl', name: 'Bowl', sku: 'BOWL-1', priceCents: 1500, qty: 30 })
  // What the shop keeps to itself: a cost, a note, a supplier. None of it may reach the API or a webhook.
  await db().update(k.S.storeProductVariant).set({ costCents: 777, supplierId: 'sup_secret', lowStockAt: 3 }).where(eq(k.S.storeProductVariant.id, mug.variant.id))
  await features(ALL)
}, 120_000)
afterAll(() => { globalThis.fetch = realFetch; k.restore() })

describe('offered, never switched on', () => {
  test('registered not ready and offered to the store; off, every door is shut', async () => {
    for (const id of ['store_apps', 'store_api', 'store_webhooks']) {
      expect(FEATURE_MAP[id].hidden).toBe(true)
      expect(FEATURE_MAP[id].templates).toEqual(['crm-store'])
      expect(getDefaultFeaturesForTemplate('crm-store')).not.toContain(id)
    }
    const { key } = await makeKey(['products:read'])
    await features(BASE)
    try {
      expect((await k.O('GET', '/api/admin/apps')).status).toBe(403)
      expect((await k.O('GET', '/api/admin/store-webhooks')).status).toBe(403)
      expect((await k.O('GET', '/api/admin/store-api-keys')).status).toBe(403)
      // The API is public, so off it is not there at all (a key does not open it).
      expect((await api(key, 'GET', '/products')).status).toBe(404)
    } finally { await features(ALL) }
    expect((await api(key, 'GET', '/products')).status).toBe(200)
  })

  test('only the seats that connect integrations may see or change any of it', async () => {
    for (const path of ['/api/admin/apps', '/api/admin/store-webhooks', '/api/admin/store-api-keys']) {
      expect((await k.ST('GET', path)).status).toBe(403)
      expect((await k.M('GET', path)).status).toBe(403)
      expect((await k.O('GET', path)).status).toBe(200)
    }
    expect((await k.M('POST', '/api/admin/store-api-keys', { name: 'x', scopes: ['orders:read'] })).status).toBe(403)
    expect((await k.ST('POST', '/api/admin/store-webhooks', { url: GOOD, events: ['order.paid'] })).status).toBe(403)
  })
})

describe('the catalogue', () => {
  const app = async (id: string) => (await k.O('GET', '/api/admin/apps')).json.apps.find((a: any) => a.id === id)

  test('payments and shipping say whether they are connected, in words, with their settings', async () => {
    const pay = await app('payments')
    expect(pay.state).toBe('connected')
    expect(pay.stateLabel).toBe('Connected to Stripe')
    expect(pay.settings).toContainEqual({ label: 'Mode', value: 'Test mode' })
    expect(pay.manage).toEqual({ label: 'Open Payments', to: '/crm/payments' })
    expect((await app('shipping')).state).toBe('not_connected')
    await db().insert(k.S.shippingConfig).values({ companyId: k.companyId, provider: 'easypost', mode: 'live', credentialsEnc: 'x', connected: true })
    const ship = await app('shipping')
    expect(ship.state).toBe('connected')
    expect(ship.settings).toContainEqual({ label: 'Carrier account', value: 'EasyPost' })
    expect(ship.settings).toContainEqual({ label: 'Mode', value: 'Live' })
    expect(JSON.stringify(ship)).not.toContain('easypost') // a word, not the code
  })

  test('QuickBooks, Email Marketing and Review Requests: off until switched on, then their own state', async () => {
    expect((await app('quickbooks')).state).toBe('off')
    expect((await app('quickbooks')).manage.to).toBe('/crm/settings/features')
    await features([...ALL, 'quickbooks', 'email_marketing', 'google_reviews'])
    try {
      expect((await app('quickbooks')).state).toBe('not_connected')
      await db().insert(k.S.qbIntegration).values({ companyId: k.companyId, realmId: 'r1', refreshToken: 'x', accessToken: 'y', syncEnabled: true, lastSyncedAt: new Date('2026-10-30T15:00:00Z') })
      const qb = await app('quickbooks')
      expect(qb.state).toBe('connected')
      expect(qb.settings).toContainEqual({ label: 'Automatic sync', value: 'On' })
      expect(qb.settings.find((s: any) => s.label === 'Last synced').value).toMatch(/Oct 30, 2026/)
      expect((await app('email_marketing')).state).toBe('connected')
      expect((await app('google_reviews')).manage.to).toBe('/crm/reviews')
      // Nothing secret is carried on the page.
      expect(JSON.stringify((await k.O('GET', '/api/admin/apps')).json)).not.toMatch(/accessToken|refreshToken|"x"|"y"/)
    } finally { await features(ALL); await db().delete(k.S.qbIntegration) }
  })

  test('Google and Meta, the Store API and webhooks reflect their own state, and the page says what it leaves to outside parties', async () => {
    expect((await app('ads')).state).toBe('off') // store_audiences is not on
    await db().delete(k.S.storeApiKey) // the keys other tests made
    expect((await app('store_api')).state).toBe('not_connected')
    const { id } = await makeKey(['orders:read'], 'Catalogue key')
    const a = await app('store_api')
    expect(a.state).toBe('connected')
    expect(a.stateLabel).toBe('1 key in use')
    await k.O('DELETE', `/api/admin/store-api-keys/${id}`)
    expect((await app('store_api')).state).toBe('not_connected')
    expect((await app('store_webhooks')).state).toBe('not_connected')
    const w = await addHook()
    expect((await app('store_webhooks')).stateLabel).toBe('1 address listening')
    await k.O('DELETE', `/api/admin/store-webhooks/${w.id}`)
    expect((await k.O('GET', '/api/admin/apps')).json.outsideParty).toMatch(/App Store/)
  })
})

describe('Store API keys', () => {
  test('a key is shown once; only its hash is kept; the list never carries it', async () => {
    const r = await k.O('POST', '/api/admin/store-api-keys', { name: 'Spreadsheet', scopes: ['products:read', 'inventory:read'] })
    expect(r.status).toBe(201)
    const key = r.json.secret as string
    expect(key).toMatch(/^tsk_[A-Za-z0-9_-]{32}$/)
    const [row] = await db().select().from(k.S.storeApiKey).where(eq(k.S.storeApiKey.id, r.json.key.id))
    expect(row.keyHash).toBe(sha(key))
    expect(JSON.stringify(row)).not.toContain(key)
    expect(row.prefix).toBe(key.slice(0, 10))
    const list = await k.O('GET', '/api/admin/store-api-keys')
    expect(JSON.stringify(list.json)).not.toContain(key)
    expect(JSON.stringify(list.json)).not.toContain(row.keyHash)
    expect(list.json.keys.find((x: any) => x.id === row.id).scopes).toEqual(['products:read', 'inventory:read'])
    expect(list.json.scopes.map((s: any) => s.label)).toContain('Change stock counts')
  })

  test('a name and at least one scope are required; an unknown scope is refused', async () => {
    expect((await k.O('POST', '/api/admin/store-api-keys', { name: '', scopes: ['orders:read'] })).status).toBe(400)
    expect((await k.O('POST', '/api/admin/store-api-keys', { name: 'x', scopes: [] })).status).toBe(400)
    expect((await k.O('POST', '/api/admin/store-api-keys', { name: 'x', scopes: ['orders:delete'] })).status).toBe(400)
  })

  test('no key, a made-up key and a revoked key are all 401 — and say how to send one', async () => {
    const none = await api(null, 'GET', '/products')
    expect(none.status).toBe(401)
    expect(none.json.code).toBe('invalid_api_key')
    expect(none.json.error).toMatch(/Bearer/)
    expect((await api('tsk_' + 'a'.repeat(32), 'GET', '/products')).status).toBe(401)
    expect((await api('not a key', 'GET', '/products')).status).toBe(401)
    const { key, id } = await makeKey(['products:read'])
    expect((await api(key, 'GET', '/products')).status).toBe(200)
    expect((await k.O('DELETE', `/api/admin/store-api-keys/${id}`)).status).toBe(200)
    expect((await api(key, 'GET', '/products')).status).toBe(401)
    expect((await k.O('DELETE', `/api/admin/store-api-keys/${id}`)).status).toBe(404) // already revoked
  })

  test('a key does only what its scopes say', async () => {
    const { key } = await makeKey(['products:read'])
    expect((await api(key, 'GET', '/products')).status).toBe(200)
    for (const [m, p] of [['GET', '/orders'], ['GET', '/customers'], ['GET', '/inventory']] as const) {
      const r = await api(key, m, p)
      expect(r.status).toBe(403)
      expect(r.json.code).toBe('insufficient_scope')
    }
    expect((await api(key, 'PUT', `/inventory/${mug.variant.id}`, { quantity: 1 })).status).toBe(403)
    const reader = await makeKey(['inventory:read'], 'Reader')
    expect((await api(reader.key, 'PUT', `/inventory/${mug.variant.id}`, { quantity: 1 })).status).toBe(403) // read is not write
    expect((await db().select().from(k.S.storeProductVariant).where(eq(k.S.storeProductVariant.id, mug.variant.id)))[0].inventoryQty).toBe(50)
  })

  test('last use is stamped', async () => {
    const { key, id } = await makeKey(['products:read'])
    expect((await db().select().from(k.S.storeApiKey).where(eq(k.S.storeApiKey.id, id)))[0].lastUsedAt).toBeNull()
    await api(key, 'GET', '/products')
    expect((await db().select().from(k.S.storeApiKey).where(eq(k.S.storeApiKey.id, id)))[0].lastUsedAt).not.toBeNull()
  })

  test('120 requests a minute per key, then 429 with when to come back; another key is not held up', async () => {
    const { key } = await makeKey(['products:read'], 'Busy')
    const other = await makeKey(['products:read'], 'Quiet')
    let last: any
    for (let i = 0; i < 120; i++) last = await api(key, 'GET', '/products?limit=1')
    expect(last.status).toBe(200)
    expect(last.headers.get('ratelimit-remaining')).toBe('0')
    const over = await api(key, 'GET', '/products?limit=1')
    expect(over.status).toBe(429)
    expect(over.json.code).toBe('rate_limited')
    expect(Number(over.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await api(other.key, 'GET', '/products?limit=1')).status).toBe(200)
  })
})

describe('Store API reads', () => {
  let key = ''
  beforeAll(async () => { key = (await makeKey(['products:read', 'orders:read', 'customers:read', 'inventory:read'], 'Reader')).key })

  test('products: options and pictures, in cents, with nothing the shop keeps to itself', async () => {
    const r = await api(key, 'GET', '/products')
    expect(r.status).toBe(200)
    const p = r.json.data.find((x: any) => x.slug === 'mug')
    expect(p.variants[0]).toMatchObject({ sku: 'MUG-1', priceCents: 2000, inventoryQty: 50 })
    const text = JSON.stringify(r.json)
    for (const secret of ['costCents', '777', 'sup_secret', 'supplierId', 'lowStockAt', 'reorderToQty', 'companyId']) expect(text).not.toContain(secret)
    expect((await api(key, 'GET', `/products/${mug.product.id}`)).json.data.name).toBe('Mug')
    expect((await api(key, 'GET', '/products/nope')).status).toBe(404)
  })

  test('paging: a cursor walks every product once, and the last page says so', async () => {
    for (const n of [1, 2, 3]) await k.product({ slug: `extra-${n}`, name: `Extra ${n}`, sku: `EX-${n}`, priceCents: 100 * n, qty: 5 })
    const seen: string[] = []
    let cursor: string | null = null
    for (let guard = 0; guard < 10; guard++) {
      const r: any = await api(key, 'GET', `/products?limit=2${cursor ? `&cursor=${cursor}` : ''}`)
      expect(r.json.data.length).toBeLessThanOrEqual(2)
      seen.push(...r.json.data.map((x: any) => x.id))
      cursor = r.json.nextCursor
      if (!cursor) break
    }
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen.length).toBe(5)
    expect((await api(key, 'GET', '/products?limit=500')).json.data.length).toBe(5) // over 100 is served as 100
    expect((await api(key, 'GET', '/products?limit=1000')).status).toBe(400) // the app's own page-size ceiling
    expect((await api(key, 'GET', '/products?updated_since=not-a-date')).status).toBe(400)
  })

  test('orders: only paid-or-later ones by default, a status by name, nothing internal', async () => {
    const o = await paidOrder()
    await db().update(k.S.storeOrder).set({ internalNote: 'SECRET NOTE', supplierCostCents: 4242, supplierError: 'supplier boom' }).where(eq(k.S.storeOrder.id, o.id))
    await db().update(k.S.storeOrderItem).set({ unitCostCents: 777 }).where(eq(k.S.storeOrderItem.orderId, o.id))
    await k.pub('POST', '/api/public/checkout', { items: [{ sku: 'BOWL-1', quantity: 1 }] }) // left unpaid
    const r = await api(key, 'GET', '/orders')
    expect(r.json.data.every((x: any) => x.status !== 'pending')).toBe(true)
    const mine = r.json.data.find((x: any) => x.id === o.id)
    expect(mine.totals.totalCents).toBe(o.totalCents)
    expect(mine.items[0]).toMatchObject({ sku: 'MUG-1', quantity: 2, unitPriceCents: 2000, lineTotalCents: 4000 })
    const text = JSON.stringify(r.json)
    for (const secret of ['SECRET NOTE', 'internalNote', '4242', 'supplier', 'unitCostCents', 'providerSessionId', 'recoveryToken', 'labelCostCents']) expect(text).not.toContain(secret)
    expect((await api(key, 'GET', '/orders?status=pending')).json.data.every((x: any) => x.status === 'pending')).toBe(true)
    expect((await api(key, 'GET', '/orders?status=bogus')).status).toBe(400)
    expect((await api(key, 'GET', `/orders/${o.id}`)).json.data.number).toBe(o.orderNumber)
    expect((await api(key, 'GET', '/orders/nope')).status).toBe(404)
  })

  test('customers carry their orders and spend, and whether they take marketing', async () => {
    const [ann] = await db().insert(k.S.contact).values({ companyId: k.companyId, name: 'Ann', email: 'ann@example.com', type: 'customer', emailOptOut: true }).returning()
    await db().insert(k.S.storeOrder).values({ companyId: k.companyId, contactId: ann.id, orderNumber: 'API-C1', provider: 'stripe', providerSessionId: 'cs_api_c1', status: 'paid', customerEmail: 'ann@example.com', subtotalCents: 3000, totalCents: 3000, refundedCents: 500 })
    const r = await api(key, 'GET', '/customers')
    const row = r.json.data.find((x: any) => x.id === ann.id)
    expect(row).toMatchObject({ name: 'Ann', orderCount: 1, totalSpentCents: 2500, acceptsMarketing: false })
    expect(JSON.stringify(r.json)).not.toContain('companyId')
  })

  test('inventory: one line per option', async () => {
    const r = await api(key, 'GET', '/inventory?sku=MUG-1')
    expect(r.json.data).toHaveLength(1)
    expect(r.json.data[0]).toMatchObject({ sku: 'MUG-1', productName: 'Mug', tracked: true })
    expect(JSON.stringify(r.json)).not.toContain('777')
  })
})

describe('Store API stock writes', () => {
  let key = '', untracked: any
  beforeAll(async () => {
    key = (await makeKey(['inventory:write', 'inventory:read'], 'Warehouse')).key
    untracked = await k.product({ slug: 'service', name: 'Service', sku: 'SVC-1', priceCents: 100, qty: null })
  })
  const qty = async (id: string) => (await db().select().from(k.S.storeProductVariant).where(eq(k.S.storeProductVariant.id, id)))[0].inventoryQty

  test('set a count, move it by a number, never below zero — audited, naming the key', async () => {
    const v = bowl.variant.id
    const set = await api(key, 'PUT', `/inventory/${v}`, { quantity: 12 })
    expect(set.status).toBe(200)
    expect(set.json.data).toMatchObject({ sku: 'BOWL-1', inventoryQty: 12, previous: 30 })
    expect(await qty(v)).toBe(12)
    expect((await api(key, 'PUT', `/inventory/${v}`, { adjustBy: -5 })).json.data.inventoryQty).toBe(7)
    expect((await api(key, 'PUT', `/inventory/${v}`, { adjustBy: -100 })).json.data.inventoryQty).toBe(0)
    const audit = await db().select().from(k.S.auditLog)
    expect(audit.some((a: any) => a.entity === 'product_variant' && a.entityId === v && /Warehouse/.test(JSON.stringify(a.metadata)))).toBe(true)
    await api(key, 'PUT', `/inventory/${v}`, { quantity: 30 })
  })

  test('"from" guards a count that moved since you read it; an option the shop does not count is refused', async () => {
    const v = bowl.variant.id
    const stale = await api(key, 'PUT', `/inventory/${v}`, { quantity: 99, from: 5 })
    expect(stale.status).toBe(409)
    expect(stale.json.code).toBe('inventory_changed')
    expect(await qty(v)).toBe(30)
    expect((await api(key, 'PUT', `/inventory/${v}`, { quantity: 31, from: 30 })).status).toBe(200)
    const no = await api(key, 'PUT', `/inventory/${untracked.variant.id}`, { quantity: 4 })
    expect(no.status).toBe(409)
    expect(no.json.code).toBe('stock_not_tracked')
    expect(await qty(untracked.variant.id)).toBeNull()
    await api(key, 'PUT', `/inventory/${v}`, { quantity: 30 })
  })

  test('bad bodies are refused in words; an option of nobody else’s is not found', async () => {
    const v = bowl.variant.id
    for (const body of [{}, { quantity: -1 }, { quantity: 1.5 }, { quantity: 1, adjustBy: 1 }, { quantity: 'ten' }]) expect((await api(key, 'PUT', `/inventory/${v}`, body)).status).toBe(400)
    expect((await api(key, 'PUT', '/inventory/nope', { quantity: 1 })).status).toBe(404)
    expect(await qty(v)).toBe(30)
  })
})

describe('webhooks: saving an address', () => {
  test('only a public https address is accepted — checked before it is saved', async () => {
    for (const url of ['http://8.8.8.8/h', 'https://localhost/h', 'https://127.0.0.1/h', 'https://10.0.0.5/h', 'https://169.254.169.254/latest/meta-data', 'https://user:pw@8.8.8.8/h', 'not a url']) {
      const r = await k.O('POST', '/api/admin/store-webhooks', { url, events: ['order.paid'] })
      expect(r.status).toBe(400)
      expect(r.json.fields.url).toBeTruthy()
    }
    expect(await db().select().from(k.S.storeWebhook)).toHaveLength(0)
    expect((await k.O('POST', '/api/admin/store-webhooks', { url: GOOD, events: [] })).status).toBe(400)
    expect((await k.O('POST', '/api/admin/store-webhooks', { url: GOOD, events: ['order.exploded'] })).status).toBe(400)
  })

  test('the signing secret is shown once and kept only sealed; a new one replaces it', async () => {
    const { id, secret } = await addHook()
    expect(secret).toMatch(/^whsec_/)
    const [row] = await db().select().from(k.S.storeWebhook).where(eq(k.S.storeWebhook.id, id))
    expect(row.secretEnc).not.toContain(secret)
    expect(decrypt(row.secretEnc)).toBe(secret)
    expect(JSON.stringify((await k.O('GET', '/api/admin/store-webhooks')).json)).not.toContain(secret)
    const next = (await k.O('POST', `/api/admin/store-webhooks/${id}/secret`)).json.secret
    expect(next).not.toBe(secret)
    expect(decrypt((await db().select().from(k.S.storeWebhook).where(eq(k.S.storeWebhook.id, id)))[0].secretEnc)).toBe(next)
    // A changed address is checked again.
    expect((await k.O('PATCH', `/api/admin/store-webhooks/${id}`, { url: 'https://192.168.1.1/x' })).status).toBe(400)
    await clearHooks()
  })
})

describe('webhooks: what is sent, and when', () => {
  test('a paid order sends created, paid and the stock it used — signed, with one event id each, and nothing internal', async () => {
    await clearHooks()
    const { secret } = await addHook()
    const before = (await db().select().from(k.S.storeProductVariant).where(eq(k.S.storeProductVariant.id, mug.variant.id)))[0].inventoryQty
    const o = await paidOrder()
    await db().update(k.S.storeOrder).set({ internalNote: 'SECRET NOTE' }).where(eq(k.S.storeOrder.id, o.id))
    expect((await types()).sort()).toEqual(['order.created', 'order.paid', 'stock.changed'])
    const all = await sent()
    for (const h of all) {
      const sig = h.headers['x-twomiah-signature']
      expect(verifySignature(secret, sig, h.body)).toBe(true)
      expect(verifySignature(secret, sig, h.body + ' ')).toBe(false) // a changed body
      expect(verifySignature('whsec_wrong', sig, h.body)).toBe(false)
      expect(h.json.id).toBe(h.headers['x-twomiah-event-id'])
      expect(h.json.type).toBe(h.headers['x-twomiah-event'])
      expect(h.headers['x-twomiah-attempt']).toBe('1')
      expect(h.headers['x-twomiah-delivery']).toBeTruthy()
      expect(h.headers['content-type']).toBe('application/json')
    }
    const paid = all.find((h) => h.json.type === 'order.paid')!.json
    expect(paid.data.order).toMatchObject({ id: o.id, number: o.orderNumber, status: 'paid', currency: 'usd' })
    expect(paid.data.order.totals.totalCents).toBe(o.totalCents)
    expect(paid.data.order.items[0]).toMatchObject({ sku: 'MUG-1', quantity: 2, unitPriceCents: 2000 })
    for (const h of all) for (const secretWord of ['SECRET NOTE', 'internalNote', 'unitCostCents', 'costCents', 'sup_secret', 'supplierOrderId', 'providerSessionId']) expect(h.body).not.toContain(secretWord)
    const stock = all.find((h) => h.json.type === 'stock.changed')!.json
    expect(stock.data.stock).toMatchObject({ sku: 'MUG-1', inventoryQty: before - 2 })
    // The same event is sent with the same id however many addresses ask for it.
    expect(new Set(all.map((h) => h.json.id)).size).toBe(3)
  })

  test('a checkout nobody paid for is not an order and says nothing; a replayed payment notice says nothing twice', async () => {
    hits.length = 0
    await k.pub('POST', '/api/public/checkout', { items: [{ sku: 'BOWL-1', quantity: 1 }] })
    await k.settle()
    expect(await types()).toEqual([])
    const o = await paidOrder('BOWL-1', 1)
    const first = (await types()).length
    expect(first).toBe(3)
    const r = await k.orderBySession(o.providerSessionId)
    await k.webhook('checkout.session.completed', paidSession(r.providerSessionId, { amountTotal: r.totalCents, email: 'again@example.com', paymentIntent: 'pi_replay' }))
    await k.settle()
    expect((await types()).length).toBe(first)
  })

  test('fulfilled is sent the first time the order goes out, not again when it is delivered', async () => {
    hits.length = 0
    const o = await paidOrder()
    hits.length = 0
    expect((await k.O('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'shipped' })).status).toBe(200)
    expect(await types()).toEqual(['order.fulfilled'])
    expect((await sent())[0].json.data.order).toMatchObject({ id: o.id, status: 'shipped' })
    expect((await sent())[0].json.data.order.fulfilledAt).toBeTruthy()
    hits.length = 0
    expect((await k.O('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'delivered' })).status).toBe(200)
    expect(await types()).toEqual([])
  })

  test('fulfilled is also sent by "save and mark shipped"', async () => {
    const o = await paidOrder()
    hits.length = 0
    const r = await k.O('PATCH', `/api/admin/orders/${o.id}/fulfillment`, { trackingCarrier: 'UPS', trackingNumber: '1Z999', markShipped: true })
    expect(r.status).toBe(200)
    const got = await sent()
    expect(got.map((h) => h.headers['x-twomiah-event'])).toEqual(['order.fulfilled'])
    expect(got[0].json.data.order.tracking).toEqual({ carrier: 'UPS', number: '1Z999' })
  })

  test('refunded is sent for a part refund and a whole one, with the stock that went back', async () => {
    const o = await paidOrder()
    const items = await db().select().from(k.S.storeOrderItem).where(eq(k.S.storeOrderItem.orderId, o.id))
    hits.length = 0
    const part = await k.O('POST', `/api/admin/orders/${o.id}/refunds`, { items: [{ orderItemId: items[0].id, quantity: 1 }], shippingCents: 0, restock: true })
    expect(part.status).toBe(200)
    const got = await sent()
    expect(got.map((h) => h.headers['x-twomiah-event']).sort()).toEqual(['order.refunded', 'stock.changed'])
    expect(got.find((h) => h.json.type === 'order.refunded')!.json.data.order.totals.refundedCents).toBe(2000)
    hits.length = 0
    const whole = await k.O('PATCH', `/api/admin/orders/${o.id}/status`, { status: 'refunded' })
    expect(whole.status).toBe(200)
    expect((await types()).filter((t) => t === 'order.refunded')).toHaveLength(1)
    expect((await sent()).find((h) => h.json.type === 'order.refunded')!.json.data.order.status).toBe('refunded')
  })

  test('product changes (made, edited, a photo, an option, removed) and stock edits are sent', async () => {
    hits.length = 0
    const made = await k.O('POST', '/api/admin/products', { name: 'Kettle', slug: 'kettle', status: 'active' })
    expect(made.status).toBe(201)
    const id = made.json.id
    expect((await k.O('PATCH', `/api/admin/products/${id}`, { name: 'Kettle Pro' })).status).toBe(200)
    const v = await k.O('POST', `/api/admin/products/${id}/variants`, { sku: 'KET-1', name: 'Default', priceCents: 4500, inventoryQty: 8 })
    expect(v.status).toBe(201)
    expect((await k.O('PATCH', `/api/admin/products/variants/${v.json.id}`, { inventoryQty: 6, inventoryFrom: 8 })).status).toBe(200)
    expect((await k.O('POST', `/api/admin/products/${id}/images`, { url: 'https://img.example/k.png', alt: 'Kettle' })).status).toBe(201)
    const got = await sent()
    const changes = got.filter((h) => h.json.type === 'product.changed')
    expect(changes.length).toBeGreaterThanOrEqual(5)
    expect(changes.some((h) => h.json.data.product.name === 'Kettle Pro')).toBe(true)
    const last = changes[changes.length - 1].json.data.product
    expect(last.variants[0]).toMatchObject({ sku: 'KET-1', priceCents: 4500, inventoryQty: 6 })
    expect(last.images[0].url).toBe('https://img.example/k.png')
    expect(JSON.stringify(changes.map((h) => h.body))).not.toContain('costCents')
    const stock = got.filter((h) => h.json.type === 'stock.changed').map((h) => h.json.data.stock.inventoryQty)
    expect(stock).toEqual([8, 6]) // set when the option was made, then edited
    hits.length = 0
    expect((await k.O('DELETE', `/api/admin/products/${id}`)).status).toBe(200)
    const gone = (await sent()).find((h) => h.json.type === 'product.changed')!.json.data
    expect(gone).toEqual({ deleted: true, product: { id } })
  })

  test('a count written through the API is sent as a stock change', async () => {
    const { key } = await makeKey(['inventory:write'], 'Sync')
    hits.length = 0
    expect((await api(key, 'PUT', `/inventory/${bowl.variant.id}`, { quantity: 21 })).status).toBe(200)
    const got = await sent()
    expect(got.map((h) => h.headers['x-twomiah-event'])).toEqual(['stock.changed'])
    expect(got[0].json.data.stock).toMatchObject({ sku: 'BOWL-1', inventoryQty: 21 })
  })

  test('stock received against a supplier order is sent', async () => {
    await db().update(k.S.company).set({ enabledFeatures: [...ALL, 'store_reorders'] }).where(eq(k.S.company.id, k.companyId)); k.t.services.features.forgetFeatures()
    try {
      const [sup] = await db().insert(k.S.storeSupplier).values({ companyId: k.companyId, name: 'Acme', email: 'orders@acme.test' }).returning()
      const [po] = await db().insert(k.S.storePurchaseOrder).values({ companyId: k.companyId, supplierId: sup.id, number: 'PO-APPS-1', status: 'sent' }).returning()
      const [line] = await db().insert(k.S.storePurchaseOrderLine).values({ purchaseOrderId: po.id, variantId: bowl.variant.id, sku: 'BOWL-1', name: 'Bowl', quantity: 10, receivedQuantity: 0, unitCostCents: 500 }).returning()
      hits.length = 0
      const r = await k.O('POST', `/api/admin/reorders/${po.id}/receive`, { lines: [{ lineId: line.id, quantity: 4 }] })
      expect(r.status).toBe(200)
      const got = await sent()
      expect(got.map((h) => h.headers['x-twomiah-event'])).toEqual(['stock.changed'])
      expect(got[0].json.data.stock.sku).toBe('BOWL-1')
    } finally { await features(ALL) }
  })

  test('an address gets only the events it asked for; a switched-off address and a switched-off feature get nothing', async () => {
    await clearHooks()
    const only = await addHook('https://8.8.8.8/only-products', ['product.changed'])
    const everything = await addHook('https://8.8.8.8/everything')
    await paidOrder()
    expect(await types('https://8.8.8.8/only-products')).toEqual([])
    expect((await types('https://8.8.8.8/everything')).length).toBe(3)
    expect((await k.O('PATCH', `/api/admin/store-webhooks/${everything.id}`, { active: false })).status).toBe(200)
    hits.length = 0
    await paidOrder()
    expect(hits).toHaveLength(0)
    await k.O('PATCH', `/api/admin/store-webhooks/${everything.id}`, { active: true })
    await features(BASE)
    try { await paidOrder(); expect(hits).toHaveLength(0) } finally { await features(ALL) }
    void only
    await clearHooks()
  })
})

describe('webhooks: when the receiver fails', () => {
  test('the order is paid whatever the receiver does', async () => {
    await clearHooks()
    await addHook()
    answer = () => new Error('connection refused')
    const o = await paidOrder()
    expect(o.status).toBe('paid')
    await hub().webhooks.idle()
    const rows = await db().select().from(k.S.storeWebhookDelivery)
    expect(rows.length).toBe(3)
    expect(rows.every((r: any) => r.status === 'pending' && r.attempts === 1 && /connection refused/.test(r.error))).toBe(true)
  })

  test('tried again after 1 min, 5 min, 30 min, 2 h, 6 h — then given up and kept in the log', async () => {
    await clearHooks()
    const { id } = await addHook(GOOD, ['order.paid'])
    answer = () => 500
    await paidOrder()
    await hub().webhooks.idle()
    const row = async () => (await db().select().from(k.S.storeWebhookDelivery))[0]
    let r = await row()
    expect(r).toMatchObject({ status: 'pending', attempts: 1, responseStatus: 500 })
    expect(r.error).toBe('The address answered 500.')
    expect(RETRY_MINUTES).toEqual([1, 5, 30, 120, 360])
    let clock = new Date(r.lastAttemptAt)
    for (let i = 0; i < RETRY_MINUTES.length; i++) {
      // Not before it is due …
      const early = new Date(clock.getTime() + (RETRY_MINUTES[i] * 60_000 - 5_000))
      const hitsBefore = hits.length
      expect(await hub().webhooks.sweep(early)).toBe(0)
      expect(hits.length).toBe(hitsBefore)
      // … and at the minute it is.
      expect(new Date((await row()).nextAttemptAt).getTime() - clock.getTime()).toBe(RETRY_MINUTES[i] * 60_000)
      clock = new Date(clock.getTime() + RETRY_MINUTES[i] * 60_000)
      expect(await hub().webhooks.sweep(clock)).toBe(1)
      r = await row()
      expect(r.attempts).toBe(i + 2)
    }
    expect(r).toMatchObject({ status: 'dead', attempts: MAX_ATTEMPTS, nextAttemptAt: null })
    expect(hitsFor(GOOD, 'order.paid')).toHaveLength(MAX_ATTEMPTS)
    expect(hitsFor(GOOD)[MAX_ATTEMPTS - 1].headers['x-twomiah-attempt']).toBe(String(MAX_ATTEMPTS))
    // Every try carries the SAME event id; a later one is signed fresh.
    expect(new Set(hitsFor(GOOD).map((h) => h.headers['x-twomiah-event-id'])).size).toBe(1)
    expect(await hub().webhooks.sweep(new Date(clock.getTime() + 86_400_000))).toBe(0) // dead means dead
    const hook = (await db().select().from(k.S.storeWebhook).where(eq(k.S.storeWebhook.id, id)))[0]
    expect(hook.failureCount).toBe(MAX_ATTEMPTS)
    expect(hook.lastStatus).toBe(500)
  })

  test('a retry that works is delivered, and the failures in a row start again from zero', async () => {
    await clearHooks()
    const { id } = await addHook(GOOD, ['order.paid'])
    answer = () => 503
    await paidOrder()
    await hub().webhooks.idle()
    expect((await db().select().from(k.S.storeWebhook).where(eq(k.S.storeWebhook.id, id)))[0].failureCount).toBe(1)
    answer = () => 200
    const due = new Date(Date.now() + 61_000)
    expect(await hub().webhooks.sweep(due)).toBe(1)
    const r = (await db().select().from(k.S.storeWebhookDelivery))[0]
    expect(r).toMatchObject({ status: 'delivered', attempts: 2, responseStatus: 200, error: null, nextAttemptAt: null })
    expect(r.deliveredAt).not.toBeNull()
    expect((await db().select().from(k.S.storeWebhook).where(eq(k.S.storeWebhook.id, id)))[0].failureCount).toBe(0)
  })

  test('two sweeps at once send a delivery once', async () => {
    await clearHooks()
    await addHook(GOOD, ['order.paid'])
    answer = () => 500
    await paidOrder()
    await hub().webhooks.idle()
    answer = () => 200
    const due = new Date(Date.now() + 61_000)
    hits.length = 0
    const [a, b] = await Promise.all([hub().webhooks.sweep(due), hub().webhooks.sweep(due)])
    expect(a + b).toBe(1)
    expect(hits).toHaveLength(1)
  })

  test('a redirect is not a delivery (the address must answer itself)', async () => {
    await clearHooks()
    await addHook(GOOD, ['order.paid'])
    answer = () => 302
    await paidOrder()
    await hub().webhooks.idle()
    expect((await db().select().from(k.S.storeWebhookDelivery))[0]).toMatchObject({ status: 'pending', responseStatus: 302 })
  })

  test('the address is checked again before each send: one that now points inside is never called', async () => {
    await clearHooks()
    const { id } = await addHook(GOOD, ['order.paid'])
    answer = () => 500
    await paidOrder()
    await hub().webhooks.idle()
    // The name now resolves somewhere private (stood in for by changing the stored address).
    await db().update(k.S.storeWebhook).set({ url: 'https://169.254.169.254/latest' }).where(eq(k.S.storeWebhook.id, id))
    hits.length = 0
    expect(await hub().webhooks.sweep(new Date(Date.now() + 61_000))).toBe(1)
    expect(hits).toHaveLength(0)
    const r = (await db().select().from(k.S.storeWebhookDelivery))[0]
    expect(r.attempts).toBe(2)
    expect(r.error).toMatch(/not on the public internet/)
  })
})

describe('webhooks: the delivery log', () => {
  test('the log says what happened in words, shows the exact message, and "Send again" tries a given-up delivery once more', async () => {
    await clearHooks()
    const { id, secret } = await addHook(GOOD, ['order.paid'])
    answer = () => 500
    await paidOrder()
    await hub().webhooks.idle()
    for (let i = 0; i < RETRY_MINUTES.length; i++) await hub().webhooks.sweep(new Date(Date.now() + 7 * 3_600_000 * (i + 1)))
    const listed = (await k.O('GET', '/api/admin/store-webhooks')).json
    const d = listed.deliveries[0]
    expect(d).toMatchObject({ eventLabel: 'Order paid', statusLabel: 'Gave up', status: 'dead', attempts: MAX_ATTEMPTS })
    expect(listed.retryNote).toMatch(/1 min, 5 min, 30 min, 2 h, 6 h/)
    expect(JSON.stringify(listed.deliveries)).not.toContain('payload') // the log is a list; the message is opened on its own
    const one = (await k.O('GET', `/api/admin/store-webhooks/deliveries/${d.id}`)).json
    expect(JSON.parse(one.body).type).toBe('order.paid')
    expect(verifySignature(secret, hitsFor(GOOD)[0].headers['x-twomiah-signature'], one.body)).toBe(true) // the body shown is the body signed
    // It is not delivered yet → "Send again" with a receiver that is up.
    answer = () => 200
    hits.length = 0
    const again = await k.O('POST', `/api/admin/store-webhooks/deliveries/${d.id}/send-again`)
    expect(again.json).toMatchObject({ ok: true, status: 200 })
    expect(again.json.delivery.statusLabel).toBe('Delivered')
    expect(hits[0].body).toBe(one.body)
    // Still down: it stays given up (one try, no new round of retries).
    answer = () => 500
    const down = await k.O('POST', `/api/admin/store-webhooks/deliveries/${d.id}/send-again`)
    expect(down.json.ok).toBe(false)
    expect(down.json.delivery.status).toBe('dead')
    expect((await k.O('POST', '/api/admin/store-webhooks/deliveries/nope/send-again')).status).toBe(404)
    void id
  })

  test('"Send a test" delivers a test message now and does not retry', async () => {
    await clearHooks()
    const { id, secret } = await addHook(GOOD, ['order.paid'])
    hits.length = 0
    const ok = await k.O('POST', `/api/admin/store-webhooks/${id}/test`)
    expect(ok.json).toMatchObject({ ok: true, status: 200 })
    expect(hits[0].headers['x-twomiah-event']).toBe('webhook.test')
    expect(verifySignature(secret, hits[0].headers['x-twomiah-signature'], hits[0].body)).toBe(true)
    answer = () => 410
    const bad = await k.O('POST', `/api/admin/store-webhooks/${id}/test`)
    expect(bad.json).toMatchObject({ ok: false, status: 410 })
    expect(bad.json.error).toBe('The address answered 410.')
    const rows = await db().select().from(k.S.storeWebhookDelivery)
    expect(rows.find((r: any) => r.status === 'dead')).toBeTruthy()
    expect(rows.some((r: any) => r.status === 'pending')).toBe(false)
    expect((await k.O('GET', '/api/admin/store-webhooks')).json.deliveries.find((x: any) => x.status === 'dead').eventLabel).toBe('Test message')
  })

  test('a new secret signs from then on; the old one no longer verifies', async () => {
    await clearHooks()
    const { id, secret } = await addHook(GOOD, ['order.paid'])
    const next = (await k.O('POST', `/api/admin/store-webhooks/${id}/secret`)).json.secret
    hits.length = 0
    await k.O('POST', `/api/admin/store-webhooks/${id}/test`)
    const h = hits[0]
    expect(verifySignature(next, h.headers['x-twomiah-signature'], h.body)).toBe(true)
    expect(verifySignature(secret, h.headers['x-twomiah-signature'], h.body)).toBe(false)
  })

  test('a signature too old is refused by the receiver’s check, so a captured message cannot be replayed later', async () => {
    const secret = 'whsec_x'
    const body = '{"a":1}'
    const t = 1_000_000
    const sig = `t=${t},v1=${(await import('../server/crm/store/apps/webhooks.ts')).signBody(secret, t, body)}`
    expect(verifySignature(secret, sig, body, t + 10)).toBe(true)
    expect(verifySignature(secret, sig, body, t + 301)).toBe(false)
  })

  test('removing an address removes its log; the retry timer finds nothing to send for it', async () => {
    await clearHooks()
    const { id } = await addHook(GOOD, ['order.paid'])
    answer = () => 500
    await paidOrder()
    await hub().webhooks.idle()
    expect((await k.O('DELETE', `/api/admin/store-webhooks/${id}`)).status).toBe(200)
    expect(await db().select().from(k.S.storeWebhookDelivery)).toHaveLength(0)
    hits.length = 0
    expect(await hub().webhooks.sweep(new Date(Date.now() + 86_400_000))).toBe(0)
    expect(hits).toHaveLength(0)
  })

  test('the log is kept 30 days', async () => {
    await clearHooks()
    const { id } = await addHook(GOOD, ['order.paid'])
    await db().insert(k.S.storeWebhookDelivery).values({ companyId: k.companyId, webhookId: id, eventId: 'evt_old', event: 'order.paid', payload: '{}', status: 'delivered', createdAt: new Date(Date.now() - 31 * 86_400_000) })
    await db().insert(k.S.storeWebhookDelivery).values({ companyId: k.companyId, webhookId: id, eventId: 'evt_new', event: 'order.paid', payload: '{}', status: 'delivered', createdAt: new Date(Date.now() - 5 * 86_400_000) })
    await hub().webhooks.sweep()
    expect((await db().select().from(k.S.storeWebhookDelivery)).map((r: any) => r.eventId)).toEqual(['evt_new'])
    await clearHooks()
  })
})
