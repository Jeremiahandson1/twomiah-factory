// A signup's AI-written site whose compose died with a deploy, or failed, is composed again — and staff hear when it
// cannot be. (Launch list #1, 10/17)
//
// This file used to test the same rule for the emailed preview of the "see a preview first" website offer
// (services/previewRetry.ts). That offer was closed and removed on 2026-11-13 (routes/factory/closedIntake.ts); the
// sweep it ran on stays for the one thing left that composes — a signup's own site (services/signupSite.ts) — and this
// tests that.
import { readFileSync } from 'node:fs'
const { composeDecision, MAX_ATTEMPTS, STALE_MS } = await import('../../apps/api/src/services/signupSite.ts')

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}
const read = (p: string) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

const MIN = 60_000
const bootedAt = Date.parse('2026-10-17T19:00:00Z')
const at = (m: number) => new Date(bootedAt + m * MIN).toISOString()
const decide = (state: any, nowMin: number, runningHere = false) => composeDecision(state, { now: bootedAt + nowMin * MIN, bootedAt, runningHere })
const staleMin = STALE_MS / MIN

// ── nothing to do
check('a signup that asked for no AI site is left alone', decide(null, 3) === 'none' && decide(undefined, 3) === 'none')
for (const status of ['done', 'failed', 'timed_out']) check(`a compose that is ${status} is not run again`, decide({ status, attempts: 1 }, 3) === 'none')

// ── the first attempt, and one that is running
check('a pending compose is composed', decide({ status: 'pending', attempts: 0 }, 3) === 'compose')
check('…unless this process is composing it right now', decide({ status: 'pending', attempts: 0 }, 3, true) === 'wait')
check('an attempt begun in this process a minute ago is waited for', decide({ status: 'composing', attempts: 1, lastAttemptAt: at(2) }, 3) === 'wait')

// ── the restart: an attempt that began before this process booted died with the old one
check('an attempt begun 2 minutes before the restart is composed again at once', decide({ status: 'composing', attempts: 1, lastAttemptAt: at(-2) }, 3) === 'compose')
check('…and so is one with no recorded start', decide({ status: 'composing', attempts: 1 }, 3) === 'compose')
check(`an attempt silent for more than ${staleMin} minutes is taken as hung and composed again`, decide({ status: 'composing', attempts: 1, lastAttemptAt: at(5) }, 5 + staleMin + 1) === 'compose')
check('…but not a minute before that', decide({ status: 'composing', attempts: 1, lastAttemptAt: at(5) }, 5 + staleMin - 1) === 'wait')

// ── it stops
check(`a failure set back to pending after ${MAX_ATTEMPTS} attempts is given up`, decide({ status: 'pending', attempts: MAX_ATTEMPTS }, 3) === 'give_up')
check('the last attempt killed by a restart is given up at once', decide({ status: 'composing', attempts: MAX_ATTEMPTS, lastAttemptAt: at(-2) }, 3) === 'give_up')
check('…but not while it could still be running here', decide({ status: 'composing', attempts: MAX_ATTEMPTS, lastAttemptAt: at(2) }, 3) === 'wait')

// ── staff hear, and the site falls back to the template
const site = read('apps/api/src/services/signupSite.ts')
check('the last failed attempt raises a staff alert', /started\.attempts >= MAX_ATTEMPTS\) \{\s*void raiseAlert\(\{ key: 'ai-site:' \+ tenantId, what: 'The AI site builder failed — the template site is used instead'/.test(site))
check('…and a give-up at build time does too', /if \(d === 'give_up'\) \{[\s\S]{0,400}void raiseAlert\(\{ key: 'ai-site:' \+ tenantId/.test(site))

// ── the route and the schedule use it
const intake = read('apps/api/src/routes/factory/intake.ts')
const sweep = intake.slice(intake.indexOf("factory.post('/internal/preview-sweep'"))
check('the sweep is the scheduler\'s alone', /if \(!checkCronSecret\(c\)\) return c\.json\(\{ error: 'Unauthorized' \}, 401\)/.test(sweep))
check('the sweep resumes signups\' sites', /resumeSignupComposes\(await liveSignupSiteDeps\(\)\)/.test(sweep))
check('…and no longer composes a preview for the closed website offer', !/previewRetryDecision|autoComposeForNewIntake|composeIntakePreview/.test(intake))
const sched = read('apps/api/src/services/scheduler.ts')
check('the scheduler runs the sweep soon after boot and every 10 minutes', /\{ name: 'preview-sweep', path: '\/api\/v1\/factory\/internal\/preview-sweep', schedule: \{ everyMinutes: 10, firstAfterMinutes: 3 \} \}/.test(sched))
check('…and knows how to run an every-N-minutes job', /'everyMinutes' in job\.schedule/.test(sched) && /setInterval\(\(\) => fireJob\(job, port, secret\), everyMinutes \* 60 \* 1000\)/.test(sched))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
