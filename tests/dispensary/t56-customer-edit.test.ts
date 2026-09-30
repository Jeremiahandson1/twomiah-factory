// crm-dispensary — T56 R1 (High, a regression I shipped), the L11 remnants, S1, S2 and the S4 nit.
//
// R1. "Nobody can edit a customer on screen, in any role." Reproduced on the deployed tenant in a
// headless browser, and it was three faults wearing one coat:
//
//   · the customer's own page links Edit to /crm/customers?edit=<id> and the Customers page never
//     read `?edit`, so Edit sent you back to the list and stopped;
//   · the row ⋮ menu was dismissed by a full-screen <div onClick> rendered INSIDE the row, so the
//     click bubbled to the row's own onClick — closing the menu OPENED the customer. Measured:
//     click ⋮, click away, URL becomes /crm/customers/<id>;
//   · and the T55 fix that was supposed to hide Delete from a budtender was a silent no-op, because
//     this template's fork of DataTable has no `show` support at all. It compiled, it shipped, it
//     did nothing, and the tester quite reasonably read the whole thing as "the menu is broken".
//
// The third one is why this file checks the TABLE and not just the page: five templates fork that
// component and four of them had the same two defects. scripts/check-row-action-show.ts (#179) is
// the rule; this is the behaviour.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, product } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}
const ROOT = (() => { const r = process.env.FACTORY_ROOT; if (!r) throw new Error('FACTORY_ROOT is not set'); return r.endsWith('/') ? r : r + '/' })()
const read = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Twomiah Leaf', slug: 'leaf-t56', email: 't56@test.local', state: 'OH',
  taxRate: '10', exciseTaxRate: '15',
  enabledFeatures: ['products', 'orders', 'contacts', 'compliance', 'tax_filing', 'marketing', 'loyalty'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-t56@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()
const [adult] = await db.insert(contact).values({ name: 'T56 Addie', type: 'client', companyId: co.id } as any).returning()
const [flower] = await db.insert(product).values({
  name: 'T56 Blue Dream', companyId: co.id, category: 'flower', price: '50', weightGrams: '3.5',
  stockQuantity: 500, taxCategory: 'cannabis', trackInventory: true,
} as any).returning()
const [tshirt] = await db.insert(product).values({
  name: 'T56 T-Shirt', companyId: co.id, category: 'apparel', price: '50',
  stockQuantity: 500, taxCategory: 'standard', trackInventory: true,
} as any).returning()

const app = new Hono()
app.route('/api/orders', (await import('./src/routes/orders.ts')).default)
app.route('/api/tax-filing', (await import('./src/routes/tax-filing.ts')).default)
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
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
const today = new Date().toISOString().slice(0, 10)
const num = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100

// ══════════ S1 · a return divides, whichever return it is ═══════════════════════════════════════
{
  // One $50 cannabis sale: 15% excise = $7.50, 10% sales = $5.00.
  const made = await api('POST', '/api/orders', { items: [{ productId: flower.id, quantity: 1 }], orderType: 'walk_in', contactId: adult.id })
  const id = (made.json?.data || made.json)?.id
  check('a sale is recorded', !!id, { status: made.status, body: made.json })
  await db.execute(sql`UPDATE orders SET status = 'completed', completed_at = NOW() WHERE id = ${id}`)

  const gen = async (filingType: string) => {
    const f = await api('POST', '/api/tax-filing/filings/generate', { filingType, periodStart: today, periodEnd: today })
    const raw = f.json?.filing_data ?? f.json?.filingData
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  }

  const sales = await gen('sales_tax')
  check('S1: a SALES return works out at the shop\'s rate — it printed 0.00%',
    num(sales?.effectiveRate) === 10, { effectiveRate: sales?.effectiveRate, taxable: sales?.taxableSales, due: sales?.salesTaxDue })
  check('S1: …and says what it should come to at that rate — there was no line at all',
    num(sales?.expectedAtRate) === 5, sales?.expectedAtRate)
  check('S1: …and that it reconciles', sales?.reconciles === true, { reconciles: sales?.reconciles, variance: sales?.collectedVariance })
  check('S1: …naming the tax it is talking about, so the screen stops saying "excise" on a sales return',
    sales?.filedTaxLabel === 'sales tax', sales?.filedTaxLabel)

  // …and the excise return still behaves exactly as it did. This is the regression half.
  const excise = await gen('excise_tax')
  check('S1: the EXCISE return still works out at 15%', num(excise?.effectiveRate) === 15,
    { effectiveRate: excise?.effectiveRate, taxable: excise?.taxableSales, due: excise?.exciseTaxDue })
  check('S1: …still reconciles', excise?.reconciles === true, excise?.collectedVariance)
  check('S1: …and still calls itself excise', excise?.filedTaxLabel === 'excise', excise?.filedTaxLabel)

  // A COMBINED return declares three taxes at three rates, so it names no single configured rate.
  const combined = await gen('combined')
  check('S1: a combined return states what the WHOLE return works out at',
    num(combined?.effectiveRate) === 25, { effectiveRate: combined?.effectiveRate, taxable: combined?.taxableSales })
  check('S1: …and does not pretend one of the three rates covers it',
    combined?.expectedAtRate === null && combined?.reconciles === null, { expected: combined?.expectedAtRate, reconciles: combined?.reconciles })
}

// ══════════ S2 · what an order records giving back ══════════════════════════════════════════════
//
// The tester's ORD-1494: charged $5.25 excise and $6.00 sales, and after an itemised refund plus a
// refund by amount it recorded $3.22 and $6.18 — more sales tax returned than it ever charged —
// against a refundedTax of $9.41 that matched neither figure.
//
// A mixed basket is what exposes it: excise is cannabis-only, so once the cannabis line has been
// returned there is no excise left, and a dollar refund taking its share of the ORIGINAL excise
// hands back money that was already handed back.
{
  const made = await api('POST', '/api/orders', {
    items: [{ productId: flower.id, quantity: 1 }, { productId: tshirt.id, quantity: 1 }],
    orderType: 'walk_in', contactId: adult.id,
  })
  const id = (made.json?.data || made.json)?.id
  const [charged] = await rows(sql`SELECT subtotal, excise_tax, sales_tax, tax_amount, total FROM orders WHERE id = ${id}`)
  check('S2: the basket charges excise on the cannabis only',
    num(charged?.excise_tax) === 7.5 && num(charged?.sales_tax) === 10 && num(charged?.tax_amount) === 17.5,
    charged)
  await db.execute(sql`UPDATE orders SET status = 'completed', completed_at = NOW() WHERE id = ${id}`)

  const items = await rows(sql`SELECT id, product_id FROM order_items WHERE order_id = ${id}`)
  const cannabisLine = items.find((i: any) => String(i.product_id) === String(flower.id))

  const first = await api('POST', `/api/orders/${id}/refund`, {
    partialItems: [{ orderItemId: cannabisLine.id, quantity: 1 }], reason: 'T56 returned the flower',
  })
  check('S2: the cannabis line is refunded', first.status === 200, { status: first.status, body: first.json })
  const [afterFirst] = await rows(sql`SELECT refunded_excise_tax, refunded_sales_tax, refunded_tax, refunded_amount FROM orders WHERE id = ${id}`)
  check('S2: …carrying its own excise, not a share of the basket\'s',
    num(afterFirst?.refunded_excise_tax) === 7.5 && num(afterFirst?.refunded_sales_tax) === 5,
    afterFirst)

  // …and now the rest, by amount. There is no excise left to give back.
  const rest = num(charged?.total) - num(afterFirst?.refunded_amount)
  const second = await api('POST', `/api/orders/${id}/refund`, { amount: rest, reason: 'T56 the rest, by amount' })
  check('S2: the remainder refunds', second.status === 200, { status: second.status, body: second.json, rest })

  const [end] = await rows(sql`SELECT excise_tax, sales_tax, tax_amount, refunded_excise_tax, refunded_sales_tax, refunded_tax FROM orders WHERE id = ${id}`)
  check('S2: the excise returned never exceeds the excise charged — it recorded MORE back than it took',
    num(end?.refunded_excise_tax) <= num(end?.excise_tax) + 0.005, end)
  check('S2: …nor the sales tax', num(end?.refunded_sales_tax) <= num(end?.sales_tax) + 0.005, end)
  check('S2: …and the two parts add up to the whole that was recorded',
    Math.abs(num(end?.refunded_excise_tax) + num(end?.refunded_sales_tax) - num(end?.refunded_tax)) < 0.011, end)
  check('S2: a fully refunded order has given back exactly what it took',
    num(end?.refunded_tax) === num(end?.tax_amount), end)
}

// ══════════ S4 · a refused attempt is described as one ═══════════════════════════════════════════
{
  const { describeLog } = await import('./src/services/audit.ts')
  const line = describeLog({
    action: 'update', entity: 'contact', entity_name: 'T56 Age18',
    metadata: { refused: 'dob_change_needs_manager', recorded: '2008-01-01', attempted: '1990-01-01' },
  })
  check('S4: the refused date-of-birth attempt no longer reads "Updated contact"', !/^Updated/.test(line), line)
  check('S4: …it says it was refused', /^Refused:/.test(line), line)
  check('S4: …what was refused, and both dates', /date of birth/i.test(line) && /2008-01-01/.test(line) && /1990-01-01/.test(line), line)

  // An ordinary edit is untouched.
  const ordinary = describeLog({ action: 'update', entity: 'contact', entity_name: 'T56 Addie' })
  check('S4: …while an edit that actually happened still reads as one', /^Updated contact "T56 Addie"/.test(ordinary), ordinary)
}

// ══════════ "Reachable by email" means reachable ════════════════════════════════════════════════
{
  await db.insert(contact).values([
    { name: 'T56 Has Email', type: 'client', email: 't56a@test.local', companyId: co.id },
    { name: 'T56 Blank Email', type: 'client', email: '', companyId: co.id },
    { name: 'T56 No Email', type: 'client', companyId: co.id },
    { name: 'T56 Unsubscribed', type: 'client', email: 't56b@test.local', companyId: co.id, customFields: { emailOptOut: 'true' } },
  ] as any)
  const { getMarketingStats } = await import('./src/services/marketing.ts')
  const stats: any = await getMarketingStats(co.id)
  check('the tile counts only people a send would actually reach',
    Number(stats.contactsWithEmail) === 1, { contactsWithEmail: stats.contactsWithEmail })
  check('…and still counts everybody under Customers', Number(stats.totalContacts) >= 5, stats.totalContacts)
}

// ══════════ R1 · the two ways in, and the table under them ══════════════════════════════════════
{
  const page = strip(read('templates/crm-dispensary/frontend/src/pages/CustomersPage.tsx'))
  check('R1: the Customers page reads ?edit', /useSearchParams/.test(page) && /searchParams\.get\('edit'\)/.test(page), null)
  check('R1: …fetches that customer by id rather than hoping they are on the page in view',
    /api\.get\(`\/api\/contacts\/\$\{editId\}`\)/.test(page), null)
  check('R1: …opens the form with them', /if \(row\?\.id\) openEditModal\(row\)/.test(page), null)
  check('R1: …and takes the id out of the URL, so a refresh does not reopen it',
    /next\.delete\('edit'\)/.test(page), null)

  const detail = strip(read('templates/crm-dispensary/frontend/src/components/detail/ContactDetailPage.tsx'))
  check('R1: the customer\'s own page still links to it', /to=\{`\/crm\/customers\?edit=\$\{id\}`\}/.test(detail), null)
  check('L11: …and its Delete is gated on the permission the server enforces',
    /can\('contacts:delete'\) && \(/.test(detail), null)
  check('L11: …as is Adjust Loyalty Points', /can\('loyalty:adjust'\) && \(/.test(detail), null)

  check('L11: the row Delete asks the PERMISSION, not the rank',
    /label: 'Delete'[\s\S]{0,200}show: \(\) => can\('contacts:delete'\)/.test(page) && !/const \{ isManager \} = useAuth\(\)/.test(page), null)
}
{
  // The table itself — this is the half that made the L11 fix a no-op and the menu a trap.
  const files = [
    'templates/crm-dispensary/frontend/src/components/ui/DataTable.tsx',
    'templates/crm/frontend/src/components/ui/DataTable.tsx',
    'templates/crm-rv/frontend/src/components/ui/DataTable.tsx',
    'templates/crm-salon/frontend/src/components/ui/DataTable.tsx',
    'templates/crm-vet/frontend/src/components/ui/DataTable.tsx',
  ]
  for (const f of files) {
    const src = strip(read(f))
    const name = f.split('templates/')[1].split('/frontend')[0]
    check(`R1: ${name}'s table filters row actions on show`,
      /\.filter\(\((?:a|action)\) => !(?:a|action)\.show \|\| (?:a|action)\.show\(row\)\)|visibleActions\(row\)/.test(src), null)
    check(`R1: …and does not close its menu with a backdrop that opens the row`,
      !/fixed inset-0[^>]*onClick=\{\(\) => setOpenMenu\(null\)\}/.test(src), null)
    check(`R1: …closing on a document listener instead`,
      /document\.addEventListener\('mousedown'/.test(src), null)
    check(`R1: …and on Escape, which never worked`, /e\.key === 'Escape'/.test(src), null)
  }
}
{
  // The two dead links the R1 sweep turned up — a link carrying state nothing reads.
  const qr = strip(read('templates/crm-dispensary/frontend/src/pages/QRScannerPage.tsx'))
  check('R1: the QR scanner\'s "Log Application" goes to a route that exists',
    /navigate\('\/crm\/grow-inputs\?tab=applications'\)/.test(qr) && !/window\.location\.href = '\/grow-inputs/.test(qr), null)
  const grow = strip(read('templates/crm-dispensary/frontend/src/pages/GrowInputsPage.tsx'))
  check('R1: …and Grow Inputs opens the tab that link asks for', /searchParams\.get\('tab'\)/.test(grow), null)
}
{
  // L11: the Plaid form, not just its Save button.
  const pbb = strip(read('templates/crm-dispensary/frontend/src/pages/PayByBankPage.tsx'))
  check('L11: a budtender is not offered the Plaid Setup tab at all',
    /\.\.\.\(canSetup \? \[\{ id: 'setup'/.test(pbb), null)
  check('L11: …nor the form behind it', /tab === 'setup' && canSetup/.test(pbb), null)
  check('L11: …and the page does not ask for a config it may not have — that was the console error',
    /if \(canSetup\) loadConfig\(\)/.test(pbb), null)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
