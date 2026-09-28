// crm-dispensary — what the shop floor can see of the shop's money. (T43 N8/N10)
//
// A budtender's job is to sell and to run their own till. Run T43 found several endpoints handing
// them rather more than that: past End-of-Day reports with the day's revenue, drawer count and
// variance; everyone ELSE's cash sessions; what each product cost the shop; and the fraud alerts
// raised about staff.
//
// Each of these is a one-line gate, and each one is easy to over-correct into "the floor cannot
// work" — so every test below comes in a pair: the budtender is refused the back-office view AND
// still has the thing they need to do their job. Locking a budtender out of their own drawer would
// be a worse bug than the one being fixed.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Floor Dispensary', slug: 'floor', email: 'floor@test.local',
  settings: {}, enabledFeatures: ['cash_management', 'products', 'orders', 'fraud_detection', 'approvals'],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-floor@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]

const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')
const budtender = await mkUser('user', 'budtender')   // stored `user`, normalised to budtender

const [item] = await db.insert(product).values({
  name: 'Blue Dream', sku: 'BD-1', category: 'flower', price: '35', cost: '10',
  weightGrams: '3.5', stockQuantity: 100, trackInventory: true, taxCategory: 'cannabis', companyId: co.id,
} as any).returning()

const app = new Hono()
for (const [mount, file] of [
  ['/api/cash', 'cash'],
  ['/api/products', 'products'],
  ['/api/eod', 'eod'],
  ['/api/fraud-detection', 'fraud-detection'],
  ['/api/approvals', 'approvals'],
] as const) {
  app.route(mount, (await import(`./src/routes/${file}.ts`)).default)
}

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const asOwner = as(owner)
const asManager = as(manager)
const asBudtender = as(budtender)

// ── End-of-Day: the shop's takings, not a shift ───────────────────────────────────────────────
const eodStaff = await asBudtender('GET', '/api/eod')
check('EOD: a budtender cannot read past End-of-Day reports', eodStaff.status === 403, eodStaff)
check('EOD: ...so no revenue, cash count or variance reaches the floor',
  !JSON.stringify(eodStaff.json).includes('totalRevenue'), eodStaff.json)
check('EOD: a manager still can', (await asManager('GET', '/api/eod')).status === 200)
check('EOD: and so can the owner', (await asOwner('GET', '/api/eod')).status === 200)
check('EOD: a single report is closed to the floor too', (await asBudtender('GET', '/api/eod/some-id')).status === 403)

// ── Cash drawers: your own, not everyone's ────────────────────────────────────────────────────
// The floor has to be able to run a till, so this is scoped rather than refused.
const openOwn = await asBudtender('POST', '/api/cash/sessions/open', { openingAmount: 100 })
check('cash: a budtender can still OPEN their own drawer', openOwn.status === 201 || openOwn.status === 200, openOwn)

const ownerDrawer = await asOwner('POST', '/api/cash/sessions/open', { openingAmount: 500 })
// One open drawer per company is enforced, so the owner's may be refused — either way the
// budtender must not see a session that is not theirs.
const staffList = await asBudtender('GET', '/api/cash/sessions')
check('cash: the budtender can list drawers', staffList.status === 200, staffList.status)
const staffRows: any[] = staffList.json?.data || []
check('cash: ...and every one of them is their own',
  staffRows.every((s: any) => (s.openedById ?? s.opened_by_id) === budtender.id), staffRows.map((s: any) => s.openedById ?? s.opened_by_id))

const mgrList = await asManager('GET', '/api/cash/sessions')
check('cash: a manager still sees the whole floor', mgrList.status === 200 && (mgrList.json?.data || []).length >= staffRows.length,
  { manager: (mgrList.json?.data || []).length, budtender: staffRows.length })

// ── Product cost: sell it without knowing the margin ──────────────────────────────────────────
const prodStaff = await asBudtender('GET', '/api/products')
check('products: the catalogue stays open to the floor — they cannot sell what they cannot see',
  prodStaff.status === 200 && (prodStaff.json?.data || []).length > 0, prodStaff.status)
check('products: but cost is not in it', !('cost' in ((prodStaff.json?.data || [])[0] || {})), (prodStaff.json?.data || [])[0])
check('products: price still is — that is what they ring up',
  String((prodStaff.json?.data || [])[0]?.price) === '35', (prodStaff.json?.data || [])[0]?.price)

const oneStaff = await asBudtender('GET', `/api/products/${item.id}`)
check('products: a single product hides cost too', oneStaff.status === 200 && !('cost' in (oneStaff.json || {})), oneStaff.json)

const prodMgr = await asManager('GET', '/api/products')
check('products: a manager still sees cost', 'cost' in ((prodMgr.json?.data || [])[0] || {}), (prodMgr.json?.data || [])[0])

// ── Fraud alerts name the staff they are about ────────────────────────────────────────────────
const fraudStaff = await asBudtender('GET', '/api/fraud-detection/alerts')
check('fraud: a budtender cannot read the alerts raised about staff', fraudStaff.status === 403, fraudStaff)
check('fraud: a manager can', (await asManager('GET', '/api/fraud-detection/alerts')).status === 200)

// ── Approvals were already gated; this pins it so the menu and the API agree ──────────────────
check('approvals: still manager-only', (await asBudtender('GET', '/api/approvals')).status === 403)
check('approvals: a manager can read them', (await asManager('GET', '/api/approvals')).status === 200)

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
