// T62 Events — "The Events list shows quoted totals" to staff, and the event page draws hidden prices as $0
// ("$0.00 — $9,000.00 short").
//
// The quote and deposit on the event row, and the room's minimum spend and hire fee, are invoices:read. They are
// absent (not 0) for the coordinator on the list, the event page and the spaces list, and moneyWithheld says so.
// A seat that may edit an event but not see its quote cannot overwrite the quote with the blank its form held.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, event, eventSpace } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({ name: 'Malt House', slug: 'malt-t62', email: 'malt-t62@test.local', settings: {}, enabledFeatures: ['events', 'invoices'] } as any).returning()
const mk = async (role: string, tag: string, extra: string[] = []) => (await db.insert(user).values({ email: `${tag}@malt-t62.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true, extraPermissions: extra } as any).returning())[0]
const owner = await mk('owner', 'owner'), manager = await mk('manager', 'manager'), coordinator = await mk('field', 'coord')
// may edit an event (a per-user grant) and still not see what it is priced at
const editor = await mk('field', 'editor', ['contacts:update'])

const [client] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Okafor / Lind', email: 'ol-t62@test.local' } as any).returning()
// figures nothing else in the payloads can produce
const [room] = await db.insert(eventSpace).values({ companyId: co.id, name: 'The Kiln Room', seatedCapacity: 90, minimumSpend: '9017.00', hireFee: '333.33', active: true } as any).returning()
const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
const [ev] = await db.insert(event).values({
  companyId: co.id, contactId: client.id, spaceId: room.id, name: 'Okafor / Lind reception', eventType: 'wedding',
  status: 'confirmed', eventDate: future, guestCount: 70, quotedTotal: '7777.77', depositRequired: '1234.56',
} as any).returning()

const app = new Hono()
app.route('/api/events', (await import('./src/routes/events.ts')).default)
app.route('/api/event-spaces', (await import('./src/routes/eventSpaces.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const FIGURES = /7777|1234\.56|9017|333\.33/

// ── the coordinator: the event, not its price ──
const list = await as(coordinator)('GET', '/api/events')
const row = (list.json?.data || []).find((e: any) => e.id === ev.id)
check('the coordinator lists events — name, date, guests', list.status === 200 && row?.guestCount === 70, row)
check('…with NO quotedTotal or depositRequired key, and moneyWithheld', !!row && !('quotedTotal' in row) && !('depositRequired' in row) && list.json?.moneyWithheld === true, row)
const page = await as(coordinator)('GET', `/api/events/${ev.id}`)
check('the coordinator opens the event and the room', page.status === 200 && page.json?.event?.name === 'Okafor / Lind reception' && page.json?.space?.name === 'The Kiln Room', page.json?.space)
check('…the event row carries no quote or deposit', !('quotedTotal' in (page.json?.event || {})) && !('depositRequired' in (page.json?.event || {})), page.json?.event)
check('…the room carries no minimum spend or hire fee — the "$9,000.00 short" banner has nothing to compute from', !('minimumSpend' in (page.json?.space || {})) && !('hireFee' in (page.json?.space || {})), page.json?.space)
check('…and moneyWithheld is set, so the page draws no $0 tiles', page.json?.moneyWithheld === true && page.json?.totals === undefined, { mw: page.json?.moneyWithheld, totals: page.json?.totals })
const spaces = await as(coordinator)('GET', '/api/event-spaces')
const sr = (spaces.json?.data || []).find((s: any) => s.id === room.id)
check('the coordinator lists the rooms with their capacity', spaces.status === 200 && sr?.seatedCapacity === 90, sr)
check('…and without their prices', !!sr && !('minimumSpend' in sr) && !('hireFee' in sr), sr)
for (const [label, r] of [['events list', list], ['event page', page], ['spaces list', spaces]] as const) check(`…none of the figures anywhere in the ${label}`, !FIGURES.test(r.text), r.text.match(FIGURES)?.[0])

// ── an editor who cannot see the quote cannot blank it ──
const put = await as(editor)('PUT', `/api/events/${ev.id}`, { name: 'Okafor / Lind reception', quotedTotal: null, depositRequired: null, notes: 'Arch at the door' })
check('a seat with contacts:update and no invoices:read saves its edit', put.status === 200 && put.json?.notes === 'Arch at the door', { status: put.status, body: put.text.slice(0, 200) })
check('…the reply carries no quote', put.status === 200 && !FIGURES.test(put.text))
const [after] = await db.select().from(event).where(eq(event.id, ev.id))
check('…and the quote and deposit it could not see are still there', Number(after.quotedTotal) === 7777.77 && Number(after.depositRequired) === 1234.56, { q: after.quotedTotal, d: after.depositRequired })

// ── the people who price the event ──
for (const [who, label] of [[owner, 'the owner'], [manager, 'a manager']] as const) {
  const l = (await as(who)('GET', '/api/events')).json
  check(`${label} sees the quote on the list`, Number((l?.data || []).find((e: any) => e.id === ev.id)?.quotedTotal) === 7777.77 && !l?.moneyWithheld, l?.moneyWithheld)
  const p = (await as(who)('GET', `/api/events/${ev.id}`)).json
  check(`${label} sees the quote, deposit and room minimum on the event page`, Number(p?.event?.quotedTotal) === 7777.77 && Number(p?.event?.depositRequired) === 1234.56 && Number(p?.space?.minimumSpend) === 9017 && !p?.moneyWithheld, { e: p?.event?.quotedTotal, s: p?.space?.minimumSpend })
  const s = (await as(who)('GET', '/api/event-spaces')).json?.data?.find((x: any) => x.id === room.id)
  check(`${label} sees the room's minimum spend and hire fee`, Number(s?.minimumSpend) === 9017 && Number(s?.hireFee) === 333.33, s)
}
const mput = await as(manager)('PUT', `/api/events/${ev.id}`, { quotedTotal: 8000 })
const [mafter] = await db.select().from(event).where(eq(event.id, ev.id))
check('a manager re-prices the event', mput.status === 200 && Number(mafter.quotedTotal) === 8000, { status: mput.status, q: mafter.quotedTotal })

console.log(`\nt62 event money: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
