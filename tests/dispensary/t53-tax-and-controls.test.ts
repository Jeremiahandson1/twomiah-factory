// crm-dispensary — T53 N9 (the Tax Filing screen hid returns), N4 (the $5.68 gap) and L11
// (budtenders saw controls they could not use).
//
// N4 is the one I got wrong the first time and should be plain about: the earlier pass REPORTED the
// variance — breakdownTotal, breakdownVariance, reconciles, a note explaining it — and I called the
// finding closed. It was not. An owner filing a return should not be handed three numbers and an
// explanation of why they do not add up. The lines now sum to the total by construction.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product, contact } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}
const ROOT = (() => {
  const r = process.env.FACTORY_ROOT
  if (!r) throw new Error('FACTORY_ROOT is not set — run this through tests/dispensary/harness/run.ts')
  return r.endsWith('/') ? r : r + '/'
})()

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'N4 Leaf', slug: 'leaf-n4', email: 'n4@test.local', state: 'OH',
  enabledFeatures: ['contacts', 'products', 'orders', 'tax_filing', 'compliance'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-n4@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()

const app = new Hono()
app.route('/api/tax-filing', (await import('./src/routes/tax-filing.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
const round2 = (n: number) => Math.round(n * 100) / 100

// ══════════ N4 · the exact shape that produced $5.68 ════════════════════════════════════════════
//
// An order whose refund returned MORE sales tax than the sale charged. Each column's own
// GREATEST(0, …) clamp then floored sales at zero while total_tax kept the whole deduction, and the
// parts came out bigger than the whole.
{
  const mk = async (n: number, excise: string, sales: string, total: string, rExcise: string, rSales: string, rTotal: string) => {
    await rows(sql`
      INSERT INTO orders (id, order_number, number, type, status, source, subtotal, excise_tax, sales_tax, total_tax,
                          refunded_excise_tax, refunded_sales_tax, refunded_tax, total, company_id, completed_at, created_at, updated_at)
      VALUES (gen_random_uuid(), ${n}, ${'ORD-N4-' + n}, 'walk_in', 'partially_refunded', 'pos', '100',
              ${excise}, ${sales}, ${total}, ${rExcise}, ${rSales}, ${rTotal}, '100', ${co.id}, NOW(), NOW(), NOW())
    `)
  }
  // Ordinary sale: 15.00 excise + 8.75 sales = 23.75 total, nothing refunded.
  await mk(9001, '15.00', '8.75', '23.75', '0', '0', '0')
  // The poisoned one: the refund returned 12.00 of sales tax against 8.75 charged.
  await mk(9002, '15.00', '8.75', '23.75', '0', '12.00', '12.00')

  const s = await api('GET', '/api/tax-filing/summary')
  check('the summary answers', s.status === 200, { status: s.status, body: s.json })

  // The three lines live in `breakdown`, which is what the screen renders — reading a convenience
  // field instead would test something the owner never sees.
  const j = s.json || {}
  const lineFor = (t: string) => Number((j.breakdown || []).find((b: any) => b.id === t)?.collected) || 0
  const excise = lineFor('excise_tax')
  const sales = lineFor('sales_tax')
  const local = lineFor('local_tax')
  const total = Number(j.totalCollected) || 0
  check('the screen has all three lines to render', (j.breakdown || []).length === 3, j.breakdown)

  check('the three lines ADD UP to the total — they were $5.68 out on every run since T51',
    round2(excise + sales + local) === round2(total), { excise, sales, local, sum: round2(excise + sales + local), total })
  check('…and the summary says so itself', j.reconciles === true, { reconciles: j.reconciles, variance: j.breakdownVariance })
  check('…with no variance', Math.abs(Number(j.breakdownVariance) || 0) < 0.005, j.breakdownVariance)
  check('…and no note explaining a gap, because there is none', !j.breakdownNote, j.breakdownNote)

  // …and none of them went negative or exceeded the total, which is what the clamps were protecting.
  check('no component is negative', excise >= 0 && sales >= 0 && local >= 0, { excise, sales, local })
  check('…and none exceeds the total', excise <= total && sales <= total && local <= total, { excise, sales, local, total })

  // The total is still the money: 23.75 kept in full, plus 23.75 − 12.00 on the refunded one.
  check('the total is still what the till actually kept', round2(total) === 35.50, { total })
}

// ══════════ N9 · the Tax Filing list ════════════════════════════════════════════════════════════
{
  // Three filings, created oldest-period-last so period ordering and creation ordering disagree —
  // which is exactly the shape that hid the tester's just-generated return on page 2.
  const mkFiling = async (num: number, periodEnd: string, createdAt: string) => {
    await rows(sql`
      INSERT INTO tax_filings (id, filing_type, period, period_start, period_end, status,
                               total_tax_due, company_id, created_at, updated_at)
      VALUES (gen_random_uuid(), 'excise_tax', 'daily', ${periodEnd}, ${periodEnd}, 'calculated',
              ${String(num)}, ${co.id}, ${createdAt}, ${createdAt})
    `)
  }
  await mkFiling(1, '2026-09-29', '2026-09-29T19:52:00Z')
  await mkFiling(2, '2026-09-28', '2026-09-30T08:00:00Z')  // newest, but the OLDEST period
  await mkFiling(3, '2026-09-30', '2026-09-29T04:17:00Z')

  const list = await api('GET', '/api/tax-filing/filings')
  check('the filings list answers', list.status === 200, { status: list.status })
  const data = (list.json?.data || []) as any[]
  check('…and is newest-FIRST by when it was generated — the one you just made is row 1',
    String(data[0]?.total_tax_due ?? data[0]?.totalAmount) === '2',
    data.map((f: any) => ({ due: f.total_tax_due ?? f.totalAmount, created: f.created_at })))

  check('…and reports how many pages there are', Number(list.json?.pagination?.pages) >= 1, list.json?.pagination)
  check('…and the total, so a screen can say "25 of 34"', Number(list.json?.pagination?.total) === 3, list.json?.pagination)

  // Page 2 is reachable, and a silly page number cannot 500 the screen.
  const p2 = await api('GET', '/api/tax-filing/filings?page=2&limit=2')
  check('page 2 returns the remainder', p2.status === 200 && (p2.json?.data || []).length === 1,
    { status: p2.status, n: (p2.json?.data || []).length })
  // A negative page is a negative SQL OFFSET and a 500 if nothing stops it. Two things do, and
  // either is a correct answer:
  //   · live, a global pagination middleware refuses it with 400 invalid_pagination — better,
  //     because it tells the caller rather than silently answering a different question;
  //   · here, that middleware is not mounted (the harness mounts routes directly), so the route's
  //     own clamp is what holds. Both are asserted, because the route ships to callers that do not
  //     come through the middleware.
  const bad = await api('GET', '/api/tax-filing/filings?page=-1&limit=99999')
  check('a negative page never reaches the database as a negative OFFSET',
    bad.status === 200 || bad.status === 400, { status: bad.status, body: bad.json })
  if (bad.status === 200) {
    check('…the route clamps it', (bad.json?.data || []).length <= 200, (bad.json?.data || []).length)
  } else {
    check('…and is refused by name rather than silently', /invalid_pagination/.test(JSON.stringify(bad.json)), bad.json)
  }
}

// ══════════ N9 · and the SCREEN can actually reach page 2 ═══════════════════════════════════════
//
// The API paging above was already correct in T53 — "GET /filings returns page 1 of 2" — and the
// finding was that the screen showed those 25 with no next-page control. So the assertion that
// matters is on the page, not the endpoint.
{
  const page = readFileSync(`${ROOT}templates/crm-dispensary/frontend/src/pages/TaxFilingPage.tsx`, 'utf8').replace(/\r\n/g, '\n')
  check('the screen asks for a specific page', /api\.get\('\/api\/tax-filing\/filings', \{ page: filingsPage/.test(page), null)
  check('…keeps the page count it was given', /setFilingsPages\(/.test(page), null)
  check('…reloads when the page changes', /\}, \[tab, filingsPage\]\)/.test(page), null)
  check('…and renders Previous / Next controls', /Previous/.test(page) && /Next/.test(page), null)
  check('…telling the owner how many there are in total', /of \{filingsTotal\} filings/.test(page), null)
}

// ══════════ L11 · controls a budtender cannot use are not shown ═════════════════════════════════
//
// Every one of these is a manager+ action the server already refuses. The tester pressed none of
// them, sensibly; the point is that offering them is an invitation to a 403.
{
  const CONTROLS: Array<[string, string]> = [
    ['BatchesPage.tsx', 'New Batch'],
    ['MerchStorePage.tsx', 'Add Product'],
    ['LabelsPage.tsx', 'New Template'],
    ['TrackingPage.tsx', 'Create Route'],
    ['CultivationPage.tsx', 'Add Plant'],
    ['ManufacturingPage.tsx', 'Create Job'],
    ['AIBudtenderPage.tsx', 'Save Configuration'],
    ['PayByBankPage.tsx', 'Save Configuration'],
    ['GamifiedLoyaltyPage.tsx', 'Create Challenge'],
    ['SEOPagesPage.tsx', 'Generate All'],
    ['SignagePage.tsx', 'Add Screen'],
    ['GrowInputsPage.tsx', 'Add Input'],
  ]
  for (const [file, label] of CONTROLS) {
    const raw = readFileSync(`${ROOT}templates/crm-dispensary/frontend/src/pages/${file}`, 'utf8').replace(/\r\n/g, '\n')
    // Comments stripped FIRST. The comment I wrote above Manufacturing's gate contains the words
    // "Create Job", so searching the raw file finds my own prose before the button and reports the
    // control ungated. Guard #172 was defeated by exactly this earlier today; a check that can be
    // satisfied — or broken — by a comment is not checking the code.
    const src = raw.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    check(`${file}: the page knows who is signed in`, /const \{ isManager \}/.test(src), null)
    // The control has to sit INSIDE a manager gate — not merely somewhere in a file that also
    // mentions isManager, which is the mistake a "does the file say isManager" check would make.
    const at = src.indexOf(label)
    // Generous window: some of these buttons carry a long inline onClick between the gate and the
    // label (Manufacturing's resets seven form fields), and the gate is still the nearest thing
    // above them.
    const before = at === -1 ? '' : src.slice(Math.max(0, at - 1400), at)
    check(`${file}: "${label}" is behind a manager gate`,
      at !== -1 && /isManager \&\& \(|isManager \? \(/.test(before), { found: at !== -1 })
  }
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
