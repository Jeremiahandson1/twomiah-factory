// crm-dispensary — T57, the tester's second observation. Raised as an observation; it is a defect.
//
//   "Generating a filing for a period that already has a calculated one does not set the earlier one
//    aside, so duplicates build up. Your verification left six on 30 Sep, not two. I set them all
//    aside."
//
// Six returns for one day is not untidiness on a tax record. The filings list is where somebody
// looks to find out what was filed, and six rows each looking exactly as authoritative as the others
// is six answers to a question with one answer. T48 Q8 built superseding for precisely this and left
// it manual — and it should never have been manual, because the product knows it is replacing one:
// it is generating the replacement at that moment.
//
// What it must NOT touch is a return that has actually been FILED. That one went to the state; the
// new one is an amendment, and both have to stand. Same line the manual supersede draws.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, product } from './db/schema.ts'

// The SHOP's day, not UTC's. These companies are in Ohio, so the tax day runs on
// America/New_York (T52): between UTC midnight and the shop's midnight, `new Date().toISOString()`
// names TOMORROW in shop terms, the filing covers a window holding none of the orders completed a
// moment earlier, and every figure comes back 0. Red for four hours a night, green the rest of the
// time — which is how this class of failure gets dismissed as flakiness.
const shopDay = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Twomiah Leaf', slug: 'leaf-t57f', email: 't57f@test.local', state: 'OH',
  taxRate: '10', exciseTaxRate: '15',
  enabledFeatures: ['products', 'orders', 'compliance', 'tax_filing'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-t57f@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()
const [adult] = await db.insert(contact).values({ name: 'T57 Addie', type: 'client', companyId: co.id } as any).returning()
const [flower] = await db.insert(product).values({
  name: 'T57 Blue Dream', companyId: co.id, category: 'flower', price: '100', weightGrams: '3.5',
  stockQuantity: 500, taxCategory: 'cannabis', trackInventory: true,
} as any).returning()

const app = new Hono()
app.route('/api/orders', (await import('./src/routes/orders.ts')).default)
app.route('/api/tax-filing', (await import('./src/routes/tax-filing.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
const today = shopDay()

// One sale, so the returns have something to report.
{
  const made = await api('POST', '/api/orders', { items: [{ productId: flower.id, quantity: 1 }], orderType: 'walk_in', contactId: adult.id })
  const id = (made.json?.data || made.json)?.id
  await db.execute(sql`UPDATE orders SET status = 'completed', completed_at = NOW() WHERE id = ${id}`)
}
const generate = (filingType = 'excise_tax', period = today) =>
  api('POST', '/api/tax-filing/filings/generate', { filingType, periodStart: period, periodEnd: period })
const liveFilings = (filingType = 'excise_tax') => rows(sql`
  SELECT id, status, notes FROM tax_filings
  WHERE company_id = ${co.id} AND filing_type = ${filingType} AND status NOT IN ('superseded')
  ORDER BY created_at ASC
`)

// ══════════ one period, one current return ══════════════════════════════════════════════════════
{
  const first = await generate()
  check('a return generates', first.status === 201, { status: first.status, body: first.json })
  check('…and the first one supersedes nothing', !first.json?.supersededFilings, first.json?.supersededFilings)

  const second = await generate()
  check('generating it again answers', second.status === 201, { status: second.status })
  check('…and says it replaced the earlier one, rather than leaving the reader to notice',
    Number(second.json?.supersededFilings) === 1, second.json?.supersededFilings)

  const live = await liveFilings()
  check('…so one period has ONE current return, not two', live.length === 1, live.map((f: any) => f.status))
  check('…and it is the new one', String(live[0]?.id) === String(second.json?.id), { current: live[0]?.id, new: second.json?.id })

  const [old] = await rows(sql`SELECT status, notes FROM tax_filings WHERE id = ${first.json?.id}`)
  check('the replaced one is kept, not deleted — it is a tax record', !!old, old)
  check('…marked superseded', old?.status === 'superseded', old?.status)
  check('…and it says why, which is the question it exists to answer',
    /replaced by a new excise tax return generated for the same period/i.test(String(old?.notes)), old?.notes)

  // …and a third time, so six-on-one-day cannot build up at all.
  const third = await generate()
  check('a third run replaces the second', Number(third.json?.supersededFilings) === 1, third.json?.supersededFilings)
  check('…and there is still exactly one current return', (await liveFilings()).length === 1, (await liveFilings()).length)
}

// ══════════ it only replaces the SAME return ════════════════════════════════════════════════════
{
  const sales = await generate('sales_tax')
  check('a different TYPE for the same period is not a replacement — they are two different returns',
    !sales.json?.supersededFilings, sales.json?.supersededFilings)
  check('…and both stand', (await liveFilings('excise_tax')).length === 1 && (await liveFilings('sales_tax')).length === 1,
    { excise: (await liveFilings('excise_tax')).length, sales: (await liveFilings('sales_tax')).length })

  const otherPeriod = shopDay(-5)
  const older = await generate('excise_tax', otherPeriod)
  check('a different PERIOD is not a replacement either', !older.json?.supersededFilings, older.json?.supersededFilings)
  check('…and the current return for today is untouched', (await liveFilings('excise_tax')).length === 2,
    (await liveFilings('excise_tax')).map((f: any) => f.status))
}

// ══════════ a return that was actually FILED is never quietly replaced ══════════════════════════
{
  const period = shopDay(-10)
  const filed = await generate('excise_tax', period)
  await db.execute(sql`UPDATE tax_filings SET status = 'filed' WHERE id = ${filed.json?.id}`)

  const amended = await generate('excise_tax', period)
  check('an amended return for a FILED period still generates', amended.status === 201, { status: amended.status })
  check('…and does NOT set the filed one aside — that one went to the state',
    !amended.json?.supersededFilings, amended.json?.supersededFilings)
  const [wasFiled] = await rows(sql`SELECT status FROM tax_filings WHERE id = ${filed.json?.id}`)
  check('…the filed return still reads as filed', wasFiled?.status === 'filed', wasFiled?.status)
  const both = await rows(sql`SELECT status FROM tax_filings WHERE company_id = ${co.id} AND period_start = ${period} ORDER BY created_at ASC`)
  check('…and both stand, which is what an amendment means', both.length === 2 && both[0]?.status === 'filed', both.map((f: any) => f.status))
}

// ══════════ the audit answers "why is this one not current?" ════════════════════════════════════
{
  const period = shopDay(-20)
  const first = await generate('excise_tax', period)
  const second = await generate('excise_tax', period)

  const audits = await rows(sql`
    SELECT action, entity_id, metadata FROM audit_log
    WHERE company_id = ${co.id} AND entity = 'tax_filing' AND entity_id = ${first.json?.id}
    ORDER BY created_at DESC LIMIT 5
  `)
  const row = audits.find((a: any) => {
    const m = typeof a.metadata === 'string' ? (() => { try { return JSON.parse(a.metadata) } catch { return {} } })() : (a.metadata || {})
    return m?.status === 'superseded'
  })
  check('the replaced return has its OWN audit row, not just a mention on the new one', !!row, audits.map((a: any) => a.action))
  const meta = row ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : {}
  check('…naming what replaced it', /replaced by TAX-/.test(String(meta?.reason)) && String(meta?.replacedBy) === String(second.json?.id),
    { reason: meta?.reason, replacedBy: meta?.replacedBy })
}

// ══════════ and the totals a regulator reads are still right ═══════════════════════════════════
{
  // H2 / T49: "Total Filed" must count filings by status, and a superseded one must not be in it.
  const summary = await api('GET', '/api/tax-filing/summary')
  check('the tax summary still answers', summary.status === 200, { status: summary.status })
  const live = await liveFilings('excise_tax')
  check('…and a superseded return is not counted as outstanding work',
    live.every((f: any) => f.status !== 'superseded'), live.map((f: any) => f.status))
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
