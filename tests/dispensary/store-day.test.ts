// crm-dispensary — a calendar day means the STORE's day, everywhere.
//
// Not a reported finding. Found while running the suites: three files
// (t46-mediums-2, t46-mediums-4, t47-lows) went red for the four hours each night when UTC has
// rolled over and New York has not, and chasing that turned up a whole family of routes cutting a
// day in UTC. `created_at`, `completed_at` and `clock_in` are naive UTC timestamps, so:
//
//     AND o.created_at >= ${startDate}::date                      -- UTC midnight
//     AND o.created_at <  (${endDate}::date + INTERVAL '1 day')   -- UTC midnight
//     AND DATE(o.created_at) = ${reportDate}::date                -- UTC day, and unindexable
//     AND DATE(created_at) = CURRENT_DATE                         -- UTC today
//     new Date('2026-09-30')                                      -- UTC midnight
//
// all cut the day four hours early for an Ohio shop. That is 8pm–midnight filed under tomorrow,
// every day; two hours for Central, three Mountain, four Pacific. On a tax return it declares money
// in the wrong period, in both directions at once. T24 N1 fixed the dashboard, the analytics series
// and cash reconciliation, and the correct implementation then sat PRIVATE inside routes/analytics.ts
// while twelve other files kept building the bound by hand.
//
// EVERY ASSERTION HERE IS PINNED TO A FIXED INSTANT, never to `now`. 2026-09-29T01:30:00Z is
// 21:30 on the 28th in New York, so the two clocks disagree about which day owns it — and the test
// says so identically at 3am and at 3pm. A test that only fails overnight is worse than no test:
// it teaches everyone to ignore a red build.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product, contact } from './db/schema.ts'
import { storeDayRange, storeRange, storeDateString, storeToday, storeTimeZone, zoneFor } from './src/utils/isoTime.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 340)) }
}

await setupSchema()

// Ohio: UTC-4 in September, so the store's day ends at 04:00Z.
const [co] = await db.insert(company).values({
  name: 'Store Day Leaf', slug: 'leaf-sd', email: 'sd@test.local', state: 'OH',
  taxRate: '8.0', exciseTaxRate: '15.0',
  enabledFeatures: ['products', 'orders', 'compliance', 'tax_filing', 'contacts', 'scheduling', 'staff_scheduling'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-sd@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const bud = await mkUser('budtender', 'bud')

const [kush] = await db.insert(product).values({
  name: 'OG Kush', companyId: co.id, category: 'flower', price: '100', stockQuantity: 500,
  weightGrams: '3.5', taxCategory: 'cannabis', trackInventory: true,
} as any).returning()
const ada = (await db.insert(contact).values({
  type: 'customer', name: 'Ada Customer', companyId: co.id, dateOfBirth: '1985-04-02',
} as any).returning())[0]

const app = new Hono()
app.route('/api/orders', (await import('./src/routes/orders.ts')).default)
app.route('/api/tax-filing', (await import('./src/routes/tax-filing.ts')).default)
app.route('/api/scheduling', (await import('./src/routes/scheduling.ts')).default)
app.route('/api/id-scanner', (await import('./src/routes/id-scanner.ts')).default)
app.route('/api/recommendations', (await import('./src/routes/recommendations.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const asOwner = as(owner)
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }

// The instant the whole file turns on: late evening on the 28th in Ohio, already the 29th in UTC.
const EVENING_28 = '2026-09-29T01:30:00.000Z'
const NY = 'America/New_York'

// ══════════ 1 · the helpers agree on which day owns that instant ════════════════════════════════
{
  check('the store zone comes from the state when no timezone is configured', storeTimeZone(co) === NY, storeTimeZone(co))
  check('…and zoneFor answers the same from the company id', (await zoneFor(co.id)) === NY, await zoneFor(co.id))

  const at = new Date(EVENING_28)
  check('21:30 on the 28th in Ohio is the 28th on the store clock', storeDateString(at, NY) === '2026-09-28', storeDateString(at, NY))
  check('…and the 29th in UTC — which is the whole bug', at.toISOString().slice(0, 10) === '2026-09-29', at.toISOString())

  const d28 = storeDayRange(NY, '2026-09-28')
  check('the store\'s 28th starts at 04:00Z on the 28th', d28.start.toISOString() === '2026-09-28T04:00:00.000Z', d28.start.toISOString())
  check('…and ends at 04:00Z on the 29th', d28.end.toISOString() === '2026-09-29T04:00:00.000Z', d28.end.toISOString())
  check('…so it contains that evening', at >= d28.start && at < d28.end, { at: EVENING_28, ...d28 })

  const d29 = storeDayRange(NY, '2026-09-29')
  check('the store\'s 29th does NOT contain it', !(at >= d29.start && at < d29.end), { at: EVENING_28, ...d29 })
  check('the two days meet exactly, with no gap and no overlap', d28.end.getTime() === d29.start.getTime(), { a: d28.end, b: d29.start })

  const r = storeRange(NY, '2026-09-28', '2026-09-29')
  check('a from..to range covers both days inclusive', r.start.toISOString() === '2026-09-28T04:00:00.000Z' && r.end.toISOString() === '2026-09-30T04:00:00.000Z', r)
  check('…and is half-open, so the last millisecond of the last day is inside it',
    new Date('2026-09-30T03:59:59.999Z') < r.end, r.end.toISOString())
  check('storeToday is the store\'s date, not the server\'s', storeToday(NY) === storeDateString(new Date(), NY), storeToday(NY))

  // A DST boundary, because the offset is not a constant. 8 March 2026 is the spring-forward day.
  const dst = storeDayRange(NY, '2026-03-08')
  check('a spring-forward day still starts at its own local midnight', dst.start.toISOString() === '2026-03-08T05:00:00.000Z', dst.start.toISOString())
  check('…and is 23 hours long, not 24', (dst.end.getTime() - dst.start.getTime()) / 3600000 === 23, (dst.end.getTime() - dst.start.getTime()) / 3600000)
}

// ══════════ 1b · the clock the tests use and the clock the server uses agree at EVERY hour ══════
//
// This is the property that was actually broken, and it is why three suites went red for four hours
// every night rather than failing honestly. A test that computes "today" one way while the server
// computes it another passes for twenty hours a day, and the four hours it fails look like
// flakiness — so everyone learns to ignore a red build.
//
// Sampled across a full 24 hours rather than asserted at "now", which would prove nothing about the
// window it breaks in.
{
  const asTheSuitesDoIt = (at: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: NY }).format(at)
  let agree = 0
  const disagreements: string[] = []
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30, 59]) {
      const at = new Date(Date.UTC(2026, 8, 29, h, m, 0))
      if (asTheSuitesDoIt(at) === storeDateString(at, NY)) agree++
      else disagreements.push(`${at.toISOString()}: suite=${asTheSuitesDoIt(at)} server=${storeDateString(at, NY)}`)
    }
  }
  check(`the suite's clock and the server's agree at all ${agree} sampled instants`, disagreements.length === 0, disagreements.slice(0, 3))

  // …and both differ from the UTC date during exactly the hours that used to break: 00:00–03:59Z.
  const utcDiffers = Array.from({ length: 24 }, (_, h) => new Date(Date.UTC(2026, 8, 29, h, 0, 0)))
    .filter((at) => at.toISOString().slice(0, 10) !== storeDateString(at, NY))
    .map((at) => at.getUTCHours())
  check('the UTC date is wrong for this shop for exactly four hours a day', utcDiffers.length === 4, utcDiffers)
  check('…and they are 00:00Z to 03:59Z — the window those suites went red in',
    utcDiffers.join(',') === '0,1,2,3', utcDiffers)
}

// ══════════ 2 · a sale after 8pm is taxed in the day it was rung up ═════════════════════════════
{
  const created = await asOwner('POST', '/api/orders', {
    type: 'walk_in', contactId: ada.id, idVerified: true, paymentMethod: 'cash',
    items: [{ productId: kush.id, quantity: 1 }],
  })
  check('an evening sale is created', created.status === 201, { status: created.status, body: created.json })
  const done = await asOwner('POST', `/api/orders/${created.json?.id}/complete`, { paymentMethod: 'cash' })
  check('…and completed', done.status === 200, { status: done.status, body: done.json })

  // Move it to that evening. This is the only way to test a boundary deterministically.
  await db.execute(sql`UPDATE orders SET completed_at = ${EVENING_28}::timestamp, created_at = ${EVENING_28}::timestamp WHERE id = ${created.json?.id}`)
  const [chk] = await rows(sql`SELECT completed_at, excise_tax FROM orders WHERE id = ${created.json?.id}`)
  check('the sale now sits at 21:30 on the 28th, Ohio time', !!chk, chk?.completed_at)

  // The return is built from FOUR separate queries, each with its own pair of period bounds: the
  // revenue/tax totals, the category breakdown, the taxable-base apportionment and the per-order
  // line items. Every one carried the same UTC cut, so every one is asserted — a fix applied to
  // three of the four would otherwise look green, which is exactly what the first mutation run here
  // showed.
  const filingFor = async (d: string) => {
    const f = await asOwner('POST', '/api/tax-filing/filings/generate', { filingType: 'excise_tax', periodStart: d, periodEnd: d })
    const data = typeof f.json?.filing_data === 'string' ? JSON.parse(f.json.filing_data) : (f.json?.filing_data || {})
    return {
      status: f.status, body: f.json,
      base: Number(data.taxableSales ?? f.json?.total_taxable_amount ?? 0),  // query 3
      orders: Number(data.totalOrders ?? 0),                                 // query 1
      gross: Number(data.grossSales ?? 0),                                   // query 1
      collected: Number(f.json?.total_tax_collected ?? 0),                   // query 1
      categories: (data.categoryBreakdown || []) as any[],                   // query 2
      lines: (data.lineItems || []) as any[],                                // query 4
    }
  }

  const on28 = await filingFor('2026-09-28')
  check('a return for the 28th generates', on28.status === 200 || on28.status === 201, on28.body)
  check('…and COUNTS the 8:30pm sale, because that is when the shop rang it up', on28.base === 100, { taxableSales: on28.base })
  check('…in its order count and gross — the totals query', on28.orders === 1 && on28.gross === 100, { orders: on28.orders, gross: on28.gross })
  check('…and the tax that was collected on it', on28.collected > 0, { collected: on28.collected })
  check('…in the category breakdown — the second query',
    on28.categories.length === 1 && Number(on28.categories[0]?.units_sold) === 1, on28.categories)
  check('…and in the line items — the fourth query', on28.lines.length === 1, on28.lines.length)

  const on29 = await filingFor('2026-09-29')
  check('…and a return for the 29th does NOT count it again', on29.base === 0, { taxableSales: on29.base })
  check('…nor in its totals', on29.orders === 0 && on29.gross === 0, { orders: on29.orders, gross: on29.gross })
  check('…nor its category breakdown', on29.categories.length === 0, on29.categories)
  check('…nor its line items', on29.lines.length === 0, on29.lines.length)

  // The money must be declared once, in exactly one period — the property an auditor checks.
  check('the sale is declared in exactly one of the two periods',
    (on28.base === 100) !== (on29.base === 100), { on28: on28.base, on29: on29.base })
}

// ══════════ 3 · an evening shift is paid in the day it was worked ═══════════════════════════════
{
  // Clocked in 21:30 on the 28th, out at 23:30 — two hours, all on the 28th in Ohio.
  await db.execute(sql`
    INSERT INTO time_entries (id, company_id, user_id, clock_in, clock_out, total_minutes, created_at)
    VALUES (${'sd-te-evening'}, ${co.id}, ${bud.id}, ${EVENING_28}::timestamp,
            ${'2026-09-29T03:30:00.000Z'}::timestamp, 120, NOW())
  `)
  // …and a morning shift on the 29th, so "the right day" has something to be wrong about.
  await db.execute(sql`
    INSERT INTO time_entries (id, company_id, user_id, clock_in, clock_out, total_minutes, created_at)
    VALUES (${'sd-te-morning'}, ${co.id}, ${bud.id}, ${'2026-09-29T14:00:00.000Z'}::timestamp,
            ${'2026-09-29T18:00:00.000Z'}::timestamp, 240, NOW())
  `)

  const forDay = async (d: string) => {
    const r = await asOwner('GET', `/api/scheduling/time-entries?startDate=${d}&endDate=${d}&limit=50`)
    return { status: r.status, ids: ((r.json?.data || []) as any[]).map((x) => x.id), body: r.json }
  }

  const t28 = await forDay('2026-09-28')
  check('the time-entry list answers', t28.status === 200, t28.body)
  check('the evening shift is paid on the 28th — the day it was worked', t28.ids.includes('sd-te-evening'), t28.ids)
  check('…and the next morning\'s shift is not on that day', !t28.ids.includes('sd-te-morning'), t28.ids)

  const t29 = await forDay('2026-09-29')
  check('the morning shift is on the 29th', t29.ids.includes('sd-te-morning'), t29.ids)
  check('…and the previous evening\'s is not counted again', !t29.ids.includes('sd-te-evening'), t29.ids)

  // The date the screen prints beside the hours has to agree with the day it was filtered into.
  const r28 = await asOwner('GET', `/api/scheduling/time-entries?startDate=2026-09-28&endDate=2026-09-28&limit=50`)
  const ev = ((r28.json?.data || []) as any[]).find((x) => x.id === 'sd-te-evening')
  check('…and the row prints the 28th as its work date, not the 29th',
    String(ev?.date).slice(0, 10) === '2026-09-28', ev?.date)

  // A week ending Friday must not drop Friday night or borrow the Sunday before.
  const week = await asOwner('GET', `/api/scheduling/time-entries?startDate=2026-09-28&endDate=2026-09-29&limit=50`)
  const ids = ((week.json?.data || []) as any[]).map((x) => x.id)
  check('a two-day range holds both shifts and nothing else',
    ids.includes('sd-te-evening') && ids.includes('sd-te-morning') && ids.length === 2, ids)
}

// ══════════ 4 · a "today" counter does not reset at 8pm ════════════════════════════════════════
//
// The compliance tiles, the curbside queue, the kiosk tiles and the ID-scan counters all read
// `DATE(created_at) = CURRENT_DATE`, which is the UTC day. For an Ohio shop that means every one of
// them went back to zero at 8pm — mid-evening, while the shop was still trading and still scanning
// IDs. A budtender looking at the screen at 8:05pm saw a shop that had checked nobody all day.
//
// Asserted on the ID-scan tiles because they are the shop's own record of a legal obligation.
{
  const scan = async (id: string, at: string, flags: { underage?: boolean; expired?: boolean; flagged?: boolean } = {}) => {
    await db.execute(sql`
      INSERT INTO id_scans (id, company_id, scan_method, is_underage, is_expired, is_flagged, created_at)
      VALUES (${id}, ${co.id}, 'barcode', ${!!flags.underage}, ${!!flags.expired}, ${!!flags.flagged}, ${at}::timestamp)
    `)
  }
  // Three scans on the store's 28th: one at lunchtime, and two in the evening AFTER UTC has rolled
  // over into the 29th. All three belong to the same trading day.
  await scan('sd-scan-noon', '2026-09-28T16:00:00.000Z')
  await scan('sd-scan-evening', EVENING_28, { underage: true })
  await scan('sd-scan-late', '2026-09-29T03:45:00.000Z', { flagged: true })
  // …and one the next morning, which must NOT be counted with them.
  await scan('sd-scan-tomorrow', '2026-09-29T14:00:00.000Z')

  const dayScans = async (d: string) => {
    const r = await asOwner('GET', `/api/id-scanner/scans?date=${d}&limit=50`)
    return { status: r.status, ids: ((r.json?.data || []) as any[]).map((x) => x.id), body: r.json }
  }
  const s28 = await dayScans('2026-09-28')
  check('the ID-scan log answers for a named day', s28.status === 200, s28.body)
  check('…and a day holds its own evening scans, including the ones after UTC midnight',
    ['sd-scan-noon', 'sd-scan-evening', 'sd-scan-late'].every((i) => s28.ids.includes(i)), s28.ids)
  check('…and not the next morning\'s', !s28.ids.includes('sd-scan-tomorrow'), s28.ids)

  const s29 = await dayScans('2026-09-29')
  check('the next day holds only its own', s29.ids.length === 1 && s29.ids.includes('sd-scan-tomorrow'), s29.ids)
}

// ══════════ 5 · the recommendations endpoint runs at all ═══════════════════════════════════════
//
// Not a day-boundary finding, but found by one: its upsert asked for
//     ON CONFLICT (contact_id, product_id) WHERE created_at::date = CURRENT_DATE
// and product_recommendations has no unique constraint on those columns and no partial index with
// that predicate — so Postgres answered "there is no unique or exclusion constraint matching the
// ON CONFLICT specification" and this threw on EVERY call it has ever received. It also set an
// `updated_at` column the table does not have. Nothing has a screen for it, which is the only
// reason nobody reported it.
{
  const r = await asOwner('GET', `/api/recommendations/for-customer/${ada.id}`)
  check('recommendations generate at all — this used to throw every time', r.status === 200, { status: r.status, body: r.json })
  check('…and return a list', Array.isArray(r.json?.recommendations), Object.keys(r.json || {}))

  // One set per customer per STORE day: asking twice must not double the rows.
  const again = await asOwner('GET', `/api/recommendations/for-customer/${ada.id}`)
  check('…asking again still answers', again.status === 200, again.status)
  const [{ n }] = await rows(sql`SELECT COUNT(*)::int AS n FROM product_recommendations WHERE company_id = ${co.id} AND contact_id = ${ada.id}`)
  check('…and does not accumulate a second set for the same day', Number(n) <= 10, { rows: Number(n) })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
