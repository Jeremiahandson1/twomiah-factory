// The audit log names a record by the singular of its mount: /api/email-aliases → email_alias. (10/14) The rule
// stripped a trailing "s", so the Audit Log filter offered "Email aliase (2)". Both copies of the rule are checked —
// crm's own middleware and the shared write floor every other template uses — and the -ase words keep their e.
const { entityFromPath: crmEntity } = await import('./src/middleware/auditWrites.ts')
// the shared floor as the tenant runs it: vendored into src/shared at generation
const { entityFromPath: sharedEntity } = await import('./src/shared/audit/writeFloor.ts')

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const CASES: Array<[string, string]> = [
  ['/api/email-aliases', 'email_alias'],
  ['/api/email-aliases/0b6f7c1e-2a8f-4f4e-9d65-0c2d1b7a9f11', 'email_alias'],
  ['/api/purchases', 'purchase'],
  ['/api/warranties', 'warranty'],
  ['/api/invoices', 'invoice'],
  ['/api/expenses', 'expense'],
  ['/api/batches', 'batch'],
  ['/api/passes', 'pass'],
]
for (const [path, want] of CASES) {
  for (const [name, fn] of [['crm', crmEntity], ['shared', sharedEntity]] as const) {
    const got = fn(path)
    check(`${name}: ${path} → ${want}`, got === want, { got })
  }
}

// The rows written BEFORE the fix keep "email_aliase", and the filter lists what is stored (re-test, 10/14).
// The migration corrects them — and only them — and running it twice changes nothing.
{
  const { setupSchema } = await import('./setup.ts')
  await setupSchema()
  const { db } = await import('./db/index.ts')
  const { company, auditLog } = await import('./db/schema.ts')
  const { eq, sql } = await import('drizzle-orm')
  const { readFileSync } = await import('node:fs')
  const [co] = await db.insert(company).values({ name: 'Alias Co', slug: 'alias-co', email: 'a@test.local', settings: {}, enabledFeatures: [] } as any).returning()
  const row = (entity: string, description: string) => ({ companyId: co.id, action: 'update', entity, metadata: { description, method: 'PUT', path: '/api/email-aliases/x', via: 'request' } } as any)
  await db.insert(auditLog).values([row('email_aliase', 'Changed — email aliase'), row('email_alias', 'Changed — email alias'), row('purchase', 'Changed — purchase')])
  const migration = readFileSync('./db/migrations/0043_audit_email_alias.sql', 'utf8')
  const run = async () => { for (const stmt of migration.split('--> statement-breakpoint')) await db.execute(sql.raw(stmt)) }
  await run(); await run()
  const rows = await db.select().from(auditLog).where(eq(auditLog.companyId, co.id))
  check('the migration leaves no "email_aliase" row', !rows.some((r: any) => r.entity === 'email_aliase'), rows.map((r: any) => r.entity))
  check('…corrects the description it carried', rows.filter((r: any) => r.entity === 'email_alias').every((r: any) => (r.metadata as any)?.description === 'Changed — email alias'), rows.map((r: any) => r.metadata))
  check('…and touches no other row', rows.some((r: any) => r.entity === 'purchase' && (r.metadata as any)?.description === 'Changed — purchase'))
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
