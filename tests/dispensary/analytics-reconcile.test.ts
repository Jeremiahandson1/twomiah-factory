// crm-dispensary — the analytics panels have to add up to the figure above them.
//
// T42 H2: /api/analytics/summary works out revenue over the SETTLED row set (completed + partially
// refunded) net of refunds, but its paymentMethods and salesByCategory lists counted strictly
// 'completed' orders at GROSS. So a partly-refunded sale vanished from the breakdowns while staying
// in the headline: 30 days read $9,039.75 with payment methods adding to $6,816.25 and categories to
// $5,633, one of which was a "null" row worth $700.
//
// T42 M4: Retention Rate read 0.0% on a window where six customers averaged 4.67 visits each.
// Retention is the repeat-purchase rate; it was being derived from the returning COHORT, which is a
// different question (did this person shop here before the window opened) and has to keep
// reconciling with new (go-live QA M-8). Both numbers are now reported, and the rate uses the right one.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, product } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Reconcile Dispensary', slug: 'reconcile', email: 'reconcile@test.local',
  state: 'OH', settings: {}, enabledFeatures: [],
} as any).returning()

const owner = (await db.insert(user).values({
  email: 'owner-reconcile@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning())[0]

const app = new Hono()
app.route('/api/analytics', (await import('./src/routes/analytics.ts')).default)

const as = (who: any) => async (path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': who.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const asOwner = as(owner)

const [buyer] = await db.insert(contact).values({ type: 'customer', name: 'Reconcile Buyer', companyId: co.id } as any).returning()

// order_items.product_id is a real foreign key. The line's own `category` column is what the
// breakdown groups on, so one product is enough to hang all three lines off.
const [anyProduct] = await db.insert(product).values({
  name: 'Reconcile Item', sku: 'RC-1', category: 'flower', price: '100',
  stockQuantity: 999, trackInventory: false, companyId: co.id,
} as any).returning()

// Three sales on the same day, written straight to the table so the shapes are exact:
//   completed              cash   $100, nothing returned
//   partially_refunded     debit  $87.50 with $43.75 handed back  → the one T42 watched disappear
//   refunded (in full)     cash   $50 with $50 back               → contributes 0 to net
// Analytics buckets a sale into the STORE's day, not UTC's — that is the whole point of
// storeDayRange (isoTime.ts), and this shop is in Ohio, so America/New_York. Between UTC midnight
// and the store's, the two calendars disagree: asking for the UTC date found none of these sales
// and every assertion below read as a regression for about five hours every night. Ask for the
// day the server would call today.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
// One statement per call: PGlite refuses multiple commands in a prepared statement.
const mkOrder = async (n: number, status: string, method: string, total: number, refunded: number, category: string | null) => {
  await db.execute(sql`
    INSERT INTO orders (id, order_number, company_id, contact_id, status, type, payment_method,
                        subtotal, total, refunded_amount, discount_amount, created_at, completed_at)
    VALUES (${'ord-' + n}, ${n}, ${co.id}, ${buyer.id}, ${status}, 'walk_in', ${method},
            ${String(total)}, ${String(total)}, ${refunded ? String(refunded) : null}, '0', NOW(), NOW())
  `)
  await db.execute(sql`
    INSERT INTO order_items (id, order_id, product_id, product_name, category, quantity, refunded_quantity, unit_price, line_total, company_id)
    VALUES (${'oi-' + n}, ${'ord-' + n}, ${anyProduct.id}, ${'Item ' + n}, ${category}, 1,
            ${refunded ? 1 : 0}, ${String(total)}, ${String(total)}, ${co.id})
  `)
}

await mkOrder(1, 'completed', 'cash', 100, 0, 'flower')
await mkOrder(2, 'partially_refunded', 'debit', 87.5, 43.75, 'edible')
await mkOrder(3, 'refunded', 'cash', 50, 50, null)   // null category — the "null" row worth $700

const sum = await asOwner(`/api/analytics/summary?date=${today}`)
check('summary: loads', sum.status === 200, sum.json)

const revenue = Number(sum.json?.orders?.revenue ?? -1)
const methods: any[] = sum.json?.paymentMethods || []
const categories: any[] = sum.json?.salesByCategory || []
const methodTotal = methods.reduce((t, m) => t + Number(m.total || 0), 0)

// completed 100 + partially refunded (87.50 − 43.75) + fully refunded 0 = 143.75
check('summary: headline revenue is net over settled sales', revenue === 143.75, { revenue })

// ── H2: the breakdowns must reach the same number ──────────────────────────────────────────────
check('H2: payment methods add up to the headline revenue', methodTotal === revenue, { methodTotal, revenue, methods })
check('H2: the partly-refunded debit sale appears at its NET $43.75',
  Number(methods.find((m) => m.payment_method === 'debit')?.total || 0) === 43.75, methods)
check('H2: cash is 100 + 0 for the fully refunded one',
  Number(methods.find((m) => m.payment_method === 'cash')?.total || 0) === 100, methods)
check('H2: every settled sale is represented, not just completed ones',
  methods.reduce((n, m) => n + Number(m.count || 0), 0) === 3, methods)

// ── H2: no more "null" category ────────────────────────────────────────────────────────────────
check('H2: a line whose product has no category reads "uncategorised", not null',
  categories.some((r) => r.category === 'uncategorised') && !categories.some((r) => r.category === null), categories)
check('H2: the partly-refunded sale is in the category breakdown too',
  categories.some((r) => r.category === 'edible'), categories)

// ── M4: retention is the repeat rate, and the cohort split still reconciles ─────────────────────
const cust = await asOwner('/api/analytics/customers?period=30d')
check('customers: loads', cust.status === 200, cust.json)
const unique = Number(cust.json?.uniqueCustomers ?? -1)
const returning = Number(cust.json?.returningCustomers ?? -1)
const repeat = Number(cust.json?.repeatCustomers ?? -1)
const newC = Number(cust.json?.newCustomers ?? -1)

check('M4: the one buyer is counted once', unique === 1, cust.json)
check('M4: they bought 3 times in the window, so they are a REPEAT customer', repeat === 1, cust.json)
check('M4: retention is no longer 0% while the same customer visits repeatedly', Number(cust.json?.retentionRate) === 100, cust.json)
check('M4: they are still NEW — they had not shopped before the window opened', returning === 0, cust.json)
check('M8 still holds: new + returning === unique', newC + returning === unique, cust.json)

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
