# Parity: service-plan reports (field service and basic)

Branch `cloud/fieldservice-depth`, item 8. Feature id `plan_reports` (NOT READY, `hidden` in `featureRegistry.ts`).
Server: `server/data/teamReports.ts`, `/api/plan-reports/{sold,renewals,churned}` (`reports:read`).
Screen: `web/src/crm/pages/PlanReportsPage.tsx` (menu row "Plan Reports"). Test: `tests/team-reports.test.ts`.
New columns (migration 0041): `service_agreement.sold_by_id`, `ended_at`, `ended_how`, `cancel_reason`.

**Leaders reviewed (read 2026-10-30, their own help pages):**
Housecall Pro — [Service plan reporting](https://help.housecallpro.com/en/articles/7068257-service-plan-reporting).
ServiceTitan — [Membership Summary report template](https://help.servicetitan.com/docs/membership-summary-report-template).
Jobber has no comparable plan report that was reviewed; no claim is made about it.

| # | Leader (from its page) | Ours | Mark |
|---|---|---|---|
| 1 | Housecall Pro: plans sold by employee ("Sold by" field). ServiceTitan: "Sold By" per membership | Plans sold in the period per person, with yearly value and how many are still active. The seller is recorded when the plan is made (the signed-in person) | matches, with a difference: the seller cannot be changed or chosen — parity needs a "sold by" box on the plan |
| 2 | Plans made before the field existed | A row "Made before we kept track"; nobody is guessed | beats (neither page says) |
| 3 | ServiceTitan: renewals — a count of memberships renewed in the range | Not counted | not doing |
| 4 | Neither page lists what is **coming due** (Housecall Pro's page says renewals are not covered) | Plans ending in the next 30 or 60 days, with customer, date, yearly value, and whether it renews on its own or **needs a person** (a manual plan lapses otherwise) | beats |
| 5 | ServiceTitan: Canceled and Expired counts per membership type; status date in the drill-down | Each ended plan listed: cancelled or ran out, the day, the reason typed when it was cancelled, who sold it, yearly value | matches; beats on the reason and the seller |
| 6 | The day an older plan ended | Plans ended before 0041 are dated by their last change and the page says "about" | stated limit |
| 7 | ServiceTitan: suspended, reactivated, deleted, active at start / end | Not tracked | not doing |
| 8 | Housecall Pro: recurring revenue and collected revenue from plans, by month for 12 months; plans by name | Not built. Yearly value is shown per seller and per plan only | not doing — parity needs revenue by plan and by month |
| 9 | Both: filters, editable columns, custom/scheduled reports | Period picker only | not doing |
| 10 | ServiceTitan: drill-down links to customer, invoice and membership | Customer name and plan number shown, no links | not doing |

**Parity verdict:** plans sold by person, renewals due and churn exist. Rows 1 (the seller box), 3, 7–10 are what a full match would
still need.
