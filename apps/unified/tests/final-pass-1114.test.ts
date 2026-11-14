// The contractor final live pass (11/14), each finding as it should now be:
//   · B6 "two tabs editing the same quote or job: the second save silently overwrites the first" — an edit form sends the
//     updatedAt it opened the record with; a save by someone else since then is refused with 409 and a sentence;
//   · a save that sends no time (a schedule drag, a status box) saves as before;
//   · "Create similar drops the Good / Better / Best options" — the copy takes them, as a template does;
//   · "the set-password page never says whose account it is for" — a live link names its account; any other is refused alike.
// Through the real server as the contractor vertical; nothing reaches a real tenant.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { storedResetToken } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'
import { proposalFromQuote } from '../../../packages/tenant-ui/src/invoicing/quoteLines.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', token = '', contactId = ''
const as = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'quotes', 'invoices', 'quote_proposals'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json() as any).accessToken
  contactId = ((await t.db.insert(t.schema.contact).values({ companyId, name: 'Hank Homeowner', email: 'hank@home.example', type: 'client' } as any).returning()) as any[])[0].id
}, 120_000)

test('B6: two tabs on one quote — the second save is refused, not silently overwriting the first', async () => {
  const q = await json(await as('/api/quotes', { method: 'POST', json: { contactId, name: 'Kitchen', taxRate: 0, lineItems: [{ description: 'Cabinets', quantity: 1, unitPrice: 100 }, { description: 'Counters', quantity: 1, unitPrice: 200 }] } }))
  expect(q.status).toBe(201)
  // Both tabs open the quote from the list, as the Quotes page does.
  const list = await json(await as('/api/quotes'))
  const opened = list.body.data.find((r: any) => r.id === q.body.id)
  expect(typeof opened.updatedAt).toBe('string')
  const tab1 = await json(await as(`/api/quotes/${q.body.id}`, { method: 'PUT', json: { name: 'Kitchen', lineItems: [{ description: 'Cabinets', quantity: 1, unitPrice: 150 }, { description: 'Counters', quantity: 1, unitPrice: 200 }], expectedUpdatedAt: opened.updatedAt } }))
  expect(tab1.status).toBe(200)
  const tab2 = await json(await as(`/api/quotes/${q.body.id}`, { method: 'PUT', json: { name: 'Kitchen', lineItems: [{ description: 'Cabinets', quantity: 1, unitPrice: 100 }, { description: 'Counters', quantity: 1, unitPrice: 250 }], expectedUpdatedAt: opened.updatedAt } }))
  expect(tab2.status).toBe(409)
  expect(tab2.body.code).toBe('changed_since_opened')
  expect(tab2.body.error).toContain('after you opened it')
  // Tab 1's change is the one kept.
  const read = await json(await as(`/api/quotes/${q.body.id}`))
  expect(read.body.lineItems.map((l: any) => Number(l.unitPrice))).toEqual([150, 200])
  // Reloaded, tab 2 saves.
  const again = await json(await as(`/api/quotes/${q.body.id}`, { method: 'PUT', json: { name: 'Kitchen', lineItems: [{ description: 'Cabinets', quantity: 1, unitPrice: 150 }, { description: 'Counters', quantity: 1, unitPrice: 250 }], expectedUpdatedAt: read.body.updatedAt } }))
  expect(again.status).toBe(200)
  // A save that says nothing about when it opened the quote saves as before.
  expect((await as(`/api/quotes/${q.body.id}`, { method: 'PUT', json: { notes: 'call first' } })).status).toBe(200)
}, 60_000)

test('B6: two tabs on one job — the second save is refused; a drag that sends no time still moves it', async () => {
  const j = await json(await as('/api/jobs', { method: 'POST', json: { title: 'Frame the addition', contactId, scheduledDate: '2028-03-01' } }))
  expect(j.status).toBe(201)
  const list = await json(await as('/api/jobs'))
  const opened = list.body.data.find((r: any) => r.id === j.body.id)
  expect(typeof opened.updatedAt).toBe('string')
  const tab1 = await as(`/api/jobs/${j.body.id}`, { method: 'PUT', json: { ...opened, scheduledDate: '2028-03-02', expectedUpdatedAt: opened.updatedAt } })
  expect(tab1.status).toBe(200)
  const tab2 = await json(await as(`/api/jobs/${j.body.id}`, { method: 'PUT', json: { ...opened, notes: 'gate code 1234', expectedUpdatedAt: opened.updatedAt } }))
  expect(tab2.status).toBe(409)
  expect(tab2.body.code).toBe('changed_since_opened')
  const read = await json(await as(`/api/jobs/${j.body.id}`))
  expect(String(read.body.scheduledDate).slice(0, 10)).toBe('2028-03-02')
  expect(read.body.notes ?? null).not.toBe('gate code 1234')
  // The schedule's drag sends only the new day.
  expect((await as(`/api/jobs/${j.body.id}`, { method: 'PUT', json: { scheduledDate: '2028-03-03' } })).status).toBe(200)
}, 60_000)

test('Create similar: the copy takes the Good / Better / Best options (brands, warranties, upgrades, discount), not the pick', async () => {
  const q = await json(await as('/api/quotes', { method: 'POST', json: { contactId, name: 'Bath', taxRate: 0, lineItems: [{ description: 'Demo', quantity: 1, unitPrice: 500 }] } }))
  const options = [
    { name: 'Good', tier: 'good', brand: 'Delta', warranty: '1 year', lines: [{ description: 'Stock vanity', quantity: 1, unitPrice: 1000 }] },
    { name: 'Better', tier: 'better', recommended: true, brand: 'Kohler', warranty: '5 years', lines: [{ description: 'Semi-custom vanity', quantity: 1, unitPrice: 2000 }], upgrades: [{ description: 'Heated floor', quantity: 1, unitPrice: 800 }] },
    { name: 'Best', tier: 'best', brand: 'Moen', warranty: 'Lifetime', lines: [{ description: 'Custom vanity', quantity: 2, unitPrice: 1500 }], discount: { type: 'percent', percent: 5 } },
  ]
  expect((await as(`/api/quotes/${q.body.id}/proposal`, { method: 'PUT', json: { options } })).status).toBe(200)
  // What the Quotes page does: read the quote, fill the form, save it, then put the options on the new one.
  const item = (await json(await as(`/api/quotes/${q.body.id}`))).body
  const proposal = proposalFromQuote(item.proposal)
  expect(proposal).not.toBeNull()
  const copy = await json(await as('/api/quotes', { method: 'POST', json: { contactId, name: 'Bath (copy)', taxRate: 0, lineItems: [{ description: 'Demo', quantity: 1, unitPrice: 500 }] } }))
  const put = await json(await as(`/api/quotes/${copy.body.id}/proposal`, { method: 'PUT', json: proposal }))
  expect(put.status).toBe(200)
  const read = (await json(await as(`/api/quotes/${copy.body.id}`))).body.proposal
  expect(read.options.map((o: any) => [o.name, o.brand, o.warranty, o.recommended, o.lines.length, o.upgrades.length, o.discountPercent, o.chosen]))
    .toEqual([['Good', 'Delta', '1 year', false, 1, 0, 0, false], ['Better', 'Kohler', '5 years', true, 1, 1, 0, false], ['Best', 'Moen', 'Lifetime', false, 1, 0, 5, false]])
  expect(read.options.map((o: any) => o.price)).toEqual(item.proposal.options.map((o: any) => o.price))
  expect(proposalFromQuote(null)).toBeNull()
}, 60_000)

test('set-password link: names the account it is for (an invite says so); a wrong or spent link is refused the same way', async () => {
  const [u] = await t.db.insert(t.schema.user).values({ companyId, email: 'crew@test.example', firstName: 'Cal', lastName: 'Crew', role: 'field', passwordHash: 'x', resetToken: storedResetToken('invite-tok-1114'), resetTokenExp: new Date(Date.now() + 3600_000) } as any).returning() as any[]
  const who = await json(await t.call('/api/auth/reset-password/account', { method: 'POST', json: { token: 'invite-tok-1114' } }))
  expect(who.status).toBe(200)
  expect(who.body).toEqual({ email: 'crew@test.example', invite: true })
  const wrong = await json(await t.call('/api/auth/reset-password/account', { method: 'POST', json: { token: 'nope' } }))
  expect([wrong.status, wrong.body.error]).toEqual([400, 'Invalid or expired reset token'])
  // Used: the link no longer names anyone.
  expect((await t.call('/api/auth/reset-password', { method: 'POST', json: { token: 'invite-tok-1114', password: 'Crew-pass-1114x' } })).status).toBe(200)
  const spent = await json(await t.call('/api/auth/reset-password/account', { method: 'POST', json: { token: 'invite-tok-1114' } }))
  expect([spent.status, spent.body.error]).toEqual([400, 'Invalid or expired reset token'])
  expect(u.id).toBeTruthy()
}, 60_000)
