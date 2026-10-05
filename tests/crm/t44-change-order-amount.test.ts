// A change order raised for a lump sum saved as $0. (T44)
//
//   "A change order sent with only an amount saves as $0."
//
// `changeOrderSchema` had no `amount` field, so zod stripped it, `lineItems` defaulted to `[]`, and
// the total was computed as `lineItems.reduce(…)` — zero. The figure the caller sent was
// accepted-looking and discarded: the same silent drop as the warranty claim's title.
//
// A lump sum is a real change order. "$1,200 for the extra groundworks" is how a builder raises one
// and itemising it is optional. The CRM's own form collects line items, which is why no screen ever
// showed this — but the API, the portal and any integration can raise a flat one, and a flat one
// became free work.
//
// Both directions matter here: line items must stay AUTHORITATIVE when given, because an itemised
// total is the sum of its items and letting a caller disagree with its own arithmetic would be a
// worse bug than the one being fixed.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, project, changeOrder } = await import('./db/schema.ts')
const { errorHandler } = await import('./src/utils/errors.ts')

const [co] = await db.insert(company).values({
  name: 'Oakfield Build', slug: 'oakfield-t44', email: 'co44@test.local',
  settings: {}, enabledFeatures: ['projects', 'change_orders', 'contacts', 'invoices'],
} as any).returning()
const manager = (await db.insert(user).values({
  email: 'mgr@oakfield-t44.local', passwordHash: 'x', firstName: 'Mgr', lastName: 'U',
  role: 'manager', companyId: co.id, isActive: true,
} as any).returning())[0]
const [client] = await db.insert(contact).values({
  companyId: co.id, type: 'client', name: 'Priya Raval', email: 'priya-t44@test.local',
} as any).returning()
const [proj] = await db.insert(project).values({
  companyId: co.id, contactId: client.id, name: 'Garden studio', number: 'PRJ-0244',
  status: 'in_progress', estimatedValue: '60000.00', budget: '58000.00',
} as any).returning()

const app = new Hono()
app.route('/api/change-orders', (await import('./src/routes/changeOrders.ts')).default)
app.onError(errorHandler)

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': manager.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const amountOf = async (id: string) =>
  Number((await db.select().from(changeOrder).where(eq(changeOrder.id, id)))[0]?.amount)

console.log('\n══════════ a lump sum keeps its figure ══════════')
{
  const r = await call('POST', '/api/change-orders', {
    projectId: proj.id, title: 'Extra groundworks', reason: 'rock encountered', amount: 1200.5,
  })
  check('a change order with an amount and no line items is accepted', r.status === 201, { status: r.status, body: r.text?.slice(0, 200) })
  check('T44: …and stores 1200.50, not 0', await amountOf(r.json?.id) === 1200.5, await amountOf(r.json?.id))

  // …and a credit, which is the same path with the sign flipped
  const credit = await call('POST', '/api/change-orders', {
    projectId: proj.id, title: 'Omit the paving', reason: 'client removed scope', amount: -480,
  })
  check('a lump-sum CREDIT keeps its sign', credit.status === 201 && await amountOf(credit.json?.id) === -480,
    { status: credit.status, amount: await amountOf(credit.json?.id) })
}

console.log('\n══════════ …and line items still win where they exist ══════════')
{
  const r = await call('POST', '/api/change-orders', {
    projectId: proj.id, title: 'Itemised extras',
    lineItems: [
      { description: 'Blockwork', quantity: 2, unitPrice: 300 },
      { description: 'Lintel', quantity: 1, unitPrice: 150 },
    ],
  })
  check('an itemised change order totals its items', r.status === 201 && await amountOf(r.json?.id) === 750,
    { status: r.status, amount: await amountOf(r.json?.id) })

  // the important half: a caller cannot disagree with its own arithmetic
  const both = await call('POST', '/api/change-orders', {
    projectId: proj.id, title: 'Both supplied',
    amount: 99999,
    lineItems: [{ description: 'Blockwork', quantity: 2, unitPrice: 300 }],
  })
  check('T44: when BOTH are sent the items win — 600, not 99999',
    both.status === 201 && await amountOf(both.json?.id) === 600, await amountOf(both.json?.id))
}

console.log('\n══════════ and an edit does not zero a figure it was not asked about ══════════')
{
  const made = await call('POST', '/api/change-orders', {
    projectId: proj.id, title: 'Roof light', amount: 2400,
  })
  const id = made.json?.id
  const edit = await call('PUT', `/api/change-orders/${id}`, { projectId: proj.id, title: 'Roof light (revised)' })
  check('an edit that mentions neither amount nor items leaves the figure alone',
    edit.status === 200 && await amountOf(id) === 2400, { status: edit.status, amount: await amountOf(id) })

  const reprice = await call('PUT', `/api/change-orders/${id}`, { projectId: proj.id, title: 'Roof light (revised)', amount: 2650 })
  check('…and an edit that sends a new amount takes it', reprice.status === 200 && await amountOf(id) === 2650,
    { status: reprice.status, amount: await amountOf(id) })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
