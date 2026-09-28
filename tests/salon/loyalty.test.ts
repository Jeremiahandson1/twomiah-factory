// crm-salon — the loyalty programme, end to end.
//
// Salon is the first vertical to adopt the shared rules (src/shared → packages/tenant-backend/src/
// loyalty). The engine's own arithmetic is proven in tests/shared/loyalty-engine.test.ts; what is
// proven HERE is the wiring: that completing a visit actually earns, that the punch card fills, that
// redeeming spends, and that none of it can pay out twice.
//
// Two ways to earn, as asked for: points on what a client spends, and "6 cuts, 7th free".
//
// The redemption half was rewritten after run LY0928, which broke it four ways at once — ten
// simultaneous requests spending 1,400 points from a 400-point balance (B1), one full card paying
// out twice (B2), points leaving the balance while the invoice never changed and the basket coming
// from the caller (H2), and a $10 reward costing 200 points against a $5 bill (M2). Every one of
// those has a test below that fails against the old shape.
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, serviceMenu, appointment, invoice, loyaltyMember, loyaltyTransaction, loyaltyReward } from './db/schema.ts'

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

/**
 * A completed visit and the bill it raised — the pair salonCheckout produces. The invoice matters:
 * a redemption now lands ON one, rather than returning a discount that exists nowhere. (LY0928 H2)
 */
let visitNo = 0
const completeVisit = async (serviceId: string, price: number, forContact = client) => {
  visitNo++
  const [appt] = await db.insert(appointment).values({
    contactId: forContact.id, serviceId, companyId: co.id, status: 'completed',
    startTime: new Date(Date.now() - visitNo * 86400000), quotedPrice: String(price),
  } as any).returning()
  const [bill] = await db.insert(invoice).values({
    number: `INV-${String(1000 + visitNo)}`, status: 'sent', companyId: co.id, contactId: forContact.id,
    appointmentId: appt.id, subtotal: price.toFixed(2), taxAmount: '0.00', discount: '0.00', total: price.toFixed(2),
  } as any).returning()
  return { appt, bill, result: await awardForCompletedVisit({
    companyId: co.id, contactId: forContact.id, appointmentId: appt.id, serviceId, price,
  }) }
}

const memberRow = async () => (await db.select().from(loyaltyMember)
  .where(and(eq(loyaltyMember.companyId, co.id), eq(loyaltyMember.contactId, client.id))).limit(1))[0]
const billRow = async (id: string) => (await db.select().from(invoice).where(eq(invoice.id, id)).limit(1))[0]

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
const filler: Awaited<ReturnType<typeof completeVisit>>[] = []
for (let i = 0; i < 4; i++) filler.push(await completeVisit(cut.id, 45))
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

// ───────────────────────────────── a redemption has to land on a real visit
const [tenOff] = await db.insert(loyaltyReward).values({
  companyId: co.id, name: '$10 off', pointsCost: 200, type: 'fixed', valueCents: 1000,
} as any).returning()

const noVisit = await asOwner('POST', `/api/loyalty/members/${m.id}/redeem`, { rewardId: tenOff.id })
check('redeem: refused with no visit named — a reward has to be applied to something', noVisit.status === 400, noVisit.json)

const madeUp = await asOwner('POST', `/api/loyalty/members/${m.id}/redeem`, {
  rewardId: tenOff.id, appointmentId: 'not-a-real-visit',
})
check('redeem: an invented visit id is refused, not trusted', madeUp.status === 404, madeUp.json)

const [other] = await db.insert(contact).values({ name: 'Bea Other', type: 'client', companyId: co.id } as any).returning()
const otherVisit = await completeVisit(cut.id, 45, other)
const wrongClient = await asOwner('POST', `/api/loyalty/members/${m.id}/redeem`, {
  rewardId: tenOff.id, appointmentId: otherVisit.appt.id,
})
check("redeem: someone else's visit is refused", wrongClient.status === 400 && /different client/i.test(String(wrongClient.json?.error)), wrongClient.json)

// ──────────────────────────────────────── redeeming a card costs no points
const [freeCut] = await db.insert(loyaltyReward).values({
  companyId: co.id, name: 'Free cut', pointsCost: 0, type: 'free_item', valueCents: 0, serviceId: cut.id,
} as any).returning()

// The card pays for a CUT, and visit 6 was a colour — so it goes against one of the cut visits.
const cardVisit = filler[0]
const onHouse = await asOwner('POST', `/api/loyalty/members/${m.id}/redeem`, {
  rewardId: freeCut.id, appointmentId: cardVisit.appt.id,
})
check('redeem: the completed card pays for the cut', onHouse.status === 200 && onHouse.json?.discount === 45, onHouse.json)
check('redeem: ...on the house — no points spent', onHouse.json?.onTheHouse === true && onHouse.json?.pointsSpent === 0, onHouse.json)
m = await memberRow()
check('redeem: the balance is untouched at 315', m.pointsBalance === 315, m)
check('redeem: the card is consumed, not reusable', m.punchRewardsEarned === 1, m)

// H2: the discount has to reach the bill, or it is a number in a response body and nothing else.
let paid = await billRow(cardVisit.bill.id)
check('redeem: the $45 is ON the invoice, not just in the reply', Number(paid.discount) === 45, paid)
check('redeem: ...and the total came down to match', Number(paid.total) === 0, paid)
const redeemRow = (await db.select().from(loyaltyTransaction).where(eq(loyaltyTransaction.memberId, m.id)))
  .filter((r: any) => r.type === 'punch_reward')[0]
check('redeem: the ledger row says which bill it came off', redeemRow?.invoiceId === cardVisit.bill.id, redeemRow)

const twice = await asOwner('POST', `/api/loyalty/members/${m.id}/redeem`, {
  rewardId: freeCut.id, appointmentId: filler[1].appt.id,
})
check('redeem: the same card cannot buy a second free cut', twice.status === 400, twice.json)

// ────────────────────────────────────────────── points redeemed for money off
const preview = await asOwner('POST', `/api/loyalty/members/${m.id}/redeem`, {
  rewardId: tenOff.id, appointmentId: v6.appt.id, preview: true,
})
check('preview: says what it would take off without spending', preview.json?.discount === 10 && preview.json?.preview === true, preview.json)
m = await memberRow()
check('preview: really spent nothing', m.pointsBalance === 315, m)

const spend = await asOwner('POST', `/api/loyalty/members/${m.id}/redeem`, {
  rewardId: tenOff.id, appointmentId: v6.appt.id,
})
check('redeem: $10 comes off', spend.json?.discount === 10, spend.json)
check('redeem: 200 points are spent', spend.json?.pointsBalance === 115, spend.json)
paid = await billRow(v6.bill.id)
check('redeem: the $90 colour now bills $80', Number(paid.discount) === 10 && Number(paid.total) === 80, paid)

// One reward per visit. The ledger's unique key on (member, type, visit) is what enforces it, and
// the transaction is what makes the refusal free — the points come back with it.
const [fiveOff] = await db.insert(loyaltyReward).values({
  companyId: co.id, name: '$5 off', pointsCost: 50, type: 'fixed', valueCents: 500,
} as any).returning()
const balBeforeStack = (await memberRow()).pointsBalance
const sameVisitAgain = await asOwner('POST', `/api/loyalty/members/${m.id}/redeem`, {
  rewardId: fiveOff.id, appointmentId: v6.appt.id,
})
check('redeem: one reward per visit — the second is refused, not stacked', sameVisitAgain.status === 409, sameVisitAgain.json)
check('redeem: ...and the refused attempt cost nothing', (await memberRow()).pointsBalance === balBeforeStack, await memberRow())
check('redeem: ...and left the bill where it was', Number((await billRow(v6.bill.id)).discount) === 10, await billRow(v6.bill.id))

const tooDear = await asOwner('POST', `/api/loyalty/members/${m.id}/redeem`, {
  rewardId: tenOff.id, appointmentId: filler[1].appt.id,
})
check('redeem: refused once they cannot afford it', tooDear.status === 400, tooDear.json)
check('redeem: ...and the refusal names both numbers', /200 points/.test(String(tooDear.json?.error)) && /has 115/.test(String(tooDear.json?.error)), tooDear.json)

// ── M2: a reward worth more than the bill is refused, not silently short-changed ───────────────
const smallVisit = await completeVisit(cut.id, 5)
m = await memberRow()
const topUp = await asOwner('POST', `/api/loyalty/members/${m.id}/adjust`, { points: 400, reason: 'test top-up' })
check('adjust: topped up for the next tests', topUp.json?.pointsBalance >= 400, topUp.json)
const overValue = await asOwner('POST', `/api/loyalty/members/${m.id}/redeem`, {
  rewardId: tenOff.id, appointmentId: smallVisit.appt.id,
})
check('M2: a $10 reward on a $5 bill is refused rather than costing full points',
  overValue.status === 400 && overValue.json?.code === 'reward_larger_than_bill', overValue.json)
m = await memberRow()
const beforeRace = m.pointsBalance
check('M2: ...and nothing was spent', beforeRace >= 400, m)
const smallBill = await billRow(smallVisit.bill.id)
check('M2: ...and the bill is untouched', Number(smallBill.discount) === 0, smallBill)

// ── B1: simultaneous redemptions cannot each spend the same balance ────────────────────────────
// LY0928 fired ten identical requests at a 400-point balance and seven of them succeeded — 1,400
// points and $70 off, because the check and the deduction were separate statements. A client of her
// own, on a balance set to exactly 400, so the arithmetic is not at the mercy of earlier tests.
// Each request lands on its OWN visit, so nothing but the balance limits them.
const [racer] = await db.insert(contact).values({ name: 'Cleo Race', type: 'client', companyId: co.id } as any).returning()
const memberFor = async (ct: any) => (await db.select().from(loyaltyMember)
  .where(and(eq(loyaltyMember.companyId, co.id), eq(loyaltyMember.contactId, ct.id))).limit(1))[0]

const raceVisits = []
for (let i = 0; i < 10; i++) raceVisits.push(await completeVisit(colour.id, 90, racer))
let racerM = await memberFor(racer)
await asOwner('POST', `/api/loyalty/members/${racerM.id}/adjust`, { points: 400 - racerM.pointsBalance, reason: 'set up the race' })
racerM = await memberFor(racer)
check('B1: the racing client starts on exactly 400 points', racerM.pointsBalance === 400, racerM)

const raceResults = await Promise.all(raceVisits.map((v) =>
  asOwner('POST', `/api/loyalty/members/${racerM.id}/redeem`, { rewardId: tenOff.id, appointmentId: v.appt.id }),
))
const won = raceResults.filter((r) => r.status === 200)
check('B1: only 2 of 10 simultaneous redemptions could be afforded at 200 points each',
  won.length === 2, { won: won.length, statuses: raceResults.map((r) => r.status) })
racerM = await memberFor(racer)
check('B1: the balance landed on zero, not below it', racerM.pointsBalance === 0, racerM)
const discounted = (await Promise.all(raceVisits.map((v) => billRow(v.bill.id))))
  .filter((b: any) => Number(b.discount) > 0)
check('B1: exactly as many bills were discounted as redemptions succeeded',
  discounted.length === won.length, { bills: discounted.length, won: won.length })

// ── B2: one full card pays out once, however many tills ask at the same moment ─────────────────
// Again a client of her own: exactly six qualifying visits, so exactly one card is owed.
const [carder] = await db.insert(contact).values({ name: 'Dee Card', type: 'client', companyId: co.id } as any).returning()
const cardRace = []
for (let i = 0; i < 6; i++) cardRace.push(await completeVisit(cut.id, 45, carder))
let carderM = await memberFor(carder)
detail = await asOwner('GET', `/api/loyalty/members/${carderM.id}`)
check('B2: six visits, one card owed', detail.json?.punchCard?.unclaimed === 1, detail.json?.punchCard)

const cardResults = await Promise.all(cardRace.slice(0, 3).map((v) =>
  asOwner('POST', `/api/loyalty/members/${carderM.id}/redeem`, { rewardId: freeCut.id, appointmentId: v.appt.id }),
))
const cardWon = cardResults.filter((r) => r.status === 200)
check('B2: one card, one free service — the other two are refused',
  cardWon.length === 1, { won: cardWon.length, statuses: cardResults.map((r) => r.status), bodies: cardResults.map((r) => r.json?.code) })
carderM = await memberFor(carder)
check('B2: the card counter moved by exactly one', carderM.punchRewardsEarned === 1, carderM)
const freeBills = (await Promise.all(cardRace.slice(0, 3).map((v) => billRow(v.bill.id))))
  .filter((b: any) => Number(b.discount) > 0)
check('B2: and exactly one bill was written off', freeBills.length === 1, freeBills.map((b: any) => b.discount))

// ─────────────────────────────────── a correction can be taken back again
m = await memberRow()
const balBeforeAdj = m.pointsBalance
const adj = await asOwner('POST', `/api/loyalty/members/${m.id}/adjust`, { points: -999999, reason: 'typo' })
check('adjust: an over-deduction floors at zero', adj.json?.pointsBalance === 0, adj.json)
check('adjust: it reports what was APPLIED, not what was typed', adj.json?.adjustment === -balBeforeAdj, { applied: adj.json?.adjustment, expected: -balBeforeAdj })
check('adjust: and keeps the requested figure for the audit trail', adj.json?.requested === -999999, adj.json)
const led = (await db.select().from(loyaltyTransaction).where(eq(loyaltyTransaction.memberId, m.id)))
  .filter((r: any) => r.type === 'adjustment_subtract').sort((a: any, b: any) => +b.createdAt - +a.createdAt)[0]
check('adjust: the ledger records what was applied', Number(led?.points) === -balBeforeAdj, led)

// ───────────────────────────────── the shop's own switch actually stops it
await db.update(company).set({
  settings: { loyalty: { enabled: false, pointsPerDollar: 1, punchCard: { visitsRequired: 6 } } },
} as any).where(eq(company.id, co.id))
const whenOff = await completeVisit(cut.id, 45)
check('switch: a switched-off programme earns nothing', whenOff.result.awarded === false, whenOff.result)
const mOff = await memberRow()
check('switch: no points earned', mOff.pointsBalance === 0, mOff)

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
