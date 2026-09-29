// crm-salon — the loyalty retest (LYR, 28 Sep).
//
// Seven findings, and every one of them is about a number the salon shows to a client or puts in its
// books. They are tested here rather than folded into loyalty.test.ts because five of the seven live
// OUTSIDE the loyalty routes — in the bill the redemption edits, in the delete that voids a sale, in
// the cancel that does not:
//
//   N1  A reward came off the services and not off the tax. A client told the cut was on the house
//       was handed a $2.98 bill — tax on $35 of services they were not charged for.
//   N2  A reward could be applied to a visit the client had already paid for. The total dropped below
//       what they handed over and the difference was recorded nowhere.
//   N3  Removing a duplicate service record voided the sale the surviving record still needed, and
//       left a real 27 Sep visit $37.98 unbilled.
//   L3  A correction reversed after an earlier one had been floored gave back points to
//       earned-to-date that no visit ever earned.
//   L4  The welcome bonus was saved, read back, and never granted on the path almost every client
//       joins by. The birthday bonus was granted nowhere at all.
//   N4  "Another till may have just claimed it." A salon has a front desk.
//   N5  Cancelling a completed visit gave back the points and left the bill in Outstanding.
import { Hono } from 'hono'
import { eq, and, sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import {
  company, user, contact, serviceMenu, appointment, invoice, serviceRecord,
  loyaltyMember, loyaltyTransaction, loyaltyReward, clientProfile,
} from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}
const rows = (r: any): any[] => ((r as any)?.rows || r) as any[]
const money = (v: any) => Math.round(Number(v || 0) * 100) / 100

await setupSchema()

// Bonuses start OFF, which is the default a shop that has configured nothing gets. L4 switches them
// on at the end, so every figure before that is the spend and nothing else.
const [co] = await db.insert(company).values({
  name: 'Retest Salon', slug: 'lyrsalon', email: 'lyr@test.local',
  settings: { loyalty: { pointsPerDollar: 1, welcomePoints: 0, birthdayBonus: 0, punchCard: { visitsRequired: 0 } } },
  enabledFeatures: ['loyalty_rewards', 'salon_booking', 'contacts'],
} as any).returning()

const [owner] = await db.insert(user).values({
  email: 'owner-lyr@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()

const [cut] = await db.insert(serviceMenu).values({ name: "Men's Cut", price: '35', durationMin: 30, companyId: co.id } as any).returning()

const app = new Hono()
app.route('/api/loyalty', (await import('./src/routes/loyalty.ts')).default)
app.route('/api/appointments', (await import('./src/routes/appointments.ts')).default)
app.route('/api/service-records', (await import('./src/routes/serviceRecords.ts')).default)
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

const { awardForCompletedVisit } = await import('./src/services/loyaltyAward.ts')

// A salon keeps the birthday on the client's profile — beside the allergies and the patch-test date
// — not on the contact row, so a client with one has both.
const mkClient = async (name: string, birthday?: string) => {
  const [row] = await db.insert(contact).values({ companyId: co.id, name, type: 'client' } as any).returning()
  if (birthday) await db.insert(clientProfile).values({ companyId: co.id, contactId: row.id, birthday } as any)
  return row
}

/**
 * A completed visit and the bill it raised, written straight to the tables — the pair the book
 * produces. Written directly rather than through the API so each case can pin the tax rate, the
 * amount taken, and the status it needs.
 */
let visitNo = 0
const completedVisit = async (client: any, o: { price: number; taxRate?: number; paid?: number; status?: string } = { price: 35 }) => {
  visitNo++
  const price = o.price
  const rate = o.taxRate ?? 0
  const tax = Math.round(price * (rate / 100) * 100) / 100
  const [appt] = await db.insert(appointment).values({
    contactId: client.id, serviceId: cut.id, companyId: co.id, status: 'completed',
    startTime: new Date(Date.now() - visitNo * 86400000), quotedPrice: String(price),
  } as any).returning()
  const [bill] = await db.insert(invoice).values({
    number: `INV-${String(200 + visitNo).padStart(5, '0')}`, status: o.status || 'open',
    companyId: co.id, contactId: client.id, appointmentId: appt.id,
    subtotal: price.toFixed(2), taxRate: String(rate), taxAmount: tax.toFixed(2), discount: '0.00',
    total: (price + tax).toFixed(2), amountPaid: (o.paid ?? 0).toFixed(2), amountRefunded: '0.00',
    notes: 'Created from the appointment book',
  } as any).returning()
  return { appt, bill }
}

const memberFor = async (client: any) => (await db.select().from(loyaltyMember)
  .where(and(eq(loyaltyMember.companyId, co.id), eq(loyaltyMember.contactId, client.id))).limit(1))[0]
const billRow = async (id: string) => (await db.select().from(invoice).where(eq(invoice.id, id)).limit(1))[0]
const ledgerFor = async (memberId: string) => await db.select().from(loyaltyTransaction)
  .where(eq(loyaltyTransaction.memberId, memberId))

// A $10 reward off the bill, costing 100 points.
const [tenOff] = await db.insert(loyaltyReward).values({
  companyId: co.id, name: '$10 off', type: 'fixed', valueCents: 1000, pointsCost: 100, active: true,
} as any).returning()

// ═══════════════════════════════════════════════════════ N1 · tax follows the discount ═══════════
{
  const client = await mkClient('LYR November')
  const v = await completedVisit(client, { price: 100, taxRate: 8.5 })
  await awardForCompletedVisit({ companyId: co.id, contactId: client.id, appointmentId: v.appt.id, serviceId: cut.id, price: 100, invoiceId: v.bill.id })
  const m = await memberFor(client)
  check('N1: the visit earned enough to redeem with', m.pointsBalance >= 100, m?.pointsBalance)

  const before = await billRow(v.bill.id)
  check('N1: the bill starts at $100 + 8.5% = $108.50', money(before.total) === 108.50 && money(before.taxAmount) === 8.50, before)

  const r = await api('POST', `/api/loyalty/members/${m.id}/redeem`, { rewardId: tenOff.id, appointmentId: v.appt.id })
  check('N1: the redemption is accepted', r.status === 200, { status: r.status, body: r.json })

  const after = await billRow(v.bill.id)
  check('N1: $10 comes off the services', money(after.discount) === 10, after?.discount)
  check('N1: …and the tax is reassessed on the $90 actually charged — 8.5% of 90 is $7.65',
    money(after.taxAmount) === 7.65, { taxAmount: after?.taxAmount, want: 7.65 })
  check('N1: …so the client owes $97.65, not $98.50 with tax on services they were not charged for',
    money(after.total) === 97.65, { total: after?.total, want: 97.65 })
  check('N1: and the total is exactly the discounted services plus the new tax',
    money(after.total) === money(money(after.subtotal) - money(after.discount) + money(after.taxAmount)), after)
}

// A bill with no tax rate at all must be untouched by the new arithmetic.
{
  const client = await mkClient('LYR Oscar')
  const v = await completedVisit(client, { price: 100, taxRate: 0 })
  await awardForCompletedVisit({ companyId: co.id, contactId: client.id, appointmentId: v.appt.id, serviceId: cut.id, price: 100, invoiceId: v.bill.id })
  const m = await memberFor(client)
  await api('POST', `/api/loyalty/members/${m.id}/redeem`, { rewardId: tenOff.id, appointmentId: v.appt.id })
  const after = await billRow(v.bill.id)
  check('N1: a salon that charges no tax still just pays $10 less', money(after.total) === 90 && money(after.taxAmount) === 0, after)
}

// ═══════════════════════════════════════════════════ N2 · a settled bill refuses ═════════════════
{
  const client = await mkClient('LYR Papa')
  // Paid in full at the desk, then someone remembers the reward.
  const v = await completedVisit(client, { price: 35, taxRate: 8.5, paid: 37.98, status: 'paid' })
  await awardForCompletedVisit({ companyId: co.id, contactId: client.id, appointmentId: v.appt.id, serviceId: cut.id, price: 35, invoiceId: v.bill.id })
  const m = await memberFor(client)
  await db.update(loyaltyMember).set({ pointsBalance: 500, lifetimePoints: 500 } as any).where(eq(loyaltyMember.id, m.id))

  const visits = await api('GET', `/api/loyalty/members/${m.id}/visits`)
  const row = (visits.json?.data || []).find((x: any) => x.appointmentId === v.appt.id)
  check('N2: the paid visit is still listed, so the desk can see it exists', !!row, visits.json)
  check('N2: …and it is marked settled, with the reason visible rather than hidden', row?.settled === true, row)

  const r = await api('POST', `/api/loyalty/members/${m.id}/redeem`, { rewardId: tenOff.id, appointmentId: v.appt.id })
  check('N2: redeeming against it is refused', r.status === 400, { status: r.status, body: r.json })
  check('N2: …with a code the screen can act on', r.json?.code === 'invoice_already_paid', r.json)
  check('N2: …naming the bill and what to do instead', /INV-/.test(String(r.json?.error)) && /credit|refund/i.test(String(r.json?.error)), r.json?.error)

  const after = await billRow(v.bill.id)
  check('N2: the bill is untouched — no total below what the client handed over', money(after.total) === 37.98 && money(after.discount) === 0, after)
  const m2 = await memberFor(client)
  check('N2: …and no points were taken for a discount that never happened', m2.pointsBalance === 500, m2?.pointsBalance)
}

// Paid in full WITHOUT the status having caught up is the same thing, and money says so.
{
  const client = await mkClient('LYR Quebec')
  const v = await completedVisit(client, { price: 35, taxRate: 0, paid: 35, status: 'open' })
  await awardForCompletedVisit({ companyId: co.id, contactId: client.id, appointmentId: v.appt.id, serviceId: cut.id, price: 35, invoiceId: v.bill.id })
  const m = await memberFor(client)
  await db.update(loyaltyMember).set({ pointsBalance: 500 } as any).where(eq(loyaltyMember.id, m.id))
  const r = await api('POST', `/api/loyalty/members/${m.id}/redeem`, { rewardId: tenOff.id, appointmentId: v.appt.id })
  check('N2: a bill paid in full refuses even while its status still says open', r.json?.code === 'invoice_already_paid', { status: r.status, body: r.json })
}

// A part payment is NOT settled: there is still something to take the reward off.
{
  const client = await mkClient('LYR Romeo')
  const v = await completedVisit(client, { price: 100, taxRate: 0, paid: 20, status: 'open' })
  await awardForCompletedVisit({ companyId: co.id, contactId: client.id, appointmentId: v.appt.id, serviceId: cut.id, price: 100, invoiceId: v.bill.id })
  const m = await memberFor(client)
  await db.update(loyaltyMember).set({ pointsBalance: 500 } as any).where(eq(loyaltyMember.id, m.id))
  const r = await api('POST', `/api/loyalty/members/${m.id}/redeem`, { rewardId: tenOff.id, appointmentId: v.appt.id })
  check('N2: a part-paid bill still takes the reward — there is a balance to discount', r.status === 200, { status: r.status, body: r.json })
  check('N2: …and it comes off the total', money((await billRow(v.bill.id)).total) === 90, await billRow(v.bill.id))
}

// ═══════════════════════════════════════════ L3 · a floor does not create earned points ══════════
{
  const client = await mkClient('LYR India')
  const v = await completedVisit(client, { price: 35 })
  await awardForCompletedVisit({ companyId: co.id, contactId: client.id, appointmentId: v.appt.id, serviceId: cut.id, price: 35, invoiceId: v.bill.id })
  const m = await memberFor(client)
  const adjust = (points: number) => api('POST', `/api/loyalty/members/${m.id}/adjust`, { points, reason: 'retest' })
  const state = async () => { const r = await memberFor(client); return `${r.pointsBalance} / ${r.lifetimePoints}` }

  check('L3: one $35 visit — 35 / 35', (await state()) === '35 / 35', await state())

  await adjust(5000); await adjust(-5000)
  check('L3: a correction added and taken straight back leaves both where they were', (await state()) === '35 / 35', await state())

  await adjust(-999999)
  check('L3: a floor empties the balance and leaves earned-to-date alone', (await state()) === '0 / 35', await state())

  await adjust(100)
  check('L3: +100 moves both', (await state()) === '100 / 135', await state())

  await adjust(-100)
  check('L3: …and taking it back returns to 0 / 35, not 0 / 70 — the floor removed nothing from earned-to-date, so nothing is owed back for it',
    (await state()) === '0 / 35', await state())

  // Juliet's shorter sequence from the same report.
  const juliet = await mkClient('LYR Juliet')
  const jv = await completedVisit(juliet, { price: 5 })
  await awardForCompletedVisit({ companyId: co.id, contactId: juliet.id, appointmentId: jv.appt.id, serviceId: cut.id, price: 5, invoiceId: jv.bill.id })
  const jm = await memberFor(juliet)
  const jAdjust = (points: number) => api('POST', `/api/loyalty/members/${jm.id}/adjust`, { points, reason: 'retest' })
  await jAdjust(-999999); await jAdjust(5000); await jAdjust(-5000)
  const jr = await memberFor(juliet)
  check('L3: Juliet — floor, then +5,000 and −5,000, leaves earned-to-date at 5 and not 10',
    jr.pointsBalance === 0 && jr.lifetimePoints === 5, { balance: jr.pointsBalance, lifetime: jr.lifetimePoints })

  // A correction can still take back everything corrections put in, which is what the clamp is for.
  const kilo = await mkClient('LYR Kilo Adjust')
  const kv = await completedVisit(kilo, { price: 20 })
  await awardForCompletedVisit({ companyId: co.id, contactId: kilo.id, appointmentId: kv.appt.id, serviceId: cut.id, price: 20, invoiceId: kv.bill.id })
  const km = await memberFor(kilo)
  await api('POST', `/api/loyalty/members/${km.id}/adjust`, { points: 60, reason: 'goodwill' })
  await api('POST', `/api/loyalty/members/${km.id}/adjust`, { points: -80, reason: 'undo the goodwill' })
  const kr = await memberFor(kilo)
  check('L3: a correction still cannot eat the points a visit earned', kr.lifetimePoints === 20, { lifetime: kr.lifetimePoints, want: 20 })
  check('L3: …while the balance clamps at zero as it always did', kr.pointsBalance === 0, kr?.pointsBalance)
}

// ═════════════════════════════ N3 · removing a duplicate does not void the sale ══════════════════
{
  const client = await mkClient('LYR Bravo')
  const v = await completedVisit(client, { price: 35, taxRate: 8.5 })   // $37.98, the tenant's figure
  check('N3: the visit is billed $37.98', money(v.bill.total) === 37.98, v.bill?.total)

  // Two records against one sale. The literal shape LY0928 left — three records all naming the same
  // APPOINTMENT — can no longer be built: service_record_appointment_unique (company, appointment)
  // was added after that run and is what stopped the duplicates recurring. What is still reachable,
  // and is the same defect, is two records pointing at one INVOICE, which is how a visit logged
  // without an appointment is filed. Deleting either must not take the bill the other one needs.
  const [withAppt] = await db.insert(serviceRecord).values({
    companyId: co.id, contactId: client.id, appointmentId: v.appt.id, serviceId: cut.id,
    performedAt: new Date(Date.now() - 86400000), priceCharged: '35', invoiceId: v.bill.id,
  } as any).returning()
  const [extra] = await db.insert(serviceRecord).values({
    companyId: co.id, contactId: client.id, serviceId: cut.id,
    performedAt: new Date(Date.now() - 86400000), priceCharged: '35', invoiceId: v.bill.id,
  } as any).returning()

  const d1 = await api('DELETE', `/api/service-records/${extra.id}`)
  check('N3: deleting one of two records filed against the same sale is allowed', d1.status === 200, { status: d1.status, body: d1.json })
  check('N3: …and it does NOT void that sale', d1.json?.voidedInvoice === null, d1.json)
  check('N3: …the bill is still open, still $37.98 — the visit it belongs to is right there',
    (await billRow(v.bill.id)).status === 'open', await billRow(v.bill.id))

  // The last one standing IS the visit, so the H3 rule applies again.
  const d3 = await api('DELETE', `/api/service-records/${withAppt.id}`)
  check('N3: deleting the LAST record still voids the sale — H3 is intact', d3.json?.voidedInvoice?.id === v.bill.id, d3.json)
  check('N3: …and the bill is void', (await billRow(v.bill.id)).status === 'void', await billRow(v.bill.id))
}

// …and the repair puts back what the old rule voided while the visit was still there.
{
  const client = await mkClient('LYR Bravo Repair')
  const v = await completedVisit(client, { price: 35, taxRate: 8.5 })
  await db.insert(serviceRecord).values({
    companyId: co.id, contactId: client.id, appointmentId: v.appt.id, serviceId: cut.id,
    performedAt: new Date(Date.now() - 86400000), priceCharged: '35', invoiceId: v.bill.id,
  } as any)
  // Exactly what the old delete rule left on INV-00204.
  await db.execute(sql`
    UPDATE invoice SET status = 'void',
      notes = COALESCE(notes, '') || E'\nVoided: the visit it was raised from was deleted'
    WHERE id = ${v.bill.id}
  `)

  // A bill a person voided deliberately, with its visit still there — never ours to touch.
  const other = await mkClient('LYR Sierra')
  const ov = await completedVisit(other, { price: 50 })
  await db.insert(serviceRecord).values({
    companyId: co.id, contactId: other.id, appointmentId: ov.appt.id, serviceId: cut.id,
    performedAt: new Date(Date.now() - 86400000), priceCharged: '50', invoiceId: ov.bill.id,
  } as any)
  await db.update(invoice).set({ status: 'void', notes: 'Voided by the manager — client disputed it' } as any).where(eq(invoice.id, ov.bill.id))

  const r = await api('POST', '/api/service-records/repair-legacy')
  check('N3: the repair runs', r.status === 200, { status: r.status, body: r.json })
  check('N3: …and restores the one sale whose visit never went anywhere', r.json?.invoicesRestored === 1, r.json)
  const fixed = await billRow(v.bill.id)
  check('N3: …to open, so the $37.98 is owed again', fixed.status === 'open', fixed?.status)
  check('N3: …with the untrue note gone', !String(fixed.notes || '').includes('was deleted'), fixed?.notes)
  check('N3: …and the note it came with kept', String(fixed.notes || '') === 'Created from the appointment book', fixed?.notes)
  check('N3: a bill a person voided on purpose is left alone', (await billRow(ov.bill.id)).status === 'void', await billRow(ov.bill.id))

  const again = await api('POST', '/api/service-records/repair-legacy')
  check('N3: running the repair again restores nothing — it is idempotent', again.json?.invoicesRestored === 0, again.json)
}

// ═══════════════════════════ N5 · cancelling a visit takes its bill with it ══════════════════════
{
  const client = await mkClient('LYR Hotel')
  const [appt] = await db.insert(appointment).values({
    contactId: client.id, serviceId: cut.id, companyId: co.id, status: 'scheduled',
    startTime: new Date(Date.now() - 86400000), endTime: new Date(Date.now() - 86400000 + 1800000),
    quotedPrice: '65',
  } as any).returning()

  const done = await api('PUT', `/api/appointments/${appt.id}`, { status: 'completed' })
  check('N5: completing the visit raises the bill', done.status === 200 && !!done.json?.invoiceId, { status: done.status, invoiceId: done.json?.invoiceId })
  const billId = done.json.invoiceId as string
  check('N5: …open, and owed', (await billRow(billId)).status === 'open', await billRow(billId))

  const cancelled = await api('PUT', `/api/appointments/${appt.id}`, { status: 'cancelled' })
  check('N5: cancelling is accepted', cancelled.status === 200, cancelled.status)
  const voided = await billRow(billId)
  check('N5: …and the bill goes with it, instead of sitting in Outstanding for a visit that did not happen',
    voided.status === 'void', voided?.status)
  check('N5: …voided, not deleted — the number and the trail survive', !!voided.number, voided?.number)
  check('N5: …and it says why', String(voided.notes || '').includes('the appointment it was raised from was cancelled'), voided?.notes)
  const m = await memberFor(client)
  check('N5: the points came back too, as they already did', m.pointsBalance === 0, m?.pointsBalance)

  // Completing it again puts the same bill back rather than raising a second one.
  const redone = await api('PUT', `/api/appointments/${appt.id}`, { status: 'completed' })
  check('N5: completing again is accepted', redone.status === 200, redone.status)
  const back = await billRow(billId)
  check('N5: …the same bill is open again', back.status === 'open', back?.status)
  check('N5: …the cancellation note is gone with it', !String(back.notes || '').includes('was cancelled'), back?.notes)
  const all = await db.select().from(invoice).where(eq(invoice.appointmentId, appt.id))
  check('N5: …and there is still only one bill for the visit', all.length === 1, all.map((b: any) => b.number))
}

// Money already collected stops the void: that is a refund decision, not a status flip.
{
  const client = await mkClient('LYR Tango')
  const [appt] = await db.insert(appointment).values({
    contactId: client.id, serviceId: cut.id, companyId: co.id, status: 'scheduled',
    startTime: new Date(Date.now() - 86400000), endTime: new Date(Date.now() - 86400000 + 1800000), quotedPrice: '65',
  } as any).returning()
  const done = await api('PUT', `/api/appointments/${appt.id}`, { status: 'completed' })
  const billId = done.json.invoiceId as string
  await db.update(invoice).set({ amountPaid: '65.00', status: 'paid' } as any).where(eq(invoice.id, billId))

  await api('PUT', `/api/appointments/${appt.id}`, { status: 'cancelled' })
  const held = await billRow(billId)
  check('N5: a bill holding the client\'s money is NOT voided by a cancellation', held.status === 'paid', held?.status)
  check('N5: …and nothing was written on it', !String(held.notes || '').includes('was cancelled'), held?.notes)
}

// ═══════════════════════════════ L4 · the bonuses the settings screen promises ═══════════════════
const thisMonth = String(new Date().getMonth() + 1).padStart(2, '0')
await db.update(company).set({
  settings: { loyalty: { pointsPerDollar: 1, welcomePoints: 50, birthdayBonus: 25, punchCard: { visitsRequired: 0 } } },
} as any).where(eq(company.id, co.id))

{
  const lima = await mkClient('LYR Lima')
  const v = await completedVisit(lima, { price: 45 })
  const res = await awardForCompletedVisit({ companyId: co.id, contactId: lima.id, appointmentId: v.appt.id, serviceId: cut.id, price: 45, invoiceId: v.bill.id })
  check('L4: the visit earned its 45', res.points === 45, res)
  check('L4: …and granted the 50 the settings screen promised', res.bonusPoints === 50, res)
  const m = await memberFor(lima)
  check('L4: Lima\'s first $45 Blowout ends on 95 points, not 45', m.pointsBalance === 95, m?.pointsBalance)
  check('L4: …and earned-to-date agrees', m.lifetimePoints === 95, m?.lifetimePoints)
  const led = await ledgerFor(m.id)
  check('L4: there is a welcome row to point at', led.filter((r: any) => r.description === 'Welcome bonus').length === 1, led.map((r: any) => r.description))
  check('L4: …and it is a bonus, not an earn', led.find((r: any) => r.description === 'Welcome bonus')?.type === 'bonus', led)

  // Their second visit is just a visit.
  const v2 = await completedVisit(lima, { price: 45 })
  await awardForCompletedVisit({ companyId: co.id, contactId: lima.id, appointmentId: v2.appt.id, serviceId: cut.id, price: 45, invoiceId: v2.bill.id })
  const m2 = await memberFor(lima)
  check('L4: the second visit earns 45 and nothing else — joining happens once', m2.pointsBalance === 140, m2?.pointsBalance)
  check('L4: …and there is still exactly one welcome row',
    (await ledgerFor(m.id)).filter((r: any) => r.description === 'Welcome bonus').length === 1)
}

{
  const mike = await mkClient('LYR Mike', `1990-${thisMonth}-15`)
  const v = await completedVisit(mike, { price: 40 })
  const res = await awardForCompletedVisit({ companyId: co.id, contactId: mike.id, appointmentId: v.appt.id, serviceId: cut.id, price: 40, invoiceId: v.bill.id })
  check('L4: a client whose birthday falls this month gets both bonuses on joining', res.bonusPoints === 75, res)
  const m = await memberFor(mike)
  check('L4: 40 earned + 50 welcome + 25 birthday = 115', m.pointsBalance === 115, m?.pointsBalance)
  const led = await ledgerFor(m.id)
  const bday = led.find((r: any) => String(r.description).startsWith('Birthday bonus'))
  check('L4: the birthday row names the year, so next year\'s is a different row', String(bday?.description).endsWith(String(new Date().getFullYear())), bday?.description)

  // Three visits in your birthday month is one bonus, not three.
  const v2 = await completedVisit(mike, { price: 40 })
  await awardForCompletedVisit({ companyId: co.id, contactId: mike.id, appointmentId: v2.appt.id, serviceId: cut.id, price: 40, invoiceId: v2.bill.id })
  const m2 = await memberFor(mike)
  check('L4: the next visit that month earns 40 and no second birthday bonus', m2.pointsBalance === 155, m2?.pointsBalance)
  check('L4: …one birthday row for the year', (await ledgerFor(m.id)).filter((r: any) => String(r.description).startsWith('Birthday bonus')).length === 1)
}

{
  // Someone born in a different month gets the welcome and nothing else.
  const other = String(((new Date().getMonth() + 6) % 12) + 1).padStart(2, '0')
  const nov = await mkClient('LYR Whiskey', `1985-${other}-03`)
  const v = await completedVisit(nov, { price: 40 })
  const res = await awardForCompletedVisit({ companyId: co.id, contactId: nov.id, appointmentId: v.appt.id, serviceId: cut.id, price: 40, invoiceId: v.bill.id })
  check('L4: a birthday in another month grants nothing extra', res.bonusPoints === 50, res)
}

{
  // Cancelling takes the birthday bonus back with the visit — it rode on a visit that did not happen.
  // The welcome stays: they joined, and one cancelled appointment does not unjoin them.
  const xray = await mkClient('LYR Xray', `1992-${thisMonth}-02`)
  const [appt] = await db.insert(appointment).values({
    contactId: xray.id, serviceId: cut.id, companyId: co.id, status: 'scheduled',
    startTime: new Date(Date.now() - 86400000), endTime: new Date(Date.now() - 86400000 + 1800000), quotedPrice: '40',
  } as any).returning()
  await api('PUT', `/api/appointments/${appt.id}`, { status: 'completed' })
  const m = await memberFor(xray)
  check('L4: 40 + 50 + 25 through the book as well', m.pointsBalance === 115, m?.pointsBalance)

  await api('PUT', `/api/appointments/${appt.id}`, { status: 'cancelled' })
  const after = await memberFor(xray)
  check('L4: cancelling gives back the 40 earned and the 25 birthday bonus', after.pointsBalance === 50, after?.pointsBalance)
  check('L4: …and leaves the welcome — they are still a member', after.lifetimePoints === 50, after?.lifetimePoints)
  const led = await ledgerFor(m.id)
  check('L4: …the birthday row is gone, so the bonus is available again this year',
    led.filter((r: any) => String(r.description).startsWith('Birthday bonus')).length === 0, led.map((r: any) => r.description))
  check('L4: …and the welcome row stands', led.filter((r: any) => r.description === 'Welcome bonus').length === 1, led.map((r: any) => r.description))
}

{
  // The shop's switch still governs everything, bonuses included.
  await db.update(company).set({
    settings: { loyalty: { enabled: false, pointsPerDollar: 1, welcomePoints: 50, birthdayBonus: 25 } },
  } as any).where(eq(company.id, co.id))
  const zulu = await mkClient('LYR Zulu', `1988-${thisMonth}-09`)
  const v = await completedVisit(zulu, { price: 40 })
  const res = await awardForCompletedVisit({ companyId: co.id, contactId: zulu.id, appointmentId: v.appt.id, serviceId: cut.id, price: 40, invoiceId: v.bill.id })
  check('L4: a switched-off programme grants no bonuses either', res.awarded === false && res.bonusPoints === 0, res)
  check('L4: …and does not even enrol them', (await memberFor(zulu)) === undefined, await memberFor(zulu))
}

// ═════════════════════════════════════ N4 · the shop's own words ═════════════════════════════════
{
  const src = await Bun.file(new URL('./src/routes/loyalty.ts', import.meta.url)).text()
  const claimed = /That card has already been used\.[^']*/.exec(src)?.[0] || ''
  check('N4: the losing claim says front desk, not till', /front desk/i.test(claimed), claimed)
  check('N4: …and the word "till" is gone from what a client-facing screen shows',
    !/\btills?\b/i.test(claimed), claimed)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
