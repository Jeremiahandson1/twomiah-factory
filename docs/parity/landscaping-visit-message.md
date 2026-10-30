# Landscaping parity — gap 6: the visit-done message

Branch `cloud/landscaping-depth`. Researched 2026-10-30 from each leader's own help centre. "UNCONFIRMED" = no official page could be
read. Marks: **matches**, **beats**, **not doing (why)**, **NOT BUILT (what parity needs)**.

**Status: built on the server and in the customer portal; registered NOT READY (hidden feature `visit_reports`) until the owner has
tested it. There is no office screen and no phone screen for the crew's note and after-photo yet (the phone is gap 7). Nothing has
been opened in a browser.**

## What the leaders document

| # | Capability (leader, source) | Ours |
|---|---|---|
| 1 | A message to the customer when a job is done — Yardbook "Job Completion Email" ([how it works](https://support.yardbook.com/faq-i-want-to-automatically-send-email-notification-to-the-customer-when-a-job-is-done/)). Jobber has no per-visit completion message: its follow-up fires when a job is CLOSED, email only ([job follow-ups](https://help.getjobber.com/es/articles/job-follow-ups/)) | **beats Jobber, matches Yardbook**: finishing a visit (Complete button, status edit or bulk — the one job-done moment every door runs) messages the customer. Off for a business until the feature is on; one message per job ever (a unique index), so finishing a job twice or a replayed request never messages twice. |
| 2 | By text as well as email — Jobber's follow-up is email only; Yardbook's is email | **beats both**: a text when we can text them (queued for the 8 am – 8 pm window on the business's clock, sent through the business's own number, with the usual opt-out and wallet rules), otherwise an email. **One channel, never both** — owner decision below. |
| 3 | The crew's words in the message — Yardbook `[job_notes]` (only notes flagged "add to job completion email") | **matches**: a separate customer-visible note per visit (`visit_report.note`, up to 1,000 characters), never the job's internal notes. The crew writes it on their own visit; the office can too. |
| 4 | After-photos with the message — Yardbook `[job_before_and_after_photos]` is a link to a photo page ([before/after photos](https://support.yardbook.com/before-after-photos/)); Jobber: automatic emailing of visit photos UNCONFIRMED | **matches**: the visit's photos marked "after" (at most 3) travel IN the text as pictures, or in the email as images by a link that opens for 14 days with no sign-in (the existing signed picture links; they open one file only). Crew photos are re-encoded web-size on upload so a text never carries more than carriers allow. |
| 5 | Shown to the customer on a page — Jobber Client Hub shows past appointments but job photos and notes are NOT documented there ([Client Hub](https://help.getjobber.com/en/articles/what-do-your-clients-see-in-client-hub/)); Service Autopilot portal: service history, photos not described ([portal](https://support.serviceautopilot.com/hc/en-us/articles/360057315212-Using-the-Client-Portal)) | **beats**: a "Visits" section in the customer portal lists their finished visits with the note and the after-photos, newest first. Their own visits only; a skipped visit and a business without the feature show nothing (404). |
| 6 | Per-customer on/off — Yardbook (off by default, on per customer) | **matches in effect**: a customer who opted out of texts or email is never contacted that way; a customer with neither is recorded as unreachable. The business-wide switch is the feature itself. |
| 7 | Per-service skip — Yardbook "Skip Job Completion Notification Email" | **matches per visit**: the office can mark any one visit "don't message the customer" (a crew seat cannot). Per SERVICE (catalog) skip: **NOT BUILT** — parity needs a flag on the service/stop and a lookup at completion. |
| 8 | Record of what was sent — Yardbook shows "Email Notification Sent" with the date, clickable | **partly**: every report records channel, when, photo count and any failure, and `GET /api/visit-reports` lists them; the **office screen that shows it is NOT BUILT** (and so a clickable copy of the message). |
| 9 | Editable template — Yardbook email templates, Jobber editable follow-up | **NOT BUILT**: the wording is fixed ("Hi {first}, {company} finished {job} on {day}. {note}"). Parity needs a settings page with the text and email templates and placeholders. |
| 10 | Customer feedback survey on close — Jobber | **not doing here**: the existing review request after a completed job (Google reviews) already runs from the same moment. |

## Built, and the test that proves it

`apps/unified/tests/landscaping-visit-report.test.ts` (6 tests, real landscaping tenant). With the visit-reports mount removed, 5 of
the 6 fail; with it, all pass. Also re-run and passing: the portal, feature-registry and not-ready suites.

- migration `0047_visit_report`: `visit_report` (unique per job). Additive.
- **New feature id `visit_reports`, registered hidden (NOT READY)** in `packages/tenant-backend/src/featureRegistry.ts` for
  `crm-landscaping`. No plan, signup or Settings can switch it on until the owner un-hides it; the test turns it on directly.
- Shared code, additive: the portal gains an optional `visits` section (`packages/tenant-backend` portal.ts, `packages/tenant-ui`
  PortalVisits); no other vertical passes the feed, so no other portal changes. The job-done hook only acts when the feature is on.
- Endpoints (`/api/visit-reports`, gated by the feature): list, one visit's report with its photos, the note (and the office's
  "don't message"), an after-photo upload, mark/unmark a photo as "after", and "send now / send again" (office only).
- Permissions asked by the server: jobs:read to see, jobs:update to write the note or add a photo — and a crew seat only on
  its own visits (403 on another crew's); jobs:dispatch for "don't message" and "send again".

## Not built (named so nobody assumes)

Office screen and customer-copy preview, message templates, per-service skip, a "before" photo in the message, two-way reply
handling beyond the normal text inbox, and the crew's note/photo entry on the phone (gap 7).
