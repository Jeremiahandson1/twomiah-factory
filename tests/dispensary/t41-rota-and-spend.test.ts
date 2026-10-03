// crm-dispensary — the rota, the timesheet, and what a customer has spent. (T41)
//
//   M  "Viewer can read staff pay rates, shifts and time entries through the API (/api/team,
//       /api/scheduling/*) while the Team and Scheduling pages are blocked."
//   L  "Customer Total Spent $43.75 in the list vs $87.50 on detail (detail counts a refunded
//       order)."
//
// Two different kinds of fault with one shape: a figure that is right on one screen and wrong on
// another, or readable by someone the nav has already decided should not see it.
//
// THE PAY-RATES HALF was closed earlier in this campaign (routes/team.ts strips hourlyRate below
// manager) and is re-asserted here, because a leak that was closed once and is not pinned comes
// back. The shifts and timesheet half is new: both reads had no gate at all.
//
// WHY OWN-ONLY RATHER THAN REFUSED. A budtender has to find their own shift to clock in to it, and
// /shifts/:id/clock-in is gated on budtender + ownership precisely so they can. Refusing the list
// would leave them a clock-in they cannot reach. Both directions are asserted.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, order } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Twomiah Leaf', slug: 'leaf-t41rota', email: 'rota@test.local', state: 'OH',
  enabledFeatures: ['contacts', 'orders', 'scheduling'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-t41rota@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role,
  companyId: co.id, hourlyRate: '21.50',
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')
const budtender = await mkUser('budtender', 'bud')
const colleague = await mkUser('budtender', 'colleague')
const viewer = await mkUser('viewer', 'viewer')

const app = new Hono()
app.route('/api/contacts', (await import('./src/routes/contacts.ts')).default)
app.route('/api/scheduling', (await import('./src/routes/scheduling.ts')).default)
app.route('/api/team', (await import('./src/routes/team.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const as = (u: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': u.id, 'x-test-company': co.id, 'x-test-role': u.role },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const asOwner = as(owner), asManager = as(manager), asBud = as(budtender), asViewer = as(viewer)

// ══════════ a rota with two people on it ════════════════════════════════════════════════════════
console.log('\n══════════ the rota ══════════')
{
  const mine = await asManager('POST', '/api/scheduling/shifts', {
    userId: budtender.id, role: 'budtender', date: '2026-11-02', startTime: '09:00', endTime: '17:00',
  })
  check('the manager rosters the budtender', mine.status === 201 || mine.status === 200,
    { status: mine.status, body: mine.text?.slice(0, 200) })
  const theirs = await asManager('POST', '/api/scheduling/shifts', {
    userId: colleague.id, role: 'budtender', date: '2026-11-02', startTime: '12:00', endTime: '20:00',
  })
  check('…and a colleague', theirs.status === 201 || theirs.status === 200,
    { status: theirs.status, body: theirs.text?.slice(0, 200) })

  const asManagerSees = await asManager('GET', '/api/scheduling/shifts')
  check('the manager sees the whole rota — both shifts', (asManagerSees.json?.data || []).length === 2,
    { n: (asManagerSees.json?.data || []).length })

  const budSees = await asBud('GET', '/api/scheduling/shifts')
  check('T41: the budtender still gets a shift list — they have to find their own to clock in',
    budSees.status === 200, { status: budSees.status, body: budSees.text?.slice(0, 180) })
  check('T41: …and it is THEIRS only', (budSees.json?.data || []).length === 1
    && (budSees.json?.data || [])[0]?.userId === budtender.id,
    (budSees.json?.data || []).map((s: any) => s.userId))
  // Asking for somebody else by id must not be a way round it.
  const budAsks = await asBud('GET', `/api/scheduling/shifts?userId=${colleague.id}`)
  check('T41: …and asking for a colleague by id does not get round it',
    (budAsks.json?.data || []).every((s: any) => s.userId === budtender.id),
    (budAsks.json?.data || []).map((s: any) => s.userId))
  check('T41: …the colleague\'s name is nowhere in the payload',
    !/colleague/i.test(budAsks.text || ''), (budAsks.text || '').slice(0, 240))

  const viewerSees = await asViewer('GET', '/api/scheduling/shifts')
  check('T41: a VIEWER — who is on no rota — sees nothing rather than everything',
    viewerSees.status === 200 && (viewerSees.json?.data || []).length === 0,
    { status: viewerSees.status, n: (viewerSees.json?.data || []).length })
}

// ══════════ the timesheet ═══════════════════════════════════════════════════════════════════════
console.log('\n══════════ hours worked ══════════')
{
  // Hours are wages. Written straight to the table: what matters here is who may READ them.
  const mk = (uid: string, inAt: string) => db.execute(sql`
    INSERT INTO time_entries (id, company_id, user_id, clock_in, created_at)
    VALUES (gen_random_uuid(), ${co.id}, ${uid}, ${inAt}, NOW())`)
  await mk(budtender.id, '2026-11-02T14:00:00Z')
  await mk(colleague.id, '2026-11-02T17:00:00Z')

  const mgr = await asManager('GET', '/api/scheduling/time-entries')
  check('the manager sees both timesheets', (mgr.json?.data || []).length === 2,
    { n: (mgr.json?.data || []).length })

  const bud = await asBud('GET', '/api/scheduling/time-entries')
  check('T41: the budtender reads their OWN hours — they have to check what they clocked',
    bud.status === 200 && (bud.json?.data || []).length === 1
    && (bud.json?.data || [])[0]?.userId === budtender.id,
    { status: bud.status, rows: (bud.json?.data || []).map((r: any) => r.userId) })
  const budAsks = await asBud('GET', `/api/scheduling/time-entries?userId=${colleague.id}`)
  check('T41: …and cannot ask for anybody else\'s',
    (budAsks.json?.data || []).every((r: any) => r.userId === budtender.id),
    (budAsks.json?.data || []).map((r: any) => r.userId))

  const viewer2 = await asViewer('GET', '/api/scheduling/time-entries')
  check('T41: and a viewer reads none at all', (viewer2.json?.data || []).length === 0,
    { n: (viewer2.json?.data || []).length })
}

// ══════════ pay rates, re-pinned ════════════════════════════════════════════════════════════════
console.log('\n══════════ pay rates ══════════')
{
  const mgr = await asManager('GET', '/api/team')
  check('the manager sees pay rates', /21\.50/.test(mgr.text || ''), (mgr.text || '').slice(0, 200))
  const viewerTeam = await asViewer('GET', '/api/team')
  check('T41: the viewer reads the roster but NOT the pay rates', viewerTeam.status === 200
    && !/21\.50/.test(viewerTeam.text || '') && !/hourlyRate/.test(viewerTeam.text || ''),
    { status: viewerTeam.status, body: (viewerTeam.text || '').slice(0, 240) })
  const budTeam = await asBud('GET', '/api/team')
  check('T41: …nor does a budtender', !/21\.50/.test(budTeam.text || ''), (budTeam.text || '').slice(0, 200))
}

// ══════════ what a customer has spent ═══════════════════════════════════════════════════════════
console.log('\n══════════ Total Spent, on both screens ══════════')
{
  const [cust] = await db.insert(contact).values({
    companyId: co.id, name: 'Dana Refunded', type: 'customer', email: 'dana-t41rota@test.local',
  } as any).returning()

  // The report's exact pair: $43.75 kept, $43.75 handed back. A screen that adds up face values
  // reaches $87.50; the real figure is $43.75.
  await db.insert(order).values({
    companyId: co.id, contactId: cust.id, orderNumber: 991001, status: 'completed',
    subtotal: '43.75', total: '43.75', taxAmount: '0', refundedAmount: '0',
  } as any)
  await db.insert(order).values({
    companyId: co.id, contactId: cust.id, orderNumber: 991002, status: 'refunded',
    subtotal: '43.75', total: '43.75', taxAmount: '0', refundedAmount: '43.75',
  } as any)

  const list = await asOwner('GET', '/api/contacts')
  const listed = (list.json?.data || []).find((r: any) => r.id === cust.id)
  check('the customers LIST says 43.75 — the refunded sale banks nothing',
    Number(listed?.totalSpent) === 43.75, { totalSpent: listed?.totalSpent })

  const detail = await asOwner('GET', `/api/contacts/${cust.id}`)
  check('T41: and the DETAIL now says the same 43.75, not 87.50',
    Number(detail.json?.totalSpent) === 43.75, { totalSpent: detail.json?.totalSpent })
  check('T41: …from one definition, so the two screens cannot disagree',
    Number(detail.json?.totalSpent) === Number(listed?.totalSpent),
    { list: listed?.totalSpent, detail: detail.json?.totalSpent })
  check('T41: …and the order COUNT agrees too — a refunded sale still happened',
    Number(detail.json?.orderCount) === 2 && Number(listed?.orderCount) === 2,
    { list: listed?.orderCount, detail: detail.json?.orderCount })
  // The orders themselves are still handed over — the detail lists them.
  check('…while the orders are still listed, so the refund is visible on the record',
    (detail.json?.orders || []).length === 2, { n: (detail.json?.orders || []).length })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
