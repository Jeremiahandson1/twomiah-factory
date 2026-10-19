// Runs every apps/unified test file in a process of its own, one after another, and fails if any file fails.
//
// Why: each file boots one or more tenants on an in-memory Postgres (PGlite, the whole schema of ~360 tables) that is
// never released, so `bun test tests` in one process grew past 20 GB once home care's files landed (2026-10-19) and
// the machine ran out of memory; a CI runner would too. One process per file gives the memory back after each.
//
//   bun tests/runEach.ts            # every *.test.ts in tests/
//   bun tests/runEach.ts provision  # only files whose name contains "provision"
import { readdirSync } from 'node:fs'
import path from 'node:path'

const dir = import.meta.dir
const filter = process.argv[2] || ''
const files = readdirSync(dir).filter((f) => f.endsWith('.test.ts') && f.includes(filter)).sort()
const failed: string[] = []
let passed = 0, failedTests = 0

for (const f of files) {
  const run = Bun.spawnSync([process.execPath, 'test', '--timeout', '120000', path.join('tests', f)], { cwd: path.join(dir, '..'), stdout: 'pipe', stderr: 'pipe' })
  const out = run.stdout.toString() + run.stderr.toString()
  const p = Number(/(\d+) pass/.exec(out)?.[1] ?? 0), x = Number(/(\d+) fail/.exec(out)?.[1] ?? 0)
  passed += p; failedTests += x
  if (run.exitCode !== 0) {
    failed.push(f)
    // The failing tests' own lines, so a run says what broke without a second pass.
    console.log(`FAIL ${f}  (${p} pass, ${x} fail)`)
    for (const line of out.split('\n').filter((l) => /\(fail\)|error:/.test(l)).slice(0, 15)) console.log('     ' + line.trim())
  } else console.log(`ok   ${f}  (${p} pass)`)
}

console.log(`\n${files.length} file(s): ${passed} pass, ${failedTests} fail${failed.length ? ' — failed: ' + failed.join(', ') : ''}`)
process.exit(failed.length ? 1 : 0)
