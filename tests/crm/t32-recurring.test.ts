// T32 500-2 and H7 — the recurring invoice module, where both findings were about money.
//
// 500-2: POST /api/recurring/:id/generate answered 500 and STILL BILLED. The route destructured
//        `{ invoice }` while the service returns the invoice itself, so `invoice.id` threw after the
//        row had been written and the schedule advanced. The tester retried and got two invoices for
//        one $158.25 run — INV-00097 and INV-00098.
//
// H7:    a monthly schedule dated the 31st skipped November entirely. setMonth(+1) on 31 October asks
//        for 31 November, which JavaScript rolls to 1 December, and the schedule then drifts to the
//        1st for good.
//
// The date arithmetic is asserted directly against calculateNextDate, because that is where the rule
// lives and a date rule checked through four layers of HTTP is a date rule nobody can read.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact } = await import('./db/schema.ts')

// ══════════ H7 · the month rule, asserted where it lives ═══════════════════════════════════════
{
  const { calculateNextDate } = await import('./src/shared/index.ts') as any
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const next = (from: string, freq: string) => ymd(calculateNextDate(new Date(`${from}T12:00:00`), freq))

  check('31 Oct + monthly is 30 Nov, not 1 Dec — November was never billed', next('2026-10-31', 'monthly') === '2026-11-30', next('2026-10-31', 'monthly'))
  check('31 Jan + monthly is 28 Feb in a common year', next('2027-01-31', 'monthly') === '2027-02-28', next('2027-01-31', 'monthly'))
  check('…and 29 Feb in a leap year', next('2028-01-31', 'monthly') === '2028-02-29', next('2028-01-31', 'monthly'))
  // With NO anchor the from-date IS the anchor, so this is right for a schedule that starts on the
  // 30th. It is NOT the answer for a schedule anchored on the 31st — see the anchored block below,
  // which is the distinction this test originally got wrong.
  check('30 Nov + monthly, with no anchor, is 30 Dec (a 30th schedule)', next('2026-11-30', 'monthly') === '2026-12-30', next('2026-11-30', 'monthly'))
  check('the 15th stays the 15th', next('2026-10-15', 'monthly') === '2026-11-15', next('2026-10-15', 'monthly'))
  check('31 Dec + quarterly is 31 Mar', next('2026-12-31', 'quarterly') === '2027-03-31', next('2026-12-31', 'quarterly'))
  check('31 Aug + quarterly is 30 Nov', next('2026-08-31', 'quarterly') === '2026-11-30', next('2026-08-31', 'quarterly'))
  check('31 Aug + semiannual is 28 Feb', next('2026-08-31', 'semiannual') === '2027-02-28', next('2026-08-31', 'semiannual'))
  check('29 Feb + annual is 28 Feb, not 1 Mar', next('2028-02-29', 'annual') === '2029-02-28', next('2028-02-29', 'annual'))
  check('weekly is still seven days', next('2026-10-31', 'weekly') === '2026-11-07', next('2026-10-31', 'weekly'))
  check('biweekly is still fourteen', next('2026-10-31', 'biweekly') === '2026-11-14', next('2026-10-31', 'biweekly'))

  /**
   * THE ANCHOR. (T33)
   *
   * This block is the one that matters, and the version of this test I wrote for H7 asserted the
   * BUG as the expectation. Its `expected` array read
   *
   *     30 Nov, 30 Dec, 30 Jan, 28 Feb, 28 Mar, 28 Apr, 28 May … 28 Oct
   *
   * — a schedule the business set to the 31st decaying to the 28th and staying there — and I
   * labelled it "skips no month", which is true and beside the point. Twelve green assertions over
   * a billing day walking away from the day it was set to. The clamp was right; chaining off the
   * clamped date was not.
   *
   * A short February must not change what the schedule IS.
   */
  const nextA = (from: string, freq: string, anchor: number) => ymd(calculateNextDate(new Date(`${from}T12:00:00`), freq, anchor))
  check('anchored on the 31st: 30 Nov goes to 31 DEC, not 30 Dec', nextA('2026-11-30', 'monthly', 31) === '2026-12-31', nextA('2026-11-30', 'monthly', 31))
  check('…and 28 Feb comes back to 31 Mar', nextA('2027-02-28', 'monthly', 31) === '2027-03-31', nextA('2027-02-28', 'monthly', 31))
  check('…and 30 Apr comes back to 31 May', nextA('2027-04-30', 'monthly', 31) === '2027-05-31', nextA('2027-04-30', 'monthly', 31))
  check('an anchor longer than the month still clamps', nextA('2027-01-31', 'monthly', 31) === '2027-02-28', nextA('2027-01-31', 'monthly', 31))
  check('an anchor the month can hold is used as-is', nextA('2026-10-15', 'monthly', 15) === '2026-11-15', nextA('2026-10-15', 'monthly', 15))
  check('a week-based schedule ignores the anchor entirely', nextA('2026-10-31', 'weekly', 31) === '2026-11-07', nextA('2026-10-31', 'weekly', 31))
  check('quarterly honours the anchor too: 30 Nov → 28 Feb → 31 Aug', nextA('2027-02-28', 'quarterly', 31) === '2027-05-31', nextA('2027-02-28', 'quarterly', 31))

  // A year of runs for a schedule set to the 31st: every entry is the 31st, or the last day of a
  // month that has no 31st — and it always comes BACK.
  let anchored = new Date('2026-10-31T12:00:00')
  const anchoredMonths: string[] = []
  for (let i = 0; i < 12; i++) { anchored = calculateNextDate(anchored, 'monthly', 31); anchoredMonths.push(ymd(anchored)) }
  const anchoredExpected = ['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30',
    '2027-05-31', '2027-06-30', '2027-07-31', '2027-08-31', '2027-09-30', '2027-10-31']
  check('a year on the 31st keeps the day the business chose', JSON.stringify(anchoredMonths) === JSON.stringify(anchoredExpected), anchoredMonths)
  check('…and ends where it began, on the 31st', anchoredMonths[11] === '2027-10-31', anchoredMonths[11])
  check('…never drifting below the 28th', anchoredMonths.every((m) => Number(m.slice(8)) >= 28), anchoredMonths)

  // Without an anchor the old decay is still what the maths gives — kept so the difference the
  // anchor makes is visible, and so nobody "fixes" the no-anchor path by accident.
  let drifting = new Date('2026-10-31T12:00:00')
  const drift: string[] = []
  for (let i = 0; i < 4; i++) { drifting = calculateNextDate(drifting, 'monthly'); drift.push(ymd(drifting)) }
  check('with NO anchor the day still decays — which is why the service passes one',
    JSON.stringify(drift) === JSON.stringify(['2026-11-30', '2026-12-30', '2027-01-30', '2027-02-28']), drift)
}

// ══════════ 500-2 · generate answers 201 with the invoice, and bills ONCE ══════════════════════
{
  const [co] = await db.insert(company).values({
    name: 'Recur Co', slug: 'recur-co', email: 'recur@test.local', state: 'OH', settings: {},
    enabledFeatures: ['recurring_jobs', 'invoices'],
  } as any).returning()
  const [owner] = await db.insert(user).values({
    email: 'owner-recur@test.local', passwordHash: 'x', firstName: 'O', lastName: 'W', role: 'owner', companyId: co.id,
  } as any).returning()
  const [client] = await db.insert(contact).values({
    companyId: co.id, name: 'Rivera', type: 'client', email: 'rivera@test.local',
  } as any).returning()

  const app = new Hono()
  app.route('/api/recurring', (await import('./src/routes/recurring.ts')).default)
  app.onError((await import('./src/utils/errors.ts')).errorHandler)
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
    return { status: res.status, json: j, text: t }
  }

  const made = await api('POST', '/api/recurring', {
    contactId: client.id, frequency: 'monthly', startDate: '2026-10-31',
    // `lineItems`, which is what the route validates on — my first attempt sent `items` and got the
    // route's own 400 back, correctly.
    lineItems: [{ description: 'Monthly service', quantity: 1, rate: 150 }],
    taxRate: 5.5,
  })
  check('a recurring invoice can be created', made.status === 201 || made.status === 200, { status: made.status, body: made.text?.slice(0, 200) })
  const id = made.json?.id
  if (id) {
    const gen = await api('POST', `/api/recurring/${id}/generate`)
    check('generate answers 201, not 500 — it used to error on a charge that had happened', gen.status === 201, { status: gen.status, body: gen.text?.slice(0, 220) })
    check('…and hands back the invoice it created', !!gen.json?.id && !!gen.json?.number, gen.json)

    // The whole point: one call, one invoice. A 500 made the tester retry and bill twice.
    const { sql } = await import('drizzle-orm')
    const count = async () => Number((((await db.execute(sql`SELECT COUNT(*)::int AS n FROM invoice WHERE company_id = ${co.id}`)) as any).rows || [])[0]?.n || 0)
    check('…exactly one invoice exists after one generate', (await count()) === 1, await count())

    const again = await api('POST', `/api/recurring/${id}/generate`)
    check('a SECOND deliberate generate is a second invoice (that is the feature, not the bug)', again.status === 201, again.status)
    check('…so two deliberate calls make two invoices, and one call made one', (await count()) === 2, await count())
  }
}

// ══════════ T33 · the anchor through the ROUTE, and the day on the invoice ═══════════════════════
//
// The arithmetic block above proves the function. This proves the SERVICE passes the anchor, which
// is the half that was actually broken — `calculateNextDate(recurring.next_run_date, frequency)`
// chained off the clamped date and never saw the 31st again.
//
// The company is on America/Chicago on purpose. With a UTC company the date assertion below is
// trivially true and proves nothing; the tester's report was "this evening's invoices show 2 Oct",
// which only happens when the company's day and the server's UTC day disagree.
{
  const { sql } = await import('drizzle-orm')
  const TZ = 'America/Chicago'
  const [co] = await db.insert(company).values({
    name: 'Anchor Co', slug: 'anchor-co', email: 'anchor@test.local', state: 'IL',
    settings: { timezone: TZ },
    enabledFeatures: ['recurring_jobs', 'invoices'],
  } as any).returning()
  const [owner] = await db.insert(user).values({
    email: 'owner-anchor@test.local', passwordHash: 'x', firstName: 'A', lastName: 'N', role: 'owner', companyId: co.id,
  } as any).returning()
  const [client] = await db.insert(contact).values({
    companyId: co.id, name: 'Halloran', type: 'client', email: 'halloran@test.local',
  } as any).returning()

  const app = new Hono()
  app.route('/api/recurring', (await import('./src/routes/recurring.ts')).default)
  app.onError((await import('./src/utils/errors.ts')).errorHandler)
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
    return { status: res.status, json: j, text: t }
  }
  const dayOf = (v: unknown) => String(v).slice(0, 10)
  const runDate = async (id: string) => dayOf((((await db.execute(sql`SELECT next_run_date FROM recurring_invoice WHERE id = ${id}`)) as any).rows || [])[0]?.next_run_date)

  const made = await api('POST', '/api/recurring', {
    contactId: client.id, frequency: 'monthly', startDate: '2026-10-31',
    lineItems: [{ description: 'Monthly service', quantity: 1, unitPrice: 200 }],
  })
  check('T33 a schedule can start on the 31st', made.status === 201 || made.status === 200, { status: made.status, body: made.text?.slice(0, 200) })
  const id = made.json?.id
  if (id) {
    check('T33 its first run is the 31st it was set to', (await runDate(id)) === '2026-10-31', await runDate(id))

    await api('POST', `/api/recurring/${id}/generate`)
    check('T33 after one run the next date is 30 Nov — November has no 31st', (await runDate(id)) === '2026-11-30', await runDate(id))

    // THE BUG. Chained off 30 Nov with no anchor this was 30 Dec, and the schedule never saw the
    // 31st again for the rest of its life.
    await api('POST', `/api/recurring/${id}/generate`)
    check('T33 THE NEXT IS 31 DEC, NOT 30 DEC — the day the business chose comes back', (await runDate(id)) === '2026-12-31', await runDate(id))

    await api('POST', `/api/recurring/${id}/generate`)
    check('T33 …and then 31 Jan', (await runDate(id)) === '2027-01-31', await runDate(id))

    /**
     * The invoice carries the COMPANY'S day, not the server's UTC instant.
     *
     * Asserted as "midnight in the company's zone" rather than "equals today", because that is true
     * whenever the code is right and false whenever it is wrong, at every hour of the day. A test
     * that only fails between 00:00 and 06:00 UTC is a test that reads as flaky and hides a real
     * defect. (feedback: test-that-fails-only-overnight)
     */
    const inv = (((await db.execute(sql`SELECT issue_date, due_date FROM invoice WHERE company_id = ${co.id} ORDER BY created_at ASC LIMIT 1`)) as any).rows || [])[0]
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(String(inv?.issue_date).replace(' ', 'T') + (String(inv?.issue_date).endsWith('Z') ? '' : 'Z')))
    const g = (t: string) => parts.find((p) => p.type === t)?.value
    check('T33 the invoice is dated midnight IN THE COMPANY\'S ZONE, not a UTC instant',
      g('hour') === '00' && g('minute') === '00', { issue_date: inv?.issue_date, inCompanyZone: `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}` })
    check('T33 …and on the company\'s calendar day', `${g('year')}-${g('month')}-${g('day')}` === new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
      { onInvoice: `${g('year')}-${g('month')}-${g('day')}`, companyToday: new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) })
    check('T33 the due date is counted from the invoice\'s own day', !!inv?.due_date && dayOf(inv.due_date) >= dayOf(inv.issue_date), { issue: inv?.issue_date, due: inv?.due_date })
  }
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
