// Run the salon suite against a sandbox assembled from THIS tree.
//
//   bun tests/salon/harness/run.ts            # all of it
//   bun tests/salon/harness/run.ts t30        # only files whose name contains "t30"
//   KEEP=1 bun tests/salon/harness/run.ts     # leave the sandbox behind to poke at
//
// The sandbox is a generated tenant: templates/crm-salon/backend, with packages/tenant-backend/src
// vendored in as src/shared exactly the way the Factory does it, and three files replaced:
//
//   db/index.ts             the node-postgres Pool → an in-process PGlite, so the REAL routes and the
//                           REAL shared code run against a real SQL engine rather than mocks
//   src/middleware/auth.ts  bearer verification → an x-test-user header. The PERMISSION layer stays
//                           real, which is the half these tests care about
//   setup.ts                applies the tenant's own migrations in journal order, then the boot
//                           reconcile — the same schema path a Render boot takes
//
// Assembling it per run rather than committing it is the point: the suite cannot drift away from the
// templates it is testing, and no generated code lands in git.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const HERE = ROOT + 'tests/salon'
const TEMPLATE = ROOT + 'templates/crm-salon/backend'
const SHARED = ROOT + 'packages/tenant-backend/src'
const filter = process.argv[2] || ''

for (const [what, path] of [['template', TEMPLATE], ['shared package', SHARED]] as const) {
  if (!existsSync(path)) { console.error(`FAIL: no ${what} at ${path}`); process.exit(1) }
}

const SB = mkdtempSync(join(tmpdir(), 'salon-suite-'))
const cleanup = () => { if (!process.env.KEEP) rmSync(SB, { recursive: true, force: true }) }
process.on('exit', cleanup)

console.log(`assembling a sandbox in ${SB}`)
cpSync(TEMPLATE, SB, { recursive: true, filter: (src) => !/node_modules|[\\/]dist([\\/]|$)/.test(src) })
rmSync(`${SB}/src/shared`, { recursive: true, force: true })
cpSync(SHARED, `${SB}/src/shared`, { recursive: true })

// the three substitutions
cpSync(`${HERE}/harness/fixtures/setup.ts`, `${SB}/setup.ts`)
cpSync(`${HERE}/harness/fixtures/db-index.ts`, `${SB}/db/index.ts`)
mkdirSync(`${SB}/src/middleware`, { recursive: true })
// Refuse if the file being replaced is not the shape the stub stands in for — a template that stopped
// using createAuthMiddleware would otherwise be silently tested against the wrong auth. (refresh-sandbox
// learned this the hard way.)
const realAuth = readFileSync(`${SB}/src/middleware/auth.ts`, 'utf8')
if (!/createAuthMiddleware|jwt/.test(realAuth)) {
  console.error('FAIL: src/middleware/auth.ts is not the shape the test stub replaces — look before running')
  process.exit(1)
}
cpSync(`${HERE}/harness/fixtures/middleware-auth.ts`, `${SB}/src/middleware/auth.ts`)

// PGlite is a test-only dependency: the tenant ships with node-postgres.
const pkg = JSON.parse(readFileSync(`${SB}/package.json`, 'utf8'))
pkg.dependencies = { ...pkg.dependencies, '@electric-sql/pglite': '0.2.17' }
writeFileSync(`${SB}/package.json`, JSON.stringify(pkg, null, 2))

const tests = readdirSync(HERE).filter((f) => f.endsWith('.test.ts') && (!filter || f.includes(filter))).sort()
if (!tests.length) { console.error(`FAIL: no test files${filter ? ` matching "${filter}"` : ''}`); process.exit(1) }
for (const f of tests) cpSync(`${HERE}/${f}`, `${SB}/${f}`)

console.log('installing dependencies…')
const install = spawnSync('bun', ['install', '--silent'], { cwd: SB, encoding: 'utf8', shell: true })
if (install.status !== 0) {
  console.error('FAIL: bun install\n' + (install.stderr || install.stdout || '').slice(0, 2000))
  process.exit(1)
}

// TZ is pinned: several of these assert on the SHOP's calendar day, and a runner in another zone reads
// green on a real defect. (The suite itself refuses to draw a conclusion when the two days coincide.)
let failedFiles = 0
let assertions = 0
console.log(`\nrunning ${tests.length} file(s)\n`)
for (const f of tests) {
  const r = spawnSync('bun', [f], { cwd: SB, encoding: 'utf8', shell: true, env: { ...process.env, TZ: 'UTC', NODE_ENV: 'test' } })
  const out = (r.stdout || '') + (r.stderr || '')
  const line = out.split(/\r?\n/).reverse().find((l) => /\d+ passed, \d+ failed/.test(l)) || ''
  const passed = Number(/(\d+) passed/.exec(line)?.[1] || 0)
  const failed = Number(/(\d+) failed/.exec(line)?.[1] || 0)
  assertions += passed
  const ok = r.status === 0 && failed === 0 && !!line
  if (!ok) {
    failedFiles++
    console.log(`FAIL ${f}  ${line || '(no summary — the file did not finish)'}`)
    // only the failures, and only the useful part
    for (const l of out.split(/\r?\n/)) if (/^\s*FAIL |^error|Error:/.test(l)) console.log('     ' + l.trim().slice(0, 200))
  } else {
    console.log(`ok   ${f}  ${line}`)
  }
}

console.log(`\n${tests.length} file(s), ${assertions} assertions, ${failedFiles} file(s) failed`)
if (process.env.KEEP) console.log(`sandbox kept at ${SB}`)
process.exit(failedFiles ? 1 : 0)
