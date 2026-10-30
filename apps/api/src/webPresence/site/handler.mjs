// The Web presence site's own function — one per customer site, running on THAT site's Netlify. It serves the page from the site's
// Blobs, takes the owner's sign-in, saves the editor's changes, stores photos, and takes the two forms. Everything is injected
// (the store, the clock, fetch, the environment) so the tests run it with a Map and no network; entry.mjs wires the real ones.
//
// Nothing about a site lives anywhere but that site's Blobs. The Factory is asked to DRAW the page from a save (it holds the
// renderer) and keeps nothing of what it is sent.
import { cleanLead, cleanApplication, checkResume, checkImage, effectiveForms, RESUME_TYPES } from './clean.mjs'
import { verifySignin, mintSession, verifySession, signRequest, verifyRequest, rateLimit, hashAddr, randomId } from './session.mjs'
import { LIMITS } from './shapes.mjs'

const COOKIE = 'wp_s'
const NO_STORE = 'no-store'
const SECURITY = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
}
const PAGE_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'self'"

const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': NO_STORE, ...SECURITY, ...extra } })
const html = (body, status = 200, extra = {}) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PAGE_CSP, ...SECURITY, ...extra } })

function cookieOf(req, name) {
  const raw = req.headers.get('cookie') || ''
  for (const part of raw.split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() }
  return ''
}

/** createHandler({ store, env, fetchImpl, now, initial, spec, editorHtml }) → async (Request) => Response */
export function createHandler(deps) {
  const { store, env, fetchImpl = fetch, initial, spec } = deps
  const now = deps.now || (() => Date.now())
  const siteId = String(env.WP_SITE_ID || '')
  const secret = String(env.WP_SECRET || '')
  const kv = {
    get: async (k) => { const v = await store.get(k, { type: 'text' }); return v ?? null },
    set: async (k, v) => { await store.set(k, String(v)) },
  }
  const getModel = async () => { const raw = await kv.get('model'); try { return raw ? JSON.parse(raw) : initial.model } catch { return initial.model } }
  const addrOf = (req) => (req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0] || '').trim()
  const originOf = (req) => 'https://' + (req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host)

  async function session(req) {
    if (!secret || !siteId) return null
    const tok = decodeURIComponent(cookieOf(req, COOKIE))
    if (!tok) return null
    const s = await verifySession(secret, tok, siteId, now())
    if (!s.ok) return null
    if (await kv.get('revoked:' + s.sid)) return null
    return s
  }
  /** A change needs a session AND the custom header AND (when the browser sends one) a same-site Origin: the cookie alone is not enough. */
  async function authed(req) {
    const s = await session(req)
    if (!s) return { err: json({ error: 'Please sign in again.' }, 401) }
    if (req.method !== 'GET') {
      if (req.headers.get('x-wp') !== '1') return { err: json({ error: 'Not allowed.' }, 403) }
      const o = req.headers.get('origin')
      if (o && new URL(o).host !== (req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host)) return { err: json({ error: 'Not allowed.' }, 403) }
    }
    return { s }
  }
  const limited = async (req, bucket, limit, windowSec) => (await rateLimit(kv, bucket + ':' + await hashAddr(secret || 'x', addrOf(req)), limit, windowSec, now())).allowed

  // ── the page ────────────────────────────────────────────────────────────
  async function page(which) {
    const saved = await kv.get(which === 'privacy' ? 'privacy' : 'page')
    const body = saved || (which === 'privacy' ? initial.privacy : initial.index)
    // The CDN may keep a copy for a minute: an edit shows within a minute, and a visit costs a function run only when it expires.
    return html(body, 200, { 'cache-control': 'public, max-age=0, must-revalidate', 'netlify-cdn-cache-control': 'public, max-age=60, stale-while-revalidate=600' })
  }

  async function img(hash) {
    if (!/^[0-9a-f]{40}$/.test(String(hash))) return new Response('Not found', { status: 404 })
    const got = await store.getWithMetadata('img:' + hash, { type: 'arrayBuffer' })
    if (!got || !got.data) return new Response('Not found', { status: 404 })
    return new Response(got.data, { status: 200, headers: { 'content-type': (got.metadata && got.metadata.mime) || 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" } })
  }

  // ── sign-in ─────────────────────────────────────────────────────────────
  async function signin(req) {
    if (!secret || !siteId) return json({ error: 'This site is not set up for sign-in.' }, 503)
    if (!(await limited(req, 'signin', 10, 15 * 60))) return json({ error: 'Too many tries. Please wait a few minutes.' }, 429)
    let body = null
    try { body = await req.json() } catch { /* below */ }
    const v = await verifySignin(secret, body && body.token, siteId, now())
    if (!v.ok) return json({ error: v.error === 'expired' ? 'That link has expired. Ask for a new one.' : 'That sign-in link is not valid.' }, 401)
    // Single use: the first exchange records the link's id; a second one is refused.
    if (await kv.get('used:' + v.jti)) return json({ error: 'That link was already used. Ask for a new one.' }, 401)
    await kv.set('used:' + v.jti, String(v.exp))
    const ses = await mintSession(secret, siteId, now())
    return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=${encodeURIComponent(ses)}; Path=/; Max-Age=${12 * 3600}; HttpOnly; Secure; SameSite=Strict` })
  }
  async function signout(req) {
    const a = await authed(req)
    if (a.err) return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict` })
    await kv.set('revoked:' + a.s.sid, String(a.s.exp))
    return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict` })
  }

  // ── "email me a new sign-in link" ───────────────────────────────────────
  // The site cannot send email; the Factory can, and sends ONLY to the owner's address it holds, so this answers the same whoever asks.
  async function linkRequest(req) {
    if (!secret || !siteId) return json({ error: 'This site is not set up for sign-in.' }, 503)
    if (!(await limited(req, 'link', 3, 3600)) || !(await rateLimit(kv, 'link-site', 6, 86400, now())).allowed) return json({ ok: true })
    const payload = JSON.stringify({ siteId })
    const ts = String(Math.floor(now() / 1000))
    try {
      await fetchImpl(String(env.WP_FACTORY_URL).replace(/\/+$/, '') + '/internal/web-presence/link-request', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-wp-site': siteId, 'x-wp-ts': ts, 'x-wp-sig': await signRequest(secret, ts, payload) }, body: payload,
      })
    } catch { /* the answer is the same either way */ }
    return json({ ok: true })
  }

  // ── the editor's model ──────────────────────────────────────────────────
  async function modelGet(req) {
    const a = await authed(req); if (a.err) return a.err
    return json({ model: await getModel(), spec })
  }
  async function modelSave(req) {
    const a = await authed(req); if (a.err) return a.err
    if (!(await limited(req, 'save', 120, 3600))) return json({ error: 'Too many saves. Please wait a little.' }, 429)
    const text = await req.text()
    if (text.length > LIMITS.modelBytes + 20_000) return json({ error: 'That is too much to save at once.' }, 413)
    let raw = null
    try { raw = JSON.parse(text) } catch { return json({ error: 'That did not look right.' }, 400) }
    const prev = await getModel()
    // The Factory draws the page and finishes the cleaning (layouts, colours); it keeps nothing of what it is sent.
    const payload = JSON.stringify({ siteId, model: raw, prev })
    const ts = String(Math.floor(now() / 1000))
    let res
    try {
      res = await fetchImpl(String(env.WP_FACTORY_URL).replace(/\/+$/, '') + '/internal/web-presence/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-wp-site': siteId, 'x-wp-ts': ts, 'x-wp-sig': await signRequest(secret, ts, payload) },
        body: payload,
      })
    } catch { return json({ error: 'Could not save right now. Nothing was changed. Please try again in a minute.' }, 502) }
    let out = null
    try { out = await res.json() } catch { /* below */ }
    if (!res.ok || !out || !out.model || !out.files || typeof out.files['index.html'] !== 'string') {
      return json({ error: (out && out.error) || 'Could not save right now. Nothing was changed.' }, res.status === 400 ? 400 : 502)
    }
    // All three together: the page and its privacy page are only ever from the same save.
    await count('save')
    await kv.set('model', JSON.stringify(out.model))
    await kv.set('page', out.files['index.html'])
    await kv.set('privacy', out.files['privacy/index.html'] || initial.privacy)
    return json({ ok: true, model: out.model, notes: out.notes || [] })
  }

  // ── photos ──────────────────────────────────────────────────────────────
  async function upload(req) {
    const a = await authed(req); if (a.err) return a.err
    if (!(await limited(req, 'upload', 60, 3600))) return json({ error: 'Too many uploads. Please wait a little.' }, 429)
    const len = Number(req.headers.get('content-length') || 0)
    if (len > LIMITS.imageBytes + 1024) return json({ error: 'That photo is too large. It is resized to under ' + Math.round(LIMITS.imageBytes / 1000) + ' KB before it is sent.' }, 413)
    const bytes = new Uint8Array(await req.arrayBuffer())
    const chk = checkImage(bytes)
    if (!chk.ok) return json({ error: chk.error }, 415)
    const digest = await crypto.subtle.digest('SHA-1', bytes)
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
    await count('upload')
    await store.set('img:' + hash, bytes, { metadata: { mime: chk.mime } })
    return json({ ok: true, url: '/media?h=' + hash })
  }

  // ── the two forms ───────────────────────────────────────────────────────
  /** Netlify Forms takes a POST to the site; it counts as accepted only when Netlify answers with success or its redirect. */
  async function toNetlifyForms(req, formName, fields, file) {
    const target = originOf(req) + '/forms.html'
    let body
    const headers = {}
    if (file) {
      body = new FormData()
      body.append('form-name', formName)
      for (const [k, v] of Object.entries(fields)) body.append(k, v)
      body.append('resume', file, file.name)
    } else {
      body = new URLSearchParams({ 'form-name': formName, ...fields }).toString()
      headers['content-type'] = 'application/x-www-form-urlencoded'
    }
    try {
      const r = await fetchImpl(target, { method: 'POST', headers, body, redirect: 'manual' })
      return r.status >= 200 && r.status < 400
    } catch { return false }
  }
  const stampTooFast = (f) => { const t = Number(f.t); return Number.isFinite(t) && t > 0 && now() - t < 2000 }
  const fieldsOf = (fd) => { const o = {}; for (const [k, v] of fd.entries()) if (typeof v === 'string') o[k] = v; return o }

  async function leads(req) {
    const model = await getModel()
    if (!effectiveForms(model).lead) return json({ error: 'This form is not taking messages.' }, 404)
    if (!(await limited(req, 'lead', 5, 600)) || !(await limited(req, 'lead-day', 20, 86400))) return json({ error: 'Too many messages from here. Please try again later.' }, 429)
    let f
    try { f = fieldsOf(await req.formData()) } catch { return json({ error: 'That did not look right.' }, 400) }
    // A robot fills the hidden field or answers instantly: it is told "sent" and nothing is passed on.
    if (f.website || stampTooFast(f)) return json({ ok: true, message: 'Thanks — your message was sent.' })
    const c = cleanLead(f, ((model.forms.lead && model.forms.lead.extraFields) || []).map((x) => x.label))
    if (!c.ok) return json({ error: c.error }, 400)
    await count('lead')
    const ok = await toNetlifyForms(req, 'lead', c.fields)
    return ok ? json({ ok: true, message: 'Thanks — your message was sent.' }) : json({ error: 'That didn’t go through. Please try again, or call us.' }, 502)
  }

  async function apply(req) {
    const model = await getModel()
    if (!effectiveForms(model).hiring) return json({ error: 'We are not taking applications here.' }, 404)
    if (!(await limited(req, 'apply', 3, 600)) || !(await limited(req, 'apply-day', 15, 86400))) return json({ error: 'Too many applications from here. Please try again later.' }, 429)
    const limitMb = LIMITS.resumeMb
    if (Number(req.headers.get('content-length') || 0) > (limitMb + 1) * 1024 * 1024) return json({ error: 'A resume can be at most ' + limitMb + ' MB.' }, 413)
    let fd
    try { fd = await req.formData() } catch { return json({ error: 'That did not look right.' }, 400) }
    const f = fieldsOf(fd)
    if (f.website || stampTooFast(f)) return json({ ok: true, message: 'Thanks — your application was sent.' })
    const jobs = ((model.sections.find((s) => s.id === 'hiring') || {}).data || {}).jobs || []
    const c = cleanApplication(f, jobs.map((j) => j.title))
    if (!c.ok) return json({ error: c.error }, 400)
    let file = fd.get('resume')
    if (file && typeof file === 'object' && file.size === 0) file = null
    if (file && typeof file === 'object') {
      const head = new Uint8Array(await file.slice(0, 8).arrayBuffer())
      const chk = checkResume({ name: file.name, size: file.size, head }, limitMb)
      if (!chk.ok) return json({ error: chk.error }, 415)
      // The stored name never comes from the visitor. Built from the BYTES: a File made from another File kept the visitor's name
      // on some runtimes (Bun 1.3 on CI sent "../../evil name.pdf"); bytes carry no name, on any runtime.
      file = new File([await file.arrayBuffer()], 'resume.' + chk.ext, { type: RESUME_TYPES[chk.ext] })
    } else file = null
    await count('apply')
    const ok = await toNetlifyForms(req, 'apply', c.fields, file)
    return ok ? json({ ok: true, message: 'Thanks — your application was sent.' }) : json({ error: 'That didn’t go through. Please try again, or call us.' }, 502)
  }

  // ── usage: counts only, never content. Function runs are what costs credits, so they are what staff see. ──
  const month = () => new Date(now()).toISOString().slice(0, 7)
  async function count(what) {
    try { const k = 'n:' + month() + ':' + what; await kv.set(k, String(Number((await kv.get(k)) || 0) + 1)) } catch { /* a counter never fails a request */ }
  }
  async function usage(req) {
    const ts = req.headers.get('x-wp-ts') || '', sig = req.headers.get('x-wp-sig') || ''
    if (!secret || !(await verifyRequest(secret, ts, 'usage', sig, now()))) return json({ error: 'Not found' }, 404)
    const out = { month: month() }
    for (const w of ['page', 'save', 'upload', 'lead', 'apply']) out[w] = Number((await kv.get('n:' + month() + ':' + w)) || 0)
    return json(out)
  }

  // The Factory asking for the site's content when the owner moves up to the full plan (signed, like usage).
  async function exportModel(req) {
    const ts = req.headers.get('x-wp-ts') || '', sig = req.headers.get('x-wp-sig') || ''
    if (!secret || !(await verifyRequest(secret, ts, 'export', sig, now()))) return json({ error: 'Not found' }, 404)
    return json({ model: await getModel() })
  }

  // The Factory replacing the stored model and page together (a change of trade: the sections stay, the page is drawn again). Signed over
  // the body, so only the Factory can do it; it is the one way the Factory writes to a site's content, and it keeps nothing.
  async function adopt(req) {
    const text = await req.text()
    const ts = req.headers.get('x-wp-ts') || '', sig = req.headers.get('x-wp-sig') || ''
    if (!secret || text.length > LIMITS.modelBytes * 4 || !(await verifyRequest(secret, ts, text, sig, now()))) return json({ error: 'Not found' }, 404)
    let b = null
    try { b = JSON.parse(text) } catch { return json({ error: 'That did not look right.' }, 400) }
    if (!b || !b.model || typeof b.page !== 'string') return json({ error: 'That did not look right.' }, 400)
    await kv.set('model', JSON.stringify(b.model))
    await kv.set('page', b.page)
    if (typeof b.privacy === 'string') await kv.set('privacy', b.privacy)
    return json({ ok: true })
  }

  // ── the address (domain) ────────────────────────────────────────────────
  // The site cannot reach the registrar or DNS; the Factory's existing domain flow does. The owner's signed-in session asks the site,
  // the site asks the Factory with its own key (X-Factory-Key, the tenant's factory_sync_key). Only these three operations pass.
  async function domainProxy(req, op) {
    const a = await authed(req); if (a.err) return a.err
    if (!env.WP_FACTORY_URL || !env.WP_TENANT_ID || !env.WP_FACTORY_KEY) return json({ error: 'This site is not set up for addresses.' }, 503)
    if (!(await limited(req, 'domain', 30, 3600))) return json({ error: 'Too many tries. Please wait a little.' }, 429)
    let body = {}
    if (req.method === 'POST') {
      const text = await req.text()
      if (text.length > 4000) return json({ error: 'That is too much.' }, 413)
      try { body = text ? JSON.parse(text) : {} } catch { return json({ error: 'That did not look right.' }, 400) }
    }
    const domain = String(body.domain || '').trim().toLowerCase().slice(0, 253)
    let path = op === 'status' ? 'status' : op
    let payload
    if (op === 'attach') payload = { domain, mode: 'byod' }
    else if (op === 'buy') payload = { domain, years: 1, returnTo: 'admin', returnPath: '/edit/', registrant: body.registrant && typeof body.registrant === 'object' ? body.registrant : undefined }
    const url = String(env.WP_FACTORY_URL).replace(/\/+$/, '') + '/internal/domain/' + path + '/' + encodeURIComponent(String(env.WP_TENANT_ID))
    let res
    try {
      res = await fetchImpl(url, { method: op === 'status' ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'x-factory-key': String(env.WP_FACTORY_KEY) }, body: op === 'status' ? undefined : JSON.stringify(payload) })
    } catch { return json({ error: 'Could not reach the address service. Please try again in a minute.' }, 502) }
    let out = {}
    try { out = await res.json() } catch { /* below */ }
    return json(out, res.status >= 200 && res.status < 600 ? res.status : 502)
  }

  // ── routing ─────────────────────────────────────────────────────────────
  return async function handle(req) {
    const u = new URL(req.url)
    const r = (u.searchParams.get('r') || 'page').replace(/^\/+/, '')
    const m = req.method
    try {
      if (r === 'page' && (m === 'GET' || m === 'HEAD')) { await count('page'); return await page('page') }
      if (r === 'api/usage' && m === 'GET') return await usage(req)
      if (r === 'api/adopt' && m === 'POST') return await adopt(req)
      if (r === 'api/export' && m === 'GET') return await exportModel(req)
      if (r === 'privacy' && (m === 'GET' || m === 'HEAD')) return await page('privacy')
      if (r === 'img' && m === 'GET') return await img(u.searchParams.get('h'))
      if (r === 'api/signin' && m === 'POST') return await signin(req)
      if (r === 'api/signout' && m === 'POST') return await signout(req)
      if (r === 'api/link' && m === 'POST') return await linkRequest(req)
      if (r === 'api/model' && m === 'GET') return await modelGet(req)
      if (r === 'api/model' && m === 'POST') return await modelSave(req)
      if (r === 'api/upload' && m === 'POST') return await upload(req)
      if (r === 'api/leads' && m === 'POST') return await leads(req)
      if (r === 'api/apply' && m === 'POST') return await apply(req)
      if (r === 'api/domain/status' && m === 'GET') return await domainProxy(req, 'status')
      if (r === 'api/domain/attach' && m === 'POST') return await domainProxy(req, 'attach')
      if (r === 'api/domain/buy' && m === 'POST') return await domainProxy(req, 'buy')
      if (r === 'api/me' && m === 'GET') return json({ signedIn: !!(await session(req)) })
      return json({ error: 'Not found' }, 404)
    } catch {
      // Never echo a visitor's or an applicant's words in an error or a log.
      return json({ error: 'Something went wrong. Please try again.' }, 500)
    }
  }
}
export { randomId }
