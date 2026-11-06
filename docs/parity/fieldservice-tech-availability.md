# Parity: working hours and time off per tech, on the Dispatch Board and at assignment (field service and basic)

Branch `cloud/fieldservice-depth`, item 7; finished on `cloud/fieldservice-parity`, item 8 (2026-10-31). Feature id
`tech_availability` (NOT READY, `hidden` in `featureRegistry.ts`).
Server: `server/data/techAvailability.ts`, `/api/availability` (`jobs:dispatch` to edit, copy and clear; `jobs:read` for the day
view and Find a time), and a check inside the shared `jobs.ts` behind `JobOptions.availability` — on a create, a move and
each visit of a repeating series. Screens: `AvailabilityPage.tsx` (menu row "Hours & Time Off"), the Dispatch Board's lanes
(label and time axis), "Find a time" on the job form (`packages/tenant-ui/src/jobs/FindTime.tsx`), the Schedule's muted
business hours, the Time page's "Time off" tag, and the existing "Book anyway" question on Jobs, Schedule and Dispatch.
Tables: `tech_hours` (0042; 0055 adds `kind`, `ends_next_day`, `starts_on`, `ends_on` and drops the one-window-a-day
index), `tech_time_off` (0042), `time_entry.time_off_id` (0055). Test: `tests/tech-availability.test.ts` (58 cases, both
verticals, fails without the change — run both ways 2026-10-31).

**Leaders reviewed (read 2026-10-30, their own help pages):**
ServiceTitan — [Use Technician Shifts](https://help.servicetitan.com/docs/use-technician-shifts-1).
Jobber — [Schedule overview](https://help.getjobber.com/en/articles/schedule-overview-new-schedule/) and, for time off, its
[community thread on employee time off](https://community.getjobber.com/discussions/team-management/employee-time-off/4091)
(a forum, not a help page: it is what Jobber's own users say Jobber lacks).
Housecall Pro's help pages for hours and time off were not found; no claim is made about it.

| # | Leader (from its page) | Ours | Mark |
|---|---|---|---|
| 1 | Jobber: working hours per team member, in the profile. ServiceTitan: shifts per technician | Shifts per person (a window on a weekday, as many a day as needed), opt-in: a tech with none is available any time | matches |
| 2 | ServiceTitan: time off is its own shift type, and wins over regular shifts | Time off is whole days (a range) or part of one day; it wins over shifts | matches |
| 3 | Jobber: **no native time off** (users fake it with jobs and tasks) | Time off with a note, listed per person, removable (asked first, never a browser pop-up) | beats Jobber |
| 4 | ServiceTitan: shifts as bars on the Dispatch Board — grey for time off | Each lane carries a time axis (6 am–8 pm, widened when a shift or job runs outside it): regular shifts as bars, on call striped, time off grey over them, the lane's jobs as ticks beneath; the label ("Off today", "Away 12:00 pm–2:00 pm", "Works 8:00 am–12:00 pm and 1:00 pm–5:00 pm") stays. `GET /api/availability/day` serves the bars (`bars[]`, minutes from midnight) | matches |
| 5 | ServiceTitan: its page does not say whether assigning outside a shift warns or blocks. Jobber: warns "Unavailable" for a conflicting appointment, nothing for working hours or time off | Giving a job to someone off or outside their hours asks first: a 409 `unavailable` with the reason in words and **Book anyway**, recorded in the audit log — on create and on a move, for the lead and for every helper | beats Jobber; unknown for ServiceTitan |
| 6 | "Refused" vs "warned" | **Warned** (owner decision — see below), the same answer a travel-time warning gives | decision |
| 7 | Jobber: "Find a Time" only offers slots inside working hours | **Find a time** on the job form (and the API, `GET /api/availability/find`): open slots of the job's length, for the person picked or anyone, inside their shifts (regular first, on call marked) — or the business's opening hours for a person with no shifts — around the jobs they lead or help on, with the drive to the job's address from the job before and to the job after (the same estimate the save checks), never over time off, never before now on the company's clock. A slot picked fills the day, time and person; the save re-checks under the lock. Exposed as `findOpenSlots()` for the AI call answering (item 12) | beats Jobber (Jobber's offers hours only; ours counts jobs and drive) |
| 8 | ServiceTitan: on-call and overnight shift types; recurring shifts; copy; mass delete | On-call shifts (bookable, drawn and offered apart), overnight shifts (end on the next day; the tail counts on that day), split shifts (several a day), a pattern with a first and last day; "Copy shifts to…" onto any number of people (replacing theirs); "Clear shifts for selected" across people. Validated by field (overlaps, an overnight that is not, a last day before the first) | matches |
| 9 | ServiceTitan: time off can create a timesheet automatically | "Put it on the timesheet" on time off (a person with a login): one `time_entry` a day for the day's regular hours — the business's hours when they have no shifts, 8 h on a weekday when nothing says — or part of a day that long; not billable, waiting for approval, tagged "Time off" on the Time page; removed with the time off unless already approved | matches |
| 10 | Jobber: company business hours muted on the calendar | The Schedule greys a closed day (week, month, by-person week) and the hours before opening and after closing (day, day by person), from `company.settings.businessHours` (Settings › Company); still droppable; a legend swatch says what the grey is | matches |
| 11 | ServiceTitan: permissions to view / edit shifts / bulk delete | View the day and Find a time: `jobs:read`. Edit shifts and time off, copy, mass clear: `jobs:dispatch` (managers and admins). Notes on time off are only returned to `jobs:dispatch` | matches |
| 12 | Repeating visits (a series) | Every visit of a series is checked against shifts and time off: a visit on a day off is listed back with its sentence (not made); none bookable → a 409 `unavailable` the office may **Book anyway**, which makes them all and records it | matches (our own gap, closed) |
| 13 | Online booking | Not changed: the public booking page keeps its own availability | out of scope |

**Parity verdict:** every row is built and tested on both verticals; the trade is at full parity for this doc. Not seen in
a real browser: the shift editor, Find a time, the Schedule's muting and the Dispatch Board's axis were verified by the
server suite and `build:web` only.

**For a later item (live AI call answering):** book through
`findOpenSlots(exec, companyId, { from, days?, durationMinutes, personIds?, at?: { lat?, lng?, address? }, stepMinutes?, limit?, notBefore?: { date, minutes } })`
in `apps/unified/server/data/techAvailability.ts` — it returns `{ from, days, durationMinutes, slots: OpenSlot[], people }`,
each slot `{ date, startsAt, endsAt, personId, kind, name, shift: 'regular' | 'on_call', driveBeforeMinutes, driveAfterMinutes }`;
then `POST /api/jobs` (or the shared create) with that day, time and person, which re-checks under the job lock.

**Decision for the owner:** a job given to someone who is off is a *warning you can book past*, not a refusal — a customer with
no heat on a day the tech is "off" still gets a truck. If you would rather refuse outright for time off (but not for hours),
that is one line in `checkAvailability`.
