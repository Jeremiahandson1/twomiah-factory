// crm-salon — completing a visit, and un-completing one.
//
// Completing an appointment does three things at once: it raises the bill, it writes the visit
// record, and it awards loyalty. Run LY0928 found the third one guarded and the first two not:
//
//   H1  A double-click on Complete made two invoices, both numbered INV-00216, both $43.40, both
//       against the same appointment, created 2 ms apart — and Outstanding counted the visit twice.
//       Six simultaneous completions over the API made 2 invoices and 3 service records, inflating
//       the client's visit count, last-visit date and rebooking history by the difference.
//       "Loyalty did this right: the same six calls made one earn row, because earning is keyed to
//       the appointment in the database." So the fix is the one loyalty already had — a unique key.
//   M1  A completed visit flipped to cancelled kept its points and its punch, so completing and
//       cancelling the same appointment repeatedly could fill a card for free.
//   L1  Every earn row had appointmentId set and invoiceId null, even though the visit had raised
//       one, so "what did these points come from" could not be answered in money.
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, serviceMenu, appointment, invoice, serviceRecord, loyaltyMember, loyaltyTransaction } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Complete Salon', slug: 'completesalon', email: 'complete@test.local',
  settings: { loyalty: { pointsPerDollar: 1, punchCard: { visitsRequired: 6, rewardName: 'Free cut' } } },
  enabledFeatures: ['loyalty_rewards', 'salon_booking'],
} as any).returning()

const owner = (await db.insert(user).values({
  email: 'owner-complete@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning())[0]

const [cut] = await db.insert(serviceMenu).values({ name: 'Cut', price: '45', durationMin: 45, companyId: co.id } as any).returning()
const [client] = await db.insert(contact).values({ name: 'Ada Client', type: 'client', companyId: co.id } as any).returning()

const app = new Hono()
app.route('/api/appointments', (await import('./src/routes/appointments.ts')).default)
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

/** A booking in the past, so completing it is an ordinary afternoon rather than a future visit. */
let n = 0
const book = async () => {
  n++
  const start = new Date(Date.now() - n * 86400000)
  const [appt] = await db.insert(appointment).values({
    contactId: client.id, serviceId: cut.id, companyId: co.id, status: 'scheduled',
    startTime: start, endTime: new Date(start.getTime() + 45 * 60000), quotedPrice: '45',
  } as any).returning()
  return appt
}
const billsFor = (apptId: string) => db.select().from(invoice).where(eq(invoice.appointmentId, apptId))
const recordsFor = (apptId: string) => db.select().from(serviceRecord).where(eq(serviceRecord.appointmentId, apptId))
const ledgerFor = (apptId: string) => db.select().from(loyaltyTransaction).where(eq(loyaltyTransaction.appointmentId, apptId))
const memberRow = async () => (await db.select().from(loyaltyMember)
  .where(and(eq(loyaltyMember.companyId, co.id), eq(loyaltyMember.contactId, client.id))).limit(1))[0]

// ── H1: a double-click raises one bill ─────────────────────────────────────────────────────────
const doubled = await book()
const twoClicks = await Promise.all([
  asOwner('PUT', `/api/appointments/${doubled.id}`, { status: 'completed' }),
  asOwner('PUT', `/api/appointments/${doubled.id}`, { status: 'completed' }),
])
check('H1: both clicks are answered — neither is an error the stylist has to think about',
  twoClicks.every((r) => r.status === 200), twoClicks.map((r) => r.status))
const doubledBills = await billsFor(doubled.id)
check('H1: one visit, one bill', doubledBills.length === 1, doubledBills.map((b: any) => b.number))
const doubledRecords = await recordsFor(doubled.id)
check('H1: one visit, one visit record', doubledRecords.length === 1, doubledRecords.length)
check('H1: and one earn row, as it always was', (await ledgerFor(doubled.id)).length === 1)

// Six at once, which is what the report fired over the API.
const stormed = await book()
const six = await Promise.all(Array.from({ length: 6 }, () =>
  asOwner('PUT', `/api/appointments/${stormed.id}`, { status: 'completed' }),
))
check('H1: six simultaneous completions all answer 200', six.every((r) => r.status === 200), six.map((r) => r.status))
const stormedBills = await billsFor(stormed.id)
check('H1: ...and still raise exactly one bill', stormedBills.length === 1, stormedBills.map((b: any) => b.number))
check('H1: ...and exactly one visit record', (await recordsFor(stormed.id)).length === 1)
const allNumbers = (await db.select({ number: invoice.number }).from(invoice)).map((r: any) => r.number)
check('H1: no invoice number was handed out twice', new Set(allNumbers).size === allNumbers.length, allNumbers)

// A sequential re-flip is not a double-click and must stay harmless.
await asOwner('PUT', `/api/appointments/${stormed.id}`, { status: 'scheduled' })
await asOwner('PUT', `/api/appointments/${stormed.id}`, { status: 'completed' })
check('H1: completing again after reopening still leaves one bill', (await billsFor(stormed.id)).length === 1)

// ── L1: the earn row names the bill it came off ────────────────────────────────────────────────
const earn = (await ledgerFor(doubled.id)).find((r: any) => r.type === 'earn')
check('L1: the earn row is linked to the visit', earn?.appointmentId === doubled.id, earn)
check('L1: ...and to the bill that visit raised', earn?.invoiceId === doubledBills[0]?.id, { row: earn?.invoiceId, bill: doubledBills[0]?.id })

// ── M1: cancelling a completed visit gives the points back ─────────────────────────────────────
const before = await memberRow()
const toCancel = await book()
await asOwner('PUT', `/api/appointments/${toCancel.id}`, { status: 'completed' })
const earned = await memberRow()
check('M1: completing earned 45 points', earned.pointsBalance === before.pointsBalance + 45, { before: before.pointsBalance, after: earned.pointsBalance })
check('M1: ...and filled a punch', earned.qualifyingVisits === before.qualifyingVisits + 1, earned)

await asOwner('PUT', `/api/appointments/${toCancel.id}`, { status: 'cancelled' })
const reversed = await memberRow()
check('M1: cancelling gave the points back', reversed.pointsBalance === before.pointsBalance, { expected: before.pointsBalance, actual: reversed.pointsBalance })
check('M1: ...and the punch', reversed.qualifyingVisits === before.qualifyingVisits, reversed)
check('M1: ...and earned-to-date came down too, so the card cannot be filled by cancelling',
  reversed.lifetimePoints === before.lifetimePoints, { expected: before.lifetimePoints, actual: reversed.lifetimePoints })
const reversalRow = (await ledgerFor(toCancel.id)).find((r: any) => r.type === 'reversal')
check('M1: the ledger says what happened and why', Number(reversalRow?.points) === -45 && /cancelled/i.test(String(reversalRow?.description)), reversalRow)

// Cancelling and completing over and over must not ratchet anything up.
for (let i = 0; i < 4; i++) {
  await asOwner('PUT', `/api/appointments/${toCancel.id}`, { status: 'completed' })
  await asOwner('PUT', `/api/appointments/${toCancel.id}`, { status: 'cancelled' })
}
const churned = await memberRow()
check('M1: four more complete/cancel rounds left the balance exactly where it started',
  churned.pointsBalance === before.pointsBalance, { expected: before.pointsBalance, actual: churned.pointsBalance })
check('M1: ...and the card no further along', churned.qualifyingVisits === before.qualifyingVisits, churned)

// Reopening genuinely: complete it once more and leave it completed.
await asOwner('PUT', `/api/appointments/${toCancel.id}`, { status: 'completed' })
const recompleted = await memberRow()
check('M1: a genuine re-completion earns again — reversing is not a ban',
  recompleted.pointsBalance === before.pointsBalance + 45, { expected: before.pointsBalance + 45, actual: recompleted.pointsBalance })

// A no-show is a cancellation as far as the programme is concerned.
const noShow = await book()
await asOwner('PUT', `/api/appointments/${noShow.id}`, { status: 'completed' })
const beforeNoShow = await memberRow()
await asOwner('PUT', `/api/appointments/${noShow.id}`, { status: 'no_show' })
const afterNoShow = await memberRow()
check('M1: a completed visit marked a no-show gives its points back too',
  afterNoShow.pointsBalance === beforeNoShow.pointsBalance - 45, { before: beforeNoShow.pointsBalance, after: afterNoShow.pointsBalance })

// And cancelling from the list (DELETE) is the same act as cancelling in the book.
const viaDelete = await book()
await asOwner('PUT', `/api/appointments/${viaDelete.id}`, { status: 'completed' })
const beforeDelete = await memberRow()
await asOwner('DELETE', `/api/appointments/${viaDelete.id}`)
const afterDelete = await memberRow()
check('M1: cancelling from the list reverses it as well',
  afterDelete.pointsBalance === beforeDelete.pointsBalance - 45, { before: beforeDelete.pointsBalance, after: afterDelete.pointsBalance })

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
