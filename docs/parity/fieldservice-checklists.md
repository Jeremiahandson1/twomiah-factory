# Parity: checklists the owner builds per kind of job, filled on the phone, signed by the customer on site (field service and basic)

Branch `cloud/fieldservice-depth`, item 3. Feature id `job_checklists` (NOT READY, `hidden` in `featureRegistry.ts`).
Server: `server/crm/field/checklistRoutes.ts`, `/api/checklists` (building: `settings:update`; reading a job's checklists
`jobs:read`; filling in and signing `jobs:update`, a field seat only on its own jobs). Screens: `ChecklistsPage.tsx` (menu row
"Job Checklists"), a "Job type" box on the shared job form (only with the feature on), and the phone checklist screen
(`apps/mobile/app/(details)/job/checklist.tsx`, built with item 1). Tables: the existing `form_template` / `form_submission`;
migration 0043 adds the signing-evidence columns to `form_submission`. Test: `tests/job-checklists.test.ts` (both verticals).

**Leaders reviewed (read 2026-10-30, their own help pages):**
Housecall Pro — [Checklists overview](https://help.housecallpro.com/en/articles/9528709-checklists-overview).
Jobber — [Checklists](https://help.getjobber.com/en/articles/checklists/).
ServiceTitan — [Use Forms](https://help.servicetitan.com/docs/use-forms) and
[Send forms for e-signature in the Field Mobile App](https://help.servicetitan.com/release-hub/docs/send-forms-for-e-signature-in-the-servicetitan-field-mobile-app)
(the second was seen in search results only; no claim below rests on it).

| # | Leader (from its page) | Ours | Mark |
|---|---|---|---|
| 1 | All three: the owner builds checklists/forms in the office (HCP and Jobber in Settings) | Settings-style page "Job Checklists": name, note, questions in order, required or not; only `settings:update` | matches |
| 2 | HCP: checkbox, text, pass/flag/fail, photo, single- and multi-select. Jobber: short/long answer, dropdown, checkbox, number, image, date, signature | Three question types: Pass / Fail / Needs attention, Yes / No, write-in | partly — no dropdown, number, date or per-question photo |
| 3 | HCP and Jobber: sections that group questions | Flat list of questions | not doing |
| 4 | HCP: auto-add by job type through job templates. Jobber: attach automatically to new jobs. ServiceTitan: business units help techs find a form | A checklist names the kinds of job it is for (or none = every job); the job form has a "Job type" box; the phone offers the checklists that fit the job | matches in effect — offered, not added as a row on creation |
| 5 | HCP: required items must be done before the job can be finished. Jobber: banner and reminder, a visit can still be completed | Required questions must be answered to send; the job shows what is still owed (`outstanding`). The server does **not** stop a job being completed with a checklist outstanding | gap — stated: parity with HCP needs a gate on completing the job (`jobs.ts` complete) |
| 6 | ServiceTitan: forms collect the customer's signature with authorisation text, on site only. Jobber: signature question | The customer signs the whole checklist on the phone: typed name, drawn signature, agreement to sign electronically; stored with time, address, browser and a fingerprint of the checklist and answers they saw; once signed it is not changed; the same evidence a signed quote keeps | matches (beats: the evidence) |
| 7 | HCP page: signatures not covered | — | no claim |
| 8 | ServiceTitan: a started form is saved and finished later | A checklist that wants a signature is saved as "needs the customer to sign" and signed later | matches |
| 9 | Photos on a checklist (HCP, Jobber, ServiceTitan) | A checklist can require the job to have a photo before it is sent; photos stay on the job (field service and basic have job photos). No photo question inside the checklist | partly |
| 10 | Jobber: updates stored offline and synced | The phone sends through the offline queue (`apps/mobile/src/offline/`) with "waiting to send" and "couldn't send — tap to fix" | matches |
| 11 | Jobber and HCP: PDF of a completed checklist, emailed or attached to an invoice. ServiceTitan: emailed finalised copy | Not built | not doing — parity needs a checklist PDF and an email/attach action |
| 12 | Jobber: checklists report; alert when a visit is done and its checklist is not | Not built | not doing |
| 13 | ServiceTitan: triggers that prompt a form on a status change | Not built | not doing |
| 14 | HCP: deleting stops future use, kept on old jobs | Removing a checklist that has been filled in switches it off and keeps it | matches |
| 15 | Who may fill in: HCP admins, office, assigned techs | Field seat only on its own jobs; office with `jobs:update`; a Viewer reads, does not fill in | matches |

**Parity verdict:** build, attach by job type, fill on the phone offline, sign on site with evidence: matches. Rows 2 (some
types), 3, 5, 9 (in-checklist photo), 11, 12 and 13 are what a full match would still need.

**Decisions for the owner:** (1) a job's *kind* is a free-text label the owner types on the checklist and picks on the job —
there was no job-type list on field service or basic. (2) Completing a job is not blocked by an unfinished checklist yet (row 5).
