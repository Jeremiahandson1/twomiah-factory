// Field Service T28 M1 — Documents answered 201 with the feature switched off.
//
// `documents` is an optional feature the registry DOES offer this vertical, but the API was mounted with
// no gate and the sidebar entry carried no `features`, so both behaved as though the module were core: the
// nav showed Documents to a tenant without it, and an upload succeeded.
//
// The gate has to be exercised through the app the way index.ts mounts it — the route file itself has no
// opinion about features, which is exactly why "the route looks fine" was never evidence.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'
import { requireEnabledFeature } from './src/middleware/enabledFeature.ts'
import { authenticate } from './src/middleware/auth.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

await setupSchema()

const mk = async (slug: string, features: string[]) => {
  const [co] = await db.insert(company).values({ name: 'T28 ' + slug, slug, email: `${slug}@test.local`, settings: {}, enabledFeatures: features } as any).returning()
  const [owner] = await db.insert(user).values({ email: `owner-${slug}@test.local`, passwordHash: 'x', firstName: 'Ada', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
  return { co, owner }
}

// Mounted the way index.ts mounts it: the gate is middleware in front of the route, not inside it.
const app = new Hono()
app.use('/api/documents', authenticate, requireEnabledFeature('documents'))
app.use('/api/documents/*', authenticate, requireEnabledFeature('documents'))
app.route('/api/documents', (await import('./src/routes/documents.ts')).default)
app.onError(errorHandler)

const call = async (who: any, co: any, method: string, path: string) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': co.id, 'x-test-role': who.role } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

console.log('\n── with the feature OFF ──')
{
  const { co, owner } = await mk('t28docs-off', ['jobs', 'contacts', 'invoices'])
  const list = await call(owner, co, 'GET', '/api/documents')
  check('listing documents is refused', list.status === 403, { status: list.status, body: list.json })
  check('…and says why, rather than failing as a validation error', /feature/i.test(JSON.stringify(list.json)), list.json)
  const upload = await call(owner, co, 'POST', '/api/documents')
  check('uploading is refused too — the API is the only gate the mobile app meets', upload.status === 403, { status: upload.status })
}

console.log('\n── with the feature ON ──')
{
  const { co, owner } = await mk('t28docs-on', ['jobs', 'contacts', 'invoices', 'documents'])
  const list = await call(owner, co, 'GET', '/api/documents')
  check('listing documents is allowed', list.status === 200, { status: list.status, body: list.json })
}

console.log(`\nfs-t28-documents-gate: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
