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

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
