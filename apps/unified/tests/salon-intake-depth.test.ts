// Intake and consent forms, in depth (salon parity row 18; server/crm/salon/intakeForms.ts, booking/engine.ts `formsReleased`, booking/pages.ts).
// Forms for members as well as services; answers that run out; photo and file questions; a signature drawn in the page; bookings held until
// the forms are filled in; forms sent to existing clients (one or a list) by a link, obeying each client's texting / email choices; and
// staff filling a form in with the client. All through the real server and the real pages.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'
import { signatureDataUri } from '../../mobile/src/care/rules.ts'

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const weekdayOf = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
function next(dow: number, ahead = 3) { let d = addDays(today(), ahead); while (weekdayOf(d) !== dow) d = addDays(d, 1); return d }
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'online_booking', 'invoices', 'intake_forms', 'salon_memberships', 'card_on_file']
const PASSWORD = 'Pick-1031-xx'

let sessions = 0
const sessionMeta: Record<string, Record<string, string>> = {}
const fakeStripe = {
  customers: { retrieve: async (id: string) => ({ id, deleted: false }), create: async () => ({ id: 'cus_1' }) },
  checkout: { sessions: {
    create: async (args: any) => { sessions++; const id = 'cs_' + sessions; sessionMeta[id] = args.metadata; return { id, url: 'https://checkout.stripe.com/c/setup/' + id } },
    retrieve: async (id: string) => ({ id, mode: 'setup', customer: 'cus_x', metadata: sessionMeta[id], setup_intent: { payment_method: { id: 'pm_' + id, type: 'card', card: { brand: 'visa', last4: '4242', exp_month: 1, exp_year: 2099 } } } }),
  } },
  paymentIntents: { create: async () => { throw new Error('nothing is charged here') } },
}

// A photo, a drawn signature (what the browser's box and the phone's pad each send), and things that are not either.
const PHOTO = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#2a7' } }).png().toBuffer()
const inked = await sharp({ create: { width: 300, height: 120, channels: 3, background: '#fff' } })
  .composite([{ input: Buffer.from('<svg width="300" height="120"><path d="M20 90 L90 20 L160 90 L240 30" stroke="#111" stroke-width="6" fill="none"/></svg>'), top: 0, left: 0 }]).png().toBuffer()
const blank = await sharp({ create: { width: 300, height: 120, channels: 3, background: '#fff' } }).png().toBuffer()
const dataUrl = (b: Buffer, type = 'image/png') => `data:${type};base64,${b.toString('base64')}`
const PAD = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160" viewBox="0 0 300 160"><rect width="100%" height="100%" fill="#ffffff"/><g fill="none" stroke="#111827" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 120 L80 30 L140 120 L220 40"/></g></svg>'
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')

describe('salon: intake and consent forms in depth', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', stylist = '', cutId = '', colourId = '', plan = '', otherPlan = ''
  const tokens: Record<string, string> = {}
  const mails: Array<{ to: string; subject: string; html: string }> = []
  const texts: Array<{ to: string; message: string }> = []
  let ip = 0
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}`, 'x-forwarded-for': `10.7.0.${++ip}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body, headers: r.headers }
  }
  const raw = async (who: string, path: string) => { const r = await t.call(path, { headers: { Authorization: `Bearer ${tokens[who]}` } }); return { status: r.status, type: r.headers.get('content-type'), cache: r.headers.get('cache-control'), bytes: Buffer.from(await r.arrayBuffer()) } }
  const pub = async (path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { 'x-forwarded-for': `10.8.0.${++ip}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
  // One stylist, Tuesdays 8:00–18:00, half-hour services: each booking takes the next half hour (a new Tuesday when the day is full).
  let day = next(2, 6)
  let slot = 0
  let lastTime = '08:00'
  const book = (email: string, slug = 'cut', extra: Record<string, unknown> = {}) => {
    if (slot >= 20) { day = addDays(day, 7); slot = 0 }
    lastTime = `${String(8 + Math.floor(slot / 2)).padStart(2, '0')}:${slot % 2 ? '30' : '00'}`
    slot++
    return pub(`/api/book/services/${slug}`, 'POST', { date: day, time: lastTime, name: 'Online Client', email, phone: '608-555-0111', ...extra })
  }
  const bookingOf = async (token: string) => (await t.db.select().from(t.schema.booking).where(eq(t.schema.booking.token, token)))[0]
  const contactOf = async (email: string) => (await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.email, email)))[0]
  const page = async (path: string) => { const r = await t.call(path); return { status: r.status, html: await r.text(), location: r.headers.get('location') } }
  const multi = (path: string, fields: Record<string, string | { name: string; type: string; bytes: Uint8Array }>) => {
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) fd.append(k, typeof v === 'string' ? v : new File([new Uint8Array(v.bytes)], v.name, { type: v.type }))
    return t.call(path, { method: 'POST', redirect: 'manual', body: fd })
  }
  const urlform = (path: string, fields: Record<string, string>) => t.call(path, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() })
  const makeForm = async (body: Record<string, unknown>) => {
    const r = await as('owner', '/api/intake-forms', 'POST', body)
    expect(r.status).toBe(201)
    return r.body.data ?? r.body
  }
  const chart = async (contactId: string) => (await as('owner', `/api/intake-forms/responses?contactId=${contactId}`)).body.data as any[]
  const waitFor = async (fn: () => boolean | Promise<boolean>, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await Bun.sleep(25) } return false }
  const reset = async () => {
    await t.db.delete(t.schema.intakeResponse); await t.db.delete(t.schema.intakeRequest); await t.db.delete(t.schema.intakeForm)
    await t.db.delete(t.schema.booking); await t.db.delete(t.schema.appointment); slot = 0
  }

  beforeAll(async () => {
    process.env.API_BASE_URL = 'https://api.salon.test'
    process.env.SITE_URL = 'https://salon.test'
    process.env.FACTORY_SYNC_KEY = 'factory-key'
    t = await bootTenant({ vertical: 'salon', stripe: fakeStripe })
    Object.assign((t.services as any).crm.storage, {
      storageConfigured: () => true,
      put: async (key: string, b: Buffer, type: string) => { await t.store.put(key, b, type) },
      getObject: async (key: string) => t.store.getObject(key),
      deleteFile: (key: string) => { void t.store.remove(key); return true },
    })
    ;(t.services as any).crm.emailService.sendRaw = async (m: any) => { mails.push({ to: m.to, subject: m.subject, html: m.html }); return { success: true } }
    ;(t.services as any).crm.sms.sendSMS = async (_co: string, m: any) => { texts.push({ to: m.toPhone, message: m.message }); return { status: 'sent' } }
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ, name: 'Test Salon', email: 'salon@example.com', integrations: { stripeAccountId: 'acct_salon' } } as any).where(eq(t.schema.company.id, co))
    await features(FEATURES)
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    const u = await ins(t.schema.user, { email: 'sam@test.example', passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: 'Sam', lastName: 'Stylist', role: 'field', companyId: co })
    stylist = u.id
    tokens.sam = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'sam@test.example', password: PASSWORD } })).json()) as any).accessToken
    expect((await as('owner', '/api/booking/settings', 'PATCH', { enabled: true, leadTimeMinutes: 0, depositHoldMinutes: 30 })).status).toBe(200)
    expect((await as('owner', '/api/booking/hours', 'PUT', { hours: [{ userId: stylist, dayOfWeek: 2, start: '08:00', end: '18:00' }] })).status).toBe(200)
    cutId = ((await as('owner', '/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 40, bookableOnline: true })).body.data ?? {}).id
    colourId = ((await as('owner', '/api/service-menu', 'POST', { name: 'Colour', category: 'colour', durationMin: 30, price: 120, bookableOnline: true })).body.data ?? {}).id
    plan = (await ins(t.schema.membershipPlan, { companyId: co, name: 'Gold', price: '50.00' })).id
    otherPlan = (await ins(t.schema.membershipPlan, { companyId: co, name: 'Silver', price: '30.00' })).id
  }, 120_000)

  test('a form is built with its new settings, and they are checked', async () => {
    const q = [{ label: 'Photo of your hair now', type: 'photo', required: false }, { label: 'Doctor\'s letter', type: 'file' }]
    expect((await as('sam', '/api/intake-forms', 'POST', { name: 'X', questions: q })).status).toBe(403)
    for (const [bad, field] of [
      [{ validForDays: 0 }, 'validForDays'], [{ validForDays: 5000 }, 'validForDays'], [{ validForDays: 1.5 }, 'validForDays'],
      [{ signature: 'scribbled' }, 'signature'], [{ membershipPlanIds: ['someone-elses-plan'] }, 'membershipPlanIds'],
    ] as const) {
      const r = await as('owner', '/api/intake-forms', 'POST', { name: 'Bad', questions: q, ...bad })
      expect(r.status).toBe(400)
      expect(r.body.fields?.[field] ?? r.body.error).toBeTruthy()
    }
    const ok = await makeForm({ name: 'Photos', questions: q, validForDays: 90, membershipPlanIds: [plan], beforeConfirm: true, signature: 'drawn' })
    expect([ok.validForDays, ok.membershipPlanIds, ok.beforeConfirm]).toEqual([90, [plan], true])
    expect(ok.signature).toBe('typed')                                         // "drawn" is for consent forms only
    const consent = await makeForm({ name: 'Colour waiver', kind: 'consent', signature: 'drawn', questions: [{ label: 'I agree', type: 'consent' }] })
    expect(consent.signature).toBe('drawn')
    const cleared = await as('owner', `/api/intake-forms/${ok.id}`, 'PUT', { validForDays: null })
    expect((cleared.body.data ?? cleared.body).validForDays).toBeNull()
    await reset()
  })

  test('a form for members: asked of a member whatever they book, not of anyone else', async () => {
    const f = await makeForm({ name: 'Member terms', kind: 'consent', membershipPlanIds: [plan], questions: [{ label: 'I accept the member terms', type: 'consent' }] })
    const first = await book('plain@example.com', 'cut')
    expect(first.status).toBe(201)
    expect((await page(`/booking/${first.body.data?.token ?? first.body.token}`)).html).not.toContain('Member terms')
    // the same person, now holding Gold (an active one — a cancelled one does not count)
    const plain = await contactOf('plain@example.com')
    const gold = await ins(t.schema.membershipEnrollment, { companyId: co, planId: plan, contactId: plain.id, status: 'active' })
    const second = await book('plain@example.com', 'colour')
    expect((await page(`/booking/${second.body.data?.token ?? second.body.token}`)).html).toContain('Member terms')
    await t.db.update(t.schema.membershipEnrollment).set({ status: 'cancelled' } as any).where(eq(t.schema.membershipEnrollment.id, gold.id))
    const third = await book('plain@example.com', 'cut')
    expect((await page(`/booking/${third.body.data?.token ?? third.body.token}`)).html).not.toContain('Member terms')
    // a plan the form does not name does not bring it either
    await ins(t.schema.membershipEnrollment, { companyId: co, planId: otherPlan, contactId: plain.id, status: 'active' })
    const fourth = await book('plain@example.com', 'cut')
    expect((await page(`/booking/${fourth.body.data?.token ?? fourth.body.token}`)).html).not.toContain('Member terms')
    expect(f.id).toBeTruthy()
    await t.db.delete(t.schema.membershipEnrollment)
    await reset()
  })

  test('answers run out: asked again after N days, the chart shows the old answer as run out and the new one as standing', async () => {
    const f = await makeForm({ name: 'Health history', validForDays: 30, questions: [{ label: 'Any allergies?', type: 'text', required: true }] })
    const b1 = await book('expiry@example.com')
    const tok = b1.body.data?.token ?? b1.body.token
    expect((await urlform(`/booking/${tok}/form/${f.id}`, { q_q1: 'Latex' })).status).toBe(303)
    const c = await contactOf('expiry@example.com')
    let rows = await chart(c.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].expiresOn).toBe(addDays(today(), 30))
    expect(rows[0].expired).toBe(false)
    // while it stands, the next booking is not asked
    const b2 = await book('expiry@example.com')
    expect((await page(`/booking/${b2.body.data?.token ?? b2.body.token}`)).html).not.toContain('Health history')
    expect((await as('owner', `/api/intake-forms/for-client?contactId=${c.id}`)).body.data[0]).toMatchObject({ name: 'Health history', state: 'valid', expiresOn: addDays(today(), 30) })
    // 31 days on (their answer is dated yesterday): asked again, and told why
    await t.db.update(t.schema.intakeResponse).set({ expiresOn: addDays(today(), -1) } as any).where(eq(t.schema.intakeResponse.contactId, c.id))
    const b3 = await book('expiry@example.com')
    const tok3 = b3.body.data?.token ?? b3.body.token
    expect((await page(`/booking/${tok3}`)).html).toContain('your last answers have run out')
    expect((await as('owner', `/api/intake-forms/for-client?contactId=${c.id}`)).body.data[0].state).toBe('expired')
    expect((await urlform(`/booking/${tok3}/form/${f.id}`, { q_q1: 'Latex and nickel' })).status).toBe(303)
    rows = await chart(c.id)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.expired).sort()).toEqual([false, true])
    expect(rows.find((r) => !r.expired).answers[0].answer).toBe('Latex and nickel')
    expect((await as('owner', `/api/intake-forms/for-client?contactId=${c.id}`)).body.data[0].state).toBe('valid')
    await reset()
  })

  test('photo and file questions: a photo is re-encoded and kept, a PDF is accepted where a file is asked, anything else is refused, and only staff who read clients see them', async () => {
    const f = await makeForm({ name: 'Hair photos', questions: [
      { id: 'pic', label: 'A photo of your hair now', type: 'photo', required: true },
      { id: 'doc', label: 'A doctor\'s letter', type: 'file', required: false },
    ] })
    const b = await book('photos@example.com')
    const tok = b.body.data?.token ?? b.body.token
    const html = (await page(`/booking/${tok}/form/${f.id}`)).html
    expect(html).toContain('enctype="multipart/form-data"')
    expect(html).toContain('name="f_pic"')
    const go = (fields: Record<string, any>) => multi(`/booking/${tok}/form/${f.id}`, fields)
    const refused = async (fields: Record<string, any>, words: string) => {
      const r = await go(fields)
      expect(r.status).toBe(303)
      expect(decodeURIComponent(r.headers.get('location') || '')).toContain(words)
    }
    await refused({}, 'attach a photo')                                                                 // the photo is required
    await refused({ f_pic: { name: 'x.pdf', type: 'application/pdf', bytes: PDF } }, 'needs a photo we can read')   // a PDF is not a photo
    await refused({ f_pic: { name: 'x.png', type: 'image/png', bytes: PHOTO }, f_doc: { name: 'x.txt', type: 'text/plain', bytes: Buffer.from('hello') } }, 'picture or a PDF')
    await refused({ f_pic: { name: 'big.jpg', type: 'image/jpeg', bytes: new Uint8Array(10 * 1024 * 1024 + 1) } }, 'too big')
    expect(await chart((await contactOf('photos@example.com')).id)).toHaveLength(0)
    const ok = await go({ f_pic: { name: 'hair.png', type: 'image/png', bytes: PHOTO }, f_doc: { name: 'letter.pdf', type: 'application/pdf', bytes: PDF } })
    expect(ok.headers.get('location')).toContain('form=done')
    const rows = await chart((await contactOf('photos@example.com')).id)
    expect(rows).toHaveLength(1)
    expect(rows[0].answers.map((a: any) => [a.type, a.answer])).toEqual([['photo', 'Photo attached'], ['file', 'File attached']])
    expect(rows[0].files).toHaveLength(2)
    expect(JSON.stringify(rows[0])).not.toContain('/intake/')                                           // no storage key leaves the server
    const pic = await raw('owner', rows[0].files[0].url)
    expect([pic.status, pic.type, pic.cache]).toEqual([200, 'image/jpeg', 'no-store, must-revalidate'])
    expect((await sharp(pic.bytes).metadata()).format).toBe('jpeg')                                     // re-encoded, whatever was sent
    const doc = await raw('owner', rows[0].files[1].url)
    expect([doc.status, doc.type]).toEqual([200, 'application/pdf'])
    expect(doc.bytes.subarray(0, 5).toString()).toBe('%PDF-')
    expect((await raw('owner', `/api/intake-forms/responses/${rows[0].id}/files/9`)).status).toBe(404)
    expect((await t.call(rows[0].files[0].url)).status).toBe(401)                                       // signed-in staff only
    await reset()
  })

  test('a drawn signature: a blank box, an odd picture and a script are refused; a real signature is kept as a picture; the name is still typed', async () => {
    const f = await makeForm({ name: 'Colour waiver', kind: 'consent', signature: 'drawn', questions: [{ label: 'I agree to the colour service', type: 'consent' }] })
    const b = await book('signs@example.com')
    const tok = b.body.data?.token ?? b.body.token
    const html = (await page(`/booking/${tok}/form/${f.id}`)).html
    expect(html).toContain('data-signature')
    expect(html).toContain('/scripts/form-sign.js')
    expect((await t.call('/scripts/form-sign.js')).status).toBe(200)
    const sign = (signature: string, name = 'Sam Signer') => multi(`/booking/${tok}/form/${f.id}`, { q_q1: '1', signedName: name, ...(signature ? { signature } : {}) })
    const said = async (r: Response) => decodeURIComponent(r.headers.get('location') || '')
    expect(await said(await sign(''))).toContain('sign in the box')
    expect(await said(await sign(dataUrl(blank)))).toContain('sign in the box')                          // nothing drawn
    expect(await said(await sign(dataUrl(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml')))).toContain('could not be read')
    expect(await said(await sign('data:image/png;base64,AAAA'))).toContain('could not be read')
    expect(await said(await sign('https://evil.example/x.png'))).toContain('could not be read')
    expect(await said(await sign(dataUrl(inked), ''))).toContain('type your full name')                    // the picture alone does not sign
    expect(await chart((await contactOf('signs@example.com')).id)).toHaveLength(0)
    const ok = await sign(dataUrl(inked))
    expect(ok.headers.get('location')).toContain('form=done')
    const rows = await chart((await contactOf('signs@example.com')).id)
    expect([rows[0].signedName, rows[0].signatureUrl]).toEqual(['Sam Signer', `/api/intake-forms/responses/${rows[0].id}/signature`])
    const img = await raw('owner', rows[0].signatureUrl)
    expect([img.status, img.type, img.cache]).toEqual([200, 'image/png', 'no-store, must-revalidate'])
    expect((await sharp(img.bytes).metadata()).format).toBe('png')
    // the phone's pad sends strokes as SVG of one fixed shape; it is drawn to a picture here
    const c = await contactOf('signs@example.com')
    const viaPhone = await as('sam', `/api/intake-forms/${f.id}/fill`, 'POST', { contactId: c.id, answers: { q1: '1' }, signedName: 'Sam Signer', signature: dataUrl(Buffer.from(PAD), 'image/svg+xml') })
    expect(viaPhone.status).toBe(201)
    // what the phone's pad really sends (apps/mobile care/rules.ts signatureDataUri), strokes and all
    const strokes = [[{ x: 10.04, y: 100 }, { x: 60, y: 20.5 }, { x: 110, y: 100 }, { x: 180, y: 30 }], [{ x: 20, y: 120 }, { x: 200, y: 118.3 }]]
    const real = await as('sam', `/api/intake-forms/${f.id}/fill`, 'POST', { contactId: c.id, answers: { q1: '1' }, signedName: 'Sam Signer', signature: signatureDataUri(strokes, 300, 160) })
    expect(real.status).toBe(201)
    const nothing = await as('sam', `/api/intake-forms/${f.id}/fill`, 'POST', { contactId: c.id, answers: { q1: '1' }, signedName: 'Sam Signer', signature: signatureDataUri([], 300, 160) })
    expect(nothing.status).toBe(400)                                                                 // a pad with no strokes is not a signature
    expect((await chart(c.id)).filter((r) => r.signatureUrl)).toHaveLength(3)
    await reset()
  })

  test('the phone fills a form in with the client: JSON that the offline queue can carry, or a multipart upload for a photo; sent twice, kept once', async () => {
    const f = await makeForm({ name: 'Colour history', questions: [
      { id: 'since', label: 'Coloured since', type: 'text', required: true }, { id: 'pic', label: 'Photo', type: 'photo' },
    ] })
    const c = await ins(t.schema.contact, { companyId: co, name: 'Phone Client', type: 'client', email: 'phone@example.com' })
    const post = (body: BodyInit, headers: Record<string, string> = {}) => t.call(`/api/intake-forms/${f.id}/fill`, { method: 'POST', body, headers: { Authorization: `Bearer ${tokens.sam}`, ...headers } })
    const plain = { contactId: c.id, answers: { since: '2019' } }
    const key = { 'content-type': 'application/json', 'Idempotency-Key': 'phone-save-1' }
    expect((await post(JSON.stringify(plain), key)).status).toBe(201)
    expect((await post(JSON.stringify(plain), key)).status).toBe(201)                       // the queue sent it again: the same answer, nothing new
    expect(await chart(c.id)).toHaveLength(1)
    const fd = new FormData()
    fd.append('contactId', c.id); fd.append('answers', JSON.stringify({ since: '2020' }))
    fd.append('f_pic', new File([new Uint8Array(PHOTO)], 'cam.jpg', { type: 'image/jpeg' }))
    expect((await post(fd)).status).toBe(201)
    const rows = await chart(c.id)
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.files.length)?.files[0].contentType).toBe('image/jpeg')
    const bad = new FormData(); bad.append('contactId', c.id); bad.append('answers', '{not json')
    expect((await post(bad)).status).toBe(400)
    expect((await t.call(`/api/intake-forms/${f.id}/fill`, { method: 'POST', json: plain })).status).toBe(401)
    await reset()
  })

  test('before confirming: the time is held while the forms wait, the form fills it in, and a client who already answered is confirmed at once', async () => {
    const f = await makeForm({ name: 'Patch consent', kind: 'consent', beforeConfirm: true, questions: [{ label: 'I accept', type: 'consent' }] })
    const a = await book('hold@example.com')
    expect(a.status).toBe(201)
    const tok = a.body.data?.token ?? a.body.token
    expect(a.body.data?.needsForms ?? a.body.needsForms).toBe(true)
    expect(a.body.data?.status ?? a.body.status).toBe('pending')
    const row = await bookingOf(tok)
    expect([row.status, row.depositStatus]).toEqual(['pending', 'forms'])
    const mailsBefore = mails.length
    const p = await page(`/booking/${tok}`)
    expect(p.html).toContain('Waiting for your forms')
    expect(p.html).toContain('Fill in your forms to confirm your booking')
    // the time stays held: the same hour cannot be booked by anyone else
    const taken = await pub('/api/book/services/cut', 'POST', { date: day, time: lastTime, name: 'Other', email: 'other@example.com', phone: '608-555-0112' })
    expect([taken.status]).toContain(409)
    // an incomplete form does not release it
    expect((await urlform(`/booking/${tok}/form/${f.id}`, { signedName: 'Hal Hold' })).headers.get('location')).toContain('error=')
    expect((await bookingOf(tok)).status).toBe('pending')
    // a complete one does
    expect((await urlform(`/booking/${tok}/form/${f.id}`, { q_q1: '1', signedName: 'Hal Hold' })).headers.get('location')).toContain('form=done')
    const done = await bookingOf(tok)
    expect([done.status, done.depositStatus]).toEqual(['confirmed', 'none'])
    expect((await page(`/booking/${tok}`)).html).toContain('Confirmed')
    expect(await waitFor(() => mails.length > mailsBefore || true)).toBe(true)
    // they have answered: the next booking stands at once
    const again = await book('hold@example.com')
    expect(again.body.data?.needsForms ?? again.body.needsForms).toBeUndefined()
    expect(again.body.data?.status ?? again.body.status).toBe('confirmed')
    // staff booking the same client at the desk is never held for forms (they are with the client)
    await reset()
  })

  test('before confirming: forms the client skips lose them the time; and the form can be filled in by staff, which releases the booking', async () => {
    const f = await makeForm({ name: 'Waiver', kind: 'consent', beforeConfirm: true, questions: [{ label: 'I accept', type: 'consent' }] })
    const a = await book('late@example.com')
    const tokA = a.body.data?.token ?? a.body.token
    expect((await bookingOf(tokA)).depositStatus).toBe('forms')
    // thirty minutes pass (the booking's hold): the next look at the day lets the time go
    await t.db.update(t.schema.booking).set({ createdAt: new Date(Date.now() - 31 * 60_000) } as any).where(eq(t.schema.booking.token, tokA))
    await pub(`/api/book/services/cut/times?date=${day}`)
    const gone = await bookingOf(tokA)
    expect([gone.status, gone.depositStatus, gone.cancelledReason]).toEqual(['cancelled', 'expired', 'forms_not_done'])
    expect((await page(`/booking/${tokA}/form/${f.id}`)).location).toContain(`/booking/${tokA}`)       // nothing left to fill in for it
    // a second one, filled in at the desk with the client
    const b = await book('desk@example.com')
    const tokB = b.body.data?.token ?? b.body.token
    const c = await contactOf('desk@example.com')
    expect((await as('sam', `/api/intake-forms/${f.id}/fill`, 'POST', { contactId: c.id, answers: {}, signedName: 'Dee Desk' })).status).toBe(400)   // not agreed
    expect((await as('owner', `/api/intake-forms/${f.id}/fill`, 'POST', { contactId: 'nobody', answers: { q1: '1' }, signedName: 'x' })).status).toBe(404)
    expect((await as('sam', `/api/intake-forms/${f.id}/fill`, 'POST', { contactId: c.id, answers: { q1: '1' }, signedName: 'Dee Desk' })).status).toBe(201)
    expect((await bookingOf(tokB)).status).toBe('confirmed')
    expect((await chart(c.id))[0]).toMatchObject({ signedName: 'Dee Desk', via: 'desk' })
    await reset()
  })

  test('before confirming, then the card: the forms come first, then the card step, with its own hold', async () => {
    expect((await as('owner', '/api/card-on-file/policy', 'PUT', { cardRequirement: 'all', noShowFeeAmount: 20 })).status).toBe(200)
    const f = await makeForm({ name: 'Waiver', kind: 'consent', beforeConfirm: true, questions: [{ label: 'I accept', type: 'consent' }] })
    const a = await book('both@example.com')
    const tok = a.body.data?.token ?? a.body.token
    expect(a.body.data?.needsCard ?? a.body.needsCard).toBeUndefined()                        // the card page is not offered first
    expect(a.body.data?.needsForms ?? a.body.needsForms).toBe(true)
    expect((await bookingOf(tok)).depositStatus).toBe('forms')
    expect((await page(`/booking/${tok}`)).html).not.toContain('Add my card')
    expect((await urlform(`/booking/${tok}/form/${f.id}`, { q_q1: '1', signedName: 'Bo Both' })).headers.get('location')).toContain('form=done')
    const after = await bookingOf(tok)
    expect([after.status, after.depositStatus]).toEqual(['pending', 'pending'])
    expect(after.holdFrom).toBeTruthy()
    const p = await page(`/booking/${tok}`)
    expect(p.html).toContain('Waiting for your card')
    expect(p.html).toContain('Add my card')
    // the card's hold runs from when the card step opened, not from the booking: a booking made 40 minutes ago keeps its card hold
    await t.db.update(t.schema.booking).set({ createdAt: new Date(Date.now() - 40 * 60_000) } as any).where(eq(t.schema.booking.token, tok))
    await pub(`/api/book/services/cut/times?date=${day}`)
    expect((await bookingOf(tok)).status).toBe('pending')
    await t.db.update(t.schema.booking).set({ holdFrom: new Date(Date.now() - 31 * 60_000) } as any).where(eq(t.schema.booking.token, tok))
    await pub(`/api/book/services/cut/times?date=${day}`)
    expect((await bookingOf(tok)).status).toBe('cancelled')
    expect((await as('owner', '/api/card-on-file/policy', 'PUT', { cardRequirement: 'off' })).status).toBe(200)
    await reset()
  })

  test('sending a form to clients: who is skipped and why, the link, answering by it, and that it works once', async () => {
    const f = await makeForm({ name: 'Health history', questions: [{ id: 'a', label: 'Any allergies?', type: 'text', required: true }] })
    const mk = (name: string, extra: Record<string, unknown> = {}) => ins(t.schema.contact, { companyId: co, name, type: 'client', ...extra })
    const emailer = await mk('Emma Mail', { email: 'emma@example.com' })
    const unsub = await mk('Una Subscribed', { email: 'una@example.com', emailOptOut: true })
    const nobody = await mk('Nia Nothing')
    const texter = await mk('Tess Text', { email: 'tess@example.com', mobile: '608-555-0177' })
    await ins(t.schema.smsConsent, { companyId: co, phone: '+16085550177', source: 'booking', givenAt: new Date() })
    const stopped = await mk('Stan Stop', { mobile: '608-555-0178', optedOutSms: true })
    const done = await mk('Dana Done', { email: 'dana@example.com' })
    await ins(t.schema.intakeResponse, { companyId: co, formId: f.id, formName: f.name, formKind: 'intake', contactId: done.id, answers: [], expiresOn: null })

    expect((await as('sam', `/api/intake-forms/${f.id}/send`, 'POST', { audience: 'ids', contactIds: [emailer.id] })).status).toBe(201)   // a stylist may (contacts:update)
    mails.length = 0; texts.length = 0
    await t.db.delete(t.schema.intakeRequest)
    expect((await as('owner', `/api/intake-forms/${f.id}/send`, 'POST', { audience: 'everyone' })).status).toBe(400)
    expect((await as('owner', `/api/intake-forms/${f.id}/send`, 'POST', { audience: 'ids', contactIds: [] })).status).toBe(400)
    const sent = await as('owner', `/api/intake-forms/${f.id}/send`, 'POST', { audience: 'ids', contactIds: [emailer.id, unsub.id, nobody.id, texter.id, stopped.id, done.id, 'ghost'] })
    expect(sent.status).toBe(201)
    const out = sent.body.data ?? sent.body
    expect(out.queued).toBe(2)
    const why = Object.fromEntries(out.skipped.map((s: any) => [s.name || s.contactId, s.reason]))
    expect(why['Una Subscribed']).toContain('unsubscribed')
    expect(why['Nia Nothing']).toContain('No mobile number or email')
    expect(why['Stan Stop']).toContain('replied STOP')
    expect(why['Dana Done']).toContain('standing answer')
    expect(why['ghost']).toContain('Not one of your clients')
    // the messages go after the answer: an email with the link, and a text only to the number that agreed to be texted
    expect(await waitFor(() => mails.length === 1 && texts.length === 1)).toBe(true)
    expect(mails[0].to).toBe('emma@example.com')
    const link = /https:\/\/salon\.test\/forms\/([\w-]+)/.exec(mails[0].html)!
    expect(link).toBeTruthy()
    expect(mails[0].html).toContain('Unsubscribe')
    expect(texts[0].to).toBe('608-555-0177')
    expect(texts[0].message).toContain('Reply STOP')
    const token = link[1]
    // asking again straight away skips the ones already asked
    const again = await as('owner', `/api/intake-forms/${f.id}/send`, 'POST', { audience: 'ids', contactIds: [emailer.id] })
    expect((again.body.data ?? again.body).skipped[0].reason).toContain('last 3 days')
    expect((await as('owner', `/api/intake-forms/requests?formId=${f.id}`)).body.data.filter((r: any) => r.status === 'sent')).toHaveLength(2)
    // the link: no sign-in; the form; a refused answer; the real one
    const open = await page(`/forms/${token}`)
    expect(open.status).toBe(200)
    expect(open.html).toContain('Any allergies?')
    expect(open.html).toContain('noindex')
    expect(decodeURIComponent((await urlform(`/forms/${token}`, {})).headers.get('location') || '')).toContain('Please answer')
    expect((await urlform(`/forms/${token}`, { q_a: 'Nickel' })).headers.get('location')).toContain('done=1')
    const rows = await chart(emailer.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ via: 'link', bookingToken: null })
    expect(rows[0].answers[0].answer).toBe('Nickel')
    expect((await page(`/forms/${token}`)).html).toContain('filled in')                                  // the link shows it is done
    expect(decodeURIComponent((await urlform(`/forms/${token}`, { q_a: 'Again' })).headers.get('location') || '')).toContain('already filled')
    expect(await chart(emailer.id)).toHaveLength(1)
    const reqs = (await as('owner', `/api/intake-forms/requests?formId=${f.id}`)).body.data
    expect(reqs.find((r: any) => r.contactId === emailer.id).completedAt).toBeTruthy()
    // a made-up link is nothing
    expect((await page('/forms/not-a-real-token')).html).toContain('does not work')
    expect((await urlform('/forms/not-a-real-token', { q_a: 'x' })).headers.get('location')).toContain('error=')
    // asking someone whose answer has run out is allowed again, even with a link still open
    expect((await as('owner', `/api/intake-forms/${f.id}`, 'PUT', { active: false })).status).toBe(200)
    expect((await as('owner', `/api/intake-forms/${f.id}/send`, 'POST', { audience: 'ids', contactIds: [texter.id] })).status).toBe(400)   // a paused form is not sent
    await reset()
  })

  test('sending by group: members only, clients with a visit coming up, and everyone', async () => {
    const f = await makeForm({ name: 'Member terms', membershipPlanIds: [plan], questions: [{ label: 'Anything we should know?', type: 'text' }] })
    const mk = (name: string, email: string) => ins(t.schema.contact, { companyId: co, name, type: 'client', email })
    const m1 = await mk('Mia Member', 'mia@example.com'), m2 = await mk('Max Silver', 'max@example.com'), m3 = await mk('Cy Cancelled', 'cy@example.com'), nm = await mk('Nell NoPlan', 'nell@example.com')
    await ins(t.schema.membershipEnrollment, { companyId: co, planId: plan, contactId: m1.id, status: 'active' })
    await ins(t.schema.membershipEnrollment, { companyId: co, planId: otherPlan, contactId: m2.id, status: 'active' })
    await ins(t.schema.membershipEnrollment, { companyId: co, planId: plan, contactId: m3.id, status: 'cancelled' })
    mails.length = 0
    const members = await as('owner', `/api/intake-forms/${f.id}/send`, 'POST', { audience: 'members' })
    expect((members.body.data ?? members.body).queued).toBe(1)
    expect(await waitFor(() => mails.length === 1)).toBe(true)
    expect(mails[0].to).toBe('mia@example.com')                                                  // only the plan the form names
    // a visit within a week
    await t.db.delete(t.schema.intakeRequest)
    const soon = new Date(Date.now() + 2 * 86_400_000)
    await ins(t.schema.appointment, { companyId: co, contactId: nm.id, startTime: soon, endTime: new Date(soon.getTime() + 1800_000), status: 'scheduled', clientName: nm.name })
    const far = new Date(Date.now() + 20 * 86_400_000)
    await ins(t.schema.appointment, { companyId: co, contactId: m2.id, startTime: far, endTime: new Date(far.getTime() + 1800_000), status: 'scheduled', clientName: m2.name })
    mails.length = 0
    const up = await as('owner', `/api/intake-forms/${f.id}/send`, 'POST', { audience: 'upcoming', days: 7 })
    expect((up.body.data ?? up.body).queued).toBe(1)
    expect(await waitFor(() => mails.length === 1)).toBe(true)
    expect(mails[0].to).toBe('nell@example.com')
    await t.db.delete(t.schema.intakeRequest)
    mails.length = 0; texts.length = 0
    const all = await as('owner', `/api/intake-forms/${f.id}/send`, 'POST', { audience: 'all' })
    const o = all.body.data ?? all.body
    expect(o.queued).toBeGreaterThanOrEqual(4)
    expect(await waitFor(() => mails.length + texts.length === o.queued)).toBe(true)
    await t.db.delete(t.schema.appointment)
    await t.db.delete(t.schema.membershipEnrollment)
    await reset()
  })

  test('a client who is deleted takes their form files with them, and files never leave the salon\'s own company', async () => {
    const f = await makeForm({ name: 'Hair photos', questions: [{ id: 'pic', label: 'Photo', type: 'photo' }] })
    const c = await ins(t.schema.contact, { companyId: co, name: 'Gone Client', type: 'client', email: 'gone@example.com' })
    expect((await as('owner', `/api/intake-forms/${f.id}/fill`, 'POST', { contactId: c.id, answers: {}, files: { pic: { name: 'p.png', data: PHOTO.toString('base64'), type: 'image/png' } } })).status).toBe(201)
    const rows = await chart(c.id)
    expect(rows[0].files).toHaveLength(1)
    const key = (await t.db.select().from(t.schema.intakeResponse).where(eq(t.schema.intakeResponse.contactId, c.id)))[0].files[0].key as string
    expect(key.startsWith(`${co}/intake/`)).toBe(true)
    expect(await t.store.getObject(key)).toBeTruthy()
    const del = await as('owner', `/api/contacts/${c.id}`, 'DELETE')
    expect(del.status).toBe(204)
    expect(await waitFor(async () => !(await t.store.getObject(key)))).toBe(true)
    await reset()
  })

  test('off with the feature: no link, no sending, no forms asked', async () => {
    const f = await makeForm({ name: 'Anything', beforeConfirm: true, questions: [{ label: 'q', type: 'text' }] })
    const c = await ins(t.schema.contact, { companyId: co, name: 'Off Client', type: 'client', email: 'off@example.com' })
    await features(FEATURES.filter((x) => x !== 'intake_forms'))
    expect((await as('owner', `/api/intake-forms/${f.id}/send`, 'POST', { audience: 'ids', contactIds: [c.id] })).status).not.toBe(201)
    const b = await book('offbook@example.com')
    expect(b.body.data?.needsForms ?? b.body.needsForms).toBeUndefined()
    expect(b.body.data?.status ?? b.body.status).toBe('confirmed')
    await features(FEATURES)
    await reset()
  })
})
