// Roofing parity row 17 — text an invoice now or on a schedule, and payment receipts (JobNimbus, Leap; data/invoiceRequests.ts,
// crm/roof/invoiceRequests.ts; invoice_text_requests, not ready). Fails without the change: none of it existed.
//   · Text this invoice: the invoice's own link, queued through the scheduled texts (tagged with the invoice), in the 8–20 window;
//     a schedule makes the repeats; a draft, an opted-out customer, a customer with no phone are refused in plain words;
//   · paid in full: the texts not sent yet are cancelled;
//   · every payment is emailed its receipt to the homeowner and the job's sales rep, once;
//   · off: the routes are shut and nothing happens on payment.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY } from '../../../packages/tenant-backend/src/featureRegistry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let owner = ''
let homeId = ''
let repId = ''
const mails: any[] = []
const saved: Record<string, string | undefined> = {}
const setEnv = (k: string, v: string) => { if (!(k in saved)) saved[k] = process.env[k]; process.env[k] = v }
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const auth = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const BASE = ['jobs', 'contacts', 'invoices', 'two_way_texting']
const setFeatures = async (extra: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: [...BASE, ...extra] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
}
const textsFor = (invoiceId: string) => t.db.select().from(t.schema.scheduledText).where(eq(t.schema.scheduledText.invoiceId, invoiceId))

beforeAll(async () => {
  setEnv('FRONTEND_URL', 'https://app.roofer.example')
  t = await bootTenant({ vertical: 'roofing' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await setFeatures(['invoice_text_requests'])
  owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  ;(t.services.crm.emailService as any).sendRaw = async (m: any) => { mails.push(m); return { success: true } }
  homeId = ((await t.db.insert(t.schema.contact).values({ companyId, name: 'Lee Marsh', email: 'lee@home.example', mobile: '715-555-0101', type: 'client' } as any).returning()) as any[])[0].id
  repId = ((await t.db.insert(t.schema.user).values({ companyId, email: 'rep@roofer.example', firstName: 'Rae', lastName: 'Rep', role: 'manager', passwordHash: 'x' } as any).returning()) as any[])[0].id
}, 120_000)
afterAll(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } })

async function invoiceFor(contactId: string, status = 'sent', price = 6000) {
  const job = ((await t.db.insert(t.schema.job).values({ companyId, number: `J-${Math.random().toString(36).slice(2, 7)}`, title: 'Roof', contactId, assignedSalesRepId: repId, status: 'invoiced' } as any).returning()) as any[])[0]
  const inv = await json(await auth('/api/invoices', { method: 'POST', json: { contactId, jobId: job.id, lineItems: [{ description: 'Roof', quantity: 1, unitPrice: price }] } }))
  expect(inv.status).toBe(201)
  await t.db.update(t.schema.invoice).set({ status } as any).where(eq(t.schema.invoice.id, inv.body.id))
  return inv.body.id as string
}
const pay = (invoiceId: string, amount: number) => auth(`/api/invoices/${invoiceId}/payments`, { method: 'POST', json: { amount, method: 'check', reference: 'chk 1042' } })
const settled = async (fn: () => Promise<boolean>) => { for (let i = 0; i < 40; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 50)) } return false }

describe('row 17: text this invoice', () => {
  test('now: the invoice’s own link, tagged with the invoice; a schedule makes the repeats', async () => {
    const id = await invoiceFor(homeId)
    const now = await json(await auth(`/api/invoice-requests/${id}`, { method: 'POST', json: {} }))
    expect(now.status).toBe(201)
    const [first] = await textsFor(id)
    expect(first.body).toMatch(/^Hi Lee, invoice \S+ from .* is ready\. View and pay it at https:\/\/app\.roofer\.example\/d\/[0-9a-f]{64}$/)
    expect(first.toPhone).toBe('715-555-0101')
    const sched = await json(await auth(`/api/invoice-requests/${id}`, { method: 'POST', json: { at: new Date(Date.now() + 2 * 86_400_000).toISOString(), everyDays: 3, times: 3 } }))
    expect(sched.body.texts.length).toBe(3)
    const all = (await textsFor(id)).sort((a: any, b: any) => +a.sendAt - +b.sendAt)
    expect(all.length).toBe(4)
    expect(all.slice(2).every((x: any) => /a reminder/.test(x.body))).toBe(true)
    const gap = (+all[2].sendAt - +all[1].sendAt) / 86_400_000
    expect(gap).toBeGreaterThan(2.5)
    const list = await json(await auth(`/api/invoice-requests/${id}`))
    expect(list.body.data.length).toBe(4)
    // One cancelled by hand.
    expect((await auth(`/api/invoice-requests/texts/${all[3].id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await auth(`/api/invoice-requests/texts/${all[3].id}`, { method: 'DELETE' })).status).toBe(404)
  })

  test('refused in plain words: a draft, a customer who opted out, one with no phone; bad schedules', async () => {
    const draft = await invoiceFor(homeId, 'draft')
    expect((await json(await auth(`/api/invoice-requests/${draft}`, { method: 'POST', json: {} }))).body.error).toMatch(/Send the invoice first/)
    const out = ((await t.db.insert(t.schema.contact).values({ companyId, name: 'No Texts', mobile: '715-555-0102', optedOutSms: true, type: 'client' } as any).returning()) as any[])[0]
    expect((await json(await auth(`/api/invoice-requests/${await invoiceFor(out.id)}`, { method: 'POST', json: {} }))).body.error).toMatch(/asked not to be texted/)
    const nophone = ((await t.db.insert(t.schema.contact).values({ companyId, name: 'No Phone', type: 'client' } as any).returning()) as any[])[0]
    expect((await json(await auth(`/api/invoice-requests/${await invoiceFor(nophone.id)}`, { method: 'POST', json: {} }))).body.error).toMatch(/no phone/)
    const id = await invoiceFor(homeId)
    expect((await auth(`/api/invoice-requests/${id}`, { method: 'POST', json: { everyDays: 0 } })).status).toBe(400)
    expect((await auth(`/api/invoice-requests/${id}`, { method: 'POST', json: { everyDays: 2, times: 9 } })).status).toBe(400)
  })
})

describe('row 17: paid — texts stop, receipts go', () => {
  test('a part payment gets its receipt (homeowner and rep) and leaves the texts; paid in full cancels them; each receipt once', async () => {
    const id = await invoiceFor(homeId)
    await auth(`/api/invoice-requests/${id}`, { method: 'POST', json: { at: new Date(Date.now() + 86_400_000).toISOString(), everyDays: 2, times: 3 } })
    mails.length = 0
    expect((await pay(id, 2000)).status).toBeLessThan(300)
    expect(await settled(async () => mails.length >= 2)).toBe(true)
    expect(mails.map((m) => m.to).sort()).toEqual(['lee@home.example', 'rep@roofer.example'])
    expect(mails[0].subject).toMatch(/Receipt: \$2,000\.00 paid on invoice/)
    expect(mails[0].html).toContain('by cheque')
    expect(mails[0].html).toContain('Still owed on this invoice: <b>$4,000.00</b>')
    expect((await textsFor(id)).filter((x: any) => x.status === 'scheduled').length).toBe(3)
    mails.length = 0
    expect((await pay(id, 4000)).status).toBeLessThan(300)
    expect(await settled(async () => (await textsFor(id)).every((x: any) => x.status === 'cancelled'))).toBe(true)
    expect(await settled(async () => mails.length >= 2)).toBe(true)
    expect(mails.length).toBe(2) // the new payment only; the first was receipted already
    expect(mails[0].html).toContain('paid in full')
    const rows = await t.db.select().from(t.schema.payment).where(and(eq(t.schema.payment.invoiceId, id)))
    expect(rows.every((p: any) => p.receiptSentAt)).toBe(true)
  })

  test('off: the routes are shut and a payment sends no receipt; the switch is hidden and roofing’s', async () => {
    await setFeatures([])
    try {
      const id = await invoiceFor(homeId)
      expect((await auth(`/api/invoice-requests/${id}`)).status).toBe(404)
      mails.length = 0
      await pay(id, 100)
      await new Promise((r) => setTimeout(r, 400))
      expect(mails.length).toBe(0)
    } finally { await setFeatures(['invoice_text_requests']) }
    const f = FEATURE_REGISTRY.find((x: any) => x.id === 'invoice_text_requests') as any
    expect([f?.hidden, f?.templates]).toEqual([true, ['crm-roof']])
  })
})
