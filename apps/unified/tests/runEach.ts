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
// SHARD=i/n (1-based) runs every n-th file starting at i, so CI can split the files across parallel jobs; together the
// n shards run every file exactly once.
const shard = /^(\d+)\/(\d+)$/.exec(process.env.SHARD || '')
const all = readdirSync(dir).filter((f) => f.endsWith('.test.ts') && f.includes(filter)).sort()
const files = shard ? all.filter((_, i) => i % Number(shard[2]) === Number(shard[1]) - 1) : all
if (shard) console.log(`shard ${shard[1]}/${shard[2]}: ${files.length} of ${all.length} file(s)`)
const failed: string[] = []
let passed = 0, failedTests = 0

// A file that never finishes is killed and counted as failed: on 10/30 one child hung for two hours with every test of
// its file already passed, and the run (and so CI) waited on it with nothing to say. Well above the slowest file:
// move-run.test.ts builds two whole databases per case and takes ~11 minutes in CI.
const FILE_LIMIT_MS = 30 * 60_000

for (const f of files) {
  const run = Bun.spawnSync([process.execPath, 'test', '--timeout', '120000', path.join('tests', f)], { cwd: path.join(dir, '..'), stdout: 'pipe', stderr: 'pipe', timeout: FILE_LIMIT_MS })
  const out = run.stdout.toString() + run.stderr.toString() + (run.exitedDueToTimeout ? `\nerror: the file did not finish within ${FILE_LIMIT_MS / 60_000} minutes and was stopped` : '')
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
