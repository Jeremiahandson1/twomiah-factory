# Roofing into the unified app — the plan

Roofing (`templates/crm-roof`) was built separately, like home care, but on the same model as the base CRM: one
`company`, one `user`, singular table names, text ids. So it doesn't come in the way home care did (its own tables
beside the CRM's) — its customers, jobs, quotes and invoices ARE the CRM's. Measured on branch `engine`, 2026-10-19.

## What it is

| | Roofing | For comparison |
|---|---|---|
| Tables | 53: 37 share a name with the unified schema, 16 are its own | home care 145, base CRM 148 |
| Its own tables | insurance_claim, supplement, adjuster_contact, claim_activity, measurement_report, material, crew, job_note, storm_event, storm_lead, storm_radar_event, storm_event_match, canvassing_session, canvassing_stop, canvassing_script, provider_integration | |
| Shared tables that differ | `job` (+28 roofing columns), `contact` (first/last name), `quote` / `invoice` (lines as JSON, own numbering), `roof_report` (+10 imagery / AI columns), `company` (+report credits), `job_photo` (photo type), and the shared modules' tables (sms, reviews, financing) | |
| Routes | 44 files, about 9,400 lines; ~90 raw SQL calls | home care ~30,000 |
| Screens | about 18,500 lines | home care ~57,000 |
| Roof reports engine | `packages/roof-core` (Google Solar, Nearmap, SAM2, USGS 3DEP, PDF) — already a shared package | |
| Its own suite | `tests/roof`, 21 files, ~430 checks | |
| Permissions | the shared matrix already (`middleware/permissions.ts` re-exports it) | |

## Decisions (owner, 2026-10-19: "do it the right way"; each follows the rulebook)

1. **Roofers use the engine's customers, jobs, quotes, invoices, payments and portal.** One customer list, one
   invoice and payment path; the portal, QuickBooks, reviews, financing, call tracking and reports work for roofers as
   for every vertical, and every engine fix reaches them. Roofing's copies of those routes are not moved.
2. **A roofing job is an engine `job` with roofing's columns added** (nullable, so no other vertical changes):
   sales rep, crew, roof age / type / stories, the insurance block (claim number, carrier, adjuster, date of loss,
   deductible, RCV, ACV, approved scope), revenue and cost, inspection and install dates, measurement report, squares,
   lost reason and closed-at. Columns the engine already has carry roofing's values: `job_number` → `number`,
   `property_address` → `address`, `estimated_revenue` → `estimated_value`; the CRM's required `title` is the
property address, which is what a roofer calls a job. Roofing's job behaviour — the pipeline
   and its advance with texts to the homeowner, close with a reason and reopen, money withheld by permission, photos
   with a type, notes and the timeline — is roofing's own job module over that table, mounted at `/api/jobs` for the
   roof vertical in place of the engine's (a switch, never two mounts: the home-care rule).
3. **A contact keeps one `name`.** Roofing's first / last name become `name` at cutover; where roofing addresses a
   homeowner by first name (its pipeline texts) it takes the first word of the name, by one helper. Roofing's
   `lead_source` → `source`, `mobile_phone` → `mobile`. `property_type` (residential / commercial) is added to
   `contact`, nullable: a roofer files by it, and a job's property is the contact's.
4. **Quotes and invoices are the engine's, lines in its line-item tables.** A roofing quote belongs to a job:
   `quote.job_id` is added (the engine's invoice already has one). At cutover each JSON line becomes a line-item row
   and the totals are kept as they were; numbers are kept. Roofing's quote and invoice behaviour the engine lacks is
   found by running roofing's suite against the engine and ported for every vertical — never a second copy.
5. **Roofing's own parts are its add-on** (`server/crm/roof/`, `web/src/crm/pages/roof/`), each behind the feature
   roofing gates it with: insurance claims, supplements, adjusters, claim activity and the Xactimate export
   (`insurance_workflow`); measurements and roof reports with `packages/roof-core` (`measurement_reports`); storm
   leads, storm radar and canvassing (`storm_lead_gen`, `storm_radar_overlay`, `canvassing_tool`); crews; materials
   (`materials`); the public instant estimator (`instant_estimator`); roofing's dashboard and reports.
6. **The shared modules are the engine's** (sign-in, MFA, team, company, audit, documents, leads, SMS, reviews,
   financing, QuickBooks, call tracking, AI receptionist, ads, email aliases and domain, Google Business, onboarding,
   import, billing, platform support): each roofing copy is diffed against the engine's the near-copy way
   (`docs/UNIFIED_MOVE_GUIDE.md` step 3e) — a trade difference becomes a switch, a fix only roofing has is applied to
   the engine for everyone, an older copy needs nothing.
7. **Names keep their spelling**; roofing's 16 own tables come in as they are, each with `company_id` already.

## Order of work

1. **Schema** — roofing's columns on `job`, `contact`, `quote`, `job_photo`, `roof_report`, `company`; its 16 tables
   in `server/db/schema/roof.ts`; one migration, generated and read before it is kept; re-measured by script.
2. **The vertical** — `verticals/roof/settings.ts` (labels, roles, features, starter help), the roof switch on the
   jobs mount, the suite harness `tests/unified/harness/roof.ts`.
3. **Server, in groups** — (a) jobs onto the engine — **and every other engine route that returns a whole `job` row**
   (the schedule, search, reports, a job beside its invoice or booking, exports, the portal): roofing withholds a job's
   revenue (estimated / final revenue, deductible, RCV, ACV, approved scope) without `invoices:read` and its cost
   (material, labour) without `margin:read`; those columns now sit on the shared table, so one rule
   (`withoutJobMoney`) must shape every read that can return them, or the gate has a side door; (b) insurance; (c) measurements, roof reports, roof-core;
   (d) storms, radar, canvassing; (e) crews, materials, estimator, dashboard, reports; (f) the shared modules' diff.
4. **Screens** — roofing's own pages; its job pages over the engine's job; the engine's quote, invoice, contact and
   portal screens for roofers.
5. **The suite** — `tests/roof` on the unified app as `roof`, every file passing or a documented divergence held by a
   unified test; then the browser, every role, both themes, phone and desktop.
6. **Cutover data steps** — contact names, quote / invoice lines, the job column renames — recorded in
   `docs/CUTOVER_LEDGER.md` as each lands.

## Server landed (2026-10-19)

Steps 1–3 are in: the schema (migration `0012_roof`), the vertical (`verticals/roof/settings.ts`, id **`roofing`** — what
the mobile app reads), roofing's job module on the CRM's job table, the insurance, reports and field groups
(`server/crm/roof/{insurance,reports,field}`), and the shared modules measured against roofing's suite. Roofing's suite
runs clean on the unified app: every file passes or is a divergence held by a named test, and its adapted copies (16
files, about 400 checks) pass. `docs/CUTOVER_LEDGER.md` "Roofing" lists what moved, what changed and why, the cutover data
steps, and what the owner decides before roof reports, the estimator and storm alerts are offered.

Next: step 4, the screens (roofing's own pages under `web/src/crm/pages/roof/`; its jobs pages over the CRM's job; the
CRM's quote, invoice, contact, team and portal screens for roofers), then the browser check.
