// CI guard: "Export everything" really is everything (2026-10-28, twomiah.com's claim).
//
// The export is built from the Drizzle schema (apps/unified/server/data/exportAll.ts). A table added to the schema must
// be exportable for one business — it carries company_id, hangs off a table that does, or is named in WHOLE_TABLE — or
// be named in LEFT_OUT with the reason it is not the business's data. Anything else fails here, so a new table cannot
// quietly stay out of the export. Also: no exported column may look like a secret (password, token, key).
//   bun scripts/check-unified-export-everything.ts
import { exportPlan, isSecretColumn, LEFT_OUT } from '../apps/unified/server/data/exportAll.ts'

const plan = exportPlan()
let failed = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }
if (plan.length < 300) fail(`only ${plan.length} tables found — fix this guard's schema import`)
for (const p of plan) if (p.how === 'unclassified') fail(`table "${p.table}" cannot be scoped to one business: give it company_id, a foreign key to a scoped table, or name it in WHOLE_TABLE / LEFT_OUT (server/data/exportAll.ts)`)
for (const t of Object.keys(LEFT_OUT)) if (!plan.some((p) => p.table === t)) fail(`LEFT_OUT names "${t}", which is not a table`)
if (!isSecretColumn('password_hash') || !isSecretColumn('refresh_token') || isSecretColumn('email')) fail('isSecretColumn no longer tells a secret from a field')
if (failed) { console.error(`\nexport everything: ${failed} problem(s)`); process.exit(1) }
console.log(`export everything: ${plan.length} tables — ${plan.filter((p) => p.how === 'left-out').length} left out on purpose, the rest exported for one business`)
