// Clients choose their stylist online, and fill in the salon's forms (salon gap #6; server/booking/engine.ts `people`, crm/salon/intakeForms.ts,
// booking/pages.ts). Off — the default — online booking goes to whoever is free and no forms are asked.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addDays, tzParts } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const TZ = 'America/Chicago'
const today = () => tzParts(new Date(), TZ).date
const weekdayOf = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
function next(dow: number, ahead = 3) { let d = addDays(today(), ahead); while (weekdayOf(d) !== dow) d = addDays(d, 1); return d }
const FEATURES = ['contacts', 'client_profiles', 'service_menu', 'salon_booking', 'online_booking', 'invoices']
const PASSWORD = 'Pick-1030-xx'

describe('salon: clients choose their stylist online; intake forms', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let co = '', ana = '', bea = ''
  const tokens: Record<string, string> = {}
  let ip = 0
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const as = async (who: string, path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tokens[who]}`, 'x-forwarded-for': `10.3.0.${++ip}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const pub = async (path: string, method = 'GET', json?: unknown) => {
    const r = await t.call(path, { method, json, headers: { 'x-forwarded-for': `10.4.0.${++ip}` } })
    const text = await r.text(); let body: any = text; try { body = JSON.parse(text) } catch { /* html */ }
    return { status: r.status, body }
  }
  const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, co)); t.services.features.forgetFeatures() }
  const day = next(2, 6)
  const wall = (d: string, hm: string) => {
    const guess = new Date(`${d}T${hm}:00Z`)
    const parts = tzParts(guess, TZ)
    const offsetMin = (guess.getTime() - new Date(`${parts.date}T${String(Math.floor(parts.minutes / 60)).padStart(2, '0')}:${String(parts.minutes % 60).padStart(2, '0')}:00Z`).getTime()) / 60000
    return new Date(guess.getTime() + offsetMin * 60000).toISOString()
  }
  const timesFor = async (slug: string, who = '') => ((await pub(`/api/book/services/${slug}/times?date=${day}${who ? `&who=${who}` : ''}`)).body.data ?? []).map((x: any) => x.time) as string[]
  const book = (slug: string, time: string, email: string, extra: Record<string, unknown> = {}) =>
    pub(`/api/book/services/${slug}`, 'POST', { date: day, time, name: 'Online Client', email, phone: '608-555-0111', ...extra })
  const booking = async (token: string) => (await t.db.select().from(t.schema.booking).where(eq(t.schema.booking.token, token)))[0]
  const page = async (path: string) => { const r = await t.call(path); return { status: r.status, html: await r.text(), location: r.headers.get('location') } }
  const post = (path: string, fields: Record<string, string>) => t.call(path, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() } as any)

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    co = s.company.id
    await t.db.update(t.schema.company).set({ timezone: TZ } as any).where(eq(t.schema.company.id, co))
    await features(FEATURES)
    tokens.owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
    const ids: Record<string, string> = {}
    for (const key of ['ana', 'bea']) {
      const u = await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Tester', role: 'field', companyId: co })
      ids[key] = u.id
      tokens[key] = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${key}@test.example`, password: PASSWORD } })).json()) as any).accessToken
    }
    ;({ ana, bea } = ids as any)
    expect((await as('owner', '/api/booking/settings', 'PATCH', { enabled: true, leadTimeMinutes: 0 })).status).toBe(200)
    // Each of them works Tuesdays 9–12.
    expect((await as('owner', '/api/booking/hours', 'PUT', { hours: [ana, bea].map((userId) => ({ userId, dayOfWeek: 2, start: '09:00', end: '12:00' })) })).status).toBe(200)
    expect((await as('owner', '/api/service-menu', 'POST', { name: 'Cut', category: 'hair', durationMin: 30, price: 40, bookableOnline: true })).status).toBe(201)
    expect((await as('owner', '/api/service-menu', 'POST', { name: 'Colour', category: 'colour', durationMin: 60, price: 120, bookableOnline: true })).status).toBe(201)
  }, 120_000)

  test('off by default: nobody is listed, a stylist choice sent anyway is refused, and a booking goes to whoever is free', async () => {
    expect((await pub('/api/book/stylists')).body.data).toEqual([])
    const refused = await pub(`/api/book/services/cut/times?date=${day}&who=${ana}`)
    expect(refused.status).toBe(400)
    const r = await book('cut', '09:00', 'plain@example.com', { who: ana })
    expect(r.status).toBe(400)
    const free = await book('cut', '09:00', 'plain@example.com')
    expect(free.status).toBe(201)
  })

  test('switched on by the owner (only): the stylists are listed, and a client sees and books only the chosen stylist\'s times', async () => {
    await features([...FEATURES, 'client_stylist_pick'])
    expect((await as('ana', '/api/appointments/online-stylist-pick', 'PUT', { onlineStylistPick: true })).status).toBe(403)
    expect((await as('owner', '/api/appointments/online-stylist-pick', 'PUT', { onlineStylistPick: 'yes' })).status).toBe(400)
    expect((await as('owner', '/api/appointments/online-stylist-pick', 'PUT', { onlineStylistPick: true })).status).toBe(200)
    const list = (await pub('/api/book/stylists')).body.data
    expect(list.map((p: any) => p.name)).toEqual(['ana T.', 'bea T.'])
    // Ana is busy 09:00–10:00 at the desk
    const client = await ins(t.schema.contact, { companyId: co, name: 'Desk Dee', email: 'dee@example.com', type: 'client' })
    expect((await as('owner', '/api/appointments', 'POST', { contactId: client.id, stylistId: ana, startTime: wall(day, '09:30'), endTime: wall(day, '10:00') })).status).toBe(201)
    const anaTimes = await timesFor('cut', ana), beaTimes = await timesFor('cut', bea)
    expect(anaTimes).not.toContain('09:30')
    expect(anaTimes).toContain('10:00')
    expect(beaTimes).toContain('09:30')
    // the booking goes to the one chosen, and into their book
    expect((await book('cut', '09:30', 'late@example.com', { who: ana })).status).toBe(409)
    const ok = await book('cut', '10:00', 'chosen@example.com', { who: ana })
    expect(ok.status).toBe(201)
    expect((await booking(ok.body.token)).assignedUserId).toBe(ana)
    const appt = await t.db.select().from(t.schema.appointment).where(eq(t.schema.appointment.id, (await booking(ok.body.token)).appointmentId as string))
    expect(appt[0].stylistId).toBe(ana)
    // someone who is not offered cannot be asked for
    expect((await book('cut', '11:00', 'stranger@example.com', { who: 'not-a-person' })).status).toBe(400)
    // moving the booking keeps the stylist: only her times are offered
    const mine = await pub(`/api/book/services/cut/times?date=${day}&token=${ok.body.token}`)
    const movable = (mine.body.data as any[]).map((x) => x.time)
    expect(movable).not.toContain('09:30')
    expect(movable).toContain('10:30')
    // "anyone" still works
    expect((await book('cut', '11:00', 'anyone@example.com')).status).toBe(201)
  })

  test('forms: only the owner builds them; they are checked; a consent needs an agreement', async () => {
    await features([...FEATURES, 'client_stylist_pick', 'intake_forms'])
    const colour = (await as('owner', '/api/service-menu')).body.data.find((s: any) => s.name === 'Colour').id
    const questions = [{ label: 'Any allergies?', type: 'text', required: true }, { label: 'Pregnant or nursing?', type: 'yesno', required: true }, { label: 'Hair history', type: 'choice', options: ['Natural', 'Coloured', 'Bleached'] }]
    expect((await as('ana', '/api/intake-forms', 'POST', { name: 'Health history', questions })).status).toBe(403)
    for (const bad of [{ name: '', questions }, { name: 'X', questions: [] }, { name: 'X', questions: [{ label: 'Pick', type: 'choice', options: ['One'] }] }, { name: 'X', kind: 'consent', questions: [{ label: 'Hello', type: 'text' }] }]) {
      const r = await as('owner', '/api/intake-forms', 'POST', bad)
      expect([r.status, r.body.code]).toEqual([400, 'BAD_FORM'])
    }
    expect((await as('owner', '/api/intake-forms', 'POST', { name: 'Health history', questions, intro: 'Helps us look after you.' })).status).toBe(201)
    expect((await as('owner', '/api/intake-forms', 'POST', { name: 'Colour consent', kind: 'consent', serviceIds: [colour], questions: [{ label: 'I agree to a colour service and have read the patch-test advice.', type: 'consent' }] })).status).toBe(201)
    expect((await as('ana', '/api/intake-forms')).body.data).toHaveLength(2)      // anyone who reads the book can read them
  })

  test('a client is offered the forms that apply on their booking page, fills them in once, and the answers land on their chart', async () => {
    const b = await book('cut', '11:30', 'forms@example.com', { who: bea })
    expect(b.status).toBe(201)
    const p = await page(`/booking/${b.body.token}`)
    expect(p.html).toContain('Before your visit')
    expect(p.html).toContain('Health history')
    expect(p.html).not.toContain('Colour consent')                                  // the consent is for colour only
    const forms = (await as('owner', '/api/intake-forms')).body.data
    const health = forms.find((f: any) => f.name === 'Health history')
    const formPage = await page(`/booking/${b.body.token}/form/${health.id}`)
    expect(formPage.html).toContain('Any allergies?')
    expect(formPage.html).toContain('Helps us look after you.')
    // missing a required answer: back to the form, with the words
    const q = health.questions
    const missing = await post(`/booking/${b.body.token}/form/${health.id}`, { [`q_${q[1].id}`]: 'no' })
    expect(missing.status).toBe(303)
    expect(decodeURIComponent(missing.headers.get('location')!)).toContain('Any allergies?')
    // a choice that is not one of the choices
    const wrongChoice = await post(`/booking/${b.body.token}/form/${health.id}`, { [`q_${q[0].id}`]: 'Latex', [`q_${q[1].id}`]: 'no', [`q_${q[2].id}`]: 'Purple' })
    expect(decodeURIComponent(wrongChoice.headers.get('location')!)).toContain('choices')
    const ok = await post(`/booking/${b.body.token}/form/${health.id}`, { [`q_${q[0].id}`]: 'Latex', [`q_${q[1].id}`]: 'no', [`q_${q[2].id}`]: 'Coloured' })
    expect(ok.headers.get('location')).toContain('form=done')
    // once: the booking page no longer offers it
    expect((await page(`/booking/${b.body.token}`)).html).not.toContain('Before your visit')
    // on the chart, as asked — and a later change to the form does not rewrite it
    const contactId = (await booking(b.body.token)).contactId as string
    const mine = (await as('owner', `/api/intake-forms/responses?contactId=${contactId}`)).body.data
    expect(mine).toHaveLength(1)
    expect(mine[0].answers.map((a: any) => [a.label, a.answer])).toEqual([['Any allergies?', 'Latex'], ['Pregnant or nursing?', 'No'], ['Hair history', 'Coloured']])
    await as('owner', `/api/intake-forms/${health.id}`, 'PUT', { questions: [{ label: 'Something else entirely', type: 'text' }] })
    expect((await as('owner', `/api/intake-forms/responses?contactId=${contactId}`)).body.data[0].answers[0].label).toBe('Any allergies?')
    // answering again changes nothing
    const again = await post(`/booking/${b.body.token}/form/${health.id}`, { [`q_${q[0].id}`]: 'Nothing' })
    expect(again.status).toBe(303)
    expect((await as('owner', `/api/intake-forms/responses?contactId=${contactId}`)).body.data).toHaveLength(1)
  })

  test('a consent is ticked and signed by typing a name; a form that is off or deleted is not offered, and the answers stay', async () => {
    const consentForm = (await as('owner', '/api/intake-forms')).body.data.find((f: any) => f.name === 'Colour consent')
    const b = await book('colour', '09:00', 'consent@example.com', { who: bea })
    expect(b.status).toBe(201)
    expect((await page(`/booking/${b.body.token}`)).html).toContain('Colour consent')
    const qid = consentForm.questions[0].id
    const unsigned = await post(`/booking/${b.body.token}/form/${consentForm.id}`, { [`q_${qid}`]: '1' })
    expect(decodeURIComponent(unsigned.headers.get('location')!)).toContain('full name')
    const unticked = await post(`/booking/${b.body.token}/form/${consentForm.id}`, { signedName: 'Cora Client' })
    expect(decodeURIComponent(unticked.headers.get('location')!)).toContain('tick')
    const ok = await post(`/booking/${b.body.token}/form/${consentForm.id}`, { [`q_${qid}`]: '1', signedName: 'Cora Client' })
    expect(ok.headers.get('location')).toContain('form=done')
    const contactId = (await booking(b.body.token)).contactId as string
    const mine = (await as('owner', `/api/intake-forms/responses?contactId=${contactId}`)).body.data
    expect([mine[0].formKind, mine[0].signedName, mine[0].answers[0].answer]).toEqual(['consent', 'Cora Client', 'Agreed'])
    // switched off: the page asks for nothing
    const other = await book('colour', '10:30', 'off@example.com', { who: bea })
    expect((await page(`/booking/${other.body.token}`)).html).toContain('Colour consent')
    await features([...FEATURES, 'client_stylist_pick'])
    expect((await page(`/booking/${other.body.token}`)).html).not.toContain('Before your visit')
    expect((await as('owner', '/api/intake-forms')).status).not.toBe(200)
    // deleting a form keeps what was answered
    await features([...FEATURES, 'client_stylist_pick', 'intake_forms'])
    expect((await as('owner', `/api/intake-forms/${consentForm.id}`, 'DELETE')).status).toBe(200)
    expect((await as('owner', `/api/intake-forms/responses?contactId=${contactId}`)).body.data).toHaveLength(1)
  })
})
