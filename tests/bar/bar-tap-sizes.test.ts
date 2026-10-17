// crm-bar — a tap's pour sizes (services/barTapSizes.ts), through the real routes on PGlite. Bar Run 1 (10/17): a tap
// had one price and one pour, so a pitcher could not be rung up; every bar POS sells draft by the size.
//   1. the rule: a tap with no sizes is the single pour it always had; the Taps screen's sizes are checked in words
//   2. saving sizes: the first becomes the usual pour (price_cents / pour_oz, which costing and the website read)
//   3. the register asks which size, and each pour records its own price, its ounces against the keg, and its name
//   4. stock costs each size on its own ounces, and keeps pour_oz and the first size the same
//   5. the website's tap list carries every size; an old tap rings up exactly as before
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 600)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const S = await import('./db/schema.ts')
const { company, user, barTap, barStockItem } = S
const { requestScope } = await import('./src/services/audit.ts')
const T = await import('./src/services/barTapSizes.ts')

const ALL = ['contacts', 'bar_menu', 'bar_register', 'bar_stock', 'bar_tonight']
const [co] = await db.insert(company).values({ name: 'The Tap Room', slug: 'taproom-sizes', email: 'bar@test.local', state: 'WI', settings: {}, enabledFeatures: ALL } as any).returning()
const mk = async (role: string, first: string) => (await db.insert(user).values({ email: `${role}-sizes@test.local`, passwordHash: 'x', firstName: first, lastName: 'T', role, companyId: co.id, isActive: true } as any).returning())[0]
const manager = await mk('manager', 'Pat'), bartender = await mk('field', 'Jess')

const app = new Hono()
app.use('*', (c, next) => requestScope.run({ c }, next))
app.route('/api/bar', (await import('./src/routes/bar.ts')).default)
app.route('/api/register', (await import('./src/routes/barRegister.ts')).registerRoutes)
app.route('/api/stock', (await import('./src/routes/barStock.ts')).default)
app.route('/api/public/bar', (await import('./src/routes/barPublic.ts')).default)
app.onError((err: any, c: any) => c.json({ error: err?.message || 'Internal error' }, err?.status || 500))
const call = (who: any | null) => async (method: string, path: string, body?: unknown) => {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' }
  if (who) Object.assign(headers, { 'x-test-user': who.id, 'x-test-company': co.id, 'x-test-role': who.role })
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const M = call(manager), B = call(bartender), PUB = call(null)

console.log('\n══════════ 1. the rule ══════════')
{
  const one = T.tapSizes({ sizes: [], pourOz: '16', priceCents: 600 })
  check('a tap with no sizes is the one pour it always had', one.length === 1 && one[0].id === 'pour' && one[0].oz === 16 && one[0].priceCents === 600 && one[0].name === '16 oz', one)
  const ok = T.tapSizesInput([{ name: 'Pint', oz: 16, price: '5.50' }, { name: 'Pitcher', oz: '60', priceCents: 1800 }])
  check('sizes read: name, ounces, dollars typed or cents', ok.ok && ok.sizes.map((s: any) => `${s.id}:${s.oz}:${s.priceCents}`).join() === 'pint:16:550,pitcher:60:1800', ok)
  const refusals = [
    T.tapSizesInput([{ name: '', oz: 16 }]), T.tapSizesInput([{ name: 'Pint', oz: 16 }, { name: 'pint', oz: 20 }]),
    T.tapSizesInput([{ name: 'Keg', oz: 1984 }]), T.tapSizesInput([{ name: 'Pint', oz: 16, price: 'free' }]),
    T.tapSizesInput(Array.from({ length: 7 }, (_, i) => ({ name: 'S' + i, oz: 10 }))),
  ]
  check('a nameless size, a repeated name, 1984 oz, a price that is not one, and a seventh size are refused in words', refusals.every((r: any) => !r.ok && typeof r.error === 'string' && r.error.length > 5), refusals)
}

console.log('\n══════════ 2. saving sizes on the Taps screen ══════════')
const [keg] = await db.insert(barStockItem).values({ companyId: co.id, name: 'Spotted Cow ½ bbl', category: 'beer', unit: 'floz', packName: 'keg', packSize: '1984', packCostCents: 19840 } as any).returning()
const made = await M('POST', '/api/bar/taps', { lineNumber: 1, beerName: 'Spotted Cow', price: '6.00' })
const tapId = made.json.id
const old = await M('POST', '/api/bar/taps', { lineNumber: 2, beerName: 'House Lager', price: '5.00' })
{
  const put = await M('PUT', `/api/bar/taps/${tapId}`, { sizes: [{ name: 'Pint', oz: 16, price: '5.50' }, { name: 'Pitcher', oz: 60, price: '18' }, { name: 'Taster', oz: 5, price: '2' }] })
  const [row] = await db.select().from(barTap).where(eq(barTap.id, tapId))
  check(`saved (${put.status}); the first size is the usual pour: $5.50, 16 oz`, put.status === 200 && (row.sizes as any[]).length === 3 && row.priceCents === 550 && Number(row.pourOz) === 16, row)
  const bad = await M('PUT', `/api/bar/taps/${tapId}`, { sizes: [{ name: 'Pint', oz: 16 }, { name: 'Pint', oz: 20 }] })
  check(`a refused list says why and changes nothing (${bad.status})`, bad.status === 400 && /Two sizes/.test(bad.json.error) && ((await db.select().from(barTap).where(eq(barTap.id, tapId)))[0].sizes as any[]).length === 3, bad.json)
  const nope = await B('PUT', `/api/bar/taps/${tapId}`, { sizes: [] })
  check(`a bartender cannot change a tap's sizes (${nope.status})`, nope.status === 403)
  await M('PATCH', `/api/stock/taps/${tapId}`, { stockItemId: keg.id })
}

console.log('\n══════════ 3. the register ══════════')
{
  const st = await B('GET', '/api/register/state')
  const onTap = st.json.menu.find((s: any) => s.id === 'taps')
  const cow = onTap?.items.find((i: any) => i.id === 'tap:' + tapId)
  check('the register lists the three sizes with their prices', cow?.sizes.map((z: any) => `${z.name}:${z.priceCents}`).join() === 'Pint:550,Pitcher:1800,Taster:200', cow)
  const c = (await B('POST', '/api/register/check', { kind: 'tab', label: 'Mike' })).json.check.id
  const which = await B('POST', `/api/register/check/${c}/items`, { menuItemId: 'tap:' + tapId })
  check(`no size picked: it asks which (${which.status})`, which.status === 400 && /Which size of Spotted Cow/.test(which.json.error), which.json)
  const pitcher = await B('POST', `/api/register/check/${c}/items`, { menuItemId: 'tap:' + tapId, sizeId: 'pitcher' })
  const line = pitcher.json.check.items.find((i: any) => i.tapId === tapId)
  check('a pitcher rings up at $18.00, named, and takes 60 oz from the keg', pitcher.status === 200 && line.unitPriceCents === 1800 && line.size === 'Pitcher' && Number(line.stockQty) === 60 && line.stockItemId === keg.id, line)
  const plain = await B('POST', `/api/register/check/${c}/items`, { menuItemId: 'tap:' + old.json.id })
  const l2 = plain.json.check.items.find((i: any) => i.tapId === old.json.id)
  check('a tap with no sizes rings up as before: its price, no size asked', plain.status === 200 && l2.unitPriceCents === 500 && l2.size === null, l2)
  const legacy = await B('POST', `/api/register/check/${c}/items`, { menuItemId: 'tap:' + old.json.id, sizeId: 'regular' })
  check("a register still sending the old 'regular' size id rings up the one pour", legacy.status === 200, legacy.json)
}

console.log('\n══════════ 4. stock ══════════')
{
  const r = await M('GET', '/api/stock/recipes')
  const p = r.json.pours.find((x: any) => x.tapId === tapId)
  check('each size is costed on its own ounces: pint $1.60, pitcher $6.00, taster $0.50', p?.sizes.map((z: any) => `${z.name}:${z.costCents}`).join() === 'Pint:160,Pitcher:600,Taster:50', p)
  await M('PATCH', `/api/stock/taps/${tapId}`, { pourOz: 20 })
  const [row] = await db.select().from(barTap).where(eq(barTap.id, tapId))
  check('changing the pour on Stock changes the first size too, and only it', Number(row.pourOz) === 20 && (row.sizes as any[])[0].oz === 20 && (row.sizes as any[])[1].oz === 60, row.sizes)
}

console.log('\n══════════ 5. the website ══════════')
{
  const pub = await PUB('GET', '/api/public/bar/taps')
  const t = pub.json.taps?.find((x: any) => x.beerName === 'Spotted Cow')
  check('the public tap list carries every size and price; price stays the usual pour', pub.status === 200 && t?.sizes.length === 3 && t.sizes[1].name === 'Pitcher' && /18/.test(t.sizes[1].price) && /5\.50/.test(t.price), t)
  const o = pub.json.taps?.find((x: any) => x.beerName === 'House Lager')
  check('…and a tap with no sizes shows its one pour', o?.sizes.length === 1 && o.sizes[0].oz === 16, o)
}

console.log(`\nbar-tap-sizes: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
