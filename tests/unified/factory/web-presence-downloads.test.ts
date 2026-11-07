// "Sell a download" on the $19 Web presence plan, end to end with every outside thing stood in: the site's REAL function
// (handler.mjs, its Blobs a Map), the Factory's REAL download code (downloads.ts) behind the site's signed calls, a fake Stripe that
// answers like Stripe (sessions on a connected account, payment intents), and a mail outbox. No live call is made anywhere.
// Covers: the switch (off = absent everywhere), the buy button (the offer comes from the site's own store, never the form; not
// ready = no checkout), Stripe's checkout params (the owner's account, the location question, the metadata), a sale recorded only
// from Stripe's word and only once (one email, however many deliveries), the license number, the buyer's link (expiry, another
// site, used up, refunded), the owner's file / sales / CSV / re-send, linking Stripe (nonce, single use), refunds and
// deauthorisation — and the security headers on the page and the download.
import { describe, test, expect } from 'bun:test'
import { fakeStore } from './fakeStore'
import { createHandler } from '../../../apps/api/src/webPresence/site/handler.mjs'
import { siteSecret, mintSession, mintDownload, signRequest } from '../../../apps/api/src/webPresence/site/session.mjs'
import { checkDownload, downloadOffer, cleanUsd, usdCents } from '../../../apps/api/src/webPresence/site/clean.mjs'
import { ROUTES } from '../../../apps/api/src/webPresence/site/routes.mjs'
import {
  startCheckout, saleStatus, recordSale, resendLink, handleConnectEvent, stripeStart, deliverStripeLink, stripeDisconnect, licenseFor, DownloadError,
  type DownloadDeps,
} from '../../../apps/api/src/webPresence/downloads'
import { WebPresenceOffError, downloadsOn } from '../../../apps/api/src/webPresence/switch'
import { buildSpec } from '../../../apps/api/src/webPresence/spec'
import { verifyState } from '../../../apps/api/src/services/stripeConnectOAuth'

const MASTER = 'master-key-for-tests'
const NOW = Date.UTC(2026, 10, 6, 15, 0, 0)
const ORIGIN = 'https://twomiah-hobby.netlify.app'
const ROW = { id: 'site-1', tenant_id: 't-1', netlify_site_id: 'ns-1', netlify_site_name: 'twomiah-hobby', status: 'live', origin: ORIGIN, custom_domain: null, ssl_ok: false, cancel_at: null, last_link_at: null }
const ON = { WEB_PRESENCE_ON: '1', WEB_PRESENCE_DOWNLOADS_ON: '1', WEB_PRESENCE_SECRET_KEY: MASTER }
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
const OAUTH = { clientId: 'ca_test', secretKey: 'sk_test', redirectUri: 'https://factory.test/cb', stateSecret: 'state-secret' }

const model = (over: any = {}) => ({
  v: 1, business: { name: 'The Hobby Starter' }, look: { design: 'foundry' }, forms: { lead: { on: false }, hiring: { on: false } },
  sections: [{ id: 'download', type: 'download', variant: 'buy', hidden: false, data: { name: 'Starter Kit', price: '99.00', license: 'Single-location license', ...over } }],
})

function blobs() {
  const m = new Map<string, any>(); const meta = new Map<string, any>()
  return {
    m, meta,
    get: async (k: string) => (m.has(k) ? m.get(k) : null),
    set: async (k: string, v: any, o?: any) => { if (o?.onlyIfNew && m.has(k)) return { modified: false }; m.set(k, v); if (o?.metadata) meta.set(k, o.metadata); return { modified: true } },
    getWithMetadata: async (k: string) => (m.has(k) ? { data: m.get(k), metadata: meta.get(k) } : null),
    getMetadata: async (k: string) => (m.has(k) ? { metadata: meta.get(k) } : null),
    list: async (o: { prefix: string }) => ({ blobs: [...m.keys()].filter((k) => k.startsWith(o.prefix)).map((key) => ({ key })) }),
  }
}

/** A fake Stripe: sessions made on a connected account, paid later by the test, and their payment intents. */
function fakeStripe() {
  const sessions = new Map<string, any>(); const intents = new Map<string, any>(); const made: Array<{ account: string; params: any; key: string }> = []
  let n = 0
  return {
    sessions, intents, made,
    calls: {
      createCheckout: async (account: string, params: any, key: string) => {
        made.push({ account, params, key })
        const id = 'cs_test_' + String(++n).padStart(12, '0'); const pi = 'pi_' + n
        sessions.set(id, { id, account, payment_status: 'unpaid', metadata: params.metadata, amount_total: params.line_items[0].price_data.unit_amount, currency: 'usd', created: Math.floor(NOW / 1000), payment_intent: pi, custom_fields: [], customer_details: {} })
        intents.set(pi, { id: pi, account, metadata: params.payment_intent_data.metadata })
        return { id, url: 'https://checkout.stripe.com/c/pay/' + id }
      },
      retrieveSession: async (account: string, id: string) => { const s = sessions.get(id); if (!s || s.account !== account) throw new Error('No such checkout.session'); return s },
      retrievePaymentIntent: async (account: string, id: string) => { const p = intents.get(id); if (!p || p.account !== account) throw new Error('No such payment_intent'); return p },
    },
    /** The buyer pays on Stripe's page. */
    pay(id: string, who = { name: 'Pat Teacher', email: 'pat@school.test' }, where = 'Lincoln Elementary, Eau Claire') {
      const s = sessions.get(id)!; s.payment_status = 'paid'; s.customer_details = who; s.custom_fields = [{ key: 'location', text: { value: where } }]
      return s
    },
  }
}

function world(o: { env?: Record<string, string>; account?: string | null; spec?: any; model?: any } = {}) {
  const env = { ...ON, ...(o.env || {}) }
  const db = fakeStore({ tenants: [{ id: 't-1', name: 'The Hobby Starter', email: 'owner@hobby.test', admin_email: 'owner@hobby.test', plan: 'webpresence', stripe_connect_account_id: o.account === undefined ? 'acct_owner1' : o.account }], web_presence_sites: [ROW] })
  const stripe = fakeStripe()
  const mail: Array<{ to: string; subject: string; html: string }> = []
  const alerts: string[] = []
  const clock = { now: NOW }
  const store = blobs()
  store.m.set('model', JSON.stringify(o.model || model()))
  let site: (r: Request) => Promise<Response>
  const d: DownloadDeps = {
    db, env, now: () => clock.now, stripe: stripe.calls,
    // The Factory's calls to the site go to the site's real function.
    fetch: async (url, init) => site(new Request(url, init)),
    sendMail: async (to, subject, html) => { mail.push({ to, subject, html }); return true },
    alert: async (k) => { alerts.push(k) },
    oauthConfig: () => OAUTH,
    deauthorize: async () => ({ ok: true }),
  }
  // The site's calls to the Factory: the routes' work, done by downloads.ts with the site row (the signature is the routes' and is
  // tested in web-presence-routes/site tests; here the body the site sends is what matters).
  const factory = async (url: string, init: any) => {
    const path = new URL(url).pathname.replace('/internal/web-presence/', '')
    const body = JSON.parse(init.body)
    const run = async () => {
      if (path === 'checkout') return startCheckout(d, ROW as any, body)
      if (path === 'sale-status') return saleStatus(d, ROW as any, body)
      if (path === 'resend') return resendLink(d, ROW as any, body)
      if (path === 'stripe/start') return stripeStart(d, ROW as any, body)
      if (path === 'stripe/disconnect') return stripeDisconnect(d, ROW as any)
      throw new Error('no route ' + path)
    }
    try { return new Response(JSON.stringify(await run()), { status: 200 }) } catch (e: any) {
      if (e instanceof WebPresenceOffError) return new Response('{"error":"Not found"}', { status: 404 })
      return new Response(JSON.stringify({ error: e.message }), { status: e instanceof DownloadError ? e.status : 500 })
    }
  }
  const spec = o.spec ?? { limits: {}, caps: buildSpec('other', { downloads: true }).caps }
  return siteSecret(MASTER, ROW.id).then((secret) => {
    site = createHandler({ store, env: { WP_SITE_ID: ROW.id, WP_SECRET: secret, WP_FACTORY_URL: 'https://factory.test', WP_TENANT_ID: 't-1', WP_FACTORY_KEY: 'k' }, fetchImpl: factory, now: () => clock.now, initial: { index: '<html/>', privacy: '', model: model() }, spec })
    const call = (path: string, init: any = {}) => site(new Request(ORIGIN + path, { ...init, headers: { host: 'twomiah-hobby.netlify.app', 'x-nf-client-connection-ip': '9.9.9.9', ...(init.headers || {}) } }))
    const owner = async () => ({ cookie: 'wp_s=' + encodeURIComponent(await mintSession(secret, ROW.id, clock.now)), 'x-wp': '1' })
    const linked = () => store.m.set('stripe', JSON.stringify({ connected: true, at: 'x' }))
    const withFile = () => { store.m.set('dl:file', ZIP); store.meta.set('dl:file', { name: 'starter-kit.zip', mime: 'application/zip', size: ZIP.length, at: 'x' }) }
    return { d, db, stripe, mail, alerts, clock, store, call, owner, linked, withFile, secret }
  })
}
const json = async (r: Response) => r.json() as Promise<any>
/** Buy → pay → the webhook. Returns the session and what recordSale answered. */
async function sell(w: Awaited<ReturnType<typeof world>>, who?: any, where?: string) {
  const r = await w.call('/api/buy', { method: 'POST' })
  expect(r.status).toBe(303)
  const id = r.headers.get('location')!.split('/').pop()!
  const s = w.stripe.pay(id, who, where)
  const out = await handleConnectEvent(w.d, { id: 't-1', stripe_connect_account_id: 'acct_owner1' }, { type: 'checkout.session.completed', account: 'acct_owner1', data: { object: s } })
  expect(out).toEqual({ status: 200, result: 'paid' })
  return { s, saleId: s.metadata.wp_sale }
}

describe('the switch', () => {
  test('only an explicit yes turns downloads on, and the plan must be on too', async () => {
    for (const v of [undefined, '', '0', 'false', 'off', 'yse']) expect(downloadsOn({ WEB_PRESENCE_DOWNLOADS_ON: v })).toBe(false)
    for (const v of ['1', 'true', 'ON', ' yes ']) expect(downloadsOn({ WEB_PRESENCE_DOWNLOADS_ON: v })).toBe(true)
    const w = await world({ env: { WEB_PRESENCE_DOWNLOADS_ON: '0' } })
    await expect(startCheckout(w.d, ROW as any, { saleId: 'abcdefgh12', origin: ORIGIN, offer: { name: 'x', priceCents: 9900 } })).rejects.toBeInstanceOf(WebPresenceOffError)
    await expect(stripeStart(w.d, ROW as any, { nonce: 'n'.repeat(32) })).rejects.toBeInstanceOf(WebPresenceOffError)
    const w2 = await world({ env: { WEB_PRESENCE_ON: '0' } })
    await expect(saleStatus(w2.d, ROW as any, { sessionId: 'cs_test_000000000001' })).rejects.toBeInstanceOf(WebPresenceOffError)
  })
  test('off, the editor is not offered the section; on, every trade is', () => {
    expect(buildSpec('roofing').caps.download).toBeUndefined()
    for (const t of ['roofing', 'salon', 'food truck', 'other', null]) expect(buildSpec(t as any, { downloads: true }).caps.download).toMatchObject({ type: 'download', anchor: 'download' })
  })
  test("a site whose spec has no download capability answers 404 on every download address", async () => {
    const w = await world({ spec: { limits: {}, caps: {} } })
    for (const [p, m] of [['/api/buy', 'POST'], ['/thanks?s=cs_test_000000000001', 'GET'], ['/download?k=x', 'GET'], ['/api/sales', 'GET'], ['/api/download/file', 'GET'], ['/api/stripe', 'GET'], ['/api/sale', 'POST'], ['/api/refund', 'POST']] as const) {
      expect([p, (await w.call(p, { method: m })).status]).toEqual([p, 404])
    }
  })
  test('every new address is one row of the one routes table (the redirect rules and the function read the same list)', () => {
    for (const p of ['/api/buy', '/thanks', '/download', '/api/download/file', '/api/sales', '/api/sales.csv', '/api/sales/resend', '/api/stripe', '/api/stripe/start', '/api/stripe/disconnect', '/api/sale', '/api/refund', '/api/stripe-link']) expect(ROUTES[p]).toBeTruthy()
  })
})

describe('prices and files', () => {
  test('a price is dollars within $1–$5,000, kept as 0.00', () => {
    expect(cleanUsd('99')).toBe('99.00'); expect(cleanUsd('$1,250.5')).toBe('1250.50'); expect(cleanUsd(19)).toBe('19.00')
    for (const bad of ['0.99', '5000.01', 'abc', '-5', '1e3', '', null]) expect(cleanUsd(bad)).toBe('')
    expect(usdCents('99.00')).toBe(9900); expect(usdCents('free')).toBeNull()
  })
  test('the file is a real ZIP or PDF, named safely, within 4 MB', () => {
    expect(checkDownload(ZIP, 'Starter Kit (v2).zip')).toMatchObject({ ok: true, ext: 'zip', name: 'Starter-Kit-v2.zip' })
    expect(checkDownload(new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 1, 1, 1]), 'guide.pdf')).toMatchObject({ ok: true, mime: 'application/pdf' })
    expect(checkDownload(ZIP, 'kit.exe').ok).toBe(false)
    expect(checkDownload(new Uint8Array([0x4d, 0x5a, 0, 0, 0, 0, 0, 0]), 'kit.zip').error).toMatch(/not really a ZIP/)
    expect(checkDownload(new Uint8Array(4_000_001).fill(0x50), 'big.zip').error).toMatch(/at most 4 MB/)
    expect(checkDownload(ZIP, '../../etc/passwd.zip')).toMatchObject({ ok: true, name: 'passwd.zip' })
  })
  test('the offer is read from the shown download section with a name and a real price, or there is none', () => {
    expect(downloadOffer(model())).toEqual({ name: 'Starter Kit', priceCents: 9900, license: 'Single-location license' })
    expect(downloadOffer(model({ price: 'free' }))).toBeNull()
    expect(downloadOffer({ sections: [{ ...model().sections[0], hidden: true }] })).toBeNull()
  })
})

describe('buying', () => {
  test('not ready (no Stripe, no file, no price) = no checkout, nothing charged', async () => {
    const w = await world()
    expect((await w.call('/api/buy', { method: 'POST' })).status).toBe(409)       // nothing linked, no file
    w.linked(); expect((await w.call('/api/buy', { method: 'POST' })).status).toBe(409)   // no file
    w.withFile(); w.store.m.set('model', JSON.stringify(model({ price: '' })))
    expect((await w.call('/api/buy', { method: 'POST' })).status).toBe(409)       // no price
    expect(w.stripe.made).toEqual([])
  })
  test("the checkout is on the OWNER's Stripe account, for the price the SITE stores (a forged form changes nothing)", async () => {
    const w = await world(); w.linked(); w.withFile()
    const r = await w.call('/api/buy', { method: 'POST', body: new URLSearchParams({ price: '1', name: 'Hacked', priceCents: '100' }) })
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toMatch(/^https:\/\/checkout\.stripe\.com\//)
    const m = w.stripe.made[0]
    expect(m.account).toBe('acct_owner1')
    expect(m.params.line_items[0].price_data).toMatchObject({ currency: 'usd', unit_amount: 9900, product_data: { name: 'Starter Kit', description: 'Single-location license' } })
    expect(m.params.custom_fields[0]).toMatchObject({ key: 'location', optional: false })
    expect(m.params.metadata).toMatchObject({ wp_site: 'site-1', wp_product: 'Starter Kit' })
    expect(m.params.payment_intent_data.metadata).toEqual(m.params.metadata)
    expect(m.params.success_url).toBe(ORIGIN + '/thanks?s={CHECKOUT_SESSION_ID}')
    expect(m.key).toBe('wp-checkout:site-1:' + m.params.metadata.wp_sale)
  })
  test('a checkout never sends the buyer back to an address that is not this site', async () => {
    const w = await world()
    for (const origin of ['https://evil.test', ORIGIN + '.evil.test', 'http://twomiah-hobby.netlify.app'])
      await expect(startCheckout(w.d, ROW as any, { saleId: 'abcdefgh12', origin, offer: { name: 'x', priceCents: 9900 } })).rejects.toThrow('That did not look right.')
    const own = { ...ROW, custom_domain: 'thehobbystarter.com', ssl_ok: true }
    expect((await startCheckout(w.d, own as any, { saleId: 'abcdefgh12', origin: 'https://thehobbystarter.com', offer: { name: 'x', priceCents: 9900 } })).url).toMatch(/^https:\/\/checkout\.stripe\.com\//)
  })
  test('a price outside $1–$5,000, or no linked account, is refused before Stripe is asked', async () => {
    const w = await world()
    for (const priceCents of [99, 500_001, 12.5, NaN]) await expect(startCheckout(w.d, ROW as any, { saleId: 'abcdefgh12', origin: ORIGIN, offer: { name: 'x', priceCents } })).rejects.toThrow('no price')
    const n = await world({ account: null })
    await expect(startCheckout(n.d, ROW as any, { saleId: 'abcdefgh12', origin: ORIGIN, offer: { name: 'x', priceCents: 9900 } })).rejects.toThrow('not set up')
    expect(w.stripe.made.length + n.stripe.made.length).toBe(0)
  })
  test('the page posts the Buy button to /api/buy and its security policy lets the form go on to Stripe', async () => {
    const w = await world()
    const page = await w.call('/')
    expect(page.headers.get('content-security-policy')).toContain("form-action 'self' https://checkout.stripe.com")
  })
})

describe('a sale', () => {
  test('recorded once from Stripe\'s word: license, buyer, where it is licensed for; one email each, however many deliveries', async () => {
    const w = await world(); w.linked(); w.withFile()
    const { s, saleId } = await sell(w)
    const again = await handleConnectEvent(w.d, { id: 't-1', stripe_connect_account_id: 'acct_owner1' }, { type: 'checkout.session.completed', data: { object: s } })
    expect(again.status).toBe(200)
    const sale = JSON.parse(w.store.m.get('sale:' + saleId))
    expect(sale).toMatchObject({ id: saleId, product: 'Starter Kit', name: 'Pat Teacher', email: 'pat@school.test', location: 'Lincoln Elementary, Eau Claire', amountCents: 9900, currency: 'usd', refunded: false })
    expect(sale.license).toMatch(/^THS-2026-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(w.mail.map((m) => m.to)).toEqual(['pat@school.test', 'owner@hobby.test'])
    expect(w.mail[0].html).toContain(sale.license)
    expect(w.mail[0].html).toContain(ORIGIN + '/download?k=')
    expect(w.mail[1].subject).toBe('New sale: Starter Kit')
  })
  test('the license number is the same for a sale every time and different between sales and sites', async () => {
    const w = await world()
    const at = new Date(NOW)
    const a = await licenseFor(w.d, ROW as any, 'The Hobby Starter', 'sale-aaaaaaa', at)
    expect(await licenseFor(w.d, ROW as any, 'The Hobby Starter', 'sale-aaaaaaa', at)).toBe(a)
    expect(await licenseFor(w.d, ROW as any, 'The Hobby Starter', 'sale-bbbbbbb', at)).not.toBe(a)
    expect(await licenseFor(w.d, { ...ROW, id: 'site-2' } as any, 'The Hobby Starter', 'sale-aaaaaaa', at)).not.toBe(a)
  })
  test('an unpaid checkout is not a sale; neither is one made for another site', async () => {
    const w = await world(); w.linked(); w.withFile()
    const r = await w.call('/api/buy', { method: 'POST' })
    const id = r.headers.get('location')!.split('/').pop()!
    expect((await recordSale(w.d, ROW as any, w.stripe.sessions.get(id))).status).toBe('pending')
    expect((await recordSale(w.d, ROW as any, { ...w.stripe.pay(id), metadata: { wp_site: 'site-2', wp_sale: 'abcdefgh12' } })).status).toBe('not_ours')
    expect([...w.store.m.keys()].filter((k) => k.startsWith('sale:'))).toEqual([])
    expect(w.mail).toEqual([])
  })
  test('the thank-you page shows the link once Stripe says paid (and records the sale if the webhook is late)', async () => {
    const w = await world(); w.linked(); w.withFile()
    const r = await w.call('/api/buy', { method: 'POST' })
    const id = r.headers.get('location')!.split('/').pop()!
    const pending = await w.call('/thanks?s=' + id)
    expect(pending.status).toBe(202)
    w.stripe.pay(id)
    const paid = await w.call('/thanks?s=' + id)
    expect(paid.status).toBe(200)
    const html = await paid.text()
    expect(html).toContain('/download?k=')
    expect(html).toContain('Lincoln Elementary, Eau Claire')
    expect(w.mail.length).toBe(2)                                      // recorded here, emailed once
    expect((await w.call('/thanks?s=cs_test_999999999999')).status).toBe(404)
    expect((await w.call('/thanks?s=<script>')).status).toBe(404)
  })
  test("a sale is written to the site only by the Factory's signature", async () => {
    const w = await world()
    const body = JSON.stringify({ saleId: 'forged-sale-1', license: 'X', email: 'a@b.test' })
    expect((await w.call('/api/sale', { method: 'POST', body })).status).toBe(404)
    const other = await siteSecret(MASTER, 'site-2'); const ts = String(Math.floor(NOW / 1000))
    expect((await w.call('/api/sale', { method: 'POST', body, headers: { 'x-wp-ts': ts, 'x-wp-sig': await signRequest(other, ts, body) } })).status).toBe(404)
    expect(w.store.m.has('sale:forged-sale-1')).toBe(false)
  })
})

describe("the buyer's link", () => {
  test('downloads the file, with download headers, up to 5 times', async () => {
    const w = await world(); w.linked(); w.withFile()
    const { saleId } = await sell(w)
    const link = '/download?k=' + encodeURIComponent(await mintDownload(w.secret, ROW.id, saleId, NOW))
    for (let i = 0; i < 5; i++) {
      const r = await w.call(link)
      expect(r.status).toBe(200)
      expect(r.headers.get('content-disposition')).toBe('attachment; filename="starter-kit.zip"')
      expect(r.headers.get('cache-control')).toBe('private, no-store')
      expect(new Uint8Array(await r.arrayBuffer())).toEqual(ZIP)
    }
    expect((await w.call(link)).status).toBe(429)
  })
  test('expired, made for another site, forged, or for a sale not on record: refused', async () => {
    const w = await world(); w.linked(); w.withFile()
    const { saleId } = await sell(w)
    const old = await mintDownload(w.secret, ROW.id, saleId, NOW - 8 * 86400_000)
    expect((await w.call('/download?k=' + encodeURIComponent(old))).status).toBe(410)
    const other = await mintDownload(await siteSecret(MASTER, 'site-2'), ROW.id, saleId, NOW)
    expect((await w.call('/download?k=' + encodeURIComponent(other))).status).toBe(404)
    const wrongSite = await mintDownload(w.secret, 'site-2', saleId, NOW)
    expect((await w.call('/download?k=' + encodeURIComponent(wrongSite))).status).toBe(404)
    const ghost = await mintDownload(w.secret, ROW.id, 'no-such-sale', NOW)
    expect((await w.call('/download?k=' + encodeURIComponent(ghost))).status).toBe(404)
    expect((await w.call('/download?k=garbage')).status).toBe(404)
  })
  test('a full refund ends the link; a partial one does not', async () => {
    const w = await world(); w.linked(); w.withFile()
    const { s, saleId } = await sell(w)
    const link = '/download?k=' + encodeURIComponent(await mintDownload(w.secret, ROW.id, saleId, NOW))
    const partial = await handleConnectEvent(w.d, { id: 't-1', stripe_connect_account_id: 'acct_owner1' }, { type: 'charge.refunded', data: { object: { refunded: false, payment_intent: s.payment_intent } } })
    expect(partial.result).toBe('partial or unknown')
    expect((await w.call(link)).status).toBe(200)
    const full = await handleConnectEvent(w.d, { id: 't-1', stripe_connect_account_id: 'acct_owner1' }, { type: 'charge.refunded', data: { object: { refunded: true, payment_intent: s.payment_intent } } })
    expect(full).toEqual({ status: 200, result: 'refunded' })
    expect((await w.call(link)).status).toBe(410)
    expect(JSON.parse(w.store.m.get('sale:' + saleId)).refunded).toBe(true)
  })
})

describe("the owner's side", () => {
  test('uploading the file needs the owner signed in, and checks it', async () => {
    const w = await world()
    expect((await w.call('/api/download/file', { method: 'POST', body: ZIP, headers: { 'x-wp': '1', 'x-file-name': 'kit.zip' } })).status).toBe(401)
    const bad = await w.call('/api/download/file', { method: 'POST', body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), headers: { ...(await w.owner()), 'x-file-name': 'kit.zip' } })
    expect(bad.status).toBe(415)
    const ok = await w.call('/api/download/file', { method: 'POST', body: ZIP, headers: { ...(await w.owner()), 'x-file-name': encodeURIComponent('Starter Kit.zip') } })
    expect(ok.status).toBe(200)
    expect((await json(ok)).file).toMatchObject({ name: 'Starter-Kit.zip', mime: 'application/zip', size: ZIP.length })
    expect((await json(await w.call('/api/download/file', { headers: await w.owner() }))).file.name).toBe('Starter-Kit.zip')
  })
  test('the sales list and CSV are the owner\'s only; the CSV writes a formula-looking cell as text', async () => {
    const w = await world(); w.linked(); w.withFile()
    await sell(w, { name: '=HYPERLINK("http://x")', email: 'pat@school.test' }, '+Lincoln')
    expect((await w.call('/api/sales')).status).toBe(401)
    expect((await w.call('/api/sales.csv')).status).toBe(401)
    const list = await json(await w.call('/api/sales', { headers: await w.owner() }))
    expect(list.sales.length).toBe(1)
    const csv = await (await w.call('/api/sales.csv', { headers: await w.owner() })).text()
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`)
    expect(csv).toContain(`"'+Lincoln"`)
    expect(csv.split('\r\n')[0]).toBe('"Date","License","Buyer","Email","Licensed for","Product","Amount","Currency","Status","Downloads"')
  })
  test('re-send: a fresh link to the email on the sale, the count starts again; not for a refunded sale', async () => {
    const w = await world(); w.linked(); w.withFile()
    const { s, saleId } = await sell(w)
    w.store.m.set('dlc:' + saleId, '5')
    const r = await w.call('/api/sales/resend', { method: 'POST', body: JSON.stringify({ saleId }), headers: { ...(await w.owner()), 'content-type': 'application/json' } })
    expect(r.status).toBe(200)
    expect(w.mail.at(-1)!.to).toBe('pat@school.test')
    expect(w.mail.at(-1)!.subject).toBe('Your download link: Starter Kit')
    expect(w.store.m.get('dlc:' + saleId)).toBe('0')
    await handleConnectEvent(w.d, { id: 't-1', stripe_connect_account_id: 'acct_owner1' }, { type: 'charge.refunded', data: { object: { refunded: true, payment_intent: s.payment_intent } } })
    const refused = await w.call('/api/sales/resend', { method: 'POST', body: JSON.stringify({ saleId }), headers: { ...(await w.owner()), 'content-type': 'application/json' } })
    expect(refused.status).toBe(409)
  })
})

describe('linking Stripe', () => {
  test("start: Stripe's sign-in, signed state naming this business and coming back to this site's editor", async () => {
    const w = await world({ account: null })
    const r = await w.call('/api/stripe/start', { method: 'POST', headers: await w.owner() })
    expect(r.status).toBe(200)
    const url = new URL((await json(r)).url)
    expect(url.origin + url.pathname).toBe('https://connect.stripe.com/oauth/authorize')
    const st = verifyState(url.searchParams.get('state'), OAUTH.stateSecret, NOW)!
    expect(st).toMatchObject({ t: 't-1', u: 'site:site-1', r: ORIGIN + '/edit/' })
    expect(JSON.parse(w.store.m.get('stripe-nonce')).h).not.toContain(st.n)        // only its hash is kept
  })
  test("a business the Factory already holds a Stripe account for cannot start a second link (a double tap, a stale button): told, and nothing started", async () => {
    const w = await world()                                            // linked: acct_owner1 on the Factory's record
    w.store.m.set('stripe', JSON.stringify({ connected: false }))      // …while the site's own store still says not (its old copy)
    const r = await w.call('/api/stripe/start', { method: 'POST', headers: await w.owner() })
    expect(r.status).toBe(502)
    expect((await json(r)).error).toBe('Your Stripe account is already linked. Reload this page to see it.')
    await expect(stripeStart(w.d, ROW as any, { nonce: 'n'.repeat(32) })).rejects.toMatchObject({ status: 409 })
    // after a disconnect, a link can be started again
    await stripeDisconnect(w.d, ROW as any)
    expect((await stripeStart(w.d, ROW as any, { nonce: 'n'.repeat(32) })).url).toMatch(/^https:\/\/connect\.stripe\.com\//)
  })
  test('the result lands only with the nonce this site started, once; an already-linked site refuses a second account', async () => {
    const w = await world({ account: null })
    await w.call('/api/stripe/start', { method: 'POST', headers: await w.owner() })
    const st = verifyState(new URL((await json(await w.call('/api/stripe/start', { method: 'POST', headers: await w.owner() }))).url).searchParams.get('state'), OAUTH.stateSecret, NOW)!
    expect((await deliverStripeLink(w.d, 't-1', { nonce: 'x'.repeat(32), userId: 'site:site-1', accountId: 'acct_1' })).status).toBe(410)
    expect((await deliverStripeLink(w.d, 't-1', { nonce: st.n, userId: 'site:other', accountId: 'acct_1' })).status).toBe(403)
    expect(await deliverStripeLink(w.d, 't-1', { nonce: st.n, userId: 'site:site-1', accountId: 'acct_1' })).toEqual({ ok: true, status: 200 })
    expect((await deliverStripeLink(w.d, 't-1', { nonce: st.n, userId: 'site:site-1', accountId: 'acct_1' })).status).toBe(410)   // used once
    expect(JSON.parse(w.store.m.get('stripe')).connected).toBe(true)
  })
  test('Stripe withdrawing access clears the Factory record and the site', async () => {
    const w = await world(); w.linked()
    const out = await handleConnectEvent(w.d, { id: 't-1', stripe_connect_account_id: 'acct_owner1' }, { type: 'account.application.deauthorized', account: 'acct_owner1', data: { object: {} } })
    expect(out.status).toBe(200)
    const { data } = await w.db.from('tenants').select('stripe_connect_account_id').eq('id', 't-1').single()
    expect(data.stripe_connect_account_id).toBeNull()
    expect(JSON.parse(w.store.m.get('stripe')).connected).toBe(false)
  })
})
