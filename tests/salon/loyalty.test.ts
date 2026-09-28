// crm-salon — the loyalty programme, end to end.
//
// Salon is the first vertical to adopt the shared rules (src/shared → packages/tenant-backend/src/
// loyalty). The engine's own arithmetic is proven in tests/shared/loyalty-engine.test.ts; what is
// proven HERE is the wiring: that completing a visit actually earns, that the punch card fills, that
// redeeming spends, and that none of it can pay out twice.
//
// Two ways to earn, as asked for: points on what a client spends, and "6 cuts, 7th free".
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, serviceMenu, appointment, loyaltyMember, loyaltyTransaction, loyaltyReward } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Loyal Salon', slug: 'loyalsalon', email: 'loyal@test.local',
  settings: { loyalty: { pointsPerDollar: 1, welcomePoints: 0, punchCard: { visitsRequired: 6, rewardName: 'Free cut' } } },
  enabledFeatures: ['loyalty_rewards', 'salon_booking'],
} as any).returning()

const owner = (await db.insert(user).values({
  email: 'owner-loyal@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning())[0]

const [cut] = await db.insert(serviceMenu).values({
  name: 'Cut', price: '45', durationMin: 45, companyId: co.id,
} as any).returning()
const [colour] = await db.insert(serviceMenu).values({
  name: 'Colour', price: '90', durationMin: 90, companyId: co.id,
} as any).returning()

const [client] = await db.insert(contact).values({ name: 'Ada Client', type: 'client', companyId: co.id } as any).returning()

const app = new Hono()
app.route('/api/loyalty', (await import('./src/routes/loyalty.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

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

const { awardForCompletedVisit } = await import('./src/services/loyaltyAward.ts')

/** A completed visit, exactly as onVisitCompleted would report it. */
let visitNo = 0
const completeVisit = async (serviceId: string, price: number) => {
  visitNo++
  const [appt] = await db.insert(appointment).values({
    contactId: client.id, serviceId, companyId: co.id, status: 'completed',
    startTime: new Date(Date.now() - visitNo * 86400000), quotedPrice: String(price),
  } as any).returning()
  return { appt, result: await awardForCompletedVisit({
    companyId: co.id, contactId: client.id, appointmentId: appt.id, serviceId, price,
  }) }
}

const memberRow = async () => (await db.select().from(loyaltyMember)
  .where(and(eq(loyaltyMember.companyId, co.id), eq(loyaltyMember.contactId, client.id))).limit(1))[0]

// ─────────────────────────────────────────────────── earning enrols and pays
const v1 = await completeVisit(cut.id, 45)
check('earn: the first completed visit enrols the client', v1.result.awarded === true, v1.result)
check('earn: $45 at 1/dollar is 45 points', v1.result.points === 45, v1.result)
let m = await memberRow()
check('earn: the balance holds them', m.pointsBalance === 45, m)
check('earn: and the visit filled one punch', m.qualifyingVisits === 1, m)

// ───────────────────────────────────────── the same visit cannot pay twice
const replay = await awardForCompletedVisit({
  companyId: co.id, contactId: client.id, appointmentId: v1.appt.id, serviceId: cut.id, price: 45,
})
m = await memberRow()
check('idempotent: replaying the same appointment awards nothing', replay.awarded === false, replay)
check('idempotent: the balance did not move', m.pointsBalance === 45, m)
check('idempotent: the punch did not move either', m.qualifyingVisits === 1, m)

// ─────────────────────────────────────────────────────── the card fills up
for (let i = 0; i < 4; i++) await completeVisit(cut.id, 45)
m = await memberRow()
check('punch: 5 visits in', m.qualifyingVisits === 5, m)
let detail = await asOwner('GET', `/api/loyalty/members/${m.id}`)
check('punch: one visit to go, nothing owed yet',
  detail.json?.punchCard?.remaining === 1 && detail.json?.punchCard?.unclaimed === 0, detail.json?.punchCard)

const v6 = await completeVisit(colour.id, 90)
check('earn: a $90 colour earns 90', v6.result.points === 90, v6.result)
m = await memberRow()
check('earn: balance is 45*5 + 90 = 315', m.pointsBalance === 315, m)
detail = await asOwner('GET', `/api/loyalty/members/${m.id}`)
check('punch: the 6th visit completes a card', detail.json?.punchCard?.unclaimed === 1, detail.json?.punchCard)

// ──────────────────────────────────────── redeeming a card costs no points
const [freeCut] = await db.insert(loyaltyReward).values({
  companyId: co.id, name: 'Free cut', pointsCost: 0, type: 'free_item', valueCents: 0, serviceId: cut.id,
} as any).returning()

const onHouse = await asOwner('POST', `/api/loyalty/members/${m.id}/redeem`, {
  rewardId: freeCut.id, lines: [{ itemId: cut.id, amount: 45 }],
})
check('redeem: the completed card pays for the cut', onHouse.status === 200 && onHouse.json?.discount === 45, onHouse.json)
check('redeem: ...on the house — no points spent', onHouse.json?.onTheHouse === true && onHouse.json?.pointsSpent === 0, onHouse.json)
m = await memberRow()
check('redeem: the balance is untouched at 315', m.pointsBalance === 315, m)
check('redeem: the card is consumed, not reusable', m.punchRewardsEarned === 1, m)

const twice = await asOwner('POST', `/api/loyalty/members/${m.id}/redeem`, {
  rewardId: freeCut.id, lines: [{ itemId: cut.id, amount: 45 }],
})
check('redeem: the same card cannot buy a second free cut', twice.status === 400, twice.json)

// ────────────────────────────────────────────── points redeemed for money off
const [tenOff] = await db.insert(loyaltyReward).values({
  companyId: co.id, name: '$10 off', pointsCost: 200, type: 'fixed', valueCents: 1000,
} as any).returning()

const preview = await asOwner('POST', `/api/loyalty/members/${m.id}/redeem`, {
  rewardId: tenOff.id, lines: [{ itemId: colour.id, amount: 90 }], preview: true,
})
check('preview: says what it would take off without spending', preview.json?.discount === 10 && preview.json?.preview === true, preview.json)
m = await memberRow()
check('preview: really spent nothing', m.pointsBalance === 315, m)

const spend = await asOwner('POST', `/api/loyalty/members/${m.id}/redeem`, {
  rewardId: tenOff.id, lines: [{ itemId: colour.id, amount: 90 }],
})
check('redeem: $10 comes off', spend.json?.discount === 10, spend.json)
check('redeem: 200 points are spent', spend.json?.pointsBalance === 115, spend.json)

const tooDear = await asOwner('POST', `/api/loyalty/members/${m.id}/redeem`, {
  rewardId: tenOff.id, lines: [{ itemId: colour.id, amount: 90 }],
})
check('redeem: refused once they cannot afford it', tooDear.status === 400, tooDear.json)
check('redeem: ...and the refusal names both numbers', /200 points/.test(String(tooDear.json?.error)) && /has 115/.test(String(tooDear.json?.error)), tooDear.json)

// ─────────────────────────────────── a correction can be taken back again
const adj = await asOwner('POST', `/api/loyalty/members/${m.id}/adjust`, { points: -999999, reason: 'typo' })
check('adjust: an over-deduction floors at zero', adj.json?.pointsBalance === 0, adj.json)
check('adjust: it reports what was APPLIED, not what was typed', adj.json?.adjustment === -115, adj.json)
check('adjust: and keeps the requested figure for the audit trail', adj.json?.requested === -999999, adj.json)
const led = (await db.select().from(loyaltyTransaction).where(eq(loyaltyTransaction.memberId, m.id)))
  .filter((r: any) => r.type === 'adjustment_subtract')[0]
check('adjust: the ledger records the applied -115', Number(led?.points) === -115, led)

// ───────────────────────────────── the shop's own switch actually stops it
await db.update(company).set({
  settings: { loyalty: { enabled: false, pointsPerDollar: 1, punchCard: { visitsRequired: 6 } } },
} as any).where(eq(company.id, co.id))
const whenOff = await completeVisit(cut.id, 45)
check('switch: a switched-off programme earns nothing', whenOff.result.awarded === false, whenOff.result)
m = await memberRow()
check('switch: no points, no punch', m.pointsBalance === 0 && m.qualifyingVisits === 6, m)

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
