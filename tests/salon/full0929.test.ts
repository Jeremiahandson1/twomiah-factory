// crm-salon — the FULL0929 full-retest findings.
//
// F1 (medium)  Cancelling a completed visit gave back the points and voided the bill, and left the
//              SERVICE RECORD standing. So the client's chart still held a visit that did not happen
//              — counted in their visit total, used as their last visit, and feeding the rebooking
//              reminder. LYR2 Papa sits on Due to Rebook for 8 October because of a cancelled cut.
// F4 (low)     An invoice a free service brought to $0.00 stayed "open", so a front desk chasing open
//              bills had to work out for each one that there was nothing to chase.
// F5 (low)     PUT /api/company accepted settings.taxRate = −5, 150 and "abc" — one word away from
//              the real defaultTaxRate, which refuses all three.
// F6 (low)     /api/geofencing answered 200 on a salon while sixteen other switched-off modules
//              returned 403. Field service had the same leftover until T20.
// F8 (medium)  A bulk text reminder answered {sent: 1} on a shop with no Twilio number and an empty
//              wallet. No thread, no charge, no text — and an API saying it went.
import { Hono } from 'hono'
import { eq, and, sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, serviceMenu, appointment, invoice, serviceRecord, loyaltyMember } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Full Retest Salon', slug: 'full0929', email: 'full@test.local',
  settings: { loyalty: { pointsPerDollar: 1, punchCard: { visitsRequired: 0 } }, defaultTaxRate: 8.5 },
  enabledFeatures: ['salon_booking', 'invoices', 'loyalty_rewards', 'contacts', 'service_menu'],
} as any).returning()

const [owner] = await db.insert(user).values({
  email: 'owner-full@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()

// A service with a rebook interval, so the reminder list has something to pick up.
const [cut] = await db.insert(serviceMenu).values({
  // A one-day interval so a visit rung up yesterday is due now and lands in the reminder window.
  name: "Men's Cut", price: '35', durationMin: 30, companyId: co.id, rebookIntervalDays: 1,
} as any).returning()

const [papa] = await db.insert(contact).values({ name: 'LYR2 Papa', type: 'client', companyId: co.id } as any).returning()
const [noPhone] = await db.insert(contact).values({ name: 'No Phone', type: 'client', companyId: co.id } as any).returning()
const [withPhone] = await db.insert(contact).values({ name: 'Has Phone', type: 'client', companyId: co.id, phone: '608-555-0100' } as any).returning()

const app = new Hono()
app.route('/api/appointments', (await import('./src/routes/appointments.ts')).default)
app.route('/api/reminders', (await import('./src/routes/reminders.ts')).default)
app.route('/api/company', (await import('./src/routes/company.ts')).default)
app.route('/api/loyalty', (await import('./src/routes/loyalty.ts')).default)
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

/** A booking in the past, completed — the shape that raises a bill, a record and loyalty at once. */
let n = 0
const bookAndComplete = async (client: any) => {
  n++
  const start = new Date(Date.now() - n * 86400000)
  const [appt] = await db.insert(appointment).values({
    contactId: client.id, serviceId: cut.id, companyId: co.id, status: 'scheduled',
    startTime: start, endTime: new Date(start.getTime() + 1800000), quotedPrice: '35',
  } as any).returning()
  const done = await api('PUT', `/api/appointments/${appt.id}`, { status: 'completed' })
  return { appt, done }
}

// ═════════════════════════════════ F1 · the visit record goes too ═══════════════════════════════
{
  const { appt, done } = await bookAndComplete(papa)
  check('F1: completing the visit works', done.status === 200, { status: done.status, body: done.json })

  const before = await db.select().from(serviceRecord).where(eq(serviceRecord.appointmentId, appt.id))
  check('F1: …and writes the visit record', before.length === 1, before.length)

  const due = await api('GET', '/api/reminders/due')
  const listed = (due.json?.data || due.json || []).filter((r: any) => r.contactId === papa.id)
  check('F1: …which puts the client on Due to Rebook', listed.length === 1, { count: listed.length })

  const cancelled = await api('PUT', `/api/appointments/${appt.id}`, { status: 'cancelled' })
  check('F1: cancelling is accepted', cancelled.status === 200, cancelled.status)

  const after = await db.select().from(serviceRecord).where(eq(serviceRecord.appointmentId, appt.id))
  check('F1: …and the visit record goes with it — it used to stay', after.length === 0, after)

  const dueAfter = await api('GET', '/api/reminders/due')
  const stillListed = (dueAfter.json?.data || dueAfter.json || []).filter((r: any) => r.contactId === papa.id)
  check('F1: …so no rebooking reminder goes out for a visit that did not happen', stillListed.length === 0, stillListed)

  const bill = (await db.select().from(invoice).where(eq(invoice.appointmentId, appt.id)))[0]
  check('F1: …and the bill is still voided, as it already was', bill?.status === 'void', bill?.status)

  // Re-completing writes a fresh record rather than doubling up.
  await api('PUT', `/api/appointments/${appt.id}`, { status: 'completed' })
  const again = await db.select().from(serviceRecord).where(eq(serviceRecord.appointmentId, appt.id))
  check('F1: re-completing the visit writes it once, not twice', again.length === 1, again.length)
}

{
  // A record a stylist has written a formula on is a colourist's own work. It is kept and marked,
  // not thrown away by a status flip — and the log says so.
  const { appt } = await bookAndComplete(noPhone)
  await db.update(serviceRecord)
    .set({ formula: [{ product: 'Colour 6N', developer: '20 vol' }] } as any)
    .where(eq(serviceRecord.appointmentId, appt.id))
  await api('PUT', `/api/appointments/${appt.id}`, { status: 'cancelled' })
  const [kept] = await db.select().from(serviceRecord).where(eq(serviceRecord.appointmentId, appt.id))
  check('F1: a record carrying a formula is kept', !!kept, kept)
  check('F1: …and says the appointment under it was cancelled', /cancelled/i.test(String(kept?.notes || '')), kept?.notes)
}

// ═══════════════════════════════════ F4 · nobody owes nothing ═══════════════════════════════════
{
  const { appt } = await bookAndComplete(withPhone)
  const bill = (await db.select().from(invoice).where(eq(invoice.appointmentId, appt.id)))[0]
  check('F4: the visit raised an open bill', bill?.status === 'open', bill?.status)

  // A reward worth the whole visit.
  const [member] = await db.select().from(loyaltyMember)
    .where(and(eq(loyaltyMember.companyId, co.id), eq(loyaltyMember.contactId, withPhone.id))).limit(1)
  await db.update(loyaltyMember).set({ pointsBalance: 1000 } as any).where(eq(loyaltyMember.id, member.id))
  const [freeCut] = await rows(sql`
    INSERT INTO loyalty_rewards (id, company_id, name, type, value_cents, points_cost, active, created_at, updated_at)
    VALUES (gen_random_uuid(), ${co.id}, 'Free cut', 'fixed', 3500, 100, true, NOW(), NOW())
    RETURNING id
  `)
  const redeemed = await api('POST', `/api/loyalty/members/${member.id}/redeem`, { rewardId: freeCut.id, appointmentId: appt.id })
  check('F4: the reward is applied', redeemed.status === 200, { status: redeemed.status, body: redeemed.json })

  const after = (await db.select().from(invoice).where(eq(invoice.id, bill.id)))[0]
  check('F4: …the bill comes to nothing', Math.round(Number(after?.total) * 100) === 0, after?.total)
  check('F4: …and is marked paid rather than left open', after?.status === 'paid', after?.status)
}

// ═══════════════════════════ F5 · a typo'd setting does not save silently ═══════════════════════
{
  for (const bad of [-5, 150, 'abc']) {
    const r = await api('PUT', '/api/company', { settings: { taxRate: bad } })
    check(`F5: settings.taxRate = ${JSON.stringify(bad)} is refused`, r.status === 400, { status: r.status, body: r.json })
    check('F5: …naming the key', /taxRate/.test(String(r.json?.error)), r.json?.error)
  }
  const stored = (await db.select({ settings: company.settings }).from(company).where(eq(company.id, co.id)))[0]
  check('F5: …and nothing was stored under it', (stored?.settings as any)?.taxRate === undefined, stored?.settings)

  const good = await api('PUT', '/api/company', { settings: { defaultTaxRate: 7.5 } })
  check('F5: the real field still saves', good.status === 200, { status: good.status, body: good.json })

  const realOne = await api('PUT', '/api/company', { settings: { defaultTaxRate: 150 } })
  check('F5: …and still refuses an impossible value', realOne.status === 400, { status: realOne.status })

  // A genuinely new key that is not a rate or a day count is still free to be anything.
  const novel = await api('PUT', '/api/company', { settings: { frontDeskGreeting: 'Hello!' } })
  check('F5: an unknown key that claims nothing about itself is still accepted', novel.status === 200, { status: novel.status })
}

// ═════════════════════════════════════ F8 · "sent" means sent ═══════════════════════════════════
{
  const noNumber = await api('POST', '/api/reminders/send', { contactIds: [withPhone.id], message: 'See you soon' })
  check('F8: a text on a shop with no number set up reports NOTHING sent', noNumber.json?.sent === 0, noNumber.json)
  check('F8: …counts it as a failure', noNumber.json?.failed === 1, noNumber.json)
  check('F8: …and says why, in words a front desk can act on',
    /not set up|wallet|paused/i.test(String(noNumber.json?.reason)), noNumber.json?.reason)

  const conversations = await rows(sql`SELECT id FROM sms_conversation WHERE company_id = ${co.id}`)
  check('F8: …and no thread was opened for a text that never went', conversations.length === 0, conversations.length)

  const none = await api('POST', '/api/reminders/send', { contactIds: [noPhone.id], message: 'See you soon' })
  check('F8: a client with no phone is still reported as noPhone', none.json?.noPhone === 1 && none.json?.sent === 0, none.json)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
