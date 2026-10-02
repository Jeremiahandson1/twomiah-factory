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
  ]
  for (const [label, body] of cases) {
    const r = await asOwner('POST', `/api/events/${wedding.id}/payments`, { label: 'bad', ...body })
    check(`${label} is refused`, r.status === 400, { status: r.status, error: r.json?.error })
  }
  const badDate = await asOwner('POST', `/api/events/${wedding.id}/payments`, { label: 'x', amount: 1, dueDate: '19/06/2027' })
  check('a due date that is not YYYY-MM-DD is refused', badDate.status === 400 && /YYYY-MM-DD/.test(String(badDate.json?.error)),
    { status: badDate.status, error: badDate.json?.error })

  check('…and SEVEN refusals scheduled nothing', (await payments()) === before, { before, after: await payments() })
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

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
