// The events dashboard printed the venue's money to every seat. (T42 events)
//
//   "Viewer sees more money than staff (event totals, invoices, BEO payments) — needs a product
//    decision."
//   "Every deposit guard holds for every role and money reconciles; staff dashboard money and viewer
//    money remain."
//
// THE DECISION, and it is two answers rather than one:
//
//   · REVENUE is a read-only office seat's business. `viewer` is the bookkeeper — invoices, totals,
//     what the venue is owed. `invoices:read` is in its list deliberately, and it stays. "Apply the
//     staff stripping to viewer" would empty the one seat whose purpose is reading the books.
//   · THE COORDINATOR RUNG (`field`) does not get it. Reports already refuses it; GET
//     /api/dashboard/stats carried `authenticate` alone, so the same figures arrived on the home
//     screen anyway. One door enforcing a rule and another ignoring it is not a rule.
//
// THE KEYS ARE ABSENT, NOT ZERO, and that is the other half. `money(0)` renders "$0.00", which tells
// a coordinator the venue is owed nothing and has nothing booked — a figure that is wrong is worse
// than a tile that is not there. T42 names this fleet-wide: "Hidden money shown as $0 instead of
// hidden." So the response omits the keys and says `moneyWithheld`, and the cards fall away.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, event, eventMenuItem, invoice } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'The Oast House', slug: 'oast-t42-dash', email: 'dash-t42@test.local',
  settings: {}, enabledFeatures: ['events', 'invoices'],
} as any).returning()

const mk = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@oast-t42.local`, passwordHash: 'x', firstName: tag, lastName: 'U',
  role, companyId: co.id, isActive: true,
} as any).returning())[0]
const owner = await mk('owner', 'owner')
const manager = await mk('manager', 'manager')
// The coordinator rung. qa.staff normalises to `field` on this template.
const coordinator = await mk('field', 'coord')
const books = await mk('viewer', 'books')

const [client] = await db.insert(contact).values({
  companyId: co.id, type: 'client', name: 'Harper / Diaz', email: 'harper-t42@test.local',
} as any).returning()

// A held event in the future, so its menu lines count towards Booked Value Ahead.
const future = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10)
const [ev] = await db.insert(event).values({
  companyId: co.id, contactId: client.id, name: 'Harper / Diaz wedding',
  eventType: 'wedding', status: 'confirmed', eventDate: future, guestCount: 80,
} as any).returning()

// 80 × 74.50 = 5,960.00 — a figure nothing else in the payload could produce.
await db.insert(eventMenuItem).values({
  companyId: co.id, eventId: ev.id, name: 'Set menu B', perPerson: true, quantity: 80, unitPrice: '74.50',
} as any)

// An unpaid invoice, so Payments Overdue / outstanding has something real in it.
await db.insert(invoice).values({
  companyId: co.id, contactId: client.id, number: 'INV-T42-EV1', status: 'sent',
  subtotal: '2980.00', taxRate: '0', taxAmount: '0', discount: '0', total: '2980.00', amountPaid: '0',
  dueDate: new Date(Date.now() - 7 * 86400000),
} as any)

const app = new Hono()
app.route('/api/dashboard', (await import('./src/routes/dashboard.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const as = (who: any) => async () => {
  const res = await app.request('/api/dashboard/stats', { headers: { 'x-test-user': who.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

// ══════════ the seats that run the books ════════════════════════════════════════════════════════
console.log('\n══════════ the owner, the manager and the office seat ══════════')
for (const [label, who] of [['the owner', owner], ['the manager', manager], ['the read-only office seat', books]] as const) {
  const r = await as(who)()
  check(`${label} gets the dashboard`, r.status === 200, { status: r.status, body: r.text?.slice(0, 160) })
  check('…with Booked Value Ahead of 5,960 — 80 covers at 74.50',
    Number(r.json?.events?.bookedValue) === 5960, r.json?.events)
  check('…and the money owed, which is the figure a venue loses track of',
    Number(r.json?.payments?.outstanding) === 2980 && Number(r.json?.payments?.overdue) === 2980,
    r.json?.payments)
  check('…and no withheld flag on it', r.json?.moneyWithheld === undefined, r.json?.moneyWithheld)
}

// ══════════ the coordinator rung ═════════════════════════════════════════════════════════════════
console.log('\n══════════ the coordinator — the book, not the books ══════════')
{
  const r = await as(coordinator)()
  check('the coordinator still gets the dashboard — it is how the day is run', r.status === 200,
    { status: r.status, body: r.text?.slice(0, 160) })
  check('…with the pipeline and the diary intact',
    Number(r.json?.pipeline?.confirmed) === 1 && Number(r.json?.events?.upcoming30) === 1 &&
    Number(r.json?.contacts) === 1, { pipeline: r.json?.pipeline, events: r.json?.events, contacts: r.json?.contacts })
  check('…and the rooms and the event types, which is the work',
    Array.isArray(r.json?.bySpace) && !!r.json?.byType?.wedding, { bySpace: r.json?.bySpace, byType: r.json?.byType })

  check('T42: …with NO bookedValue key', r.json?.events?.bookedValue === undefined, r.json?.events)
  check('T42: …and NO payments block at all', r.json?.payments === undefined, r.json?.payments)
  check('T42: …absent, not zeroed — "$0.00 outstanding" would be a wrong figure, not a hidden one',
    !/"bookedValue"/.test(r.text || '') && !/"payments"/.test(r.text || ''), (r.text || '').slice(0, 300))
  check('T42: …no figure from either surface anywhere in the payload',
    !/5960|2980/.test(r.text || ''), (r.text || '').slice(0, 300))
  check('T42: …and the page is TOLD the money was withheld, so the cards go rather than read $0.00',
    r.json?.moneyWithheld === true, r.json?.moneyWithheld)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
