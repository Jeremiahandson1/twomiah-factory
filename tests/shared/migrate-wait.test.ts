// Every CRM waits long enough for a brand-new Render database — and the boot log shows only real problems. (10/15)
//
// E2E Run 2, the first real store signup: Render's new Postgres took ~3 minutes to accept connections. Every CRM's
// db/migrate.ts waited 20 × 10s for it — except crm-store, which still had 10 × 5s (≈70s), gave up, ran on into the
// seed, and the first deploy was marked failed. The store was the one template never signed up for real, so nothing
// had ever hit it. This holds every template to one budget, and runs the start command's prune step for real.
const { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, mkdirSync } = await import('node:fs')
const { spawnSync } = await import('node:child_process')
const { join } = await import('node:path')
const { tmpdir } = await import('node:os')

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const PARKED = new Set(['crm-automotive'])
const MIN_WAIT_MS = 180_000 // a new Render database has been seen to take ~3 minutes

const crms = readdirSync(ROOT + 'templates').filter((d: string) => /^crm(-|$)/.test(d) && !PARKED.has(d) && existsSync(ROOT + `templates/${d}/backend/db/migrate.ts`))
check('found every CRM\'s migrate.ts', crms.length >= 12, crms)
for (const t of crms) {
  const src = readFileSync(ROOT + `templates/${t}/backend/db/migrate.ts`, 'utf8')
  const retries = Number(src.match(/const MAX_RETRIES = (\d+)/)?.[1] || 0), delay = Number(src.match(/const RETRY_DELAY_MS = (\d+)/)?.[1] || 0)
  check(`${t}: waits at least 3 minutes for a new database (${retries} × ${delay / 1000}s)`, retries * delay >= MIN_WAIT_MS, { retries, delay })
}

// ── the prune step, run for real in a shell: skipped quietly when absent, run when present
const deploySrc = readFileSync(ROOT + 'apps/api/src/services/deploy.ts', 'utf8')
const step = deploySrc.match(/'(\{ \[ -f db\/prune-legacy\.ts \] && bun run db\/prune-legacy\.ts 2>&1 \| head -20; \} \|\| echo "\[boot\] prune-legacy skipped"; )'/)?.[1]
check('the start command checks the prune script exists before running it', !!step, null)
if (step) {
  const sh = (withFile: boolean) => {
    const dir = mkdtempSync(join(tmpdir(), 'prune-'))
    mkdirSync(join(dir, 'db'))
    if (withFile) writeFileSync(join(dir, 'db', 'prune-legacy.ts'), '')
    // `bun run` stands in for itself as a marker, so the shell logic is what is tested — not bun.
    const cmd = step.replace('bun run db/prune-legacy.ts', 'echo RAN-PRUNE') + 'echo NEXT-STEP'
    const r = spawnSync('bash', ['-c', cmd], { cwd: dir, encoding: 'utf8' })
    return { out: (r.stdout || '') + (r.stderr || ''), status: r.status }
  }
  const absent = sh(false), present = sh(true)
  check('a template with no prune script (crm-store): a quiet "skipped", no "Module not found", and boot carries on', /\[boot\] prune-legacy skipped/.test(absent.out) && !/Module not found|RAN-PRUNE/.test(absent.out) && /NEXT-STEP/.test(absent.out), absent)
  check('a template with one: it runs, and boot carries on', /RAN-PRUNE/.test(present.out) && !/skipped/.test(present.out) && /NEXT-STEP/.test(present.out), present)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
