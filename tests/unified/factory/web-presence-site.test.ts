// A Web presence site's own function (apps/api/src/webPresence/site/handler.mjs), run with a Map for its Blobs and a stand-in for fetch:
// no network, no Netlify. Covers sign-in (expired / reused / wrong site), sessions (site A cannot edit site B, sign-out ends one),
// rate limits, the editor's save (stored in the site's own store, survives a "redeploy"), uploads, and both forms ("sent" only when
// Netlify accepted, a form that is off refuses, the resume's type and size).
import { fileURLToPath } from 'node:url'
import { describe, test, expect } from 'bun:test'
import { createHandler } from '../../../apps/api/src/webPresence/site/handler.mjs'
import { siteSecret, mintSignin, mintSession, signRequest } from '../../../apps/api/src/webPresence/site/session.mjs'

const MASTER = 'master-key-for-tests'

function blobs() {
  const m = new Map<string, any>(); const meta = new Map<string, any>()
  return {
    m,
    get: async (k: string) => (m.has(k) ? m.get(k) : null),
    set: async (k: string, v: any, o?: any) => { m.set(k, v); if (o?.metadata) meta.set(k, o.metadata) },
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

async function site(siteId = 'site-a', opts: { model?: any; factory?: (url: string, init: any) => Promise<Response>; netlify?: (url: string, init: any) => Promise<Response>; t?: { now: number } } = {}) {
  const store = blobs()
  const t = opts.t || { now: Date.UTC(2026, 9, 29, 12, 0, 0) }
  const calls: Array<{ url: string; init: any }> = []
  const secret = await siteSecret(MASTER, siteId)
  const fetchImpl = async (url: any, init: any) => {
    calls.push({ url: String(url), init })
    if (String(url).includes('/forms.html')) return (opts.netlify ? opts.netlify(String(url), init) : new Response('', { status: 200 }))
    return opts.factory ? opts.factory(String(url), init) : new Response(JSON.stringify({ error: 'no factory' }), { status: 500 })
  }
  const env = { WP_SITE_ID: siteId, WP_SECRET: secret, WP_FACTORY_URL: 'https://factory.test', WP_TENANT_ID: 'tenant-a', WP_FACTORY_KEY: 'k' }
  const handler = createHandler({ store, env, fetchImpl, now: () => t.now, initial: { index: '<html>initial</html>', privacy: '<html>privacy</html>', model: opts.model || model() }, spec: { limits: {} } })
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
    const page = await again(new Request('https://acme.netlify.app/?r=page'))
    expect(await page.text()).toBe('<html>saved page</html>')
    const mm = await again(new Request('https://acme.netlify.app/?r=api/model', { headers: { cookie: await s.cookieFor() } }))
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
  test('"sent" only after Netlify accepted it, and the owner is not shown the visitor words in an error', async () => {
    const s = await site()
    const ok = await s.call('api/leads', lead())
    expect(ok.status).toBe(200)
    const posted = s.calls.find((c) => c.url.endsWith('/forms.html'))!
    expect(String(posted.init.body)).toContain('form-name=lead')
    const rejected = await site('site-a', { netlify: async () => new Response('', { status: 500 }) })
    const bad = await rejected.call('api/leads', lead())
    expect(bad.status).toBe(502)
    expect(JSON.stringify(await bad.json())).not.toContain('Pat Smith')
  })
  test('a redirect from Netlify counts as accepted; a network failure does not', async () => {
    const redirect = await site('site-a', { netlify: async () => new Response('', { status: 303 }) })
    expect((await redirect.call('api/leads', lead())).status).toBe(200)
    const down = await site('site-a', { netlify: async () => { throw new Error('offline') } })
    expect((await down.call('api/leads', lead())).status).toBe(502)
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
    expect(s.calls.filter((c) => c.url.endsWith('/forms.html')).length).toBe(0)
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
  test('on: "sent" only after Netlify accepted, with the resume under a name the visitor did not choose', async () => {
    const s = await site('site-a', { model: on() })
    const ok = await s.call('api/apply', app({}, pdf('../../evil name.pdf')))
    expect(ok.status).toBe(200)
    const sent = s.calls.find((c) => c.url.endsWith('/forms.html'))!
    expect(sent.init.body instanceof FormData).toBe(true)
    expect((sent.init.body.get('resume') as File).name).toBe('resume.pdf')
    const rej = await site('site-a', { model: on(), netlify: async () => new Response('', { status: 502 }) })
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
