// CI guard: on the job calendars a deposit-required booking's job is created 'pending' and must become
// 'scheduled' when the deposit clears — the same mapping the owner's manual confirm uses
// (jobCalendar.setStatus 'confirmed' → 'scheduled'). The webhook once confirmed only the
// online_booking row, leaving the job 'pending' forever. (#158)
//   bun scripts/check-booking-deposit-confirms-job.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'))

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const cal = read('packages/tenant-backend/src/booking/calendars.ts')
if (!/status: i\.pendingDeposit \? 'pending' : 'scheduled'/.test(cal)) fail('jobCalendar.create must hold a deposit-required booking as a pending job')
if (!/s === 'confirmed' \? 'scheduled'/.test(cal)) fail("jobCalendar must map a confirmed booking to a 'scheduled' job")

const stripe = read('packages/tenant-backend/src/payments/stripe.ts')
const a = stripe.indexOf('async function handlePaymentSuccess('); const b = stripe.indexOf('async function handlePaymentFailed(')
const hook = stripe.slice(a, b)
const confirm = hook.indexOf("SET deposit_status = 'paid', deposit_paid_at = NOW(), status = 'confirmed'")
if (confirm < 0) fail('handlePaymentSuccess must confirm the online_booking row')
const mirror = hook.indexOf("UPDATE job SET status = 'scheduled', updated_at = NOW() WHERE id = ${bk.job_id} AND status = 'pending'")
if (mirror < 0) fail("handlePaymentSuccess must move the pending job to 'scheduled' when the deposit clears (guarded on status = 'pending')")
if (mirror >= 0 && confirm >= 0 && mirror < confirm) fail('the job mirror must follow the booking confirm')
if (!/options\.bookingCalendarKind === 'job' && !resurrected && bk\.job_id/.test(hook)) fail('the job mirror must run only on job calendars, only when the booking was not just resurrected')
if (/UPDATE appointment SET status = 'scheduled'[^`]*AND status = 'pending'/.test(hook)) fail('appointment calendars create the appointment scheduled from the start — no mirror there')

if (failed) { console.error(`\nbooking deposit confirms job: ${failed} check(s) FAILED`); process.exit(1) }
console.log("booking deposit confirms job: a cleared deposit moves the pending job to 'scheduled', the same mapping as a manual confirm")
