# Contractor / builder parity — Buildertrend, JobTread, Jobber

**Re-checked against the code 11/10:** every row below that was "not built" or "partly" on 10/31 has since been built (10/31
commits and rows 7–12 on 11/06), each hidden until tried; see the feature id on its row. The Buildertrend inventory section near the
end (11/10) lists what is still missing.

**Status (10/31).** The research was done before 10/30 from the vendors' own help pages (the checklist in the 10/30 follow-up
to the cloud session, "build each item to THIS checklist"); PR #173 built against it and is live since 10/31 (main
f855f4d65). Built features that are not yet tested stay hidden (`project_templates`, `inspection_checklists`, `ar_aging`,
`wip_report`, `job_budgets`). Marks: **built** · **partly** (what is missing is named) · **not built** · **beats** (the
leaders' pages do not document it). Checked against the code on 10/31 where the PR report did not say.

## Estimating (the biggest gap)

| Leader feature | Twomiah | Mark |
|---|---|---|
| Quote sections / groups (room by room, by cost-code group) | sections with subtotals on screen, PDF and the customer's page | built |
| Multi-line line descriptions | yes | built |
| Cost type per line (labour / material / sub / equipment / other) | `type` per line (labor, material, part, service, other) | built |
| **Default markup % per cost type**, overridable per line, markup or margin shown live | built (`markup_defaults`, 10/31): the usual markup per kind of line fills a line with a cost; the quote shows the margin as it is built | built |
| Allowance lines that become Selections allowances | an allowance line opens on Selections when the quote is approved | built |
| One allowance covering several selections; overages flowing to a revised budget | built (`shared_allowances`, row 7a): project_allowance; overage charged as change orders as each is approved, credit on the last; Job Costing budget shows the revisions and revised totals | built |
| Quote templates (lines, deposit, message, terms) and "create similar" | built (`quote_templates`, 10/31) | built |
| Optional items (can be pre-selected; deposit recalculates when the client adds one) | optional lines ticked by office or customer, deposit follows (`quoteOptions.ts`) | built |
| Line images | built (`quote_line_images`, 10/31) | built |
| Automatic quote follow-up | built (`quote_followup`, 10/31): emailed a few days after sending, once per step, never after they answer or unsubscribe | built |
| Good / better / best options | one implementation for every quoting trade (10/31, `quote_proposals`, hidden) | built |
| **Approved quote → project budget** (original budget = the signed quote) | approved quote → budget by cost code; Job Costing's "Project budgets" panel | built |
| Bills / purchase orders linked to budget lines; projected profit per line | built (`cost_by_code`, 10/31): time, expenses and vendor bills filed under a cost code, so each budget line shows its cost and profit | built |
| A JobTread-style formula / parameter engine | built (`quote_formulas`, row 9): parameters on a job and a quote (the quote's win); line quantity / price formulas over parameters and other lines by name (round, ceil, floor, roundup, min, max, abs, sqrt); worked out on every save and when the job's parameters change (open quotes, a broken one named and left as it was); errors in words; kept in quote templates and as a price-guide item's quantity formula; a takeoff measurement fills a job parameter | built |

## Reports

| Leader feature | Twomiah | Mark |
|---|---|---|
| AR aging (current / 1–30 / 31–60 / 61–90 / 90+ by customer) | built (`ar_aging`); an invoice with no due date counts as current | built |
| WIP: contract value incl. approved change orders, cost to date, % complete by cost, earned revenue, billed, over/under billing | built (`wip_report`); % complete is cost-to-cost where a budget exists. With `shared_allowances`, approved selection changes that raised no change order are in the contract value too (row 7a) | built |
| Job profit list | built | built |

## Dashboard

| Leader feature | Twomiah | Mark |
|---|---|---|
| Cash collected vs owed, past due | on every trade's home screen | built |
| Unanswered leads | yes | built |
| Today's work | Today's board on for contractor | built |
| Pipeline strip: count and $ at each stage (leads → quotes → jobs → invoices) | built (`lead_pipeline`, 10/31) | built |
| "Needs me" list incl. quotes awaiting a reply | built (`lead_pipeline` and `owner_dashboard`, 10/31): quotes still waiting on a customer, longest first; bills due, jobs nobody is on, projects over budget | built |
| An owner view and a crew view | built (`owner_dashboard`, `crew_dashboard`, 10/31): the owner's "needs you today"; the crew's jobs today and next, hours this week, open tasks | built |

## Lead inbox

| Leader feature | Twomiah | Mark |
|---|---|---|
| Convert straight to a quote, a job or a project | one step | built |
| A human "Spam" action (hidden from New and counts, undo) | yes — neither Jobber nor Housecall documents one | beats |
| Source tag | leads carry their source | built |
| A site-visit / assessment step a lead can be booked into | built (`lead_site_visit`, 10/31): booked from the enquiry onto the schedule, moved or cancelled | built |
| Lost with a reason | built (`lead_lost`, 10/31) | built |

## Inspections

| Leader feature | Twomiah | Mark |
|---|---|---|
| Checklist templates: pass / fail / n.a., note, photo per item | built (`inspection_checklists`) | built |
| A failed item creates a punch-list item | yes — no leader documents the link | beats |
| Signature | built (`inspection_signature`, 10/31): the customer signs on the phone, with the record a signed quote keeps | built |
| Auto-attach a checklist by job / project type | built (`inspection_auto_checklists`, 10/31) | built |
| Filled in on the phone | built (`phone_inspections`, 10/31; row 11b): crew answer on the jobs they are on, with no signal | built |

## Project templates

| Leader feature | Twomiah | Mark |
|---|---|---|
| Save any project as a template; start one from it (phases, to-dos, punch-list starter) | built (`project_templates`) | built |
| Template carries budget lines and selections; tick which parts to import | built (`template_parts`, row 7b): budget lines, selections and shared allowances kept; ticks on saving and on starting | built |
| Task dependencies carried over | built (`template_parts`, row 7b): task links and lag kept and recreated with the tasks; on the schedule (`task_links`, row 7c): link after-ends / when-starts plus lag, linked tasks move with the one they wait on, loops refused | built |

## Navigation and pages

| Leader feature | Twomiah | Mark |
|---|---|---|
| Collapsible groups in workflow order, each trade its own order, every item in a group | built | built |
| Open / closed remembered per user | yes (per user, on that browser) | built |
| Collapse-to-icons rail | built (`nav_rail`, row 8), kept per user | built |
| No blank pages while loading | every page says what it is loading | built |

## Pricing
Every feature included for every seat (seat plans only) — Jobber gates optional items, images and follow-ups to its Grow
plan. **beats**, on price.

## Buildertrend inventory (11/10)

Read view-only from a working Buildertrend account (the owner's inventory, 11/10) and checked against our code the same day. Only
what we do not have is listed; everything else in the inventory is built (the rows above, and `contractor-portal.md`,
`contractor-payments.md`, `contractor-phone.md`).

| Buildertrend | Ours (code, 11/10) | Mark | For which trades | Where it is built (share first) |
|---|---|---|---|---|
| **Credit memos** on invoices | built 11/10, hidden (`credit_memos`): customer credit issued with a reason, spent on any of the customer's invoices (Record payment › Account balance), a refund kept as credit — on the salon's ledger (`crm/billing/creditMemos.ts`, `tests/parity-credit-memos.test.ts`). Not done: a numbered credit memo document / PDF; Reports' "collected" counts credit spent | yes (hidden) |
| **Workday exceptions**: holidays and days off the schedule skips | **built 11/10 (tier 2 #1), hidden** — `days_off`: Settings › Days off (one press adds the usual US holidays); the rows are online booking's own (booking_blackout, no person, whole day), so booking closes too; a job booked on one warns and can be booked anyway (a series lists it as not booked); Find a time skips it; the Dispatch Board says Closed; a plan's visit moves to the next open day | built | every job trade | **shared**: `apps/unified/server/data/daysOff.ts` |
| **Photo folders per job** (pre-sale, progress, from change orders and messages) | **built 11/10 (tier 2 #2), hidden** — `photo_folders`: the job page's photos in folders with counts, a folder picked when one is added, moved from the full-size view; the job's own photos (`job_photo.photo_type`: before, during, after, progress, damage, inspection, issue — roofing's kinds among them) and the contractor's photo library (its category) | built | contractor, field service, landscaping, basic (roofing's own job page already files by kind) | **shared**: `packages/tenant-ui/src/jobs/JobPhotosPanel.tsx`, tenant-backend jobs.ts PATCH /:id/photos/:photoId |
| **Lead map** | built 11/10, hidden (`lead_map`): Lead Map pins each enquiry the seat reads by its typed location, looked up once with Google's geocoder when the map is opened; colours by state, won and lost on request; roofing's pin map moved into `tenant-ui/src/maps/PinMap.tsx` and shared (`server/crm/leads/leadMap.ts`, `tests/parity-lead-map.test.ts`) | yes (hidden) |
| **Weekly client update** (a digest, liked / read) | built 11/10, hidden (`weekly_client_update`): once a week, on the day and hour the business picks, each client with something new in their portal that week gets one email by project or job (daily logs, photos, files; roofing's photos, documents, reports and posts); the button records the first opening; Settings › Weekly Client Update shows each send and whether it was opened (`server/crm/clientUpdates/weeklyUpdate.ts`, `tests/parity-weekly-update.test.ts`). Not done: the client "liking" an update; an old item shared this week is not listed (sharing keeps no date) | yes (hidden) |
| **Bid packages to subs**: send a package, track each sub's response, compare bids | "Bids" (`crm/projects/bids.ts`) are the company's own bids to clients; nothing goes to subs | not built | contractor (roofing and landscaping sub out work too, but have no vendors or vendor portal today) | contractor first, **on the vendor portal and purchase orders** (`vendor_portal`, `purchase_orders`): a won bid becomes the sub's PO. Opens to roofing / landscaping with the vendor portal, not as a second build |
| **Schedule baseline**, and baseline vs actual duration (also a report) | built 11/10, hidden (`schedule_baseline`): on the Gantt chart, save a project's schedule as its baseline; each task's plan against now in days (start, finish, length), tasks added or removed since, and the project's finish slip (`crm/projects/baselines.ts` on the existing `project_baseline` table, `tests/parity-schedule-baseline.test.ts`). Not done: ghost bars on the chart; a company-wide report | yes (hidden) |
| Builder's risk insurance on a job; cost / price per sq ft on the jobs list | built 11/10, hidden (`builders_risk`): a project's square feet — price and budget per square foot (money for seats that see it) — and its builder's risk policy (insurer, number, cover, dates), flagged within 30 days of its end or ended while open (`crm/projects/projectDetails.ts`, `tests/parity-builders-risk.test.ts`). Not done: per-sq-ft columns on the projects list; actual cost per sq ft | yes (hidden) |

**Rule for building these:** shared first — the shared ones are also listed in `shared-backlog.md`, for every trade. Four of the eight (credit memos, workday exceptions, photo folders, lead map) and the weekly
update are built once in the shared packages and switched on per trade, as warranties and equipment are — never inside the
contractor first and copied later. Each extends what is already there (`job_photo.photo_type`, roofing's `PinMap`, booking's closed
days, the portal's per-item sharing), so nothing gets a second version.

Also checked and built: **hiding the schedule** ("Schedule Offline") — the client's schedule is off / phases / every task per
project (row 10a), and subs never see it (the vendor portal shows a sub its own purchase orders only).

Set aside, not counted as gaps: **AI Bill Capture** (a paid AI call per receipt — the parked paid features) and the **partner
integrations** (Gusto, Lowe's PRO, Home Depot, HubSpot, Salesforce, Pipedrive, Bluebeam), which need partner accounts.

## What is left, in the order a builder would feel it (11/10)
Shared ones first (they serve every trade at once), then the contractor's own:
1. ~~Workday exceptions~~ — built 11/10 (`days_off`, hidden).
2. ~~Photo folders per job~~ — built 11/10 (`photo_folders`, hidden).
3. Credit memos — **shared**.
4. Lead map — **shared** (roofing's pin map moved into the shared maps).
5. Weekly client update — **shared** portal.
6. Bid packages to subs — contractor, on the vendor portal.
7. Schedule baseline and baseline vs actual — contractor (finish `project_baseline`).
8. Builder's risk field; cost / price per sq ft on the jobs list — contractor.

The 10/31 list (quote templates, markup defaults, cost by code, pipeline and dashboards, lead site visits and Lost, inspections on
the phone, template parts) is built.

Still open from the other contractor files: a message thread per **project** in the client portal (today one thread per contact;
roofing has one per job), and "seen" for documents, not only quotes (`contractor-portal.md`). `contractor-payments.md` and
`contractor-phone.md` are built in full (re-checked 11/10).
