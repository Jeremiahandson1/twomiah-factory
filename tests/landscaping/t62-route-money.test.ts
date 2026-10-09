// T62 Medium — "Landscaping route cards show weekly revenue ($55)" to staff.
//
// A route's price per visit and its weekly total are money (invoices:read, which field does not hold). Withheld
// — absent, not 0 — from the list, the board, one route's stops and a stop just added; and staff do not SET a
// stop's price. The crew keeps the stops, the order and the minutes. Through the real router.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, site, recurringRoute, recurringRouteStop } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({ name: 'Verge Money', slug: 'verge-t62', email: 'v62@test.local', settings: {}, enabledFeatures: ['recurring_routes', 'jobs', 'contacts'] } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}@v62.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true } as any).returning())[0]
const owner = await mk('owner', 'owner'), manager = await mk('manager', 'manager'), crew = await mk('field', 'crew')
const [client] = await db.insert(contact).values({ companyId: co.id, name: 'Hollis Ward', email: 'hollis-t62@test.local' } as any).returning()
const [yard] = await db.insert(site).values({ companyId: co.id, contactId: client.id, name: 'Ward front lawn', address: '12 Elm' } as any).returning()
const [route] = await db.insert(recurringRoute).values({ companyId: co.id, name: 'Tuesday north', dayOfWeek: 2 } as any).returning()
// 57.31 — a figure nothing else in the payloads can produce
await db.insert(recurringRouteStop).values({ companyId: co.id, recurringRouteId: route.id, siteId: yard.id, serviceType: 'mowing', estimatedMinutes: 40, pricePerVisit: '57.31' } as any)

const app = new Hono()
app.route('/api/recurring-routes', (await import('./src/routes/recurringRoutes.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const R = '/api/recurring-routes'

// ── the crew: the round, not the books ──
const list = await as(crew)('GET', R)
const lr = (list.json?.data || []).find((r: any) => r.id === route.id)
check('the crew reads the route list — stops and minutes', list.status === 200 && lr?.stopCount === 1 && lr?.estimatedMinutes === 40, lr)
check('…with NO weeklyRevenue key', !!lr && !('weeklyRevenue' in lr), lr)
const board = await as(crew)('GET', `${R}/board`)
const br = (board.json?.data || []).flatMap((d: any) => d.routes).find((r: any) => r.id === route.id)
check('the crew reads the week board', board.status === 200 && br?.stopCount === 1, br)
check('…with NO weeklyRevenue on the card (it printed $55)', !!br && !('weeklyRevenue' in br), br)
const one = await as(crew)('GET', `${R}/${route.id}`)
check('the crew opens the route and sees its stop', one.status === 200 && one.json?.stops?.length === 1 && one.json.stops[0].estimatedMinutes === 40, one.json?.stops)
check('…without the stop\'s price', one.status === 200 && !('pricePerVisit' in (one.json?.stops?.[0] || {})), one.json?.stops)
for (const [label, r] of [['list', list], ['board', board], ['route', one]] as const) check(`…and 57.31 is nowhere in the ${label} payload`, !/57\.31/.test(r.text))

const priced = await as(crew)('POST', `${R}/${route.id}/stops`, { siteId: yard.id, serviceType: 'edging', estimatedMinutes: 15, pricePerVisit: '25' })
check('the crew cannot SET a stop\'s price (403, field pricePerVisit)', priced.status === 403 && priced.json?.field === 'pricePerVisit', priced)
const plain = await as(crew)('POST', `${R}/${route.id}/stops`, { siteId: yard.id, serviceType: 'edging', estimatedMinutes: 15, pricePerVisit: '' })
check('…but still adds a stop without one (the form sends "")', plain.status === 201 && !('pricePerVisit' in (plain.json || {})), plain)

// ── the people who price the round ──
for (const [who, label] of [[owner, 'the owner'], [manager, 'a manager']] as const) {
  const b = (await as(who)('GET', `${R}/board`)).json?.data?.flatMap((d: any) => d.routes).find((r: any) => r.id === route.id)
  check(`${label} sees the week's revenue on the card`, b?.weeklyRevenue === 57.31, b)
  const s = (await as(who)('GET', `${R}/${route.id}`)).json?.stops?.find((x: any) => x.serviceType === 'mowing')
  check(`${label} sees the stop's price`, Number(s?.pricePerVisit) === 57.31, s)
}
const mp = await as(manager)('POST', `${R}/${route.id}/stops`, { siteId: yard.id, serviceType: 'leaf', estimatedMinutes: 20, pricePerVisit: '30' })
check('a manager prices a new stop', mp.status === 201 && Number(mp.json?.pricePerVisit) === 30, mp)

console.log(`\nt62 route money: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
