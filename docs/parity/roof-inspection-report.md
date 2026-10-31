# Roofing parity — the shareable inspection report (gap 6)

Leaders: CompanyCam reports, AccuLynx photo reports. Read from their own pages on 2026-10-30; where a page said nothing
about a point it is marked "not stated", never assumed. The help centres themselves (help.companycam.com, AccuLynx's
knowledge base) could not be opened from the research tool, so what follows is from the companies' product pages and
articles, listed below.

Sources
- CompanyCam: [Photo report app](https://companycam.com/photo-report-app) (layouts, sections and summaries, report types, share as PDF or link), [How to win insurance claims faster with photo reports](https://companycam.com/resources/blog/how-to-win-insurance-claims-with-photo-reports) (date/time and GPS stamps, cover page, logo, section summaries, Generate PDF with preview)
- AccuLynx: [New and improved photo features](https://acculynx.com/best-roofing-crm-software-introduces-new-photo-features) (Create a PDF from selected photos, saved to Job Documents; Photo Links by email, text or message; Manage Sharing with link expiry; image descriptions), [New ways to use AccuLynx photos](https://acculynx.com/5-ways-to-use-acculynx-photos/) (compile photos for homeowners; expire the link when the project is complete; the page does not describe photo reports, GPS or timestamps), [Photo and video tools](https://acculynx.com/product-update-photo-video-tools/) (descriptions, annotation tools, printing photos)

## The list, each marked

| # | What the leaders do | Twomiah (roofing) | Mark |
|---|---|---|---|
| 1 | A report made from selected job photos, in sections with summaries — CompanyCam | Built from the job's photos: damage and before photos by default, or the sections the roofer names (title, notes, photos). Only the job's own photos can be in it (`roof-inspection-report.test.ts`) | **Matches** |
| 2 | Photo descriptions / captions — CompanyCam, AccuLynx | A caption per photo, edited on the job page (Photos › Captions and details) and printed under the photo | **Matches** |
| 3 | Date and time stamped on the photo — CompanyCam (a per-user camera setting) | The time the phone says it was taken (else the upload time) is printed under each photo, in the company's own time zone. Printed beside the photo, not burned into the picture file | **Matches**, differently |
| 4 | GPS coordinates on the photo — CompanyCam | Where the phone says it was, when it says: the phone app sends the position the camera already put in the photo's EXIF (no new permission, no location call). Printed under the photo with a map link on the page | **Matches** where the camera gave a position. **Not verified on a phone** (see below) |
| 5 | Cover page with the company logo — CompanyCam | Header band in the company's colour with its logo and name; the company's phone, email, address and licence number in the footer | **Matches** |
| 6 | Project location, who took the photos, the timeline — CompanyCam | Property address, homeowner, job number, inspection date, date of loss, insurance company and claim number; "photographed by" first name and initial. 10/31 (row 9): the job's timeline can be printed in the report (opened, the stages it moved through in the company's own stage names, the days photos were taken); the office's notes and the texts are not in it | **Matches** |
| 7 | Preview before sending — CompanyCam (PDF preview) | The report page is the preview; the office screen edits it and the link shows the same page | **Matches** |
| 8 | Share as a PDF — CompanyCam, AccuLynx (Create a PDF) | PDF download from the office screen and from the link | **Matches** |
| 9 | Share as a link, no sign-in — CompanyCam, AccuLynx Photo Links | A private link (64-character random token, the same kind a quote's link is). It opens that one report, its photos and its PDF, and nothing else of the job or the customer | **Matches** |
| 10 | Stop or expire the link — AccuLynx Manage Sharing, "expire the link" | Switch the link off, give it a new address (the old one stops), or give it a last day | **Matches** |
| 11 | Send the link by email, text or message — AccuLynx | 10/31 (row 9): "Send to homeowner" on the report (portal:share) texts or emails the private link to the job's homeowner through the CRM's own senders (the shared texting service, which refuses an opted-out number and unset-up texting; the email service), with an optional note. It switches the link on, or renews one that ran out, so what is sent opens. Recorded on the job's timeline and on the report; nothing is recorded when the sender refuses or the homeowner has no number or address (the buttons say why). The mailto "Email it" stays | **Matches** (not tried against a real carrier or mailbox; see below) |
| 12 | Save the PDF into the job's documents — AccuLynx (Create a PDF saves to Job Documents) | 10/31 (row 9): "Save a copy to documents" (documents:create, Documents switched on) files a PDF made at that moment under the job's documents (type Inspection, with the homeowner as its contact). It is frozen: editing the report afterwards does not change it. The report lists its copies | **Matches** |
| 13 | Draw on photos (annotations) — AccuLynx | 10/31 (row 8): arrows, circles and text drawn on a job photo, on the web and the phone (queued offline); the marked copy is kept beside the original, and a report built from the job takes it in place of the plain photo, or can be changed to use either (see roof-gbb-proposals.md, "Drawing on photos") | **Matches** (tested through the server and as plain phone functions; not seen in a browser or on a phone) |
| 14 | Report templates and customisable layouts — CompanyCam | 10/31 (row 9): saved TEMPLATES (name, introduction, sections each with the kind of photo that fills it, layout; build a report from one, or save a report as one) and LAYOUT choices on every report (photos per row 1/2/3; captions, date and time, location, who took the photo, job details and the timeline each on or off), followed by the page and the PDF. A report with none saved looks as before. In the company's brand colour and logo | **Matches** on saved templates and layout choices (no drag-and-drop page designer, no per-section layout) |
| 15 | Who may build and who may share | Building and editing is the job permission (`jobs:update`); the link and the portal listing are `portal:share` (owner, admin, manager); a seat that reads only its own jobs reaches only those jobs' reports; the link needs no sign-in by design | Not stated by the leaders; **ours is tested** |

## What this change builds
- `inspection_report` table; `job_photo` gains latitude, longitude and a "shared with customer" switch (migration 0041).
- `server/crm/roof/inspection/` — office routes (`/api/inspection-reports`) and the link's routes (`/api/inspection-report-view/:token`, `/pdf`, `/photos/:id`), behind the not-ready feature `inspection_reports`.
- The PDF uses the same pdfkit the invoices and quotes use.
- The job photo upload accepts the phone's latitude, longitude and time; `PUT /api/jobs/:id/photos/:photoId` edits a caption.
- The job page (Inspection report card, Captions and details); the phone app sends the camera's stamp (`apps/mobile/src/photos/stamp.ts`).
- Not turned on: the roof Measurement Reports (`measurement_reports`, `/api/roof-reports`) are a different thing and are untouched.

## Unverified
- The phone's EXIF reading is tested as plain functions (`tests/mobile/photo-stamp.test.ts`), not on a device. Whether a given camera leaves the position in the file the picker returns depends on the phone's camera settings.
- A photo uploaded from the web job page has no phone position; its time is the upload time.

## Still needed for full parity (not in this change)
Nothing in the table above is open (rows 11, 12, 13 and 14 were built 10/31, rows 8 and 9 of the brief). See "Send, copies, templates, layout, timeline" below for what was not verified.

## Guessing the link (owner follow-up 10/30)
The report's link (page, PDF and photos) limits guessing per caller address: 30 lookups that find no link in 15 minutes shut that address out, and it is then answered exactly as a wrong token is answered ("not valid", 404 — never a 429, even for a right token). Lookups that find the link never count. The count is in the server's memory (resets on restart; each app instance counts on its own). Proven in `apps/unified/tests/roof-token-guess-limit.test.ts`, which also covers the crew's work-order link.

## Send, copies, templates, layout, timeline (row 9, 10/31)
- Migration `0064_inspection_report_send_templates`: `inspection_report.layout`, `sent_at`, `sent_via`, `copies`; new table `inspection_report_template` (table count 466 -> 467).
- `POST /api/inspection-reports/:id/send` (`{ via: 'sms' | 'email', message? }`, portal:share), `POST /:id/copy` (documents:create, needs Documents on), `/api/inspection-reports/templates` (list/create/change: jobs:read / jobs:update; delete: jobs:delete), `templateId` and `layout` on build/change. All behind `inspection_reports` as before.
- Recorded on the job: the sends and the saved copies are job notes in a fixed form that the job's timeline reads in words (`jobRecord.ts` `reportSentBody` / `reportSavedBody`), and the Notes card does not list.
- Tested in `tests/roof-inspection-report-extras.test.ts` (and `tests/roof-inspection-report.test.ts` still passes: the standard layout is unchanged).
- Not verified: a real text or email arriving (the tests replace the senders; the texting service needs the business's number registered and the email service a provider); the new screen controls in a browser.
- Limits: the timeline lists the days photos were taken, not each photo; templates are the company's (anyone who may change jobs may change them, as with building a report); a copy filed to Documents is a PDF only (no page).
