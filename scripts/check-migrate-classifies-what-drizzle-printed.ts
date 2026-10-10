// CI guard: db/migrate.ts tells a cold database from a broken migration by what drizzle-kit PRINTED.
//
//   storetest, 10/10: "Error: connect ECONNREFUSED 10.208.128.94:5432"
//                     "[migrate] A MIGRATION FAILED. This is not a connection problem and retrying will not fix it."
//
// Render starts a new tenant's service before its Postgres accepts connections; migrate.ts retries
// exactly that. But drizzle-kit prints its error and exits 1, and every template ran it with
// stdio 'inherit' — so the caught error said only "Command failed: bun x drizzle-kit migrate", the
// classifier never saw ECONNREFUSED, and EVERY template quit on attempt 1 of a cold boot, calling
// the database a broken migration. A store's first deploy failed outright; the others booted only
// because the start command carries on past migrate, leaving the migrations unapplied.
//
// This runs each template's REAL migrate.ts (with the db/ files beside it) against a stand-in
// `bun` on PATH that replays what drizzle-kit prints, and reads the verdict off its log:
//   - ECONNREFUSED (on stderr, and on stdout)  → "Database not reachable yet, retrying"
//   - a missing journal (not a connection)     → "A MIGRATION FAILED", naming that error
// A source-text rule would pass a script that captures the output and then classifies something
// else; only running it shows what it decides.
//   bun scripts/check-migrate-classifies-what-drizzle-printed.ts
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join, delimiter } from 'node:path'
import { tmpdir } from 'node:os'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const PARKED = new Set(['crm-automotive'])
const templates = readdirSync(join(ROOT, 'templates')).filter((t) => t.startsWith('crm') && !PARKED.has(t) && existsSync(join(ROOT, 'templates', t, 'backend/db/migrate.ts')))
const TMP = mkdtempSync(join(tmpdir(), 'migrate-guard-'))

// the stand-in `bun`: drizzle-kit's real output for each scenario (copied from the storetest boot log)
const BIN = join(TMP, 'bin'); mkdirSync(BIN)
writeFileSync(join(TMP, 'fake-bun.ts'), `
const args = process.argv.slice(2).join(' ')
const s = process.env.FAKE_DRIZZLE
if (!/drizzle-kit migrate/.test(args)) process.exit(0)
const refused = "Error: connect ECONNREFUSED 10.208.128.94:5432\\n    at /opt/render/project/src/backend/node_modules/pg-pool/index.js:45:11\\n  code: 'ECONNREFUSED',\\n"
const head = "No config path provided, using default 'drizzle.config.ts'\\nUsing 'pg' driver for database querying\\n[⣷] applying migrations..."
if (s === 'refused-stderr') { process.stdout.write(head); process.stderr.write(refused); process.exit(1) }
if (s === 'refused-stdout') { process.stdout.write(head + refused); process.exit(1) }
if (s === 'journal') { process.stdout.write(head + "Error: Can't find meta/_journal.json file\\n"); process.exit(1) }
process.exit(0)
`)
const built = Bun.spawnSync([process.execPath, 'build', '--compile', join(TMP, 'fake-bun.ts'), '--outfile', join(BIN, 'bun')], { stdout: 'pipe', stderr: 'pipe' })
if (built.exitCode !== 0) { console.error('could not build the stand-in bun:\n' + built.stderr.toString()); process.exit(1) }

// pg is imported at the top of some migrate scripts; any query must fail fast, never hang
const PG = `class Pool { query() { return Promise.reject(new Error('stub pg: no database')) } connect() { return Promise.reject(new Error('stub pg: no database')) } end() { return Promise.resolve() } on() {} }
class Client extends Pool {}
module.exports = { Pool, Client, default: { Pool, Client } }`

const SCENARIOS = [
  { s: 'refused-stderr', want: /\[migrate\] Database not reachable yet/, wrong: /A MIGRATION FAILED/, label: 'refused connection (stderr) is retried' },
  { s: 'refused-stdout', want: /\[migrate\] Database not reachable yet/, wrong: /A MIGRATION FAILED/, label: 'refused connection (stdout) is retried' },
  { s: 'journal', want: /A MIGRATION FAILED[\s\S]*\[migrate\] Error: Can't find meta\/_journal\.json file/, wrong: /Database not reachable yet/, label: 'a broken migration is named, not retried' },
]

let fail = 0, ran = 0
const runs = templates.flatMap((t) => SCENARIOS.map(async (sc) => {
  const dir = join(TMP, `${t}-${sc.s}`)
  cpSync(join(ROOT, 'templates', t, 'backend/db'), join(dir, 'db'), { recursive: true, filter: (p) => !p.includes('migrations') })
  mkdirSync(join(dir, 'node_modules/pg'), { recursive: true })
  writeFileSync(join(dir, 'node_modules/pg/index.js'), PG)
  writeFileSync(join(dir, 'node_modules/pg/package.json'), '{"name":"pg","main":"index.js"}')
  const p = Bun.spawn([process.execPath, 'db/migrate.ts'], {
    cwd: dir, stdout: 'pipe', stderr: 'pipe',
    env: { ...process.env, PATH: BIN + delimiter + process.env.PATH, FAKE_DRIZZLE: sc.s, DATABASE_URL: 'postgres://u:p@127.0.0.1:1/db' },
  })
  let log = ''
  const read = async (r: ReadableStream) => { for await (const c of r) log += Buffer.from(c).toString() }
  const reading = Promise.all([read(p.stdout as ReadableStream), read(p.stderr as ReadableStream)])
  // the verdict comes on attempt 1; a retry then sleeps, so stop as soon as either verdict is in
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline && !sc.want.test(log) && !sc.wrong.test(log) && p.exitCode === null) await Bun.sleep(100)
  await Bun.sleep(300)
  p.kill(); await Promise.race([reading, Bun.sleep(1000)])
  ran++
  if (sc.want.test(log) && !sc.wrong.test(log)) return
  fail++
  const said = log.split('\n').filter((l) => l.startsWith('[migrate]')).slice(0, 3).join(' / ') || log.slice(0, 200)
  console.error(`FAIL: templates/${t}/backend/db/migrate.ts — ${sc.label}; it said: ${said}`)
}))
await Promise.all(runs)
rmSync(TMP, { recursive: true, force: true })
if (templates.length < 10) { console.error(`migrate classifier: only ${templates.length} templates found — the walk is not reading them`); process.exit(1) }
if (fail) { console.error(`\nmigrate classifier: ${fail} of ${ran} runs decided wrong`); process.exit(1) }
console.log(`migrate classifier: ${ran} runs across ${templates.length} templates — a refused connection is retried, a broken migration is named`)
