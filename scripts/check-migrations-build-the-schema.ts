// CI guard: the migration history, ON ITS OWN, can build the schema.
//
// Every tenant boots with (abbreviated):
//
//   bun db/migrate.ts && … ; … ; bunx drizzle-kit push --force … && bun db/seed.ts && bun src/index.ts
//
// Read that shell carefully: `&&` then `||` then `;`. A failed `bun db/migrate.ts` is swallowed, the
// boot continues, and `drizzle-kit push --force` builds whatever the migrations could not — straight
// from db/schema.ts. The service comes up healthy either way, and db/migrate.ts used to report every
// failure as "Connection failed". So a migration history that cannot build its own schema looks
// exactly like one that can.
//
// It was not one. Replaying each journal against an empty database found migrations referencing
// tables and columns that NO migration creates — only schema.ts, i.e. only push:
//
//   crm-vet        0029  indexed visit.invoice_id; `visit` is created in 0016 without it
//   crm-roof       0016  REFERENCES "document"("id"); no migration creates `document`
//   crm-dispensary 0009  ALTER TABLE kiosk_sessions
//   crm-dispensary 0011  ALTER TABLE "batches"
//   crm-dispensary 0015  ALTER TABLE "mfa_challenges"
//   crm-dispensary 0016  the same table again, in DO blocks that caught undefined_object but not
//                        undefined_table
//
// A run is ONE transaction, so the first of these also stranded every migration after it, for ever,
// on any database built from migrations alone. That is every brand-new tenant. The nine tenants
// alive today all report "[migrate] Success" because they applied these long ago, when a previous
// boot's push had already made the tables — so the fault was invisible on every existing tenant and
// waiting for the next one. crm-vet is what it looks like when it finally bites: migrations dead
// since 2026-10-03, INV-00053 surviving three deploys that each shipped its fix.
//
// THE RULE. Replay every journal in order against a fresh PGlite database. Every statement must
// apply. Unlike production this does not stop at the first failure, so one run lists them all.
//
// This is the companion to check-migration-statements-parse (does each statement PARSE) and
// check-migration-journal-applies (will each migration ever be REACHED). This one asks whether it
// WORKS.
//
//   bun scripts/check-migrations-build-the-schema.ts [template]
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const ONLY = process.argv[2] || ''
// Built in pieces so this file does not split itself if it is ever read by the same rule.
const BREAKPOINT = '--' + '> ' + 'statement-breakpoint'

const templates = readdirSync(`${ROOT}templates`)
  .filter(t => existsSync(`${ROOT}templates/${t}/backend/db/migrations/meta/_journal.json`))
  .filter(t => !ONLY || t === ONLY)
  .sort()

let failed = 0
if (templates.length < 10 && !ONLY) {
  console.error(`FAIL: only ${templates.length} template(s) with a journal found — the walk is not reaching them`)
  failed++
}

let statementsChecked = 0
for (const t of templates) {
  const dir = `${ROOT}templates/${t}/backend/db/migrations`
  const entries: any[] = JSON.parse(readFileSync(`${dir}/meta/_journal.json`, 'utf8')).entries || []
  const pg = new PGlite()
  await pg.waitReady
  const problems: string[] = []

  for (const e of entries) {
    const file = `${dir}/${e.tag}.sql`
    if (!existsSync(file)) { problems.push(`${e.tag}: the .sql file is not on disk`); continue }
    for (const stmt of readFileSync(file, 'utf8').split(BREAKPOINT).map(s => s.trim()).filter(Boolean)) {
      statementsChecked++
      try {
        await pg.exec(stmt)
      } catch (err: any) {
        problems.push(`${e.tag}: ${String(err?.message ?? err).split('\n')[0]}\n`
          + `        ${stmt.replace(/\s+/g, ' ').slice(0, 150)}`)
      }
    }
  }
  await pg.close()

  if (!problems.length) { console.log(`ok   ${t.padEnd(18)} ${entries.length} migration(s) applied to an empty database`); continue }
  failed += problems.length
  console.error(`FAIL ${t}: the migration history cannot build its own schema`)
  for (const p of problems) console.error(`      ${p}`)
  console.error(`      A tenant built from migrations alone stops at the first of these and never applies anything after it.`)
  console.error(`      If the table or column belongs to db/schema.ts and no migration creates it, guard the statement:`)
  console.error(`        DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='x') THEN … END IF; END $$;`)
}

console.log(`\n${templates.length} template(s), ${statementsChecked} statement(s) replayed against an empty database.`)
if (failed) { console.error(`\n${failed} failure(s)`); process.exit(1) }
console.log('Every migration history builds its own schema with no help from drizzle-kit push.')
