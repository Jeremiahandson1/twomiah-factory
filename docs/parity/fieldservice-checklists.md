# Parity: checklists the owner builds per kind of job, filled on the phone, signed by the customer on site (field service and basic)

Branch `cloud/fieldservice-depth`, item 3; finished on `cloud/fieldservice-parity`, items 1 and 2 (10/31). Feature id `job_checklists` (NOT READY, `hidden` in `featureRegistry.ts`).
Server: `server/crm/field/checklistRoutes.ts`, `/api/checklists` (building: `settings:update`; reading a job's checklists
`jobs:read`; filling in and signing `jobs:update`, a field seat only on its own jobs). Screens: `ChecklistsPage.tsx` (menu row
"Job Checklists"), a "Job type" box on the shared job form (only with the feature on), and the phone checklist screen
(`apps/mobile/app/(details)/job/checklist.tsx`, built with item 1). Tables: the existing `form_template` / `form_submission`;
migration 0043 adds the signing-evidence columns to `form_submission`. Tests: `tests/job-checklists.test.ts`, `tests/job-checklist-questions.test.ts`, `tests/job-checklist-life.test.ts` (both verticals), `tests/mobile/checklist-answers.test.ts` (the phone's answer rules).

**Leaders reviewed (read 2026-10-30, their own help pages):**
Housecall Pro — [Checklists overview](https://help.housecallpro.com/en/articles/9528709-checklists-overview).
Jobber — [Checklists](https://help.getjobber.com/en/articles/checklists/).
ServiceTitan — [Use Forms](https://help.servicetitan.com/docs/use-forms) and
[Send forms for e-signature in the Field Mobile App](https://help.servicetitan.com/release-hub/docs/send-forms-for-e-signature-in-the-servicetitan-field-mobile-app)
(the second was seen in search results only; no claim below rests on it).

| # | Leader (from its page) | Ours | Mark |
|---|---|---|---|
| 1 | All three: the owner builds checklists/forms in the office (HCP and Jobber in Settings) | Settings-style page "Job Checklists": name, note, questions in order, required or not; only `settings:update` | matches |
| 2 | HCP: checkbox, text, pass/flag/fail, photo, single- and multi-select. Jobber: short/long answer, dropdown, checkbox, number, image, date, signature | Pass / Fail / Needs attention, Yes / No, write-in, dropdown (one), multi-select, number, date, a photo question (taken on the phone, sent offline through the queue's `$photos`) and a signature question; the server checks each answer by its kind | matches |
| 3 | HCP and Jobber: sections that group questions | Section headings group questions, in the builder and on the phone | matches |
| 4 | HCP: auto-add by job type through job templates. Jobber: attach automatically to new jobs. ServiceTitan: business units help techs find a form | A checklist names the kinds of job it is for (or none = every job); a new job gets a row for each active checklist that fits its type (`checklistLife.ts`), so the office and the phone both see what is owed from the start | matches |
| 5 | HCP: required items must be done before the job can be finished. Jobber: banner and reminder, a visit can still be completed | Required questions must be answered to send; the job shows what is still owed. The **server** refuses completing a job with a required checklist outstanding — the Complete button, the edit form, creating a job straight as completed and the bulk move (`checklistRoutes.ts` `createCompletionGate`, every client); the job page shows a Jobber-style banner of what is owed | matches HCP (blocks); beats Jobber |
| 6 | ServiceTitan: forms collect the customer's signature with authorisation text, on site only. Jobber: signature question | The customer signs the whole checklist on the phone: typed name, drawn signature, agreement to sign electronically; stored with time, address, browser and a fingerprint of the checklist and answers they saw; once signed it is not changed; the same evidence a signed quote keeps | matches (beats: the evidence) |
| 7 | HCP page: signatures not covered | — | no claim |
| 8 | ServiceTitan: a started form is saved and finished later | A checklist that wants a signature is saved as "needs the customer to sign" and signed later | matches |
| 9 | Photos on a checklist (HCP, Jobber, ServiceTitan) | A photo question inside the checklist (row 2), taken on the phone and uploaded through the offline queue; a checklist can also require the job to have a photo | matches |
| 10 | Jobber: updates stored offline and synced | The phone sends through the offline queue (`apps/mobile/src/offline/`) with "waiting to send" and "couldn't send — tap to fix" | matches |
| 11 | Jobber and HCP: PDF of a completed checklist, emailed or attached to an invoice. ServiceTitan: emailed finalised copy | A PDF of the completed checklist (answers, photos, signature evidence), emailed to the customer by a button on the job, and attached to the invoice — it goes out with the invoice email | matches |
| 12 | Jobber: checklists report; alert when a visit is done and its checklist is not | A Checklists report (filled in / signed / open by checklist) and a "done but not filled in" alert on the job list and the report when a visit is completed with its checklist open | matches |
| 13 | ServiceTitan: triggers that prompt a form on a status change | A checklist can ask to be prompted when the job is sent out, started or completed; the prompt is on the job page and the phone | matches |
| 14 | HCP: deleting stops future use, kept on old jobs | Removing a checklist that has been filled in switches it off and keeps it | matches |
| 15 | Who may fill in: HCP admins, office, assigned techs | Field seat only on its own jobs; office with `jobs:update`; a Viewer reads, does not fill in | matches |

**Parity verdict (10/31):** every row matches or beats. Not seen in a real browser or on a real phone: the builder, the phone
screen, the PDF and the report are tested through the real server and type-checked; nobody has looked at them on a screen.

**Decisions for the owner:** (1) a job's *kind* is a free-text label the owner types on the checklist and picks on the job —
there was no job-type list on field service or basic. (2) Completing a job IS blocked by an unfinished required checklist (row 5) — HCP's rule, not Jobber's softer one.
