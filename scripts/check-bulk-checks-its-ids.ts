// CI guard: a bulk operation must check its id list before using it.
//
// ── why this guard exists ───────────────────────────────────────────────────────────────────────
//
// bulk.ts has fifteen handlers. TWO of them checked their id list:
//
//     const { ids } = await c.req.json()
//     if (!ids?.length) return c.json({ error: 'No IDs provided' }, 400)
//
// The other thirteen were copied from them without the second line, in all eight templates that
// carry the file — 80 handlers. Two consequences, one loud and one quiet:
//
//   · loud: an empty list builds `IN ()`, Postgres answers "syntax error at or near $1", and the
//     route 500s on a request that deserved a 400. That is how the contract test found it.
//   · quiet, and worse: a bulk DELETE or a bulk mark-paid with an empty list — the request a screen
//     sends when nothing is selected — reached the database and matched nothing. No error, no
//     refusal, no rows. The user is told it worked.
//
// Nothing tested bulk.ts in any template before the shared contract test existed, which is how a
// 13-of-15 miss survived a clone into eight products.
//
// ── the rule ────────────────────────────────────────────────────────────────────────────────────
//
// In any routes/bulk.ts, a handler that destructures a name ending in `ids` from the request body
// must guard it before the next statement runs.
//
//   bun scripts/check-bulk-checks-its-ids.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

let files = 0, handlers = 0
for (const t of readdirSync(join(ROOT, 'templates'))) {
  const f = join(ROOT, 'templates', t, 'backend/src/routes/bulk.ts')
  if (!existsSync(f)) continue
  files++
  const src = readFileSync(f, 'utf8')
  for (const block of src.split(/(?=app\.(?:post|put|patch|delete)\(')/)) {
    const m = block.match(/^app\.(?:post|put|patch|delete)\('([^']+)'/)
    if (!m) continue
    const route = m[1]
    const d = block.match(/const \{([^}]*)\} = await c\.req\.json\(\)/)
    if (!d) continue
    const listName = d[1].split(',').map((s) => s.trim().split(':')[0].trim()).find((n) => /ids$/i.test(n))
    if (!listName) continue
    handlers++
    const guarded = new RegExp(
      `!${listName}\\?\\.length|!${listName}\\s*\\|\\||${listName}\\.length === 0|!Array\\.isArray\\(${listName}\\)`,
    ).test(block)
    if (!guarded) {
      fail(`${t}: bulk ${route} destructures \`${listName}\` and uses it without checking it — an empty list builds \`IN ()\` (a 500 instead of a 400), and a bulk write with nothing selected silently matches no rows. Add: if (!${listName}?.length) return c.json({ error: 'No IDs provided' }, 400)`)
    }
  }
}

if (files === 0) fail('no routes/bulk.ts was found — this guard has stopped looking at anything')
console.log(failed === 0
  ? `OK: ${files} bulk file(s), ${handlers} handler(s) — every id list is checked before use`
  : `${failed} problem(s)`)
process.exit(failed ? 1 : 0)
