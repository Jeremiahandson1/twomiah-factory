// Does the sandbox assemble for crm-homecare, and is the no-op stub really gone?
//
// homecare shipped middleware/permissions.ts as a pass-through: requirePermission and requireRole
// each did nothing but call next(). It existed so route files vendored from the contractor CRM would
// import cleanly, and the effect was that leads.ts carried nine gates that read exactly like the real
// thing and enforced nothing. f8c2b608 deleted it. This asserts the deletion held, because a file
// that quietly returns next() is worse than no file: the next person to vendor a contractor route in
// would get silent no-ops again and a green build.
//
// Note the table names. homecare is its own archetype — `agencies` and `users`, not `company` and
// `user` — which is half the reason it needs its own auth stub.
import { existsSync } from 'node:fs'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { agencies, users } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()
check('migrations apply', true)

const [ag] = await db.insert(agencies).values({ name: 'Smoke Care Agency', slug: 'smokecare' } as any).returning()
check('an agency inserts', !!ag?.id, { id: ag?.id })

const [u] = await db.insert(users).values({
  email: 'smoke-admin@test.local', passwordHash: 'x', firstName: 'Smoke', lastName: 'Admin', role: 'admin',
} as any).returning()
check('a user inserts', !!u?.id, { id: u?.id })

// The stub must stay deleted. Checked on disk, because a failed import is exactly the outcome we
// want if someone re-adds it and wires it up.
check('the no-op permissions stub is gone', !existsSync('./src/middleware/permissions.ts'))

// requireAdmin is the whole authorisation model here, and it must actually refuse.
const auth = await import('./src/middleware/auth.ts')
check('requireAdmin exists', typeof auth.requireAdmin === 'function')

const run = async (role: string) => {
  let passedThrough = false
  const c: any = {
    get: (k: string) => (k === 'user' ? { userId: 'u', role } : undefined),
    json: (b: any, s: number) => ({ __status: s, body: b }),
  }
  const res = await auth.requireAdmin(c, async () => { passedThrough = true })
  return { passedThrough, status: (res as any)?.__status }
}
check('requireAdmin lets an admin through', (await run('admin')).passedThrough === true)
check('requireAdmin lets an owner through', (await run('owner')).passedThrough === true)
const cg = await run('caregiver')
check('requireAdmin refuses a caregiver with 403', cg.passedThrough === false && cg.status === 403, cg)
const none = await run('')
check('requireAdmin refuses an unknown role', none.passedThrough === false && none.status === 403, none)

console.log(`\nhomecare-smoke: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
