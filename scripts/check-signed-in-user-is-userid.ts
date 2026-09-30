// CI guard: the signed-in user's id is `userId`, and nothing reads `.id` off that object.
//
// ── why this guard exists ───────────────────────────────────────────────────────────────────────
//
// The shared auth middleware (packages/tenant-backend/src/auth/middleware.ts) puts this on the
// request context:
//
//     c.set('user', { userId, companyId, email, role })
//
// There is no `id`. Reading `currentUser.id` therefore yields undefined, and undefined does not
// throw — it goes quietly into whatever it was reaching for:
//
//   · in a column, it lands as NULL. "Voided by —", "Created by —", forever, on every row;
//   · in a WHERE clause, drizzle's eq(col, undefined) matches nothing, so a screen that filters by
//     "mine" shows an empty list and looks like a permissions problem.
//
// Found while closing T52 M5: the new cancelled_by wrote NULL, and the same sweep turned up two
// live ones nobody had reported — crm-rv's alerts route filtered a salesperson's alerts by
// `currentUser.id` in four places (so every salesperson saw none of their own alerts), and the base
// CRM stamped every purchase order's createdById as NULL. Neither fails loudly, which is exactly
// why a guard and not a fix.
//
// The type would catch this if the context were typed, but every route reads it as `as any` — 2,515
// of them across the templates — and that is not a thing to change in a QA round. This is the cheap
// version of that type.
//
//   bun scripts/check-signed-in-user-is-userid.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// crm-automotive is PARKED and not to be modified, so it is not swept.
const SKIP = new Set(['node_modules', 'dist', 'build', '.git', 'crm-automotive'])

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (SKIP.has(e)) continue
    const p = join(dir, e)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (e.endsWith('.ts') && !e.endsWith('.d.ts')) out.push(p)
  }
  return out
}

/** Comments stripped: a rule about code must not be tripped by prose (this file included). */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const roots = [
  join(ROOT, 'packages/tenant-backend/src'),
  ...readdirSync(join(ROOT, 'templates')).filter((t) => !SKIP.has(t)).map((t) => join(ROOT, 'templates', t, 'backend/src')),
]

// The names routes give the object they read out of the context.
const HOLDERS = ['currentUser', 'authUser', 'reqUser', 'sessionUser']
const pattern = new RegExp(`\\b(${HOLDERS.join('|')})\\.id\\b`, 'g')

let scanned = 0
for (const root of roots) {
  for (const file of walk(root)) {
    scanned++
    const src = code(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))
    const lines = src.split('\n')
    lines.forEach((line, i) => {
      for (const m of line.matchAll(pattern)) {
        fail(`${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1} reads \`${m[1]}.id\`. The signed-in user carries \`userId\`; \`.id\` is undefined and lands as NULL in a column or matches nothing in a WHERE. Use \`${m[1]}.userId\`. (T52 M5)`)
      }
    })
  }
}

// …and the contract this is all about has to still be the contract. If the shared middleware starts
// setting `id`, this guard is the wrong rule and should be deleted rather than worked around.
{
  const mw = code(readFileSync(join(ROOT, 'packages/tenant-backend/src/auth/middleware.ts'), 'utf8'))
  if (!/c\.set\('user',\s*\{\s*userId:/.test(mw)) {
    fail('packages/tenant-backend/src/auth/middleware.ts no longer sets the context user as { userId, … }. If the shape changed, this guard is now wrong — update or delete it, do not work around it.')
  }
  if (/c\.set\('user',\s*\{[^}]*\bid:/.test(mw)) {
    fail('the shared middleware now puts an `id` on the context user as well as `userId`. Two names for one fact is how this bug happens; pick one.')
  }
}

console.log(failed ? `\n${failed} failure(s)` : `ok: ${scanned} backend file(s), none reading .id off the signed-in user`)
process.exit(failed ? 1 : 0)
