# Contractor client portal — parity with Buildertrend, JobTread and Jobber Client Hub

Brief row 10 (contractor, 10/31 round). Written 2026-11-07 from the leaders' own help and product pages (sources at the end),
then checked against our portal (`packages/tenant-backend/src/portal/portal.ts`, `/p/:token/*`; screens in
`packages/tenant-ui/src/portal/`). Marks: **built** · **partly** (what is missing is named) · **not built** · **beats**.

## What the leaders give the client

| Leader feature | Ours (before row 10) | Mark |
|---|---|---|
| Quotes / estimates: read, approve with signature, pick options, request changes (Jobber, BT, JobTread) | quotes, options, Good/Better/Best, approve with e-sign evidence, pay deposit | built |
| Invoices paid online, partial payments (all three) | invoices, pay online; pay any amount (`portal_pay_options`, roofing) | built |
| Change orders approved / declined (BT, JobTread) | change orders approve / reject | built |
| Selections chosen against allowances (BT) | selections | built |
| Messages with the team, per job (all three) | portal messages; a thread per job for roofing (`portal_posts_packets`) | partly — no thread per **project** for the contractor |
| Files and photos the builder shares (BT, JobTread) | shared documents / file room; roofing shares job photos (`portal_job_files`) | partly — the contractor cannot choose a project photo or file to show |
| Work requests, appointments (Jobber) | service request, appointments | built |
| Warranty requests (BT) | warranty | built |
| Lien waivers, RFIs, submittals (BT, for subs / architects) | built | built |
| **Daily logs the builder shares** — notes and photos (BT: "Daily logs give clients site progress updates, photos and notes") | not in the portal | not built |
| **The schedule** — phases only or every item, how far ahead, the client comments (BT); full schedule / phases / only what is theirs (JobTread) | the project page shows dates and up to 10 jobs; no schedule | not built |
| **Payment schedule / draws paid online** — draws split the contract into scheduled payments tied to progress; released draws are invoiced and paid from the portal (BT draws, BT Payments) | draw schedules exist for lender (AIA) draws; a draw never becomes something the client can see or pay | not built |
| **Documents to e-sign** — contracts and other documents sent for signature and signed in the portal (BT digital signatures) | only quotes and change orders are signed | not built |
| **Owner-set visibility per job and per item** — client job permissions per job with company defaults; each daily log / to-do / photo shared or not (BT Default Job Permissions, per-job Clients tab) | the portal's sections are on or off for the whole business (company portal settings); nothing per project or per item | not built |
| **Client to-dos** — a to-do shared with the client: title, notes, checklist (BT) | none | not built |
| **Notifications to the client** — choose on the job which notifications the client gets (BT); everyone in the thread is told of a reply (JobTread); "tell them when something new is shared" (ours for roofing, `portal_tools`) | portal link email; roofing new-item notice | partly — nothing tells a contractor's client of a new daily log, schedule change, draw, to-do or document to sign |
| Weekly client update, liked / read (BT Client Updates) | none | not built |
| See what the client sees (BT "Edit from Client Portal"; ours for roofing, `portal_tools`) | roofing only | partly |
| Seen: when the client viewed a document (JobTread) | quote viewed; last portal visit (roofing) | partly |

## What row 10 builds (each hidden until tested, feature `client_portal_plus`, contractor CRM)

1. **Per-project portal settings** (Buildertrend's per-job client permissions, company defaults first): for each project, which of
   these the client sees — schedule (phases only or every task, and how many weeks ahead), daily logs, photos, payment schedule,
   to-dos, documents to sign — and which of them they are emailed about. A company default sets a new project's.
2. **Per-item sharing**: a daily log, a photo or file, and a to-do are each shared or not; the default comes from the project's
   settings. Shared items show on the client's project page.
3. **The schedule** in the portal: the project's tasks (or only its phases, the top-level tasks) inside the time frame, with
   dates and progress; the client comments on a task, and the office sees the comment.
4. **Daily logs** in the portal: the shared ones, newest first — date, weather, the work done, and photos; never the safety
   notes, delays or who was on site unless the office says so (Buildertrend shows notes only).
5. **Payment schedule**: the project's payments (name, amount or % of the contract, due on a date or at a milestone); the office
   releases one, which raises its invoice; the client sees what is paid, what is due, and pays the released one online through
   the existing invoice payment.
6. **Client to-dos**: a to-do assigned to the client (title, notes, checklist, due date); the client ticks items and marks it done.
7. **Documents to e-sign**: the office sends a PDF to sign; the client reads and signs it in the portal with the same e-sign
   evidence quotes keep (ESIGN/UETA: who, when, what they saw, consent); the signed copy is filed on the project.
8. **Notifications**: the client is emailed when something they can see is shared or changes — a daily log, a schedule change,
   a released payment, a to-do, a document to sign — as the project's settings say; one email per batch, never one per keystroke.

Not in row 10: BT's weekly Client Update digest (a digest of the above; listed as a later row), and the client mobile app
(Buildertrend's and JobTread's portals run in a phone browser; ours does too).

## Progress

- 10a (built): items 1–4 and 6 — per-project settings over a company default, per-item sharing of daily logs and files, the schedule (phases / every task / weeks ahead) with comments both ways, daily logs with photos, client to-dos with checklists; emails on a shared daily log or a new to-do where the settings ask, and "tell the client" for the schedule and files; the office's preview of the client's page.
- 10b (built): item 5 — the payment schedule (a share of the contract or a fixed amount, due on a date or at a milestone); releasing raises a real invoice, billed toward the approved quote so its final invoice credits it, never past the contract; the client sees paid / due / coming up and pays the released one through its invoice; emailed when a payment is due where asked.
- Left: 7 documents to e-sign, and its notice.

## Sources

- Buildertrend, Client Portal FAQs and Glossary for Clients — https://buildertrend.com/?p=110324, https://buildertrend.com/help-article/buildertrend-glossary-for-clients/
- Buildertrend, construction client portal — https://buildertrend.com/communication/construction-client-portal/
- Buildertrend, Client Contacts Overview (default job permissions, per-job client permissions and notifications) — https://buildertrend.com/help-article/client-contacts-overview/
- Buildertrend, Client Updates Overview — https://helpcenter.buildertrend.net/en/articles/10752873-client-updates-overview
- Buildertrend, Paying Invoices with Buildertrend Payments; Invoice overview — https://buildertrend.com/help-article/paying-invoices-with-buildertrend-payments/, https://helpcenter.buildertrend.net/en/articles/9746067-invoice-overview
- JobTread, Customer Portals — https://www.jobtread.com/customer-portals, https://support.jobtread.com/customer-portals
- Jobber, What do your clients see in client hub; client hub settings — https://help.getjobber.com/en/articles/what-do-your-clients-see-in-client-hub/, https://help.getjobber.com/es/articles/client-hub-settings/
