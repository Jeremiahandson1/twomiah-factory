// Parity row 7 against Shopify Audiences and the Facebook & Google channels (2026-10-31): a saved segment as an audience on the ad
// platforms — a hashed file in Meta's and Google's formats, or sent straight to the account — and the shop's purchases reported to
// Meta (pixel + Conversions API) and Google Tag Manager. Behind store_audiences (registered not ready), against the real server;
// the platforms are answered in place (nothing leaves the machine) so the requests are checked, NOT the platforms' acceptance.
//   · NOTHING READABLE LEAVES: every identifying cell is the SHA-256 of the value normalised as the platform documents; an
//     unsubscribed customer and one with no email or phone are left out, and counted;
//   · the file and the push are audited; a refusal by the platform is a sentence and a log row, never a silent success;
//   · secrets are encrypted and never read back; only the seats that connect integrations may save them;
//   · a paid order is reported once to Meta (event id = the order number, the browser pixel's own), skipped for an unsubscribed
//     customer, and a failure never touches the order; the order-received page carries the Tag Manager purchase only when switched on.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { bootStore, paidSession } from './storeKit.ts'
import { FEATURE_MAP, getDefaultFeaturesForTemplate } from '@twomiah/tenant-backend'
import { googleRow, metaRow, normGoogleEmail, normPhoneDigits, normZip, splitName } from '../server/crm/store/audiences/hashing.ts'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
let k: Awaited<ReturnType<typeof bootStore>>
const db = () => k.t.db as any
const ON = ['dashboard', 'orders', 'products', 'contacts', 'marketing', 'store_segments', 'store_audiences']
const features = async (list: string[]) => {
  await db().update(k.S.company).set({ enabledFeatures: list }).where(eq(k.S.company.id, k.companyId))
  k.t.services.features.forgetFeatures()
}
interface Hit { url: string; method: string; body: any; form: URLSearchParams | null; headers: Record<string, string> }
const hits: Hit[] = []
let respond: (hit: Hit) => { status?: number; json: unknown } = () => ({ json: {} })
const realFetch = globalThis.fetch
let mug: any, bowl: any, ada: any, segmentId = ''
let seq = 0

async function order(who: any, p: any, o: { status?: string; email?: string } = {}) {
  const [row] = await db().insert(k.S.storeOrder).values({
    companyId: k.companyId, contactId: who.id, orderNumber: `AUD-${++seq}`, provider: 'stripe', providerSessionId: `cs_aud_${seq}`, status: o.status ?? 'paid',
    customerEmail: o.email ?? who.email ?? 'x@example.com', subtotalCents: 2000, totalCents: 2000,
  }).returning()
  await db().insert(k.S.storeOrderItem).values({ orderId: row.id, productId: p.product.id, variantId: p.variant.id, productName: p.product.name, variantName: 'Default', sku: p.variant.sku, unitPriceCents: 2000, quantity: 1, lineTotalCents: 2000 })
  return row
}

beforeAll(async () => {
  k = await bootStore()
  const inner = globalThis.fetch
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input)
    if (/^https:\/\/(graph\.facebook\.com|oauth2\.googleapis\.com|googleads\.googleapis\.com)\//.test(url)) {
      const raw = typeof init?.body === 'string' ? init.body : null
      let body: any = null
      try { body = raw ? JSON.parse(raw) : null } catch { /* a form */ }
      const hit: Hit = { url, method: String(init?.method || 'GET').toUpperCase(), body, form: raw && !body ? new URLSearchParams(raw) : null, headers: Object.fromEntries(new Headers(init?.headers || {}).entries()) }
      hits.push(hit)
      const r = respond(hit)
      return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } })
    }
    return inner(input, init)
  }) as any
  await db().insert(k.S.storeSettings).values({ companyId: k.companyId, currency: 'usd', flatShippingCents: 0, taxRateBps: 0 })
  await k.connectStripe()
  mug = await k.product({ slug: 'mug', name: 'Mug', sku: 'MUG-1', priceCents: 2000, qty: 50 })
  bowl = await k.product({ slug: 'bowl', name: 'Bowl', sku: 'BOWL-1', priceCents: 2000, qty: 50 })
  ;[ada] = await db().insert(k.S.contact).values({ companyId: k.companyId, name: 'Ada Lovelace', email: ' Ada.Lovelace@Gmail.com ', phone: '(715) 555-0100', city: 'Eau Claire', state: 'WI', zip: '54701-1234', type: 'customer' }).returning()
  const [bob] = await db().insert(k.S.contact).values({ companyId: k.companyId, name: 'Bob Baker', email: 'bob@example.com', type: 'customer', emailOptOut: true }).returning()
  const [cy] = await db().insert(k.S.contact).values({ companyId: k.companyId, name: 'Cy Nobody', type: 'customer' }).returning()
  const [di] = await db().insert(k.S.contact).values({ companyId: k.companyId, name: 'Di Dish', email: 'di@example.com', type: 'customer' }).returning()
  await order(ada, mug); await order(bob, mug); await order(cy, mug); await order(di, bowl)
  await features(ON)
  const made = await k.O('POST', '/api/admin/segments', { name: 'Mug buyers', definition: { bought: { productIds: [mug.product.id] } } })
  expect(made.status).toBe(201)
  segmentId = made.json.id
}, 120_000)
afterAll(() => { globalThis.fetch = realFetch; k.restore() })

const A = '/api/admin/audiences'

describe('offered, never switched on', () => {
  test('registered not ready and offered to the store; off, every path is refused', async () => {
    const f = FEATURE_MAP.store_audiences
    expect(f.hidden).toBe(true)
    expect(f.templates).toEqual(['crm-store'])
    expect(getDefaultFeaturesForTemplate('crm-store')).not.toContain('store_audiences')
    await features(ON.filter((x) => x !== 'store_audiences'))
    expect((await k.O('GET', A)).status).toBe(403)
    expect((await k.O('GET', `${A}/segments/${segmentId}/export?format=meta`)).status).toBe(403)
    await features(ON)
    expect((await k.O('GET', A)).status).toBe(200)
  })
})

describe('the hashing', () => {
  test('values are normalised the way each platform documents, then SHA-256 hashed', () => {
    expect(normGoogleEmail(' Ada.Lovelace@Gmail.com ')).toBe('adalovelace@gmail.com')
    expect(normGoogleEmail('A.B@example.com')).toBe('a.b@example.com') // only gmail loses its dots
    expect(normPhoneDigits('(715) 555-0100')).toBe('17155550100')
    expect(normPhoneDigits('+44 20 7946 0958')).toBe('442079460958')
    expect(normPhoneDigits('555-0100')).toBeNull() // no area code: not a number to match on
    expect(normZip('54701-1234')).toBe('54701')
    expect(splitName('Mary Jane Watson')).toEqual({ first: 'Mary', last: 'Jane Watson' })
    const row = metaRow({ name: 'Ada Lovelace', email: ' Ada.Lovelace@Gmail.com ', phone: '(715) 555-0100', mobile: null, city: 'Eau Claire', state: 'WI', zip: '54701-1234' })!
    expect(row).toEqual({ em: sha('ada.lovelace@gmail.com'), ph: sha('17155550100'), fn: sha('ada'), ln: sha('lovelace'), ct: sha('eauclaire'), st: sha('wi'), zip: sha('54701'), country: sha('us') })
    const g = googleRow({ name: 'Ada Lovelace', email: ' Ada.Lovelace@Gmail.com ', phone: '(715) 555-0100', mobile: null, city: 'Eau Claire', state: 'WI', zip: '54701-1234' })!
    expect(g).toEqual({ email: sha('adalovelace@gmail.com'), phone: sha('+17155550100'), first: sha('ada'), last: sha('lovelace'), country: 'US', zip: '54701' })
    expect(metaRow({ name: 'No One', email: null, phone: null, mobile: null, city: null, state: null, zip: null })).toBeNull()
  })
})

describe('the files', () => {
  test('Meta: the header, one hashed row for the one customer who can be sent — not the unsubscribed, not the one with nothing to match', async () => {
    const r = await k.O('GET', `${A}/segments/${segmentId}/export?format=meta`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/csv')
    expect(r.headers.get('content-disposition')).toContain('attachment')
    expect(r.text).toBe(`email,phone,fn,ln,ct,st,zip,country\r\n${[sha('ada.lovelace@gmail.com'), sha('17155550100'), sha('ada'), sha('lovelace'), sha('eauclaire'), sha('wi'), sha('54701'), sha('us')].join(',')}\r\n`)
    expect(r.text).not.toContain('@')
    expect(r.text.toLowerCase()).not.toContain('lovelace')
    expect(r.headers.get('x-audience-people')).toBe('1')
    expect(JSON.parse(r.headers.get('x-audience-left-out')!)).toEqual({ unsubscribed: 1, unmatchable: 1 })
    // Di bought something else; she is not in this segment's file.
    expect(r.text).not.toContain(sha('di@example.com'))
  })

  test('Google: Customer Match\'s header, email / phone / names hashed, country and zip as they are', async () => {
    const r = await k.O('GET', `${A}/segments/${segmentId}/export?format=google`)
    expect(r.status).toBe(200)
    expect(r.text).toBe(`Email,Phone,First Name,Last Name,Country,Zip\r\n${[sha('adalovelace@gmail.com'), sha('+17155550100'), sha('ada'), sha('lovelace'), 'US', '54701'].join(',')}\r\n`)
  })

  test('each file is audited and logged; another shop\'s or an unknown segment is a 404; a staff seat cannot', async () => {
    const audit = (await db().select().from(k.S.auditLog)).filter((a: any) => a.entity === 'store_audience' && a.action === 'export')
    expect(audit.length).toBeGreaterThanOrEqual(2)
    const log = (await k.O('GET', A)).json.log
    expect(log.filter((l: any) => l.kind === 'download' && l.status === 'ok').length).toBeGreaterThanOrEqual(2)
    expect((await k.O('GET', `${A}/segments/nope/export?format=meta`)).status).toBe(404)
    expect((await k.O('GET', `${A}/segments/${segmentId}/export?format=tiktok`)).status).toBe(400)
    expect((await k.ST('GET', `${A}/segments/${segmentId}/export?format=meta`)).status).toBe(403)
    expect((await k.ST('GET', A)).status).toBe(403)
  })
})

describe('connections', () => {
  test('secrets are saved encrypted and never read back; only a seat that connects integrations may save', async () => {
    expect((await k.ST('PUT', `${A}/settings`, { metaAccessToken: 'x' })).status).toBe(403)
    const r = await k.O('PUT', `${A}/settings`, {
      metaAdAccountId: '12345', metaAccessToken: 'EAAB-secret-token', googleCustomerId: '123-456-7890', googleDeveloperToken: 'dev-secret', googleClientId: 'client-id.apps.googleusercontent.com',
      googleClientSecret: 'client-secret', googleRefreshToken: 'refresh-secret',
    })
    expect(r.status).toBe(200)
    expect(JSON.stringify(r.json)).not.toContain('secret')
    expect(r.json.meta).toMatchObject({ adAccountId: '12345', accessTokenSet: true, canPush: true })
    expect(r.json.google).toMatchObject({ developerTokenSet: true, refreshTokenSet: true, canPush: true })
    const row = (await db().select().from(k.S.storeAudienceSetting))[0]
    for (const v of [row.metaAccessTokenEnc, row.googleDeveloperTokenEnc, row.googleClientSecretEnc, row.googleRefreshTokenEnc]) { expect(v).toBeTruthy(); expect(v).not.toContain('secret') }
    // Saving with a secret left out keeps it.
    await k.O('PUT', `${A}/settings`, { metaAdAccountId: '12345' })
    expect((await k.O('GET', A)).json.meta.accessTokenSet).toBe(true)
  })

  test('the Conversions API cannot be switched on without a token and a pixel id (set in Website settings)', async () => {
    const noToken = await k.O('PUT', `${A}/settings`, { metaCapiOn: true })
    expect(noToken.status).toBe(400)
    const noPixel = await k.O('PUT', `${A}/settings`, { metaCapiOn: true, metaCapiToken: 'capi-secret' })
    expect(noPixel.status).toBe(400)
    expect(noPixel.json.error).toContain('pixel')
  })
})

describe('sending straight to the platform', () => {
  test('Meta: a new audience for the segment, then the hashed people in the documented shape, with the token', async () => {
    hits.length = 0
    respond = (h) => (h.url.endsWith('/customaudiences') ? { json: { id: 'aud_777' } } : { json: { num_received: 1 } })
    const r = await k.O('POST', `${A}/segments/${segmentId}/push`, { platform: 'meta' })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ platform: 'meta', sent: 1, remoteId: 'aud_777', leftOut: { unsubscribed: 1, unmatchable: 1 } })
    expect(hits.length).toBe(2)
    expect(hits[0].url).toMatch(/graph\.facebook\.com\/v[\d.]+\/act_12345\/customaudiences$/)
    expect(hits[0].body).toMatchObject({ subtype: 'CUSTOM', customer_file_source: 'USER_PROVIDED_ONLY', access_token: 'EAAB-secret-token' })
    expect(hits[0].body.name).toContain('Mug buyers')
    expect(hits[1].url).toMatch(/\/aud_777\/users$/)
    expect(hits[1].body.payload.schema).toEqual(['EMAIL', 'PHONE', 'FN', 'LN', 'CT', 'ST', 'ZIP', 'COUNTRY'])
    expect(hits[1].body.payload.data).toEqual([[sha('ada.lovelace@gmail.com'), sha('17155550100'), sha('ada'), sha('lovelace'), sha('eauclaire'), sha('wi'), sha('54701'), sha('us')]])
    expect(JSON.stringify(hits)).not.toContain('Lovelace')
    const log = (await k.O('GET', A)).json.log[0]
    expect(log).toMatchObject({ platform: 'meta', kind: 'push', status: 'ok', people: 1 })
  })

  test('Meta refusing is a sentence in the reply and a failed row in the log — never a silent success', async () => {
    hits.length = 0
    respond = () => ({ status: 400, json: { error: { message: '(#200) Requires ads_management permission' } } })
    const r = await k.O('POST', `${A}/segments/${segmentId}/push`, { platform: 'meta' })
    expect(r.status).toBe(502)
    expect(r.json.code).toBe('platform_refused')
    expect(r.json.error).toContain('ads_management')
    const log = (await k.O('GET', A)).json.log[0]
    expect(log).toMatchObject({ platform: 'meta', kind: 'push', status: 'failed' })
    expect(log.detail).toContain('ads_management')
  })

  test('Google: sign in with the refresh token, make the list, start an upload job, add the hashed people, run it — with the developer token', async () => {
    await k.O('PUT', `${A}/settings`, { googleLoginCustomerId: '999-888-7777' })
    hits.length = 0
    respond = (h) => {
      if (h.url.includes('oauth2')) return { json: { access_token: 'ya29.token' } }
      if (h.url.endsWith('/userLists:mutate')) return { json: { results: [{ resourceName: 'customers/1234567890/userLists/55' }] } }
      if (h.url.endsWith('/offlineUserDataJobs:create')) return { json: { resourceName: 'customers/1234567890/offlineUserDataJobs/9' } }
      return { json: {} }
    }
    const r = await k.O('POST', `${A}/segments/${segmentId}/push`, { platform: 'google' })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ platform: 'google', sent: 1, remoteId: 'customers/1234567890/userLists/55' })
    expect(hits.map((h) => h.url.replace(/^https:\/\/[^/]+/, '').replace(/\/v\d+\//, '/vN/'))).toEqual([
      '/token', '/vN/customers/1234567890/userLists:mutate', '/vN/customers/1234567890/offlineUserDataJobs:create',
      '/vN/customers/1234567890/offlineUserDataJobs/9:addOperations', '/vN/customers/1234567890/offlineUserDataJobs/9:run',
    ])
    expect(hits[0].form!.get('refresh_token')).toBe('refresh-secret')
    expect(hits[1].headers).toMatchObject({ authorization: 'Bearer ya29.token', 'developer-token': 'dev-secret', 'login-customer-id': '9998887777' })
    expect(hits[1].body.operations[0].create.crmBasedUserList).toMatchObject({ uploadKeyType: 'CONTACT_INFO' })
    expect(hits[3].body.operations[0].create.userIdentifiers).toEqual([
      { hashedEmail: sha('adalovelace@gmail.com') }, { hashedPhoneNumber: sha('+17155550100') },
      { addressInfo: { hashedFirstName: sha('ada'), hashedLastName: sha('lovelace'), countryCode: 'US', postalCode: '54701' } },
    ])
  })

  test('not connected → 409 and nothing is sent; an empty audience is refused', async () => {
    await db().update(k.S.storeAudienceSetting).set({ metaAccessTokenEnc: null })
    hits.length = 0
    const r = await k.O('POST', `${A}/segments/${segmentId}/push`, { platform: 'meta' })
    expect(r.status).toBe(409)
    expect(r.json.code).toBe('not_connected')
    expect(hits.length).toBe(0)
    await k.O('PUT', `${A}/settings`, { metaAccessToken: 'EAAB-secret-token' })
    const none = await k.O('POST', '/api/admin/segments', { name: 'Only Bob', definition: { bought: { productIds: [bowl.product.id] }, orders: { min: 5 } } })
    const empty = await k.O('POST', `${A}/segments/${none.json.id}/push`, { platform: 'meta' })
    expect(empty.status).toBe(409)
    expect(empty.json.code).toBe('empty_audience')
  })
})

describe('purchase events', () => {
  const pay = async (email: string, who?: any) => {
    const r = await k.pub('POST', '/api/public/checkout', { items: [{ sku: 'MUG-1', quantity: 1 }], customerEmail: email })
    const sid = (r.json.url as string).split('/').pop()!
    const o = await k.orderBySession(sid)
    await k.webhook('checkout.session.completed', paidSession(sid, { amountTotal: o.totalCents, email }))
    await k.settle()
    return await k.order(o.id)
  }
  const events = () => hits.filter((h) => /\/events$/.test(h.url))

  test('a paid order is reported once to Meta with the order number as its id and the customer hashed; off, nothing is sent', async () => {
    await db().insert(k.S.website).values({ companyId: k.companyId, facebookPixelId: '4455667788', googleTagManagerId: 'GTM-ABC123' })
    hits.length = 0; respond = () => ({ json: { events_received: 1 } })
    await pay('off@example.com')
    expect(events().length).toBe(0)
    const on = await k.O('PUT', `${A}/settings`, { metaCapiOn: true, metaCapiToken: 'capi-secret', metaTestEventCode: 'TEST123' })
    expect(on.status).toBe(200)
    expect(on.json.meta).toMatchObject({ capiOn: true, capiTokenSet: true, pixelId: '4455667788' })
    const o = await pay('Buyer@Example.com')
    expect(events().length).toBe(1)
    const e = events()[0]
    expect(e.url).toMatch(/graph\.facebook\.com\/v[\d.]+\/4455667788\/events$/)
    expect(e.body.access_token).toBe('capi-secret')
    expect(e.body.test_event_code).toBe('TEST123')
    expect(e.body.data[0]).toMatchObject({ event_name: 'Purchase', event_id: o.orderNumber, action_source: 'website' })
    expect(e.body.data[0].user_data.em).toEqual([sha('buyer@example.com')])
    expect(e.body.data[0].custom_data).toMatchObject({ currency: 'USD', value: o.totalCents / 100, order_id: o.orderNumber })
    expect(JSON.stringify(e.body)).not.toContain('Buyer@Example.com')
    expect((await k.O('GET', A)).json.log[0]).toMatchObject({ platform: 'meta_capi', kind: 'event', status: 'ok' })
  })

  test('a customer who unsubscribed is not reported; a platform failure is logged and the order is still paid', async () => {
    hits.length = 0
    await db().insert(k.S.contact).values({ companyId: k.companyId, name: 'Quiet Qi', email: 'quiet@example.com', type: 'customer', emailOptOut: true })
    const quiet = await pay('quiet@example.com')
    expect(quiet.status).toBe('paid')
    expect(events().length).toBe(0)
    respond = () => ({ status: 400, json: { error: { message: 'Invalid OAuth access token' } } })
    const failed = await pay('late@example.com')
    expect(failed.status).toBe('paid')
    expect(events().length).toBe(1)
    const log = (await k.O('GET', A)).json.log[0]
    expect(log).toMatchObject({ platform: 'meta_capi', status: 'failed' })
    expect(log.detail).toContain('Invalid OAuth access token')
    respond = () => ({ json: {} })
    // Feature off: not reported even though the switch is still on.
    hits.length = 0
    await features(ON.filter((x) => x !== 'store_audiences'))
    await pay('nofeature@example.com')
    await features(ON)
    expect(events().length).toBe(0)
  })

  test('the order-received page carries the Tag Manager purchase and the pixel Purchase only when switched on, only for a paid order', async () => {
    const paid = (await db().select().from(k.S.storeOrder)).find((o: any) => o.customerEmail === 'buyer@example.com' || o.customerEmail === 'Buyer@Example.com')
    const page = async (ref: string) => (await k.t.call(`/checkout/success?ref=${ref}`)).text()
    expect(await page(paid.id)).not.toContain("event:'purchase'")
    await k.O('PUT', `${A}/settings`, { purchaseEventsOn: true })
    const html = await page(paid.id)
    expect(html).toContain("event:'purchase'")
    expect(html).toContain(`"id":"${paid.orderNumber}"`)
    expect(html).toContain("fbq('track','Purchase'")
    expect(html).toContain('eventID:p.id')
    const [pending] = await db().insert(k.S.storeOrder).values({ companyId: k.companyId, orderNumber: 'AUD-PEND', provider: 'stripe', providerSessionId: 'cs_pending_x', status: 'pending', customerEmail: 'p@example.com', subtotalCents: 2000, totalCents: 2000 }).returning()
    expect(await page(pending.id)).not.toContain("event:'purchase'")
    await features(ON.filter((x) => x !== 'store_audiences'))
    expect(await page(paid.id)).not.toContain("event:'purchase'")
    await features(ON)
  })
})
