# Landscaping parity — gap 7: the crew's phone screens ("Today's route", "Log snow visit")

Branch `cloud/landscaping-depth`. Researched 2026-10-30 from each leader's own help centre (links per row). "UNCONFIRMED" = no
official page could be read. Marks: **matches**, **beats**, **not doing (why)**, **NOT BUILT (what parity needs)**.

**Status: built; the screens are drawn from data (`apps/mobile/src/trades/landscaping.ts`), and the very requests they make are run
against a real landscaping tenant by `apps/unified/tests/landscaping-phone-day.test.ts`. NOT verified on a device or simulator —
nothing was run in a phone or a browser in this session. The offline wiring is NOT done (see the end).**

Where they live on the phone: **More → Route Board** opens "Today's route" for a landscaping seat (the Route Board's desktop row is
mapped to it in `apps/unified/scripts/mobile-parity.ts`; the phone's five-slot bar is full, so it is not a tab). Open snow stops are
listed at the top of the same screen and each opens "Log snow visit".

## What the leaders document

| # | Capability (leader, source) | Ours |
|---|---|---|
| 1 | The crew's day in route order — LMN Crew "Routes & Groups" ([LMN Crew App](https://support.golmn.com/hc/en-us/articles/40281387329435)); Service Autopilot route order from the dispatch board, only dispatched jobs shown ([Team App](https://support.serviceautopilot.com/hc/en-us/articles/360045478131-Team-App-Log-In-and-see-Jobs)); Jobber untimed visits follow routing order ([schedule](https://help.getjobber.com/es/articles/schedule-in-the-jobber-app/)); Yardbook route order ([route order](https://support.yardbook.com/view-jobs-in-route-order-web-application/)) | **matches**: today's visits for the signed-in person only (a crew seat reads only its own jobs, the server decides), sorted by start time — which the Route Board sets from the stop order — and numbered 1, 2, 3. |
| 2 | Start / finish a stop with a timer — LMN Crew play button; Jobber "start timer, complete visit"; Service Autopilot "Complete Work" | **matches**: Start and Finish run the Schedule's own `POST /api/jobs/:id/start|complete`, so the visit's time is recorded (gap 1) and every hook runs (customer texts, the visit-done message, review request). Finish asks first. LMN's per-person crew timers and Crew Score: **not doing** (the geofence clock-in and job costing already exist). |
| 3 | Directions — LMN "Navigate" opens a maps app; Jobber Apple Maps / Google Maps / Waze; Aspire opens the address in Google Maps | **matches** (10/31 parity round, row 11). Directions open in the crew's chosen maps app (Google Maps, Apple Maps on iPhone, Waze), by each app's universal address, and the choice is remembered on the phone (Change maps app on the visit). An in-app map of the day's numbered stops with the next stop marked (row 14). Spoken turn-by-turn is the maps apps' own. Test: `tests/mobile/landscaping-crew-day.test.ts`. |
| 4 | Call / text the customer — Jobber "call, 'on my way' text" | **matches** (10/31 parity round, row 10). On my way with Jobber's 5–60 minute picker: the visit is marked on the way and, where the business texts arrivals, the customer is told the minutes picked (through the shared sender, opt-out kept). Kept on the phone with no signal; one sent over 30 minutes late is recorded, not texted. Tests: `landscaping-parity-phone.test.ts`, `tests/mobile/landscaping-route-offline.test.ts`. |
| 5 | A note from the crew — LMN visit updates; Jobber notes; Yardbook `[job_notes]` | **matches**: "Note for the customer" saves the customer-visible note that goes in the visit-done message and portal (gap 6; gated by `visit_reports`, which is NOT READY). Internal job notes stay on the Job page. |
| 6 | Photos — LMN task/site photos; Jobber camera on the visit; Yardbook before/after from camera or gallery ([photos](https://support.yardbook.com/before-after-photos/)) | **matches** (10/31 parity round, row 9). **Photos — before and after** on the visit (where the business has job photos): the job's own photo strip with a Before / After choice, from the camera or the phone's photos. With no signal each photo stays a file on the phone and goes through the offline queue (file, then the save with its kind), shown as waiting. Drawing on a photo — arrows, circles, words — with `photo_markup` (hidden; now offered to landscaping). The marked copy goes to the customer in place of the original. The visit-done text carries the first before-photo and then the after-photos; the email carries every one, labelled. Without job photos the older after-photo form stays. Tests: `tests/mobile/landscaping-visit-photos.test.ts`, `apps/unified/tests/landscaping-parity-phone.test.ts`. |
| 7 | Skip a visit with a reason and flag it to reschedule — LMN crew lead | **matches** (10/31 parity round, row 12; `visit_skip`, hidden). Couldn't do it: a reason from the list, rebook or not, a note; the visit goes on hold; the office rebooks it to a day or closes it on the Route Board. Works offline. Tests: `landscaping-parity-phone.test.ts`, `tests/mobile/landscaping-crew-day.test.ts`. |
| 8 | Materials / quantities used, required forms before finishing — LMN, Aspire, Jobber checklists ([jobs in app](https://help.getjobber.com/en/articles/jobs-in-the-jobber-app/)) | **matches** (10/31 parity round, row 13). Materials used per visit (`visit_materials`, hidden): from the price book with its cost, or typed; offline; counted in job costing. The business's required checklists (`job_checklists`, now offered to landscaping) are linked from the visit, and Finish is refused until they are done. Tests: as above. |
| 9 | Map of the day's jobs; Finish Day summary — Jobber map, Service Autopilot map and "Finish Day" | **matches** (10/31 parity round, row 14; `crew_day_map`, hidden). The day's numbered stops on a map (Google Static Maps with the server's key; owner step: the Maps Static API on), the next stop marked, and Finish Day: done, could not do, still to do, hours, notes still owed. Tests: as above. |
| 10 | Storm / snow mode in the field — Aspire "Snow Mode" ([Crew Mobile](https://guide.youraspire.com/docs/crew-mobile-in-the-field)) | **matches the documented basics**: "Log snow visit" lists the storm's stops, Start stamps the clock (hourly contracts bill by it), Log takes pushes, snowfall, salt yes/no, hours and a note and prices by the contract's own rules; a replayed log returns the same visit and never bills twice. Skip is the office's (dispatch) call. A crew seat is never shown what the visit bills. Depth tiers, required photos and salt in tons: **NOT BUILT** (gap 5 doc). |
| 11 | Works with no signal — LMN: punches, notes, task photos offline; Jobber: forms, notes, timers offline ([update](https://productupdates.getjobber.com/134787-keep-working-in-jobber-even-without-internet)); Yardbook: UNCONFIRMED | **matches** (10/31 parity round, rows 8 and 9). Start and Finish go through the offline queue under the shared job flow's `job:<id>`, each carrying the moment it was tapped (`tappedAt`, kept by the server). The note, snow Start and Log, and photos were already queued. A visit or stop with a save on the phone says **Waiting to send** on the list and the visit, never the status the server has not heard of. Tests: `tests/mobile/landscaping-route-offline.test.ts`, `apps/unified/tests/landscaping-parity-phone.test.ts`. |

## Built, and the test that proves it

`apps/unified/tests/landscaping-phone-day.test.ts` (5 tests). Without `apps/mobile/src/trades/landscaping.ts` the file cannot load and
every test fails; with it all pass. It proves: a crew seat's list holds only its own visits in stop order; Start then Finish work;
another crew is refused; the note works on one's own visit and is refused to another crew and with the feature off; the storm
stops list is own-only; Start and Log price by the contract, a crew seat sees no money, a replay logs once; Skip is refused to a
crew seat; Snow & Ice off means the stops list is refused.

The phone's own rules (`tests/mobile/*.test.ts`, all 15 files) pass with the new specs.

Kit changes (additive, phone only): an action or section may name the business switch it needs; a link may open a screen of the app
(the after-photo form). Existing specs do not use them.

## Not built (named so nobody assumes)

Skip-with-reason, ETA "on my way", before-photos and photo markup, materials used, required forms, map of the day, end-of-day recap,
a Today's route tab (the bar is full; this is an owner decision), photos with no signal.

## Offline (row 11): written and tested on a scratch merge, NOT on this branch

The rebuilt offline queue (`apps/mobile/src/offline/`) is on `cloud/fieldservice-depth`, not here, and that folder is that session's.
So this branch does not import it. The wiring is saved as `docs/parity/landscaping-offline-wiring.patch` (3 files:
`kit.ts`, `ActionSheet.tsx`, `landscaping.ts`). **Apply it after `cloud/fieldservice-depth` has merged** (`git apply`). On a scratch merge
of the two branches (nothing committed or pushed) it type-checks and all 16 phone test files pass; **it has not been run on a device.**

What goes through the queue: only saves that are safe to send twice, because the queue sends at least once and the server ignores the
`Idempotency-Key` it sends:
- **Snow Start / Log** (`storm-stop:<id>`): a second Start changes nothing; a second Log returns the same visit (`alreadyLogged`).
- **Note for the customer** (`visit:<id>`): replaces the whole note.

What does **not**: **Start / Finish of an ordinary visit.** Sending `POST /api/jobs/:id/complete` twice moves the completion time and
runs the job hooks again (customer texts), so queuing it would risk a double message. Parity needs the server to honour the
`Idempotency-Key` (or a "complete only if not already completed" rule) in the shared jobs route; that is shared code outside this
task. Until then Start / Finish need signal on this screen. Photos are not queued by that queue either.

Heads-up for the merge: `cloud/fieldservice-depth` also adds a phone job flow (on my way, arrived, checklist, photos, complete) on the
Job page. "Today's route" lists the day and opens its own detail; it does not replace that flow.

## Per-person crew timers and Crew Score (10/31 parity round, row 15)

**matches** (`crew_timers`, hidden): the crew lead starts and stops each crew member's own clock on a visit (logins and roster members) from the phone, at the tapped time, offline. The Crew Score on the Route Board (LMN) compares each crew lead's budget hours (the visit's time allowed) with the man-hours worked: budget ÷ actual × 100, over 100 is under budget. Tests: `landscaping-parity-phone.test.ts`, `tests/mobile/landscaping-crew-day.test.ts`.
