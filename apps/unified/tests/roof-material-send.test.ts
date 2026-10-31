// Emailing a material order to the supplier (docs/parity/roof-material-list.md #11), through the real server as the roofing vertical.
// Nothing real is sent: the shared email sender (`sendRaw`) is replaced by a recorder, here and in every test.
import { describe, test, expect, beforeAll, beforeEach } from 'bun:test'
import { eq } from 'drizzle-orm'
import { inflateSync } from 'node:zlib'
import nodemailer from 'nodemailer'
import { createEmailService } from '../server/core/email.ts'
import { bootTenant, seedOwner } from './harness.ts'
import { appendSendLog, isSendable, parseRecipients, SEND_LOG_KEEPS } from '../server/crm/roof/orderSend.ts'

type T = Awaited<ReturnType<typeof bootTenant>>
let t: T
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Seat-pass-1'
const FEATURES = ['jobs', 'contacts', 'materials', 'job_costing', 'roof_material_list', 'material_supply']
let mails: any[] = []
let behave: 'ok' | 'dev' | 'throw' = 'ok'

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) as any })
const call = async (who: string, method: string, p: string, body?: unknown) => json(await as(who)(p, { method, ...(body === undefined ? {} : { json: body }) }))
const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
const stored = async (id: string) => (await t.db.select().from(t.schema.material).where(eq(t.schema.material.id, id)))[0] as any

/** Every text string drawn in a PDF (its streams, inflated, and the TJ/Tj hex strings in them). */
function pdfText(buf: Buffer): string {
  const raw = buf.toString('latin1')
  let out = ''
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body = ''
    try { body = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1') } catch { continue }
    for (const h of body.matchAll(/<([0-9a-fA-F]+)>/g)) out += Buffer.from(h[1], 'hex').toString('latin1')
    out += '\n'
  }
  return out
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES, name: 'Test Builders', email: 'office@test-builders.example', phone: '715-555-0000' } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  tokens.owner = await login('owner@test.example', seeded.password)
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  for (const [key, role] of [['mgr', 'manager'], ['rep', 'field']] as const) {
    ids[key] = (await ins(t.schema.user, { email: `${key}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId })).id
    tokens[key] = await login(`${key}@test.example`, PASS)
  }
  ids.home = (await ins(t.schema.contact, { companyId, name: 'Lee Marsh', mobile: '715-555-0101', type: 'client' })).id
  // The shared sender, replaced: records what would have gone out and nothing leaves the process.
  const email: any = t.services.email
  email.sendRaw = async (m: any) => {
    mails.push(m)
    if (behave === 'throw') throw new Error('smtp down')
    return behave === 'dev' ? { success: true, dev: true } : { success: true, messageId: `<m${mails.length}@test>` }
  }
}, 120_000)
beforeEach(() => { mails = []; behave = 'ok' })

async function makeJob(address = '12 Gable Ln') {
  const made = await call('owner', 'POST', '/api/jobs', { contactId: ids.home, jobType: 'retail', propertyAddress: address, city: 'Akron', state: 'OH', zip: '44301', totalSquares: 30 })
  expect(made.status).toBe(201)
  return made.body.id as string
}
const order = async (jobId: string, extra: Record<string, unknown> = {}, who = 'mgr') => {
  const made = await call(who, 'POST', '/api/materials', { jobId, supplier: 'ABC Supply', poNumber: 'PO-7781', contactName: 'Sam Foreman', contactPhone: '715-555-0188', deliveryDate: '2026-11-05', lineItems: [{ description: 'Architectural shingles', qty: 90, unit: 'bundle', unitPrice: 41.5 }, { description: 'Ridge cap', qty: 6, unit: 'bundle', unitPrice: 55 }], ...extra }, )
  if (made.status !== 201) throw new Error(JSON.stringify(made.body))
  return made.body.id as string
}
const send = (id: string, body: unknown, who = 'mgr') => call(who, 'POST', `/api/material-supply/orders/${id}/send`, body)

describe('the pure parts', () => {
  test('recipients: one box or a list, split on commas, semicolons and lines, lower-cased, no repeats, bad ones named', () => {
    expect(parseRecipients('Orders@ABC.com, desk@abc.com; orders@abc.com\nboss@abc.com')).toEqual({ emails: ['orders@abc.com', 'desk@abc.com', 'boss@abc.com'], bad: [] })
    expect(parseRecipients(['a@b.co', 'nope', 'x@y'])).toEqual({ emails: ['a@b.co'], bad: ['nope', 'x@y'] })
    expect(parseRecipients(undefined)).toEqual({ emails: [], bad: [] })
  })
  test('which orders can still be sent', () => {
    for (const s of ['not_ordered', 'ready_to_send', 'rejected', 'sent']) expect(isSendable(s)).toBe(true)
    for (const s of ['ordered', 'partial', 'delivered', 'cancelled']) expect(isSendable(s)).toBe(false)
  })
  test('the log keeps the newest entries only', () => {
    let log: any[] = []
    for (let i = 0; i < SEND_LOG_KEEPS + 5; i++) log = appendSendLog(log, { at: String(i), byUserId: null, byName: null, to: [], cc: [], subject: '', message: '', attachment: '', messageId: null })
    expect(log.length).toBe(SEND_LOG_KEEPS)
    expect(log[log.length - 1].at).toBe(String(SEND_LOG_KEEPS + 4))
  })
})

describe('sending one order', () => {
  test('the supplier gets the order with the PDF attached; the order becomes Sent, dated, and logged', async () => {
    const id = await order(await makeJob())
    const r = await send(id, { to: 'Orders@abcsupply.example, desk@abcsupply.example', cc: 'office@test-builders.example', subject: 'Order for Gable Ln', message: 'Deliver before 8am please.' })
    expect(r.status).toBe(200)
    expect(r.body.orderStatus).toBe('sent')
    expect(r.body.orderDate).toBeTruthy()
    expect(mails.length).toBe(1)
    const m = mails[0]
    expect(m.to).toBe('orders@abcsupply.example, desk@abcsupply.example')
    expect(m.cc).toBe('office@test-builders.example')
    expect(m.subject).toBe('Order for Gable Ln')
    expect(m.html).toContain('Deliver before 8am please.')
    expect(m.html).toContain('Architectural shingles')
    expect(m.html).toContain('PO-7781')
    expect(m.text).toContain('90 bundle  Architectural shingles')
    expect(m.replyTo).toBe('mgr@test.example')
    expect(m.attachments.length).toBe(1)
    expect(m.attachments[0].filename).toBe('material-order-PO-7781.pdf')
    expect(m.attachments[0].contentType).toBe('application/pdf')
    const pdf = pdfText(m.attachments[0].content)
    expect(pdf).toContain('PO-7781')
    expect(pdf).toContain('Architectural shingles')
    const row = await stored(id)
    expect(row.orderStatus).toBe('sent')
    expect(row.sendLog.length).toBe(1)
    expect(row.sendLog[0]).toMatchObject({ to: ['orders@abcsupply.example', 'desk@abcsupply.example'], cc: ['office@test-builders.example'], subject: 'Order for Gable Ln', byUserId: ids.mgr, attachment: 'material-order-PO-7781.pdf' })
  })

  test('with no subject or message it writes them; prices are never in the mail, whoever sends', async () => {
    const id = await order(await makeJob('9 Hip Rd'))
    const r = await send(id, { to: 'orders@abcsupply.example' }, 'owner')
    expect(r.status).toBe(200)
    expect(mails[0].subject).toContain('PO-7781')
    expect(mails[0].subject).toContain('Test Builders')
    expect(mails[0].html).toContain('Please find our material order below')
    expect(mails[0].html).not.toContain('41.50')
    expect(mails[0].text).not.toContain('3,735')
    expect(pdfText(mails[0].attachments[0].content)).not.toContain('3,735')
  })

  test('what the people typed is escaped in the mail', async () => {
    const id = await order(await makeJob('3 Eave St'), { notes: '<script>alert(1)</script>' })
    await send(id, { to: 'orders@abcsupply.example', message: '<b>hi</b>' })
    expect(mails[0].html).not.toContain('<script>')
    expect(mails[0].html).not.toContain('<b>hi</b>')
    expect(mails[0].html).toContain('&lt;b&gt;hi&lt;/b&gt;')
  })

  test('a bad or missing address is refused with the box named, and nothing is sent', async () => {
    const id = await order(await makeJob('4 Rake Ave'))
    const none = await send(id, { to: '' })
    expect(none.status).toBe(400)
    expect(none.body.fields.to).toContain('email address')
    const bad = await send(id, { to: 'orders@abc.com, nobody' })
    expect(bad.status).toBe(400)
    expect(bad.body.fields.to).toContain('nobody')
    const badCc = await send(id, { to: 'orders@abc.com', cc: 'x' })
    expect(badCc.body.fields.cc).toContain('x')
    expect(mails.length).toBe(0)
    expect((await stored(id)).orderStatus).toBe('not_ordered')
  })

  test('if the mail did not go, the order is not marked Sent — no provider, or the provider fails', async () => {
    const id = await order(await makeJob('5 Valley Dr'))
    behave = 'dev'
    const dev = await send(id, { to: 'orders@abc.com' })
    expect(dev.status).toBe(503)
    expect(dev.body.code).toBe('email_not_configured')
    behave = 'throw'
    const down = await send(id, { to: 'orders@abc.com' })
    expect(down.status).toBe(502)
    expect(down.body.code).toBe('send_failed')
    const row = await stored(id)
    expect(row.orderStatus).toBe('not_ordered')
    expect(row.sendLog ?? []).toEqual([])
    expect(row.orderDate).toBeNull()
  })

  test('only orders that can still go are sent: a rejected one again, a sent one as a reminder; not an ordered, delivered or cancelled one, or an empty one', async () => {
    const job = await makeJob('6 Ridge Ct')
    const rejected = await order(job, { orderStatus: 'rejected' })
    expect((await send(rejected, { to: 'orders@abc.com' })).status).toBe(200)
    const again = await send(rejected, { to: 'orders@abc.com', message: 'Corrected quantities.' })
    expect(again.status).toBe(200)
    expect(again.body.orderStatus).toBe('sent')
    expect((await stored(rejected)).sendLog.length).toBe(2)
    for (const s of ['ordered', 'delivered', 'cancelled']) {
      const o = await order(job, { orderStatus: s })
      const r = await send(o, { to: 'orders@abc.com' })
      expect(r.status).toBe(409)
      expect(r.body.code).toBe('order_not_sendable')
    }
    const empty = await order(job)
    await t.db.update(t.schema.material).set({ lineItems: [] } as any).where(eq(t.schema.material.id, empty))
    const r = await send(empty, { to: 'orders@abc.com' })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('order_empty')
    expect(mails.length).toBe(2)
  })

  test('the first send sets the order date; a reminder does not move it', async () => {
    const id = await order(await makeJob('7 Soffit Way'))
    const first = await send(id, { to: 'orders@abc.com' })
    const again = await send(id, { to: 'orders@abc.com' })
    expect(again.body.orderDate).toBe(first.body.orderDate)
  })

  test('an order dated by hand keeps its date', async () => {
    const id = await order(await makeJob('8 Fascia Pl'), { orderDate: '2026-10-01' })
    const r = await send(id, { to: 'orders@abc.com' })
    expect(new Date(r.body.orderDate).toISOString().slice(0, 10)).toBe('2026-10-01')
  })

  test('the send box starts with the recipients last used for that supplier, and a subject and message', async () => {
    const job = await makeJob('10 Dormer Ln')
    const first = await order(job, { supplier: 'abc_supply' })
    await send(first, { to: 'orders@abcsupply.example', cc: 'cc@test-builders.example' })
    const next = await order(job, { supplier: 'ABC' })
    const start = await call('mgr', 'GET', `/api/material-supply/orders/${next}/send`)
    expect(start.status).toBe(200)
    expect(start.body.to).toEqual(['orders@abcsupply.example'])
    expect(start.body.cc).toEqual(['cc@test-builders.example'])
    expect(start.body.subject).toContain('PO-7781')
    expect(start.body.message).toContain('material order')
    expect(start.body.sendable).toBe(true)
    expect(start.body.statusLabel).toBe('Draft')
    const other = await order(job, { supplier: 'SRS' })
    expect((await call('mgr', 'GET', `/api/material-supply/orders/${other}/send`)).body.to).toEqual([])
  })

  test('who may send: a seat that cannot update inventory cannot; another business’s order is not found; the feature must be on', async () => {
    const id = await order(await makeJob('11 Chimney Rd'))
    expect((await send(id, { to: 'orders@abc.com' }, 'rep')).status).toBe(403)
    expect(mails.length).toBe(0)
    const otherCo = await ins(t.schema.company, { name: 'Other Roofing', slug: 'other-roofing', enabledFeatures: FEATURES } as any)
    const theirs = await ins(t.schema.material, { companyId: otherCo.id, jobId: await makeJob('99 Elsewhere'), supplier: 'ABC Supply', orderStatus: 'not_ordered', lineItems: [{ description: 'x', qty: 1, unit: 'ea' }] } as any)
    expect((await send(theirs.id, { to: 'orders@abc.com' })).status).toBe(404)
    await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES.filter((f) => f !== 'material_supply') } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    expect((await send(id, { to: 'orders@abc.com' })).status).toBe(403)
    await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    expect(mails.length).toBe(0)
  })
})

describe('sending several at once', () => {
  test('one email each, to the same people, each with its own PDF; every order becomes Sent', async () => {
    const a = await order(await makeJob('21 A St'), { poNumber: 'PO-A' })
    const b = await order(await makeJob('22 B St'), { poNumber: 'PO-B', supplier: 'abc supply' })
    const r = await call('mgr', 'POST', '/api/material-supply/orders/send', { orderIds: [a, b], to: 'orders@abc.com', message: 'Two for Friday.' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ sent: 2, failed: 0 })
    expect(mails.length).toBe(2)
    expect(mails.map((m) => m.attachments[0].filename).sort()).toEqual(['material-order-PO-A.pdf', 'material-order-PO-B.pdf'])
    expect(mails.every((m) => m.html.includes('Two for Friday.') && m.to === 'orders@abc.com')).toBe(true)
    expect((await stored(a)).orderStatus).toBe('sent')
    expect((await stored(b)).orderStatus).toBe('sent')
  })

  test('one that cannot go is named and does not stop the rest; orders of different suppliers are refused whole', async () => {
    const job = await makeJob('23 C St')
    const good = await order(job, { poNumber: 'PO-G' })
    const done = await order(job, { orderStatus: 'delivered', poNumber: 'PO-D' })
    const r = await call('mgr', 'POST', '/api/material-supply/orders/send', { orderIds: [good, done], to: 'orders@abc.com' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ sent: 1, failed: 1 })
    expect(r.body.results.find((x: any) => x.id === done)).toMatchObject({ sent: false, code: 'order_not_sendable' })
    const srs = await order(job, { supplier: 'SRS' })
    const mixed = await call('mgr', 'POST', '/api/material-supply/orders/send', { orderIds: [await order(job), srs], to: 'orders@abc.com' })
    expect(mixed.status).toBe(409)
    expect(mixed.body.code).toBe('mixed_suppliers')
    expect(mails.length).toBe(1)
  })

  test('the list must be there, within the limit, and the orders must be this business’s', async () => {
    expect((await call('mgr', 'POST', '/api/material-supply/orders/send', { orderIds: [], to: 'orders@abc.com' })).status).toBe(400)
    expect((await call('mgr', 'POST', '/api/material-supply/orders/send', { orderIds: Array.from({ length: 26 }, (_, i) => `o${i}`), to: 'orders@abc.com' })).status).toBe(400)
    expect((await call('mgr', 'POST', '/api/material-supply/orders/send', { orderIds: ['nope'], to: 'orders@abc.com' })).status).toBe(404)
    expect((await call('mgr', 'POST', '/api/material-supply/orders/send', { orderIds: ['x'], to: 'bad' })).status).toBe(400)
    expect(mails.length).toBe(0)
  })
})

describe('the shared sender', () => {
  test('sendRaw hands the provider the copy, the plain text, the reply address and the attached file — and the sender’s reply address beats the business default', async () => {
    const sentToProvider: any[] = []
    const real = nodemailer.createTransport
    const prior = { smtp: process.env.SMTP_HOST, reply: process.env.REPLY_TO_EMAIL }
    ;(nodemailer as any).createTransport = () => ({ sendMail: async (m: any) => { sentToProvider.push(m); return { messageId: '<x@test>' } } })
    process.env.SMTP_HOST = 'smtp.test.invalid'
    process.env.REPLY_TO_EMAIL = 'default-reply@test.example'
    try {
      const quiet: any = { info() {}, warn() {}, error() {}, debug() {} }
      const svc = createEmailService({ db: t.db, logger: quiet })
      const file = Buffer.from('%PDF-fake')
      const r = await svc.sendRaw({ to: 'a@x.com', cc: 'b@x.com', subject: 'S', html: '<p>h</p>', text: 'h', replyTo: 'me@x.com', attachments: [{ filename: 'o.pdf', content: file, contentType: 'application/pdf' }] })
      expect(r).toEqual({ success: true, messageId: '<x@test>' })
      expect(sentToProvider[0]).toMatchObject({ to: 'a@x.com', cc: 'b@x.com', subject: 'S', text: 'h', replyTo: 'me@x.com' })
      expect(sentToProvider[0].attachments[0].filename).toBe('o.pdf')
      await svc.sendRaw({ to: 'a@x.com', subject: 'S2', html: '<p>h</p>' })
      expect(sentToProvider[1].replyTo).toBe('default-reply@test.example')
      expect('cc' in sentToProvider[1] || 'attachments' in sentToProvider[1]).toBe(false)
    } finally {
      ;(nodemailer as any).createTransport = real
      if (prior.smtp === undefined) delete process.env.SMTP_HOST; else process.env.SMTP_HOST = prior.smtp
      if (prior.reply === undefined) delete process.env.REPLY_TO_EMAIL; else process.env.REPLY_TO_EMAIL = prior.reply
    }
  })
})
