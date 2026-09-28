// crm-salon — who may do what to the loyalty programme, and how a salon sets it up.
//
// Run LY0928 found the screens right and the server wrong. The Rewards tab is read-only for a manager
// and a stylist, with no Add form and no edit or delete icon — but the API let both of them create a
// reward and edit one (H3: "Any staff member could make a reward nearly free and redeem it"), and let
// a stylist adjust any client's balance (M4). The gates were written on `contacts:update`, which every
// stylist holds because a stylist keeps client cards up to date.
//
// Loyalty now has its own resource, split by what each act costs the business:
//
//   loyalty:read       see a balance, a card, the ledger, the reward list
//   loyalty:enroll     put a client on the programme
//   loyalty:redeem     spend what they earned, against a real visit
//   loyalty:adjust     hand-edit a balance — points out of nothing, so manager and up
//   loyalty:configure  the rate, the card, and the reward list itself — admin and up
//
// Every refusal below comes in a pair with the thing that rung still has to be able to do, because a
// front desk that cannot take a reward at checkout is a worse bug than the one being closed.
//
// The second half covers B3's other blocker: there was no way to configure the programme at all.
// PUT and PATCH /api/loyalty/config were 404, so the punch card sat at 0 visits — off — forever.
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
  name: 'Gated Salon', slug: 'gatedsalon', email: 'gated@test.local',
  settings: { loyalty: { pointsPerDollar: 1, punchCard: { visitsRequired: 0 } } },
  enabledFeatures: ['loyalty_rewards', 'salon_booking'],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-gated@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]

const owner = await mkUser('owner', 'owner')
const admin = await mkUser('admin', 'admin')
const manager = await mkUser('manager', 'manager')
const stylist = await mkUser('user', 'stylist')      // stored `user`, normalised to field
const frontDesk = await mkUser('viewer', 'frontdesk')

const [cut] = await db.insert(serviceMenu).values({ name: 'Cut', price: '45', durationMin: 45, companyId: co.id } as any).returning()
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
const asOwner = as(owner), asAdmin = as(admin), asManager = as(manager)
const asStylist = as(stylist), asFrontDesk = as(frontDesk)

const { awardForCompletedVisit } = await import('./src/services/loyaltyAward.ts')
let visitNo = 0
const completeVisit = async (price: number) => {
  visitNo++
  const [appt] = await db.insert(appointment).values({
    contactId: client.id, serviceId: cut.id, companyId: co.id, status: 'completed',
    startTime: new Date(Date.now() - visitNo * 86400000), quotedPrice: String(price),
  } as any).returning()
  const [bill] = await db.insert(invoice).values({
    number: `INV-G${1000 + visitNo}`, status: 'sent', companyId: co.id, contactId: client.id,
    appointmentId: appt.id, subtotal: price.toFixed(2), taxAmount: '0.00', discount: '0.00', total: price.toFixed(2),
  } as any).returning()
  await awardForCompletedVisit({ companyId: co.id, contactId: client.id, appointmentId: appt.id, serviceId: cut.id, price })
  return { appt, bill }
}

const v1 = await completeVisit(100)
const member = (await db.select().from(loyaltyMember)
  .where(and(eq(loyaltyMember.companyId, co.id), eq(loyaltyMember.contactId, client.id))).limit(1))[0]
check('setup: the visit enrolled the client on 100 points', member?.pointsBalance === 100, member)

// ── reading is open to everyone who works the salon ────────────────────────────────────────────
for (const [label, who] of [['a stylist', asStylist], ['the front desk', asFrontDesk], ['a manager', asManager]] as const) {
  check(`read: ${label} can see the members list`, (await who('GET', '/api/loyalty/members')).status === 200)
  check(`read: ${label} can see the reward list`, (await who('GET', '/api/loyalty/rewards')).status === 200)
  check(`read: ${label} can see what the programme is set to`, (await who('GET', '/api/loyalty/config')).status === 200)
}

// ── H3: the reward list is the programme's price list ─────────────────────────────────────────
const newReward = { name: 'Nearly free', pointsCost: 1, type: 'fixed' as const, value: 50, active: true }
const stylistCreate = await asStylist('POST', '/api/loyalty/rewards', newReward)
check('H3: a stylist cannot create a reward', stylistCreate.status === 403, stylistCreate.json)
const managerCreate = await asManager('POST', '/api/loyalty/rewards', newReward)
check('H3: neither can a manager', managerCreate.status === 403, managerCreate.json)
const deskCreate = await asFrontDesk('POST', '/api/loyalty/rewards', newReward)
check('H3: nor the front desk', deskCreate.status === 403, deskCreate.json)

const adminCreate = await asAdmin('POST', '/api/loyalty/rewards', { name: '$10 off', pointsCost: 200, type: 'fixed', value: 10, active: true })
check('H3: an admin can', adminCreate.status === 201, adminCreate.json)
const tenOff = adminCreate.json

const stylistEdit = await asStylist('PUT', `/api/loyalty/rewards/${tenOff.id}`, { ...newReward, name: '$50 off for 1 point' })
check('H3: a stylist cannot make an existing reward nearly free', stylistEdit.status === 403, stylistEdit.json)
const managerEdit = await asManager('PUT', `/api/loyalty/rewards/${tenOff.id}`, { ...newReward, name: '$50 off for 1 point' })
check('H3: neither can a manager', managerEdit.status === 403, managerEdit.json)
const managerDelete = await asManager('DELETE', `/api/loyalty/rewards/${tenOff.id}`)
check('H3: and a manager cannot delete one', managerDelete.status === 403, managerDelete.json)
const stillThere = await asOwner('GET', '/api/loyalty/rewards')
check('H3: the reward survived all of that unchanged',
  (stillThere.json?.data || []).some((r: any) => r.id === tenOff.id && r.pointsCost === 200), stillThere.json?.data)

// ── M4: a balance change out of nothing belongs with a manager ─────────────────────────────────
const stylistAdjust = await asStylist('POST', `/api/loyalty/members/${member.id}/adjust`, { points: 1, reason: 'test' })
check('M4: a stylist cannot adjust a balance', stylistAdjust.status === 403, stylistAdjust.json)
const deskAdjust = await asFrontDesk('POST', `/api/loyalty/members/${member.id}/adjust`, { points: 1, reason: 'test' })
check('M4: neither can the front desk', deskAdjust.status === 403, deskAdjust.json)
const managerAdjust = await asManager('POST', `/api/loyalty/members/${member.id}/adjust`, { points: 50, reason: 'goodwill' })
check('M4: a manager can — a correction is part of running the desk', managerAdjust.status === 200, managerAdjust.json)

// ...but redeeming is the till, and the till is the front desk and the stylist.
const v2 = await completeVisit(100)
const deskRedeem = await asFrontDesk('POST', `/api/loyalty/members/${member.id}/redeem`, {
  rewardId: tenOff.id, appointmentId: v2.appt.id,
})
check('M4: the front desk can still take a reward at checkout', deskRedeem.status === 200, deskRedeem.json)
const v3 = await completeVisit(100)
await asManager('POST', `/api/loyalty/members/${member.id}/adjust`, { points: 100, reason: 'top up for the next test' })
const stylistRedeem = await asStylist('POST', `/api/loyalty/members/${member.id}/redeem`, {
  rewardId: tenOff.id, appointmentId: v3.appt.id,
})
check('M4: and so can a stylist checking their own client out', stylistRedeem.status === 200, stylistRedeem.json)

// M3: the refusal a stylist reads has to be in this trade's words, not a shop's.
const v4 = await completeVisit(100)
const brokeRedeem = await asStylist('POST', `/api/loyalty/members/${member.id}/redeem`, {
  rewardId: tenOff.id, appointmentId: v4.appt.id,
})
check('M3: a refusal at the desk says "client", not "customer"',
  /the client has/i.test(String(brokeRedeem.json?.error)) && !/customer/i.test(String(brokeRedeem.json?.error)), brokeRedeem.json)

// Enrolling a walk-in is desk work too.
const [walkIn] = await db.insert(contact).values({ name: 'Bea Walkin', type: 'client', companyId: co.id } as any).returning()
const deskEnrol = await asFrontDesk('POST', '/api/loyalty/members', { contactId: walkIn.id })
check('M4: the front desk can put a walk-in on the programme', deskEnrol.status === 201, deskEnrol.json)

// ── B3 / L4: the programme can be set up from the CRM ──────────────────────────────────────────
const managerConfig = await asManager('PUT', '/api/loyalty/config', { loyaltyPointsPerDollar: 99 })
check('B3: a manager cannot change the earn rate', managerConfig.status === 403, managerConfig.json)

const setUp = await asAdmin('PUT', '/api/loyalty/config', {
  loyaltyEnabled: true,
  loyaltyPointsPerDollar: 2,
  loyaltyWelcomePoints: 25,
  loyaltyBirthdayBonus: 100,
  loyaltyPunchCard: { visitsRequired: 6, rewardName: 'Free cut', qualifyingServiceIds: [cut.id] },
})
check('B3: an admin can set the programme up in one call', setUp.status === 200, setUp.json)
check('B3: the punch card is no longer stuck at 0 visits', setUp.json?.loyaltyPunchCard?.visitsRequired === 6, setUp.json?.loyaltyPunchCard)
check('B3: the card names what it pays for', setUp.json?.loyaltyPunchCard?.rewardName === 'Free cut', setUp.json?.loyaltyPunchCard)
check('B3: only the named services fill it', JSON.stringify(setUp.json?.loyaltyPunchCard?.qualifyingServiceIds) === JSON.stringify([cut.id]), setUp.json?.loyaltyPunchCard)
check('L4: the welcome bonus is settable', setUp.json?.loyaltyWelcomePoints === 25, setUp.json)
check('L4: and so is the birthday bonus', setUp.json?.loyaltyBirthdayBonus === 100, setUp.json)

const readBack = await asOwner('GET', '/api/loyalty/config')
check('B3: what was saved is what reads back', readBack.json?.loyaltyPointsPerDollar === 2 && readBack.json?.loyaltyWelcomePoints === 25, readBack.json)

// One switch at a time, without resending the whole programme.
const justOff = await asAdmin('PUT', '/api/loyalty/config', { loyaltyEnabled: false })
check('B3: the shop can switch the programme off on its own', justOff.json?.loyaltyEnabled === false, justOff.json)
check('B3: ...without losing the card it had set up', justOff.json?.loyaltyPunchCard?.visitsRequired === 6, justOff.json?.loyaltyPunchCard)
check('B3: ...or the earn rate', justOff.json?.loyaltyPointsPerDollar === 2, justOff.json)

const strangerService = await asAdmin('PUT', '/api/loyalty/config', {
  loyaltyPunchCard: { qualifyingServiceIds: ['not-on-the-menu'] },
})
check('B3: a card cannot be pinned to a service the salon does not offer',
  strangerService.status === 400 && strangerService.json?.code === 'unknown_service', strangerService.json)

// ── L2: a correction still works with the programme off, and says so ───────────────────────────
const offAdjust = await asManager('POST', `/api/loyalty/members/${member.id}/adjust`, { points: -10, reason: 'mistake made while it was on' })
check('L2: a correction is still possible with the programme switched off', offAdjust.status === 200, offAdjust.json)
check('L2: ...and the answer says the programme is off, so the desk is not misled',
  offAdjust.json?.programmeOff === true, offAdjust.json)

// ── L3: a floored deduction does not erase what visits earned ──────────────────────────────────
await asAdmin('PUT', '/api/loyalty/config', { loyaltyEnabled: true })
const before = (await db.select().from(loyaltyMember).where(eq(loyaltyMember.id, member.id)).limit(1))[0]
// However much of this lifetime figure came from a manager's pen rather than from the chair — that
// and only that is what a correction may take back.
const fromAdjustments = (await db.select().from(loyaltyTransaction).where(eq(loyaltyTransaction.memberId, member.id)))
  .filter((r: any) => r.type === 'adjustment_add' || r.type === 'adjustment_subtract')
  .reduce((sum: number, r: any) => sum + Number(r.points), 0)
check('L3: setup — corrections have put points in, so there is something to take back', fromAdjustments > 0, fromAdjustments)
const wipe = await asManager('POST', `/api/loyalty/members/${member.id}/adjust`, { points: -999999, reason: 'typo' })
check('L3: an over-deduction still floors the balance at zero', wipe.json?.pointsBalance === 0, wipe.json)
const after = (await db.select().from(loyaltyMember).where(eq(loyaltyMember.id, member.id)).limit(1))[0]
check('L3: earned-to-date lost only what corrections had added',
  after.lifetimePoints === before.lifetimePoints - fromAdjustments,
  { before: before.lifetimePoints, after: after.lifetimePoints, expected: before.lifetimePoints - fromAdjustments })
check('L3: ...so what the chair earned is still on the record', after.lifetimePoints > 0, after)

const againWipe = await asManager('POST', `/api/loyalty/members/${member.id}/adjust`, { points: -999999, reason: 'again' })
check('L3: a second wipe takes nothing more off the lifetime figure',
  (await db.select().from(loyaltyMember).where(eq(loyaltyMember.id, member.id)).limit(1))[0].lifetimePoints === after.lifetimePoints,
  againWipe.json)

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
