// Quotes and payments as the contractor live test (11/07) found them, each now as it should:
//   · "Templates do not carry Good/Better/Best options or the picture": a template keeps each option (its lines and upgrades, photos and
//     discount — never which one a customer chose) and each line's picture, in the shape the quote's proposal takes back;
//   · "No tip switch anywhere": with the feature on, tips are the business's own switch (Card payments), off until turned on;
//   · the Sub kind for markup defaults.
// Through the real server as the contractor vertical; nothing reaches a real tenant.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', token = '', contactId = ''
const as = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'quotes', 'invoices', 'quote_templates', 'quote_proposals', 'quote_line_images', 'invoice_tips', 'markup_defaults'] } as any).where(eq(t.schema.company.id, companyId))
  t.services.features.forgetFeatures()
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json() as any).accessToken
  contactId = ((await t.db.insert(t.schema.contact).values({ companyId, name: 'Hank Homeowner', email: 'hank@home.example', type: 'client' } as any).returning()) as any[])[0].id
}, 120_000)

test('a template keeps the Good / Better / Best options and the line pictures, and a new quote takes them back', async () => {
  const q = await json(await as('/api/quotes', { method: 'POST', json: { contactId, name: 'Kitchen remodel', taxRate: 0, lineItems: [{ description: 'Demo and haul', quantity: 1, unitPrice: 1310, imageUrl: 'https://img.example/kitchen.jpg' }] } }))
  expect(q.status).toBe(201)
  const options = [
    { name: 'Good', tier: 'good', lines: [{ description: 'Stock cabinets', quantity: 1, unitPrice: 6000 }] },
    { name: 'Better', tier: 'better', recommended: true, lines: [{ description: 'Semi-custom cabinets', quantity: 1, unitPrice: 9000 }], upgrades: [{ description: 'Soft-close drawers', quantity: 1, unitPrice: 400 }] },
    { name: 'Best', tier: 'best', lines: [{ description: 'Custom cabinets', quantity: 1, unitPrice: 13000 }], discount: { type: 'percent', percent: 5 } },
  ]
  expect((await as(`/api/quotes/${q.body.id}/proposal`, { method: 'PUT', json: { options } })).status).toBe(200)
  const saved = await json(await as('/api/quote-templates', { method: 'POST', json: { quoteId: q.body.id, name: 'Kitchen package' } }))
  expect(saved.status).toBe(201)
  const tpl = await json(await as(`/api/quote-templates/${saved.body.id}`))
  expect(tpl.body.body.lineItems[0].imageUrl).toBe('https://img.example/kitchen.jpg')
  const sets = tpl.body.body.proposal.sets
  expect(sets.length).toBe(1)
  expect(sets[0].options.map((o: any) => [o.name, o.lines[0].description, o.upgrades.length, o.recommended])).toEqual([['Good', 'Stock cabinets', 0, false], ['Better', 'Semi-custom cabinets', 1, true], ['Best', 'Custom cabinets', 0, false]])
  expect(sets[0].options[2].discount).toEqual({ type: 'percent', percent: 5 })
  // The New Quote form saves the quote, then puts the template's options on it — the proposal route takes them as they are.
  const made = await json(await as('/api/quotes', { method: 'POST', json: { contactId, name: 'Kitchen for the Lees', taxRate: 0, lineItems: tpl.body.body.lineItems } }))
  expect((await as(`/api/quotes/${made.body.id}/proposal`, { method: 'PUT', json: tpl.body.body.proposal })).status).toBe(200)
  const read = await json(await as(`/api/quotes/${made.body.id}`))
  expect(read.body.proposal.options.map((o: any) => o.name)).toEqual(['Good', 'Better', 'Best'])
  expect(read.body.lineItems.find((l: any) => !l.proposalOptionId).imageUrl).toBe('https://img.example/kitchen.jpg')
}, 60_000)

test('tips are off until the business turns them on, and only it may', async () => {
  const off = await json(await as('/api/card-payments/tips'))
  expect([off.status, off.body.on]).toEqual([200, false])
  expect((await as('/api/card-payments/tips', { method: 'PUT', json: { on: 'yes' } })).status).toBe(400)
  const on = await json(await as('/api/card-payments/tips', { method: 'PUT', json: { on: true } }))
  expect([on.status, on.body.on]).toEqual([200, true])
  expect((await json(await as('/api/card-payments/tips'))).body.on).toBe(true)
})

test('markup defaults take a Sub (subcontractor) markup, and a quote line can be a subcontractor line', async () => {
  const put = await json(await as('/api/markup-defaults', { method: 'PUT', json: { labor: 30, material: 20, part: null, service: null, subcontractor: 10, other: null } }))
  expect([put.status, put.body.subcontractor]).toEqual([200, 10])
  const q = await json(await as('/api/quotes', { method: 'POST', json: { contactId, name: 'Framing', taxRate: 0, lineItems: [{ description: 'Framing sub', quantity: 1, unitPrice: 1100, unitCost: 1000, type: 'subcontractor' }] } }))
  expect(q.status).toBe(201)
  expect(q.body.lineItems?.[0]?.type ?? (await json(await as(`/api/quotes/${q.body.id}`))).body.lineItems[0].type).toBe('subcontractor')
})
