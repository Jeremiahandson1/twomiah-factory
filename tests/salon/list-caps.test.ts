// A salon's lists answer a page, not the whole book. (Launch list, 10/17)
//
// GET /api/clients honoured any ?limit= (100000 returned every client in one answer), and /reminders/lapsed and
// /reminders/birthdays had no ceiling at all. The client list now clamps to 1–200 a page; the two reminder lists
// answer at most 500 — the lapsed list sorted highest-spend-first IN THE QUERY, so the cap keeps the clients worth
// calling first — and say when they were capped.
import { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, serviceMenu, serviceRecord } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

await setupSchema()
const [co] = await db.insert(company).values({ name: 'Shears', slug: 'shears-caps', email: 'caps@test.local', settings: { timezone: 'UTC' }, enabledFeatures: ['salon'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'caps@test.local', passwordHash: 'x', firstName: 'Ola', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
const [svc] = await db.insert(serviceMenu).values({ companyId: co.id, name: 'Cut', durationMin: 30, price: '20' } as any).returning()
const longAgo = new Date(Date.now() - 400 * 86400000)
// Three lapsed clients who spent different amounts, inserted cheapest first.
for (const [name, price] of [['Low Spend', '10'], ['High Spend', '900'], ['Mid Spend', '120']] as const) {
  const [ct] = await db.insert(contact).values({ companyId: co.id, type: 'client', name } as any).returning()
  await db.insert(serviceRecord).values({ companyId: co.id, contactId: ct.id, serviceId: svc.id, priceCharged: price, performedAt: longAgo } as any)
}

const app = new Hono()
app.route('/api/clients', (await import('./src/routes/clients.ts')).default)
app.route('/api/reminders', (await import('./src/routes/reminders.ts')).default)
app.onError(errorHandler)
const get = async (path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

const huge = await get('/api/clients?limit=100000')
check(`?limit=100000 is answered (${huge.status})`, huge.status === 200, huge.json)
check('…with a page of at most 200', Number(huge.json?.pagination?.limit) === 200, huge.json?.pagination)
const junk = await get('/api/clients?limit=abc&page=-3')
check('nonsense paging falls back to page 1 of 50', junk.status === 200 && Number(junk.json?.pagination?.limit) === 50 && Number(junk.json?.pagination?.page) === 1, junk.json?.pagination)

const lapsed = await get('/api/reminders/lapsed?months=6')
check(`the lapsed list answers (${lapsed.status})`, lapsed.status === 200 && lapsed.json?.data?.length === 3, lapsed.json)
check('…highest spend first', (lapsed.json?.data || []).map((r: any) => r.clientName).join(',') === 'High Spend,Mid Spend,Low Spend', (lapsed.json?.data || []).map((r: any) => r.clientName))
check('…and says it was not capped', lapsed.json?.capped === false, lapsed.json?.capped)

const src = readFileSync(`${process.env.FACTORY_ROOT}/templates/crm-salon/backend/src/routes/reminders.ts`, 'utf8')
const lapsedRoute = src.slice(src.indexOf("app.get('/lapsed'"), src.indexOf("app.get('/birthdays'"))
check('the lapsed query is ordered by spend and limited IN SQL, so the cap keeps the best clients', /\.orderBy\(sql`coalesce\(sum\(\$\{serviceRecord\.priceCharged\}\), 0\) desc`\)\s*\.limit\(LIST_CAP\)/.test(lapsedRoute))
check('the birthday list is capped too', /\.slice\(0, LIST_CAP\)/.test(src.slice(src.indexOf("app.get('/birthdays'"))))
check('…at 500', /const LIST_CAP = 500/.test(src))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
