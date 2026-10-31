# Roofing parity — the homeowner portal's photos and documents (gap 10)

Leader: the AccuLynx Customer Portal. Read from AccuLynx's own pages on 2026-10-30; where a page said nothing about a point
it is marked "not stated", never assumed. AccuLynx's help centre itself could not be opened from the research tool, so this
is from its product and feature pages, listed below.

Sources
- [Introducing AccuLynx's new Customer Portal](https://acculynx.com/?p=4325) — after a job is approved the homeowner gets a secure link and a login tied to their phone; they see a project page, "project details, documents, photos, estimates, and invoices in a single location", appointments, messaging and payments; the contractor decides what is shared ("the job information you want to share"); the page does not say how individual photos or documents are chosen
- [New enhancements to the AccuLynx Customer Portal](https://acculynx.com/new-enhancements-to-the-acculynx-customer-portal) — share "job packets and company documents"; start a portal post; notifications on new content; portal access that expires when the job is complete; preview exactly what customers see; see when a customer last visited. The page does not mention photo sharing
- [AccuLynx customer portal software](https://acculynx.com/features/customer-portal-software/) — "Control what info is shared"; send the information you choose "in just a few clicks"; it updates in the portal as the job moves; homeowners see documents, billing, status, appointments, financing, payments and messages. The page does not describe how the controls work

## The list, each marked

| # | What AccuLynx does | Twomiah (roofing) | Mark |
|---|---|---|---|
| 1 | The homeowner sees job photos and documents in the portal, in one place | A "Photos & Documents" tab in the homeowner's portal, grouped by job: the inspection report, documents (contract, warranty…) and photos (`roof-portal-documents.test.ts`) | **Matches** |
| 2 | The contractor chooses what is shared | A switch on every photo, document and inspection report, **off until someone with `portal:share` (owner, admin, manager) turns it on**. Nothing is shared by being uploaded, by its kind, or by the job's stage. A field seat and a viewer are refused by the server | **Matches** (AccuLynx's page does not say how fine-grained its control is; ours is per file) |
| 3 | Only this homeowner's own information | The list and each file door are limited by the job's homeowner being the signed-in contact, in the query itself. Another customer's portal, and a subcontractor's, list nothing of theirs and answer "not found" to their ids, shared or not | **Matches** (proved with two homeowners and a subcontractor on the same company) |
| 4 | Contract and inspection report among the documents | The signed contract and warranty are documents filed under the job (any document type); the inspection report (gap 6) is listed and opens as its PDF straight from the report, no private link needed | **Matches** |
| 5 | Stops showing when the contractor withdraws it | Turning a file off removes it from the list and from its file door immediately | **Matches** |
| 6 | Information updates as the job moves | The portal reads the live files each time it is opened: a caption fixed or a new share appears on the next visit. A shared report's PDF is rebuilt from the current report each time | **Matches** |
| 7 | Access that expires when the job is complete | The portal link already expires on its own (90 days) and can be switched off per contact. Expiring a link when a job completes is not built | **Not doing** (parity needs a "close the portal when the job is Collected" setting) |
| 8 | Preview exactly what the customer sees | The office card lists what is ticked ("N of M shown"), but there is no "view as the homeowner" for these files | **Not doing** (parity needs a preview, or the existing View-as for the portal pointed at this tab) |
| 9 | Notification when something new is shared | Sharing a file does not text or email the homeowner | **Not doing** (parity needs a "tell the homeowner" option on share, through the shared sender) |
| 10 | Portal posts; company documents; job packets | Not built: only a job's own photos, documents and inspection reports are shared. Company-wide documents and a packet (several files at once) are not | **Not doing** |
| 11 | Last visit shown to the contractor | The portal records each visit on the contact (`lastPortalVisit`); whether a screen shows it to the roofer was not verified | **Not claimed** |
| 12 | Sees a document in the page | Images and PDFs open in the browser; every other file type is a download. A photo opens full size | **Matches** |
| 13 | What the homeowner is told about a file | Named, not "everything but": a photo's caption, kind and day; a document's name, kind and day; a report's title. Never where a photo was taken, who took it, internal notes or where it is stored | Not stated by AccuLynx; **ours is tested** |

## What this change builds
- `job_photo.shared_with_customer` and `document.shared_with_customer` (default false) and `inspection_report.shared_with_customer` (migrations 0041, 0042).
- Office: `GET /api/job-files?jobId=` and `PUT /api/job-files/{photos|documents|reports}/:id` (`server/crm/roof/portalFiles/`), behind the not-ready feature `portal_job_files`; a card on the job page.
- Portal: the shared customer portal gets an optional `jobFiles` provider (`packages/tenant-backend/src/portal/portal.ts`, additive: no other template or vertical passes it, so none gains the section); roofing passes `roofPortalJobFiles`. The page is `packages/tenant-ui/src/portal/PortalJobFiles.tsx`, mounted at `/portal/:token/job-files` in `apps/unified/web/src/crm/portal.tsx` — the only mount of the portal in the unified app; the CRM templates carry their own vendored copy and are unchanged.

## Decisions for the owner
- "Shared" is a per-file switch, default off. A document is shared by its job's homeowner at the moment of viewing: if a job is moved to another homeowner, that homeowner sees what was already ticked.
- A document can only be shown if it is filed under a job (a document with no job cannot be shared).

## Still needed for full parity (not in this change)
Rows 7, 8, 9 and 10.
