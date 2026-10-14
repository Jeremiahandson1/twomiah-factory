// CI guard: premium sites keep their data in SQLite on their own disk (db/index.ts), built by the
// migrations in db/migrations (applied at boot by db/migrate.ts). A table or column added to
// db/schema.ts without `bunx drizzle-kit generate` would only fail when a site boots — this fails
// the build instead. And nothing in a premium template may reach for Postgres again.
//
//   bun scripts/check-premium-sqlite.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0, passed = 0
const check = (ok: boolean, m: string) => { if (ok) passed++; else { failed++; console.error('FAIL: ' + m) } }
const read = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n')

const premium = readdirSync(ROOT + 'templates').filter((d) => d.startsWith('website-premium-'))
for (const t of premium) {
  const dir = 'templates/' + t
  const schema = read(dir + '/db/schema.ts')
  const migDir = ROOT + dir + '/db/migrations'
  check(existsSync(migDir + '/meta/_journal.json'), `${dir}: db/migrations/meta/_journal.json missing`)
  if (!existsSync(migDir)) continue
  const sql = readdirSync(migDir).filter((f) => f.endsWith('.sql')).map((f) => readFileSync(migDir + '/' + f, 'utf8')).join('\n')
  // Every table and every column the schema declares is created by some migration.
  for (const m of schema.matchAll(/sqliteTable\('([a-z_0-9]+)',\s*\{([\s\S]*?)\n\}/g)) {
    const [, table, body] = m
    check(new RegExp('CREATE TABLE `' + table + '`').test(sql), `${dir}: table ${table} has no migration (run bunx drizzle-kit generate)`)
    for (const col of body.matchAll(/^\s+\w+: (?:text|integer)\('([a-z_0-9]+)'/gm)) {
      check(new RegExp('`' + col[1] + '`').test(sql), `${dir}: ${table}.${col[1]} has no migration (run bunx drizzle-kit generate)`)
    }
  }
  check(!/drizzle-orm\/pg-core|from 'pg'|node-postgres/.test(schema + read(dir + '/db/index.ts')), `${dir}: db/ still uses Postgres`)
  check(/drizzle-orm\/bun-sqlite/.test(read(dir + '/db/index.ts')), `${dir}: db/index.ts must open the SQLite file`)
  check(!/"pg"/.test(read(dir + '/package.json')), `${dir}: package.json still depends on pg`)
  check(/migrateDb\(\)/.test(read(dir + '/scripts/initDb.ts')), `${dir}: initDb must apply migrations first`)
  check(read(dir + '/db/schema.ts') === read('templates/website-premium-contractor/db/schema.ts'), `${dir}: db/schema.ts differs from the other premium templates`)
}

const deploy = read('apps/api/src/services/deploy.ts')
check(!/siteDbConnectionString|createRenderDatabase\(siteDbName/.test(deploy), 'deploy.ts: premium sites must not get a Postgres of their own')
check(/disk: \{ name: slug \+ '-site-data', mountPath: SITE_PERSISTENT_MOUNT, sizeGB: 1 \},/.test(deploy), 'deploy.ts: every site (premium too) needs its disk — the SQLite file lives on it')
check(/bun run db\/migrate\.ts \|\| \{ echo "\[boot\] FATAL: migrations failed"; exit 1; \}/.test(deploy), 'deploy.ts: premium boot must apply migrations and stop if they fail')

if (failed) { console.error(`\n${failed} failed, ${passed} passed`); process.exit(1) }
console.log(`premium sqlite: ${passed} checks passed`)
