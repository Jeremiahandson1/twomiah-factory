// Run a behaviour suite against a sandbox assembled from THIS tree.
//
// One implementation, one set of fixtures, any number of verticals: each suite is a directory of
// *.test.ts plus a three-line entry that names its template. Copying this file per vertical is how the
// two copies drift until one of them is quietly testing the wrong thing.
//
// The sandbox is a generated tenant: templates/<template>/backend, with packages/tenant-backend/src
// vendored in as src/shared exactly the way the Factory does it, and three files replaced:
//
//   db/index.ts             the node-postgres Pool → an in-process PGlite, so the REAL routes and the
//                           REAL shared code run against a real SQL engine rather than mocks
//   src/middleware/auth.ts  bearer verification → an x-test-user header. The PERMISSION layer stays
//                           real, which is the half these tests care about
//   setup.ts                applies the tenant's own migrations in journal order, then the boot
//                           reconcile — the same schema path a Render boot takes
//
// Assembling it per run rather than committing it is the point: a suite cannot drift away from the
// templates it is testing, and no generated code lands in git.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface SuiteOptions {
  /** Directory holding the *.test.ts files, e.g. <root>/tests/salon */
  suiteDir: string
  /** Template to assemble, e.g. 'crm-salon' */
  template: string
  /** Short name for logs and the temp directory */
  label: string
  /** Repo root, with a trailing slash */
  root: string
  /** Only run files whose name contains this */
  filter?: string
}

export async function runSuite(o: SuiteOptions): Promise<number> {
  const TEMPLATE = `${o.root}templates/${o.template}/backend`
  const SHARED = `${o.root}packages/tenant-backend/src`
  const FIXTURES = `${o.root}tests/harness/fixtures`
  const filter = o.filter || ''

  for (const [what, path] of [['template', TEMPLATE], ['shared package', SHARED], ['fixtures', FIXTURES], ['suite', o.suiteDir]] as const) {
    if (!existsSync(path)) { console.error(`FAIL: no ${what} at ${path}`); return 1 }
  }

  const SB = mkdtempSync(join(tmpdir(), `${o.label}-suite-`))
  const cleanup = () => { if (!process.env.KEEP) rmSync(SB, { recursive: true, force: true }) }
  process.on('exit', cleanup)

  console.log(`assembling a ${o.template} sandbox in ${SB}`)
  cpSync(TEMPLATE, SB, { recursive: true, filter: (src) => !/node_modules|[\\/]dist([\\/]|$)/.test(src) })
  rmSync(`${SB}/src/shared`, { recursive: true, force: true })
  cpSync(SHARED, `${SB}/src/shared`, { recursive: true })

  // the three substitutions
  cpSync(`${FIXTURES}/setup.ts`, `${SB}/setup.ts`)
  cpSync(`${FIXTURES}/db-index.ts`, `${SB}/db/index.ts`)
  mkdirSync(`${SB}/src/middleware`, { recursive: true })
  // Refuse if the file being replaced is not the shape the stub stands in for — a template that stopped
  // using createAuthMiddleware would otherwise be silently tested against the wrong auth.
  const realAuth = readFileSync(`${SB}/src/middleware/auth.ts`, 'utf8')
  if (!/createAuthMiddleware|jwt/.test(realAuth)) {
    console.error(`FAIL: ${o.template} src/middleware/auth.ts is not the shape the test stub replaces — look before running`)
    return 1
  }
  // A template whose auth is a different SHAPE, not just a different file, may ship its own stub as
  // middleware-auth.<template>.ts. crm-homecare is the case that forced this: it never queries a user
  // table (the JWT payload IS the context), its schema exports `users` where the default stub imports
  // `user`, there is no companyId on that table, and its auth.ts also exports logAuthEvent — which
  // routes/auth.ts imports and the default stub does not provide. Adapting the shared stub to cover
  // both would have made it a second implementation pretending to be one. The default path below is
  // byte-identical to what salon, field service and dispensary already use.
  const perTemplateAuth = `${FIXTURES}/middleware-auth.${o.template}.ts`
  const authFixture = existsSync(perTemplateAuth) ? perTemplateAuth : `${FIXTURES}/middleware-auth.ts`
  if (authFixture !== `${FIXTURES}/middleware-auth.ts`) console.log(`using the ${o.template} auth stub`)
  cpSync(authFixture, `${SB}/src/middleware/auth.ts`)

  // PGlite is a test-only dependency: the tenant ships with node-postgres.
  const pkg = JSON.parse(readFileSync(`${SB}/package.json`, 'utf8'))
  pkg.dependencies = { ...pkg.dependencies, '@electric-sql/pglite': '0.2.17' }
  writeFileSync(`${SB}/package.json`, JSON.stringify(pkg, null, 2))

  const tests = readdirSync(o.suiteDir).filter((f) => f.endsWith('.test.ts') && (!filter || f.includes(filter))).sort()
  for (const f of tests) cpSync(`${o.suiteDir}/${f}`, `${SB}/${f}`)

  /**
   * The shared contract test runs in EVERY suite.
   *
   * It is not copied per vertical on purpose: it asserts the two invariants that hold for every
   * template — nothing readable without signing in, and no 5xx from a well-formed request — over the
   * routes that template actually mounts. Keeping one copy is what makes a brand-new vertical get the
   * check the moment it has a suite entry, and what stops the eight-way drift that let the same
   * column defect sit in eight payroll files.
   *
   * It is the check that found /api/payroll/expenses (seven templates) and the whole /api/scheduling
   * module (eight) answering 500 on every call they had ever received.
   */
  const CONTRACT = `${o.root}tests/harness/contract.test.ts`
  if (existsSync(CONTRACT) && (!filter || 'contract.test.ts'.includes(filter))) {
    cpSync(CONTRACT, `${SB}/contract.test.ts`)
    if (!tests.includes('contract.test.ts')) tests.unshift('contract.test.ts')
  }
  if (!tests.length) { console.error(`FAIL: no test files${filter ? ` matching "${filter}"` : ''} in ${o.suiteDir}`); return 1 }

  console.log('installing dependencies…')
  const install = spawnSync('bun', ['install', '--silent'], { cwd: SB, encoding: 'utf8', shell: true })
  if (install.status !== 0) {
    console.error('FAIL: bun install\n' + (install.stderr || install.stdout || '').slice(0, 2000))
    return 1
  }

  // TZ is pinned: several of these assert on the SHOP's calendar day, and a runner in another zone reads
  // green on a real defect. (A suite that cares refuses to conclude when the two days coincide.)
  //
  // ANTHROPIC_API_KEY is pinned EMPTY, and that one is not a nicety.
  //
  // The dispensary AI budtender calls the real Anthropic API whenever that variable is set, and the
  // suite inherits the developer's environment. So on a machine with a key these tests were making
  // live, billed API calls on every run, asserting on text a model wrote fresh each time — while CI,
  // which has no key, ran the keyword path instead. Two different code paths, each one tested only
  // where nobody was looking, and a bill for the privilege. Found while mutation-testing T48 Q4: a
  // mutation that gutted the keyword path stayed green locally because the keyword path never ran.
  //
  // Empty means every runner takes the same deterministic path. The model-side logic is covered by
  // asserting the exported functions directly, which is where it belongs — a test that needs a live
  // model to pass is not a test of our code.
  let failedFiles = 0
  let assertions = 0
  console.log(`\nrunning ${tests.length} file(s)\n`)
  for (const f of tests) {
    // FACTORY_ROOT: a test that reads template SOURCE rather than calling the API needs the real tree,
    // because the sandbox is a temp copy.
    const r = spawnSync('bun', [f], {
      cwd: SB, encoding: 'utf8', shell: true,
      // SUITE_TEMPLATE: the shared contract test needs to know which template it is running against
      // (its per-template ratchet). The sandbox's package.json name is the same string in several
      // templates, so it cannot be inferred from inside — the runner is the only thing that knows.
      env: { ...process.env, TZ: 'UTC', NODE_ENV: 'test', FACTORY_ROOT: o.root, ANTHROPIC_API_KEY: '', SUITE_TEMPLATE: o.template },
    })
    // Strip ANSI before matching: a coloured "error:" that no longer starts the line is the easiest way
    // for a pattern match on raw output to go quiet exactly when it is needed.
    const out = ((r.stdout || '') + (r.stderr || '')).replace(/\u001b\[[0-9;]*m/g, '')
    const line = out.split(/\r?\n/).reverse().find((l) => /\d+ passed, \d+ failed/.test(l)) || ''
    const passed = Number(/(\d+) passed/.exec(line)?.[1] || 0)
    const failed = Number(/(\d+) failed/.exec(line)?.[1] || 0)
    assertions += passed
    const ok = r.status === 0 && failed === 0 && !!line
    if (!ok) {
      failedFiles++
      console.log(`FAIL ${f}  ${line || '(no summary — the file did not finish)'}`)
      const named = out.split(/\r?\n/).filter((l) => /^\s*FAIL |^error|Error:/.test(l))
      for (const l of named) console.log('     ' + l.trim().slice(0, 200))
      // A file that dies before printing a summary names nothing above, and reporting "it failed" with no
      // reason is how a hardcoded path once survived into CI. Show its last words.
      if (!named.length) {
        const tail = out.split(/\r?\n/).filter((l) => l.trim()).slice(-12)
        for (const l of tail) console.log('     | ' + l.trim().slice(0, 200))
        if (!tail.length) console.log('     | (the file produced no output at all)')
      }
    } else {
      console.log(`ok   ${f}  ${line}`)
    }
  }

  console.log(`\n${o.label}: ${tests.length} file(s), ${assertions} assertions, ${failedFiles} file(s) failed`)
  if (process.env.KEEP) console.log(`sandbox kept at ${SB}`)
  return failedFiles ? 1 : 0
}
