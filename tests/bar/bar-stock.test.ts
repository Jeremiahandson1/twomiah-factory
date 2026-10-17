// crm-bar — stock and costing (services/barCosting.ts, barStock.ts, routes/barStock.ts):
//   1. the arithmetic, with the numbers from website-premium-bar's own tests: unit cost, plate cost, cost %, size
//      lines, usage (recipes × sold + pours as recorded), variance, back to par, menu engineering
//   2. who: a bartender counts (blind — no expected numbers) but sees no costs; a viewer does neither; the feature
//      switches it all off
//   3. a night, through the real routes: a count, sales on the register (burgers and pours), an order received at
//      a new price, a second count — on hand between counts, the variance in dollars, food and pour cost, what to
//      reorder, purchase order numbers that only go forwards, a closed order that cannot be received twice
//   4. another company's items, vendors and stock are not found and cannot be put in a recipe
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 600)) }
}
const same = (name: string, got: unknown, want: unknown) => check(name, JSON.stringify(got) === JSON.stringify(want), { got, want })

const C = await import('./src/services/barCosting.ts')

console.log('\n══════════ 1. the arithmetic ══════════')
{
  const stock = new Map<string, any>([
    ['beef', { name: 'Ground beef', packCostCents: 5200, packSize: '10' }],
    ['bun', { name: 'Buns', packCostCents: 480, packSize: '12' }],
    ['fries', { name: 'Fries', packCostCents: 3000, packSize: '30' }],
    ['keg', { name: 'Spaten ½ bbl', packCostCents: 19840, packSize: '1984' }],
    ['mystery', { name: 'Special sauce', packCostCents: null, packSize: '1' }],
  ])
  same('unit cost from the pack', [C.unitCostCents({ packCostCents: 19840, packSize: '1984' }), C.unitCostCents({ packCostCents: null, packSize: '1' }), C.unitCostCents({ packCostCents: 500, packSize: '0' })], [10, null, null])
  same('½ lb beef + a bun = $3.00', C.costOf([{ stockItemId: 'beef', qty: '0.5' }, { stockItemId: 'bun', qty: 1 }], stock), { costCents: 300, missing: [] })
  same('an unpriced ingredient makes the cost unknown, and says which', C.costOf([{ stockItemId: 'beef', qty: 0.5 }, { stockItemId: 'mystery', qty: 1 }], stock), { costCents: null, missing: ['Special sauce'] })
  same('cost %: $3.00 on $5.79 = 51.8%', [C.costPct(300, 579), C.costPct(null, 579)], [51.8, null])
  const lines = [{ sizeId: null, stockItemId: 'beef' }, { sizeId: null, stockItemId: 'bun' }, { sizeId: 'platter', stockItemId: 'fries' }]
  same('size lines win over every-size lines', [C.linesForSize(lines, 'platter').map(l => l.stockItemId), C.linesForSize(lines, 'sandwich').map(l => l.stockItemId)], [['fries'], ['beef', 'bun']])
  const recipes = new Map([['ham', [{ sizeId: null, stockItemId: 'beef', qty: '0.5' }, { sizeId: null, stockItemId: 'bun', qty: '1' }]]])
  const use = C.theoreticalUse([
    { menuItemId: 'ham', sizeId: 'sandwich', qty: 10 },
    { menuItemId: null, sizeId: 'regular', qty: 40, stockItemId: 'keg', stockQty: '16' },
    { menuItemId: 'unknown', sizeId: 'regular', qty: 3 },
  ], recipes)
  same('recipes × sold, plus tap pours as recorded', [use.get('beef'), use.get('bun'), use.get('keg')], [5, 10, 640])
  const keg = C.variance([{ id: 'keg', name: 'Spaten', category: 'beer', unit: 'floz', packCostCents: 19840, packSize: '1984' }], new Map([['keg', 1984]]), new Map([['keg', 1284]]), new Map(), new Map([['keg', 640]]))
  check('40 pints should be 640 oz; the keg lost 700 → 60 oz ($6) unaccounted', keg[0].actual === 700 && keg[0].expected === 640 && keg[0].varianceUnits === 60 && keg[0].varianceCents === 600 && keg[0].actualCents === 7000, keg[0])
  const rv = C.variance([{ id: 'bun', name: 'Buns', category: 'food', unit: 'each', packCostCents: 480, packSize: '12' }, { id: 'beef', name: 'Beef', category: 'food', unit: 'lb', packCostCents: 5200, packSize: '10' }],
    new Map([['bun', 10]]), new Map([['bun', 20]]), new Map([['bun', 24]]), new Map([['bun', 14]]))
  check('received between counts is stock; items not counted both times are left out', rv.length === 1 && rv[0].actual === 14 && rv[0].varianceUnits === 0, rv)
  same('back to par, whole packs; no par → never suggested', [C.packsToOrder(18, '12', '3'), C.packsToOrder(36, '12', '3'), C.packsToOrder(0, '1984', '2'), C.packsToOrder(5, '12', null)], [2, 0, 2, 0])
  const r = C.engineerMenu([
    { key: 'a', name: 'Hamburger', sold: 100, priceCents: 729, costCents: 300 },
    { key: 'b', name: 'Fish Fry', sold: 60, priceCents: 949, costCents: 350 },
    { key: 'c', name: 'Reuben Burger', sold: 5, priceCents: 939, costCents: 320 },
    { key: 'd', name: 'Cheese Quesadilla', sold: 4, priceCents: 600, costCents: 350 },
    { key: 'e', name: 'Soup', sold: 30, priceCents: 400, costCents: null },
  ])
  same('stars, plowhorses, puzzles, dogs', [Object.fromEntries(r.rows.map(x => [x.name, x.class]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))), r.avgMarginCents, r.popularAt],
    [{ 'Cheese Quesadilla': 'dog', 'Fish Fry': 'star', Hamburger: 'plowhorse', 'Reuben Burger': 'puzzle', Soup: null }, Math.round((100 * 429 + 60 * 599 + 5 * 619 + 4 * 250) / 169), 14])
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const S = await import('./db/schema.ts')
const { company, user, barMenuSection, barMenuItem, barTap, barCheck, barCheckItem, barStockCount, barPurchaseOrder } = S
const { requestScope } = await import('./src/services/audit.ts')

const ALL = ['contacts', 'bar_menu', 'bar_register', 'bar_stock']
const [co] = await db.insert(company).values({ name: 'The Tap Room', slug: 'taproom-stock', email: 'bar@test.local', settings: {}, enabledFeatures: ALL } as any).returning()
const mk = async (cid: string, role: string, first: string, tag: string) => (await db.insert(user).values({ email: `${role}-${tag}@test.local`, passwordHash: 'x', firstName: first, lastName: 'T', role, companyId: cid, isActive: true } as any).returning())[0]
const manager = await mk(co.id, 'manager', 'Pat', 'stock'), bartender = await mk(co.id, 'field', 'Jess', 'stock'), viewer = await mk(co.id, 'viewer', 'Vic', 'stock')
const [food] = await db.insert(barMenuSection).values({ slug: 'food', name: 'Food', kind: 'food', companyId: co.id } as any).returning()
const [burger] = await db.insert(barMenuItem).values({ sectionId: food.id, slug: 'burger', name: 'Hamburger', priceCents: 1000, companyId: co.id } as any).returning()
const [tap] = await db.insert(barTap).values({ companyId: co.id, lineNumber: 1, beerName: 'Spaten', priceCents: 600, status: 'pouring' } as any).returning()

const app = new Hono()
app.use('*', (c, next) => requestScope.run({ c }, next))
app.route('/api/register', (await import('./src/routes/barRegister.ts')).registerRoutes)
app.route('/api/stock', (await import('./src/routes/barStock.ts')).default)
app.onError((err: any, c: any) => c.json({ error: err?.message || 'Internal error' }, err?.status || 500))
const call = (who: any, cid = co.id) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': cid, 'x-test-role': who.role }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const M = call(manager), B = call(bartender), V = call(viewer)

console.log('\n══════════ 2. who ══════════')
{
  const [other] = await db.insert(company).values({ name: 'No Stock', slug: 'nostock', email: 'ns@test.local', settings: {}, enabledFeatures: ['contacts', 'bar_menu', 'bar_register'] } as any).returning()
  const om = await mk(other.id, 'manager', 'Otto', 'nostock')
  const off = await call(om, other.id)('GET', '/api/stock/items'), offc = await call(om, other.id)('GET', '/api/stock/count')
  check(`switched off: no stock, no count (${off.status}, ${offc.status})`, off.status === 403 && offc.status === 403)
  const bi = await B('GET', '/api/stock/items'), bc = await B('GET', '/api/stock/count'), vc = await V('GET', '/api/stock/count')
  check(`a bartender counts but sees no costs (${bc.status} count, ${bi.status} items); a viewer does neither (${vc.status})`, bc.status === 200 && bi.status === 403 && vc.status === 403)
}

console.log('\n══════════ 3. a night ══════════')
let beef = '', bun = '', keg = '', vendor = ''
{
  vendor = (await M('POST', '/api/stock/vendors', { name: 'Reinhart', email: 'rep@reinhart.test', orderDays: 'Tue, Fri' })).json.vendor.id
  beef = (await M('POST', '/api/stock/items', { name: 'Ground beef', category: 'food', unit: 'lb', packName: '10 lb case', packSize: 10, packCostCents: 4500, parPacks: 4, vendorId: vendor })).json.item.id
  bun = (await M('POST', '/api/stock/items', { name: 'Buns', category: 'food', unit: 'each', packName: 'case of 24', packSize: 24, packCostCents: 600 })).json.item.id
  keg = (await M('POST', '/api/stock/items', { name: 'Spaten ½ bbl', category: 'beer', unit: 'floz', packName: '½ bbl keg', packSize: 1984, packCostCents: 19840 })).json.item.id
  const bad = await M('POST', '/api/stock/items', { name: 'Nothing', packSize: 0 })
  check('a pack must hold something', bad.status === 400, bad.json)
  const rec = await M('PUT', `/api/stock/recipes/${burger.id}`, { sizeId: null, lines: [{ stockItemId: beef, qty: 0.5 }, { stockItemId: bun, qty: 1 }] })
  const pour = await M('PATCH', `/api/stock/taps/${tap.id}`, { stockItemId: keg, pourOz: 16 })
  check('a recipe and a pour are set', rec.status === 200 && pour.status === 200 && Number(pour.json.tap.pourOz) === 16, [rec.json, pour.json])
  const book = await M('GET', '/api/stock/recipes')
  const size = book.json.sections[0].items[0].sizes[0]
  const p = book.json.pours[0]
  check(`plate cost: ½ lb beef ($2.25) + a bun ($0.25) = ${size.costCents}¢, ${size.pct}% of $10`, size.costCents === 250 && size.pct === 25, size)
  check(`pour cost: 16 oz of a $198.40 keg = ${p.costCents}¢, ${p.pct}% of $6`, p.costCents === 160 && p.pct === 26.7, p)
  const toolong = await M('PATCH', `/api/stock/taps/${tap.id}`, { pourOz: 100 })
  check('a 100 oz pour is refused', toolong.status === 400 && /1 to 64/.test(toolong.json.error), toolong.json)

  // Count 1 (the bartender, blind)
  const blind = await B('GET', '/api/stock/count')
  check('the count shows what to count and in what packs — never what is expected or what it cost', blind.json.stock.length === 3 && !JSON.stringify(blind.json.stock).match(/onHand|Cost|usedSince/), blind.json.stock[0])
  await B('POST', '/api/stock/count/item', { stockItemId: beef, packs: 2 })
  await B('POST', '/api/stock/count/item', { stockItemId: bun, packs: 1 })
  await B('POST', '/api/stock/count/item', { stockItemId: keg, packs: 1 })
  const f1 = await B('POST', '/api/stock/count/finish')
  check('the bartender finishes the count', f1.status === 200, f1.json)
  // So the second count's sales fall after the first count closed.
  await db.update(barStockCount).set({ finishedAt: new Date(Date.now() - 3600000) }).where(eq(barStockCount.id, f1.json.count.id))

  // The night: 4 burgers and 2 pints, paid.
  const c = (await B('POST', '/api/register/check', { kind: 'tab', label: 'Night' })).json.check.id
  await B('POST', `/api/register/check/${c}/items`, { menuItemId: burger.id, qty: 4 })
  const pint = await B('POST', `/api/register/check/${c}/items`, { menuItemId: 'tap:' + tap.id, qty: 2 })
  const pl = pint.json.check.items.find((i: any) => i.tapId)
  check('a pour on the register records the keg and its ounces', pl.stockItemId === keg && Number(pl.stockQty) === 16, pl)
  const bal = (await B('GET', `/api/register/check/${c}`)).json.check.totals.balanceCents
  await B('POST', `/api/register/check/${c}/pay`, { tender: 'cash', amountCents: bal })

  // An order received: one case of beef at the new price.
  const o = await M('POST', '/api/stock/orders', { vendorId: vendor, lines: [{ stockItemId: beef, packs: 1, packCostCents: 4500 }] })
  const o2 = await M('POST', '/api/stock/orders', { vendorId: vendor, lines: [{ stockItemId: bun, packs: 1 }] })
  const nums = (await db.select().from(barPurchaseOrder).where(eq(barPurchaseOrder.companyId, co.id))).map(r => r.number).sort()
  check(`purchase order numbers go forwards (${nums})`, JSON.stringify(nums) === '[1,2]', nums)
  await M('POST', `/api/stock/orders/${o2.json.id}/cancel`)
  const recv = await M('POST', `/api/stock/orders/${o.json.id}/receive`, { lines: [] })
  const lines = (await M('GET', '/api/stock/orders')).json.orders.find((x: any) => x.id === o.json.id).lines
  await M('POST', `/api/stock/orders/${o.json.id}/receive`, { lines: [{ lineId: lines[0].id, packs: 1, packCostCents: 5000 }] }).then(r => check('a received order cannot be received twice', r.status === 409, r.json))
  check('received', recv.status === 200 && recv.json.order.status === 'received', recv.json)

  // On hand between counts: count + received − used.
  const items = (await M('GET', '/api/stock/items')).json.stock
  const b = items.find((x: any) => x.id === beef), u = items.find((x: any) => x.id === bun), k = items.find((x: any) => x.id === keg)
  check(`beef on hand: 20 + 10 − 2 = ${b.onHand} lb`, b.onHand === 28 && b.usedSince === 2 && b.receivedSince === 10, b)
  check(`buns: 24 − 4 = ${u.onHand}; the keg: 1984 − 32 = ${k.onHand} oz`, u.onHand === 20 && k.onHand === 1952, [u, k])

  // Count 2: a pound of beef and 52 oz of beer unaccounted for.
  await B('POST', '/api/stock/count/item', { stockItemId: beef, units: 27 })
  await B('POST', '/api/stock/count/item', { stockItemId: bun, units: 20 })
  await B('POST', '/api/stock/count/item', { stockItemId: keg, units: 1900 })
  const f2 = await B('POST', '/api/stock/count/finish')
  const rep = await M('GET', `/api/stock/counts/${f2.json.count.id}/report`)
  const rb = rep.json.rows.find((r: any) => r.stockItemId === beef), rk = rep.json.rows.find((r: any) => r.stockItemId === keg)
  check(`beef: used 3 lb, the register says 2 → 1 lb over, ${rb?.varianceCents}¢`, rb && rb.actual === 3 && rb.expected === 2 && rb.varianceUnits === 1 && rb.varianceCents === 450, rb)
  check(`the keg: 84 oz gone, 32 poured → 52 oz unaccounted, ${rk?.varianceCents}¢`, rk && rk.actual === 84 && rk.expected === 32 && rk.varianceCents === 520, rk)
  check(`food cost ${rep.json.totals?.foodCostPct}% and pour cost ${rep.json.totals?.pourCostPct}% for the period`, rep.json.totals.foodSalesCents === 4000 && rep.json.totals.drinkSalesCents === 1200 && rep.json.totals.foodCostPct !== null && rep.json.totals.pourCostPct === 70, rep.json.totals)

  // Below par → a draft order for the vendor.
  const draft = await M('POST', '/api/stock/orders/draft-low')
  const orders = (await M('GET', '/api/stock/orders')).json.orders
  const d = orders.find((x: any) => x.id === draft.json.ids?.[0])
  check(`below par: 27 lb on a par of 4 cases → ${d?.lines?.[0]?.packs} cases to ${d?.vendor?.name}`, d && d.lines[0].packs === 2 && d.vendor?.name === 'Reinhart' && d.number === 3, d)
  const eng = await M('GET', '/api/stock/engineering?days=30')
  check('menu engineering reads the night', eng.status === 200 && eng.json.rows.some((r: any) => r.name === 'Hamburger' && r.sold === 4 && r.costCents === 250), eng.json.rows)
}

console.log('\n══════════ 4. another company ══════════')
{
  const [other] = await db.insert(company).values({ name: 'Other Bar', slug: 'other-stock', email: 'ob@test.local', settings: {}, enabledFeatures: ALL } as any).returning()
  const om = await mk(other.id, 'manager', 'Oz', 'otherstock')
  const O2 = call(om, other.id)
  const patch = await O2('PATCH', `/api/stock/items/${beef}`, { name: 'Mine now', packSize: 1 })
  check("another company cannot edit this bar's stock", patch.status === 404, patch.json)
  const theirItem = (await O2('POST', '/api/stock/items', { name: 'Their beef', packSize: 10 })).json.item.id
  const mix = await M('PUT', `/api/stock/recipes/${burger.id}`, { sizeId: null, lines: [{ stockItemId: theirItem, qty: 1 }] })
  check("another company's stock cannot go in this bar's recipe", mix.status === 404, mix.json)
  const ven = await O2('POST', '/api/stock/items', { name: 'X', packSize: 1, vendorId: vendor })
  check("…nor this bar's vendor on their item", ven.status === 404, ven.json)
  const list = await O2('GET', '/api/stock/items')
  check("…and their list holds only theirs", list.json.stock.length === 1 && list.json.stock[0].name === 'Their beef', list.json.stock.map((s: any) => s.name))
}

console.log(`\nbar-stock: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
