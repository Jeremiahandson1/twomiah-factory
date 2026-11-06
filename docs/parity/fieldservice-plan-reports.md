# Parity: service-plan reports (field service and basic)

Branch `cloud/fieldservice-parity`, item 6 (the first build was item 8 of `cloud/fieldservice-depth`). Feature id `plan_reports` (NOT READY, `hidden` in `featureRegistry.ts`).
Server: `server/data/teamReports.ts` + `planReports.ts`, `server/crm/field/planReportTables.ts` / `planReportRoutes.ts` / `savedReports.ts`;
`/api/plan-reports/{sold,renewals,churned,table,filters,saved}` (`reports:read`). Plan actions: `/api/agreements/:id/{suspend,reactivate,history}`.
Screen: `web/src/crm/pages/PlanReportsPage.tsx` (menu row "Plan Reports"). Tests: `tests/plan-reports-finished.test.ts` (new), `tests/team-reports.test.ts`.
Columns from migration 0043: `service_agreement.sold_by_id`, `ended_at`, `ended_how`, `cancel_reason`. Migration 0054 adds `agreement_event`
(made / renewed / suspended / reactivated / cancelled / ran out, with who and when), `saved_report`, and `invoice.service_agreement_id`
(plus a backfill of history and invoice links for plans that already exist).

**Leaders reviewed (read 2026-10-30, their own help pages):**
Housecall Pro — [Service plan reporting](https://help.housecallpro.com/en/articles/7068257-service-plan-reporting).
ServiceTitan — [Membership Summary report template](https://help.servicetitan.com/docs/membership-summary-report-template).
Jobber has no comparable plan report that was reviewed; no claim is made about it.

| # | Leader (from its page) | Ours | Mark |
|---|---|---|---|
| 1 | Housecall Pro: plans sold by employee ("Sold by" field). ServiceTitan: "Sold By" per membership | "Sold by" box on the plan (default: the signed-in person; any team member; or no one), checked against the team; can be changed later. Sold-by tab counts plans per person with yearly value and still-active | matches |
| 2 | Plans made before the field existed | A row "Made before we kept track"; nobody is guessed | beats (neither page says) |
| 3 | ServiceTitan: renewals — a count of memberships renewed in the range | "Renewed" column on the Summary tab and a History tab listing each renewal (manual or automatic) with the day | matches, with a limit: renewals before migration 0054 were never recorded and are not invented |
| 4 | Neither page lists what is **coming due** | Plans ending in the next 30 or 60 days, with customer, date, yearly value, and whether it renews on its own or **needs a person** | beats |
| 5 | ServiceTitan: Canceled and Expired counts per membership type; status date in the drill-down | Each ended plan listed: cancelled or ran out, the day, the reason, who sold it, yearly value; counts per plan name on the Summary tab | matches; beats on the reason and the seller |
| 6 | The day an older plan ended | Plans ended before 0043 are dated by their last change and the page says "about" | stated limit |
| 7 | ServiceTitan: suspended, reactivated, deleted, active at start / end | A plan can be suspended (no billing, no new visits, term does not run out) and reactivated (the days held are added to the term). Summary tab: active at start, made, renewed, suspended, reactivated, cancelled, ran out, active at end — per plan name and in total. The History tab lists every change | matches, with the same limit: suspensions before 0054 were not recorded |
| 8 | Housecall Pro: recurring revenue and collected revenue from plans, by month for 12 months; plans by name | Revenue tab: recurring (the monthly value of plans active at each month end; a plan on hold is not counted) or collected (payments on the plan's invoices, net of refunds), 12 months, one row per plan name and a total. Billing now links its invoice to the plan; older invoices were linked by their wording in the migration | matches |
| 9 | Both: filters, editable columns, custom/scheduled reports | Filters (plan name, seller, customer, status), a custom date range, a column chooser, CSV, saved reports by name (editable) and scheduled ones (weekly or monthly, emailed with the CSV, once a day) | matches |
| 10 | ServiceTitan: drill-down links to customer, invoice and membership | Customer, plan and invoice cells are links; a count (plans sold, suspended, collected in a month) opens the records behind it | matches |

**Parity verdict:** full parity on the rows above, with one stated limit: renewals, suspensions and reactivations that happened before
the history table existed (migration 0054) were never recorded, so those counts start the day it was added. Plans that already
exist get a "made" and an "ended" entry from their own dates.

**Not seen in a real browser.** The page and the Plans-page changes compile and are exercised through the server by the tests, but
nobody has clicked through them.
