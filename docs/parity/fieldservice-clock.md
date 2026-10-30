# Parity: clock in and out on the phone for trades, beside the geofence's automatic clock-in (field service and basic)

Branch `cloud/fieldservice-depth`, item 2. No new feature id (Time Tracking and GPS Tracking already gate it).
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
| 4 | Pay accuracy of an offline tap | `at` is accepted up to 48 hours back and not in the future; a clock-out before the clock-in is refused; without `at` the server stamps its own time as before | decision — see below |
| 5 | Office approval of hours | The Time page's approvals are unchanged; managers reach them from the Clock screen | matches |
| 6 | Who clocks | `time:create` (field seats and up); a Viewer is refused by the server | matches |
| 7 | Geofence automatic clock **out** on leaving | Exists in the server; not changed here. Only clock-in is tested | not re-proved |
| 8 | Breaks, overtime alerts, GPS stamp on the tap, kiosk | Not built | not doing |

**Unverified:** the Clock screen has not been run on a device; the geofence test posts locations to the real server, the phone's
background location task (`src/location`) is untouched and untested here.

**Decision for the owner:** a phone clock can be wrong, so a tapped time can move an entry up to 48 hours either side of when it
arrives (never into the future). The office still approves the hours; if you want the entry marked "time set by the phone" for the
approver, that is one flag on the entry.
