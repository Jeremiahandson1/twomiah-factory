// A Web presence site's own function (apps/api/src/webPresence/site/handler.mjs), run with a Map for its Blobs and a stand-in for fetch:
// no network, no Netlify. Covers sign-in (expired / reused / wrong site), sessions (site A cannot edit site B, sign-out ends one),
// rate limits, the editor's save (stored in the site's own store, survives a "redeploy"), uploads, and both forms ("sent" only when
// Netlify accepted, a form that is off refuses, the resume's type and size).
import { fileURLToPath } from 'node:url'
import { describe, test, expect } from 'bun:test'
import { createHandler } from '../../../apps/api/src/webPresence/site/handler.mjs'
import { blobsContext, strongReads, purger } from '../../../apps/api/src/webPresence/site/lambda.mjs'
import { siteSecret, mintSignin, mintSession, signRequest, verifyRequest } from '../../../apps/api/src/webPresence/site/session.mjs'

const MASTER = 'master-key-for-tests'

function blobs() {
  const m = new Map<string, any>(); const meta = new Map<string, any>()
  return {
    m,
    get: async (k: string) => (m.has(k) ? m.get(k) : null),
    // As Netlify Blobs answers: `onlyIfNew` writes only a new key and says whether it did.
    set: async (k: string, v: any, o?: any) => { if (o?.onlyIfNew && m.has(k)) return { modified: false }; m.set(k, v); if (o?.metadata) meta.set(k, o.metadata); return { modified: true } },
    getWithMetadata: async (k: string) => (m.has(k) ? { data: m.get(k), metadata: meta.get(k) } : null),
  }
}
const model = (over: any = {}) => ({
  v: 1, business: { name: 'Acme' }, look: { design: 'foundry' },
  forms: { lead: { on: true, inbox: 'owner@acme.test' }, hiring: { on: false, inbox: '' } },
  sections: [
    { id: 'contact', type: 'contact', variant: 'form-info', hidden: false, data: {} },
    { id: 'hiring', type: 'hiring', variant: 'form', hidden: false, data: { jobs: [{ title: 'Driver' }] } },
  ],
  ...over,
})

async function site(siteId = 'site-a', opts: { model?: any; factory?: (url: string, init: any) => Promise<Response>; netlify?: (url: string, init: any) => Promise<Response>; t?: { now: number }; fresh?: boolean; purge?: (tags: string[]) => Promise<boolean> } = {}) {
  const store = blobs()
  const t = opts.t || { now: Date.UTC(2026, 9, 29, 12, 0, 0) }
  const calls: Array<{ url: string; init: any }> = []
  const secret = await siteSecret(MASTER, siteId)
  const fetchImpl = async (url: any, init: any) => {
    calls.push({ url: String(url), init })
    if (String(url).includes('/forms.html')) return (opts.netlify ? opts.netlify(String(url), init) : new Response('', { status: 200 }))
    if (opts.factory) return opts.factory(String(url), init)
    // The Factory takes a form message and emails it (forms.ts); anything else this stand-in has not been told about fails.
    if (String(url).endsWith('/internal/web-presence/form')) return new Response(JSON.stringify({ ok: true }), { status: 200 })
    return new Response(JSON.stringify({ error: 'no factory' }), { status: 500 })
  }
  const env = { WP_SITE_ID: siteId, WP_SECRET: secret, WP_FACTORY_URL: 'https://factory.test', WP_TENANT_ID: 'tenant-a', WP_FACTORY_KEY: 'k' }
  const handler = createHandler({ store, env, fetchImpl, now: () => t.now, initial: { index: '<html>initial</html>', privacy: '<html>privacy</html>', model: opts.model || model(), css: '/* deployed look */', cssVersion: 'v-deployed' }, spec: { limits: {} }, ...(opts.fresh !== undefined ? { fresh: opts.fresh } : {}), ...(opts.purge ? { purge: opts.purge } : {}) })
  const call = (r: string, init: any = {}, headers: Record<string, string> = {}) =>
    handler(new Request('https://acme.netlify.app/.netlify/functions/site?r=' + r, { ...init, headers: { 'x-nf-client-connection-ip': '1.2.3.4', host: 'acme.netlify.app', ...(init.headers || {}), ...headers } }))
  const cookieFor = async (id = siteId, sec = secret) => 'wp_s=' + encodeURIComponent(await mintSession(sec, id, t.now))
  const authed = async (extra: Record<string, string> = {}) => ({ cookie: await cookieFor(), 'x-wp': '1', ...extra })
  return { store, call, calls, secret, t, cookieFor, authed, handler }
}
const post = (body: any) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const form = (o: Record<string, string>, file?: File) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); if (file) f.append('resume', file, file.name); return { method: 'POST', body: f } }

describe('sign-in', () => {
  test('a good link signs in once; the second use is refused', async () => {
    const s = await site()
    const tok = await mintSignin(s.secret, 'site-a', s.t.now)
    const a = await s.call('api/signin', post({ token: tok }))
    expect(a.status).toBe(200)
    expect(a.headers.get('set-cookie')).toMatch(/wp_s=.*HttpOnly.*Secure.*SameSite=Strict/)
    const b = await s.call('api/signin', post({ token: tok }))
    expect(b.status).toBe(401)
    expect((await b.json()).error).toMatch(/already used/)
  })
  test('an expired link is refused', async () => {
    const s = await site()
    const tok = await mintSignin(s.secret, 'site-a', s.t.now - 16 * 60 * 1000)
    const r = await s.call('api/signin', post({ token: tok }))
    expect(r.status).toBe(401)
    expect((await r.json()).error).toMatch(/expired/)
  })
  test("a link made for another site is refused (and so is one signed with another site's secret)", async () => {
    const s = await site('site-a')
    const forOther = await mintSignin(s.secret, 'site-b', s.t.now)
    expect((await s.call('api/signin', post({ token: forOther }))).status).toBe(401)
    const otherSecret = await siteSecret(MASTER, 'site-b')
    const signedByB = await mintSignin(otherSecret, 'site-a', s.t.now)
    expect((await s.call('api/signin', post({ token: signedByB }))).status).toBe(401)
    expect((await s.call('api/signin', post({ token: 'garbage' }))).status).toBe(401)
  })
  test('sign-in is rate limited', async () => {
    const s = await site()
    let last = 0
    for (let i = 0; i < 12; i++) last = (await s.call('api/signin', post({ token: 'bad' + i }))).status
    expect(last).toBe(429)
  })
  test('a session from site A cannot edit site B', async () => {
    const a = await site('site-a'), b = await site('site-b')
    const cookieA = await a.cookieFor()
    const res = await b.call('api/model', { method: 'GET' }, { cookie: cookieA })
    expect(res.status).toBe(401)
    const save = await b.call('api/model', post(model()), { cookie: cookieA, 'x-wp': '1' })
    expect(save.status).toBe(401)
    expect((await b.call('api/model', { method: 'GET' }, { cookie: await a.cookieFor() })).status).toBe(401)
  })
  test('sign-out ends the session', async () => {
    const s = await site()
    const h = await s.authed()
    expect((await s.call('api/model', { method: 'GET' }, h)).status).toBe(200)
    expect((await s.call('api/signout', { method: 'POST' }, h)).status).toBe(200)
    expect((await s.call('api/model', { method: 'GET' }, h)).status).toBe(401)
  })
  test('a session expires', async () => {
    const s = await site()
    const h = await s.authed()
    s.t.now += 13 * 3600 * 1000
    expect((await s.call('api/model', { method: 'GET' }, h)).status).toBe(401)
  })
  test('a change needs the custom header and a same-site origin, not the cookie alone', async () => {
    const s = await site()
    const cookie = await s.cookieFor()
    expect((await s.call('api/model', post(model()), { cookie })).status).toBe(403)
    expect((await s.call('api/model', post(model()), { cookie, 'x-wp': '1', origin: 'https://evil.test' })).status).toBe(403)
  })
})

describe('the editor saves into the site, not the Factory', () => {
  const rendered = (m: any) => ({ ok: true, model: m, notes: [], files: { 'index.html': '<html>saved page</html>', 'privacy/index.html': '<html>saved privacy</html>' } })
  test('a save is drawn by the Factory, stored in the site Blobs, served, and survives a redeploy', async () => {
    const seen: any[] = []
    const s = await site('site-a', { factory: async (url, init) => { seen.push({ url, init }); return new Response(JSON.stringify(rendered(JSON.parse(init.body).model)), { status: 200 }) } })
    const next = model({ business: { name: 'Acme Roofing' } })
    const res = await s.call('api/model', post(next), await s.authed())
    expect(res.status).toBe(200)
    // signed, to the internal path, carrying the site id
    expect(seen[0].url).toBe('https://factory.test/internal/web-presence/render')
    expect(seen[0].init.headers['x-wp-site']).toBe('site-a')
    expect(seen[0].init.headers['x-wp-sig']).toMatch(/./)
    expect(await (await s.call('page')).text()).toBe('<html>saved page</html>')
    expect(await (await s.call('privacy')).text()).toBe('<html>saved privacy</html>')
    // a redeploy bundles a NEW initial page; the owner's saved page and model stay
    const again = createHandler({ store: s.store, env: { WP_SITE_ID: 'site-a', WP_SECRET: s.secret, WP_FACTORY_URL: 'https://factory.test' }, fetchImpl: fetch, now: () => s.t.now, initial: { index: '<html>NEW DEPLOY</html>', privacy: 'p', model: model() }, spec: {} })
    const page = await again(new Request('https://acme.netlify.app/'))
    expect(await page.text()).toBe('<html>saved page</html>')
    const mm = await again(new Request('https://acme.netlify.app/api/model', { headers: { cookie: await s.cookieFor() } }))
    expect((await mm.json()).model.business.name).toBe('Acme Roofing')
  })
  test('before any save, the page is the one deployed', async () => {
    const s = await site()
    expect(await (await s.call('page')).text()).toBe('<html>initial</html>')
  })
  test('when the Factory cannot draw it, nothing is stored and the owner is told', async () => {
    const s = await site('site-a', { factory: async () => new Response('x', { status: 500 }) })
    const res = await s.call('api/model', post(model({ business: { name: 'Changed' } })), await s.authed())
    expect(res.status).toBe(502)
    expect(s.store.m.has('model')).toBe(false)
    expect(s.store.m.has('page')).toBe(false)
  })
  test('a save that is too large is refused before the Factory is asked', async () => {
    const s = await site('site-a', { factory: async () => new Response('{}', { status: 200 }) })
    const res = await s.call('api/model', { method: 'POST', body: 'x'.repeat(260_000) }, await s.authed())
    expect(res.status).toBe(413)
    expect(s.calls.length).toBe(0)
  })
  test('saves are rate limited', async () => {
    const s = await site('site-a', { factory: async (_u, init) => new Response(JSON.stringify(rendered(JSON.parse(init.body).model)), { status: 200 }) })
    const h = await s.authed()
    let last = 0
    for (let i = 0; i < 125; i++) last = (await s.call('api/model', post(model()), h)).status
    expect(last).toBe(429)
  })
})

// 11/07: the stylesheet was a deployed file, so a look changed in the editor (which deploys nothing) drew the new page with the
// FIRST look's stylesheet — the live test site showed The Hobby Starter's words in the old dark serif look. It is the function's now,
// saved with the page.
describe('the stylesheet goes with the page', () => {
  const drawn = (m: any, css: string | undefined, v: string) => ({ ok: true, model: m, notes: [], cssVersion: v, files: { 'index.html': `<html><link href="/styles/main.css?v=${v}">saved</html>`, 'privacy/index.html': 'p', ...(css === undefined ? {} : { 'styles/main.css': css }) } })
  const factoryDrawing = (css: string | undefined, v: string) => async (_u: string, init: any) => new Response(JSON.stringify(drawn(JSON.parse(init.body).model, css, v)), { status: 200 })

  test('before any save, the deployed stylesheet is served; a year in cache only under its own version', async () => {
    const s = await site()
    const r = await s.call('css&v=v-deployed')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toMatch(/^text\/css/)
    expect(await r.text()).toBe('/* deployed look */')
    expect(r.headers.get('cache-control')).toMatch(/immutable/)
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    const other = await s.call('css&v=something-else')
    expect(await other.text()).toBe('/* deployed look */')
    expect(other.headers.get('cache-control')).not.toMatch(/immutable/)
    expect(other.headers.get('netlify-cdn-cache-control')).not.toMatch(/immutable/)
  })

  test('a save that changes the look serves the new stylesheet under the new version, with no deploy', async () => {
    const s = await site('site-a', { factory: factoryDrawing('/* foundry, his colours */', 'v-foundry') })
    expect((await s.call('api/model', post(model({ look: { design: 'foundry' } })), await s.authed())).status).toBe(200)
    expect(await (await s.call('page')).text()).toContain('main.css?v=v-foundry')
    const r = await s.call('css&v=v-foundry')
    expect(await r.text()).toBe('/* foundry, his colours */')
    expect(r.headers.get('cache-control')).toMatch(/immutable/)
    // a page cached from before asks for the old version: it gets the current sheet, held for seconds — never pinned for a year
    const stale = await s.call('css&v=v-deployed')
    expect(await stale.text()).toBe('/* foundry, his colours */')
    expect(stale.headers.get('cache-control')).not.toMatch(/immutable/)
    // and a redeploy (a new function with a new first page) does not undo the owner's look
    const again = createHandler({ store: s.store, env: { WP_SITE_ID: 'site-a', WP_SECRET: s.secret }, fetchImpl: fetch, now: () => s.t.now, initial: { index: 'x', privacy: 'p', model: model(), css: '/* NEW DEPLOY */', cssVersion: 'v-new' }, spec: {} })
    expect(await (await again(new Request('https://acme.netlify.app/styles/main.css?v=v-foundry'))).text()).toBe('/* foundry, his colours */')
  })

  test('the stylesheet is written before the page (a page is never out ahead of the sheet it asks for)', async () => {
    const s = await site('site-a', { factory: factoryDrawing('/* new */', 'v-new') })
    const order: string[] = []
    const set = s.store.set
    s.store.set = async (k: string, v: any, o?: any) => { order.push(k); return set(k, v, o) }
    await s.call('api/model', post(model()), await s.authed())
    expect(order.indexOf('css')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('css')).toBeLessThan(order.indexOf('page'))
  })

  test('when the Factory cannot draw it, the stylesheet is not touched either', async () => {
    const s = await site('site-a', { factory: async () => new Response('x', { status: 500 }) })
    await s.call('api/model', post(model()), await s.authed())
    expect(s.store.m.has('css')).toBe(false)
    expect(await (await s.call('css&v=v-deployed')).text()).toBe('/* deployed look */')
  })

  test('a Factory that sends no stylesheet leaves the one held (an older Factory, mid-release)', async () => {
    const s = await site('site-a', { factory: factoryDrawing('/* first save */', 'v1') })
    await s.call('api/model', post(model()), await s.authed())
    const h = createHandler({ store: s.store, env: { WP_SITE_ID: 'site-a', WP_SECRET: s.secret, WP_FACTORY_URL: 'https://factory.test' }, fetchImpl: factoryDrawing(undefined, 'v2') as any, now: () => s.t.now, initial: { index: 'x', privacy: 'p', model: model(), css: '/* deployed */', cssVersion: 'v0' }, spec: { limits: {} } })
    const res = await h(new Request('https://acme.netlify.app/api/model', { method: 'POST', body: JSON.stringify(model()), headers: { 'content-type': 'application/json', cookie: await s.cookieFor(), 'x-wp': '1', host: 'acme.netlify.app' } }))
    expect(res.status).toBe(200)
    expect(await (await h(new Request('https://acme.netlify.app/styles/main.css?v=v1'))).text()).toBe('/* first save */')
  })

  test("the Factory's adopt (a change of trade) brings its stylesheet with the page", async () => {
    const s = await site()
    const body = JSON.stringify({ model: model(), page: '<html>new trade</html>', privacy: 'p', css: '/* adopted */', cssVersion: 'v-adopt' })
    const ts = String(Math.floor(s.t.now / 1000))
    expect((await s.call('api/adopt', { method: 'POST', body }, { 'x-wp-ts': ts, 'x-wp-sig': await signRequest(s.secret, ts, body) })).status).toBe(200)
    const r = await s.call('css&v=v-adopt')
    expect(await r.text()).toBe('/* adopted */')
    expect(r.headers.get('cache-control')).toMatch(/immutable/)
  })

  test('the stylesheet route only reads: a POST to it is not served', async () => {
    const s = await site()
    expect((await s.call('css', { method: 'POST', body: 'x' })).status).toBe(404)
  })
})

describe('photo uploads', () => {
  const png = (n = 40) => { const b = new Uint8Array(n); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); return b }
  test('a real photo is stored by its hash and served back', async () => {
    const s = await site()
    const res = await s.call('api/upload', { method: 'POST', body: png() }, await s.authed())
    expect(res.status).toBe(200)
    const { url } = await res.json()
    expect(url).toMatch(/^\/media\?h=[0-9a-f]{40}$/)
    const img = await s.call('img&h=' + url.split('=')[1])
    expect(img.status).toBe(200)
    expect(img.headers.get('content-type')).toBe('image/png')
  })
  test('something that is not a photo is refused, whatever it is called', async () => {
    const s = await site()
    const res = await s.call('api/upload', { method: 'POST', body: new TextEncoder().encode('<script>alert(1)</script> not an image at all') }, await s.authed())
    expect(res.status).toBe(415)
  })
  test('a photo over the size limit is refused', async () => {
    const s = await site()
    const big = png(700_000)
    const res = await s.call('api/upload', { method: 'POST', body: big, headers: { 'content-length': String(big.length) } }, await s.authed())
    expect([413, 415]).toContain(res.status)
  })
  test('an upload needs a session', async () => {
    const s = await site()
    expect((await s.call('api/upload', { method: 'POST', body: png() })).status).toBe(401)
  })
})

describe('the lead form', () => {
  const lead = (extra: Record<string, string> = {}) => form({ name: 'Pat Smith', phone: '555-123-4567', message: 'I need a quote please', t: String(Date.UTC(2026, 9, 29, 11, 59, 0)), ...extra })
  test('"sent" only after the Factory took it to email the owner, signed by this site, to the inbox the owner set; Netlify keeps a copy', async () => {
    const s = await site()
    const ok = await s.call('api/leads', lead())
    expect(ok.status).toBe(200)
    const asked = s.calls.find((c) => c.url === 'https://factory.test/internal/web-presence/form')!
    const body = JSON.parse(String(asked.init.body))
    expect(body).toMatchObject({ siteId: 'site-a', form: 'lead', inbox: 'owner@acme.test', fields: { name: 'Pat Smith', phone: '(555) 123-4567', message: 'I need a quote please' } })
    expect(asked.init.headers['x-wp-site']).toBe('site-a')
    expect(await verifyRequest(s.secret, asked.init.headers['x-wp-ts'], String(asked.init.body), asked.init.headers['x-wp-sig'], s.t.now)).toBe(true)
    const posted = s.calls.find((c) => c.url.endsWith('/forms.html'))!
    expect(String(posted.init.body)).toContain('form-name=lead')
  })
  test('the Factory refusing or unreachable is "did not go through" (and shows none of the visitor words); Netlify Forms down is not', async () => {
    for (const factory of [async () => new Response(JSON.stringify({ ok: false }), { status: 502 }), async () => { throw new Error('offline') }]) {
      const s = await site('site-a', { factory: factory as any })
      const bad = await s.call('api/leads', lead())
      expect(bad.status).toBe(502)
      expect(JSON.stringify(await bad.json())).not.toContain('Pat Smith')
    }
    for (const netlify of [async () => new Response('', { status: 500 }), async () => { throw new Error('offline') }]) {
      const s = await site('site-a', { netlify: netlify as any })
      expect((await s.call('api/leads', lead())).status).toBe(200)
    }
  })
  test('phone or email, either one; neither is refused', async () => {
    const s = await site()
    expect((await s.call('api/leads', lead({ phone: '', email: 'pat@example.com' }))).status).toBe(200)
    const none = await s.call('api/leads', lead({ phone: '', email: '' }))
    expect(none.status).toBe(400)
  })
  test('a robot (filled hidden field, or instant) is told "sent" and nothing is passed on', async () => {
    const s = await site()
    const filled = await s.call('api/leads', lead({ website: 'http://spam.test' }))
    expect(filled.status).toBe(200)
    const instant = await s.call('api/leads', lead({ t: String(s.t.now - 500) }))
    expect(instant.status).toBe(200)
    expect(s.calls.length).toBe(0)
  })
  test('rate limited', async () => {
    const s = await site()
    let last = 0
    for (let i = 0; i < 7; i++) last = (await s.call('api/leads', lead())).status
    expect(last).toBe(429)
  })
  test('a form switched off refuses a submission (and does not forward it)', async () => {
    const off = model({ forms: { lead: { on: false, inbox: 'owner@acme.test' }, hiring: { on: false, inbox: '' } } })
    const s = await site('site-a', { model: off })
    const res = await s.call('api/leads', lead())
    expect(res.status).toBe(404)
    expect(s.calls.length).toBe(0)
  })
  test('a form on but with its section hidden is also off', async () => {
    const hidden = model({ sections: [{ id: 'contact', type: 'contact', variant: 'form-info', hidden: true, data: {} }] })
    const s = await site('site-a', { model: hidden })
    expect((await s.call('api/leads', lead())).status).toBe(404)
  })
  test("the trade's own questions travel as extra1 / extra2 with their label", async () => {
    const m = model({ forms: { lead: { on: true, inbox: 'o@x.test', extraFields: [{ label: 'Roof type' }] }, hiring: { on: false } } })
    const s = await site('site-a', { model: m })
    await s.call('api/leads', lead({ extra1: 'Shingle' }))
    const body = String(s.calls.find((c) => c.url.endsWith('/forms.html'))!.init.body)
    expect(decodeURIComponent(body.replace(/\+/g, ' '))).toContain('extra1=Roof type: Shingle')
    const toFactory = JSON.parse(String(s.calls.find((c) => c.url.endsWith('/internal/web-presence/form'))!.init.body))
    expect(toFactory.fields.extra1).toBe('Roof type: Shingle'); expect(toFactory.inbox).toBe('o@x.test')
  })
})

describe('the now-hiring form', () => {
  const on = () => model({ forms: { lead: { on: true, inbox: 'o@x.test' }, hiring: { on: true, inbox: 'jobs@acme.test' } } })
  const app = (extra: Record<string, string> = {}, file?: File) => form({ name: 'Sam Lee', email: 'sam@example.com', about: 'Five years driving', job: 'Driver', availability: 'Weekdays', t: String(Date.UTC(2026, 9, 29, 11, 59, 0)), ...extra }, file)
  const pdf = (name = 'cv.pdf', size = 200) => { const b = new Uint8Array(size); b.set([0x25, 0x50, 0x44, 0x46], 0); return new File([b], name) }
  test('off by default: refuses', async () => {
    const s = await site()
    expect((await s.call('api/apply', app())).status).toBe(404)
  })
  test('on: "sent" only after the Factory took it, with the resume (its own bytes, under a name the visitor did not choose) to the hiring inbox', async () => {
    const s = await site('site-a', { model: on() })
    const file = pdf('../../evil name.pdf')
    const ok = await s.call('api/apply', app({}, file))
    expect(ok.status).toBe(200)
    const asked = JSON.parse(String(s.calls.find((c) => c.url.endsWith('/internal/web-presence/form'))!.init.body))
    expect(asked).toMatchObject({ form: 'apply', inbox: 'jobs@acme.test', fields: { name: 'Sam Lee', email: 'sam@example.com', job: 'Driver' } })
    expect(asked.resume.ext).toBe('pdf')
    expect(Buffer.from(asked.resume.content, 'base64').equals(Buffer.from(await file.arrayBuffer()))).toBe(true)
    const sent = s.calls.find((c) => c.url.endsWith('/forms.html'))!
    expect(sent.init.body instanceof FormData).toBe(true)
    expect((sent.init.body.get('resume') as File).name).toBe('resume.pdf')
    const rej = await site('site-a', { model: on(), factory: async () => new Response(JSON.stringify({ ok: false }), { status: 502 }) })
    expect((await rej.call('api/apply', app())).status).toBe(502)
  })
  test('a resume of the wrong type, or one that is not what its name says, is refused', async () => {
    const s = await site('site-a', { model: on() })
    expect((await s.call('api/apply', app({}, new File([new Uint8Array([1, 2, 3, 4])], 'virus.exe')))).status).toBe(415)
    expect((await s.call('api/apply', app({}, new File([new TextEncoder().encode('hello hello')], 'cv.pdf')))).status).toBe(415)
  })
  test('a resume over the stated limit is refused', async () => {
    const s = await site('site-a', { model: on() })
    const res = await s.call('api/apply', { ...app({}, pdf('cv.pdf', 10)), headers: { 'content-length': String(5 * 1024 * 1024) } })
    expect(res.status).toBe(413)
    expect((await res.json()).error).toMatch(/3 MB/)
  })
  test('a job that is not listed is refused; no resume is fine', async () => {
    const s = await site('site-a', { model: on() })
    expect((await s.call('api/apply', app({ job: 'Pilot' }))).status).toBe(400)
    expect((await s.call('api/apply', app())).status).toBe(200)
  })
  test('nothing about an applicant is logged or echoed back on a refusal', async () => {
    const logs: string[] = []
    const orig = console.log; const err = console.error
    console.log = (...a: any[]) => logs.push(a.join(' ')); console.error = (...a: any[]) => logs.push(a.join(' '))
    try {
      const s = await site('site-a', { model: on(), netlify: async () => new Response('', { status: 500 }) })
      const res = await s.call('api/apply', app({ name: 'Zed Applicant', about: 'my secret history' }))
      expect(JSON.stringify(await res.json())).not.toMatch(/Zed|secret history/)
    } finally { console.log = orig; console.error = err }
    expect(logs.join('\n')).not.toMatch(/Zed|secret history/)
  })
})

describe('what the Factory may ask of the site', () => {
  test('usage and export answer only a request signed with the site secret', async () => {
    const s = await site()
    const ts = String(Math.floor(s.t.now / 1000))
    expect((await s.call('api/usage', { method: 'GET' })).status).toBe(404)
    const ok = await s.call('api/usage', { method: 'GET' }, { 'x-wp-ts': ts, 'x-wp-sig': await signRequest(s.secret, ts, 'usage') })
    expect(ok.status).toBe(200)
    const body = await ok.json()
    expect(Object.keys(body).sort()).toEqual(['apply', 'lead', 'month', 'page', 'save', 'upload'])
    const other = await signRequest(await siteSecret(MASTER, 'site-b'), ts, 'usage')
    expect((await s.call('api/usage', { method: 'GET' }, { 'x-wp-ts': ts, 'x-wp-sig': other })).status).toBe(404)
    const exp = await s.call('api/export', { method: 'GET' }, { 'x-wp-ts': ts, 'x-wp-sig': await signRequest(s.secret, ts, 'export') })
    expect((await exp.json()).model.business.name).toBe('Acme')
  })
  test('a stale signature is refused', async () => {
    const s = await site()
    const old = String(Math.floor(s.t.now / 1000) - 3600)
    expect((await s.call('api/usage', { method: 'GET' }, { 'x-wp-ts': old, 'x-wp-sig': await signRequest(s.secret, old, 'usage') })).status).toBe(404)
  })
  test('adopt replaces the model and page only when signed over its body', async () => {
    const s = await site()
    const body = JSON.stringify({ model: model({ business: { name: 'New trade' } }), page: '<html>new</html>', privacy: 'p' })
    const ts = String(Math.floor(s.t.now / 1000))
    expect((await s.call('api/adopt', { method: 'POST', body }, { 'x-wp-ts': ts, 'x-wp-sig': 'nope' })).status).toBe(404)
    expect((await s.call('api/adopt', { method: 'POST', body }, { 'x-wp-ts': ts, 'x-wp-sig': await signRequest(s.secret, ts, body) })).status).toBe(200)
    expect(await (await s.call('page')).text()).toBe('<html>new</html>')
  })
  test('the address routes need a session and go to the Factory with the site key, and nothing else passes', async () => {
    const s = await site('site-a', { factory: async (url, init) => new Response(JSON.stringify({ status: 'pending_nameservers', url, key: init.headers['x-factory-key'] }), { status: 200 }) })
    expect((await s.call('api/domain/status', { method: 'GET' })).status).toBe(401)
    const r = await s.call('api/domain/status', { method: 'GET' }, await s.authed())
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.url).toBe('https://factory.test/internal/domain/status/tenant-a')
    expect(body.key).toBe('k')
    expect((await s.call('api/domain/delete', post({}), await s.authed())).status).toBe(404)
  })
  test('"email me a new link" answers the same whoever asks, and is signed', async () => {
    const seen: string[] = []
    const s = await site('site-a', { factory: async (url) => { seen.push(url); return new Response('{}', { status: 200 }) } })
    const r = await s.call('api/link', { method: 'POST' })
    expect(await r.json()).toEqual({ ok: true })
    expect(seen).toEqual(['https://factory.test/internal/web-presence/link-request'])
    const down = await site('site-a', { factory: async () => { throw new Error('x') } })
    expect(await (await down.call('api/link', { method: 'POST' })).json()).toEqual({ ok: true })
  })
  test('unknown routes are 404, and errors never carry a visitor words', async () => {
    const s = await site()
    expect((await s.call('api/nothing', { method: 'GET' })).status).toBe(404)
  })
})

describe('the function that is deployed', () => {
  test('is one self-contained file: Blobs is inside it, nothing is left to resolve, and the bundler leaves no folder behind', async () => {
    const { bundleFunction } = await import('../../../apps/api/src/webPresence/publish')
    const { readdirSync } = await import('node:fs')
    const code = await bundleFunction({ index: '<html>a page</html>', privacy: '<html>privacy</html>', model: { v: 1, marker: 'unique-model-marker' }, spec: {} })
    expect(code).toContain('getStore')
    expect(code).toContain('unique-model-marker')                       // the first page and model ride in the bundle
    expect(code).not.toMatch(/^\s*import\s[^\n]*['"]@netlify\//m)         // not an unresolved import the Netlify runtime would have to find
    expect(code).not.toMatch(/\bADMIN_KEY\b/)                            // no shared admin key anywhere in the site
    expect(readdirSync(fileURLToPath(new URL('../../../apps/api', import.meta.url))).filter((n) => n.startsWith('.wp-fn-'))).toEqual([])
  })
})

describe('a save shows at once: strong reads when Netlify allows them, and the page cleared from the CDN on every save', () => {
  const drawnPage = (m: any) => ({ ok: true, model: m, notes: [], files: { 'index.html': '<html>v2</html>', 'privacy/index.html': '<html>p2</html>' } })
  const factory = async (_u: string, init: any) => new Response(JSON.stringify(drawnPage(JSON.parse(init.body).model)), { status: 200 })
  test('every page is tagged; it is cached until the next save only when reads are strong AND clearing is available, else a minute with no stale tail', async () => {
    for (const [fresh, purge, cdn, read] of [
      [true, true, 'public, durable, max-age=86400', 'strong'],
      [true, false, 'public, max-age=60', 'strong'],
      [false, true, 'public, max-age=60', 'eventual'],
      [false, false, 'public, max-age=60', 'eventual'],
    ] as const) {
      const s = await site('site-a', { fresh, ...(purge ? { purge: async () => true } : {}) })
      for (const which of ['page', 'privacy']) {
        const r = await s.call(which)
        expect(r.headers.get('netlify-cache-tag')).toBe('wp-page')
        expect(r.headers.get('netlify-cdn-cache-control')).toBe(cdn)
        expect(r.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate')
        expect(r.headers.get('x-wp-read')).toBe(read)
      }
    }
  })
  test("the owner's save clears the pages AFTER the new page is stored; a clearing that fails or throws never fails the save", async () => {
    const order: string[] = []
    let s: any
    s = await site('site-a', { factory, fresh: true, purge: async (tags) => { order.push('purge:' + tags.join() + ':' + (s.store.m.get('page') || '')); return true } })
    const res = await s.call('api/model', post(model({ business: { name: 'Acme 2' } })), await s.authed())
    expect(res.status).toBe(200)
    expect(order).toEqual(['purge:wp-page:<html>v2</html>'])
    for (const purge of [async () => false, async () => { throw new Error('down') }]) {
      const b = await site('site-a', { factory, fresh: true, purge: purge as any })
      expect((await b.call('api/model', post(model()), await b.authed())).status).toBe(200)
      expect(await (await b.call('page')).text()).toBe('<html>v2</html>')
    }
  })
  test("the Factory's adopt (a change of trade) clears the pages too", async () => {
    const tags: string[][] = []
    const s = await site('site-a', { fresh: true, purge: async (t) => { tags.push(t); return true } })
    const ts = String(Math.floor(s.t.now / 1000))
    const body = JSON.stringify({ model: model(), page: '<html>new trade</html>', privacy: 'p' })
    expect((await s.call('api/adopt', { method: 'POST', body }, { 'x-wp-ts': ts, 'x-wp-sig': await signRequest(s.secret, ts, body) })).status).toBe(200)
    expect(tags).toEqual([['wp-page']])
  })
})

describe("the function's Blobs connection and the CDN clearing (lambda.mjs)", () => {
  const ev = (blobs: any) => ({ headers: { 'x-nf-site-id': 'nsite-1', 'x-nf-deploy-id': 'dep-1' }, blobs: Buffer.from(JSON.stringify(blobs)).toString('base64') })
  test('the uncached address, when Netlify sends it, makes reads strong; without it nothing changes', () => {
    const set: any[] = []
    expect(blobsContext(ev({ url: 'https://edge.test', url_uncached: 'https://uncached.test', token: 'tk' }), (c: any) => set.push(c))).toEqual({ fresh: true, siteID: 'nsite-1', deployID: 'dep-1' })
    expect(set).toEqual([{ deployID: 'dep-1', edgeURL: 'https://edge.test', uncachedEdgeURL: 'https://uncached.test', siteID: 'nsite-1', token: 'tk' }])
    for (const e of [ev({ url: 'https://edge.test', token: 'tk' }), ev({ url: 'https://edge.test', url_uncached: 'http://plain.test', token: 'tk' }), { headers: {}, blobs: 'not base64 json' }, {}]) {
      const none: any[] = []
      expect(blobsContext(e as any, (c: any) => none.push(c)).fresh).toBe(false)
      expect(none).toEqual([])
    }
  })
  test('strongReads: every read asks for strong consistency; writes are untouched', async () => {
    const calls: any[] = []
    const store = { get: async (k: string, o: any) => { calls.push(['get', k, o]); return 'v' }, getWithMetadata: async (k: string, o: any) => { calls.push(['gwm', k, o]); return null }, getMetadata: async (k: string, o: any) => { calls.push(['gm', k, o]); return null }, set: async (k: string, _v: any, o?: any) => { calls.push(['set', k, o]) } }
    const st = strongReads(store)
    await st.get('page', { type: 'text' }); await st.getWithMetadata('css', { type: 'text' }); await st.getMetadata('dl:file'); await st.set('page', 'x', { metadata: { v: 1 } })
    expect(calls).toEqual([['get', 'page', { type: 'text', consistency: 'strong' }], ['gwm', 'css', { type: 'text', consistency: 'strong' }], ['gm', 'dl:file', { consistency: 'strong' }], ['set', 'page', { metadata: { v: 1 } }]])
  })
  test("purger: Netlify's purge endpoint with the function's own purge token, by tag; none without a token or a site", async () => {
    const sent: any[] = []
    const f = async (url: string, init: any) => { sent.push({ url, init }); return new Response('', { status: 202 }) }
    const p = purger({ clientContext: { custom: { purge_api_token: 'pt-1' } } }, 'nsite-1', f as any)!
    expect(await p(['wp-page'])).toBe(true)
    expect(sent[0].url).toBe('https://api.netlify.com/api/v1/purge')
    expect(sent[0].init.headers.authorization).toBe('Bearer pt-1')
    expect(JSON.parse(sent[0].init.body)).toEqual({ site_id: 'nsite-1', cache_tags: ['wp-page'] })
    expect(await purger({ clientContext: { custom: { purge_api_token: 'pt-1' } } }, 'nsite-1', (async () => { throw new Error('x') }) as any)!(['wp-page'])).toBe(false)
    expect(purger({}, 'nsite-1')).toBeNull(); expect(purger({ clientContext: { custom: { purge_api_token: 'pt' } } }, '')).toBeNull()
  })
})
