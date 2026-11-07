// Contractor parity row 9 — formula estimating on the server (JobTread's parameters and formulas; quote_formulas, not ready):
// a quote's lines worked out from its parameters and its project's on every save; changing the project's parameters works its
// open quotes out again; a takeoff's measurement fills a parameter; the price guide keeps a quantity formula; a quote template
// keeps the formulas; errors come back in words and nothing is saved. Fails without the change: a quantity was only a number.
import { describe, test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { FEATURE_REGISTRY } from '@twomiah/tenant-backend'

const json = async (r: Response) => (await r.json()) as any
const ON = ['contacts', 'projects', 'quotes', 'pricebook', 'quote_templates', 'takeoffs', 'quote_formulas']

async function boot(features = ON) {
  const t = await bootTenant({ vertical: 'contractor' })
  const s = await seedOwner(t)
  const companyId = s.company.id as string
  await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, companyId))
  const ins = async (table: any, values: any) => ((await t.db.insert(table).values(values).returning()) as any[])[0]
  const tok = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  const owner = (p: string, i: any = {}) => t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } })
  const customer = await ins(t.schema.contact, { companyId, type: 'client', name: 'Ruiz Family' })
  const deck = await ins(t.schema.project, { companyId, number: 'PRJ-0001', name: 'Deck — Ruiz', contactId: customer.id })
  return { t, ins, owner, companyId, customer, deck }
}
const LINES = [
  { description: 'Decking boards', formulaKey: 'boards', quantityFormula: 'ceil(deck_sqft / 5.5)', unitPrice: 18 },
  { description: 'Screws (boxes)', quantityFormula: 'ceil(boards * 20 / 350)', unitPrice: 42 },
  { description: 'Labour', quantityFormula: 'deck_sqft / 25', priceFormula: '65 * 1.1' },
  { description: 'Permit', quantity: 1, unitPrice: 150 },
]

describe('formula estimating', () => {
  test('is registered, not ready, and the general contractor’s', () => {
    const f = (FEATURE_REGISTRY as any[]).find((x) => x.id === 'quote_formulas')
    expect([f?.hidden, f?.templates]).toEqual([true, ['crm']])
  })

  test('a quote’s lines are worked out from the project’s parameters and the quote’s own, and kept as formulas', async () => {
    const x = await boot()
    expect((await x.owner(`/api/project-parameters/${x.deck.id}`, { method: 'PUT', json: { parameters: [{ key: 'deck_sqft', label: 'Deck area', value: 300, unit: 'sq ft' }] } })).status).toBe(200)
    const r = await x.owner('/api/quotes', { method: 'POST', json: { name: 'Deck', contactId: x.customer.id, projectId: x.deck.id, lineItems: LINES } })
    expect(r.status).toBe(201)
    const q = await json(r)
    // 300 / 5.5 = 54.5 → 55 boards; 55 × 20 / 350 = 3.1 → 4 boxes; 300 / 25 = 12 hours at 71.50
    expect(q.lineItems.map((l: any) => [Number(l.quantity), Number(l.unitPrice)])).toEqual([[55, 18], [4, 42], [12, 71.5], [1, 150]])
    expect(Number(q.subtotal)).toBe(55 * 18 + 4 * 42 + 12 * 71.5 + 150)
    expect(q.lineItems[0]).toMatchObject({ formulaKey: 'boards', quantityFormula: 'ceil(deck_sqft / 5.5)' })

    // the quote's own parameter wins over the project's
    const own = await json(await x.owner(`/api/quotes/${q.id}`, { method: 'PUT', json: { parameters: [{ key: 'deck_sqft', value: 440 }] } }))
    expect(own.lineItems.map((l: any) => Number(l.quantity))).toEqual([80, 5, 17.6, 1])
    expect(own.parameters).toEqual([{ key: 'deck_sqft', value: 440 }])
  }, 90_000)

  test('changing the project’s parameters works its open quotes out again, and names one that no longer works out', async () => {
    const x = await boot()
    await x.owner(`/api/project-parameters/${x.deck.id}`, { method: 'PUT', json: { parameters: [{ key: 'deck_sqft', value: 300 }] } })
    const q = await json(await x.owner('/api/quotes', { method: 'POST', json: { name: 'Deck', contactId: x.customer.id, projectId: x.deck.id, lineItems: LINES } }))
    const before = Number(q.total)
    const r = await json(await x.owner(`/api/project-parameters/${x.deck.id}`, { method: 'PUT', json: { parameters: [{ key: 'deck_sqft', value: 330 }] } }))
    expect(r.quotes).toEqual([{ id: q.id, number: q.number, total: expect.any(Number), linesChanged: 2 }]) // boards 55 → 60 and labour 12 → 13.2; screws still 4 boxes
    expect(r.quotes[0].total).toBeGreaterThan(before)
    const after = await json(await x.owner(`/api/quotes/${q.id}`))
    expect(Number(after.lineItems[0].quantity)).toBe(60)
    // a parameter taken away that the quote reads: the quote is left as it was, and named
    const gone = await json(await x.owner(`/api/project-parameters/${x.deck.id}`, { method: 'PUT', json: { parameters: [] } }))
    expect(gone.quotes[0].error).toBe('Line 1 ("Decking boards"): Nothing is called "deck_sqft": no parameter or line has that name')
    expect(Number((await json(await x.owner(`/api/quotes/${q.id}`))).total)).toBe(r.quotes[0].total)
  }, 90_000)

  test('a formula that does not work out is refused in words, and nothing is saved', async () => {
    const x = await boot()
    const r = await x.owner('/api/quotes', { method: 'POST', json: { name: 'Deck', contactId: x.customer.id, lineItems: [{ description: 'Boards', quantityFormula: 'deck_sqft / 5.5', unitPrice: 18 }] } })
    expect(r.status).toBe(400)
    const body = await json(r)
    expect(body.error).toBe('Line 1 ("Boards"): Nothing is called "deck_sqft": no parameter or line has that name')
    expect(body.formulaError).toEqual({ line: 0, message: 'Nothing is called "deck_sqft": no parameter or line has that name' })
    expect((await x.owner('/api/quotes', { method: 'POST', json: { name: 'x', contactId: x.customer.id, parameters: [{ key: 'two words', value: 1 }], lineItems: [{ description: 'a', quantity: 1, unitPrice: 1 }] } })).status).toBe(400)
    const list = await json(await x.owner('/api/quotes'))
    expect(list.data.length).toBe(0)
  }, 90_000)

  test('a takeoff measurement fills a parameter, and the quote follows', async () => {
    const x = await boot()
    const sheet = await x.ins(x.t.schema.takeoffSheet, { companyId: x.companyId, projectId: x.deck.id, name: 'Deck plan' })
    const item = await x.ins(x.t.schema.takeoffItem, { sheetId: sheet.id, name: 'Deck surface', measurementType: 'area', measurementValue: '160', quantity: '2', unit: 'sq ft' })
    const r = await x.owner(`/api/project-parameters/${x.deck.id}/from-takeoff`, { method: 'POST', json: { items: [{ takeoffItemId: item.id, key: 'deck_sqft' }] } })
    expect(r.status).toBe(200)
    expect((await json(r)).parameters).toEqual([{ key: 'deck_sqft', label: 'Deck surface', value: 320, unit: 'sq ft' }])
    const other = await x.ins(x.t.schema.project, { companyId: x.companyId, number: 'PRJ-0002', name: 'Other' })
    expect((await x.owner(`/api/project-parameters/${other.id}/from-takeoff`, { method: 'POST', json: { items: [{ takeoffItemId: item.id, key: 'deck_sqft' }] } })).status).toBe(400)
  }, 90_000)

  test('the price guide keeps a quantity formula (a typo refused), and a quote template keeps the formulas and parameters', async () => {
    const x = await boot()
    const made = await x.owner('/api/pricebook/items', { method: 'POST', json: { name: 'Joist hanger', price: 3.2, quantityFormula: 'ceil(deck_sqft / 4)' } })
    expect(made.status).toBe(201)
    expect((await json(made)).quantityFormula).toBe('ceil(deck_sqft / 4)')
    const bad = await x.owner('/api/pricebook/items', { method: 'POST', json: { name: 'Bad', price: 1, quantityFormula: 'deck_sqft $ 4' } })
    expect(bad.status).toBe(400)
    expect((await json(bad)).error).toBe('Quantity formula: "$" cannot be used in a formula')

    const q = await json(await x.owner('/api/quotes', { method: 'POST', json: { name: 'Deck', contactId: x.customer.id, parameters: [{ key: 'deck_sqft', value: 300 }], lineItems: LINES } }))
    const tpl = await json(await x.owner('/api/quote-templates', { method: 'POST', json: { quoteId: q.id, name: 'Standard deck' } }))
    const got = await json(await x.owner(`/api/quote-templates/${tpl.id}`))
    const body = got.body ?? got
    expect(body.parameters).toEqual([{ key: 'deck_sqft', value: 300 }])
    expect(body.lineItems[0]).toMatchObject({ formulaKey: 'boards', quantityFormula: 'ceil(deck_sqft / 5.5)' })
    expect(body.lineItems[2]).toMatchObject({ priceFormula: '65 * 1.1' })
  }, 90_000)

  test('off: no parameter routes, formulas neither read nor kept, quantities as sent', async () => {
    const x = await boot(ON.filter((f) => f !== 'quote_formulas'))
    expect((await x.owner(`/api/project-parameters/${x.deck.id}`)).status).toBe(404)
    const q = await json(await x.owner('/api/quotes', { method: 'POST', json: { name: 'Deck', contactId: x.customer.id, parameters: [{ key: 'deck_sqft', value: 300 }], lineItems: [{ description: 'Boards', quantity: 7, quantityFormula: 'deck_sqft / 5.5', unitPrice: 18 }] } }))
    expect(Number(q.lineItems[0].quantity)).toBe(7)
    expect(q.lineItems[0].quantityFormula ?? null).toBeNull()
    expect(q.parameters ?? null).toBeNull()
  }, 90_000)
})
