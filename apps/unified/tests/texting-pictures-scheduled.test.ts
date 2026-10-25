// Picture messages and scheduled texts in two-way texting (server crm/comms/smsMedia.ts, crm/comms/scheduledTexts.ts,
// tenant-backend integrations/sms.ts): a picture from the customer's job photos or an upload goes to the carrier as a
// short-lived signed link to the private store and shows in the thread; a text set for a time on the company's clock is
// sent by the timed work, cancelable until it goes; opt-outs hold for both. No carrier is called: the sender's
// transport is a recorder.
import { describe, test, expect, beforeAll } from 'bun:test'
import sharp from 'sharp'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { pictureKeyOf, pictureToken } from '../server/crm/comms/smsMedia.ts'
import { createScheduledTextRunner } from '../server/crm/comms/scheduledTexts.ts'

const PNG = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#36a' } }).png().toBuffer()
let t: Awaited<ReturnType<typeof bootTenant>>
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const carrier: any[] = []
const as = (who: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const signIn = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken

beforeAll(async () => {
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  ids.company = s.company.id
  // A stand-in carrier account and the app's public address; the transport below means neither is ever reached.
  process.env.TWILIO_ACCOUNT_SID = 'ACtest'
  process.env.TWILIO_AUTH_TOKEN = 'test-token'
  process.env.TWILIO_PHONE_NUMBER = '+16085550100'
  process.env.API_URL = 'https://tenant.example.com'
  ;(t.services as any).crm.sms.setTransport(async (params: any) => { carrier.push(params); return { sid: `SM${carrier.length}`, numSegments: '1' } })
  Object.assign((t.services as any).crm.storage, {
    storageConfigured: () => true,
    put: async (key: string, body: Buffer, contentType: string) => { await t.store.put(key, body, contentType) },
    getObject: async (key: string) => t.store.getObject(key),
  })
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'two_way_texting', 'photo_capture'], timezone: 'America/Chicago' } as any).where(eq(t.schema.company.id, s.company.id))
  tokens.owner = await signIn(s.owner.email, s.password)
  await t.db.insert(t.schema.user).values({ email: 'viewer@test.example', passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: 'Vi', lastName: 'Ewer', role: 'viewer', companyId: s.company.id })
  tokens.viewer = await signIn('viewer@test.example', 'Seat-pass-1')
  const [pat] = await t.db.insert(t.schema.contact).values({ companyId: s.company.id, name: 'Pat Client', mobile: '(608) 555-0166', type: 'client' } as any).returning()
  const [olly] = await t.db.insert(t.schema.contact).values({ companyId: s.company.id, name: 'Olly Optout', mobile: '(608) 555-0177', type: 'client', optedOutSms: true } as any).returning()
  ids.pat = pat.id; ids.olly = olly.id
  const job = await (await as('owner', '/api/jobs', { method: 'POST', json: { title: 'Furnace', contactId: pat.id } })).json()
  ids.job = (job.data ?? job).id
  const fd = new FormData(); fd.append('photo', new File([PNG], 'furnace.png', { type: 'image/png' }))
  expect((await as('owner', `/api/jobs/${ids.job}/photos`, { method: 'POST', body: fd })).status).toBe(201)
}, 120_000)

describe('the signed link', () => {
  test('opens one file until it runs out; an altered or expired link opens nothing', () => {
    const tok = pictureToken('c1/sms/a.png', 60)
    expect(pictureKeyOf(tok)).toBe('c1/sms/a.png')
    const [k, exp, sig] = tok.split('.')
    expect(pictureKeyOf(`${Buffer.from('c1/sms/b.png').toString('base64url')}.${exp}.${sig}`)).toBeNull()
    expect(pictureKeyOf(`${k}.${Number(exp) + 999}.${sig}`)).toBeNull()
    expect(pictureKeyOf(pictureToken('c1/sms/a.png', 60, Date.now() - 120_000))).toBeNull()
  })
})

describe('picture messages', () => {
  test("a picture from the customer's job and an upload go to the carrier as signed links, and show in the thread", async () => {
    const lib = await json(await as('owner', `/api/sms-media/library?contactId=${ids.pat}`))
    expect(lib.status).toBe(200)
    expect(lib.body.data.length).toBe(1)
    const fd = new FormData(); fd.append('file', new File([PNG], 'site.png', { type: 'image/png' }))
    const up = await json(await as('owner', '/api/sms-media/upload', { method: 'POST', body: fd }))
    expect(up.status).toBe(201)
    expect(up.body.key.startsWith(`${ids.company}/sms/`)).toBe(true)
    const sentR = await json(await as('owner', '/api/sms/send', { method: 'POST', json: { contactId: ids.pat, message: 'Here is your furnace', media: [lib.body.data[0].key, up.body.key] } }))
    expect(sentR.status).toBe(200)
    const call = carrier.at(-1)
    expect(call.mediaUrl.length).toBe(2)
    for (const u of call.mediaUrl) expect(u).toMatch(/^https:\/\/tenant\.example\.com\/api\/sms-media\/file\//)
    // The carrier's link serves the picture with no sign-in.
    const pic = await t.call(new URL(call.mediaUrl[1]).pathname)
    expect(pic.status).toBe(200)
    expect(pic.headers.get('content-type')).toBe('image/png')
    // The thread shows them, by links of their own — never the storage key.
    const conv = await json(await as('owner', `/api/sms/conversations/${sentR.body.conversationId}`))
    const msg = conv.body.messages.at(-1)
    expect(msg.media.length).toBe(2)
    expect(msg.mediaUrls).toBeUndefined()
    expect((await t.call(msg.media[0].url)).status).toBe(200)
    // Pictures alone are a text too.
    expect((await as('owner', `/api/sms/conversations/${sentR.body.conversationId}/reply`, { method: 'POST', json: { media: [up.body.key] } })).status).toBe(200)
  })

  test("another business's file, an opted-out contact and a seat that may not text are all refused", async () => {
    const before = carrier.length
    expect((await as('owner', '/api/sms/send', { method: 'POST', json: { contactId: ids.pat, message: 'x', media: ['other-company/sms/a.png'] } })).status).toBe(400)
    expect((await as('owner', '/api/sms/send', { method: 'POST', json: { contactId: ids.olly, message: 'x', media: [`${ids.company}/sms/a.png`] } })).status).toBe(400)
    const fd = new FormData(); fd.append('file', new File([PNG], 'x.png', { type: 'image/png' }))
    expect((await as('viewer', '/api/sms-media/upload', { method: 'POST', body: fd })).status).toBe(403)
    // A file that only claims to be a picture is not kept.
    const fake = new FormData(); fake.append('file', new File(['<html></html>'], 'x.png', { type: 'image/png' }))
    expect((await as('owner', '/api/sms-media/upload', { method: 'POST', body: fake })).status).toBe(400)
    expect(carrier.length).toBe(before)
  })
})

describe('scheduled texts', () => {
  test('set for a time on the company clock, sent when due, once', async () => {
    // 9:00 in Chicago on a day ahead is 14:00 or 15:00 UTC, whatever the server's clock.
    const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
    const r = await json(await as('owner', '/api/sms-scheduled', { method: 'POST', json: { contactId: ids.pat, message: 'See you tomorrow', sendAt: `${day}T09:00` } }))
    expect(r.status).toBe(201)
    expect([14, 15]).toContain(new Date(r.body.sendAt).getUTCHours())
    ids.scheduled = r.body.id
    const runner = createScheduledTextRunner({ db: t.db, sms: (t.services as any).crm.sms, logger: { info() {}, warn() {}, error() {} } as any })
    const before = carrier.length
    expect((await runner.runOnce(new Date())).sent).toBe(0)
    const due = new Date(new Date(r.body.sendAt).getTime() + 1000)
    expect((await runner.runOnce(due)).sent).toBe(1)
    expect(carrier.length).toBe(before + 1)
    expect(carrier.at(-1).body).toBe('See you tomorrow')
    expect((await runner.runOnce(due)).sent).toBe(0)
    const [row] = await t.db.select().from(t.schema.scheduledText).where(eq(t.schema.scheduledText.id, r.body.id))
    expect(row.status).toBe('sent')
    // Gone: it cannot be cancelled.
    expect((await as('owner', `/api/sms-scheduled/${r.body.id}/cancel`, { method: 'POST' })).status).toBe(409)
  })

  test('cancelable before it goes; a past time, an opted-out contact and a seat that may not text are refused', async () => {
    const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
    const r = await json(await as('owner', '/api/sms-scheduled', { method: 'POST', json: { contactId: ids.pat, message: 'Later', sendAt: `${day}T10:30` } }))
    const list = await json(await as('owner', `/api/sms-scheduled?contactId=${ids.pat}`))
    expect(list.body.data.map((x: any) => x.id)).toContain(r.body.id)
    expect((await as('owner', `/api/sms-scheduled/${r.body.id}/cancel`, { method: 'POST' })).status).toBe(200)
    const runner = createScheduledTextRunner({ db: t.db, sms: (t.services as any).crm.sms, logger: { info() {}, warn() {}, error() {} } as any })
    const before = carrier.length
    await runner.runOnce(new Date(Date.now() + 5 * 86400000))
    expect(carrier.length).toBe(before)
    expect((await as('owner', '/api/sms-scheduled', { method: 'POST', json: { contactId: ids.pat, message: 'x', sendAt: '2020-01-01T09:00' } })).status).toBe(400)
    expect((await as('owner', '/api/sms-scheduled', { method: 'POST', json: { contactId: ids.olly, message: 'x', sendAt: `${day}T09:00` } })).status).toBe(400)
    expect((await as('viewer', '/api/sms-scheduled', { method: 'POST', json: { contactId: ids.pat, message: 'x', sendAt: `${day}T09:00` } })).status).toBe(403)
  })

  test('a contact who opts out after it was set is skipped when it comes due', async () => {
    const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
    const r = await json(await as('owner', '/api/sms-scheduled', { method: 'POST', json: { contactId: ids.pat, message: 'Promo', sendAt: `${day}T11:00` } }))
    await t.db.update(t.schema.contact).set({ optedOutSms: true } as any).where(eq(t.schema.contact.id, ids.pat))
    const runner = createScheduledTextRunner({ db: t.db, sms: (t.services as any).crm.sms, logger: { info() {}, warn() {}, error() {} } as any })
    const before = carrier.length
    expect((await runner.runOnce(new Date(Date.now() + 5 * 86400000))).skipped).toBe(1)
    expect(carrier.length).toBe(before)
    const [row] = await t.db.select().from(t.schema.scheduledText).where(eq(t.schema.scheduledText.id, r.body.id))
    expect(row.status).toBe('skipped')
  })
})
