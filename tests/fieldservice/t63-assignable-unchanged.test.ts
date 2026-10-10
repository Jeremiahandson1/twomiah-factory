// T63 — the salon fix opens /api/team/assignable to schedule:create. On field service a technician holds neither
// team:read nor schedule:create, so nothing moves here: still refused, and the manager still gets the list.
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

const [co] = await db.insert(company).values({ name: 'Coil & Sons', slug: 'coil-t63', email: 'coil-t63@test.local', settings: {}, enabledFeatures: [] } as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({ email: `${tag}@coil-t63.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true } as any).returning())[0]
const manager = await mk('manager', 'manager'), tech = await mk('field', 'tech')

const app = new Hono()
app.route('/api/team', (await import('./src/routes/team.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const get = async (who: any) => (await app.request('/api/team/assignable', { headers: { 'x-test-user': who.id } })).status

check('a technician is still refused the picker list (403)', (await get(tech)) === 403)
check('a manager still gets it', (await get(manager)) === 200)

console.log(`\nt63 assignable unchanged: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
