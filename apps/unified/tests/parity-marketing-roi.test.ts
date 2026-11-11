// Parity tier 3 (11/10, field service): marketing ROI — ServiceTitan's marketing ROI scorecard. Through the real server as field
// service:
//   · per lead source: leads in the period, the customers they became, those customers' jobs and payments in the period;
//   · spend per source per month (the shared spend ledger): cost per lead and money back per dollar; 0 takes spend away;
//   · tracking numbers are sources (ServiceTitan's campaign numbers): their calls count, a first-time caller is that source's lead
//     (the inbox's phone lead moved to it; with no inbox lead, the contact the call made, a customer once they have a job);
//   · the heat map: the period's customers by ZIP, placed at their points (else their jobs'), every source or one;
//   · a seat without invoices:read sees the counts, not the money; switched off, closed.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', owner = ''
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const ins = async (table: any, values: any) => ((await (t.db as any).insert(table).values(values).returning()) as any[])[0]
const at = (s: string) => new Date(s)

beforeAll(async () => {
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ timezone: 'America/Chicago', enabledFeatures: ['jobs', 'contacts', 'invoices', 'lead_inbox', 'reports', 'marketing_roi'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
  const ann = await ins(t.schema.contact, { companyId, name: 'Ann', type: 'client' })
  await ins(t.schema.lead, { companyId, sourcePlatform: 'google_ads', homeownerName: 'Ann', status: 'converted', convertedContactId: ann.id, receivedAt: at('2026-10-05T15:00:00Z') })
  await ins(t.schema.lead, { companyId, sourcePlatform: 'google_ads', homeownerName: 'Bo', status: 'new', receivedAt: at('2026-10-06T15:00:00Z') })
  await ins(t.schema.lead, { companyId, sourcePlatform: 'yelp', homeownerName: 'Cy', status: 'new', receivedAt: at('2026-10-07T15:00:00Z') })
  await ins(t.schema.job, { companyId, number: 'JOB-1', title: 'Furnace', contactId: ann.id, createdAt: at('2026-10-10T15:00:00Z') })
  const inv = await ins(t.schema.invoice, { companyId, number: 'INV-1', contactId: ann.id, status: 'paid', subtotal: '1200', total: '1200', amountPaid: '1200' })
  await ins(t.schema.payment, { invoiceId: inv.id, amount: '1200', method: 'card', paidAt: at('2026-10-20T15:00:00Z') })
}, 120_000)

test('spend per source per month; 0 takes it away', async () => {
  expect((await json(await call('/api/marketing-roi/spend', { method: 'PUT', json: { source: 'google_ads', month: '2026-10', amountCents: 40000 } }))).status).toBe(200)
  await call('/api/marketing-roi/spend', { method: 'PUT', json: { source: 'yelp', month: '2026-10', amountCents: 5000 } })
  await call('/api/marketing-roi/spend', { method: 'PUT', json: { source: 'yelp', month: '2026-10', amountCents: 0 } })
  const list = await json(await call('/api/marketing-roi/spend?from=2026-10&to=2026-10'))
  expect(list.body.data.map((r: any) => [r.source, r.amountCents])).toEqual([['google_ads', 40000]])
})

test('per source: leads, customers, jobs, paid; cost per lead and back per dollar', async () => {
  const r = await json(await call('/api/marketing-roi?from=2026-10-01&to=2026-10-31'))
  expect(r.status).toBe(200)
  const g = r.body.rows.find((x: any) => x.source === 'google_ads')
  expect(g).toMatchObject({ label: 'Google ads', leads: 2, customers: 1, jobs: 1, revenue: 1200, spend: 400, costPerLead: 200, returnPerDollar: 3 })
  expect(r.body.rows.find((x: any) => x.source === 'yelp')).toMatchObject({ leads: 1, customers: 0, revenue: 0, spend: 0, returnPerDollar: null })
})

test('tracking numbers are sources: calls count, a first-time caller is its lead and customer', async () => {
  const ads = await ins(t.schema.trackingNumber, { companyId, phoneNumber: '+16085550100', source: 'Google Ads' })
  const mailer = await ins(t.schema.trackingNumber, { companyId, phoneNumber: '+16085550200', source: 'Mailer' })
  // Dee called the ads number for the first time; the inbox made a phone lead, converted, with a job and a payment.
  const dee = await ins(t.schema.contact, { companyId, name: 'Dee', type: 'client', phone: '(608) 555-0150', zip: '53704' })
  await ins(t.schema.callLog, { companyId, trackingNumberId: ads.id, callerNumber: '+16085550150', direction: 'inbound', firstTimeCaller: true, createdAt: at('2026-10-08T15:00:00Z') })
  await ins(t.schema.lead, { companyId, sourcePlatform: 'phone', homeownerName: 'Dee', phone: '608-555-0150', status: 'converted', convertedContactId: dee.id, receivedAt: at('2026-10-08T15:01:00Z') })
  await ins(t.schema.job, { companyId, number: 'JOB-2', title: 'AC', contactId: dee.id, zip: '53704', lat: 43.1, lng: -89.35, createdAt: at('2026-10-12T15:00:00Z') })
  const inv = await ins(t.schema.invoice, { companyId, number: 'INV-2', contactId: dee.id, status: 'paid', subtotal: '300', total: '300', amountPaid: '300' })
  await ins(t.schema.payment, { invoiceId: inv.id, amount: '300', method: 'card', paidAt: at('2026-10-21T15:00:00Z') })
  // A repeat caller on the ads number: a call, not a lead.
  await ins(t.schema.callLog, { companyId, trackingNumberId: ads.id, callerNumber: '+16085550150', direction: 'inbound', firstTimeCaller: false, createdAt: at('2026-10-09T15:00:00Z') })
  // Eve called the mailer number with the inbox off: the call made her contact; she booked a job.
  const eve = await ins(t.schema.contact, { companyId, name: 'Eve', type: 'client', phone: '+16085550160', source: 'Mailer', zip: '53705', lat: 43.07, lng: -89.45 })
  await ins(t.schema.callLog, { companyId, trackingNumberId: mailer.id, callerNumber: '+16085550160', direction: 'inbound', firstTimeCaller: true, createdAt: at('2026-10-14T15:00:00Z') })
  await ins(t.schema.job, { companyId, number: 'JOB-3', title: 'Leak', contactId: eve.id, createdAt: at('2026-10-15T15:00:00Z') })
  // An outgoing call counts nowhere.
  await ins(t.schema.callLog, { companyId, trackingNumberId: mailer.id, callerNumber: '+16085550199', direction: 'outbound', firstTimeCaller: true, createdAt: at('2026-10-14T16:00:00Z') })

  const r = await json(await call('/api/marketing-roi?from=2026-10-01&to=2026-10-31'))
  expect(r.body.rows.find((x: any) => x.source === 'google_ads')).toMatchObject({ calls: 2, leads: 3, customers: 2, jobs: 2, revenue: 1500 })
  expect(r.body.rows.find((x: any) => x.source === 'mailer')).toMatchObject({ calls: 1, leads: 1, customers: 1, jobs: 1, revenue: 0 })
  expect(r.body.rows.find((x: any) => x.source === 'phone')).toBeUndefined()
})

test('the heat map: customers by ZIP, placed at their points or their jobs, every source or one', async () => {
  await t.db.update(t.schema.contact).set({ zip: '53703', lat: 43.07, lng: -89.38 } as any).where(eq(t.schema.contact.name, 'Ann'))
  const all = await json(await call('/api/marketing-roi/map?from=2026-10-01&to=2026-10-31'))
  expect(all.status).toBe(200)
  const by = Object.fromEntries(all.body.zips.map((z: any) => [z.zip, z]))
  expect(by['53703']).toMatchObject({ customers: 1, jobs: 1, revenue: 1200, lat: 43.07, lng: -89.38 })
  expect(by['53704']).toMatchObject({ customers: 1, jobs: 1, revenue: 300, lat: 43.1, lng: -89.35 }) // placed by her job
  expect(by['53705']).toMatchObject({ customers: 1, jobs: 1, revenue: 0 })
  expect(all.body.zips[0].zip).toBe('53703')
  const mailer = await json(await call('/api/marketing-roi/map?from=2026-10-01&to=2026-10-31&source=mailer'))
  expect(mailer.body.zips.map((z: any) => z.zip)).toEqual(['53705'])
  expect((await json(await call('/api/marketing-roi/map?from=2026-10-01&to=2026-10-31&source=yelp'))).body.zips).toEqual([])
})

test('switched off: closed', async () => {
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'invoices'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  expect([403, 404]).toContain((await call('/api/marketing-roi?from=2026-10-01&to=2026-10-31')).status)
})
