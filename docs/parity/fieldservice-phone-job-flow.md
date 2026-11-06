# Parity: one job flow on the phone, working offline, with a clear "waiting to send" (all trades that use the shared job screen)

Branch `cloud/fieldservice-depth`, item 1; finished on `cloud/fieldservice-parity`, item 3 (10/31). No new feature id (the flow is the phone's job screen; the checklist and signature
steps appear only where `job_checklists`, NOT READY, is on — see `fieldservice-checklists.md`).
Phone: `apps/mobile/src/jobflow/` (`flow.ts` the rule, `JobFlowCard.tsx`, `useJobFlowData.ts`), `app/(details)/job/[id].tsx`
(the card replaces the Dispatch / Start / Complete buttons), `app/(details)/job/checklist.tsx`, `app/(details)/waiting.tsx`
(Waiting to send), `OfflineBanner.tsx` (taps through to it), `src/offline/describe.ts`. Offline queue: `apps/mobile/src/offline/`
(own commit 2350fa6; `README.md`). Roofing keeps its own pipeline screen and is not changed. Tests: `tests/mobile/job-flow.test.ts`
(the rule and the wording), `tests/mobile/offline-queue.test.ts` (the queue), `apps/unified/tests/job-checklists.test.ts`
(a checklist sent twice is saved once).

**Leaders reviewed (read 2026-10-30, their own help pages):**
ServiceTitan — [Field Mobile App offline capabilities](https://help.servicetitan.com/docs/servicetitan-field-mobile-app-offline-capabilities).
Jobber — [Keep working in Jobber even without internet](https://productupdates.getjobber.com/134787-keep-working-in-jobber-even-without-internet).
Housecall Pro — [Mobile FAQ](https://help.housecallpro.com/en/articles/4747652-housecall-pro-mobile-faq).

| # | Leader (from its page) | Ours | Mark |
|---|---|---|---|
| 1 | ServiceTitan: mark arrived, checked in, on hold, paused, complete offline; the dispatcher sees it on reconnect | On my way, I've arrived, Put on hold, Pause / Resume work and Complete work offline: kept on the phone, sent in order when signal returns; the job shows the status it will have (`flow.ts`). On hold stops the job (`POST /:id/hold`, status `on_hold`); Paused is a stamp on a started job (`/pause`, `/resume`, `job.paused_at`) that takes a break on the tech's automatic clock | matches |
| 2 | ServiceTitan and Jobber: forms and checklists filled in offline | The checklist is filled in and sent through the same queue, one copy however many times it is re-sent | matches |
| 3 | ServiceTitan: customer signatures collected on the device offline | The customer signs on the phone offline; stored with the evidence once sent | matches |
| 4 | ServiceTitan: photos appear at once and upload after reconnecting | A job photo taken with no signal stays a file on the phone, shows in the strip as waiting, and goes through the queue (`jobPhotos.ts`, `localPhotos.ts` `$photos`): file first, then the save that records it | matches |
| 5 | Housecall Pro: jobs open before can be read offline; "editing without cell service … is not supported" | Editing offline is supported for the steps above | beats Housecall Pro |
| 6 | All three: it is clear what has and has not synced (ServiceTitan "no manual action"; the pages do not describe a list) | Each step says Done / Waiting to send / Couldn't send — tap to fix; the banner shows the counts and opens a list; a refused save keeps the server's words and is never dropped; Try again / Drop it | matches (the pages show no list to compare) |
| 7 | Server refuses what was queued (job cancelled meanwhile) | Stays visible, blocks only that job's later steps, the others still go | not on any leader's page — no claim |
| 8 | Jobber: required checklist questions reminded, visit can still be completed. HCP: required items block finishing | The phone does not offer Complete while a required checklist is owed, and the server refuses it from every client (`checklistRoutes.ts` `createCompletionGate`) | matches HCP |
| 9 | ServiceTitan: Dispatch and Arrive start the timesheet (automatic timekeeping) | A setting (`Settings › Time clock`): Arrive, or On my way, starts the tech's timesheet; Complete ends the clock the job opened; Pause takes a break (`clockExtras.ts`) | matches |
| 10 | Customer text "on my way" / "arrived" | Every move carries when the tech tapped (`tappedAt`); the server keeps that time if it is recent, and does not text "on my way" / "on site" for a tap over half an hour old | matches |
| 11 | Offline reading of jobs (HCP, ServiceTitan) | Today's list, an opened job, its checklists and photos are read again with no signal from the last good copy (`readCache.ts`), marked as a copy; a real refusal is never hidden by an old copy | matches |

**Parity verdict (10/31):** every row matches. Tests: `tests/mobile/job-flow.test.ts`, `tests/mobile/job-moves-offline.test.ts`,
`apps/unified/tests/job-moves-phone.test.ts`, `clock-finished.test.ts`.

**Unverified:** none of the phone screens has been run on a device or emulator in this session. The rule and wording are tested
as plain TypeScript; the screens were type-checked and pass the design-kit and route tests.

**The server's "only forward" rule (`jobs.ts` `JOB_MOVES_FROM`, tested):** a move only goes forward; a late phone move never
turns a job back past the office's change (409 in words, the phone shows them); a repeated move changes nothing and runs no hook,
so the customer is never texted twice; a queued "on my way" texts the customer only if the tap is under half an hour old.
