# Landscaping parity — gap 2: recurring patterns (custom weekday sets)

Branch `cloud/landscaping-depth`. Researched 2026-10-30 from each leader's own help centre. Marks: **matches**, **beats**,
**not doing (why)**, **NOT BUILT (what parity needs)**. "UNCONFIRMED" = no official page could be read.

**Status: the brief's item (a repeating job on chosen weekdays, e.g. Mon + Thu) is built on the server and the job form.
Jobber's wider "custom" repeat is not all built — see the NOT BUILT rows. Not opened in a browser yet.**

| # | Capability (leader, source) | Ours |
|---|---|---|
| 1 | Weekly, every other week — Jobber ([create a recurring job](https://help.getjobber.com/en/articles/create-a-recurring-job/)) | **matches** (already there: every 1–4 weeks, monthly) |
| 2 | Custom repeat on several days of the week (Jobber's example: Mondays and Wednesdays) | **matches**: the job form shows Mon–Sun buttons under a weekly repeat; the visits fall on exactly those days, every 1–4 weeks, from the first visit's week (a chosen day before the first visit in that week is not made). Landscaping only, behind `jobs.repeatWeekdays`. |
| 3 | End after a duration or on a date — Jobber | **matches** (a number of visits, or a last day; a count also works) |
| 4 | Custom intervals in days ("every 10 days") with excluded days — Service Autopilot ([custom schedule](https://support.serviceautopilot.com/hc/en-us/articles/360045481671-Create-Custom-Schedule-for-a-Recurring-Job)); Yardbook (days/weeks/months/years — [recurring job](https://support.yardbook.com/faq-i-want-to-set-up-a-recurring-job/)) | **NOT BUILT.** Parity needs a day-interval frequency and a skip list on the series. |
| 5 | Nth weekday of the month ("1st and 3rd Friday") — Jobber custom monthly | **NOT BUILT.** Parity needs a monthly frequency that takes (week-of-month, weekday) pairs. |
| 6 | Annual repeat — Jobber custom | **NOT BUILT** (not a landscaping need: seasonal work is a route or an agreement). |
| 7 | Edit one visit or "this and future visits" — Jobber ([visits](https://help.getjobber.com/en/articles/visits/)) | **NOT BUILT** for series made from the job form. Each visit is an ordinary job and can be edited alone; changing the rest of a series at once needs a series-edit action. (Route visits are re-timed/reassigned as a group from the Route Board — gap 1.) |
| 8 | "As needed" recurring job with visits added later in bulk (the basis of snow) — Jobber | **covered by gap 5** (storm mode), not by the repeat box. |
| 9 | Master schedules / season windows with renewal — Service Autopilot | **not doing**: a Route Board route is the weekly pattern and tops itself up (gap 1). |

## Built, and the test that proves it

`apps/unified/tests/landscaping-job-weekdays.test.ts` (6 tests). Without the change `weekdays` was ignored, so Mon + Thu came
out as six Mondays.

- `packages/tenant-backend/src/time/series.ts`: optional `weekdays` on `seriesDays`, `describeSeriesDays` says "Every week on Mon and
  Thu, 6 times". Additive: no `weekdays` = the old stepping (the booking engine and agreements still call it unchanged).
- `job_series.weekdays` (migration 0044, nullable). `jobs.ts`: `repeat.weekdays` is read only where `options.repeatWeekdays` is on
  (landscaping); elsewhere it is refused in words; weekdays with a monthly repeat, or a day outside Sunday–Saturday, are refused with nothing made.
- Job form (`packages/tenant-ui` JobsPage, shared by every vertical): the day buttons show only when `config.repeatWeekdays` is set — landscaping's screens config. Other verticals' repeat box is unchanged.

## Not checked

- A series' visits are still limited to 52; Mon + Thu for a year is 104 visits, so a year-long twice-weekly series needs two
  jobs or the Route Board (which tops itself up). Raising the cap is a decision for the owner.
- The double-booking check runs per visit as before; visits skipped for a clash are listed back in the reply (unchanged).
