# Landscaping parity — gap 5: storm mode for snow

Branch `cloud/landscaping-depth`. Researched 2026-10-30 from each leader's own help centre. "UNCONFIRMED" = no official page could
be read (Service Autopilot's help pages did not render; only its marketing pages were readable, and those are flagged). Marks:
**matches**, **beats**, **not doing (why)**, **NOT BUILT (what parity needs)**.

**Status: built on the server and the desktop Snow & Ice screen. The phone screens ("Today's route", "Log snow visit") are gap 7
and are not built yet; until they are, the crew's side is proven only at the server.** Nothing has been opened in a browser.

## What the leaders document

| # | Capability (leader, source) | Ours |
|---|---|---|
| 1 | One-click "a storm is here": make visits for many snow jobs at once, filtered by tag, assigned to a crew, with instructions — Jobber "Create New Visits" ([snow workflow](https://help.getjobber.com/es/articles/create-new-visits-for-existing-recurring-jobs-snow-removal-workflow-new-schedule/), limit 100 jobs per batch); Yardbook Quick Dispatch ([snow removal](https://support.yardbook.com/950-snow-removal/)) | **beats**: `POST /api/snow/storms` starts a storm and sends it out in the same call to every ACTIVE contract on a Route Board route, on a customer tag, on a hand-picked list, or all of them — no batch limit, a job per contract for the chosen crew and day, in the route's drive order. Paused and ended contracts are never sent. Sending twice (or a route and then an overlapping tag) adds nothing: one stop per contract per storm, a database index. |
| 2 | Reusable snow routes that are reordered, then dispatched — Yardbook route templates; Aspire "Set Route and Sequence #" ([events method](https://guide.youraspire.com/set-up-for-events-method-of-snow-management)); LMN Unscheduled Routes ([scheduling FAQ](https://support.golmn.com/hc/en-us/articles/11935928750107-Scheduling-FAQ)) | **matches**: the Route Board route IS the snow route; its stop order is the dispatch order. |
| 3 | Crew sees the storm's work on the phone — Aspire events in crew mobile + Snow Mode ([crew mobile](https://guide.youraspire.com/docs/crew-mobile-in-the-field)); Service Autopilot app (marketing only) | **matches on the server, phone screen NOT BUILT (gap 7)**: each stop is an ordinary job for the crew (Schedule, Crew View, Today's route) and `GET /api/snow/storms/mine/stops` returns the signed-in crew's open stops. |
| 4 | Crew logs the visit: pushes, salt, photos — Aspire (material allocation per ticket; no dedicated salt log), Service Autopilot (marketing: before/after photos, timestamps) | **matches**: `POST /api/snow/storms/stops/:id/log` takes pushes, snowfall, salt, hours and a note; the stop's job is completed (so the same texts/review/hooks any finished job runs); photos go on the stop's job through the existing `/api/photos` (**not enforced** — "require photos" is NOT BUILT). A crew seat logs only its own stops and never sees what a visit bills. Replaying a log request returns the first visit and bills nothing twice (matters for the offline queue). |
| 5 | Billing rules per contract: per occurrence, depth ranges, seasonal, T&M — Aspire ([contract approaches](https://guide.youraspire.com/snow-contract-approaches)); SA (marketing) hourly / flat / per inch / per push / per event | **matches**: the contracts' own rules (per push, per event, per inch, seasonal, trigger depth, salt on top) price every storm visit — the SAME functions the Snow Billing page uses, unchanged. **Depth-RANGE tiers (1–3 in / 4–8 in at different prices): NOT BUILT** — parity needs a rate table of depth bands on a contract and a lookup in `computeSnowEventCharge`; per inch plus a trigger depth is what exists. |
| 6 | Hourly billing from the crew's clock — LMN: punching out of an hourly task makes a draft invoice from timesheet hours ([invoice automation](https://support.golmn.com/hc/en-us/articles/39888373681435-Invoice-Automation)); Aspire time-and-materials | **matches**: a fifth contract mode, `hourly` (an hourly rate, required above zero like every mode's own rate). The crew's Start on the stop starts the clock; logging with no typed hours bills the hours between Start and now to the hundredth; typed hours win. A visit with no hours (and no salt) is refused rather than billed at $0. Also loggable on the Snow Billing page with "Hours on site". **Not doing:** material mark-up on time-and-materials (Aspire) — no mark-up model exists here; that belongs with the overhead/markup work in the budget doc. |
| 7 | Bulk-bill a storm — Aspire "approve selected tickets" releases them to the Invoicing Assistant ([pending approval](https://guide.youraspire.com/docs/reviewing-snow-work-tickets-pending-approval)); Jobber batch create invoices ([batch](https://help.getjobber.com/en/articles/batch-create-invoices/)); Yardbook Auto Generate Invoice | **matches**: `POST /api/snow/storms/:id/bill` previews (default) then, with `confirm`, makes ONE DRAFT per contract to its customer from that storm's unbilled, charged visits only (an earlier unbilled visit stays for the contract's own bill), each contract in its own locked transaction so a second run finds nothing and one contract with no customer never holds up the rest. Seasonal visits (no charge) are listed as skipped. Deleting a draft puts its visits back to unbilled. **Not built:** editing a visit's amount before billing (Aspire's price override) — today the visit is deleted and re-logged. |
| 8 | Log many sites at once from the office ("everyone got 1 push") | **beats** (no leader documents it): `POST /api/snow/storms/:id/log-all` logs every open stop with one set of figures; stops that cannot take them (an hourly contract with no clock) are listed and left open. |
| 9 | Close a storm out — Aspire uncomplete / delete zero-cost tickets | **matches**: ending a storm skips stops nobody served and cancels their still-scheduled jobs so they leave the crews' lists; logged visits stay for billing. |
| 10 | Tell customers (weather prevents service) — Service Autopilot (marketing) | **not doing here**: the job's done/on-site texts run where the business turned them on; a custom storm message is gap 6 / rain day. |
| 11 | Duration scaled by severity — LMN | **not doing**: no per-stop duration on snow stops; the clock records what happened. |

## Built, and the test that proves it

`apps/unified/tests/landscaping-snow-storm.test.ts` (8 tests, real landscaping tenant). With the storm mount removed, all 8 fail;
with it, all 8 pass; the existing snow tests (`landscaping-fixes`, `role-check-1023`) still pass.

- migration `0046_snow_storm`: `snow_storm`, `snow_storm_stop` (unique per storm and contract), `snow_contract.hourly_rate`,
  `snow_event.hours`, `snow_event.storm_id`. Additive.
- No new feature id: everything sits behind the existing `snow_billing` feature. Permissions: start/send out/skip/end/log-all
  `jobs:dispatch` (+ `jobs:create` / `jobs:update`); a crew's own start/log `jobs:update`; bill `invoices:create`; money only
  with `invoices:read`. The test proves a crew seat and a viewer are refused each office act.
- Screen: a "Storms" section on Snow & Ice Billing (`SnowStormPanel.tsx`) and an Hourly mode / hours box on the page. **Written
  and built, not opened in a browser.**

## Not built

Depth-range pricing, price override before billing, required photos, salt in tons, phone screens (gap 7), automatic start from a
weather feed (nobody documents one).
