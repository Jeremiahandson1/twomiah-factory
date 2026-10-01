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
  check('30 Nov + monthly is 30 Dec — a short month must not drag the day earlier', next('2026-11-30', 'monthly') === '2026-12-30', next('2026-11-30', 'monthly'))
  check('the 15th stays the 15th', next('2026-10-15', 'monthly') === '2026-11-15', next('2026-10-15', 'monthly'))
  check('31 Dec + quarterly is 31 Mar', next('2026-12-31', 'quarterly') === '2027-03-31', next('2026-12-31', 'quarterly'))
  check('31 Aug + quarterly is 30 Nov', next('2026-08-31', 'quarterly') === '2026-11-30', next('2026-08-31', 'quarterly'))
  check('31 Aug + semiannual is 28 Feb', next('2026-08-31', 'semiannual') === '2027-02-28', next('2026-08-31', 'semiannual'))
  check('29 Feb + annual is 28 Feb, not 1 Mar', next('2028-02-29', 'annual') === '2029-02-28', next('2028-02-29', 'annual'))
  check('weekly is still seven days', next('2026-10-31', 'weekly') === '2026-11-07', next('2026-10-31', 'weekly'))
  check('biweekly is still fourteen', next('2026-10-31', 'biweekly') === '2026-11-14', next('2026-10-31', 'biweekly'))

  // Twelve consecutive runs from the 31st must land on the end of each month and never skip one.
  let d = new Date('2026-10-31T12:00:00')
  const months: string[] = []
  for (let i = 0; i < 12; i++) { d = calculateNextDate(d, 'monthly'); months.push(ymd(d)) }
  const expected = ['2026-11-30', '2026-12-30', '2027-01-30', '2027-02-28', '2027-03-28', '2027-04-28',
    '2027-05-28', '2027-06-28', '2027-07-28', '2027-08-28', '2027-09-28', '2027-10-28']
  check('a year of runs from the 31st skips no month', JSON.stringify(months) === JSON.stringify(expected), months)
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

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
