# Parity: revenue per tech and quote conversion per rep/tech (field service and basic)

Branches `cloud/fieldservice-depth` (first cut) and `cloud/fieldservice-parity` (finished, item 7). Feature id `team_revenue_reports` (NOT READY, `hidden` in `featureRegistry.ts`).
Server: `server/data/teamRevenue.ts`, `server/crm/field/teamReportTables.ts`, `/api/team-revenue/{table,filters,by-tech,quote-conversion,saved,jobs/:id/split}` (`reports:read`; the split follows `jobs:read` / `jobs:update`).
Screen: `web/src/crm/pages/TeamRevenuePage.tsx` (menu row "Team Revenue"). Tests: `tests/team-reports.test.ts`, `tests/team-revenue-finished.test.ts` (both verticals, 42 tests).

**Leaders reviewed (read 2026-10-30, their own help pages):**
Jobber — [Team productivity report](https://help.getjobber.com/en/articles/team-productivity-report/),
[Salesperson performance](https://help.getjobber.com/es/articles/salesperson-performance/),
[Quotes report](https://help.getjobber.com/es/articles/quotes-report/).
ServiceTitan — [Technician Performance report template](https://help.servicetitan.com/how-to/template-technician-performance).
Housecall Pro's employee/estimate reports were not fetched; no claim is made about them.

**What was there:** the Reports page has job counts per assignee, a quote total with one conversion rate, and revenue by customer
and by branch. Nothing cut revenue or quote conversion by person, and quotes did not record who wrote them (`quote.created_by_id`
is new; `quote.salesperson_id`, `quote.converted_at` and `job.revenue_split` are migration 0057). Accounts-receivable aging is the Invoices report's, not this one's.

| # | Leader (from its page) | Ours | Mark |
|---|---|---|---|
| 1 | Jobber: job revenue per team member. ServiceTitan: completed revenue per technician | Revenue per tech: an invoice belongs to the job it bills (the job on the invoice, else the job its quote became — also for deposit / progress / final bills), and that job's assignee. Login techs and roster-only crew both appear | matches |
| 2 | Both: revenue shown for the period picked | Two figures per tech: **invoiced** (not draft/void, by the day made — same as Reports) and **collected** (payment ledger by the day taken, net of refunds) | matches; beats on showing both |
| 3 | Revenue counted when the job/visit happens (Jobber: last visit in range; ServiceTitan: job completed in range) | Counted when the invoice is made / the payment is taken. **A different basis**, stated on the page | differs, on purpose — the number then equals the Reports page |
| 4 | Revenue split across several assignees (Jobber by hours, ServiceTitan by split %) | Several people on a job; its invoices and payments are shared **equally, by billable hours logged on the job, or by percentages** (must total 100, only people on the job). Exact cents (largest remainder), parts add to the Reports totals. Choose on the job page | matches. Limits: roster-only crew log no hours, so an hours split gives them 0; if the crew changes after percentages were set the job falls back to equal and says so |
| 5 | ServiceTitan: "unattributed adjustment invoices" column | Two named rows — "No one on the job" and "Not on a job (office sales)" — and the rows add to the total (tested against the Reports page) | matches; the second bucket is ours |
| 6 | Jobber: salesperson on a quote (one per quote), with sent / converted counts, values and a conversion rate | A **Salesperson** field on the quote (the writer by default, any team member, or no one), kept apart from who typed it; report by salesperson, writer or tech: quotes, won, lost, waiting, won value, win rate | matches |
| 7 | Jobber: quotes made before attribution existed are left out | They stay in, as "Written before we kept track", so totals still add up | beats |
| 8 | ServiceTitan: close rate per technician | Win rate per tech = the tech on the job each quote became. A quote that never became a job has no tech and is its own row | matches in spirit; ServiceTitan's close rate counts opportunities by job completion date, ours counts quotes by the day made |
| 9 | Jobber's conversion rate: converted ÷ sent (it can exceed 100%) | Won ÷ decided (won, turned down, expired); quotes still waiting are not losses. Never above 100%. The Reports page's definition | differs, on purpose |
| 10 | Jobber: date filter by drafted / sent / approved / converted | Quotes counted on **drafted, sent, approved, converted to a job, or job completed**; a quote lacking that date is left out. Converted dates before migration 0057 are backfilled from the job made from the quote | matches |
| 11 | Both: date presets and a custom range | Presets plus a **custom start and end** on the page | matches |
| 12 | Jobber Quotes report: filter by client or salesperson; choose columns; CSV | Filter by customer and person, choose columns, CSV (with byte-order mark and total line), and save / schedule by email | matches |
| 13 | ServiceTitan: drill into the jobs and invoices behind a number | Each number opens its invoices, jobs or quotes, with a person's share, and links to the invoice, customer, job or quote | matches |
| 14 | Jobber: revenue ÷ hours (productivity); ServiceTitan: billable hours, revenue per hour | **Billable hours** and **revenue per hour** per person (plus collected per hour). Hours are billable time entries in the period, approved or not | matches |

**Parity verdict:** every row is built and tested through the real server on field service and basic. Row 3 still differs on purpose (revenue counts when the invoice is made / paid, so the number equals the Reports page). Row 9 differs on purpose. **Not seen in a real browser.**
