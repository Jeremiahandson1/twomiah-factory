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

// A trades job keeps its clock time in a column of its own, and jobCalendar.create wrote only the date —
// so every job booked through the widget landed with scheduled_time NULL and the board, the tech's list
// and the day's ordering had nothing to place it by. The customer picked a time and the confirmation
// quoted it back; the job did not have it. (Field service T22 H1, ten runs open)
if (!/scheduledTime: minutesToHm\(tzParts\(i\.start, i\.timeZone\)\.minutes\)/.test(cal)) fail('jobCalendar.create must record the clock time, in the shop\'s own timezone — a job with only a date cannot be placed on the board')
if (!/timeZone: string/.test(read('packages/tenant-backend/src/booking/types.ts'))) fail('…so the calendar has to be told which timezone that is')
if (!/companyId, contactId: theContact\.id, start, end, timeZone: tz, durationMinutes/.test(read('packages/tenant-backend/src/booking/service.ts'))) fail('…and the booking service must pass the shop\'s timezone when it creates the entry')
// Fixing the write path does nothing for the jobs already booked, so they are repaired once at startup.
if (!/async backfillTimes\(exec, tzFor\)/.test(cal)) fail('the job calendar must be able to repair jobs booked before the time was recorded')
if (!/eq\(job\.source, 'online_booking'\), isNull\(job\.scheduledTime\), isNotNull\(job\.scheduledDate\)/.test(cal)) fail('…touching ONLY widget-made jobs that have a date and no time, so a job left unscheduled on purpose is never given one')
if (!/svc\.backfillJobTimes\(\)/.test(read('packages/tenant-backend/src/booking/routes.ts'))) fail('…and it must actually run, where every template wires the booking routes in')

// The other half: what the widget must not double-book. busy() read scheduled_date alone, and a job made
// in the CRM keeps its clock time in scheduled_time with scheduled_date at midnight — so a 13:00 service
// call blocked MIDNIGHT and 13:00 stayed on sale. The office booked the call, the customer booked the
// same slot, and both were told yes. slotsFor feeds the slot list AND createBooking, so one read fixes
// both. (Field service T23 H1)
if (!/async busy\(exec, companyId, from, to, tz\)/.test(cal)) fail('busy() must be told the shop\'s zone — a job\'s clock time is stored as local wall time')
if (!/time: job\.scheduledTime/.test(cal)) fail('…and must READ the clock time, or a CRM-made service call blocks midnight instead of its hour')
if (!/isHm\(r\.time\) && tz \? zonedWallTimeToUtc\(stored\.toISOString\(\)\.slice\(0, 10\), r\.time, tz\) : stored/.test(cal)) fail('…combining the stored DATE with that local time, and falling back to the raw instant when there is no time')
if (!/calendar\.busy\(exec, companyId, new Date\(dayStart\.getTime\(\) - DAY_MS\), new Date\(dayStart\.getTime\(\) \+ 2 \* DAY_MS\), tz\)/.test(read('packages/tenant-backend/src/booking/service.ts'))) fail('…and the zone has to actually be passed when the slots are worked out')

// A booking that became a job is already on the Schedule as that job; drawing the booking too puts the
// same visit on the board twice. It always did — it only became visible once both chips carried the same
// time. (Field service T23)
{
  const page = read('packages/tenant-ui/src/schedule/SchedulePage.tsx')
  if (!/calendarId: row\.calendar\?\.id \?\? null/.test(page)) fail('the Schedule must know which job a booking became')
  if (!/!\(b\.calendarId && drawnAsJobs\.has\(b\.calendarId\)\)/.test(page)) fail('…and must not draw the booking again when that job is already on the day')
}

if (failed) { console.error(`\nbooking deposit confirms job: ${failed} check(s) FAILED`); process.exit(1) }
console.log("booking deposit confirms job: a cleared deposit moves the pending job to 'scheduled', the same mapping as a manual confirm; a booked job records the clock time it was booked for, and the ones booked before that are repaired at startup")
