// A website preview whose compose died with a deploy, or failed, is composed again — and staff hear when it
// cannot be. (Launch list #1, 10/17)
//
// The intake fired the composer on a timer inside the Factory process and nothing tried again: a restart
// mid-compose, or one failed composer call, and the prospect never got the "within 15 minutes" email.
import { readFileSync } from 'node:fs'
const { previewRetryDecision, MAX_COMPOSE_ATTEMPTS, RETRY_AFTER_MS } = await import('../../apps/api/src/services/previewRetry.ts')

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}
const read = (p: string) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

const MIN = 60_000
const bootedAt = Date.parse('2026-10-17T19:00:00Z')
const at = (m: number) => new Date(bootedAt + m * MIN).toISOString()
const decide = (row: any, nowMin: number, composingHere = false) => previewRetryDecision(row, { now: bootedAt + nowMin * MIN, bootedAt, composingHere })
const row = (createdMin: number, compose?: any) => ({ created_at: at(createdMin), intake_data: { intake: { businessName: 'Jo' }, ...(compose ? { compose } : {}) } })

// ── the restart: an attempt that began before this process booted died with the old one
check('an attempt begun 2 minutes before the restart is composed again at once', decide(row(-3, { attempts: 1, lastAttemptAt: at(-2) }), 3) === 'compose')
check('…and so is a row from before attempts were recorded (its one attempt was at intake)', decide(row(-30), 3) === 'compose')
check('…unless this process is composing it right now', decide(row(-3, { attempts: 1, lastAttemptAt: at(-2) }), 3, true) === 'wait')

// ── a failure in this process waits, then goes again
check('a failure 5 minutes ago in this process waits', decide(row(10, { attempts: 1, lastAttemptAt: at(15), lastError: 'overloaded' }), 20) === 'wait')
check(`…and is composed again once ${RETRY_AFTER_MS / MIN} minutes have passed`, decide(row(10, { attempts: 1, lastAttemptAt: at(15), lastError: 'overloaded' }), 26) === 'compose')
check('the second failure is retried the same way', decide(row(10, { attempts: 2, lastAttemptAt: at(26) }), 37) === 'compose')

// ── it stops, and says so once
check(`after ${MAX_COMPOSE_ATTEMPTS} attempts it stops and staff are told`, decide(row(10, { attempts: MAX_COMPOSE_ATTEMPTS, lastAttemptAt: at(40), lastError: 'x' }), 51) === 'give_up')
check('…but not while the last attempt could still be running here', decide(row(10, { attempts: MAX_COMPOSE_ATTEMPTS, lastAttemptAt: at(40) }), 45) === 'wait')
check('…the last attempt killed by a restart is reported at once', decide(row(-60, { attempts: MAX_COMPOSE_ATTEMPTS, lastAttemptAt: at(-2) }), 3) === 'give_up')
check('…and staff are told only once', decide(row(10, { attempts: MAX_COMPOSE_ATTEMPTS, lastAttemptAt: at(40), gaveUpAt: at(51) }), 200) === 'given_up')
check('a nonsense attempt count is read as one, not as "never tried"', decide(row(-30, { attempts: 'x' }), 3) === 'compose')

// ── the route and the schedule use it
const intake = read('apps/api/src/routes/factory/intake.ts')
const sweep = intake.slice(intake.indexOf("factory.post('/internal/preview-sweep'"), intake.indexOf('async function composeIntakePreview'))
check('the sweep is behind the cron secret', /if \(!checkCronSecret\(c\)\) return c\.json\(\{ error: 'Unauthorized' \}, 401\)/.test(sweep))
check('…reads intakes still without a preview', /\.eq\('status', 'intake'\)/.test(sweep) && /\.is\('preview_premium_pages', null\)/.test(sweep))
check('…and decides by previewRetryDecision', /previewRetryDecision\(row, \{ now, bootedAt: BOOTED_AT, composingHere: COMPOSING\.has\(row\.id\) \}\)/.test(sweep))
check('…composing through the path that records the attempt', /await autoComposeForNewIntake\(row\.id\)/.test(sweep))
const auto = intake.slice(intake.indexOf('async function autoComposeForNewIntake'), intake.indexOf('async function giveUpOnPreview'))
check('every attempt is written down BEFORE the compose starts', auto.indexOf('attempts: attempt, lastAttemptAt') > -1 && auto.indexOf('attempts: attempt, lastAttemptAt') < auto.indexOf('await composeIntakePreview(tenantId)'))
check('…a failure records its error and is rethrown', /noteCompose\(tenantId, \{ lastError: msg \}\)/.test(auto) && /throw err/.test(auto))
check('the intake still fires it at once', /setTimeout\(\(\) => \{\s*autoComposeForNewIntake\(tenant\.id\)/.test(intake))
const sched = read('apps/api/src/services/scheduler.ts')
check('the scheduler runs the sweep soon after boot and every 10 minutes', /\{ name: 'preview-sweep', path: '\/api\/v1\/factory\/internal\/preview-sweep', schedule: \{ everyMinutes: 10, firstAfterMinutes: 3 \} \}/.test(sweep + sched))
check('…and knows how to run an every-N-minutes job', /'everyMinutes' in job\.schedule/.test(sched) && /setInterval\(\(\) => fireJob\(job, port, secret\), everyMinutes \* 60 \* 1000\)/.test(sched))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
