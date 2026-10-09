// T62 Medium — "Roofing: the staff canvasser app opens the owner's canvassing session, and a stop logged there would
// likely land in it."
//
// The canvasser app picked the first ACTIVE session in the company. It asks GET /sessions?mine=1 now, which returns
// only the caller's own; the dashboard's unfiltered list (the manager's view of the team) is unchanged.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({ name: 'Gable & Sons', slug: 'gable-t62', email: 'gable-t62@test.local', settings: {}, enabledFeatures: ['canvassing_tool'] } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}@gable-t62.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true } as any).returning())[0]
const owner = await mk('owner', 'owner'), canvasser = await mk('field', 'canvasser')

const app = new Hono()
app.route('/api/canvassing', (await import('./src/routes/canvassing.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

const os = await as(owner)('POST', '/api/canvassing/sessions', { name: "Owner's Elm St sweep" })
check('the owner starts a session', os.status === 201 && os.json?.status === 'active', os)
const before = await as(canvasser)('GET', '/api/canvassing/sessions?mine=1')
check('the canvasser\'s own list does not include the owner\'s active session', before.status === 200 && Array.isArray(before.json) && before.json.length === 0, before.json)
const cs = await as(canvasser)('POST', '/api/canvassing/sessions', { name: 'Maple Ave doors' })
check('the canvasser starts their own', cs.status === 201, cs)
const mine = await as(canvasser)('GET', '/api/canvassing/sessions?mine=1')
check('…and ?mine=1 returns exactly that one', mine.status === 200 && mine.json?.length === 1 && mine.json[0].id === cs.json?.id, mine.json?.map?.((s: any) => s.name))
const team = await as(owner)('GET', '/api/canvassing/sessions')
check('the unfiltered list (the dashboard) still shows the whole team', team.status === 200 && team.json?.length === 2, team.json?.map?.((s: any) => s.name))

console.log(`\nt62 canvass mine: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
