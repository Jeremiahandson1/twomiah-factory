// CI guard: the shared jobs create/update schema must constrain status and scheduled time. A free-form
// status let POST /api/jobs accept status:"banana" — it reached the dashboard as a real bucket and was
// dropped from Reports (168 vs 169) — and scheduledTime accepted "25:99" verbatim. Both must validate.
//   bun scripts/check-jobs-input.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const src = strip(readFileSync(new URL('../packages/tenant-backend/src/jobs/jobs.ts', import.meta.url), 'utf8'))

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

if (!/const\s+JOB_STATUSES\s*=/.test(src)) fail('jobs.ts must define a JOB_STATUSES set')
if (!/status:\s*z\.enum\(JOB_STATUSES\)/.test(src)) fail('the job schema status must be z.enum(JOB_STATUSES), not a free-form string (rejects "banana")')
if (/status:\s*z\.string\(\)\.min\(1\)\.optional\(\)/.test(src)) fail('the job schema still accepts an arbitrary status string')
if (!/scheduledTime:[\s\S]{0,140}?\/\^\(\[01\]/.test(src)) fail('scheduledTime must be validated as HH:MM (24-hour), rejecting "25:99"')

if (failed) { console.error(`\njobs input: ${failed} check(s) FAILED`); process.exit(1) }
console.log('jobs input: status is a bounded enum and scheduledTime is HH:MM-validated')
