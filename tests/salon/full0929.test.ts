// crm-salon — the FULL0929 full-retest findings.
//
// F1 (medium)  Cancelling a completed visit gave back the points and voided the bill, and left the
//              SERVICE RECORD standing. So the client's chart still held a visit that did not happen
//              — counted in their visit total, used as their last visit, and feeding the rebooking
//              reminder. LYR2 Papa sits on Due to Rebook for 8 October because of a cancelled cut.
// F2 (medium)  Every fix here changes what happens NEXT. The bills the older builds already wrote
//              stay wrong, and no screen could correct them: $74.36 sitting in Outstanding that was
//              never owed, and $5.00 of a client's money recorded nowhere. An admin repair puts the
//              first right and REPORTS the second, because where an over-payment goes is a person's
//              call.
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
app.route('/api/clients', (await import('./src/routes/clients.ts')).default)
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
  // A record a stylist has written a formula on is a colourist's own work, and a status flip is not
  // the authority to destroy it. The FIRST version of this fix kept the whole record for that reason
  // — and paid for it by leaving a visit that never happened on the chart, still driving the client's
  // rebooking reminder. That was a compromise and it was named as one.
  //
  // It is not needed. A formula belongs to the CLIENT, not to a booking, so the work is lifted onto
  // their card and the phantom visit goes. Both things are now true at once, which is the whole
  // point: nothing clinical is lost AND nothing false survives.
  const { appt } = await bookAndComplete(noPhone)
  await db.update(serviceRecord)
    .set({ formula: [{ product: 'Colour 6N', developer: '20 vol' }], developerVolume: '20 vol' } as any)
    .where(eq(serviceRecord.appointmentId, appt.id))
  await api('PUT', `/api/appointments/${appt.id}`, { status: 'cancelled' })

  const left = await db.select().from(serviceRecord).where(eq(serviceRecord.appointmentId, appt.id))
  check('F1: the visit that did not happen is gone, formula or no formula', left.length === 0, left)

  const kept = await api('GET', `/api/clients/${noPhone.id}/formulas`)
  const mine = (kept.json?.formulas || [])[0]
  check('F1: …because the formula was kept on the CLIENT first', !!mine, kept.json)
  check('F1: …with the mix intact', mine?.formula?.[0]?.product === 'Colour 6N', mine?.formula)
  check('F1: …and the developer volume', mine?.developerVolume === '20 vol', mine?.developerVolume)
  check('F1: …labelled so a stylist knows where it came from', /cancelled/i.test(String(mine?.label)), mine?.label)

  const due = await api('GET', '/api/reminders/due')
  const listed = (due.json?.data || due.json || []).filter((r: any) => r.contactId === noPhone.id)
  check('F1: …and no rebooking reminder survives it, which the kept-record version could not manage',
    listed.length === 0, listed)
}

{
  // The same for a record carrying only a stylist's own words. A note is worth keeping too, and it
  // is kept the same way — on the client, not by preserving a booking that did not happen.
  const [scribe] = await db.insert(contact).values({ name: 'Note Keeper', type: 'client', companyId: co.id } as any).returning()
  const { appt } = await bookAndComplete(scribe)
  await db.update(serviceRecord)
    .set({ notes: 'Wants half an inch off next time; hates the neck brush.' } as any)
    .where(eq(serviceRecord.appointmentId, appt.id))
  await api('PUT', `/api/appointments/${appt.id}`, { status: 'cancelled' })

  check('F1: a notes-only record goes too', (await db.select().from(serviceRecord).where(eq(serviceRecord.appointmentId, appt.id))).length === 0)
  const kept = await api('GET', `/api/clients/${scribe.id}/formulas`)
  check('F1: …and the stylist\'s words are on the client card', /half an inch/.test(String((kept.json?.formulas || [])[0]?.note)), kept.json)
}

{
  // …and a record the SYSTEM wrote and nobody touched leaves nothing behind. The auto note is not a
  // stylist's work and must not clutter a card with a line the product typed itself.
  const [plain] = await db.insert(contact).values({ name: 'Plain Cancel', type: 'client', companyId: co.id } as any).returning()
  const { appt } = await bookAndComplete(plain)
  await api('PUT', `/api/appointments/${appt.id}`, { status: 'cancelled' })
  const kept = await api('GET', `/api/clients/${plain.id}/formulas`)
  check('F1: an untouched auto-logged visit leaves no formula behind', (kept.json?.formulas || []).length === 0, kept.json)
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

  // ── RR0929 N2 · "rate" does not mean "percentage" ───────────────────────────────────────────
  //
  // I asked the tester to try to find a real setting this rule wrongly refuses, and they found
  // four. Three are money per unit and one is a working week; all four were refused outright, so
  // a salon could not set a chair rent. Refusing a real setting is worse than accepting a typo,
  // because the typo does nothing and the refusal stops the shop working.
  for (const [k, v] of [['hourlyRate', 150], ['laborRate', 125], ['chairRentalRate', 250], ['boothRate', 1200]] as const) {
    const r = await api('PUT', '/api/company', { settings: { [k]: v } })
    check(`N2: settings.${k} = ${v} saves — it is money, not a percentage`, r.status === 200, { status: r.status, body: r.json })
  }
  const week = await api('PUT', '/api/company', { settings: { workingDays: 'mon-fri' } })
  check('N2: settings.workingDays = "mon-fri" saves — a working week is not a count of days', week.status === 200, { status: week.status, body: week.json })

  const back = (await db.select({ settings: company.settings }).from(company).where(eq(company.id, co.id)))[0]?.settings as any
  check('N2: …and they are all actually stored',
    Number(back?.hourlyRate) === 150 && Number(back?.chairRentalRate) === 250 && back?.workingDays === 'mon-fri', back)

  // The bound still applies where the name really does say percentage, which is what F5 was for.
  for (const [k, v] of [['taxRate', 150], ['commissionRate', 150], ['discountRate', -1], ['tipRate', 'abc'], ['serviceChargePercent', 150]] as const) {
    const r = await api('PUT', '/api/company', { settings: { [k]: v } })
    check(`N2: settings.${k} = ${JSON.stringify(v)} is still refused as a percentage`, r.status === 400, { status: r.status, body: r.json })
  }

  // …and a money rate still has to be a number, and still cannot be negative.
  const notANumber = await api('PUT', '/api/company', { settings: { hourlyRate: 'abc' } })
  check('N2: a money rate that is not a number is refused', notANumber.status === 400, { status: notANumber.status, body: notANumber.json })
  check('N2: …and told it is an amount, not a percentage', /amount/i.test(String(notANumber.json?.error)), notANumber.json?.error)
  const negative = await api('PUT', '/api/company', { settings: { hourlyRate: -5 } })
  check('N2: a negative money rate is refused', negative.status === 400, { status: negative.status, body: negative.json })

  // A days key that IS a number is still bounded.
  const silly = await api('PUT', '/api/company', { settings: { paymentTermsDays: 99999 } })
  check('N2: a day count out of all sense is still refused', silly.status === 400, { status: silly.status, body: silly.json })
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
  check('F8: …and that failure carries a reason too, rather than a null the desk cannot act on',
    /no mobile number/i.test(String(none.json?.reason)), none.json)

  // …but a missing number is the LAST explanation offered. A shop whose texting is switched off,
  // sending to one client with a number and one without, must be told about the texting.
  const mixed = await api('POST', '/api/reminders/send', { contactIds: [withPhone.id, noPhone.id], message: 'See you soon' })
  check('F8: a real refusal outranks the missing number in the reason shown',
    /not set up|wallet|paused/i.test(String(mixed.json?.reason)), mixed.json)
  check('F8: …and both are still counted', mixed.json?.failed === 2 && mixed.json?.noPhone === 1 && mixed.json?.sent === 0, mixed.json)
}

// ═══════════════════ F2 · the bills the older builds left behind, put right ═════════════════════
//
// Every fix above changes what happens NEXT. The rows the old builds already wrote stay wrong, and
// there was no way to correct them from inside the product. These four shapes are the ones the
// retest found on the test tenant, rebuilt here exactly: a free cut still billing tax, a bill
// over-taxed by 85c, a bill paid for $5.00 more than it is worth, and an open bill on a cancelled
// visit. A fifth is the control — a bill that UNDER-charged tax, which must be left alone.
{
  const [legacyClient] = await db.insert(contact).values({ name: 'Legacy Bills', type: 'client', companyId: co.id } as any).returning()

  /** A bill written the way the old build wrote it, straight into the table. */
  let seq = 900
  const oldBill = async (v: Record<string, any>) => {
    const [row] = await db.insert(invoice).values({
      number: `INV-00${seq++}`, companyId: co.id, contactId: legacyClient.id,
      status: 'open', taxRate: '8.50', ...v,
    } as any).returning()
    return row
  }

  // INV-00222 on the tenant: a cut given away by a reward, still billing $2.98 of tax on the $35
  // the client was never charged — and still sitting in the open list.
  const freeCut = await oldBill({ subtotal: '35.00', discount: '35.00', taxAmount: '2.98', total: '2.98' })
  // INV-00218: tax taken on the full ticket instead of on what was actually charged.
  const overTaxed = await oldBill({ subtotal: '100.00', discount: '10.00', taxAmount: '8.50', total: '98.50' })
  // INV-00239: $37.98 handed over against a bill a later redemption took down to $32.98.
  const overPaid = await oldBill({
    subtotal: '30.40', discount: '0', taxAmount: '2.58', total: '32.98', amountPaid: '37.98', status: 'paid',
  })
  // The control. Nobody chases a client for 40c of tax six months later.
  const underTaxed = await oldBill({ subtotal: '50.00', discount: '0', taxAmount: '4.00', total: '54.00' })

  // INV-00240: open at $70.53 against a visit that was cancelled, holding no money.
  const cancelStart = new Date(Date.now() - 20 * 86400000)
  const [deadAppt] = await db.insert(appointment).values({
    contactId: legacyClient.id, serviceId: cut.id, companyId: co.id, status: 'cancelled',
    startTime: cancelStart, endTime: new Date(cancelStart.getTime() + 1800000), quotedPrice: '65',
  } as any).returning()
  const onCancelled = await oldBill({
    subtotal: '65.00', discount: '0', taxAmount: '5.53', total: '70.53', appointmentId: deadAppt.id,
  })

  const outstanding = async () => {
    const [r] = await rows(sql`
      SELECT COALESCE(SUM(total - amount_paid), 0) AS owed FROM invoice
      WHERE company_id = ${co.id} AND status NOT IN ('void', 'refunded', 'paid')
    `)
    return Math.round(Number(r.owed) * 100)
  }
  const owedBefore = await outstanding()

  // A shop manager cannot run it. This re-cuts tax and voids bills, which is the same standing
  // serviceRecords' own legacy repair asks for: admin and owner only.
  const [mgr] = await db.insert(user).values({
    email: 'mgr-full@test.local', passwordHash: 'x', firstName: 'M', lastName: 'G', role: 'manager', companyId: co.id,
  } as any).returning()
  const asManager = await app.request('/api/loyalty/repair-legacy-invoices', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': mgr.id, 'x-test-company': co.id, 'x-test-role': 'manager' },
  })
  check('F2: a manager cannot run the repair', asManager.status === 403, asManager.status)

  const fix = await api('POST', '/api/loyalty/repair-legacy-invoices')
  check('F2: the repair runs', fix.status === 200, { status: fix.status, body: fix.json })

  const bill = async (id: string) => (await db.select().from(invoice).where(eq(invoice.id, id)))[0]
  const cents = (v: any) => Math.round(Number(v) * 100)

  // ── tax reassessed on what was actually charged ──
  const free = await bill(freeCut.id)
  check('F2: a cut given away is no longer taxed', cents(free.taxAmount) === 0, free.taxAmount)
  check('F2: …so the bill comes to nothing', cents(free.total) === 0, free.total)
  check('F2: …and nobody owes nothing — it is marked paid, not left open', free.status === 'paid', free.status)

  const over = await bill(overTaxed.id)
  check('F2: tax is re-cut on (subtotal − discount) at the bill\'s own rate', cents(over.taxAmount) === 765, over.taxAmount)
  check('F2: …and the total follows it down', cents(over.total) === 9765, over.total)
  check('F2: …and a bill still owed stays open', over.status === 'open', over.status)

  // ── downwards only ──
  const under = await bill(underTaxed.id)
  check('F2: a bill that UNDER-charged tax is left exactly as it was', cents(under.taxAmount) === 400 && cents(under.total) === 5400,
    { tax: under.taxAmount, total: under.total })

  // ── a cancelled visit's bill ──
  const dead = await bill(onCancelled.id)
  check('F2: an open bill on a cancelled visit is voided', dead.status === 'void', dead.status)
  check('F2: …and says why, in the same words the cancel path uses',
    /Voided: the appointment it was raised from was cancelled/.test(String(dead.notes || '')), dead.notes)

  // ── the one it must NOT touch ──
  const paidTooMuch = await bill(overPaid.id)
  check('F2: an over-payment is not quietly absorbed — the money is left where it is',
    cents(paidTooMuch.amountPaid) === 3798 && cents(paidTooMuch.amountRefunded) === 0,
    { paid: paidTooMuch.amountPaid, refunded: paidTooMuch.amountRefunded })
  const flagged = (fix.json?.overpaid || []).find((o: any) => o.id === overPaid.id)
  check('F2: …it is reported instead', !!flagged, fix.json?.overpaid)
  check('F2: …with what the client is owed back', flagged?.owedBack === 5, flagged)
  check('F2: …and a line telling a person it is theirs to decide',
    /refund|credit/i.test(String(fix.json?.needsAPerson || '')), fix.json?.needsAPerson)

  // ── what it was all for ──
  const owedAfter = await outstanding()
  // $2.98 of tax on a free cut + 85c over-charged + a $70.53 bill on a visit that never happened
  // = the $74.36 the retest found sitting in Outstanding on the tenant.
  check('F2: the $74.36 that was never owed leaves the open list', owedBefore - owedAfter === 7436,
    { before: owedBefore, after: owedAfter, removed: owedBefore - owedAfter })

  // ── run it twice ──
  const again = await api('POST', '/api/loyalty/repair-legacy-invoices')
  check('F2: a second run finds nothing left to re-cut, void or close',
    again.json?.retaxed?.length === 0 && again.json?.voided?.length === 0 && again.json?.closed?.length === 0, again.json)
  check('F2: …but still reports the over-payment, because a person still has to act on it',
    again.json?.overpaid?.length === 1, again.json?.overpaid)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
