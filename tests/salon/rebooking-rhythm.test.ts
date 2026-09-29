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
  check('…and the desk is told which it is', /their own rhythm/.test(String(row?.intervalNote)), row?.intervalNote)
  // The live list printed "her own rhythm" next to James Carter. The product knows a name and
  // nothing else, and a name is not a pronoun.
  check('…without guessing the client\'s gender from their name',
    !/\b(her|his|she|he)\b/i.test(String(row?.intervalNote)), row?.intervalNote)
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

// ══════════════════ the shift key does not make a second rhythm ═════════════════════════════════
//
// Category is free text on the menu row, and the live tenant genuinely has both "Color" and
// "colour" on it. Grouping on the raw string would put one client on two rhythms that are the same
// rhythm and chase her twice — the exact bug the grouping exists to fix, re-entering sideways.
{
  const shouty = await mkService('COLOUR Refresh', 'Colour', 42)
  const casey = await mkClient('Casey Case')
  await visit(casey, rootTouchUp, daysAgo(50))   // category 'colour'
  await visit(casey, shouty, daysAgo(48))        // category 'Colour'

  const rows = await rowsFor(casey)
  check('"Colour" and "colour" are one rhythm, not two', rows.length === 1, rows.map((r) => `${r.serviceName} [${r.category}]`))

  await db.update(company).set({ settings: { rebookingCategoriesOff: ['COLOUR'] } } as any).where(eq(company.id, co.id))
  check('…and switching off "COLOUR" switches off "colour" too', (await rowsFor(casey)).length === 0)
  await db.update(company).set({ settings: {} } as any).where(eq(company.id, co.id))
}

// ══════════════════ the category is the way IN, with its own message ════════════════════════════
//
// Phorest works Client Reconnect one Service Category at a time — you look at the overdue clients
// for a category and contact THAT category — and gives each one its own message templates. The
// reason is not tidiness: "time to book your roots" and "time for a trim" are different
// conversations, and a flat list mixing them can only ever send one of the two.
{
  const counts = await api('GET', '/api/reminders/due?window=400&maxOverdue=3650')
  const cats: any[] = counts.json?.categories || []
  check('the list comes back with a count per category', cats.length >= 2, cats)
  check('…naming the category as the menu spells it', cats.every((x) => !!x.label), cats)
  check('…and a total across all of them', counts.json?.totalDue === counts.json?.data?.length, { total: counts.json?.totalDue, rows: counts.json?.data?.length })
  const colour = cats.find((x) => x.category === 'colour')
  check('…with the overdue subset counted separately', typeof colour?.overdue === 'number', colour)

  const onlyColour = await api('GET', '/api/reminders/due?window=400&maxOverdue=3650&category=colour')
  const rows: any[] = onlyColour.json?.data || []
  check('one category can be worked on its own', rows.length > 0 && rows.every((r) => String(r.category).toLowerCase() === 'colour'),
    rows.map((r) => r.category))
  check('…and every client in it appears exactly once',
    new Set(rows.map((r) => r.contactId)).size === rows.length, rows.map((r) => r.clientName))
  check('…while the counts stay UNfiltered, so the desk sees what else is waiting',
    (onlyColour.json?.categories || []).length === cats.length, onlyColour.json?.categories?.length)
  check('…and the filtered count is the rows actually shown', onlyColour.json?.count === rows.length, onlyColour.json?.count)

  // Sarah had a colour and a cut in one visit. Under Colour she is on the list once, which is the
  // answer to "why is this client here twice" — she never was, for one conversation.
  const sarahRows = rows.filter((r) => r.clientName === 'Sarah Mitchell')
  check('a client on two rhythms appears ONCE inside a category', sarahRows.length === 1, sarahRows.length)

  const unknown = await api('GET', '/api/reminders/due?window=400&maxOverdue=3650&category=not-a-category')
  check('an unknown category is an empty list, not everybody', (unknown.json?.data || []).length === 0, unknown.json?.count)
}

// ══════════════════════════ each category gets its own words ════════════════════════════════════
{
  const empty = await api('GET', '/api/reminders/templates')
  check('a shop with no templates written yet returns none', Object.keys(empty.json?.templates || {}).length === 0, empty.json)

  const saved = await api('PUT', '/api/reminders/templates', {
    templates: { Colour: 'Your roots are about due — shall we get you in?', hair: 'Time for a trim!' },
  })
  check('templates can be written per category', saved.status === 200, saved.json)
  check('…keyed the same way the rhythms are, so capitalisation does not matter',
    saved.json?.templates?.colour === 'Your roots are about due — shall we get you in?', saved.json?.templates)

  const withTemplates = await api('GET', '/api/reminders/due?window=400&maxOverdue=3650')
  const colour = (withTemplates.json?.categories || []).find((x: any) => x.category === 'colour')
  const waxing = (withTemplates.json?.categories || []).find((x: any) => x.category === 'waxing')
  check('…and ride along with the list, so the send box can prefill the right one',
    colour?.template === 'Your roots are about due — shall we get you in?', colour)
  check('…while a category nobody has written one for says so, rather than borrowing another\'s',
    waxing ? waxing.template === null : true, waxing)

  const blanked = await api('PUT', '/api/reminders/templates', { templates: { colour: '   ' } })
  check('an empty template drops back to the shop default rather than sending blank text',
    blanked.json?.templates?.colour === undefined, blanked.json?.templates)

  const tooLong = await api('PUT', '/api/reminders/templates', { templates: { colour: 'x'.repeat(700) } })
  check('a message too long to be a text is refused', tooLong.status === 400, tooLong.json)

  const rubbish = await api('PUT', '/api/reminders/templates', { templates: 'nope' })
  check('a malformed body is refused', rubbish.status === 400, rubbish.json)

  await api('PUT', '/api/reminders/templates', { templates: {} })
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
