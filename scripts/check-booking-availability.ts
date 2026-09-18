// CI guard: the shared booking availability list and the booking validator MUST agree, because both run
// through slotsFor(). Two invariants keep them aligned:
//  1) Start times step by the tenant's advertised slot grid (settings.slotDurationMinutes), NOT by the
//     chosen service's duration. Stepping by service duration made /slots (no serviceId) and createBooking
//     (with serviceId) build different grids, so advertised times were refused and unadvertised times
//     booked (salon B1 / vet booking blocker).
//  2) getAvailableSlots must apply the SAME booking window (past date + maxDaysOut) createBooking enforces,
//     or the widget advertises far-future days the validator then refuses (the N7 regression).
//  3) All three — the date picker, the slot list and the validator — must read that window from the one
//     bookingWindow() helper, and the picker must offer the last day of it. Deriving it three times let the
//     picker stop a day short of what createBooking accepted (vet T12 N1).
//   bun scripts/check-booking-availability.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const src = strip(readFileSync(new URL('../packages/tenant-backend/src/booking/service.ts', import.meta.url), 'utf8'))

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// (1) the slot loop must step by the stable grid, not the service/occupancy duration.
if (!/const\s+stepMin\s*=\s*settings\.slotDurationMinutes/.test(src)) {
  fail('slotsFor must derive the start-time step from settings.slotDurationMinutes (const stepMin = settings.slotDurationMinutes)')
}
if (!/for\s*\([^)]*m\s*\+=\s*stepMin\s*\)/.test(src)) {
  fail('the slot-generation loop must advance by stepMin (the advertised grid), not by the service duration')
}
if (/m\s*\+=\s*(?:occupyMin|slotDuration)\b/.test(src)) {
  fail('the slot loop steps by the service/occupancy duration — that reintroduces the /slots-vs-validator grid mismatch')
}

// (2) getAvailableSlots must gate on the booking window (past + maxDaysOut) like createBooking does.
const gas = src.match(/async function getAvailableSlots[\s\S]*?\n  }/)?.[0] || ''
if (!gas) fail('getAvailableSlots not found — the slot list must still exist')
if (!/bookingWindow\(/.test(gas) || !/date < win\.first \|\| date > win\.last\) return \[\]/.test(gas)) {
  fail('getAvailableSlots must return [] for dates outside the booking window (past / beyond maxDaysOut), matching createBooking')
}

// (3) one window, read by all three, and the picker offers its last day.
if (!/function bookingWindow\(settings: Settings\)/.test(src)) {
  fail('the booking window must be derived once, in bookingWindow(settings) — three derivations drift apart')
}
if (!/const days = settings\.maxDaysOut \|\| 30/.test(src) || !/return \{ first, last: addDays\(first, days\), days \}/.test(src)) {
  fail('bookingWindow must run from today in the business timezone to that day + maxDaysOut (day maxDaysOut is bookable)')
}
if (/maxDate\.setDate|new Date\(\); maxDate/.test(src)) {
  fail('a call site is computing the window end itself again instead of calling bookingWindow()')
}
const gad = src.match(/async function getAvailableDates[\s\S]*?\n  }/)?.[0] || ''
if (!/bookingWindow\(/.test(gad)) fail('the date picker must read the window from bookingWindow()')
if (!/for \(let i = 0; i <= Math\.min\(days, win\.days\); i\+\+\)/.test(gad)) {
  fail('the date picker must offer the last day of the window (i <= maxDaysOut) — `i <` stops it a day short of what createBooking accepts')
}
const cb = src.match(/async function createBooking[\s\S]*?db\.transaction/)?.[0] || ''
if (!cb) fail('createBooking not found — the booking validator must still exist')
if (!/date < win\.first/.test(cb) || !/date > win\.last/.test(cb)) {
  fail('createBooking must refuse dates before and after the same window the picker advertises')
}

if (failed) { console.error(`\nbooking availability: ${failed} check(s) FAILED`); process.exit(1) }
console.log('booking availability: slot list steps by the advertised grid and honours the booking window (matches the validator)')
