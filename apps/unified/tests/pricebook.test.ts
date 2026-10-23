// The Pricebook, end to end through the real server (owner, 2026-10-19: "pricbook neds to be tested as well i dont now
// if that is acttually ready"). packages/tenant-backend/src/pricebook/pricebook.ts at /api/pricebook, the quote form's
// use of it, and its seats, on a contractor (whose quotes are priced from it) and a roofer:
//   · off, every door refuses; on, a seat that may not see cost reads the prices and never the cost or margin —
//     the list, one item, search, options and the export;
//   · categories nest, and a category can't be made its own ancestor (the page would lose both);
//   · items: codes unique and only ever forward, a bad box named, someone else's category refused, an update that
//     can't touch the company or id, duplicate brings its Good/Better/Best, delete of a quoted item refused;
//   · Good/Better/Best: one per tier, one recommended, read back good → better → best;
//   · price changes in bulk (percent and fixed, never below zero), CSV-style import and export round trip;
//   · a quote line priced from the book records the item and its cost, and a seat without margin:read never sees it.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

type Call = (p: string, init?: any) => Promise<Response>
const PASS = 'Seat-pass-1-long'

async function tenant(vertical: string, features: string[]) {
  const t = await bootTenant({ vertical })
  const seeded = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, seeded.company.id))
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
  const seats: Record<string, Call> = {}
  const as = (token: string): Call => async (p, init = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
  seats.owner = as(await login('owner@test.example', seeded.password))
  // clerk: a reader the owner granted pricebook:read (Settings › Users) — the export's seat, without margin:read.
  for (const [key, role, extra] of [['mgr', 'manager', []], ['tech', 'field', []], ['reader', 'viewer', []], ['clerk', 'viewer', ['pricebook:read']]] as const) {
    await t.db.insert(t.schema.user).values({ email: `${key}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId: seeded.company.id, extraPermissions: [...extra] } as any)
    seats[key] = as(await login(`${key}@test.example`, PASS))
  }
  return { t, companyId: seeded.company.id, ...seats } as { t: typeof t; companyId: string } & Record<'owner' | 'mgr' | 'tech' | 'reader' | 'clerk', Call>
}

const json = async (r: Response) => { const b = await r.json(); return b as any }
const COST = ['cost', 'totalCost', 'margin']
const hasCost = (v: any): boolean => Array.isArray(v) ? v.some(hasCost) : !!v && typeof v === 'object' && Object.entries(v).some(([k, x]) => COST.includes(k) || hasCost(x))

let ctr: Awaited<ReturnType<typeof tenant>>
let roof: Awaited<ReturnType<typeof tenant>>
let off: Awaited<ReturnType<typeof tenant>>
beforeAll(async () => {
  ctr = await tenant('contractor', ['contacts', 'jobs', 'quotes', 'invoices', 'pricebook'])
  roof = await tenant('roofing', ['contacts', 'jobs', 'quotes', 'invoices', 'pricebook'])
  off = await tenant('contractor', ['contacts', 'jobs', 'quotes', 'invoices'])
}, 240_000)

describe('the switch', () => {
  test('off: every door refuses, the customer presentation included', async () => {
    for (const p of ['/api/pricebook/items', '/api/pricebook/categories', '/api/pricebook/search?q=a', '/api/pricebook/export']) {
      const r = await off.owner(p)
      expect([p, r.status]).toEqual([p, 403])
      expect((await json(r)).code).toBe('FEATURE_NOT_ENABLED')
    }
    expect((await off.owner('/api/pricebook/items', { method: 'POST', json: { name: 'X', price: 1 } })).status).toBe(403)
    expect((await off.t.call('/api/pricebook-present/anything')).status).toBe(404)
  })
  test('on, for a roofer too: the list answers', async () => {
    expect((await roof.owner('/api/pricebook/items')).status).toBe(200)
    expect((await ctr.owner('/api/pricebook/items')).status).toBe(200)
  })
})

describe('categories', () => {
  test('nest, count their items, and refuse to become their own ancestor', async () => {
    const a = await json(await ctr.owner('/api/pricebook/categories', { method: 'POST', json: { name: 'Electrical' } }))
    const b = await json(await ctr.owner('/api/pricebook/categories', { method: 'POST', json: { name: 'Panels', parentId: a.id } }))
    const c = await json(await ctr.owner('/api/pricebook/categories', { method: 'POST', json: { name: 'Breakers', parentId: b.id } }))
    const tree = await json(await ctr.owner('/api/pricebook/categories'))
    const top = tree.find((x: any) => x.id === a.id)
    expect(top.children[0].id).toBe(b.id)
    expect(top.children[0].children[0].id).toBe(c.id)
    // Its own parent, and its own grandchild's child: both refused, and the tree still shows all three.
    expect((await ctr.owner(`/api/pricebook/categories/${a.id}`, { method: 'PUT', json: { parentId: a.id } })).status).toBe(400)
    const cycle = await ctr.owner(`/api/pricebook/categories/${a.id}`, { method: 'PUT', json: { parentId: c.id } })
    expect(cycle.status).toBe(400)
    const after = await json(await ctr.owner('/api/pricebook/categories'))
    expect(after.find((x: any) => x.id === a.id)?.children?.[0]?.children?.[0]?.id).toBe(c.id)
    // Someone else's category is no parent.
    const other = await json(await roof.owner('/api/pricebook/categories', { method: 'POST', json: { name: 'Roofing' } }))
    expect((await ctr.owner('/api/pricebook/categories', { method: 'POST', json: { name: 'Sneaky', parentId: other.id } })).status).toBe(400)
  })
  test('a technician and a reader may not make one', async () => {
    expect((await ctr.tech('/api/pricebook/categories', { method: 'POST', json: { name: 'Nope' } })).status).toBe(403)
    expect((await ctr.reader('/api/pricebook/categories', { method: 'POST', json: { name: 'Nope' } })).status).toBe(403)
  })
})

describe('items', () => {
  let outlet: any
  test('made with a code, named boxes refused, and read back with a margin only where cost is known', async () => {
    const bad = await ctr.owner('/api/pricebook/items', { method: 'POST', json: { name: '', price: -5 } })
    expect(bad.status).toBe(400)
    expect((await json(bad)).error).toMatch(/name/)
    outlet = await json(await ctr.owner('/api/pricebook/items', { method: 'POST', json: { name: 'Install outlet', price: 145, cost: 45, laborHours: 1.5, customerDescription: 'A new outlet where you need it' } }))
    expect(outlet.code).toMatch(/^SVC-\d{4}$/)
    expect(Number(outlet.price)).toBe(145)
    expect(outlet.margin).toBe('69.0')
    const uncosted = await json(await ctr.owner('/api/pricebook/items', { method: 'POST', json: { name: 'Site visit', price: 89 } }))
    expect(uncosted.margin).toBeNull()
    // What the Pricebook form sends for boxes left empty (PricebookPage submit): labour hours null, category null.
    const fromForm = await ctr.owner('/api/pricebook/items', { method: 'POST', json: { name: 'Gutter guard', code: undefined, categoryId: null, description: '', customerDescription: '', price: 12, cost: 0, laborHours: null, taxable: true, showToCustomer: true } })
    expect(fromForm.status).toBe(201)
    expect((await json(fromForm)).laborHours).toBeNull()
    const edited = await ctr.owner(`/api/pricebook/items/${outlet.id}`, { method: 'PUT', json: { laborHours: null } })
    expect(edited.status).toBe(200)
  })
  test('codes never repeat, at the same moment or after a delete', async () => {
    const made = await Promise.all([1, 2, 3].map((i) => ctr.owner('/api/pricebook/items', { method: 'POST', json: { name: `Same moment ${i}`, price: 10 } }).then(json)))
    const codes = made.map((m) => m.code)
    expect(new Set(codes).size).toBe(3)
    const last = made.sort((x, y) => x.code.localeCompare(y.code))[2]
    expect((await ctr.owner(`/api/pricebook/items/${last.id}`, { method: 'DELETE' })).status).toBe(200)
    const next = await json(await ctr.owner('/api/pricebook/items', { method: 'POST', json: { name: 'After delete', price: 10 } }))
    expect(next.code > last.code).toBe(true)
  })
  test("an update can't move the item to another company or rewrite its id", async () => {
    const r = await ctr.owner(`/api/pricebook/items/${outlet.id}`, { method: 'PUT', json: { price: 150, companyId: roof.companyId, id: 'hijack' } })
    expect(r.status).toBe(200)
    const back = await json(r)
    expect(back.id).toBe(outlet.id)
    expect(back.companyId).toBe(ctr.companyId)
    expect(Number(back.price)).toBe(150)
    expect((await roof.owner(`/api/pricebook/items/${outlet.id}`)).status).toBe(404)
  })
  test('Good / Better / Best: one per tier, one recommended, read back in order, and copied with a duplicate', async () => {
    const twice = await ctr.owner(`/api/pricebook/items/${outlet.id}/options`, { method: 'PUT', json: { options: [{ tier: 'good', name: 'A', price: 100 }, { tier: 'good', name: 'B', price: 120 }] } })
    expect(twice.status).toBe(400)
    const two = await ctr.owner(`/api/pricebook/items/${outlet.id}/options`, { method: 'PUT', json: { options: [{ tier: 'good', name: 'A', price: 100, recommended: true }, { tier: 'best', name: 'C', price: 200, recommended: true }] } })
    expect(two.status).toBe(400)
    const ok = await json(await ctr.owner(`/api/pricebook/items/${outlet.id}/options`, { method: 'PUT', json: { options: [
      { tier: 'best', name: 'Smart outlet', price: 260, features: ['USB-C', 'App control'], recommended: true },
      { tier: 'good', name: 'Standard outlet', price: 145 },
      { tier: 'better', name: 'GFCI outlet', price: 190 },
    ] } }))
    expect(ok.map((o: any) => o.tier)).toEqual(['good', 'better', 'best'])
    const dup = await json(await ctr.owner(`/api/pricebook/items/${outlet.id}/duplicate`, { method: 'POST' }))
    expect(dup.name).toBe('Install outlet (Copy)')
    expect(dup.code).not.toBe(outlet.code)
    const dupOpts = await json(await ctr.owner(`/api/pricebook/items/${dup.id}/options`))
    expect(dupOpts.map((o: any) => o.name)).toEqual(['Standard outlet', 'GFCI outlet', 'Smart outlet'])
  })
  test('a seat that may not see cost reads every price and never a cost or margin — the export included', async () => {
    for (const seat of [ctr.tech, ctr.reader]) {
      const list = await json(await seat('/api/pricebook/items'))
      expect(list.data.length).toBeGreaterThan(0)
      expect(hasCost(list)).toBe(false)
      expect(hasCost(await json(await seat(`/api/pricebook/items/${outlet.id}`)))).toBe(false)
      expect(hasCost(await json(await seat('/api/pricebook/search?q=outlet')))).toBe(false)
      expect(hasCost(await json(await seat(`/api/pricebook/items/${outlet.id}/options`)))).toBe(false)
      expect((await seat('/api/pricebook/items', { method: 'POST', json: { name: 'X', price: 1 } })).status).toBe(403)
      expect((await seat(`/api/pricebook/items/${outlet.id}`, { method: 'DELETE' })).status).toBe(403)
    }
    // The manager prices the work: cost and margin are theirs.
    expect(hasCost(await json(await ctr.mgr('/api/pricebook/items')))).toBe(true)
    // The export: refused without pricebook:read; a seat granted it alone (no margin:read) gets the list without cost.
    expect((await ctr.tech('/api/pricebook/export')).status).toBe(403)
    const exp = await ctr.clerk('/api/pricebook/export')
    expect(exp.status).toBe(200)
    const rows = await json(exp)
    expect(rows.length).toBeGreaterThan(0)
    expect(hasCost(rows)).toBe(false)
    expect(hasCost(await json(await ctr.owner('/api/pricebook/export')))).toBe(true)
  })
  test('search finds by name or code, takes % and _ as letters, and leaves inactive items out', async () => {
    await ctr.owner('/api/pricebook/items', { method: 'POST', json: { name: '100% copper wire', price: 3 } })
    await ctr.owner('/api/pricebook/items', { method: 'POST', json: { name: 'Retired fixture', price: 3, active: false } })
    const pct = await json(await ctr.owner('/api/pricebook/search?q=100%25'))
    expect(pct.map((r: any) => r.name)).toEqual(['100% copper wire'])
    expect((await json(await ctr.owner('/api/pricebook/search?q=_'))).length).toBe(0)
    expect((await json(await ctr.owner('/api/pricebook/search?q=Retired'))).length).toBe(0)
    expect((await json(await ctr.owner(`/api/pricebook/search?q=${outlet.code}`))).map((r: any) => r.id)).toContain(outlet.id)
  })
})

describe('in bulk', () => {
  test('price changes by percent and by amount, never below zero, only in the chosen category', async () => {
    const cat = await json(await roof.owner('/api/pricebook/categories', { method: 'POST', json: { name: 'Gutters' } }))
    const g1 = await json(await roof.owner('/api/pricebook/items', { method: 'POST', json: { name: 'Gutter run', price: 100, cost: 40, categoryId: cat.id } }))
    const other = await json(await roof.owner('/api/pricebook/items', { method: 'POST', json: { name: 'Ridge vent', price: 100 } }))
    expect(await json(await roof.owner('/api/pricebook/bulk/adjust-prices', { method: 'POST', json: { categoryId: cat.id, adjustmentType: 'percent', adjustmentValue: 10, applyTo: 'price' } }))).toMatchObject({ preview: false, updated: 1 }) // the reply also lists each price before and after (2026-10-23)
    expect(Number((await json(await roof.owner(`/api/pricebook/items/${g1.id}`))).price)).toBe(110)
    expect(Number((await json(await roof.owner(`/api/pricebook/items/${other.id}`))).price)).toBe(100)
    await roof.owner('/api/pricebook/bulk/adjust-prices', { method: 'POST', json: { itemIds: [g1.id], adjustmentType: 'fixed', adjustmentValue: -500, applyTo: 'price' } })
    expect(Number((await json(await roof.owner(`/api/pricebook/items/${g1.id}`))).price)).toBe(0)
    expect((await roof.tech('/api/pricebook/bulk/adjust-prices', { method: 'POST', json: { adjustmentType: 'percent', adjustmentValue: 50, applyTo: 'price' } })).status).toBe(403)
  })
  test('import makes categories and items, updates by code only when asked, and names each bad row; export reads it back', async () => {
    const r = await json(await roof.owner('/api/pricebook/import', { method: 'POST', json: { data: [
      { code: 'SHG-01', name: 'Architectural shingles (sq)', category: 'Shingles', price: 425, cost: 260 },
      { code: 'SHG-02', name: 'Three-tab shingles (sq)', category: 'Shingles', price: 350 },
      { name: '', price: 10 },
    ] } }))
    expect(r.created).toBe(2)
    expect(r.errors.map((e: any) => e.row)).toEqual([3])
    const again = await json(await roof.owner('/api/pricebook/import', { method: 'POST', json: { data: [{ code: 'SHG-01', name: 'Architectural shingles (sq)', price: 999 }] } }))
    expect(again).toMatchObject({ created: 0, updated: 0 })
    const upd = await json(await roof.owner('/api/pricebook/import', { method: 'POST', json: { updateExisting: true, data: [{ code: 'SHG-01', name: 'Architectural shingles (sq)', price: 440 }] } }))
    expect(upd).toMatchObject({ created: 0, updated: 1 })
    const exp = await json(await roof.owner('/api/pricebook/export'))
    const row = exp.find((x: any) => x.code === 'SHG-01')
    // A price-only update leaves the category and the cost as they were.
    expect(row).toMatchObject({ name: 'Architectural shingles (sq)', category: 'Shingles' })
    expect(Number(row.price)).toBe(440)
    expect(Number(row.cost)).toBe(260)
    // What the export writes, the import reads back: taxable and active included.
    const back = await json(await roof.owner('/api/pricebook/import', { method: 'POST', json: { updateExisting: true, data: [{ ...row, active: 'false', taxable: 'no' }] } }))
    expect(back).toMatchObject({ updated: 1, errors: [] })
    const after = (await json(await roof.owner('/api/pricebook/export'))).find((x: any) => x.code === 'SHG-01')
    expect(after).toMatchObject({ active: false, taxable: false, category: 'Shingles' })
  })
})

describe('on a quote', () => {
  test("a line priced from the book records the item and its cost; the cost stays from a seat without margin:read; a quoted item can't be deleted", async () => {
    const item = await json(await ctr.owner('/api/pricebook/items', { method: 'POST', json: { name: 'Panel upgrade', price: 2400, cost: 1300 } }))
    const [contact] = await ctr.t.db.insert(ctr.t.schema.contact).values({ companyId: ctr.companyId, name: 'Pat Quote', type: 'client' } as any).returning()
    const q = await ctr.owner('/api/quotes', { method: 'POST', json: { name: 'Panel', contactId: contact.id, lineItems: [{ description: item.name, quantity: 1, unitPrice: 2400, unitCost: 1300, pricebookItemId: item.id }] } })
    expect(q.status).toBe(201)
    const quote = await json(q)
    const line = (await json(await ctr.owner(`/api/quotes/${quote.id}`))).lineItems[0]
    expect(line.pricebookItemId).toBe(item.id)
    expect(Number(line.unitCost)).toBe(1300)
    const asTech = await ctr.tech(`/api/quotes/${quote.id}`)
    if (asTech.status === 200) expect((await json(asTech)).lineItems[0].unitCost).toBeUndefined()
    const del = await ctr.owner(`/api/pricebook/items/${item.id}`, { method: 'DELETE' })
    expect([200, 409]).toContain(del.status)
    if (del.status === 200) {
      // Deleted while quoted: the quote keeps its line as written.
      const kept = (await json(await ctr.owner(`/api/quotes/${quote.id}`))).lineItems[0]
      expect(kept.description).toBe('Panel upgrade')
      expect(Number(kept.unitPrice)).toBe(2400)
    }
  })
})

describe('the customer presentation (/api/pricebook-present/:id)', () => {
  test('shows the options by their own names; a retired item, or one kept from customers, is not shown', async () => {
    const item = await json(await ctr.owner('/api/pricebook/items', { method: 'POST', json: { name: 'Deck rebuild', price: 9000, cost: 6000 } }))
    const opts = { options: [
      { tier: 'good', name: 'Pine', price: 7000, features: ['Pressure-treated'], recommended: false },
      { tier: 'better', name: 'Cedar', price: 9000, features: [], recommended: true },
      { tier: 'best', name: 'Composite', price: 12000, features: [], recommended: false },
    ] }
    expect((await ctr.owner(`/api/pricebook/items/${item.id}/options`, { method: 'PUT', json: opts })).status).toBe(200)
    const r = await ctr.t.call(`/api/pricebook-present/${item.id}`)
    expect(r.status).toBe(200)
    const html = await r.text()
    for (const w of ['Deck rebuild', 'Pine', 'Cedar', 'Composite', `data-item="${item.id}"`]) expect(html).toContain(w)
    // The template's urgency words are gone; the page never prints the cost.
    for (const w of ['Sign Today', 'Within 30 Days', 'Valid 1 Year', '6000', '6,000']) expect(html).not.toContain(w)

    expect((await ctr.owner(`/api/pricebook/items/${item.id}`, { method: 'PUT', json: { showToCustomer: false } })).status).toBe(200)
    expect((await ctr.t.call(`/api/pricebook-present/${item.id}`)).status).toBe(404)
    expect((await ctr.owner(`/api/pricebook/items/${item.id}`, { method: 'PUT', json: { showToCustomer: true, active: false } })).status).toBe(200)
    expect((await ctr.t.call(`/api/pricebook-present/${item.id}`)).status).toBe(404)
  })

  test('its buttons run under the app\'s policy: no script written into the page, the behaviour served as a file', async () => {
    // The live test (2026-10-22): the policy (http/guards.ts CSP, script-src 'self') ran no inline script or onclick,
    // so "Select This Package" and "Build Your Quote" did nothing.
    const item = await json(await ctr.owner('/api/pricebook/items', { method: 'POST', json: { name: 'Fence', price: 4000 } }))
    await ctr.owner(`/api/pricebook/items/${item.id}/options`, { method: 'PUT', json: { options: [{ tier: 'good', name: 'Cedar', price: 4000, features: [], recommended: true }] } })
    const page = await ctr.t.call(`/api/pricebook-present/${item.id}`)
    const csp = page.headers.get('content-security-policy') || ''
    const scriptSrc = csp.split(';').map((x) => x.trim()).find((x) => x.startsWith('script-src')) || ''
    expect(scriptSrc).toContain("'self'")
    expect(scriptSrc).not.toContain('unsafe-inline')  // the strict policy — so the page must not rely on inline script
    const html = await page.text()
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i)          // every script has a src
    expect(html).not.toMatch(/\son[a-z]+\s*=/i)                         // no onclick= and the like
    expect(html).toContain('<script src="/api/pricebook-present/present.js"')
    expect(html).toContain(`data-item="${item.id}"`)
    const js = await ctr.t.call('/api/pricebook-present/present.js')
    expect(js.status).toBe(200)
    expect(js.headers.get('content-type')).toContain('javascript')
    const src = await js.text()
    for (const w of ['[data-select-tier]', '#buildQuote', '/crm/quotes?newFromPricebook=', '&tier=']) expect(src).toContain(w)
  })

  test('its "Build Your Quote" link is read by the quote form, and the Pricebook page offers the page', () => {
    const fs = require('node:fs'), path = require('node:path')
    const src = (p: string) => fs.readFileSync(path.join(import.meta.dir, '../../..', p), 'utf8')
    const quotes = src('packages/tenant-ui/src/invoicing/QuotesPage.tsx')
    expect(quotes).toContain("searchParams.get('newFromPricebook')")
    expect(quotes).toContain("searchParams.get('tier')")
    expect(quotes).toContain('pricebookLine(item, option)')
    expect(src('packages/tenant-ui/src/pricebook/PricebookPage.tsx')).toContain('/api/pricebook-present/')
    expect(src('apps/unified/web/src/crm/screens.tsx')).toContain('present: true')
  })
})
