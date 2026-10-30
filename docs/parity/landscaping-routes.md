# Landscaping parity — gap 1: routes that do the work

Branch `cloud/landscaping-depth`. Researched 2026-10-30 from each leader's own help centre (links below). Capabilities are
paraphrased; "UNCONFIRMED" means no official page could be read. Marks: **matches**, **beats**, **not doing (why)**,
**NOT BUILT (what parity needs)**.

**Status: gap 1 is PARTLY built. It is not at parity until the NOT BUILT rows below are done.** What is in the branch is
additive and owner-triggered (a "Make visits" button), not hidden behind a switch, but the gap is still open.

## What the leaders document

| # | Capability (leader, source) | Ours |
|---|---|---|
| 1 | A weekly route is an ordered list of properties per weekday — Jobber master route ([how-to-route](https://help.getjobber.com/en/articles/how-to-route/)), Yardbook ([routing](https://support.yardbook.com/550-routing/)), LMN ([scheduling guide](https://support.golmn.com/hc/en-us/articles/11934249961115-Scheduling-A-Guide)), Aspire ([routes](https://guide.youraspire.com/docs/creating-and-managing-routes)) | **matches** (the existing Route Board) |
| 2 | Reorder stops by drag — Jobber, Yardbook, Service Autopilot ([reverse route order](https://support.serviceautopilot.com/hc/en-us/articles/360045482371-Reverse-Route-Order)) | **matches in function, not in gesture**: up/down buttons call the reorder the server already had (the page never did). **Not doing drag** now: buttons work by keyboard and on touch with no new library; drag is a polish pass. |
| 3 | The route order is the crew's day in the app — Jobber app follows the routing order for untimed visits ([schedule in app](https://help.getjobber.com/es/articles/schedule-in-the-jobber-app/)); Service Autopilot route order drives the mobile apps ([scheduling FAQ](https://support.serviceautopilot.com/hc/en-us/articles/360045476111--Scheduling-FAQ-s)); LMN crews follow route order | **matches (server)**: each stop becomes a dated job, timed from the route's start time in stop order, led by the route's crew; dragging, a new start time, or removing a stop re-times/cancels only the visits still to do. **Unverified on screen:** the tests prove the jobs and times exist and are in the jobs list the Schedule/Crew View read; the Schedule, Crew View and phone screens were not opened. |
| 4 | Recurring work generates visits ahead — Jobber ([visits](https://help.getjobber.com/en/articles/visits/)); Yardbook shows two months ahead ([recurring job](https://support.yardbook.com/faq-i-want-to-set-up-a-recurring-job/)) | **partly**: "Make visits" makes 1–26 weeks on demand and is safe to repeat (one visit per stop per day, enforced by a database index). **NOT BUILT:** visits do not top themselves up; parity needs a daily job that extends each active route to a rolling horizon. |
| 5 | Start a timer on a visit and complete it — Jobber ([jobs in the app](https://help.getjobber.com/en/articles/jobs-in-the-jobber-app/)); LMN crew clock-out prompts completion | **inherited, not verified for route visits**: a visit is an ordinary job, so start/complete and the geofence clock-in apply. "Completing a stop records its time" is **NOT verified** and not built beyond that. |
| 6 | Optimise a route's order — Jobber ([route optimization](https://help.getjobber.com/es/articles/route-optimization-new-schedule/)), Yardbook, LMN, Aspire | **partly**: `/api/day-route` already optimises one person's day of jobs, and route visits are jobs, so it applies to them. **NOT BUILT:** optimising the route's own stop order from the board. |
| 7 | Bill each visit, or one invoice per customer for the month — Jobber (per visit, monthly, on close; [recurring job](https://help.getjobber.com/en/articles/create-a-recurring-job/); [batch create](https://help.getjobber.com/en/articles/batch-create-invoices/): one draft per client); Yardbook ([auto-generate](https://support.yardbook.com/faq-i-want-to-automatically-generate-invoices-from-jobs/): completed jobs in a date range, one invoice per customer, optional grouping by property, undo of a batch); LMN ([invoice automation](https://support.golmn.com/hc/en-us/articles/39888373681435-Invoice-Automation)) | **NOT BUILT.** Landscaping has no per-job invoice today (`verticals/landscaping/settings.ts`: "billed no job on its own"), so this is new, not a hookup. Parity needs: per-visit invoice for a completed visit; a monthly batch that makes ONE draft per customer from completed, not-yet-billed visits (grouped by property if asked), never billing a visit twice, with an undo for the batch. Needs an owner decision, below. |
| 8 | Profitability of recurring work — Jobber job costing covers recurring jobs only as a rolling 30-day profit bar on Grow and above, with no recurring-job reporting or profit alerts ([job costing](https://help.getjobber.com/es/articles/job-costing/)); Yardbook has a per-property/per-customer job-costing report ([job costing report](https://support.yardbook.com/faq-i-want-to-view-a-job-costing-report/)); LMN and Service Autopilot: per-route/property rollups UNCONFIRMED | **NOT BUILT, and it would beat all four.** No leader documents per-route profit. Because visits are jobs, per-visit costing (labour from time entries, materials, expenses; `server/data/jobCosting.ts`) already applies. Parity-and-beyond needs a route/property rollup of visit revenue against crew hours over a date range. |
| 9 | Reassign a whole route to another crew — Yardbook ([route-based assignment](https://support.yardbook.com/route-based-assignment/)) | **NOT BUILT.** Today a route's crew is stamped on its visits when made; changing the route's crew does not move visits already made. |
| 10 | Copy last week's route; route templates — Yardbook ([copy route](https://support.yardbook.com/copy-route/)) | **not doing** — a route here IS the weekly pattern and "Make visits" repeats it, so there is nothing to copy. |

## Corrections to the brief

- The brief says Jobber's job costing skips recurring jobs. Jobber's own help says it covers them as a rolling 30-day bar
  (Grow and above); what it lacks is recurring-job *reporting and alerts*. The opportunity (route/property rollup) stands;
  the premise was overstated.
- No per-route profitability is documented by Jobber, Yardbook, LMN or Service Autopilot (Aspire: UNCONFIRMED).

## Built, and the test that proves it

`apps/unified/tests/landscaping-route-visits.test.ts` (8 tests, boots a landscaping tenant on the real server). With the
Route Board's server file reverted, 7 of the 8 failed and the eighth was made non-vacuous; with it, all pass.

- migration `0041_route_visits`: `recurring_route.start_time`, `job.recurring_route_stop_id`, unique index one visit per stop per day.
- `POST /api/recurring-routes/:id/visits` (jobs:create), `GET /api/recurring-routes/:id/visits` (jobs:read; money withheld
  from seats without invoices:read).
- Reorder, start-time change, stop delete and route delete keep the visits still to do in step; done, started and past
  visits are never touched.

## Not checked

- A visit's crew lead is not checked against the double-booking rule the job form applies; a route is treated as the
  authority. A crew member already booked at that time is not warned.
- Nothing was run against a live tenant (rule 8).
