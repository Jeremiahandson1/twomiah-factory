// CI guard: a migration in the journal will actually RUN on a tenant that already exists.
//
//   Owner, on the vet tenant: "INV-00053 is still duplicated." It was, after a deploy that shipped
//   0034_heal_live_duplicate_invoice_numbers specifically to heal it. The migration was not wrong and
//   did not fail. It was never attempted.
//
// HOW A MIGRATION GETS SILENTLY SKIPPED FOR EVER.
//
// Every tenant boots with `bun db/migrate.ts && bun src/index.ts`, and migrate.ts runs
// `bun x drizzle-kit migrate`, which delegates to drizzle-orm's migrator
// (node_modules/drizzle-kit/bin.cjs → drizzle-orm/node-postgres/migrator). That migrator, in
// drizzle-orm/pg-core/dialect.js, does this:
//
//   lastDbMigration = SELECT id, hash, created_at FROM drizzle.__drizzle_migrations
//                     ORDER BY created_at DESC LIMIT 1          -- read ONCE, before the loop
//   for (const m of migrations)                                 -- journal order
//     if (!lastDbMigration || Number(lastDbMigration.created_at) < m.folderMillis) apply(m)
//
// `folderMillis` is the journal entry's `when`, and the `created_at` values in that table are the
// `when`s that have already been applied. So the rule is: a migration runs only if its `when` is
// ABOVE the highest `when` the tenant has ever applied.
//
// Note that lastDbMigration is read once, before the loop. On a FRESH database every migration
// applies regardless of how its `when` compares to its neighbours — which is why the whole fleet's
// test suites, the sandboxes, and any newly created tenant are all perfectly green while a live
// tenant quietly skips. The fault only appears when a new migration arrives at a tenant that has
// already applied one with a higher `when`, and then it is permanent: that migration can never run
// on that tenant, and no error is ever raised anywhere.
//
// Eleven of the thirteen journals carried hand-written `when` values dated days into the future, and
// in eight templates the newest migration sat below them. Those eight were unreachable on every
// existing tenant: seven copies of `warranty_claim_job` (the column warranty_claim.job_id, which
// db/schema.ts declares and the shared warranties module selects) and crm-vet's 0034.
//
// THE RULE. Within one journal, `when` must strictly increase with `idx`. That is the invariant
// drizzle's watermark design assumes. With it, the applied set is always a prefix in idx order, the
// watermark is always the last applied entry's `when`, and the next entry is always above it.
//
// WHY THIS GUARD DOES NOT ALSO BAN A `when` IN THE FUTURE, which is what caused this. Because it
// cannot be undone from here. A tenant's drizzle.__drizzle_migrations already holds those values and
// is not reachable from this repo; lowering a `when` in the journal would leave the watermark where
// it is and strand everything after it. The future-dated values have to stay, and new migrations
// have to be written above them — so the guard prints the minimum legal `when` for the next entry in
// each journal rather than pretending the dates can be fixed.
//
//   bun scripts/check-migration-journal-applies.ts
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (msg: string) => { console.error(`FAIL: ${msg}`); failed++ }
const asDay = (ms: number) => Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '(not a number)'

// Every journal in the repo, found by walking rather than listed — a list is how a fourteenth
// template joins the fleet with no guard over it.
const journals: string[] = []
const walk = (dir: string, depth = 0) => {
  if (depth > 7) return
  let names: string[] = []
  try { names = readdirSync(dir) } catch { return }
  for (const n of names) {
    if (n === 'node_modules' || n === '.git' || n === 'dist' || n === 'build') continue
    const p = join(dir, n)
    let st; try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, depth + 1)
    else if (n === '_journal.json') journals.push(p)
  }
}
for (const top of ['templates', 'packages', 'apps']) if (existsSync(join(ROOT, top))) walk(join(ROOT, top))

if (journals.length < 10) fail(`only ${journals.length} migration journal(s) found — the walk is not reaching the templates, so this guard is proving nothing`)

const nextLegal: string[] = []
for (const jp of journals.sort()) {
  const rel = jp.slice(ROOT.length).replace(/\\/g, '/')
  let entries: any[]
  try { entries = JSON.parse(readFileSync(jp, 'utf8')).entries || [] } catch (e) {
    fail(`${rel}: cannot be parsed as JSON (${(e as Error).message})`); continue
  }
  if (!entries.length) continue

  // idx must be dense and in order, or "a prefix in idx order" means nothing.
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].idx !== i) fail(`${rel}: entry ${i} has idx ${entries[i].idx} — the journal must be in idx order with no gaps`)
  }

  // THE RULE.
  let runningMax = -Infinity
  for (const e of entries) {
    if (typeof e.when !== 'number' || !Number.isFinite(e.when)) {
      fail(`${rel}: ${e.tag} has when=${JSON.stringify(e.when)}, which is not a number`)
      continue
    }
    if (e.when <= runningMax) {
      fail(`${rel}: ${e.tag} (idx ${e.idx}) has when ${e.when} (${asDay(e.when)}), which is NOT above the ${asDay(runningMax)} already in the journal before it.\n`
        + `      drizzle applies a migration only when its \`when\` is above the highest one the tenant has applied, so this one would be skipped\n`
        + `      for ever on every tenant that already exists — silently, with no error. Set it to at least ${runningMax + 1000}.`)
    }
    runningMax = Math.max(runningMax, e.when)
  }

  // Every .sql on disk is registered, and every registered tag has its .sql. A migration that is in
  // neither place is a migration that does not run, which is the same failure wearing a different hat.
  const dir = jp.replace(/[\\/]meta[\\/]_journal\.json$/, '')
  let onDisk: string[] = []
  try { onDisk = readdirSync(dir).filter(f => f.endsWith('.sql')).map(f => f.replace(/\.sql$/, '')) } catch {}
  for (const e of entries) {
    if (!onDisk.includes(e.tag)) fail(`${rel}: the journal lists "${e.tag}" but ${e.tag}.sql is not on disk`)
  }
  for (const tag of onDisk) {
    if (!entries.some(e => e.tag === tag)) fail(`${rel}: ${tag}.sql is on disk but not in the journal, so it never runs`)
  }

  nextLegal.push(`  ${rel.replace(/^\/?/, '')}  →  next migration needs when > ${runningMax} (${asDay(runningMax)})`)
}

console.log(`${journals.length} migration journal(s) checked.`)
if (failed === 0) {
  console.log('\nThe minimum legal `when` for the NEXT migration in each journal — drizzle-kit generate stamps\n'
    + 'Date.now(), which is below these until real time catches up, so a new entry has to be raised by hand:')
  for (const l of nextLegal) console.log(l)
}
if (failed) { console.error(`\n${failed} failure(s)`); process.exit(1) }
console.log('\nEvery journal strictly increases, and every migration on disk is registered.')
