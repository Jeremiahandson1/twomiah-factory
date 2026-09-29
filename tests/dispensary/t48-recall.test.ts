// crm-dispensary — T48 Q6: a recall that lifted itself.
//
// The tester recalled a batch, then used it up. It went to 'depleted' with 0 units, nothing was
// asked, and the product's untracked stock went back on sale.
//
//     const newStatus = newQuantity === 0 ? 'depleted' : current.status
//
// The order path blocks a product whose batch is RECALLED. It does not block one whose batch is
// depleted — correctly, because an empty batch is an ordinary end of life. So emptying a recalled
// batch walked it out of the one status that was holding the product back, through a route nobody
// thinks of as a compliance decision. A stock count is not a decision to end a recall.
//
// There were three doors out of a recalled batch and none of them was locked:
//   POST /:id/deplete        — moved it to 'depleted' on its own
//   POST /:id/:action        — /activate flipped it with nothing recorded
//   PUT  /:id/status         — set anything, reason optional
//
// The failed-lab-test release (T47 P10) already required a written reason for a far less serious
// hold. A recall is usually the supplier's or the state's decision rather than the shop's, so it is
// held to at least that standard, at all three doors.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Twomiah Leaf', slug: 'leaf-t48rc', email: 'rc@test.local', state: 'OH',
  enabledFeatures: ['products', 'orders', 'batches', 'compliance'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-t48rc@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()

// 44 units on the product, 10 of them in a batch. The other 34 are untracked — the shape the tester
// used, and the one where a lifted recall actually puts product back on the shelf.
const [choc] = await db.insert(product).values({
  name: 'Chocolate Bar', companyId: co.id, category: 'edibles', price: '15', thcMg: '10',
  stockQuantity: 44, active: true, inStock: true, taxCategory: 'cannabis',
} as any).returning()

const app = new Hono()
app.route('/api/batches', (await import('./src/routes/batches.ts')).default)

const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }

const mkBatch = async (n: string) => {
  const made = await api('POST', '/api/batches', {
    batchNumber: n, productId: choc.id, initialQuantity: 10, unitOfMeasure: 'units',
  })
  return made.json?.id || made.json?.data?.id
}
const statusOf = async (id: string) => (await rows(sql`SELECT status, current_quantity, status_reason FROM batches WHERE id = ${id}`))[0]

// ── door 1: emptying it ─────────────────────────────────────────────────────────────────────────
{
  const id = await mkBatch('T48-RC-1')
  await api('PUT', `/api/batches/${id}/status`, { status: 'recalled', reason: 'Supplier recall' })
  check('Q6: the batch is recalled', (await statusOf(id))?.status === 'recalled')

  const out = await api('POST', `/api/batches/${id}/deplete`, {})
  check('Q6: it can still be emptied — working a recall means pulling the stock', out.status === 200, { status: out.status, body: out.json })

  const after = await statusOf(id)
  check('Q6: …the quantity goes to zero', Number(after?.current_quantity) === 0, after)
  check('Q6: …and it is STILL RECALLED, not depleted — this is the one that shipped',
    after?.status === 'recalled', after)
}

// ── door 2: /activate with no body, which is what the button posts ──────────────────────────────
{
  const id = await mkBatch('T48-RC-2')
  await api('PUT', `/api/batches/${id}/status`, { status: 'recalled', reason: 'Pesticide recall' })

  const bare = await api('POST', `/api/batches/${id}/activate`)
  check('Q6: /activate on a recalled batch is refused without a reason', bare.status === 400, { status: bare.status, body: bare.json })
  check('Q6: …named as such, so a screen can ask for one', bare.json?.code === 'recall_needs_reason', bare.json)
  check('Q6: …and the refusal says what a reason would look like',
    /supplier withdrew it|destroyed|state closed it/i.test(String(bare.json?.error)), bare.json?.error)
  check('Q6: …and the batch has not moved', (await statusOf(id))?.status === 'recalled')

  const withWhy = await api('POST', `/api/batches/${id}/activate`, { reason: 'Supplier withdrew the recall, lot 88 was not affected' })
  check('Q6: …and with a reason it goes through', withWhy.status === 200, { status: withWhy.status, body: withWhy.json })
  const after = await statusOf(id)
  check('Q6: …now active', after?.status === 'active', after)
  check('Q6: …with the reason kept against the batch, where a regulator would look for it',
    /Recall lifted: Supplier withdrew the recall/.test(String(after?.status_reason)), after?.status_reason)
}

// ── door 3: the API-level status route ──────────────────────────────────────────────────────────
{
  const id = await mkBatch('T48-RC-3')
  await api('PUT', `/api/batches/${id}/status`, { status: 'recalled', reason: 'State recall' })

  const bare = await api('PUT', `/api/batches/${id}/status`, { status: 'active' })
  check('Q6: PUT /status cannot lift a recall without a reason either', bare.status === 400, { status: bare.status, body: bare.json })
  check('Q6: …the same code, so one screen handles all three doors', bare.json?.code === 'recall_needs_reason', bare.json)
  check('Q6: …and the batch has not moved', (await statusOf(id))?.status === 'recalled')

  const withWhy = await api('PUT', `/api/batches/${id}/status`, { status: 'active', reason: 'State closed the recall' })
  check('Q6: …with a reason it goes through', withWhy.status === 200, withWhy.json)
  check('Q6: …and is active', (await statusOf(id))?.status === 'active')
}

// ── recalling is never blocked by its own rule ──────────────────────────────────────────────────
//
// The guard fires on LEAVING a recall. Re-recalling, or recalling a batch already recalled, must
// not need a reason to say the same thing twice.
{
  const id = await mkBatch('T48-RC-4')
  await api('PUT', `/api/batches/${id}/status`, { status: 'recalled', reason: 'First' })
  const again = await api('POST', `/api/batches/${id}/recall`)
  check('Q6: recalling a recalled batch is not refused', again.status === 200, { status: again.status, body: again.json })
  check('Q6: …and it is still recalled', (await statusOf(id))?.status === 'recalled')
}

// ── an ordinary batch is untouched by any of this ───────────────────────────────────────────────
{
  const id = await mkBatch('T48-RC-5')
  const out = await api('POST', `/api/batches/${id}/deplete`, {})
  check('Q6: an ordinary batch emptied still becomes depleted', (await statusOf(id))?.status === 'depleted', await statusOf(id))
  check('Q6: …and needed no reason to get there', out.status === 200, out.status)

  const id2 = await mkBatch('T48-RC-6')
  await api('POST', `/api/batches/${id2}/quarantine`)
  const rel = await api('POST', `/api/batches/${id2}/activate`)
  check('Q6: a hand-raised quarantine still releases freely — that line has not moved', rel.status === 200, { status: rel.status, body: rel.json })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
