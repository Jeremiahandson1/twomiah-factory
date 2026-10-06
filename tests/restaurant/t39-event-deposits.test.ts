// crm-restaurant — the event's menu, its deposit schedule and the one ledger they share. (T39)
//
// WHY THIS SUITE EXISTS AT ALL. crm-restaurant had 164 endpoint declarations and ZERO
// vertical-specific tests: only the shared contract test, which proves two fleet-wide invariants and
// nothing about booking a wedding. The Foundry round and the one-ledger rebuild both landed here and
// neither left a test behind.
//
// This template is scoped to PRIVATE EVENTS, not covers: an enquiry becomes a booking, the booking
// gets a menu, the menu sets the total, and deposits are scheduled against that total. The rule that
// holds it together is ONE LEDGER — the event's invoice is the only place the money lives, so a
// deposit schedule can never add up to more than the invoice it is drawn against (H-01). Get that
// wrong and a venue takes deposits for an event worth less than the deposits.
//
// WHAT IS PINNED:
//   H-01  Scheduled payments may not exceed the event's invoice total, and nothing can be scheduled
//         before there is a total at all — a deposit on a $0 event is a deposit against nothing.
//   H-01  A menu line's unit price and quantity must be numbers and must not be negative: a negative
//         line used to subtract from the total, which is how a schedule could quietly fit.
//   Money is a positive number. '' , null, 0, -50, 'lots' and Infinity are all refused.
//   The mount. events.ts is wired inside a try/catch that only console.errors — the same shape that
//         left crm-homecare's leads module dead for a whole round.
//
// THE ASSERTIONS ARE TOTALS AND ROW COUNTS. "The deposit endpoint answered 201" would pass while the
// venue over-collected.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, event } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'The Foundry', slug: 'foundry-events-t39', email: 'foundry@test.local', state: 'OH',
  settings: {}, enabledFeatures: ['events'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@foundry.local`, passwordHash: 'x', firstName: tag, lastName: 'U',
  role, companyId: co.id, isActive: true,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const server = await mkUser('field', 'server')

const [client] = await db.insert(contact).values({
  companyId: co.id, name: 'Aisha & Tom Hollings', email: 'hollings@test.local',
} as any).returning()
const [wedding] = await db.insert(event).values({
  companyId: co.id, contactId: client.id, name: 'Hollings wedding reception',
  eventDate: new Date('2027-06-19T17:00:00Z'), guestCount: 120, status: 'booked',
} as any).returning()

const app = new Hono()
// NOT inside a try/catch: the product swallows a mount failure, this suite must not.
app.route('/api/events', (await import('./src/routes/events.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const asOwner = as(owner), asServer = as(server)
const one = async (q: any) => (((await db.execute(q)) as any).rows ?? [])[0]
const payments = async () => Number((await one(sql`SELECT COUNT(*)::int AS n FROM event_payment WHERE event_id = ${wedding.id}`))?.n ?? 0)
const scheduled = async () => Number((await one(sql`SELECT COALESCE(SUM(amount::numeric), 0) AS s FROM event_payment WHERE event_id = ${wedding.id}`))?.s ?? 0)

// ══════════ the module is reachable ══════════════════════════════════════════════════════════
console.log('\n══════════ the events module is mounted ══════════')
{
  const list = await asOwner('GET', '/api/events')
  check('GET /api/events answers', list.status === 200, { status: list.status, body: list.text?.slice(0, 140) })
  check('…and the booking is in it', /Hollings/.test(list.text), list.text?.slice(0, 180))
  const detail = await asOwner('GET', `/api/events/${wedding.id}`)
  check('GET /api/events/:id answers', detail.status === 200, { status: detail.status })
  const beo = await asOwner('GET', `/api/events/${wedding.id}/beo`)
  check('the banquet event order answers', beo.status === 200, { status: beo.status, body: beo.text?.slice(0, 140) })
}

// ══════════ nothing can be scheduled against nothing ═════════════════════════════════════════
console.log('\n══════════ a deposit needs something to be a deposit ON ══════════')
{
  const tooEarly = await asOwner('POST', `/api/events/${wedding.id}/payments`, { label: 'Deposit', amount: 500 })
  check('a deposit on an event with no menu and no total is refused', tooEarly.status === 400,
    { status: tooEarly.status, body: tooEarly.text?.slice(0, 200) })
  check('…and says to add menu lines or a quoted total first', /nothing to bill yet/i.test(String(tooEarly.json?.error)), tooEarly.json?.error)
  check('…and nothing was scheduled', (await payments()) === 0, { payments: await payments() })
}

// ══════════ the menu sets the total ══════════════════════════════════════════════════════════
console.log('\n══════════ the menu ══════════')
{
  const neg = await asOwner('POST', `/api/events/${wedding.id}/menu`, { name: 'Discount hack', quantity: 1, unitPrice: -5000 })
  check('a NEGATIVE unit price is refused — it used to subtract from the total', neg.status === 400,
    { status: neg.status, body: neg.text?.slice(0, 160) })
  const negQty = await asOwner('POST', `/api/events/${wedding.id}/menu`, { name: 'Negative covers', quantity: -20, unitPrice: 85 })
  check('…and a negative quantity', negQty.status === 400, { status: negQty.status, body: negQty.text?.slice(0, 140) })
  const nan = await asOwner('POST', `/api/events/${wedding.id}/menu`, { name: 'Mystery price', quantity: 1, unitPrice: 'lots' })
  check('…and a price that is not a number', nan.status === 400, { status: nan.status, body: nan.text?.slice(0, 140) })
  const nameless = await asOwner('POST', `/api/events/${wedding.id}/menu`, { quantity: 10, unitPrice: 20 })
  check('…and a line with no name and no package', nameless.status === 400, { status: nameless.status, body: nameless.text?.slice(0, 140) })

  // 120 covers at $85 = $10,200
  const plated = await asOwner('POST', `/api/events/${wedding.id}/menu`, { name: 'Plated dinner', quantity: 120, unitPrice: 85 })
  check('a real menu line is added', plated.status === 201, { status: plated.status, body: plated.text?.slice(0, 180) })
  // 120 at $12.50 = $1,500 → total $11,700
  const bar = await asOwner('POST', `/api/events/${wedding.id}/menu`, { name: 'Bar package', quantity: 120, unitPrice: 12.5 })
  check('…and a second', bar.status === 201, { status: bar.status })

  /**
   * THE TOTAL LIVES IN `totals`, NOT IN `invoice`, UNTIL A DEPOSIT RAISES THE INVOICE.
   *
   * My first version read `invoice.total` here and got 0: the event's invoice is only created by the
   * FIRST scheduled payment, so at this point `invoice` is null. `totals` is the ledger's answer
   * either way — it reports the menu total with `invoiced: false` before the invoice exists and the
   * invoice's own total after. Reading the wrong one would have made this assertion pass at 0 on an
   * event with no menu at all.
   */
  const detail = await asOwner('GET', `/api/events/${wedding.id}`)
  check('the event total is 11700.00 — 120×85 plus 120×12.50', Number(detail.json?.totals?.total) === 11700,
    { totals: detail.json?.totals, body: detail.text?.slice(0, 200) })
  check('…made of the two menu lines', Number(detail.json?.totals?.menuTotal) === 11700, detail.json?.totals)
  check('…and no invoice exists yet — the first deposit raises it', detail.json?.totals?.invoiced === false && detail.json?.invoice === null,
    { invoiced: detail.json?.totals?.invoiced, invoice: detail.json?.invoice })
  check('…and the two refused lines are not in the menu', (detail.json?.menu ?? []).length === 2,
    (detail.json?.menu ?? []).map((l: any) => `${l.name} ${l.quantity}×${l.unitPrice}`))
}

// ══════════ H-01 · the schedule cannot exceed the invoice ════════════════════════════════════
console.log('\n══════════ the deposit schedule is bounded by the total ══════════')
{
  const d1 = await asOwner('POST', `/api/events/${wedding.id}/payments`, { label: 'Booking deposit', amount: 2500, dueDate: '2026-11-01' })
  check('a $2,500 booking deposit schedules', d1.status === 201, { status: d1.status, body: d1.text?.slice(0, 180) })
  check('…stored to the cent', Number(d1.json?.amount) === 2500, { amount: d1.json?.amount })

  // The first deposit is what raises the invoice — one ledger, created on demand.
  const afterFirst = await asOwner('GET', `/api/events/${wedding.id}`)
  check('…and the first deposit RAISED the invoice', afterFirst.json?.totals?.invoiced === true && !!afterFirst.json?.invoice?.id,
    { invoiced: afterFirst.json?.totals?.invoiced, invoice: afterFirst.json?.invoice?.number })
  check('…for the same 11700, not a fresh zero', Number(afterFirst.json?.invoice?.total) === 11700,
    { total: afterFirst.json?.invoice?.total })

  const d2 = await asOwner('POST', `/api/events/${wedding.id}/payments`, { label: 'Second instalment', amount: 4000, dueDate: '2027-03-01' })
  check('a second instalment schedules', d2.status === 201, { status: d2.status })
  check('…and the schedule now totals 6500', (await scheduled()) === 6500, { scheduled: await scheduled() })

  // 6500 + 5500 = 12000 > 11700. THE ASSERTION THIS SUITE EXISTS FOR.
  const over = await asOwner('POST', `/api/events/${wedding.id}/payments`, { label: 'Balance', amount: 5500 })
  check('an instalment that would take the schedule OVER the invoice is refused', over.status === 400,
    { status: over.status, body: over.text?.slice(0, 220) })
  check('…and the message names both figures', /12,?000\.00/.test(String(over.json?.error)) && /11,?700\.00/.test(String(over.json?.error)),
    over.json?.error)
  check('…and it was not scheduled', (await payments()) === 2 && (await scheduled()) === 6500,
    { payments: await payments(), scheduled: await scheduled() })

  // Exactly to the total is fine — the balance.
  const balance = await asOwner('POST', `/api/events/${wedding.id}/payments`, { label: 'Final balance', amount: 5200 })
  check('an instalment that lands EXACTLY on the total is accepted', balance.status === 201,
    { status: balance.status, body: balance.text?.slice(0, 180) })
  check('…and the schedule equals the invoice: 11700', (await scheduled()) === 11700, { scheduled: await scheduled() })

  const onePenny = await asOwner('POST', `/api/events/${wedding.id}/payments`, { label: 'One cent more', amount: 0.01 })
  check('…and one cent beyond it is refused', onePenny.status === 400, { status: onePenny.status, body: onePenny.text?.slice(0, 180) })
  check('…leaving the schedule at 11700', (await scheduled()) === 11700, { scheduled: await scheduled() })
}

// ══════════ money is a positive number ══════════════════════════════════════════════════════
console.log('\n══════════ what an amount may be ══════════')
{
  const before = await payments()
  const cases: Array<[string, any]> = [
    ['no amount at all', {}],
    ['an empty string', { amount: '' }],
    ['null', { amount: null }],
    ['zero', { amount: 0 }],
    ['a negative amount', { amount: -500 }],
    ['a non-number', { amount: 'lots' }],
    /**
     * T51 events: "0.001 amounts are accepted."
     *
     * The rule was `amt <= 0`, and the very next line stored `round2(amt)` — so 0.001 passed the
     * check and went into the table as "0". The venue ended up with an installment on the deposit
     * schedule for $0.00: it shows on the schedule and on the BEO, it can never be paid, and it
     * cannot be told apart from a real line somebody has not filled in yet.
     */
    ['a thousandth of a dollar', { amount: 0.001 }],
    ['half a cent, which rounds to nothing', { amount: 0.004 }],
    ['a sub-cent string', { amount: '0.002' }],
  ]
  for (const [label, body] of cases) {
    const r = await asOwner('POST', `/api/events/${wedding.id}/payments`, { label: 'bad', ...body })
    check(`${label} is refused`, r.status === 400, { status: r.status, error: r.json?.error })
  }
  /**
   * …and the new rule must not swallow a legitimate cent.
   *
   * By this point the schedule is exactly full ($2,500 + $4,000 + $5,200 = the $11,700 invoice), so
   * ANY further amount is refused — which is why this asserts on the REASON. 0.006 rounds up to a
   * real cent, so it has to get past the rounding rule and be stopped by the capacity rule instead.
   * A refusal for the wrong reason is how a rule quietly grows past its scope.
   */
  {
    const r = await asOwner('POST', `/api/events/${wedding.id}/payments`, { label: 'rounds up to a cent', amount: 0.006 })
    check('0.006 rounds UP to a cent, so the rounding rule lets it through',
      r.status === 400 && !/rounds to \$0\.00/.test(String(r.json?.error ?? '')),
      { status: r.status, error: r.json?.error })
    check('…and it is the full-schedule rule that stops it', /more than the event/i.test(String(r.json?.error ?? '')),
      { error: r.json?.error })
    if (r.status === 201 && r.json?.id) await asOwner('DELETE', `/api/events/${wedding.id}/payments/${r.json.id}`)
  }
  const badDate = await asOwner('POST', `/api/events/${wedding.id}/payments`, { label: 'x', amount: 1, dueDate: '19/06/2027' })
  check('a due date that is not YYYY-MM-DD is refused', badDate.status === 400 && /YYYY-MM-DD/.test(String(badDate.json?.error)),
    { status: badDate.status, error: badDate.json?.error })

  check('…and TEN refusals scheduled nothing', (await payments()) === before, { before, after: await payments() })
}

/**
 * The same rule on the EDIT, which is where an amount gets corrected and re-mistyped. (T51)
 *
 * On an installment that already exists, so the full schedule is not in the way: LOWERING one is
 * always allowed, and that is the shape this needs.
 */
console.log('\n══════════ …and on the edit ══════════')
{
  const existing = await one(sql`
    SELECT id, amount::numeric AS a FROM event_payment
    WHERE event_id = ${wedding.id} ORDER BY amount::numeric DESC LIMIT 1`)
  check('there is an installment to edit', !!existing?.id, { existing })
  const pid = existing?.id
  if (pid) {
    const sub = await asOwner('PUT', `/api/events/${wedding.id}/payments/${pid}`, { amount: 0.001 })
    check('T51: a sub-cent amount is refused on the edit too',
      sub.status === 400 && /rounds to \$0\.00/.test(String(sub.json?.error ?? '')),
      { status: sub.status, error: sub.json?.error })
    const still = await one(sql`SELECT amount::numeric AS a FROM event_payment WHERE id = ${pid}`)
    check('…and the installment still holds its real amount', Number(still?.a) === Number(existing.a),
      { was: existing.a, now: still?.a })
    // A real edit — downwards, so the schedule cannot be the thing that refuses it.
    const lower = Math.max(1, Math.round(Number(existing.a) / 2))
    const ok = await asOwner('PUT', `/api/events/${wedding.id}/payments/${pid}`, { amount: lower })
    check('…while a real edit still goes through', ok.status === 200 || ok.status === 201,
      { status: ok.status, error: ok.json?.error })
    const after = await one(sql`SELECT amount::numeric AS a FROM event_payment WHERE id = ${pid}`)
    check('…and it is stored to the cent', Number(after?.a) === lower, { expected: lower, got: after?.a })

    /**
     * Put it back. The sections below this one assert on a schedule that is EXACTLY square with the
     * invoice — that is the whole point of the menu-line tests — so leaving this installment halved
     * made thirteen later assertions fail on state this block had changed under them.
     */
    const restored = await asOwner('PUT', `/api/events/${wedding.id}/payments/${pid}`, { amount: Number(existing.a) })
    check('…and the installment is restored for the sections below', restored.status === 200 || restored.status === 201,
      { status: restored.status, error: restored.json?.error })
    const back = await one(sql`SELECT amount::numeric AS a FROM event_payment WHERE id = ${pid}`)
    check('…back to its original amount', Number(back?.a) === Number(existing.a), { expected: existing.a, got: back?.a })
  }
}

// ══════════ who may touch the money ══════════════════════════════════════════════════════════
console.log('\n══════════ who may schedule ══════════')
{
  const byServer = await asServer('POST', `/api/events/${wedding.id}/payments`, { label: 'Tip jar', amount: 10 })
  check('a field/server seat cannot schedule a deposit', byServer.status === 403, { status: byServer.status, body: byServer.text?.slice(0, 140) })
  check('…and the schedule is untouched', (await scheduled()) === 11700, { scheduled: await scheduled() })
  const read = await asServer('GET', `/api/events/${wedding.id}/beo`)
  check('…but may read the banquet event order, which is their running sheet', read.status === 200, { status: read.status })
}

// ══════════ another venue's booking ══════════════════════════════════════════════════════════
console.log('\n══════════ company scoping ══════════')
{
  const [other] = await db.insert(company).values({
    name: 'Rival Hall', slug: 'rival-events-t39', email: 'rival@test.local', state: 'OH', settings: {}, enabledFeatures: ['events'],
  } as any).returning()
  const [intruder] = await db.insert(user).values({
    email: 'intruder@rivalhall.local', passwordHash: 'x', firstName: 'I', lastName: 'R', role: 'owner', companyId: other.id, isActive: true,
  } as any).returning()

  const list = await as(intruder)('GET', '/api/events')
  check('another venue sees no bookings here', !/Hollings/.test(list.text), { status: list.status, body: list.text?.slice(0, 160) })
  const peek = await as(intruder)('GET', `/api/events/${wedding.id}`)
  check('…cannot open this booking', peek.status === 404, { status: peek.status })
  const dep = await as(intruder)('POST', `/api/events/${wedding.id}/payments`, { label: 'theirs', amount: 100 })
  check('…nor schedule against it', dep.status === 404, { status: dep.status })
  check('…and the schedule is still 11700', (await scheduled()) === 11700, { scheduled: await scheduled() })
}

// ══════════ T41 · the rule holds when the TOTAL comes down, not only when a payment goes up ═════
//
// H-01 above guards the door where an instalment is ADDED. Nothing guarded the door where the total
// is LOWERED, so the whole rule was bypassable in one move: schedule the full amount, then delete a
// menu line. The invoice drops and the venue is holding deposits for more than the event is worth.
//
// The wedding arrives here with a $11,700 menu (two lines) and $11,700 scheduled — exactly square,
// which is the state where any reduction breaks it.
console.log('\n══════════ lowering the total cannot get under the schedule ══════════')
{
  const before = await asOwner('GET', `/api/events/${wedding.id}`)
  const lines = before.json?.menu ?? []
  check('T41: the wedding has its two menu lines and a square schedule',
    lines.length === 2 && Number(before.json?.invoice?.total) === 11700 && (await scheduled()) === 11700,
    { lines: lines.length, invoice: before.json?.invoice?.total, scheduled: await scheduled() })

  const bar = lines.find((l: any) => /Bar package/.test(String(l.name)))
  check('T41: …including the $1,500 bar package', !!bar, lines.map((l: any) => l.name))

  // THE ASSERTION THIS SECTION EXISTS FOR.
  const del = await asOwner('DELETE', `/api/events/${wedding.id}/menu/${bar.id}`)
  check('T41: deleting a menu line that would drop the invoice under the schedule is REFUSED',
    del.status === 400, { status: del.status, body: del.text?.slice(0, 240) })
  check('T41: …and the message names both figures', /11,?700\.00/.test(String(del.json?.error)) && /10,?200\.00/.test(String(del.json?.error)),
    del.json?.error)

  const after = await asOwner('GET', `/api/events/${wedding.id}`)
  check('T41: …the line is still on the menu — the transaction rolled back',
    (after.json?.menu ?? []).length === 2, (after.json?.menu ?? []).map((l: any) => l.name))
  check('T41: …the invoice is still 11700', Number(after.json?.invoice?.total) === 11700, { total: after.json?.invoice?.total })
  check('T41: …and the schedule is untouched', (await scheduled()) === 11700, { scheduled: await scheduled() })

  // Editing a line DOWN is the same move with a different verb.
  const edit = await asOwner('PUT', `/api/events/${wedding.id}/menu/${bar.id}`, { unitPrice: 1 })
  check('T41: editing a line down to $1 is refused for the same reason', edit.status === 400,
    { status: edit.status, body: edit.text?.slice(0, 200) })
  const afterEdit = await asOwner('GET', `/api/events/${wedding.id}`)
  check('T41: …and the price did not change', Number((afterEdit.json?.menu ?? []).find((l: any) => l.id === bar.id)?.unitPrice) === 12.5,
    (afterEdit.json?.menu ?? []).map((l: any) => `${l.name} @ ${l.unitPrice}`))

  // Raising the total is always fine — the guard must not refuse everything.
  const up = await asOwner('PUT', `/api/events/${wedding.id}/menu/${bar.id}`, { unitPrice: 20 })
  check('T41: raising a line is still allowed', up.status === 200, { status: up.status, body: up.text?.slice(0, 180) })
  const raised = await asOwner('GET', `/api/events/${wedding.id}`)
  check('T41: …and the invoice follows it up to 12600', Number(raised.json?.invoice?.total) === 12600,
    { total: raised.json?.invoice?.total })

  // And once the schedule is reduced, the menu is free to come down again — proving the refusal is
  // about the schedule and not a blanket ban on deleting lines.
  const sched = (raised.json?.payments ?? raised.json?.schedule ?? [])
  const dropMe = sched.find((p: any) => Number(p.amount) === 5200) || sched[sched.length - 1]
  const dropped = await asOwner('DELETE', `/api/events/${wedding.id}/payments/${dropMe.id}`)
  check('T41: an instalment can be dropped from the schedule', dropped.status === 200 || dropped.status === 204,
    { status: dropped.status, body: dropped.text?.slice(0, 200) })

  const nowOk = await asOwner('DELETE', `/api/events/${wedding.id}/menu/${bar.id}`)
  check('T41: …and NOW the menu line deletes, because the schedule fits what is left',
    nowOk.status === 200, { status: nowOk.status, body: nowOk.text?.slice(0, 240), scheduled: await scheduled() })
  const final = await asOwner('GET', `/api/events/${wedding.id}`)
  check('T41: …leaving one line and a 10200 invoice', (final.json?.menu ?? []).length === 1 && Number(final.json?.invoice?.total) === 10200,
    { lines: (final.json?.menu ?? []).length, total: final.json?.invoice?.total })
  check('T41: …with the schedule inside it', (await scheduled()) <= 10200, { scheduled: await scheduled() })
}

// ══════════ T41 · the service team gets the sheet, not the money ════════════════════════════════
//
// "Staff sees event money that its role blocks elsewhere: the event page (F&B total, outstanding,
//  the invoice card), the BEO Payments section with amounts, and dashboard stats (outstanding
//  $29,589, overdue $2,840). Hide it, or give the BEO a kitchen/floor version without money."
//
// The second option is the one taken, because a service team with no BEO cannot run the event —
// refusing the sheet would be the worse failure. The kitchen keeps the items, the basis, the
// QUANTITIES and the run of show; the unit prices, the totals and the Payments section go.
//
// `invoices:read` is the gate, which is the same permission /api/invoices already refuses this seat
// with — the point being that the two now agree instead of contradicting each other.
console.log('\n══════════ T41 · what the floor seat may read ══════════')
{
  const money = /11,?700|10,?200|11700|10200/

  // The event page.
  const byServer = await asServer('GET', `/api/events/${wedding.id}`)
  check('T41: a server can still open the event', byServer.status === 200, { status: byServer.status })
  check('T41: …and it still says who, when and which room',
    /Hollings/.test(byServer.text) && !!byServer.json?.event?.eventDate, byServer.json?.event?.name)
  check('T41: …with the menu lines and their QUANTITIES, which the kitchen needs',
    (byServer.json?.menu || []).length >= 1 && Number((byServer.json?.menu || [])[0]?.quantity) > 0,
    (byServer.json?.menu || []).map((l: any) => `${l.name} ×${l.quantity}`))
  // THE ASSERTIONS.
  check('T41: …and NO unit price on any line',
    (byServer.json?.menu || []).every((l: any) => !('unitPrice' in l)),
    Object.keys((byServer.json?.menu || [])[0] || {}))
  check('T41: …no totals block', !byServer.json?.totals, byServer.json?.totals)
  check('T41: …no invoice card', byServer.json?.invoice === null, byServer.json?.invoice)
  check('T41: …and no payment schedule', (byServer.json?.payments || []).length === 0,
    (byServer.json?.payments || []).length)
  check('T41: …so none of the event money is in the payload at all', !money.test(byServer.text || ''),
    (byServer.text || '').slice(0, 200))

  // The owner's view is unchanged.
  const byOwnerPage = await asOwner('GET', `/api/events/${wedding.id}`)
  check('T41: the owner still sees the totals and the invoice',
    !!byOwnerPage.json?.totals && !!byOwnerPage.json?.invoice?.id, { totals: byOwnerPage.json?.totals })
  check('T41: …and the unit prices', (byOwnerPage.json?.menu || []).some((l: any) => 'unitPrice' in l),
    Object.keys((byOwnerPage.json?.menu || [])[0] || {}))

  // The BEO.
  const beoServer = await asServer('GET', `/api/events/${wedding.id}/beo`)
  check('T41: the BEO still prints for the floor — it is their running sheet', beoServer.status === 200,
    { status: beoServer.status })
  check('T41: …with the run of show and the menu items', /Run of Show/.test(beoServer.text)
    && /Plated dinner/.test(beoServer.text), beoServer.text?.slice(0, 120))
  check('T41: …and the quantity', /120/.test(beoServer.text), null)
  check('T41: …but NO Payments section', !/<h2>Payments<\/h2>/.test(beoServer.text), null)
  check('T41: …no food-and-beverage total', !/Food &amp; beverage total/.test(beoServer.text), null)
  check('T41: …and no money anywhere on the sheet', !money.test(beoServer.text || ''), null)

  const beoOwner = await asOwner('GET', `/api/events/${wedding.id}/beo`)
  check('T41: the owner\'s BEO still carries the Payments section', /<h2>Payments<\/h2>/.test(beoOwner.text), null)
  check('T41: …and the totals', /Food &amp; beverage total/.test(beoOwner.text), null)
}

/**
 * EVERY money field on this vertical, not just the one that got reported. (T51 follow-up)
 *
 * The owner reported "0.001 amounts are accepted" about a deposit instalment. I fixed that route and
 * they came back with "0.001 menu prices and quantity 0 are accepted" — because every money field
 * here was validated with `< 0`, and I had fixed the path instead of the rule behind it. Six places.
 *
 * The distinction the rule must hold is why this is a table and not a blunt `> 0`: a menu line at
 * $0.00 is a COMPLIMENTARY item and has to stay allowed, while 0.001 is a typo that stores as 0.00
 * and silently makes a priced line free. A quantity of nought is never meaningful.
 */
console.log('\n══════════ the money rule, on every field that takes money ══════════')
{
  const menuLine = async (body: any) => asOwner('POST', `/api/events/${wedding.id}/menu`, { name: 'T51 rule probe', ...body })

  for (const [where, call] of [
    ['a menu line', () => menuLine({ unitPrice: 0.001, quantity: 2 })],
    ["the event's quoted total", () => asOwner('PUT', `/api/events/${wedding.id}`, { quotedTotal: 0.004 })],
    ["the event's deposit required", () => asOwner('PUT', `/api/events/${wedding.id}`, { depositRequired: 0.002 })],
  ] as Array<[string, () => Promise<any>]>) {
    const r = await call()
    check(`T51: a sub-cent price on ${where} is refused`, r.status === 400, { status: r.status, error: r.json?.error })
    check('…and the message says it rounds to $0.00', /rounds to \$0\.00/.test(String(r.json?.error ?? '')), { error: r.json?.error })
  }

  {
    const r = await menuLine({ unitPrice: 85, quantity: 0 })
    check('T51: a menu line with quantity 0 is refused', r.status === 400, { status: r.status, error: r.json?.error })
    check('…and it says to remove the line instead', /remove the line/i.test(String(r.json?.error ?? '')), { error: r.json?.error })
  }

  /**
   * THE REFUSAL MUST NOT OFFER A WAY OUT THAT IS ALSO REFUSED. (T58 follow-up)
   *
   * Owner: *"refusing a 0.001 payment says 'Enter 0 if it is complimentary', but 0 is then refused
   * too."* Both rules were right — a menu line CAN be complimentary, a scheduled payment of nothing
   * never is — but one shared message spoke for both, so the stricter path sent the operator round a
   * loop. The two messages must stay DIFFERENT, which is what these four assertions hold.
   */
  {
    const sub = await asOwner('POST', `/api/events/${wedding.id}/payments`, { label: 'T58 wording', amount: 0.001, dueDate: '2027-04-01' })
    check('a sub-cent INSTALMENT is refused', sub.status === 400, { status: sub.status, error: sub.json?.error })
    check('…and does NOT tell the operator to enter 0, which this path also refuses',
      !/enter 0\b/i.test(String(sub.json?.error ?? '')), { error: sub.json?.error })
    check('…it asks for at least a cent instead', /at least one cent/i.test(String(sub.json?.error ?? '')),
      { error: sub.json?.error })

    const zero = await asOwner('POST', `/api/events/${wedding.id}/payments`, { label: 'T58 zero', amount: 0, dueDate: '2027-04-01' })
    check('…and an instalment of exactly 0 is refused too, as it always was', zero.status === 400,
      { status: zero.status, error: zero.json?.error })
    check('…saying it must be more than nothing', /more than \$0\.00/i.test(String(zero.json?.error ?? '')),
      { error: zero.json?.error })

    // The menu line keeps the OTHER message, because there zero is a real answer.
    const line = await menuLine({ unitPrice: 0.001, quantity: 1 })
    check('a menu line still gets the complimentary wording, because 0 IS allowed there',
      /enter 0 if it is complimentary/i.test(String(line.json?.error ?? '')), { error: line.json?.error })
  }

  /**
   * ZERO MONEY IS STILL ALLOWED — the half a blunt `> 0` would have broken. A venue throwing in a
   * celebration cake puts it on the banquet order at $0.00 so the kitchen makes it.
   */
  {
    const r = await menuLine({ name: 'Complimentary celebration cake', unitPrice: 0, quantity: 1 })
    check('a COMPLIMENTARY menu line at $0.00 is still allowed', r.status === 201,
      { status: r.status, body: r.text?.slice(0, 200) })
    if (r.status === 201 && r.json?.id) await asOwner('DELETE', `/api/events/${wedding.id}/menu/${r.json.id}`)
  }
  {
    const r = await asOwner('PUT', `/api/events/${wedding.id}`, { depositRequired: 0 })
    check('…and a booking taken with NO deposit is still allowed', r.status === 200 || r.status === 201,
      { status: r.status, error: r.json?.error })
  }

  {
    const made = await menuLine({ name: 'T51 canapés', unitPrice: 12.5, quantity: 40 })
    check('a real priced line saves', made.status === 201, { status: made.status, body: made.text?.slice(0, 200) })
    const lid = made.json?.id
    if (lid) {
      const sub = await asOwner('PUT', `/api/events/${wedding.id}/menu/${lid}`, { unitPrice: 0.001 })
      check('T51: a sub-cent price is refused on the EDIT too', sub.status === 400, { status: sub.status, error: sub.json?.error })
      const q0 = await asOwner('PUT', `/api/events/${wedding.id}/menu/${lid}`, { quantity: 0 })
      check('T51: …and so is a quantity of 0', q0.status === 400, { status: q0.status, error: q0.json?.error })
      const still = await one(sql`SELECT unit_price::numeric AS p, quantity::numeric AS q FROM event_menu_item WHERE id = ${lid}`)
      check('…and neither refusal changed the line', Number(still?.p) === 12.5 && Number(still?.q) === 40,
        { price: still?.p, quantity: still?.q })
      await asOwner('DELETE', `/api/events/${wedding.id}/menu/${lid}`)
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
