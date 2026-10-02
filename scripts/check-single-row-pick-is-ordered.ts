// CI guard: "the one company/shop in this database" must be picked with an ORDER BY.
//
// WHY THIS EXISTS. `db.select().from(company).limit(1)` returns whichever row Postgres hands back
// first. A tenant database normally holds one company — but several live tenants hold a second from
// an old round, and on those the row you get is not the one anybody signs in to.
//
// It was found three times in one day (T37/T40), each time silent:
//
//   · POST /api/internal/sync-features answered 200 {"success":true,"features":[43 of them]} while
//     the company everyone signs in to still had 19. A feature a customer PAID FOR silently never
//     turns on, and the response says it did. Proven on lndtest: sync reported 43, three logins a
//     minute apart all reported 19, same company id every time — not the 15s feature cache.
//   · The dispensary PIN resolution refused with "this server holds more than one shop" on the live
//     tenant after passing every sandbox test.
//   · routes/menu.ts had already hit it and already fixed it, and its comment is the rule:
//     "a tenant database is one dispensary; a second row is QA debris or an enterprise import, and
//      either way the seeded shop is the oldest. 'Exactly one row' was the first version of this and
//      it was too strict."
//
// So the rule is: the seeded company is the OLDEST, and the pick must say so. Either order by
// createdAt, or scope the query to a known id — never take an arbitrary first row.
//
// This is deliberately narrow. It does not police every `.limit(1)`: a query already filtered to one
// id, slug or token is fine, and so is one ordered by anything. It polices the specific shape "give
// me a company/shop and I don't care which", which is never what the caller means.
//
//   bun scripts/check-single-row-pick-is-ordered.ts
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { stripSource as strip } from './lib/stripComments.ts'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

/** PARKED templates are not modified anywhere in this repo and are not held to this either. */
const PARKED = /templates[\\/](crm-automotive|crm-homecare)[\\/]/

const files: string[] = []
const walk = (dir: string) => {
  if (!existsSync(dir)) return
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (!/node_modules|dist|shared|migrations|frontend-dist/.test(e.name)) walk(p) }
    else if (e.name.endsWith('.ts')) files.push(p)
  }
}
for (const tpl of readdirSync(join(ROOT, 'templates'))) walk(join(ROOT, 'templates', tpl, 'backend'))
walk(join(ROOT, 'packages', 'tenant-backend', 'src'))

/**
 * The shape being refused, on ONE line so the match is unambiguous:
 *
 *   .from(company).limit(1)          .from(t.company).limit(1)
 *   .from(company).limit( 1 )        with a select({...}) in front — all the same thing
 *
 * `.where(...)` anywhere between the from and the limit means the caller named which row it wants,
 * and `orderBy` means it said which order — both are fine.
 */
const OFFENDER = /\.from\(\s*(?:[A-Za-z_$][\w$]*\.)?compan(?:y|ies)\s*\)((?:(?!\.limit\()[^\n])*)\.limit\(\s*1\s*\)/g

let checked = 0, picks = 0
for (const file of files) {
  if (PARKED.test(file)) continue
  const raw = readFileSync(file, 'utf8')
  if (!/\.from\(\s*(?:[A-Za-z_$][\w$]*\.)?compan/.test(raw)) continue
  checked++
  const src = strip(raw).replace(/\r\n/g, '\n')
  const lines = src.split('\n')

  lines.forEach((line, i) => {
    for (const m of line.matchAll(OFFENDER)) {
      picks++
      const between = m[1] || ''
      if (/\.where\(/.test(between) || /\.orderBy\(/.test(between)) continue
      fail(`${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1}: picks a company with \`.limit(1)\` and neither \`.where\` nor \`.orderBy\` — on a tenant carrying a second company row this silently reads or WRITES the wrong one, which is how sync-features answered 200 while changing nothing. Add \`.orderBy(asc(company.createdAt))\` (the seeded company is the oldest, as routes/menu.ts's resolveSlug already does) or scope it with \`.where\`.`)
    }
  })
}

if (failed) {
  console.error(`\nsingle-row company pick: ${failed} unordered pick(s).`)
  process.exit(1)
}
console.log(`single-row company pick: ${picks} single-row company select(s) across ${checked} file(s); every one is scoped by \`.where\` or ordered by \`.orderBy\``)
