// Field Service T30 M-R1 — the app is told what this person may do, and told it correctly.
//
// The fix for "staff and manager see screens they cannot use" is to build the menu and the buttons from
// the permission list the app receives at login. /api/auth/me already sent a list, but it sent
// getPermissions(role): the ROLE's permissions, with the per-user grants an owner hands out in Settings ›
// Users left off. The guards honour those grants — hasPermission() takes `extra` — so the list the screen
// was given was narrower than the truth, and a menu built on it would have hidden a page from exactly the
// person the owner had deliberately let through.
//
// Nothing consumed the list before, which is the only reason that never showed up as a bug. It does now.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

await setupSchema()

const [co] = await db.insert(company).values({ name: 'T30 Perms Payload', slug: 't30pay', email: 't30pay@test.local', settings: {}, enabledFeatures: ['jobs', 'contacts', 'invoices', 'quotes'] } as any).returning()
const mkUser = async (role: string, tag: string, extra?: string[]) =>
  (await db.insert(user).values({ email: `${tag}-t30pay@test.local`, passwordHash: 'x', firstName: tag, lastName: 'User', role, companyId: co.id, ...(extra ? { extraPermissions: extra } : {}) } as any).returning())[0]

const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')
const staff = await mkUser('user', 'staff')
const granted = await mkUser('user', 'granted', ['quotes:read'])

const app = new Hono()
app.route('/api/auth', (await import('./src/routes/auth.ts')).default)
app.onError(errorHandler)

const meAs = async (who: any) => {
  const res = await app.request('/api/auth/me', { headers: { 'x-test-user': who.id, 'x-test-company': co.id, 'x-test-role': who.role } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
/** The client-side rule, the same one packages/tenant-ui/src/auth/types.ts uses. */
const allows = (list: string[], p: string) => list.includes('*') || list.includes(p) || list.includes(`${p.split(':')[0]}:*`)

console.log('\n── every role is told its own list ──')
{
  const s = await meAs(staff)
  check('/me answers a technician', s.status === 200, { status: s.status })
  const list = s.json?.permissions
  check('…with a permission list', Array.isArray(list), { permissions: list })
  check('a technician may read service calls', allows(list, 'jobs:read'), { list })
  check('…and update them', allows(list, 'jobs:update'), { list })
  check('…and look a customer up', allows(list, 'contacts:read'), { list })
  check('…but NOT raise a service call', !allows(list, 'jobs:create'), { list })
  check('…nor add a customer', !allows(list, 'contacts:create'), { list })
  check('…nor read invoices — this is what hides the menu entry', !allows(list, 'invoices:read'), { list })
  check('…nor quotes', !allows(list, 'quotes:read'), { list })
  check('…nor the team roster', !allows(list, 'team:read'), { list })
  check('…nor reports or marketing', !allows(list, 'reports:read') && !allows(list, 'marketing:read'), { list })
  check('…nor company setup, which is what greys out the Settings form', !allows(list, 'company:update'), { list })
  check('…while company:read stays, so they can still SEE the details', allows(list, 'company:read'), { list })
}

console.log('\n── a manager: the work and the money, not the company ──')
{
  const list = (await meAs(manager)).json?.permissions
  check('a manager reads invoices', allows(list, 'invoices:read'), { list })
  check('…and quotes', allows(list, 'quotes:read'), { list })
  check('…and reports', allows(list, 'reports:read'), { list })
  check('…but may not configure the company (so no booking setup, no Settings form)', !allows(list, 'company:update'), { list })
}

console.log('\n── an owner ──')
{
  const list = (await meAs(owner)).json?.permissions
  check('an owner is allowed everything', allows(list, 'invoices:read') && allows(list, 'company:update') && allows(list, 'anything:at:all'), { list })
}

console.log('\n── the grant an owner hands to ONE person ──')
{
  const list = (await meAs(granted)).json?.permissions
  check('the list carries the granted permission, not just the role\'s', allows(list, 'quotes:read'), { list })
  check('…and still refuses what was not granted', !allows(list, 'invoices:read'), { list })
  const plain = (await meAs(staff)).json?.permissions
  check('…while the same role WITHOUT the grant does not have it — the grant is per person', !allows(plain, 'quotes:read'), { plain })
}

console.log(`\nfs-t30-permissions-payload: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
