// CI guard for dispensary kiosk tenant isolation. The kiosk is unauthenticated, so it resolves the
// tenant's company itself. It once did `SELECT id FROM company LIMIT 1` with no ORDER BY — when a DB
// held a leftover demo company that arbitrary pick served a STRANGER's menu and dropped every kiosk
// order into the wrong company. Resolution must be deterministic and scoped to the company that owns
// the owner/admin account (a seed-only demo company has no users).
//   bun scripts/check-kiosk-tenant-isolation.ts
import { readFileSync } from 'node:fs'

const file = 'templates/crm-dispensary/backend/src/routes/kiosk.ts'
const raw = readFileSync(new URL('../' + file, import.meta.url), 'utf8')
// Strip line + block comments so the guard checks real code, not prose describing the old bug.
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// The ambiguous, order-less pick must not come back.
if (/FROM\s+company\s+LIMIT/i.test(src)) fail(`${file}: resolves the tenant company with an unordered \`FROM company LIMIT 1\` — arbitrary across a multi-company DB`)
// Resolution must be scoped to the account owner (deterministic, demo-company-proof).
if (!/role\s+IN\s*\(\s*'owner'\s*,\s*'admin'\s*\)/i.test(src)) fail(`${file}: kiosk must resolve the tenant company via the owner/admin account, not an arbitrary row`)

if (failed) { console.error(`\nkiosk tenant isolation: ${failed} check(s) FAILED`); process.exit(1) }
console.log('kiosk tenant isolation: company is resolved by the owner account, never an arbitrary row')
