// Salon T27 — H1 and H2.
//
// H1  "Dates after 7 PM Central are a day ahead. The server uses UTC instead of the salon's local
//      date. Appointments Today shows tomorrow's count (8 instead of 5). New invoices are also dated
//      tomorrow, so their due date lands a day late."
//
//      The report guessed this was new in this build. It is not: the invoice line last changed on
//      18 September and the dashboard's `today` has been untouched since the vertical shipped in
//      August. The 20 September invoices were right because they were raised before 19:00 local. Both
//      are the T25 N2 fault in places that sweep never reached — it went looking for
//      `toISOString().slice(0, 10)` and these spell the same bug two other ways:
//        dashboard  new Date(now.getFullYear(), now.getMonth(), now.getDate())  → the SERVER's day
//        invoices   startOfUtcDay(new Date())                                    → the UTC day
//
// H2  "A client can be enrolled twice in the same membership, and both enrolments bill."
//
// TIME IS PINNED. On the real clock these read green for most of the day — which is exactly how they
// survived. (see feedback: pin the server environment)
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, membershipPlan, bookingSettings, appointment } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'
import { eq } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 260)) } }

// 21:05 Sunday 20 September in Chicago == 02:05Z Monday 21 September.
const EVENING_CHICAGO = new Date('2026-09-21T02:05:00.000Z')
const SALON_TODAY = '2026-09-20'
const UTC_TODAY = '2026-09-21'

// THE SERVER'S ZONE IS PART OF THE TEST. The dashboard half of H1 reads the SERVER's local day
// (new Date(now.getFullYear(), ...)), so on a developer machine in America/Chicago the broken code
// accidentally returns the right answer and this suite reads green. Render runs UTC, where it returns
// 8 instead of 5 — the tester's exact number. Refuse to run anywhere else rather than report a pass
// that means nothing. (see feedback: pin the server environment)
if (process.env.TZ !== 'UTC' && Intl.DateTimeFormat().resolvedOptions().timeZone !== 'UTC') {
  console.log('  TZ=UTC bun t27-highs.test.ts   ← run it this way; the server does')
  process.exit(1)
}

const RealDate = Date
function freeze(at: Date) {
  // @ts-ignore
  globalThis.Date = class extends RealDate {
    constructor(...args: any[]) { super(...(args.length ? args : [at.getTime()]) as []) }
    static now() { return at.getTime() }
  } as any
}
const unfreeze = () => { globalThis.Date = RealDate }

await setupSchema()
const [co] = await db.insert(company).values({ name: 'Shear', slug: 'shear-t27', email: 't27@test.local', settings: {}, enabledFeatures: ['salon', 'memberships'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 't27@test.local', passwordHash: 'x', firstName: 'Sam', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
await db.insert(bookingSettings).values({ companyId: co.id, timezone: 'America/Chicago' } as any).returning().catch(() => {})
const [client] = await db.insert(contact).values({ companyId: co.id, name: 'T27 Money Client', type: 'client', email: 't27money@test.local' } as any).returning()
const [plan] = await db.insert(membershipPlan).values({ companyId: co.id, name: 'Blowout Club', price: '107.42', billingCycle: 'monthly', creditsTotal: 4, active: true } as any).returning()

const app = new Hono()
app.route('/api/dashboard', (await import('./src/routes/dashboard.ts')).default)
app.route('/api/invoices', (await import('./src/routes/invoices.ts')).default)
app.route('/api/memberships', (await import('./src/routes/memberships.ts')).default)
app.onError(errorHandler)
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

console.log(`\n── H1a: "Appointments Today" counts the SHOP's day (salon ${SALON_TODAY}, UTC ${UTC_TODAY}) ──`)
{
  // 5 appointments on the salon's today; 8 on the day UTC thinks it is. The report's exact numbers.
  const mk = async (dayStr: string, hour: number) => {
    const start = new Date(`${dayStr}T${String(hour).padStart(2, '0')}:00:00.000Z`)
    await db.insert(appointment).values({
      companyId: co.id, contactId: client.id, status: 'scheduled',
      startTime: start, endTime: new Date(start.getTime() + 30 * 60000),
    } as any)
  }
  // Salon-local 20 Sep runs 2026-09-20T05:00Z .. 2026-09-21T05:00Z (CDT, UTC-5).
  for (let i = 0; i < 5; i++) await mk('2026-09-20', 15 + i)   // 10am-2pm local on the 20th
  for (let i = 0; i < 8; i++) await mk('2026-09-21', 15 + i)   // the 21st local — UTC's "today"

  freeze(EVENING_CHICAGO)
  const res = await call('GET', '/api/dashboard/stats')
  unfreeze()
  const todayCount = res.json?.appointments?.today
  check('H1: the tile counts the salon\'s 5, not UTC\'s 8', todayCount === 5, { got: todayCount, want: 5 })
}

console.log('\n── H1b: a new invoice is dated on the shop\'s calendar ──')
{
  freeze(EVENING_CHICAGO)
  const inv = await call('POST', '/api/invoices', {
    contactId: client.id, lineItems: [{ description: 'T27 blow-dry', quantity: 1, unitPrice: 50 }],
  })
  unfreeze()
  check('the invoice is created', inv.status === 201 || inv.status === 200, inv.json?.error)
  const issued = String(inv.json?.issueDate || '').slice(0, 10)
  check(`H1: issueDate is ${SALON_TODAY}, not UTC's ${UTC_TODAY}`, issued === SALON_TODAY, { issueDate: issued })
  // 30-day terms from the salon's today, not UTC's — otherwise the whole schedule slides a day.
  const due = String(inv.json?.dueDate || '').slice(0, 10)
  check('H1: …and the due date is counted from that same day', due === '2026-10-20', { dueDate: due })
}

console.log('\n── H2: a client cannot hold the same membership twice ──')
{
  const first = await call('POST', '/api/memberships/enrollments', { planId: plan.id, contactId: client.id })
  check('the first enrolment works', first.status === 201 || first.status === 200, first.json?.error)

  const second = await call('POST', '/api/memberships/enrollments', { planId: plan.id, contactId: client.id })
  check('H2: a second enrolment in the same plan is refused', second.status === 409, { status: second.status, err: second.json?.error })
  check('…and names the client and the plan', /Blowout Club/.test(String(second.json?.error || '')), second.json?.error)
  check('…with a code a caller can branch on', second.json?.code === 'ALREADY_ENROLLED', second.json?.code)

  // And only ONE invoice exists for it — the duplicate must not have billed.
  const invs = await call('GET', `/api/invoices?contactId=${client.id}`)
  const rows: any[] = Array.isArray(invs.json) ? invs.json : (invs.json?.data || [])
  const club = rows.filter(r => Number(r.total) === 107.42)
  check('H2: exactly one Blowout Club invoice exists, not two', club.length === 1, { count: club.length, totals: rows.map(r => r.total) })

  // A client who CANCELLED can enrol again — that is a real thing a salon does.
  const enrolId = first.json?.id
  if (enrolId) {
    await db.execute((await import('drizzle-orm')).sql`UPDATE membership_enrollment SET status = 'cancelled' WHERE id = ${enrolId}`)
      .catch(async () => { await db.update((await import('./db/schema.ts')).membershipEnrollment).set({ status: 'cancelled' } as any).where(eq((await import('./db/schema.ts')).membershipEnrollment.id, enrolId)) })
    const again = await call('POST', '/api/memberships/enrollments', { planId: plan.id, contactId: client.id })
    check('…while a client who cancelled can re-join', again.status === 201 || again.status === 200, { status: again.status, err: again.json?.error })
  }
}

console.log(`\n(salon today ${SALON_TODAY}; UTC said ${UTC_TODAY})`)
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
