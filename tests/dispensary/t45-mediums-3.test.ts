// crm-dispensary — the third batch of T45 mediums.
//
//   M14  Multiplier events had no effect: a 1000x event earned 1x, because nothing anywhere read
//        bonus_multiplier when points were awarded. They also could not be listed once created (the
//        endpoint returned only the events running at that instant) or deleted.
//   M26  Platform health was permanently "unhealthy" for any shop without Metrc — no sync log meant
//        the expression fell through to unhealthy, and the whole roll-up with it.
//   L5   A challenge or event ending before it starts was accepted; it saved, listed, and quietly
//        never ran.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product, contact } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Batch Three Dispensary', slug: 'batchthree', email: 'b3@test.local', state: 'OH',
  purchaseLimitOz: '1', taxRate: '0', exciseTaxRate: '0',
  loyaltyEnabled: true, loyaltyPointsPerDollar: 1,
  settings: { loyalty: { enabled: true, pointsPerDollar: 1 } },
  enabledFeatures: ['products', 'orders', 'loyalty_rewards', 'gamified_loyalty', 'platform'],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-b3@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')

const [tee] = await db.insert(product).values({
  name: 'Logo Tee', companyId: co.id, category: 'merch', price: '50', stockQuantity: 100,
  active: true, visible: true, trackInventory: true,
} as any).returning()

const [cust] = await db.insert(contact).values({
  type: 'customer', name: 'Ada Customer', companyId: co.id, dateOfBirth: '1980-01-01',
} as any).returning()

const app = new Hono()
for (const [mount, file] of [
  ['/api/orders', 'orders'],
  ['/api/gamified-loyalty', 'gamified-loyalty'],
  ['/api/platform', 'platform'],
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
  return { status: res.status, text: t, json: j }
}
const asOwner = as(owner)
const asManager = as(manager)

const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
const pointsOf = async () => {
  const r = await rows(sql`SELECT points_balance FROM loyalty_members WHERE contact_id = ${cust.id}`)
  return Number(r[0]?.points_balance || 0)
}
const sell = async () => {
  const created = await asManager('POST', '/api/orders', {
    contactId: cust.id, type: 'walk_in', idVerified: true, paymentMethod: 'cash',
    items: [{ productId: tee.id, quantity: 1 }],
  })
  await asManager('POST', `/api/orders/${created.json?.id}/complete`, { paymentMethod: 'cash', idVerified: true })
  return created
}

// ── M14: a multiplier event has to actually multiply ────────────────────────────────────────────
await sell()
const basePoints = await pointsOf()
check('M14: setup — a $50 sale earns 50 points at 1 point a dollar', basePoints === 50, basePoints)

const event = await asManager('POST', '/api/gamified-loyalty/multiplier-events', {
  name: 'Double Points Weekend', multiplier: 3,
})
check('M14: a multiplier event is created', event.status === 201, { status: event.status, body: event.json })

await sell()
const afterEvent = await pointsOf()
check('M14: ...and the next sale earns the multiplied points, not 1x',
  afterEvent - basePoints === 150, { before: basePoints, after: afterEvent })

const ledger = await rows(sql`
  SELECT description FROM loyalty_transactions
  WHERE company_id = ${co.id} AND type = 'earn'
  ORDER BY created_at DESC LIMIT 1
`)
check('M14: ...and the ledger says why the award was bigger',
  String(ledger[0]?.description || '').includes('3x'), ledger[0])

// An event scheduled for next week must be visible the moment it is saved, and removable.
const scheduled = await asManager('POST', '/api/gamified-loyalty/multiplier-events', {
  name: 'Next Week', multiplier: 2,
  startDate: new Date(Date.now() + 7 * 86400000).toISOString(),
  endDate: new Date(Date.now() + 9 * 86400000).toISOString(),
})
check('M14: an event can be scheduled for later', scheduled.status === 201, { status: scheduled.status, body: scheduled.json })

const list = await asManager('GET', '/api/gamified-loyalty/multipliers')
const names = (Array.isArray(list.json) ? list.json : []).map((e: any) => e.name)
check('M14: ...and appears in the list rather than vanishing until it starts', names.includes('Next Week'), names)
check('M14: ...alongside the one that is running', names.includes('Double Points Weekend'), names)

const running = (Array.isArray(list.json) ? list.json : []).find((e: any) => e.name === 'Double Points Weekend')
check('M14: the list reports the real multiplier, in the shape the screen reads',
  Number(running?.bonusMultiplier) === 3, running)
check('M14: ...and says which one is actually running', running?.running === true, running)
const notYet = (Array.isArray(list.json) ? list.json : []).find((e: any) => e.name === 'Next Week')
check('M14: ...and which is not', notYet?.running === false, notYet)

const liveOnly = await asManager('GET', '/api/gamified-loyalty/multipliers?active=true')
check('M14: the live-only list is still available for anything that wants it',
  (Array.isArray(liveOnly.json) ? liveOnly.json : []).length === 1, liveOnly.json)

const removed = await asManager('DELETE', `/api/gamified-loyalty/challenges/${scheduled.json?.id}`)
check('M14: an event can be deleted', removed.status === 200 || removed.status === 204, { status: removed.status, body: removed.json })
const afterDelete = await asManager('GET', '/api/gamified-loyalty/multipliers')
check('M14: ...and is gone',
  !(Array.isArray(afterDelete.json) ? afterDelete.json : []).some((e: any) => e.name === 'Next Week'),
  afterDelete.json)

// Deleting the running event stops the bonus.
await asManager('DELETE', `/api/gamified-loyalty/challenges/${event.json?.id}`)
const beforeLast = await pointsOf()
await sell()
check('M14: with no event running, points go back to 1x', (await pointsOf()) - beforeLast === 50,
  { before: beforeLast, after: await pointsOf() })

// ── L5: a window that ends before it starts ─────────────────────────────────────────────────────
const backwardsEvent = await asManager('POST', '/api/gamified-loyalty/multiplier-events', {
  name: 'Backwards', multiplier: 2,
  startDate: new Date(Date.now() + 5 * 86400000).toISOString(),
  endDate: new Date(Date.now() + 1 * 86400000).toISOString(),
})
check('L5: an event ending before it starts is refused', backwardsEvent.status === 400, { status: backwardsEvent.status, body: backwardsEvent.json })

const backwardsChallenge = await asManager('POST', '/api/gamified-loyalty/challenges', {
  name: 'Backwards Challenge', type: 'visit_streak', rewardType: 'points', rewardValue: 100,
  startDate: new Date(Date.now() + 5 * 86400000).toISOString(),
  endDate: new Date(Date.now() + 1 * 86400000).toISOString(),
})
check('L5: ...and so is a challenge', backwardsChallenge.status === 400, { status: backwardsChallenge.status, body: backwardsChallenge.json })

// ── M26: a shop with no Metrc is not "unhealthy" ────────────────────────────────────────────────
const health = await app.request('/api/platform/health/status')
const healthJson: any = await health.json()
check('M26: health status answers', health.status === 200, { status: health.status })
const metrcService = (healthJson?.services || []).find((s: any) => s.service === 'metrc')
check('M26: a shop with no Metrc reports it as not configured, not unhealthy',
  metrcService?.status === 'not_configured', metrcService)
check('M26: ...so the platform overall is not permanently unhealthy',
  healthJson?.status !== 'unhealthy', { status: healthJson?.status, services: healthJson?.services })

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
