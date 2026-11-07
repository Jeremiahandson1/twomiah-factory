// The Web presence site's own function — one per customer site, running on THAT site's Netlify. It serves the page from the site's
// Blobs, takes the owner's sign-in, saves the editor's changes, stores photos, and takes the two forms. Everything is injected
// (the store, the clock, fetch, the environment) so the tests run it with a Map and no network; entry.mjs wires the real ones.
//
// Nothing about a site lives anywhere but that site's Blobs. The Factory is asked to DRAW the page from a save (it holds the
// renderer) and keeps nothing of what it is sent.
import { cleanLead, cleanApplication, checkResume, checkImage, effectiveForms, RESUME_TYPES, checkDownload, downloadOffer, cleanLine, cleanEmail, cleanLocation } from './clean.mjs'
import { verifySignin, mintSession, verifySession, signRequest, verifyRequest, rateLimit, hashAddr, randomId, verifyDownload, hmac, hashPassword, checkPassword, PASSWORD_MIN, PASSWORD_MAX } from './session.mjs'
import { LIMITS } from './shapes.mjs'
import { routeOf } from './routes.mjs'

const COOKIE = 'wp_s'
const NO_STORE = 'no-store'
const SECURITY = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
}
// form-action names Stripe's checkout: the Buy button posts to /api/buy, which answers 303 to checkout.stripe.com, and browsers
// apply form-action to a form's redirect too ('self' alone would stop every buyer on the way to paying).
const PAGE_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self'; form-action 'self' https://checkout.stripe.com; base-uri 'self'; frame-ancestors 'self'"

const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': NO_STORE, ...SECURITY, ...extra } })
const html = (body, status = 200, extra = {}) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PAGE_CSP, ...SECURITY, ...extra } })

function cookieOf(req, name) {
  const raw = req.headers.get('cookie') || ''
  for (const part of raw.split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() }
  return ''
}

/** createHandler({ store, env, fetchImpl, now, initial, spec, editorHtml }) → async (Request) => Response */
/** The CDN tag on this site's pages (the page and its privacy page): a save clears exactly these. */
const PAGE_TAG = 'wp-page'

export function createHandler(deps) {
  const { store, env, fetchImpl = fetch, initial, spec } = deps
  // fresh: every read is strong (entry.mjs). purge: clears tagged pages at the CDN. Both together let a page be cached until the next
  // save; without either, a page is cached for a minute at most.
  const fresh = deps.fresh === true, purge = typeof deps.purge === 'function' ? deps.purge : null
  const longCache = fresh && !!purge
  const clearPages = async () => { if (purge) { try { await purge([PAGE_TAG]) } catch { /* the minute-long cache, or the next save */ } } }
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
    // Signing out clears the cookie at once; the revocation reaches every edge within Blobs' 60-second propagation (eventual).
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
    // Tagged, so a save clears it from the CDN at once (clearPages). Kept until then (a day at most) when reads are strong and the
    // clearing is available; otherwise a minute, with no stale tail. Browsers always ask again.
    return html(body, 200, {
      'cache-control': 'public, max-age=0, must-revalidate',
      'netlify-cdn-cache-control': longCache ? 'public, durable, max-age=86400' : 'public, max-age=60',
      'netlify-cache-tag': PAGE_TAG,
      'x-wp-read': fresh ? 'strong' : 'eventual',
    })
  }

  // The page's stylesheet: the one saved with the page (the editor's last save, or the Factory's adopt), else the one deployed with
  // the function. Cached for a year only when the version asked for is the version held — the page and its stylesheet are written
  // together, but Blobs is eventually consistent, so a just-saved page can ask an edge that still holds the previous sheet; that
  // answer is kept for seconds, not a year, and the next ask gets the new one.
  async function stylesheet(want) {
    let body = String(initial.css || ''), ver = String(initial.cssVersion || '')
    const got = store.getWithMetadata ? await store.getWithMetadata('css', { type: 'text' }) : null
    if (got && typeof got.data === 'string' && got.data) { body = got.data; ver = String((got.metadata && got.metadata.v) || '') }
    if (!body) return new Response('Not found', { status: 404, headers: { 'cache-control': NO_STORE, ...SECURITY } })
    const exact = !!want && want === ver
    const cache = exact ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate'
    return new Response(body, { status: 200, headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': cache, 'netlify-cdn-cache-control': exact ? 'public, max-age=31536000, immutable' : 'public, max-age=30', ...SECURITY } })
  }
  /** Store a page's stylesheet with its version — ONE write (the version rides as the blob's metadata), so the two never disagree. */
  async function saveStylesheet(css, v) {
    if (typeof css !== 'string' || !css) return
    await store.set('css', css, { metadata: { v: String(v || '') } })
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
    // Single use, atomically: the first exchange creates `used:<id>` ONLY IF IT IS NEW (checked at Blobs' origin, so two tries at
    // once from two places cannot both pass); a write that changed nothing means the link was already used. (A read-then-write
    // needed a strong read, which this function's store cannot do — entry.mjs.)
    const first = await store.set('used:' + v.jti, String(v.exp), { onlyIfNew: true })
    if (first && first.modified === false) return json({ error: 'That link was already used. Ask for a new one.' }, 401)
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(await mintSession(secret, siteId, now())) })
  }
  // ── the password (Potato-Potahto's manager passcode, done properly: hashed, rate limited, set by the owner) ──
  const sessionCookie = (ses) => `${COOKIE}=${encodeURIComponent(ses)}; Path=/; Max-Age=${12 * 3600}; HttpOnly; Secure; SameSite=Strict`
  const getPassword = async () => { const raw = await kv.get('pw'); if (!raw) return null; try { return JSON.parse(raw) } catch { return null } }
  async function login(req) {
    if (!secret || !siteId) return json({ error: 'This site is not set up for sign-in.' }, 503)
    // Per address, and for the whole site (many addresses guessing at once).
    if (!(await limited(req, 'login', 8, 15 * 60)) || !(await rateLimit(kv, 'login-site', 40, 15 * 60, now())).allowed) return json({ error: 'Too many tries. Please wait 15 minutes, or use the emailed link.' }, 429)
    let body = null
    try { body = await req.json() } catch { /* below */ }
    const password = String((body && body.password) || '')
    const rec = await getPassword()
    if (!rec) return json({ error: 'No password is set for this page yet. Use the emailed link, then set one.' }, 401)
    if (!password || password.length > PASSWORD_MAX || !(await checkPassword(password, rec))) return json({ error: 'That password is not right.' }, 401)
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(await mintSession(secret, siteId, now())) })
  }
  async function setPassword(req) {
    const a = await authed(req); if (a.err) return a.err
    if (!(await limited(req, 'setpw', 10, 3600))) return json({ error: 'Too many changes. Please wait a little.' }, 429)
    let body = null
    try { body = await req.json() } catch { /* below */ }
    const password = String((body && body.password) || '')
    if (password.length < PASSWORD_MIN) return json({ error: 'Use at least ' + PASSWORD_MIN + ' characters.' }, 400)
    if (password.length > PASSWORD_MAX) return json({ error: 'That is too long.' }, 400)
    await kv.set('pw', JSON.stringify(await hashPassword(password)))
    return json({ ok: true })
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
    // All together: the page, its privacy page and its stylesheet are only ever from the same save. The stylesheet goes first, so a
    // page is never out before the sheet it asks for. (A Factory that sends no stylesheet leaves the one held — older Factories.)
    await count('save')
    await saveStylesheet(out.files['styles/main.css'], out.cssVersion)
    await kv.set('model', JSON.stringify(out.model))
    await kv.set('page', out.files['index.html'])
    await kv.set('privacy', out.files['privacy/index.html'] || initial.privacy)
    await clearPages()
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
  /** The kept copy in Netlify Forms (a POST to the site). True when Netlify answers with success or its redirect; nothing depends on it. */
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
  /**
   * A cleaned form message to the owner. The Factory emails it (signed with this site's secret; the inbox is the one the owner set);
   * that is what "sent" means. Netlify's own notice may only email a Twomiah team member, so Netlify Forms is only the kept copy:
   * tried after, and its answer does not decide anything.
   */
  async function deliver(req, form, inbox, fields, file) {
    let resume = null
    if (file) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let bin = ''
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
      resume = { ext: String(file.name).split('.').pop(), content: btoa(bin) }
    }
    const r = await askFactory('form', { form, inbox: inbox || '', fields, ...(resume ? { resume } : {}) })
    await toNetlifyForms(req, form, fields, file)
    return r.ok && r.d && r.d.ok === true
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
    const ok = await deliver(req, 'lead', model.forms.lead && model.forms.lead.inbox, c.fields, null)
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
    const ok = await deliver(req, 'apply', model.forms.hiring && model.forms.hiring.inbox, c.fields, file)
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
    await saveStylesheet(b.css, b.cssVersion)
    await kv.set('model', JSON.stringify(b.model))
    await kv.set('page', b.page)
    if (typeof b.privacy === 'string') await kv.set('privacy', b.privacy)
    await clearPages()
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

  // ── sell a download ─────────────────────────────────────────────────────
  // The money is the owner's own Stripe account (linked through the Factory, which alone holds the platform key). A buyer is sent to
  // Stripe's own checkout; a sale exists here only when the FACTORY says Stripe was paid (signed with this site's secret) — never
  // because a buyer reached /thanks. The file is in this site's store and leaves only through a paid, unrefunded sale's link.
  // Offered only when the Factory shipped the capability in this site's spec (its switch, WEB_PRESENCE_DOWNLOADS_ON).
  const SALE_RE = /^[A-Za-z0-9_-]{8,40}$/
  const DOWNLOADS_PER_LINK = 5
  const selling = () => !!(spec && spec.caps && spec.caps.download)
  const getJson = async (k) => { const raw = await kv.get(k); if (!raw) return null; try { return JSON.parse(raw) } catch { return null } }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  /** A plain page of our own (after paying, a used-up link): no buyer detail goes into a URL, a log or an error. */
  function notice(title, bodyHtml, status = 200) {
    return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title>` +
      `<style>:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--ink:#14181f;--muted:#4a5565;--brand:#1f4e79;--brand-ink:#fff}@media (prefers-color-scheme:dark){:root{--bg:#10141a;--card:#1a2029;--ink:#f1f4f8;--muted:#b4bdca;--brand:#8bb8e8;--brand-ink:#0b1420}}` +
      `body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}main{max-width:560px;margin:10vh auto;padding:24px 16px}.card{background:var(--card);border-radius:12px;padding:20px 22px}h1{font-size:24px;margin:0 0 12px}p{margin:0 0 12px}.muted{color:var(--muted);font-size:15px}a.btn{display:inline-block;background:var(--brand);color:var(--brand-ink);text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px;margin:6px 0 12px}code{font-size:17px;font-weight:700}</style></head>` +
      `<body><main><div class="card"><h1>${esc(title)}</h1>${bodyHtml}<p class="muted"><a href="/">Back to the page</a></p></div></main></body></html>`,
      { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': NO_STORE, 'x-robots-tag': 'noindex, nofollow', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", ...SECURITY } })
  }
  /** A request to the Factory signed with this site's secret (as the save and the link request are). Returns { ok, status, d }. */
  async function askFactory(path, obj) {
    const payload = JSON.stringify({ siteId, ...obj })
    const ts = String(Math.floor(now() / 1000))
    try {
      const r = await fetchImpl(String(env.WP_FACTORY_URL).replace(/\/+$/, '') + '/internal/web-presence/' + path, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-wp-site': siteId, 'x-wp-ts': ts, 'x-wp-sig': await signRequest(secret, ts, payload) }, body: payload,
      })
      let d = null
      try { d = await r.json() } catch { /* below */ }
      return { ok: r.ok, status: r.status, d: d || {} }
    } catch { return { ok: false, status: 0, d: {} } }
  }
  /** A call FROM the Factory: signed over the body with this site's secret. The parsed body, or null. */
  async function fromFactory(req, maxBytes = 20_000) {
    const text = await req.text()
    const ts = req.headers.get('x-wp-ts') || '', sig = req.headers.get('x-wp-sig') || ''
    if (!secret || text.length > maxBytes || !(await verifyRequest(secret, ts, text, sig, now()))) return null
    try { const b = JSON.parse(text); return b && typeof b === 'object' ? b : null } catch { return null }
  }
  const fileInfo = async () => { const m = store.getMetadata ? await store.getMetadata('dl:file') : await store.getWithMetadata('dl:file', { type: 'arrayBuffer' }); return m && m.metadata && m.metadata.name ? m.metadata : null }

  // The buy button: a plain form post (works with no script). The offer is read from what THIS site stores, never from the form.
  async function buy(req) {
    if (!selling()) return json({ error: 'Not found' }, 404)
    if (!(await limited(req, 'buy', 10, 600))) return notice('Please wait a moment', '<p>Too many tries from here. Please try again in a few minutes.</p>', 429)
    const offer = downloadOffer(await getModel())
    const linked = await getJson('stripe')
    if (!offer || !linked || !linked.connected || !(await fileInfo())) return notice('Not on sale right now', '<p>This is not available to buy just now. Please check back soon, or contact us.</p>', 409)
    const saleId = randomId(12)
    const r = await askFactory('checkout', { saleId, origin: originOf(req), offer })
    const url = r.ok && r.d && typeof r.d.url === 'string' ? r.d.url : ''
    if (!/^https:\/\/checkout\.stripe\.com\//.test(url)) return notice('That did not go through', '<p>We could not open the checkout just now. Nothing was charged. Please try again in a minute.</p>', 502)
    await count('buy')
    return new Response(null, { status: 303, headers: { location: url, 'cache-control': NO_STORE, ...SECURITY } })
  }

  // After paying: Stripe sends the buyer here with the checkout's id. The Factory asks Stripe whether it was paid (and records the
  // sale if the webhook has not yet) and answers with the license and a download link — the same link the buyer is emailed.
  async function thanks(req, u) {
    if (!selling()) return json({ error: 'Not found' }, 404)
    const sessionId = String(u.searchParams.get('s') || '')
    if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sessionId)) return notice('Nothing to show', '<p>This page is shown after a purchase.</p>', 404)
    if (!(await limited(req, 'thanks', 30, 600))) return notice('Please wait a moment', '<p>Please try again in a few minutes. Your link is also in your email.</p>', 429)
    const r = await askFactory('sale-status', { sessionId, origin: originOf(req) })
    if (r.ok && r.d.status === 'paid' && typeof r.d.link === 'string' && r.d.link.startsWith(originOf(req) + '/download?k=')) {
      return notice('Thank you, your download is ready', `<p><a class="btn" href="${esc(r.d.link)}">Download ${esc(r.d.product || 'your file')}</a></p>` +
        `<p>Your license number: <code>${esc(r.d.license)}</code></p>` + (r.d.location ? `<p>Licensed for: ${esc(r.d.location)}</p>` : '') +
        `<p class="muted">We also emailed this link to you. It works for 7 days and up to ${DOWNLOADS_PER_LINK} downloads. Keep your license number for your records.</p>`)
    }
    if (r.ok && r.d.status === 'pending') return notice('Your payment is being confirmed', '<p>This can take a minute. Refresh this page, or watch your email: your download link is sent as soon as the payment is confirmed.</p>', 202)
    return notice('We could not find that purchase', '<p>If you paid, your download link is on its way to your email. If it does not arrive, contact us and we will send it again.</p>', 404)
  }

  // The buyer's link: right signature, this site, not expired, the sale on record and not refunded, and not used up.
  async function download(req, u) {
    if (!selling()) return json({ error: 'Not found' }, 404)
    if (!(await limited(req, 'download', 30, 3600))) return notice('Please wait a moment', '<p>Too many downloads from here. Please try again later.</p>', 429)
    const v = await verifyDownload(secret, String(u.searchParams.get('k') || ''), siteId, now())
    if (!v.ok) return notice(v.error === 'expired' ? 'This link has expired' : 'This link is not valid', '<p>Download links work for 7 days. Contact us and we will send you a new one.</p>', v.error === 'expired' ? 410 : 404)
    const sale = await getJson('sale:' + v.saleId)
    if (!sale) return notice('This link is not valid', '<p>Contact us and we will send you a new one.</p>', 404)
    if (sale.refunded) return notice('This purchase was refunded', '<p>A refunded purchase can no longer be downloaded.</p>', 410)
    const used = Number((await kv.get('dlc:' + v.saleId)) || 0)
    if (used >= DOWNLOADS_PER_LINK) return notice('This link has been used up', `<p>It has been used ${DOWNLOADS_PER_LINK} times. Contact us and we will send you a new one.</p>`, 429)
    const got = await store.getWithMetadata('dl:file', { type: 'arrayBuffer' })
    if (!got || !got.data || !got.metadata) return notice('Not available right now', '<p>The file is being updated. Please try again shortly, or contact us.</p>', 503)
    await kv.set('dlc:' + v.saleId, String(used + 1))
    await count('download')
    return new Response(got.data, { status: 200, headers: {
      'content-type': got.metadata.mime || 'application/octet-stream', 'content-disposition': `attachment; filename="${String(got.metadata.name).replace(/[^A-Za-z0-9_.-]/g, '_')}"`,
      'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow', 'content-security-policy': "default-src 'none'; sandbox", ...SECURITY } })
  }

  // ── a free download (a guide, a checklist): any site, no Stripe, no sale ──
  // The owner uploads one PDF or ZIP (the same checks as a paid file); anyone can download it at /free, so any button can link there.
  const FREE_TAG = 'wp-free'
  const freeInfo = async () => { const m = await store.getWithMetadata('free:file', { type: 'arrayBuffer' }); return m && m.metadata && m.metadata.name ? { ...m.metadata } : null }
  async function free(req) {
    if (!(await limited(req, 'free', 60, 3600))) return notice('Please wait a moment', '<p>Too many downloads from here. Please try again later.</p>', 429)
    const got = await store.getWithMetadata('free:file', { type: 'arrayBuffer' })
    if (!got || !got.data || !got.metadata || !got.metadata.name) return notice('Nothing to download yet', '<p>This free download is not available right now.</p>', 404)
    await count('free')
    return new Response(got.data, { status: 200, headers: {
      'content-type': got.metadata.mime || 'application/octet-stream', 'content-disposition': `attachment; filename="${String(got.metadata.name).replace(/[^A-Za-z0-9_.-]/g, '_')}"`,
      'cache-control': 'public, max-age=0, must-revalidate', 'netlify-cdn-cache-control': 'public, max-age=86400', 'netlify-cache-tag': FREE_TAG,
      'content-security-policy': "default-src 'none'; sandbox", ...SECURITY } })
  }
  async function freeFileRoute(req) {
    const a = await authed(req); if (a.err) return a.err
    if (req.method === 'GET') return json({ file: await freeInfo() })
    if (req.method === 'DELETE') {
      await store.delete('free:file')
      if (purge) { try { await purge([FREE_TAG]) } catch { /* a day's cache at most */ } }
      return json({ ok: true, file: null })
    }
    if (!(await limited(req, 'freefile', 20, 3600))) return json({ error: 'Too many uploads. Please wait a little.' }, 429)
    const limit = LIMITS.downloadBytes
    if (Number(req.headers.get('content-length') || 0) > limit + 1024) return json({ error: 'The file can be at most ' + Math.round(limit / 1_000_000) + ' MB.' }, 413)
    const bytes = new Uint8Array(await req.arrayBuffer())
    let name = ''
    try { name = decodeURIComponent(req.headers.get('x-file-name') || '') } catch { name = '' }
    const chk = checkDownload(bytes, name)
    if (!chk.ok) return json({ error: chk.error }, 415)
    const meta = { name: chk.name, mime: chk.mime, size: bytes.length, at: new Date(now()).toISOString() }
    await store.set('free:file', bytes, { metadata: meta })
    if (purge) { try { await purge([FREE_TAG]) } catch { /* a day's cache at most */ } }
    return json({ ok: true, file: meta })
  }

  // The owner's file: what is on file (GET), or a new one (POST, the raw bytes; its name in x-file-name).
  async function fileRoute(req) {
    if (!selling()) return json({ error: 'Not found' }, 404)
    const a = await authed(req); if (a.err) return a.err
    if (req.method === 'GET') return json({ file: await fileInfo() })
    if (!(await limited(req, 'dlfile', 20, 3600))) return json({ error: 'Too many uploads. Please wait a little.' }, 429)
    const limit = LIMITS.downloadBytes
    if (Number(req.headers.get('content-length') || 0) > limit + 1024) return json({ error: 'The file can be at most ' + Math.round(limit / 1_000_000) + ' MB.' }, 413)
    const bytes = new Uint8Array(await req.arrayBuffer())
    let name = ''
    try { name = decodeURIComponent(req.headers.get('x-file-name') || '') } catch { name = '' }
    const chk = checkDownload(bytes, name)
    if (!chk.ok) return json({ error: chk.error }, 415)
    const meta = { name: chk.name, mime: chk.mime, size: bytes.length, at: new Date(now()).toISOString() }
    await store.set('dl:file', bytes, { metadata: meta })
    return json({ ok: true, file: meta })
  }

  async function allSales() {
    const listed = store.list ? await store.list({ prefix: 'sale:' }) : { blobs: [] }
    const out = []
    for (const b of (listed && listed.blobs) || []) {
      const s = await getJson(b.key)
      if (s && s.id) out.push({ ...s, downloads: Number((await kv.get('dlc:' + s.id)) || 0) })
    }
    return out.sort((x, y) => String(y.at).localeCompare(String(x.at)))
  }
  // The owner's own record of who bought, where it is licensed for, and what happened to it. Kept in this site's store only.
  async function sales(req) {
    if (!selling()) return json({ error: 'Not found' }, 404)
    const a = await authed(req); if (a.err) return a.err
    return json({ sales: await allSales(), perLink: DOWNLOADS_PER_LINK })
  }
  async function salesCsv(req) {
    if (!selling()) return json({ error: 'Not found' }, 404)
    const a = await authed(req); if (a.err) return a.err
    // A cell a spreadsheet would read as a formula is written as text (a leading ').
    const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"' }
    const rows = [['Date', 'License', 'Buyer', 'Email', 'Licensed for', 'Product', 'Amount', 'Currency', 'Status', 'Downloads']]
    for (const s of await allSales()) rows.push([String(s.at).slice(0, 10), s.license, s.name, s.email, s.location, s.product, (Number(s.amountCents) / 100).toFixed(2), String(s.currency || '').toUpperCase(), s.refunded ? 'Refunded' : 'Paid', s.downloads])
    return new Response(rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n', { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="sales.csv"', 'cache-control': NO_STORE, ...SECURITY } })
  }
  // Send a buyer a fresh link (7 more days, the download count starts again). The Factory mails it; only to the email on the sale.
  async function resend(req) {
    if (!selling()) return json({ error: 'Not found' }, 404)
    const a = await authed(req); if (a.err) return a.err
    if (!(await limited(req, 'resend', 20, 3600))) return json({ error: 'Too many. Please wait a little.' }, 429)
    let b = null
    try { b = await req.json() } catch { /* below */ }
    const saleId = String((b && b.saleId) || '')
    if (!SALE_RE.test(saleId)) return json({ error: 'That sale was not found.' }, 404)
    const sale = await getJson('sale:' + saleId)
    if (!sale) return json({ error: 'That sale was not found.' }, 404)
    if (sale.refunded) return json({ error: 'That sale was refunded, so it has no download.' }, 409)
    const r = await askFactory('resend', { saleId, origin: originOf(req), email: sale.email, name: sale.name, license: sale.license, product: sale.product })
    if (!r.ok) return json({ error: (r.d && r.d.error) || 'Could not send it just now. Please try again in a minute.' }, 502)
    await kv.set('dlc:' + saleId, '0')
    return json({ ok: true })
  }

  // Linking the owner's Stripe account: the Factory runs Stripe's sign-in (it alone holds the platform key) and hands the result
  // back here, signed. The nonce proves the result belongs to the sign-in THIS owner started: only its hash is kept, used once.
  const nonceHash = async (n) => hmac(secret, 'stripe-nonce:' + n)
  async function stripeStatus(req) {
    if (!selling()) return json({ error: 'Not found' }, 404)
    const a = await authed(req); if (a.err) return a.err
    const s = await getJson('stripe')
    return json({ connected: !!(s && s.connected), at: (s && s.at) || null })
  }
  async function stripeStart(req) {
    if (!selling()) return json({ error: 'Not found' }, 404)
    const a = await authed(req); if (a.err) return a.err
    if (!(await limited(req, 'stripe', 10, 3600))) return json({ error: 'Too many tries. Please wait a little.' }, 429)
    const nonce = randomId(24)
    await kv.set('stripe-nonce', JSON.stringify({ h: await nonceHash(nonce), e: Math.floor(now() / 1000) + 15 * 60 }))
    const r = await askFactory('stripe/start', { nonce })
    const url = r.ok && r.d && typeof r.d.url === 'string' ? r.d.url : ''
    if (!/^https:\/\/connect\.stripe\.com\//.test(url)) return json({ error: (r.d && r.d.error) || 'Linking Stripe is not available just now.' }, r.status === 503 ? 503 : 502)
    return json({ url })
  }
  async function stripeDisconnect(req) {
    if (!selling()) return json({ error: 'Not found' }, 404)
    const a = await authed(req); if (a.err) return a.err
    const r = await askFactory('stripe/disconnect', {})
    if (!r.ok) return json({ error: (r.d && r.d.error) || 'Could not disconnect just now. Please try again.' }, 502)
    await kv.set('stripe', JSON.stringify({ connected: false, at: new Date(now()).toISOString() }))
    return json({ ok: true })
  }
  /** From the Factory: Stripe's answer to the owner's sign-in (an account, or why not), or Stripe saying the owner removed us. */
  async function stripeLink(req) {
    const b = await fromFactory(req)
    if (!b) return json({ error: 'Not found' }, 404)
    if (b.outcome === 'deauthorized') { await kv.set('stripe', JSON.stringify({ connected: false, at: new Date(now()).toISOString() })); return json({ ok: true }) }
    const pending = await getJson('stripe-nonce')
    const nonce = String(b.nonce || '')
    if (!pending || !nonce || pending.h !== (await nonceHash(nonce))) return json({ error: 'No sign-in like that was started here.' }, 410)
    await kv.set('stripe-nonce', '')                                     // used once, whatever the answer
    if (b.outcome) return json({ ok: true })                             // cancelled / failed at Stripe: nothing to keep
    if (!(pending.e > Math.floor(now() / 1000))) return json({ error: 'That sign-in took too long.' }, 410)
    if (!/^acct_[A-Za-z0-9]+$/.test(String(b.accountId || ''))) return json({ error: 'That did not look right.' }, 400)
    const cur = await getJson('stripe')
    if (cur && cur.connected) return json({ error: 'A Stripe account is already linked.' }, 409)
    await kv.set('stripe', JSON.stringify({ connected: true, at: new Date(now()).toISOString() }))
    return json({ ok: true })
  }
  /** From the Factory: Stripe says this sale is paid. Kept once (a second delivery changes nothing). */
  async function saleRecord(req) {
    if (!selling()) return json({ error: 'Not found' }, 404)
    const b = await fromFactory(req)
    if (!b) return json({ error: 'Not found' }, 404)
    const id = String(b.saleId || '')
    if (!SALE_RE.test(id)) return json({ error: 'That did not look right.' }, 400)
    const sale = {
      id, license: cleanLine(b.license, 40), sessionId: cleanLine(b.sessionId, 300), product: cleanLine(b.product, 100),
      name: cleanLine(b.name, 120), email: cleanEmail(b.email), location: cleanLocation(b.location),
      amountCents: Math.max(0, Math.round(Number(b.amountCents) || 0)), currency: cleanLine(b.currency, 3).toLowerCase(),
      at: cleanLine(b.at, 40) || new Date(now()).toISOString(), refunded: false,
    }
    const w = await store.set('sale:' + id, JSON.stringify(sale), { onlyIfNew: true })
    return json({ ok: true, created: !(w && w.modified === false) })
  }
  /** From the Factory: the sale was refunded in full. Its links stop working. */
  async function saleRefund(req) {
    if (!selling()) return json({ error: 'Not found' }, 404)
    const b = await fromFactory(req)
    if (!b) return json({ error: 'Not found' }, 404)
    const id = String(b.saleId || '')
    const sale = SALE_RE.test(id) ? await getJson('sale:' + id) : null
    if (!sale) return json({ ok: true, known: false })
    if (!sale.refunded) await kv.set('sale:' + id, JSON.stringify({ ...sale, refunded: true, refundedAt: new Date(now()).toISOString() }))
    return json({ ok: true, known: true })
  }

  // ── routing ─────────────────────────────────────────────────────────────
  return async function handle(req) {
    const u = new URL(req.url)
    const r = routeOf(u)
    const m = req.method
    try {
      if (r === 'page' && (m === 'GET' || m === 'HEAD')) { await count('page'); return await page('page') }
      if (r === 'api/usage' && m === 'GET') return await usage(req)
      if (r === 'api/adopt' && m === 'POST') return await adopt(req)
      if (r === 'api/export' && m === 'GET') return await exportModel(req)
      if (r === 'privacy' && (m === 'GET' || m === 'HEAD')) return await page('privacy')
      if (r === 'img' && m === 'GET') return await img(u.searchParams.get('h'))
      if (r === 'css' && (m === 'GET' || m === 'HEAD')) return await stylesheet(u.searchParams.get('v') || '')
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
      if (r === 'api/me' && m === 'GET') { const sIn = !!(await session(req)); return json({ signedIn: sIn, ...(sIn ? { hasPassword: !!(await getPassword()) } : {}) }) }
      if (r === 'api/login' && m === 'POST') return await login(req)
      if (r === 'api/password' && m === 'POST') return await setPassword(req)
      if (r === 'api/buy' && m === 'POST') return await buy(req)
      if (r === 'thanks' && (m === 'GET' || m === 'HEAD')) return await thanks(req, u)
      if (r === 'download' && m === 'GET') return await download(req, u)
      if (r === 'api/download/file' && (m === 'GET' || m === 'POST')) return await fileRoute(req)
      if (r === 'free' && (m === 'GET' || m === 'HEAD')) return await free(req)
      if (r === 'api/free/file' && (m === 'GET' || m === 'POST' || m === 'DELETE')) return await freeFileRoute(req)
      if (r === 'api/sales' && m === 'GET') return await sales(req)
      if (r === 'api/sales.csv' && m === 'GET') return await salesCsv(req)
      if (r === 'api/sales/resend' && m === 'POST') return await resend(req)
      if (r === 'api/stripe' && m === 'GET') return await stripeStatus(req)
      if (r === 'api/stripe/start' && m === 'POST') return await stripeStart(req)
      if (r === 'api/stripe/disconnect' && m === 'POST') return await stripeDisconnect(req)
      if (r === 'api/stripe-link' && m === 'POST') return await stripeLink(req)
      if (r === 'api/sale' && m === 'POST') return await saleRecord(req)
      if (r === 'api/refund' && m === 'POST') return await saleRefund(req)
      return json({ error: 'Not found' }, 404)
    } catch {
      // Never echo a visitor's or an applicant's words in an error or a log.
      return json({ error: 'Something went wrong. Please try again.' }, 500)
    }
  }
}
export { randomId }
