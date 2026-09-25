// Field Service T29 M1 — "the client portal can still be turned on, and it shows its card tab."
//
// That finding had two halves and I fixed one. The Payment Method tab became a gated section, and the
// switch that CREATES the portal link went on answering 200 — so a tenant without Client Portal could
// still turn it on for a customer and email them in. Gating what is behind a door and leaving the door
// open is the same half-fix as hiding a nav item while its API keeps answering.
//
// Both doors are tested: enable, and regenerate (the way back in).
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

await setupSchema()

const app = new Hono()
app.route('/api/portal', (await import('./src/routes/portal.ts')).default)
app.onError(errorHandler)

const mk = async (slug: string, features: string[]) => {
  const [co] = await db.insert(company).values({ name: 'T29 ' + slug, slug, email: `${slug}@test.local`, settings: {}, enabledFeatures: features } as any).returning()
  const [owner] = await db.insert(user).values({ email: `owner-${slug}@test.local`, passwordHash: 'x', firstName: 'Ada', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
  const [cust] = await db.insert(contact).values({ type: 'client', name: 'Portal Customer', email: `cust-${slug}@test.local`, companyId: co.id } as any).returning()
  return { co, owner, cust }
}
const call = async (who: any, co: any, path: string) => {
  const res = await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': co.id, 'x-test-role': who.role } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

console.log('\n── with Client Portal OFF ──')
{
  const { co, owner, cust } = await mk('t29portal-off', ['jobs', 'contacts', 'invoices'])
  const on = await call(owner, co, `/api/portal/contacts/${cust.id}/enable`)
  check('turning the portal on is refused', on.status === 403, { status: on.status, body: on.json })
  check('…and says the module is off rather than failing as a permission error', /FEATURE_NOT_ENABLED/.test(JSON.stringify(on.json)), on.json)

  const again = await call(owner, co, `/api/portal/contacts/${cust.id}/regenerate`)
  check('and so is reissuing a link — the way back in', again.status === 403, { status: again.status })

  const [row] = await db.select().from(contact).where(eq(contact.id, cust.id))
  check('no link was minted for the customer', !row?.portalEnabled && !row?.portalToken, { portalEnabled: row?.portalEnabled, hasToken: !!row?.portalToken })
}

console.log('\n── with Client Portal ON ──')
{
  const { co, owner, cust } = await mk('t29portal-on', ['jobs', 'contacts', 'invoices', 'client_portal'])
  const on = await call(owner, co, `/api/portal/contacts/${cust.id}/enable`)
  check('the portal can be turned on', on.status === 200, { status: on.status, body: on.json })
  check('…and the customer gets a link', typeof on.json?.portalUrl === 'string' && on.json.portalUrl.length > 0, { portalUrl: on.json?.portalUrl })
  const again = await call(owner, co, `/api/portal/contacts/${cust.id}/regenerate`)
  check('…and it can be reissued', again.status === 200, { status: again.status })
}

console.log(`\nfs-t29-portal-gate: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
