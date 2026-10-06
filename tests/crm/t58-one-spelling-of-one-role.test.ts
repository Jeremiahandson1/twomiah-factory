// T58 — "'field' and 'user' both show as 'Staff'."
//
// They do, and the label is right: `user` and `field` are not two roles that share a name, they are
// one role with two spellings. The permission layer has folded `user → field` before resolving
// anything for as long as it has existed. What is wrong is that the API reports the distinction.
//
// T51 fixed the WRITE path — create and edit both store `field` — and that is why this came back:
// a write-path fix converges the data only as fast as somebody edits each person. Measured on the
// live fleet on 2026-10-06, all ten test tenants still held `user` rows, and contractor held BOTH
// spellings at once (field:3, user:1). Four people on one Team page, every one of them correctly
// labelled "Staff", with stored roles that disagree.
//
// So the read answers one word too. Asserted here against rows inserted with the LEGACY spelling,
// because a fixture that only ever writes the new word cannot catch the bug, and writing such a
// fixture is how this shipped the first time.
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
const { eq } = await import('drizzle-orm')

const [co] = await db.insert(company).values({
  name: 'One Spelling', slug: 'one-spelling', email: 'os@test.local', state: 'OH', settings: {},
  enabledFeatures: ['team'],
} as any).returning()
const mk = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-os@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true,
} as any).returning())[0]

const owner = await mk('owner', 'owner')
const legacy = await mk('user', 'legacy')   // the row that was already there
const modern = await mk('field', 'modern')  // the row T51 would write today

const app = new Hono()
app.route('/api/company', (await import('./src/routes/company.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const asOwner = as(owner)
const storedRole = async (id: string) => (await db.select().from(user).where(eq(user.id, id)).limit(1))[0]?.role
const rowsOf = (j: any): any[] => (Array.isArray(j) ? j : j?.data || [])

// ══════════ 1. the roster reports one word ══════════════════════════════════════════════════════
{
  const list = await asOwner('GET', '/api/company/users')
  check('the owner can list the team', list.status === 200, list)
  const rows = rowsOf(list.json)

  const spellings = [...new Set(rows.map((r: any) => r.role))].sort()
  check('no row is reported with the legacy spelling', !spellings.includes('user'), spellings)

  const a = rows.find((r: any) => r.id === legacy.id)
  const b = rows.find((r: any) => r.id === modern.id)
  check('the legacy row reads as field', a?.role === 'field', a)
  check('the row written today reads as field', b?.role === 'field', b)
  check('…so two people doing the same job are reported the same way', a?.role === b?.role, [a?.role, b?.role])

  // This is the part the owner can see. One label was never the problem — two roles behind it was.
  if (a?.roleLabel !== undefined || b?.roleLabel !== undefined) {
    check('…and they carry the same label', a?.roleLabel === b?.roleLabel, [a?.roleLabel, b?.roleLabel])
  }
}

// ══════════ 2. and the stored row is untouched — this is a read fix, not a migration ═════════════
{
  check('reading the list does not rewrite anybody', (await storedRole(legacy.id)) === 'user',
    await storedRole(legacy.id))
}

// ══════════ 3. an edit that does not mention the role still answers the canonical one ════════════
{
  const r = await asOwner('PUT', `/api/company/users/${legacy.id}`, { firstName: 'Renamed' })
  check('the edit succeeds', r.status === 200, r)
  check('…and the response says field, not user', r.json?.role === 'field', r.json)
}

// ══════════ 4. the legacy word is still ACCEPTED on the way in, and stored canonically ═══════════
{
  const r = await asOwner('POST', '/api/company/users', {
    email: 'oldclient-os@test.local', password: 'TestPass123!', firstName: 'Old', lastName: 'Client', role: 'user',
  })
  check('a caller still sending role:user is not refused', r.status === 201, r)
  check('…the response says field', r.json?.role === 'field', r.json)
  check('…and that is what was stored', (await storedRole(r.json?.id)) === 'field', await storedRole(r.json?.id))
}

// ══════════ 5. every other role is reported exactly as it is ════════════════════════════════════
{
  const mgr = await mk('manager', 'mgr')
  const vwr = await mk('viewer', 'vwr')
  const rows = rowsOf((await asOwner('GET', '/api/company/users')).json)
  const roleFor = (u: any) => rows.find((r: any) => r.id === u.id)?.role
  check('manager is untouched', roleFor(mgr) === 'manager', roleFor(mgr))
  check('viewer is untouched', roleFor(vwr) === 'viewer', roleFor(vwr))
  check('owner is untouched', roleFor(owner) === 'owner', roleFor(owner))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
