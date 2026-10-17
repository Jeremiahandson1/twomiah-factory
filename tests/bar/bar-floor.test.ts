// crm-bar — the floor, through the real routes on PGlite (services/barFloor.ts, GET/PUT /api/register/floor):
//   · a bar that has not set its room gets a starting layout; a viewer may not read it, a bartender may
//   · only bar:update sets the room; names and ids come out unique, seat counts sane, an empty room refused
//   · a table shows the open checks on its spot — after a split by seat, every one of them
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 600)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, barMenuSection, barMenuItem } = await import('./db/schema.ts')
const { requestScope } = await import('./src/services/audit.ts')
const F = await import('./src/services/barFloor.ts')

const [co] = await db.insert(company).values({ name: 'The Tap Room', slug: 'taproom-floor', email: 'bar@test.local', settings: {}, enabledFeatures: ['contacts', 'bar_menu', 'bar_register'] } as any).returning()
const mk = async (role: string, first: string) => (await db.insert(user).values({ email: `${role}-floor@test.local`, passwordHash: 'x', firstName: first, lastName: 'T', role, companyId: co.id, isActive: true } as any).returning())[0]
const manager = await mk('manager', 'Pat'), bartender = await mk('field', 'Jess'), viewer = await mk('viewer', 'Vic')
const [sec] = await db.insert(barMenuSection).values({ slug: 'food', name: 'Food', kind: 'food', companyId: co.id } as any).returning()
const [burger] = await db.insert(barMenuItem).values({ sectionId: sec.id, slug: 'burger', name: 'Hamburger', priceCents: 1000, companyId: co.id } as any).returning()

const app = new Hono()
app.use('*', (c, next) => requestScope.run({ c }, next))
app.route('/api/register', (await import('./src/routes/barRegister.ts')).registerRoutes)
const call = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': co.id, 'x-test-role': who.role }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const M = call(manager), B = call(bartender), V = call(viewer)

{
  const v = await V('GET', '/api/register/floor')
  check(`a viewer may not read the floor (${v.status})`, v.status === 403)
  const b = await B('GET', '/api/register/floor')
  check('a bar with no room set gets the starting layout: 5 booths, 5 tables, 10 bar seats', b.status === 200 && b.json.tables.length === 20 && b.json.tables.filter((t: any) => t.kind === 'booth').length === 5 && b.json.tables.filter((t: any) => t.kind === 'bar').length === 10, b.json.tables?.length)
  const bp = await B('PUT', '/api/register/floor', { tables: [{ name: 'Booth 1' }] })
  check('a bartender may not set the room', bp.status === 403, bp.json)
  const empty = await M('PUT', '/api/register/floor', { tables: [] })
  check('an empty room is refused', empty.status === 400, empty.json)
  const set = await M('PUT', '/api/register/floor', { tables: [
    { name: 'Booth 2', kind: 'booth', seats: 4 }, { name: 'booth 2', kind: 'booth' }, { name: 'Window', kind: 'table', seats: 99 }, { name: 'Bar 1', kind: 'bar' }, { name: '  ' },
  ] })
  check('a manager sets the room: duplicate and blank names dropped, seats kept sane', set.status === 200 && set.json.floor.tables.length === 3 && set.json.floor.tables[1].seats === 20 && set.json.floor.tables[2].seats === 1, set.json.floor)
  check('ids come out unique and readable', JSON.stringify(set.json.floor.tables.map((t: any) => t.id)) === JSON.stringify(['booth-2', 'window', 'bar-1']), set.json.floor.tables.map((t: any) => t.id))
  check('the same cleaning, pure', F.floorConfig({ tables: [{ name: 'A', id: 'x' }, { name: 'B', id: 'x' }] }).tables.map((t) => t.id).join(',') === 'x,x-2')
}
{
  const c = (await B('POST', '/api/register/check', { kind: 'table', spot: 'Booth 2' })).json.check.id
  await B('POST', `/api/register/check/${c}/items`, { menuItemId: burger.id, seat: 1 })
  await B('POST', `/api/register/check/${c}/items`, { menuItemId: burger.id, seat: 2 })
  const f1 = await B('GET', '/api/register/floor')
  const booth = f1.json.tables.find((t: any) => t.name === 'Booth 2')
  check('a check opened for "Booth 2" shows on Booth 2', booth.checks.length === 1 && booth.checks[0].id === c && booth.checks[0].balanceCents > 0, booth)
  check('…and nowhere else', f1.json.tables.filter((t: any) => t.checks.length).length === 1)
  await B('POST', `/api/register/check/${c}/split-seats`)
  const f2 = await B('GET', '/api/register/floor')
  const booth2 = f2.json.tables.find((t: any) => t.name === 'Booth 2')
  check('split by seat: both checks are on the booth', booth2.checks.length === 2, booth2.checks.map((x: any) => x.label))
}

console.log(`\nbar-floor: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
