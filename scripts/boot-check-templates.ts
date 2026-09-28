// Does every template's backend actually load?
//
//   bun run boot-check-all.ts <worktree> [template]
//
// Answers the question "if the factory deploys one vertical properly, does that mean it works for
// all of them". The pipeline (generator, deploy, Render, DNS) is shared and proving it once is
// enough. The PAYLOAD is not: each template has its own schema, migrations, route files and often
// its own forked middleware, and that is where the failures live.
//
// This assembles each template the way the Factory does — backend/ copied, packages/tenant-backend
// vendored in as src/shared, db swapped for in-process PGlite — then IMPORTS every route file for
// real. A module that throws on import is either a server that will not boot (if index.ts mounts it
// plainly) or an API that is silently absent (if index.ts wraps the mount in try/catch). Both are
// reported, the silent kind first, because that is the kind that ships unnoticed.
//
// Real execution, not static analysis: it catches a bad named import, a top-level throw, a missing
// file, a circular import — anything that stops the module loading.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.argv[2]
const ONLY = process.argv[3] || ''
const FIXTURES = `${ROOT}/tests/harness/fixtures`
const SHARED = `${ROOT}/packages/tenant-backend/src`
const read = (p: string) => readFileSync(p, 'utf8').split('\r').join('')

type Result = { template: string; total: number; failed: Array<{ file: string; silent: boolean; err: string }>; skipped?: string }
const results: Result[] = []

const templates = readdirSync(`${ROOT}/templates`).sort()
  .filter((t) => existsSync(`${ROOT}/templates/${t}/backend/src/index.ts`))
  .filter((t) => !ONLY || t === ONLY)

for (const t of templates) {
  const be = `${ROOT}/templates/${t}/backend`
  const routesDir = `${be}/src/routes`
  if (!existsSync(routesDir)) { results.push({ template: t, total: 0, failed: [], skipped: 'no src/routes' }); continue }

  const SB = mkdtempSync(join(tmpdir(), `boot-${t}-`))
  try {
    cpSync(be, SB, { recursive: true, filter: (src) => !/node_modules|[\\/]dist([\\/]|$)/.test(src) })
    rmSync(`${SB}/src/shared`, { recursive: true, force: true })
    cpSync(SHARED, `${SB}/src/shared`, { recursive: true })
    cpSync(`${FIXTURES}/db-index.ts`, `${SB}/db/index.ts`)

    const pkg = JSON.parse(readFileSync(`${SB}/package.json`, 'utf8'))
    pkg.dependencies = { ...pkg.dependencies, '@electric-sql/pglite': '0.2.17' }
    writeFileSync(`${SB}/package.json`, JSON.stringify(pkg, null, 2))

    const install = spawnSync('bun', ['install', '--silent'], { cwd: SB, encoding: 'utf8', shell: true })
    if (install.status !== 0) { results.push({ template: t, total: 0, failed: [], skipped: 'bun install failed: ' + (install.stderr || '').slice(0, 120) }); continue }

    // which route files does index.ts mount inside a try/catch (silently)?
    const index = read(`${SB}/src/index.ts`).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
    const silent = new Set<string>()
    for (const m of index.matchAll(/try\s*\{[^}]*await\s+import\(\s*['"]\.\/routes\/([\w.-]+?)(?:\.ts)?['"]\s*\)[^}]*\}\s*catch/g)) silent.add(m[1])

    const files = readdirSync(routesDir).filter((f) => f.endsWith('.ts')).sort()
    // One child process imports them all and reports per-file, so a hard crash cannot take the run down.
    const probe = `
const files = ${JSON.stringify(files)}
const out = []
for (const f of files) {
  try { await import('./src/routes/' + f); out.push({ f, ok: true }) }
  catch (e) { out.push({ f, ok: false, err: String((e && e.message) || e).split('\\n')[0].slice(0, 160) }) }
}
console.log('__BOOT__' + JSON.stringify(out))
`
    writeFileSync(`${SB}/__boot_probe.ts`, probe)
    const r = spawnSync('bun', ['__boot_probe.ts'], { cwd: SB, encoding: 'utf8', shell: true, timeout: 180000, env: { ...process.env, NODE_ENV: 'test', TZ: 'UTC' } })
    const line = (r.stdout || '').split('\n').find((l) => l.startsWith('__BOOT__'))
    if (!line) { results.push({ template: t, total: files.length, failed: [], skipped: 'probe produced no output: ' + ((r.stderr || r.stdout || '').split('\n').filter(Boolean).pop() || '').slice(0, 140) }); continue }

    const rows: Array<{ f: string; ok: boolean; err?: string }> = JSON.parse(line.slice(8))
    results.push({
      template: t,
      total: rows.length,
      failed: rows.filter((x) => !x.ok).map((x) => ({ file: x.f, silent: silent.has(x.f.replace(/\.ts$/, '')), err: x.err || '' })),
    })
  } finally {
    // Windows holds a handle on the sandbox for a moment after the probe exits; a locked temp dir
    // must not abort a 13-template run. Leave it for the OS to reap.
    if (!process.env.KEEP) { try { rmSync(SB, { recursive: true, force: true }) } catch {} }
  }
}

console.log('')
let bad = 0
for (const r of results) {
  if (r.skipped) { console.log(`  ${r.template.padEnd(18)} — skipped: ${r.skipped}`); continue }
  const mark = r.failed.length === 0 ? 'ok  ' : 'FAIL'
  console.log(`  ${mark} ${r.template.padEnd(18)} ${String(r.total).padStart(3)} route file(s), ${r.failed.length} failed to import`)
  for (const f of r.failed) {
    console.log(`         ${f.silent ? 'SILENT (try/catch mount — API just absent)' : 'BOOT   (plain mount — server will not start)'}  ${f.file}`)
    console.log(`           ${f.err}`)
  }
  if (r.failed.length) bad++
}
console.log(`\n  ${results.filter((r) => !r.skipped).length} template(s) checked, ${bad} with at least one route that does not load`)
