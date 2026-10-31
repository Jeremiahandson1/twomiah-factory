# Parity: working hours and time off per tech, on the Dispatch Board and at assignment (field service and basic)

Branch `cloud/fieldservice-depth`, item 7. Feature id `tech_availability` (NOT READY, `hidden` in `featureRegistry.ts`).
Server: `server/data/techAvailability.ts`, `/api/availability` (`jobs:dispatch` to edit, `jobs:read` for the day view), and a
check inside the shared `jobs.ts` behind a new option (`JobOptions.availability`). Screens: `AvailabilityPage.tsx` (menu row
"Hours & Time Off"), the Dispatch Board's lane labels, and the existing "Book anyway" question on Jobs, Schedule and Dispatch.
Tables (migration 0042): `tech_hours`, `tech_time_off`. Test: `tests/tech-availability.test.ts`.

**Leaders reviewed (read 2026-10-30, their own help pages):**
ServiceTitan — [Use Technician Shifts](https://help.servicetitan.com/docs/use-technician-shifts-1).
Jobber — [Schedule overview](https://help.getjobber.com/en/articles/schedule-overview-new-schedule/) and, for time off, its
[community thread on employee time off](https://community.getjobber.com/discussions/team-management/employee-time-off/4091)
(a forum, not a help page: it is what Jobber's own users say Jobber lacks).
Housecall Pro's help pages for hours and time off were not found; no claim is made about it.

| # | Leader (from its page) | Ours | Mark |
|---|---|---|---|
| 1 | Jobber: working hours per team member, in the profile. ServiceTitan: shifts per technician | A weekly window per person (one a day), opt-in: a tech with none set is available any time | matches |
| 2 | ServiceTitan: time off is its own shift type, and wins over regular shifts | Time off is whole days (a range) or part of one day; it wins over hours | matches |
| 3 | Jobber: **no native time off** (users fake it with jobs and tasks) | Time off with a note, listed per person, removable | beats Jobber |
| 4 | ServiceTitan: shifts as bars on the Dispatch Board — grey for time off | The lane is greyed and labelled "Off today" / "Doesn't work Saturdays"; part of a day is amber ("Away 12:00 pm–2:00 pm"); on hours "Works 8:00 am–4:00 pm". Labels, not bars on a time axis (our board is lanes of cards, not a time grid) | matches in effect; no time-axis bars |
| 5 | ServiceTitan: its page does not say whether assigning outside a shift warns or blocks. Jobber: warns "Unavailable" for a conflicting appointment, nothing for working hours or time off | Giving a job to someone off or outside their hours asks first: a 409 `unavailable` with the reason in words and **Book anyway**, recorded in the audit log — on create and on a move, for the lead and for every helper | beats Jobber; unknown for ServiceTitan |
| 6 | "Refused" vs "warned" | **Warned** (owner decision — see below), the same answer a travel-time warning gives | decision |
| 7 | Jobber: "Find a Time" only offers slots inside working hours | Not built: the Schedule does not suggest open slots | not doing — parity needs a find-a-time search over hours, jobs and drive time |
| 8 | ServiceTitan: on-call and overnight shift types; recurring shifts; copy; mass delete | One window a day, set per person; no on-call, overnight or split shifts; no copy between people | not doing |
| 9 | ServiceTitan: time off can create a timesheet automatically | Not connected to time tracking or payroll | not doing |
| 10 | Jobber: company business hours muted on the calendar | Not built | not doing |
| 11 | ServiceTitan: permissions to view / edit shifts / bulk delete | View the day: `jobs:read`. Edit hours and time off: `jobs:dispatch` (managers and admins). Notes on time off are only returned to `jobs:dispatch` | matches |
| 12 | Repeating visits (a series) | A series of repeating visits is **not** checked against hours or time off; a single visit is | gap — stated, not hidden |
| 13 | Online booking | Not changed: the public booking page keeps its own availability | out of scope |

**Parity verdict:** hours, time off, the board and the warning exist and are tested. Rows 7–10 and 12 are what a full match would
still need; none is started.

**Decision for the owner:** a job given to someone who is off is a *warning you can book past*, not a refusal — a customer with
no heat on a day the tech is "off" still gets a truck. If you would rather refuse outright for time off (but not for hours),
that is one line in `checkAvailability`.
