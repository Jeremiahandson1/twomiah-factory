// Salon — the rebooking list is answered on the shop's calendar, not UTC's.
//
// Salon T25/T26 N2 was "UTC-vs-local in three places", fixed in faca20cf with salonToday() — The Book's
// default day, the membership start date, the invoice line period, the visit date box and the
// future-visit guard. GET /reminders/due was missed. It compared each client's due date against
// `new Date().toISOString().slice(0, 10)`:
//
//     .map(r => ({ ...r, overdue: r.dueDate < t }))
//
// From 19:00 in Chicago that `t` is already TOMORROW's date, so a client due TODAY on the salon's
// own calendar satisfies `dueDate < t` and comes back overdue: true — a day early, every evening.
// (The client due tomorrow is untouched: equal dates are not "<". The off-by-one bites exactly the
// clients who are due right now, which is the worst set to be wrong about.)
//
// It is not a cosmetic label. The same list decides who gets chased, and the route's own comment says
// an already-rebooked client must not be texted as overdue; being wrongly overdue is how a client who
// is due today gets a "you're late" SMS before they are.
//
// cutoff and floor were also today±N measured from Date.now() rather than the salon's day. Those two
// assertions do not discriminate on this fixture — the shifted window still contains the same three
// clients — so they are kept as guards on the fix, not as evidence of the bug.
//
// TIME IS PINNED. A test that asks the real clock reads green for most of the day and red in the
// evening — exactly how this survived the sweep. (see feedback: pin the server environment)
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, serviceMenu, serviceRecord, bookingSettings } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 240)) } }

// 21:05 Sunday 20 September in Chicago == 02:05Z Monday 21 September. The exact window the T26 run
// used, and the one the shop is open in.
const EVENING_CHICAGO = new Date('2026-09-21T02:05:00.000Z')
const SALON_TODAY = '2026-09-20'   // what the people in the salon see
const UTC_TODAY = '2026-09-21'     // what the server used to think

const RealDate = Date
function freeze(at: Date) {
  // @ts-ignore — a fixed clock for the duration of the request
  globalThis.Date = class extends RealDate {
    constructor(...args: any[]) { super(...(args.length ? args : [at.getTime()]) as []) }
    static now() { return at.getTime() }
  } as any
}
const unfreeze = () => { globalThis.Date = RealDate }

await setupSchema()
const [co] = await db.insert(company).values({ name: 'Shear', slug: 'shear-recall', email: 'r@test.local', settings: {}, enabledFeatures: ['salon'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'r@test.local', passwordHash: 'x', firstName: 'Sam', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
await db.insert(bookingSettings).values({ companyId: co.id, timezone: 'America/Chicago' } as any).returning().catch(() => {})

const [svc] = await db.insert(serviceMenu).values({ companyId: co.id, name: 'Colour', price: '120', durationMinutes: 90, rebookIntervalDays: 42 } as any).returning()

/** A client whose next visit falls due exactly on `dueDay`. */
async function clientDueOn(name: string, dueDay: string) {
  const [ct] = await db.insert(contact).values({ companyId: co.id, name, type: 'client', email: `${name.replace(/\W/g, '')}@test.local` } as any).returning()
  const [y, m, d] = dueDay.split('-').map(Number)
  const performed = new Date(Date.UTC(y, m - 1, d) - 42 * 86400000)
  await db.insert(serviceRecord).values({ companyId: co.id, contactId: ct.id, serviceId: svc.id, performedAt: performed, price: '120' } as any)
  return ct.id
}

// Due TOMORROW on the salon's calendar — correct on HEAD too; here to prove the fix moved the
// boundary rather than shifting the whole list by a day.
const tomorrowId = await clientDueOn('Tomorrow Client', '2026-09-21')
// Due TODAY on the salon's calendar — due, but NOT late. This is the client HEAD libels every evening.
const todayId = await clientDueOn('Today Client', '2026-09-20')
// Genuinely late by a week.
const lateId = await clientDueOn('Late Client', '2026-09-13')

const app = new Hono()
app.route('/api/reminders', (await import('./src/routes/reminders.ts')).default)
app.onError(errorHandler)

freeze(EVENING_CHICAGO)
const res = await app.request('/api/reminders/due?window=14&maxOverdue=90', {
  headers: { 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' },
})
const text = await res.text(); let json: any = text; try { json = JSON.parse(text) } catch {}
unfreeze()

const rows: any[] = Array.isArray(json) ? json : (json?.data || [])
const by = (id: string) => rows.find(r => r.contactId === id)

check('the due list answers', res.status === 200, { status: res.status, body: String(text).slice(0, 160) })
check('all three clients are in the window', !!by(tomorrowId) && !!by(todayId) && !!by(lateId), rows.map(r => ({ id: r.contactId, due: r.dueDate, overdue: r.overdue })))

// THE defect.
check('a client due TOMORROW is not called overdue at 9pm', by(tomorrowId)?.overdue === false, { dueDate: by(tomorrowId)?.dueDate, overdue: by(tomorrowId)?.overdue })
check('…and a client due TODAY is not called overdue either', by(todayId)?.overdue === false, { dueDate: by(todayId)?.dueDate, overdue: by(todayId)?.overdue })
check('…while a client a week late still is', by(lateId)?.overdue === true, { dueDate: by(lateId)?.dueDate, overdue: by(lateId)?.overdue })

// The window itself moved with the same bug — prove it is anchored to the salon's day.
{
  freeze(EVENING_CHICAGO)
  const edge = await app.request('/api/reminders/due?window=1&maxOverdue=1', {
    headers: { 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' },
  })
  const j: any = await edge.json().catch(() => ({}))
  unfreeze()
  const got: any[] = Array.isArray(j) ? j : (j?.data || [])
  const ids = got.map(r => r.contactId)
  // window=1 from the SALON's 2026-09-20 reaches 2026-09-21 and no further; floor is 2026-09-19.
  check('a one-day window is measured from the salon day, not UTC\'s', ids.includes(tomorrowId) && ids.includes(todayId), { ids, salonToday: SALON_TODAY })
  check('…and does not reach back past the floor', !ids.includes(lateId), { ids })
}

console.log(`\n(salon today ${SALON_TODAY}; UTC said ${UTC_TODAY})`)
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
