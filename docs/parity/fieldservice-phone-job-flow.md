# Parity: one job flow on the phone, working offline, with a clear "waiting to send" (all trades that use the shared job screen)

Branch `cloud/fieldservice-depth`, item 1. No new feature id (the flow is the phone's job screen; the checklist and signature
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
| 1 | ServiceTitan: mark arrived, checked in, on hold, paused, complete offline; the dispatcher sees it on reconnect | On my way, I've arrived and Complete work offline: kept on the phone, sent in order when signal returns; the job shows the status it will have | matches (no on hold / paused) |
| 2 | ServiceTitan and Jobber: forms and checklists filled in offline | The checklist is filled in and sent through the same queue, one copy however many times it is re-sent | matches |
| 3 | ServiceTitan: customer signatures collected on the device offline | The customer signs on the phone offline; stored with the evidence once sent | matches |
| 4 | ServiceTitan: photos appear at once and upload after reconnecting | **Not done.** Photos upload only with signal. The queue carries JSON only; photos need the file kept on the phone (`expo-file-system`, a native build) | gap — parity needs a native build with a file store and an upload transport in `OfflineQueue.ts` |
| 5 | Housecall Pro: jobs open before can be read offline; "editing without cell service … is not supported" | Editing offline is supported for the steps above | beats Housecall Pro |
| 6 | All three: it is clear what has and has not synced (ServiceTitan "no manual action"; the pages do not describe a list) | Each step says Done / Waiting to send / Couldn't send — tap to fix; the banner shows the counts and opens a list; a refused save keeps the server's words and is never dropped; Try again / Drop it | matches (the pages show no list to compare) |
| 7 | Server refuses what was queued (job cancelled meanwhile) | Stays visible, blocks only that job's later steps, the others still go | not on any leader's page — no claim |
| 8 | Jobber: required checklist questions reminded, visit can still be completed. HCP: required items block finishing | The phone does not offer Complete while a checklist is owed. **The server does not stop it** (a job completed from the desktop or another client ignores checklists) | partly — parity needs a gate in the shared `jobs.ts` complete |
| 9 | ServiceTitan: Dispatch and Arrive start the timesheet (automatic timekeeping) | The Clock is separate (item 2); On my way / Arrived do not clock the tech in | not doing |
| 10 | Customer text "on my way" / "arrived" | Unchanged: the existing `textArrival` setting sends it when the move reaches the server (so a queued move texts the customer when it is sent, not when tapped) | stated, not changed |
| 11 | Offline reading of jobs (HCP, ServiceTitan) | Not built: the job screen loads from the server | not doing |

**Parity verdict:** moves, checklist and signature work offline and are visible; photos offline (row 4), a server-side
completion gate (row 8), offline reading (row 11) and auto-timekeeping (row 9) are what a full match still needs.

**Unverified:** none of the phone screens has been run on a device or emulator in this session. The rule and wording are tested
as plain TypeScript; the screens were type-checked and pass the design-kit and route tests. **Delivery of the at-least-once
queue:** the server ignores `Idempotency-Key`; the moves are safe to repeat (a status change to the status it is already in is
refused with 409, which would show as "couldn't send" for a send that actually landed — see Decisions), the checklist carries its own id.

**Decisions for the owner:** (1) If the phone loses the reply to a "start" the server did take, the repeat is refused ("already
started") and shows as *Couldn't send — tap to fix* even though the job moved. Fixing it properly is server-side idempotency (a
migration). (2) A queued "on my way" texts the customer when it is sent, which can be well after the tap.
