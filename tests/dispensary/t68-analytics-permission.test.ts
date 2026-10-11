// T68 — "Dispensary: … /me still lists analytics:read" for the viewer.
//
// The analytics routes asked the RANK (requireRole('manager')), so analytics:read — granted to the viewer in the
// matrix and listed in its /me — was honoured nowhere. Now the routes ask analytics:read itself and the viewer no
// longer holds it: the same three seats get in (owner, admin, manager), the list the screen is given tells the
// truth, and an owner's per-person grant of analytics:read actually works — which the rank never allowed.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()
const [co] = await db.insert(company).values({ name: 'Green Mile', slug: 'green-t68', email: 'green-t68@test.local', state: 'OH', settings: {}, enabledFeatures: [] } as any).returning()
const mk = async (role: string, tag: string, extra: string[] = []) => (await db.insert(user).values({
  email: `${tag}@green-t68.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, extraPermissions: extra,
} as any).returning())[0]
const seats = {
  owner: await mk('owner', 'owner'), admin: await mk('admin', 'admin'), manager: await mk('manager', 'manager'),
  budtender: await mk('budtender', 'budtender'), driver: await mk('driver', 'driver'), viewer: await mk('viewer', 'viewer'),
}
// the owner hands one viewer the analytics by name (Settings › Users)
const trusted = await mk('viewer', 'trusted', ['analytics:read'])

const app = new Hono()
app.route('/api/analytics', (await import('./src/routes/analytics.ts')).default)
const get = async (who: any, path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': who.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

const { getPermissions, hasPermission } = await import('./src/middleware/permissions.ts')
check('the viewer\'s permission list no longer claims analytics:read', !getPermissions('viewer').includes('analytics:read'), getPermissions('viewer'))
check('…and the matrix agrees: the viewer does not hold it', hasPermission('viewer', 'analytics:read') === false)
check('the manager still holds it', hasPermission('manager', 'analytics:read') === true)

for (const [seat, want] of [['owner', 200], ['admin', 200], ['manager', 200], ['budtender', 403], ['driver', 403], ['viewer', 403]] as const) {
  const r = await get(seats[seat], '/api/analytics/summary')
  check(`${seat}: /api/analytics/summary → ${want}`, r.status === want, { status: r.status, body: JSON.stringify(r.json)?.slice(0, 120) })
}
const refusal = await get(seats.viewer, '/api/analytics/summary')
check('the refusal names the permission it asked for', refusal.json?.required === 'analytics:read', refusal.json)
const granted = await get(trusted, '/api/analytics/summary')
check('a viewer the owner granted analytics:read gets in — the permission is now the rule', granted.status === 200, { status: granted.status, body: JSON.stringify(granted.json)?.slice(0, 120) })

console.log(`\nt68 analytics permission: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
