// A $19 site's form messages reach the owner by the Factory's own email (webPresence/forms.ts) — Netlify's form email notice may only
// go to a member of the Twomiah Netlify team (422 for any other address: the first real customer, 11/07).
// Covers: who it goes to (the owner's chosen inbox, else the account's), reply-to the visitor, the resume attached and checked again,
// the visitor's words escaped, a failed send told to the site (and to staff), and the route: signed by THAT site, off = 404, size cap.
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test'
import { installAuth, restoreAuth } from './stubs.ts'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fakeStore } from './fakeStore'
import { deliverForm, formEmail, FormError, FORM_BODY_MAX, type FormMail } from '../../../apps/api/src/webPresence/forms'
import { siteSecret, signRequest } from '../../../apps/api/src/webPresence/site/session.mjs'

const { Hono } = createRequire(path.resolve(import.meta.dir, '../../../apps/api/package.json'))('hono')
let registerWebPresenceRoutes: any
beforeAll(async () => {
  installAuth({ supabase: fakeStore({ tenants: [] }) })
  ;({ registerWebPresenceRoutes } = await import('../../../apps/api/src/routes/factory/webPresence'))
})
afterAll(restoreAuth)

const MASTER = 'master-key-for-tests'
const NOW = Math.floor(Date.now() / 1000) * 1000
const TID = '11111111-1111-1111-1111-111111111111'
const row = { id: 'site-1', tenant_id: TID, status: 'live', origin: 'https://acme.netlify.app', netlify_site_id: 'ns-1' } as any

function world(over: { tenant?: any; send?: (m: FormMail) => Promise<boolean> } = {}) {
  const db = fakeStore({ tenants: [{ id: TID, name: 'The Hobby <Starter>', email: 'owner@yahoo.test', admin_email: 'owner@yahoo.test', ...(over.tenant || {}) }], web_presence_sites: [{ ...row }] })
  const sent: FormMail[] = []
  const alerts: string[] = []
  const d = { db, sendFormEmail: over.send || (async (m: FormMail) => { sent.push(m); return true }), alert: async (key: string) => { alerts.push(key) } }
  return { db, d, sent, alerts }
}
const lead = (over: any = {}) => ({ siteId: 'site-1', form: 'lead', inbox: 'club@yahoo.test', fields: { name: 'Pat Smith', email: 'pat@example.com', phone: '(555) 123-4567', message: 'Do you ship to Canada?' }, ...over })
const pdfB64 = (size = 300) => { const b = Buffer.alloc(size); b.write('%PDF-1.7'); return b.toString('base64') }

describe('the email the owner gets', () => {
  test("a lead goes to the inbox the owner set, replying to the visitor, with every field and the business named", async () => {
    const w = world()
    expect(await deliverForm(w.d, row, lead())).toEqual({ ok: true })
    expect(w.sent).toHaveLength(1)
    const m = w.sent[0]
    expect(m.to).toBe('club@yahoo.test'); expect(m.replyTo).toBe('pat@example.com'); expect(m.attachment).toBeUndefined()
    expect(m.subject).toBe('New message from your website — Pat Smith')
    for (const s of ['Pat Smith', 'pat@example.com', '(555) 123-4567', 'Do you ship to Canada?', 'The Hobby &lt;Starter&gt;', 'Press Reply']) expect(m.html).toContain(s)
  })
  test("no inbox set: the account's own email; neither: nothing sent, staff told, the site told it did not go", async () => {
    const w = world()
    await deliverForm(w.d, row, lead({ inbox: '' }))
    expect(w.sent[0].to).toBe('owner@yahoo.test')
    const none = world({ tenant: { email: '', admin_email: '' } })
    expect(await deliverForm(none.d, row, lead({ inbox: 'not an address' }))).toEqual({ ok: false })
    expect(none.sent).toHaveLength(0); expect(none.alerts).toEqual(['web-presence-form-inbox:' + TID])
  })
  test('no email from the visitor: no reply-to, and the owner is told to call back', async () => {
    const w = world()
    await deliverForm(w.d, row, lead({ fields: { name: 'Pat', phone: '5551234567', message: 'Call me' } }))
    expect(w.sent[0].replyTo).toBeUndefined(); expect(w.sent[0].html).toContain('call them back')
  })
  test("the visitor's words are escaped (no markup reaches the owner's mail) and unknown fields are dropped", async () => {
    const w = world()
    await deliverForm(w.d, row, lead({ fields: { name: '<b>Pat</b>', email: 'pat@example.com', message: '<script>x()</script>\nline two', secret: 'leak' } }))
    const h = w.sent[0].html
    expect(h).not.toContain('<script>'); expect(h).not.toContain('<b>Pat'); expect(h).toContain('&lt;script&gt;'); expect(h).toContain('<br>line two'); expect(h).not.toContain('leak')
  })
  test('a job application: its own subject, the resume attached as resume.<type>, checked again here', async () => {
    const w = world()
    const app = { siteId: 'site-1', form: 'apply', inbox: '', fields: { name: 'Sam Lee', email: 'sam@example.com', job: 'Coach', about: 'Five years running clubs' }, resume: { ext: 'pdf', content: pdfB64() } }
    expect(await deliverForm(w.d, row, app)).toEqual({ ok: true })
    expect(w.sent[0].subject).toBe('New job application — Sam Lee')
    expect(w.sent[0].attachment).toEqual({ filename: 'resume.pdf', content: pdfB64() })
    expect(w.sent[0].html).toContain('Their resume is attached.')
    for (const resume of [{ ext: 'exe', content: pdfB64() }, { ext: 'pdf', content: Buffer.from('hello world').toString('base64') }, { ext: 'pdf', content: 'not base64!' }]) {
      await expect(deliverForm(w.d, row, { ...app, resume })).rejects.toBeInstanceOf(FormError)
    }
  })
  test('not a form message: refused (an unknown form, no name, no way to reply)', async () => {
    const w = world()
    for (const b of [lead({ form: 'order' }), lead({ fields: { email: 'a@b.test', message: 'hi' } }), lead({ fields: { name: 'Pat', message: 'hi' } })]) {
      await expect(deliverForm(w.d, row, b)).rejects.toBeInstanceOf(FormError)
    }
    expect(w.sent).toHaveLength(0)
  })
  test('the send failing: ok false (the visitor is told it did not go through) and staff are told', async () => {
    const w = world({ send: async () => false })
    expect(await deliverForm(w.d, row, lead())).toEqual({ ok: false })
    expect(w.alerts).toEqual(['web-presence-form-send:' + TID])
  })
  test('formEmail builds its subject from the name, with a stand-in when there is none', () => {
    expect(formEmail('Acme', 'lead', { phone: '1' }, false).subject).toBe('New message from your website — a visitor')
  })
})

describe('the route', () => {
  let saved: string | undefined
  beforeEach(() => { saved = process.env.WEB_PRESENCE_ON })
  afterEach(() => { if (saved === undefined) delete process.env.WEB_PRESENCE_ON; else process.env.WEB_PRESENCE_ON = saved })
  const setup = (on = true) => {
    const w = world()
    const d: any = { db: w.db, env: { WEB_PRESENCE_ON: on ? '1' : '', WEB_PRESENCE_SECRET_KEY: MASTER, TWOMIAH_FACTORY_URL: 'https://factory.test' }, now: () => NOW }
    const app = new Hono()
    registerWebPresenceRoutes(app as any, { deps: () => d, upgradeDeps: () => d, formDeps: () => w.d })
    return { app, w }
  }
  const signed = async (siteId: string, body: string, secretOf = siteId) => {
    const ts = String(Math.floor(NOW / 1000))
    return { 'content-type': 'application/json', 'x-wp-site': siteId, 'x-wp-ts': ts, 'x-wp-sig': await signRequest(await siteSecret(MASTER, secretOf), ts, body) }
  }
  test("signed by the site: the owner is emailed; signed with another site's secret, or unsigned: 404 and nothing sent", async () => {
    const { app, w } = setup()
    const body = JSON.stringify(lead())
    const ok = await app.request('/internal/web-presence/form', { method: 'POST', headers: await signed('site-1', body), body })
    expect(ok.status).toBe(200); expect(await ok.json()).toEqual({ ok: true }); expect(w.sent).toHaveLength(1)
    expect((await app.request('/internal/web-presence/form', { method: 'POST', headers: await signed('site-1', body, 'site-2'), body })).status).toBe(404)
    expect((await app.request('/internal/web-presence/form', { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status).toBe(404)
    const other = JSON.stringify(lead({ siteId: 'site-2' }))
    expect((await app.request('/internal/web-presence/form', { method: 'POST', headers: await signed('site-1', other), body: other })).status).toBe(404)
    expect(w.sent).toHaveLength(1)
  })
  test('a failed send is a 502 (the site tells the visitor); a bad message a 400; too large a 413', async () => {
    const { app, w } = setup()
    w.d.sendFormEmail = async () => false
    const body = JSON.stringify(lead())
    expect((await app.request('/internal/web-presence/form', { method: 'POST', headers: await signed('site-1', body), body })).status).toBe(502)
    const bad = JSON.stringify(lead({ form: 'order' }))
    expect((await app.request('/internal/web-presence/form', { method: 'POST', headers: await signed('site-1', bad), body: bad })).status).toBe(400)
    const huge = JSON.stringify(lead({ pad: 'x'.repeat(FORM_BODY_MAX) }))
    expect((await app.request('/internal/web-presence/form', { method: 'POST', headers: await signed('site-1', huge), body: huge })).status).toBe(413)
  })
  test('switch off: 404 even when signed, nothing sent', async () => {
    delete process.env.WEB_PRESENCE_ON
    const { app, w } = setup(false)
    const body = JSON.stringify(lead())
    expect((await app.request('/internal/web-presence/form', { method: 'POST', headers: await signed('site-1', body), body })).status).toBe(404)
    expect(w.sent).toHaveLength(0)
  })
})
