// The recall list: one row per client per RHYTHM, timed by the client's own history.
//
// Two things were worse than every established salon platform:
//
//   1. The list keyed on (client, service), so a client who had a root touch-up and a cut in one
//      visit appeared TWICE on the same date — one client, one phone call, two rows. Found on the
//      live tenant: Sarah Mitchell, 3 September, twice. Phorest groups recall by Service Category.
//   2. The interval came only from the menu. A client who has come every five weeks for two years
//      was chased on the menu's six, seven days late, every single time.
//
// Both are fixed here. The pure arithmetic is packages/tenant-backend/src/retention/rebooking.ts.
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, serviceMenu, serviceRecord } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Rhythm Salon', slug: 'rhythm', email: 'r@test.local', settings: {},
  enabledFeatures: ['contacts', 'service_menu', 'rebooking_reminders'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-r@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()

// Two services in the SAME category, one in another, and one the salon does not chase.
const mkService = async (name: string, category: string, days: number | null) =>
  (await db.insert(serviceMenu).values({ name, category, price: '80', durationMin: 60, companyId: co.id, rebookIntervalDays: days } as any).returning())[0]
const rootTouchUp = await mkService('Root Touch-Up', 'colour', 42)
const gloss = await mkService('Gloss', 'colour', 42)
const cut = await mkService('Cut & Style', 'hair', 42)
const wax = await mkService('Brow Wax', 'waxing', 42)

const app = new Hono()
app.route('/api/reminders', (await import('./src/routes/reminders.ts')).default)
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

const DAY = 86400000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY)
const mkClient = async (name: string) => (await db.insert(contact).values({ name, type: 'client', companyId: co.id } as any).returning())[0]
const visit = async (client: any, service: any, when: Date) => {
  await db.insert(serviceRecord).values({
    companyId: co.id, contactId: client.id, serviceId: service.id, performedAt: when, priceCharged: '80',
  } as any).returning()
}
const due = async (windowDays = 400) => {
  const r = await api('GET', `/api/reminders/due?window=${windowDays}&maxOverdue=3650`)
  return (r.json?.data || []) as any[]
}
const rowsFor = async (client: any) => (await due()).filter((r) => r.contactId === client.id)

// ═══════════════════ one client, two services, one visit, ONE phone call ════════════════════════
{
  // Exactly the shape found live: a root touch-up and a cut on the same afternoon.
  const sarah = await mkClient('Sarah Mitchell')
  await visit(sarah, rootTouchUp, daysAgo(50))
  await visit(sarah, cut, daysAgo(50))

  const rows = await rowsFor(sarah)
  check('a client who had two services in one visit is chased ONCE per rhythm, not once per service',
    rows.length === 2, rows.map((r) => `${r.serviceName} (${r.category})`))
  check('…and those two rows are the two different rhythms she is on',
    new Set(rows.map((r) => r.category)).size === 2, rows.map((r) => r.category))

  // …and two services in the SAME category really are one row.
  const nina = await mkClient('Nina Colour')
  await visit(nina, rootTouchUp, daysAgo(50))
  await visit(nina, gloss, daysAgo(50))
  const hers = await rowsFor(nina)
  check('two COLOUR services in one visit are one rhythm and one row', hers.length === 1, hers.map((r) => r.serviceName))
  check('…named for the service she most recently had', !!hers[0]?.serviceName, hers[0])
}

// ═══════════════════════ the client's own rhythm beats the menu ═════════════════════════════════
{
  // Comes every 35 days. The menu says 42. Four visits, so three gaps.
  const rita = await mkClient('Rita Regular')
  for (const n of [140, 105, 70, 35]) await visit(rita, rootTouchUp, daysAgo(n))

  const [row] = await rowsFor(rita)
  check('a client with a history of her own is timed by it, not by the menu', row?.intervalBasis === 'client', row)
  check('…at the interval she actually keeps', row?.rebookIntervalDays === 35, row?.rebookIntervalDays)
  check('…so she is due 35 days after her last visit, not 42',
    row?.dueDate === new Date(daysAgo(35).getTime() + 35 * DAY).toISOString().slice(0, 10), row?.dueDate)
  check('…and the desk is told which it is', /her own rhythm/.test(String(row?.intervalNote)), row?.intervalNote)
  check('…with how much history it rests on', row?.visitsInRhythm === 4, row?.visitsInRhythm)
}

{
  // Two visits is one gap, and one gap is an anecdote. The menu still decides.
  const nora = await mkClient('Nora New')
  await visit(nora, rootTouchUp, daysAgo(80))
  await visit(nora, rootTouchUp, daysAgo(20))

  const [row] = await rowsFor(nora)
  check('two visits are not enough to have an opinion — the menu still decides', row?.intervalBasis === 'menu', row)
  check('…at the menu\'s interval', row?.rebookIntervalDays === 42, row?.rebookIntervalDays)
  check('…and says so', /menu/.test(String(row?.intervalNote)), row?.intervalNote)
}

{
  // One interrupted year in an otherwise steady history. A MEAN would put her near 150 days and drop
  // her off the list; the median keeps her on her real rhythm. This is the case the median is for.
  const vera = await mkClient('Vera Interrupted')
  for (const n of [500, 465, 430, 60, 25]) await visit(vera, rootTouchUp, daysAgo(n))

  const [row] = await rowsFor(vera)
  check('one long gap in a steady history does not retime the client', row?.rebookIntervalDays === 35, row?.rebookIntervalDays)
  check('…she is still on her own rhythm', row?.intervalBasis === 'client', row)
}

{
  // Two services on the SAME DAY say nothing about how often she comes, and must not be counted as a
  // zero-day gap that drags the rhythm down.
  const dora = await mkClient('Dora Doubleup')
  for (const n of [120, 80, 40]) { await visit(dora, rootTouchUp, daysAgo(n)); await visit(dora, gloss, daysAgo(n)) }

  const [row] = await rowsFor(dora)
  check('two services on one day are one visit as far as a rhythm is concerned', row?.rebookIntervalDays === 40, row?.rebookIntervalDays)
}

// ═══════════════════════ a salon says what it wants chased ══════════════════════════════════════
{
  const wendy = await mkClient('Wendy Wax')
  await visit(wendy, wax, daysAgo(50))
  check('a waxing client is chased by default', (await rowsFor(wendy)).length === 1)

  await db.update(company).set({ settings: { rebookingCategoriesOff: ['waxing'] } } as any).where(eq(company.id, co.id))
  check('…and not once the salon switches that category off', (await rowsFor(wendy)).length === 0)

  const stillColour = await db.select().from(contact).where(and(eq(contact.companyId, co.id), eq(contact.name, 'Rita Regular')))
  check('…while the categories it still wants are untouched', (await rowsFor(stillColour[0])).length === 1)

  await db.update(company).set({ settings: {} } as any).where(eq(company.id, co.id))
}

// ════════════════════════ a service with no interval is still not chased ════════════════════════
{
  const oneOff = await mkService('Wedding Blow-dry', 'hair', null)
  const bride = await mkClient('Bea Bride')
  await visit(bride, oneOff, daysAgo(30))
  check('a service the menu gives no interval is not a rhythm', (await rowsFor(bride)).length === 0)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
