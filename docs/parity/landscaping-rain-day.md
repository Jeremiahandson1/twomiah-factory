# Landscaping parity — gap 3: rain day

Branch `cloud/landscaping-depth`. Researched 2026-10-30 from each leader's own help centre. Marks: **matches**, **beats**,
**not doing (why)**, **NOT BUILT (what parity needs)**. "UNCONFIRMED" = no official page could be read.

**Status: built on the server and on the Route Board screen. Not opened in a browser yet.**

| # | Capability (leader, source) | Ours |
|---|---|---|
| 1 | Push out a day's jobs at once, by chosen shift (1 day, 2 days, a week) or a target date; exclude single jobs — Yardbook ([push out multiple jobs](https://support.yardbook.com/faq-i-want-to-push-out-multiple-jobs-at-once/)) | **matches** (target date added in the 10/31 parity round, row 16; `rain_day_tools`, hidden): **To a date…** moves the day's visits exactly to the chosen date (Jobber's Move Visits — a source day and a target day; no Sunday rule). Test: `landscaping-rain-day-parity.test.ts`. |
| 2 | Shift a whole week of jobs by N days — Yardbook ([shift by week](https://support.yardbook.com/reschedule-shift-jobs-by-week/)) | **matches** (10/31 parity round, row 16; `rain_day_tools`): **Through** a later day pushes every day of the run by the same shift in one preview and one push — each day by its own landing, so no visit moves twice. Test: `landscaping-rain-day-parity.test.ts`. |
| 3 | Pick appointments and move them, review before confirming — Jobber ([reschedule & reassign](https://help.getjobber.com/en/articles/schedule-overview-new-schedule/)); Aspire preview of new dates ([bulk reschedule](https://guide.youraspire.com/docs/es/bulk-reschedule-feature)) | **matches**: preview lists every job, its time and where it lands, then Push. |
| 4 | Skip a job whose same job already has a visit on the target day — Jobber legacy Move Visits | **beats**: such a visit stays and is listed with the reason, never doubled (a database rule backs it for route visits). |
| 5 | Order and time kept — Aspire keeps routes and times | **matches**: every job keeps its time, so a route's stop order is the same on the new day. |
| 6 | Tell customers: Jobber does NOT notify on bulk moves; Yardbook's bulk SMS is a separate list tool ([bulk text](https://support.yardbook.com/send-text-message-in-bulk/)); Aspire: undocumented; LMN, Service Autopilot: UNCONFIRMED | **beats**: one button also texts each affected customer once, from the business's own number, in their words, with the old and new day. Held to 8:00–20:00 on the business's clock (later at night waits for the morning), cancellable from the contact's scheduled texts for a couple of minutes before it goes, and the customer's opt-out, a missing phone number and the usage wallet decide as for every text. Customers who cannot be texted are listed. |
| 7 | Forecast-driven "Reschedule Jobs" — Yardbook ([weather report](https://support.yardbook.com/weather-report/)) | **matches** (10/31 parity round, row 17; `rain_day_tools`): the panel shows the next seven days' weather (US Weather Service, free, no key) — chance, rain or snow, and each day's open visits — and **Push this day** on a wet one fills the rain day in. Owner step: none (US only). Test: `landscaping-rain-day-parity.test.ts`. |
| 8 | Run in the background with an email when finished — Yardbook | **matches** (10/31 parity round, row 29; `rain_day_tools`): a push of more than 150 visits (or one asked to) runs in the background, answers at once, and emails the person who started it when it is done or if it failed. Test: `landscaping-rain-day-parity.test.ts`. |
| 9 | Undo | **beats** (10/31 parity round, row 29; `rain_day_tools`): every push is kept (`rain_day_run`) and **Undo** puts back each visit still where it put it, lists the ones moved or started since, and cancels its texts not yet sent. Test: `landscaping-rain-day-parity.test.ts`. |

## Built, and the test that proves it

`apps/unified/tests/landscaping-rain-day.test.ts` (6). `POST /api/recurring-routes/rain-day` ({ date, shift, routeId?,
excludeJobIds?, notify?, message?, dryRun }): a preview by default (nothing changes unless `dryRun: false`). Only jobs
not yet started move (scheduled, pending, confirmed, dispatched). Refused to seats without `jobs:update` and
`jobs:dispatch` (the dispatch board's own two); texts also need `sms:send`, and a request for texts without it is refused whole
before anything moves. The existing `bulkRescheduleJobs` is untouched (it sets one date for everything and can break the
one-visit-per-stop-per-day rule).

## Not checked

- The screen (Rain day panel under the Route Board) has not been opened in a browser.
- Skip Sundays (follow-up 10/30): a business setting, ON by default ("Skip Sundays when moving visits", on the Rain day panel). A push that would land on a Sunday goes to Monday. Turned off, it lands on the Sunday as before. Not browser-clicked beyond the toggle itself.
- Texts were proven to be queued correctly (who, what, when). Delivery through a live number was not tested (rule 8: no live API from a test).
