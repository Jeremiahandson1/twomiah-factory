// crm-salon — the dashboard's rebooking tile and the recall list must be the same number.
//
//   "Salon: the rebooking counts disagree."
//
// They could not have agreed. The recall list applies four rules the tile's own query had never heard
// of, and each one pushes the tile HIGHER:
//
//   1. one row per client per RHYTHM, not per service. The tile grouped on (contact, service), so a
//      client who had a root touch-up and a cut in one visit was counted twice — the exact
//      double-count the list was fixed for.
//   2. the client's OWN interval from her visit history, not the menu's figure for a stranger.
//   3. the service categories the salon has switched OFF.
//   4. clients who already hold a future appointment, who have effectively rebooked.
//
// The tile's comment said "Mirrors GET /reminders/due — same rule, one number", which is how a
// disagreement survives being read: the claim was in the code and the rule was not.
//
// Each of the four has a client here built to exercise it, so the equality is not a coincidence of
// empty data — and each is also checked on its own, because a tile that agrees with the list by
// applying none of the rules to EITHER would satisfy the equality and be a worse bug.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, serviceMenu, serviceRecord, appointment } from './db/schema.ts'
import { eq } from 'drizzle-orm'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Rhythm Salon', slug: 'rhythm-t58', email: 'r58@test.local',
  // One category switched off, so rule 3 is live on this tenant.
  settings: { rebookingCategoriesOff: ['Waxing'] },
  enabledFeatures: ['appointments', 'service_records', 'reminders', 'dashboard'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-r58@test.local', passwordHash: 'x', firstName: 'Ola', lastName: 'Owner',
  role: 'owner', companyId: co.id,
} as any).returning()

/** Two colour services on one rhythm, a cut, and a waxing the shop does not chase. */
const [colour] = await db.insert(serviceMenu).values({
  companyId: co.id, name: 'Root touch-up', category: 'Colour', price: '95', durationMin: 90, rebookIntervalDays: 42,
} as any).returning()
const [gloss] = await db.insert(serviceMenu).values({
  // 'colour' in lower case on purpose: categoryKey has to fold it onto 'Colour' above, or Sarah is
  // put on two rhythms that are the same rhythm and chased twice. (RR0929)
  companyId: co.id, name: 'Gloss', category: 'colour', price: '45', durationMin: 30, rebookIntervalDays: 42,
} as any).returning()
const [cut] = await db.insert(serviceMenu).values({
  companyId: co.id, name: 'Cut & Finish', category: 'Cutting', price: '42', durationMin: 45, rebookIntervalDays: 56,
} as any).returning()
const [wax] = await db.insert(serviceMenu).values({
  companyId: co.id, name: 'Brow wax', category: 'Waxing', price: '18', durationMin: 15, rebookIntervalDays: 28,
} as any).returning()

const client = async (name: string) => (await db.insert(contact).values({
  companyId: co.id, type: 'client', name, email: `${name.replace(/\W+/g, '').toLowerCase()}-r58@test.local`,
} as any).returning())[0]

const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d }
const visit = async (contactId: string, serviceId: string, days: number) => db.insert(serviceRecord).values({
  companyId: co.id, contactId, serviceId, performedAt: daysAgo(days), priceCharged: '50',
} as any)

// ── rule 1: two services, ONE rhythm, one row. Overdue on a 42-day colour interval. ──────────────
const sarah = await client('Sarah Mitchell')
await visit(sarah.id, colour.id, 60)
await visit(sarah.id, gloss.id, 60)   // same visit, same rhythm — must not be a second row

// ── rule 2: a client whose own rhythm is much shorter than the menu's 56 days ────────────────────
// Four cuts three weeks apart: her interval is ~21 days, so she is overdue after 25. On the menu's
// 56 days she would not be due at all.
const nadia = await client('Nadia Okonkwo')
for (const d of [25, 46, 67, 88]) await visit(nadia.id, cut.id, d)

// ── rule 3: a switched-off category ─────────────────────────────────────────────────────────────
const wendy = await client('Wendy Barnes')
await visit(wendy.id, wax.id, 60)

// ── rule 4: due, but already booked back in ─────────────────────────────────────────────────────
const bea = await client('Bea Holloway')
await visit(bea.id, colour.id, 60)
await db.insert(appointment).values({
  companyId: co.id, contactId: bea.id, serviceId: colour.id,
  startTime: new Date(Date.now() + 5 * 864e5), endTime: new Date(Date.now() + 5 * 864e5 + 90 * 60_000),
  status: 'scheduled',
} as any)

// ── and one plainly due-soon client, so the two buckets are both exercised ──────────────────────
const dinah = await client('Dinah Price')
await visit(dinah.id, cut.id, 50)   // 56-day menu interval, no history → due in 6 days

// ── rule 5, the OVERDUE FLOOR: a client who stopped coming two hundred days ago ─────────────────
//
// Due 158 days ago on a 42-day colour rhythm, so she is past the 90-day floor: she is a win-back and
// belongs in /lapsed, not on today's call list. Without somebody out here the window is untestable —
// the first version of this file had every client inside both the real and a widened window, so a
// tile reading a DIFFERENT window still matched the list and the mutation proved nothing.
const lapsed = await client('Greta Vance')
await visit(lapsed.id, colour.id, 200)

const app = new Hono()
app.route('/api/reminders', (await import('./src/routes/reminders.ts')).default)
app.route('/api/dashboard', (await import('./src/routes/dashboard.ts')).default)
app.onError(errorHandler)
const call = async (method: string, path: string) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' },
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

console.log('\n══════════ the recall list ══════════')
const due = await call('GET', '/api/reminders/due?window=14&maxOverdue=90')
check('the list answers', due.status === 200, { status: due.status, body: due.text?.slice(0, 300) })
const rows: any[] = due.json?.data ?? (Array.isArray(due.json) ? due.json : [])
const names = rows.map((r) => r.clientName)

// Each rule, on its own — so the equality below cannot be satisfied by applying none of them.
check('rule 1: the client with two colour services is on the list ONCE, not twice',
  names.filter((n) => n === 'Sarah Mitchell').length === 1, { names })
check('rule 2: the client on her own shorter rhythm is on it', names.includes('Nadia Okonkwo'), { names })
check('…and the interval used is hers, not the menu\'s 56 days',
  (rows.find((r) => r.clientName === 'Nadia Okonkwo')?.rebookIntervalDays ?? 56) < 56,
  { interval: rows.find((r) => r.clientName === 'Nadia Okonkwo')?.rebookIntervalDays })
check('rule 3: the switched-off category is not chased', !names.includes('Wendy Barnes'), { names })
check('rule 4: the client who already rebooked is not chased', !names.includes('Bea Holloway'), { names })
check('rule 5: the client 158 days overdue is past the floor and off the call list',
  !names.includes('Greta Vance'), { names })
check('the plainly due-soon client is on it', names.includes('Dinah Price'), { names })
check('…so the list is not empty, which would make the equality meaningless', rows.length >= 3, { rows: rows.length })

console.log('\n══════════ the dashboard tile ══════════')
const dash = await call('GET', '/api/dashboard/stats')
check('the dashboard answers', dash.status === 200, { status: dash.status, body: dash.text?.slice(0, 300) })
const tile = dash.json?.reminders ?? {}
const tileTotal = Number(tile.overdue || 0) + Number(tile.dueSoon || 0)

// THE FINDING.
check('the tile totals the same number of clients as the list',
  tileTotal === rows.length, { tile, tileTotal, list: rows.length, names })

const listOverdue = rows.filter((r) => r.overdue).length
check('…and agrees on how many of them are OVERDUE',
  Number(tile.overdue || 0) === listOverdue, { tileOverdue: tile.overdue, listOverdue })
check('…and on how many are due soon',
  Number(tile.dueSoon || 0) === rows.length - listOverdue, { tileDueSoon: tile.dueSoon, expected: rows.length - listOverdue })
// Both buckets non-empty, so the agreement is not two zeroes meeting.
check('both buckets actually have somebody in them', listOverdue > 0 && rows.length - listOverdue > 0,
  { listOverdue, dueSoon: rows.length - listOverdue })

console.log('\n══════════ the tile moves with the list ══════════')
{
  // Book Sarah back in. She leaves the list, and the tile must drop by exactly one.
  await db.insert(appointment).values({
    companyId: co.id, contactId: sarah.id, serviceId: colour.id,
    startTime: new Date(Date.now() + 3 * 864e5), endTime: new Date(Date.now() + 3 * 864e5 + 90 * 60_000),
    status: 'scheduled',
  } as any)

  const due2 = await call('GET', '/api/reminders/due?window=14&maxOverdue=90')
  const rows2: any[] = due2.json?.data ?? []
  check('she is off the list once she is booked', !rows2.map((r) => r.clientName).includes('Sarah Mitchell'),
    { names: rows2.map((r) => r.clientName) })
  check('…and the list is one shorter', rows2.length === rows.length - 1, { before: rows.length, after: rows2.length })

  const dash2 = await call('GET', '/api/dashboard/stats')
  const tile2 = dash2.json?.reminders ?? {}
  check('…and the tile followed it, without being told', Number(tile2.overdue || 0) + Number(tile2.dueSoon || 0) === rows2.length,
    { tile2, list: rows2.length })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
