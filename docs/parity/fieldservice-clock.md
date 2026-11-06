# Parity: clock in and out on the phone for trades, beside the geofence's automatic clock-in (field service and basic)

Branch `cloud/fieldservice-depth`, item 2; finished on `cloud/fieldservice-parity`, item 4 (rows 7–13). No new feature id (Time Tracking and GPS Tracking already gate it).
Item 4 code: `apps/unified/server/crm/field/clockExtras.ts` (settings, overtime, automatic timekeeping, kiosk), `packages/tenant-backend/src/time/time.ts` (breaks, place, phone mark), migration `0052_time_entry_breaks_gps.sql` (columns only), web `TimeClockSettingsPage.tsx` / `TimeKioskPage.tsx`, phone `clock.tsx`, `src/jobflow/clock.ts`, `src/location/tapPlace.ts`. Tests: `apps/unified/tests/clock-finished.test.ts` (28, both verticals, 26 fail without the change), `tests/mobile/job-flow.test.ts`.
Phone: `apps/mobile/app/(details)/clock.tsx` (More › Time, for field service and basic; managers also get "Approve hours"),
`src/jobflow/clock.ts` (the rule). Server: the existing `/api/time/clock-in`, `/clock-out`, `/active`; one additive change in
`packages/tenant-backend/src/time/time.ts`: an optional `at` — the moment the tech tapped — so a tap sent later is recorded
when it was made. Tests: `apps/unified/tests/trade-clock.test.ts` (both verticals, fails without the change),
`tests/mobile/job-flow.test.ts` (the clock rule). Ported from home care's `time-clock.tsx`: the open-clock timer, clock in/out with
a note, "waiting to send" when offline. Not ported: Sandata/EVV, care tasks, medications, vitals (home care only).

**Leaders reviewed (read 2026-10-30):**
ServiceTitan — [Configure automatic timekeeping for the Field Mobile App](https://help.servicetitan.com/how-to/configure-automatic-timekeeping-for-the-servicetitan-field-mobile-app).
Jobber — [Keep working in Jobber even without internet](https://productupdates.getjobber.com/134787-keep-working-in-jobber-even-without-internet).
Housecall Pro's help pages for the time clock were not found in this session; no claim is made about it.

| # | Leader (from its page) | Ours | Mark |
|---|---|---|---|
| 1 | ServiceTitan: timesheets are created by tapping Dispatch and Arrive and ended by closing out (automatic timekeeping); the page names no clock-in button or geofence | A real Clock screen: clock in (optionally on a job), the running timer, clock out with a note | different model — manual clock beside the automatic one |
| 2 | Jobber: working hours can be logged offline and sync later | Taps are kept on the phone with the moment they were made and sent later; "Waiting to send" shown; a refusal is kept with the server's words | matches |
| 3 | — (no leader page read describes it) | **The geofence clock-in** (existing, `/api/geofencing`): with "Clock me in and out at job sites" on, arriving at a job-site fence opens the same clock the screen shows; the switch is on the Clock screen. Tested: fence + location → clock opens → clock out by hand | beyond the pages read |
| 4 | Pay accuracy of an offline tap | `at` is accepted up to 48 hours back and not in the future; a clock-out before the clock-in is refused; without `at` the server stamps its own time as before | matches |
| 5 | Office approval of hours | The Time page's approvals are unchanged; managers reach them from the Clock screen | matches |
| 6 | Who clocks | `time:create` (field seats and up); a Viewer is refused by the server | matches |
| 7 | Geofence automatic clock **out** on leaving | Re-proved (`tests/clock-finished.test.ts`, both verticals): arrive in the fence → clock in (`isAutoClocked`, source "geofence", place kept); leave → clock out with a running break taken off and the place kept. Now also stamps the place and subtracts breaks, as a hand clock-out does | built — re-proved by a test |
| 8 | ServiceTitan: On my way / Arrive start the timesheet and Complete ends it | **Automatic timekeeping** (Settings › Time Clock): Off / On my way starts it / Arrive starts it. Only the tech on the job who taps the button is clocked in, and only when not already on the clock; the moment tapped offline is the time kept; Complete ends the clock *that job opened* (never one started by hand). Time Tracking gates it. Tests: both settings, off, office dispatching, a tech not on the job, a hand clock left alone | built |
| 9 | Breaks | Start/End break on the web Time page and the phone Clock screen (`POST /api/time/break/start`, `/end`, offline-safe with the tapped moment); minutes are taken off the hours at clock-out; one still running ends with the shift (and with a geofence clock-out). Breaks are **unpaid** — there is no paid-break type | built (unpaid breaks only) |
| 10 | Overtime alerts | Settings › Time Clock: a daily and a weekly limit on the business's clock (Monday–Sunday week), "warn ahead" 0/15/30/60 minutes. A pass every 5 minutes pushes to the person and to owners/admins/managers, once per limit per day/week (claimed in `reminder_log`); the Time page lists who is over or near. Breaks are not counted. **Not built:** state-specific rules (California daily double time, meal-break penalties), or an overtime pay multiplier on the entry — the Gusto hours file already splits regular/overtime and is unchanged | built (limits and alerts); pay rules not built |
| 11 | GPS stamp on each clock tap | The phone sends where it is on clock in and clock out (`place`), kept on the entry; the Time page links "Clock-in place" / "Clock-out place" to a map. The phone **never asks** for location here: with location not allowed, or no fix within 4 seconds, the tap goes without a place (never held up or refused). Web clock taps carry no place | built (phone, where allowed) |
| 12 | Kiosk mode | Settings › Time Clock switches it on; a manager signs in on a tablet and opens the kiosk (`/crm/time-kiosk`): a keypad, each person's own PIN (set in Settings › Time Clock, 4–8 digits, one person per PIN — the same PIN the bar till uses), Clock in/out or Break; five wrong PINs and it waits ten minutes; the entry says "Time clock kiosk". **Not built:** a photo at the tap, a kiosk locked to one place, a tablet that is not signed in by a manager | built (PIN kiosk) |
| 13 | Entries moved by a phone tap marked for the approver | `time_entry.time_set_by_phone`: true when a tapped moment differs from when the server heard it by more than 2 minutes (in or out, break taps too); the Time page shows "Time set by the phone" (the stricter "sent late" flag stays for 5+ minutes). Hand clock-ins were wrongly saved as automatic (`isAutoClocked: true`); fixed | built |

**Unverified:** the Clock screen has not been run on a device; the geofence test posts locations to the real server, the phone's
background location task (`src/location`) is untouched and untested here.

**Decision for the owner (answered 10/31):** the entry is now marked "time set by the phone" for the approver (row 13).

**Not seen in a real browser / on a real phone:** the Time page's break, place, overtime and mark lines, the Time Clock settings page, the kiosk keypad and the phone's Clock screen break buttons and place stamp were type-checked and the server behind them tested, but not looked at in a browser or run on a device.
