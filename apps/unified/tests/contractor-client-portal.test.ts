// Contractor parity row 10 (part a) — the client portal's project page, finished (docs/parity/contractor-portal.md; Buildertrend
// per-job client permissions; client_portal_plus, not ready): per-project settings over a company default, the schedule (phases
// or every task, a time frame) with the client's comments and the office's answers, the daily logs and files the office shares
// (never an unshared one, never another client's), the client's to-dos, and emails where the settings ask for them. Fails
// without the change: the portal's project page had no schedule, daily logs, shared files or to-dos.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY } from '@twomiah/tenant-backend'

const json = async (r: Response) => ({ status: r.status, body: (await r.json().catch(() => null)) as any })
const ON = ['contacts', 'projects', 'gantt_charts', 'daily_logs', 'documents', 'client_portal', 'client_portal_plus']
const DAY = 86_400_000
let t: any, companyId = '', owner: any, portal: Record<string, string> = {}, ids: Record<string, string> = {}
const mails: any[] = []
const P = (who: string) => (path: string, i: any = {}) => t.call(`/api/portal/p/${portal[who]}${path}`, i)
const setFeatures = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await setFeatures(ON)
  process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'https://crm.example.com'
  ;(t.services.email as any).send = async () => ({ success: true })
  ;(t.services.crm.emailService as any).sendRaw = async (m: any) => { mails.push(m); return { success: true } }
  Object.assign((t.services as any).crm.storage, {
    storageConfigured: () => true, getObject: async (key: string) => t.store.getObject(key),
    saveFile: async (file: File, cid: string, folder: string) => { const key = `${cid}/${folder}/${crypto.randomUUID()}.pdf`; await t.store.put(key, Buffer.from(await file.arrayBuffer()), file.type); return { path: key, originalname: file.name, mimetype: file.type, size: file.size } },
    getFileUrl: (key: string) => `/files/${key}`,
  })
  const tok = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  owner = (p: string, i: any = {}) => t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } })
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  for (const [k, name] of [['lee', 'Lee Marsh'], ['ann', 'Ann Other']]) {
    ids[k] = (await ins(t.schema.contact, { companyId, name, email: `${k}@home.example`, type: 'client' })).id
    const r = await json(await owner(`/api/portal/contacts/${ids[k]}/enable`, { method: 'POST' }))
    portal[k] = String(r.body.portalUrl).split('/').pop()!
  }
  const now = Date.now()
  ids.kitchen = (await ins(t.schema.project, { companyId, number: 'PRJ-0001', name: 'Kitchen', contactId: ids.lee, status: 'active' })).id
  ids.annsJob = (await ins(t.schema.project, { companyId, number: 'PRJ-0002', name: 'Porch', contactId: ids.ann, status: 'active' })).id
  ids.phase = (await ins(t.schema.projectTask, { companyId, projectId: ids.kitchen, name: 'Demolition', startDate: new Date(now), endDate: new Date(now + 3 * DAY) })).id
  ids.sub = (await ins(t.schema.projectTask, { companyId, projectId: ids.kitchen, parentId: ids.phase, name: 'Pull cabinets', startDate: new Date(now), endDate: new Date(now + DAY) })).id
  ids.later = (await ins(t.schema.projectTask, { companyId, projectId: ids.kitchen, name: 'Countertops', startDate: new Date(now + 60 * DAY), endDate: new Date(now + 62 * DAY) })).id
  ids.uid = (await t.db.select().from(t.schema.user).where(eq(t.schema.user.companyId, companyId)))[0].id
  await t.store.put(`${companyId}/logs/p1.jpg`, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg')
  ids.log = (await ins(t.schema.dailyLog, { companyId, projectId: ids.kitchen, userId: ids.uid, date: new Date(now), weather: 'Sunny', workPerformed: 'Cabinets out', safetyNotes: 'Nail in boot', delays: 'Late dumpster', photos: [{ id: 'ph1', name: 'p1.jpg', caption: 'Bare wall', path: `${companyId}/logs/p1.jpg`, size: 4, uploadedAt: new Date().toISOString(), uploadedById: ids.uid }] })).id
  ids.hidden = (await ins(t.schema.dailyLog, { companyId, projectId: ids.kitchen, userId: ids.uid, date: new Date(now - DAY), workPerformed: 'Internal only' })).id
  ids.doc = (await ins(t.schema.document, { companyId, projectId: ids.kitchen, name: 'Layout.pdf', filename: 'l.pdf', originalName: 'Layout.pdf', mimeType: 'application/pdf', path: `${companyId}/docs/l.pdf`, url: '/x' })).id
}, 120_000)

describe('client portal plus', () => {
  test('is registered, not ready, and the general contractor’s', () => {
    const f = (FEATURE_REGISTRY as any[]).find((x) => x.id === 'client_portal_plus')
    expect([!!f?.hidden, f?.templates]).toEqual([false, ['crm']])
  })

  test('the default: phases of the schedule, and only what was shared — never safety notes, delays or another client’s', async () => {
    let x = await json(await P('lee')(`/projects/${ids.kitchen}/extras`))
    expect(x.status).toBe(200)
    expect(x.body.schedule.map((s: any) => s.name)).toEqual(['Demolition', 'Countertops']) // phases: no sub-task
    expect(x.body.dailyLogs).toEqual([])
    expect(x.body.files).toEqual([])
    const share = await json(await owner(`/api/client-portal/daily-logs/${ids.log}/share`, { method: 'PUT', json: { shared: true } }))
    expect(share.body).toMatchObject({ sharedWithClient: true, told: 'not-asked' })
    await owner(`/api/client-portal/documents/${ids.doc}/share`, { method: 'PUT', json: { shared: true } })
    x = await json(await P('lee')(`/projects/${ids.kitchen}/extras`))
    expect(x.body.dailyLogs).toEqual([{ id: ids.log, date: expect.any(String), weather: 'Sunny', workPerformed: 'Cabinets out', workCompleted: null, photos: [{ id: 'ph1', caption: 'Bare wall' }] }])
    expect(JSON.stringify(x.body)).not.toMatch(/Nail in boot|Late dumpster|Internal only|logs\/p1/)
    expect(x.body.files.map((f: any) => f.name)).toEqual(['Layout.pdf'])
    const photo = await P('lee')(`/projects/${ids.kitchen}/files/log-photo/${ids.log}:ph1`)
    expect([photo.status, photo.headers.get('content-type')]).toEqual([200, 'image/jpeg'])
    // another client: not their project, not their photo
    expect((await P('ann')(`/projects/${ids.kitchen}/extras`)).status).toBe(404)
    expect((await P('ann')(`/projects/${ids.kitchen}/files/log-photo/${ids.log}:ph1`)).status).toBe(404)
    expect((await P('lee')(`/projects/${ids.kitchen}/files/log-photo/${ids.hidden}:ph1`)).status).toBe(404)
  }, 90_000)

  test('per-project settings over the company default: every task, a time frame, a section off', async () => {
    await owner('/api/client-portal/defaults', { method: 'PUT', json: { schedule: 'all' } })
    let x = await json(await P('lee')(`/projects/${ids.kitchen}/extras`))
    expect(x.body.schedule.map((s: any) => s.name).sort()).toEqual(['Countertops', 'Demolition', 'Pull cabinets'])
    const set = await json(await owner(`/api/client-portal/${ids.kitchen}/settings`, { method: 'PUT', json: { scheduleWeeks: 4, photos: false } }))
    expect(set.body).toMatchObject({ schedule: 'all', scheduleWeeks: 4, photos: false })
    x = await json(await P('lee')(`/projects/${ids.kitchen}/extras`))
    expect(x.body.schedule.map((s: any) => s.name)).not.toContain('Countertops') // 60 days out, past 4 weeks
    expect(x.body.files).toBeUndefined()
    expect((await P('lee')(`/projects/${ids.kitchen}/files/document/${ids.doc}`)).status).toBe(404)
    // the office's preview is the same page
    const pv = await json(await owner(`/api/client-portal/${ids.kitchen}/preview`))
    expect(pv.body.schedule.length).toBe(x.body.schedule.length)
    await owner(`/api/client-portal/${ids.kitchen}/settings`, { method: 'PUT', json: { schedule: 'off' } })
    x = await json(await P('lee')(`/projects/${ids.kitchen}/extras`))
    expect(x.body.schedule).toBeUndefined()
    expect((await P('lee')(`/projects/${ids.kitchen}/tasks/${ids.phase}/comments`, { method: 'POST', json: { body: 'hi' } })).status).toBe(404)
    await owner(`/api/client-portal/${ids.kitchen}/settings`, { method: 'PUT', json: { schedule: 'phases', scheduleWeeks: null, photos: true } })
  }, 90_000)

  test('the client comments on a task, the office sees it and answers', async () => {
    const c = await json(await P('lee')(`/projects/${ids.kitchen}/tasks/${ids.phase}/comments`, { method: 'POST', json: { body: 'Can we keep the old sink?' } }))
    expect(c.status).toBe(201)
    const list = await json(await owner(`/api/client-portal/${ids.kitchen}/comments`))
    expect(list.body.data.map((r: any) => [r.taskName, r.body, r.fromClient])).toEqual([['Demolition', 'Can we keep the old sink?', true]])
    await owner(`/api/client-portal/${ids.kitchen}/tasks/${ids.phase}/comments`, { method: 'POST', json: { body: 'Yes, we will set it aside.' } })
    const x = await json(await P('lee')(`/projects/${ids.kitchen}/extras`))
    expect(x.body.schedule.find((s: any) => s.id === ids.phase).comments.map((c: any) => [c.fromClient, c.body])).toEqual([[true, 'Can we keep the old sink?'], [false, 'Yes, we will set it aside.']])
    expect((await P('lee')(`/projects/${ids.kitchen}/tasks/${ids.phase}/comments`, { method: 'POST', json: { body: '  ' } })).status).toBe(400)
  }, 90_000)

  test('a to-do for the client: emailed when the settings ask; the client ticks items and marks it done', async () => {
    await owner(`/api/client-portal/${ids.kitchen}/settings`, { method: 'PUT', json: { notify: { todos: true } } })
    mails.length = 0
    const made = await json(await owner(`/api/client-portal/${ids.kitchen}/todos`, { method: 'POST', json: { title: 'Pick a paint colour', checklist: [{ text: 'Walls' }, { text: 'Trim' }], dueDate: '2026-12-01' } }))
    expect(made.status).toBe(201)
    expect(made.body.told).toBe('email')
    expect(mails.map((m) => [m.to, m.subject])).toEqual([['lee@home.example', 'A new to-do for you: Pick a paint colour — Kitchen']])
    const tick = await json(await P('lee')(`/projects/${ids.kitchen}/todos/${made.body.id}`, { method: 'POST', json: { item: 1, done: true } }))
    expect(tick.body.checklist).toEqual([{ text: 'Walls', done: false }, { text: 'Trim', done: true }])
    const done = await json(await P('lee')(`/projects/${ids.kitchen}/todos/${made.body.id}`, { method: 'POST', json: { complete: true } }))
    expect(done.body.status).toBe('done')
    expect((await P('ann')(`/projects/${ids.kitchen}/todos/${made.body.id}`, { method: 'POST', json: { complete: true } })).status).toBe(404)
    expect((await P('lee')(`/projects/${ids.kitchen}/todos/${made.body.id}`, { method: 'POST', json: { item: 9, done: true } })).status).toBe(400)
  }, 90_000)

  test('off: no office routes, no section, and the project page is as it was', async () => {
    await setFeatures(ON.filter((f) => f !== 'client_portal_plus'))
    expect((await owner(`/api/client-portal/${ids.kitchen}/settings`)).status).toBe(404)
    expect((await P('lee')(`/projects/${ids.kitchen}/extras`)).status).toBe(404)
    const home = await json(await P('lee')(''))
    expect(home.body.sections?.projectExtras).toBe(false)
    expect((await P('lee')(`/projects/${ids.kitchen}`)).status).toBe(200)
    await setFeatures(ON)
  }, 90_000)
})

// Row 10b — the payment schedule: shares of the contract and fixed amounts, released into real invoices billed toward the
// approved quote (credited on its final invoice), never past the contract; the client sees what is due and paid.
describe('the payment schedule', () => {
  test('a share of the contract and a fixed amount; release raises the invoice; paid is the invoice’s; never past the contract', async () => {
    const q = (await t.db.insert(t.schema.quote).values({ companyId, number: 'QT-0001', name: 'Kitchen', contactId: ids.lee, projectId: ids.kitchen, status: 'approved', subtotal: '20000', total: '20000' } as any).returning())[0]
    const add = async (b: any) => json(await owner(`/api/client-portal/${ids.kitchen}/payments`, { method: 'POST', json: b }))
    expect((await add({ name: 'Deposit', amountType: 'percent', amount: 10 })).status).toBe(201)
    const two = await add({ name: 'Cabinets set', amountType: 'fixed', amount: 5000, dueDate: '2026-12-15' })
    expect(two.body.contract).toEqual({ value: 20000, source: 'quotes' })
    expect(two.body.payments.map((p: any) => [p.name, p.amount, p.state])).toEqual([['Deposit', 2000, 'scheduled'], ['Cabinets set', 5000, 'scheduled']])
    expect((await add({ name: 'Too much', amountType: 'percent', amount: 150 })).status).toBe(400)

    await owner(`/api/client-portal/${ids.kitchen}/settings`, { method: 'PUT', json: { notify: { payments: true } } })
    mails.length = 0
    const dep = two.body.payments[0]
    const r = await json(await owner(`/api/client-portal/payments/${dep.id}/release`, { method: 'POST' }))
    expect(r.status).toBe(201)
    expect(r.body.told).toBe('email')
    expect(mails[0].subject).toBe('A payment is due: Deposit — Kitchen')
    const [inv] = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.id, r.body.invoice.id)) as any[]
    expect([Number(inv.total), inv.status, inv.contactId, inv.projectId, inv.billKind, inv.billedQuoteId]).toEqual([2000, 'sent', ids.lee, ids.kitchen, 'progress', q.id])
    expect((await owner(`/api/client-portal/payments/${dep.id}/release`, { method: 'POST' })).status).toBe(409)
    expect((await owner(`/api/client-portal/payments/${dep.id}`, { method: 'PUT', json: { name: 'x', amount: 1 } })).status).toBe(400)

    let x = await json(await P('lee')(`/projects/${ids.kitchen}/extras`))
    expect(x.body.payments.payments.map((p: any) => [p.name, p.state, p.invoiceId])).toEqual([['Deposit', 'due', inv.id], ['Cabinets set', 'scheduled', null]])
    await t.db.update(t.schema.invoice).set({ amountPaid: '2000', status: 'paid' } as any).where(eq(t.schema.invoice.id, inv.id))
    x = await json(await P('lee')(`/projects/${ids.kitchen}/extras`))
    expect([x.body.payments.paid, x.body.payments.payments[0].state]).toEqual([2000, 'paid'])
    expect(JSON.stringify(x.body.payments)).not.toMatch(/amountType|share/)

    const big = await add({ name: 'Everything else', amountType: 'fixed', amount: 19000 })
    const last = big.body.payments.find((p: any) => p.name === 'Everything else')
    const over = await json(await owner(`/api/client-portal/payments/${last.id}/release`, { method: 'POST' }))
    expect([over.status, over.body.error]).toEqual([400, 'Releasing 19000.00 would bill 21000.00 on a contract of 20000.00.'])
    // another client never sees it
    expect((await P('ann')(`/projects/${ids.kitchen}/extras`)).status).toBe(404)
  }, 90_000)
})

// Row 10c — documents to e-sign: a PDF on the project sent to the client, signed in the portal with the evidence quotes keep,
// a signed copy (the original plus a signature page) filed on the project; never someone else's, never twice, never unconsented.
describe('documents to e-sign', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  test('sent, read, signed with evidence; the signed copy is filed and shown; refusals in words', async () => {
    const { PDFDocument } = await import('pdf-lib')
    const pdf = await PDFDocument.create(); pdf.addPage([612, 792]).drawText('Contract terms')
    const bytes = Buffer.from(await pdf.save())
    const key = `${companyId}/docs/contract.pdf`
    await t.store.put(key, bytes, 'application/pdf')
    const doc = (await t.db.insert(t.schema.document).values({ companyId, projectId: ids.kitchen, name: 'Contract.pdf', filename: 'contract.pdf', originalName: 'Contract.pdf', mimeType: 'application/pdf', path: key, url: '/x' } as any).returning())[0]
    mails.length = 0
    const sent = await json(await owner(`/api/client-portal/${ids.kitchen}/sign-requests`, { method: 'POST', json: { documentId: doc.id, title: 'Kitchen contract' } }))
    expect(sent.status).toBe(201)
    expect(mails.map((m) => m.subject)).toEqual(['Please sign: Kitchen contract — Kitchen'])
    // only a PDF on this project
    const png = (await t.db.insert(t.schema.document).values({ companyId, projectId: ids.kitchen, name: 'Photo.png', filename: 'p.png', originalName: 'Photo.png', mimeType: 'image/png', path: `${companyId}/p.png`, url: '/y' } as any).returning())[0]
    expect((await json(await owner(`/api/client-portal/${ids.kitchen}/sign-requests`, { method: 'POST', json: { documentId: png.id, title: 'x' } }))).body.error).toBe('Only a PDF can be sent to sign.')

    let x = await json(await P('lee')(`/projects/${ids.kitchen}/extras`))
    const req = x.body.toSign.find((r: any) => r.title === 'Kitchen contract')
    expect(req).toMatchObject({ status: 'sent', signed: false })
    const read = await P('lee')(`/projects/${ids.kitchen}/files/sign/${req.id}`)
    expect([read.status, read.headers.get('content-type')]).toEqual([200, 'application/pdf'])
    expect((await P('ann')(`/projects/${ids.kitchen}/files/sign/${req.id}`)).status).toBe(404)

    const S = (b: any, who = 'lee') => P(who)(`/projects/${ids.kitchen}/sign/${req.id}`, { method: 'POST', json: b, headers: { 'x-forwarded-for': '203.0.113.7', 'user-agent': 'TestBrowser/1' } })
    expect((await json(await S({ signature: PNG, signedBy: 'Lee Marsh' }))).body.error).toBe('You must agree to sign electronically before signing.')
    expect((await json(await S({ signature: PNG, consent: true }))).body.error).toBe('Please type your full name to sign.')
    expect((await json(await S({ signedBy: 'Lee Marsh', consent: true }))).body.error).toBe('A signature is required.')
    expect((await S({ signature: PNG, signedBy: 'Lee Marsh', consent: true }, 'ann')).status).toBe(404)
    const ok = await json(await S({ signature: PNG, signedBy: 'Lee Marsh', consent: true }))
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ status: 'signed', signedName: 'Lee Marsh', signed: true })
    expect((await json(await S({ signature: PNG, signedBy: 'Lee Marsh', consent: true }))).body.error).toMatch(/^This was signed on/)

    const [row] = await t.db.select().from(t.schema.projectSignRequest).where(eq(t.schema.projectSignRequest.id, req.id)) as any[]
    const { createHash } = await import('node:crypto')
    expect([row.signerIp, row.signerUserAgent, row.documentHash]).toEqual(['203.0.113.7', 'TestBrowser/1', createHash('sha256').update(bytes).digest('hex')])
    const [signedDoc] = await t.db.select().from(t.schema.document).where(eq(t.schema.document.id, row.signedDocumentId)) as any[]
    expect([signedDoc.projectId, signedDoc.sharedWithCustomer, signedDoc.name]).toEqual([ids.kitchen, true, 'Kitchen contract (signed)'])
    const copy = await PDFDocument.load(new Uint8Array(await (await P('lee')(`/projects/${ids.kitchen}/files/sign/${req.id}`)).arrayBuffer()))
    expect(copy.getPageCount()).toBe(2) // the original page and the signature page
    const audits = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, req.id)) as any[]
    expect(audits.map((a) => [a.action, a.userName, a.ipAddress])).toEqual([['sign_request.signed', 'Lee Marsh', '203.0.113.7']])
    // the office's list carries the evidence, never the drawn image
    const list = await json(await owner(`/api/client-portal/${ids.kitchen}/sign-requests`))
    expect(JSON.stringify(list.body)).not.toContain('base64')
    expect((await owner(`/api/client-portal/sign-requests/${req.id}/cancel`, { method: 'POST' })).status).toBe(400)
  }, 90_000)
})
