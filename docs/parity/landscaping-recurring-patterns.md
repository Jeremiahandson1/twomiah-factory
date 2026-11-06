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
| 4 | Custom intervals in days ("every 10 days") with excluded days — Service Autopilot ([custom schedule](https://support.serviceautopilot.com/hc/en-us/articles/360045481671-Create-Custom-Schedule-for-a-Recurring-Job)); Yardbook (days/weeks/months/years — [recurring job](https://support.yardbook.com/faq-i-want-to-set-up-a-recurring-job/)) | **matches** (10/31 parity round, row 18; `job_repeat_patterns`, hidden): **Every few days…** — every 1 to 90 days, never on chosen weekdays, skipping listed days (a holiday, a week away); a skipped occurrence is left out, not moved. Test: `job-repeat-patterns.test.ts`. |
| 5 | Nth weekday of the month ("1st and 3rd Friday") — Jobber custom monthly | **matches** (10/31 parity round, row 18): **A weekday of the month…** — the 1st, 2nd, 3rd, 4th and/or last of a chosen weekday, every month. Test: `job-repeat-patterns.test.ts`. |
| 6 | Annual repeat — Jobber custom | **matches** (10/31 parity round, row 18): **Every year**, the same day (Feb 29 falls on Feb 28). Test: `job-repeat-patterns.test.ts`. |
| 7 | Edit one visit or "this and future visits" — Jobber ([visits](https://help.getjobber.com/en/articles/visits/)) | **matches** (10/31 parity round, row 19): a visit's **Change this and future visits** changes it and every later visit of its series still to do — time, price, description and, for a weekly series, its days (the old days still to do are cancelled, the new ones made to the series' end). **Edit** changes one visit. Started, done and cancelled visits are never touched. Test: `job-repeat-patterns.test.ts`. |
| 8 | "As needed" recurring job with visits added later in bulk (the basis of snow) — Jobber | **covered by gap 5** (storm mode), not by the repeat box. |
| 9 | Master schedules / season windows with renewal — Service Autopilot | **matches** (10/31 parity round, row 20; `route_board_tools`, hidden): a route has a season (start and end day). Visits are made only inside it, by hand or by the top-up; setting or shortening it cancels the visits still just scheduled outside it; near its end the Route Board offers **Renew for next season** (the same days a year on). Test: `landscaping-route-board-parity.test.ts`. |

## Built, and the test that proves it

`apps/unified/tests/landscaping-job-weekdays.test.ts` (6 tests). Without the change `weekdays` was ignored, so Mon + Thu came
out as six Mondays.

- `packages/tenant-backend/src/time/series.ts`: optional `weekdays` on `seriesDays`, `describeSeriesDays` says "Every week on Mon and
  Thu, 6 times". Additive: no `weekdays` = the old stepping (the booking engine and agreements still call it unchanged).
- `job_series.weekdays` (migration 0044, nullable). `jobs.ts`: `repeat.weekdays` is read only where `options.repeatWeekdays` is on
  (landscaping); elsewhere it is refused in words; weekdays with a monthly repeat, or a day outside Sunday–Saturday, are refused with nothing made.
- Job form (`packages/tenant-ui` JobsPage, shared by every vertical): the day buttons show only when `config.repeatWeekdays` is set — landscaping's screens config. Other verticals' repeat box is unchanged.

## Not checked

- The 52-visit cap (row 18): with `job_repeat_patterns` on, a series runs up to a YEAR from its first visit and up to 366 visits,
  so Mon + Thu for a year (104) is one series. Longer than a year is refused in words; the Route Board tops itself up for routes.
- The double-booking check runs per visit as before; visits skipped for a clash are listed back in the reply (unchanged).
