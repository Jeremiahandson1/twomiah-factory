// A roofing job is Signed when its proposal is (roofing live test 11/07): Hank signed Better for $9,500 from the quote's own link and
// ROOF-0001 stayed at Inspection Scheduled — Reports said 0 signed and a 0% close rate until someone pressed Advance. Now every door
// that approves a quote (crm/roof/signed.ts, run from server/modules/crm.ts afterApproval) moves a job still being sold to Signed, with
// a note; a job already further on is never moved back. Through the real server as the roofing vertical; nothing reaches a real tenant.
import { test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', token = '', contactId = ''
const sent: Array<{ template: string; data: any }> = []
const SIGN = { signature: 'data:image/png;base64,iVBORw0KGgo=', signedBy: 'Hank Homeowner', consent: true }
const as = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const OPTIONS = [
  { name: 'Good', tier: 'good', lines: [{ description: '3-tab shingles', quantity: 1, unitPrice: 8500 }] },
  { name: 'Better', tier: 'better', lines: [{ description: 'Architectural shingles', quantity: 1, unitPrice: 9500 }] },
]

beforeAll(async () => {
  process.env.FRONTEND_URL ||= 'https://app.roofer.example'
  t = await bootTenant({ vertical: 'roofing' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ email: 'office@roofer.example', enabledFeatures: ['jobs', 'contacts', 'quotes', 'invoices', 'quote_proposals'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json() as any).accessToken
  const email: any = t.services.email
  const real = email.send.bind(email)
  email.send = async (to: string, template: string, data: any, o?: any) => { sent.push({ template, data }); return real(to, template, data, o) }
  ;(t.services as any).crm.sms.sendSMS = async () => ({ success: true })
  contactId = ((await t.db.insert(t.schema.contact).values({ companyId, name: 'Hank Homeowner', email: 'hank@home.example', type: 'client' } as any).returning()) as any[])[0].id
}, 120_000)

async function jobWithProposal(status: string) {
  const job = await json(await as('/api/jobs', { method: 'POST', json: { contactId, jobType: 'retail', propertyAddress: `${100 + Math.floor(Math.random() * 800)} Main St`, city: 'Eau Claire', state: 'WI', zip: '54701' } }))
  expect(job.status).toBe(201)
  await t.db.update(t.schema.job).set({ status } as any).where(eq(t.schema.job.id, job.body.id))
  const q = await json(await as('/api/quotes', { method: 'POST', json: { contactId, jobId: job.body.id, name: 'Roof replacement', taxRate: 0, lineItems: [{ description: 'Tear-off', quantity: 1, unitPrice: 0 }] } }))
  expect((await as(`/api/quotes/${q.body.id}/proposal`, { method: 'PUT', json: { options: OPTIONS } })).status).toBe(200)
  expect((await as(`/api/quotes/${q.body.id}/send`, { method: 'POST' })).status).toBe(200)
  const link = String(sent.filter((m) => m.template === 'quoteSent').at(-1)!.data.documentPath).replace('/d/', '')
  const read = await json(await as(`/api/quotes/${q.body.id}`))
  const better = read.body.proposal.options.find((o: any) => o.name === 'Better').id
  expect((await t.call(`/api/portal/d/${link}/quotes/${q.body.id}/choose-option`, { method: 'POST', json: { optionId: better } })).status).toBe(200)
  return { jobId: job.body.id as string, quoteId: q.body.id as string, link }
}
const statusOf = async (id: string) => ((await t.db.select({ s: t.schema.job.status }).from(t.schema.job).where(eq(t.schema.job.id, id))) as any[])[0].s

test('the homeowner signs from the link: a job still being sold is Signed, with a note saying why', async () => {
  const { jobId, quoteId, link } = await jobWithProposal('inspection_scheduled')
  const signed = await json(await t.call(`/api/portal/d/${link}/quotes/${quoteId}/approve`, { method: 'POST', json: SIGN }))
  expect(signed.status).toBe(200)
  expect(await statusOf(jobId)).toBe('signed')
  const notes = (await t.db.select({ body: t.schema.jobNote.body }).from(t.schema.jobNote).where(and(eq(t.schema.jobNote.jobId, jobId), eq(t.schema.jobNote.companyId, companyId)))) as any[]
  expect(notes.some((n) => /moved to Signed automatically/.test(n.body))).toBe(true)
}, 60_000)

test('a job already past Signed is never moved back', async () => {
  const { jobId, quoteId, link } = await jobWithProposal('in_production')
  expect((await t.call(`/api/portal/d/${link}/quotes/${quoteId}/approve`, { method: 'POST', json: SIGN })).status).toBe(200)
  expect(await statusOf(jobId)).toBe('in_production')
}, 60_000)
