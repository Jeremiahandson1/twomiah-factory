// Does the sandbox assemble for crm-dispensary at all?
//
// This template is much bigger than salon or field service — ~50 tables of migrations and a forked
// permission matrix — so before writing behaviour tests it is worth proving the schema applies, a
// company and users insert, and its OWN permissions middleware loads and answers. If this file
// fails, nothing else in the suite means anything.
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()
check('migrations apply', true)

const [co] = await db.insert(company).values({
  name: 'Smoke Dispensary', slug: 'smokedisp', email: 'smoke@test.local',
  settings: {}, enabledFeatures: ['orders', 'products', 'contacts'],
} as any).returning()
check('a company inserts', !!co?.id, { id: co?.id })

const [u] = await db.insert(user).values({
  email: 'smoke-owner@test.local', passwordHash: 'x', firstName: 'Smoke', lastName: 'Owner',
  role: 'owner', companyId: co.id,
} as any).returning()
check('a user inserts', !!u?.id, { id: u?.id })

// dispensary's OWN matrix, not the shared one — this is the thing the suite exists to exercise.
const perms = await import('./src/middleware/permissions.ts')
check('its forked permissions middleware loads', typeof perms.requirePermission === 'function')
check('ROLE_HIERARCHY is the cannabis one', Array.isArray(perms.ROLE_HIERARCHY)
  && perms.ROLE_HIERARCHY.join(',') === 'viewer,driver,budtender,manager,admin,owner', perms.ROLE_HIERARCHY)
check('user maps to budtender', perms.normalizeRole('user') === 'budtender', perms.normalizeRole('user'))
check('an unknown role falls back to viewer', perms.normalizeRole('') === 'viewer', perms.normalizeRole(''))
check('budtender cannot approve financing', perms.hasPermission('budtender', 'cash:delete') === false)
check('admin holds the knowledge base (the 1394c506 regression)',
  perms.hasPermission('admin', 'support-kb:update') === true)

console.log(`\ndispensary-smoke: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
