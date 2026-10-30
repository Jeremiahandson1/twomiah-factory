# Parity: revenue per tech and quote conversion per rep/tech (field service and basic)

Branch `cloud/fieldservice-depth`, item 6. Feature id `team_revenue_reports` (NOT READY, `hidden` in `featureRegistry.ts`).
Server: `server/data/teamReports.ts`, `/api/team-revenue/by-tech` and `/api/team-revenue/quote-conversion` (`reports:read`).
Screen: `web/src/crm/pages/TeamRevenuePage.tsx` (menu row "Team Revenue"). Test: `tests/team-reports.test.ts`.

**Leaders reviewed (read 2026-10-30, their own help pages):**
Jobber — [Team productivity report](https://help.getjobber.com/en/articles/team-productivity-report/),
[Salesperson performance](https://help.getjobber.com/es/articles/salesperson-performance/),
[Quotes report](https://help.getjobber.com/es/articles/quotes-report/).
ServiceTitan — [Technician Performance report template](https://help.servicetitan.com/how-to/template-technician-performance).
Housecall Pro's employee/estimate reports were not fetched; no claim is made about them.

**What was there:** the Reports page has job counts per assignee, a quote total with one conversion rate, and revenue by customer
and by branch. Nothing cut revenue or quote conversion by person, and quotes did not record who wrote them (`quote.created_by_id`
is new, migration 0041). Accounts-receivable aging is the Invoices report's, not this one's.

| # | Leader (from its page) | Ours | Mark |
|---|---|---|---|
| 1 | Jobber: job revenue per team member. ServiceTitan: completed revenue per technician | Revenue per tech: an invoice belongs to the job it bills (the job on the invoice, else the job its quote became — also for deposit / progress / final bills), and that job's assignee. Login techs and roster-only crew both appear | matches |
| 2 | Both: revenue shown for the period picked | Two figures per tech: **invoiced** (not draft/void, by the day made — same as Reports) and **collected** (payment ledger by the day taken, net of refunds) | matches; beats on showing both |
| 3 | Revenue counted when the job/visit happens (Jobber: last visit in range; ServiceTitan: job completed in range) | Counted when the invoice is made / the payment is taken. **A different basis**, stated on the page | differs, on purpose — the number then equals the Reports page |
| 4 | Revenue split across several assignees (Jobber by hours, ServiceTitan by split %) | A job here has exactly one person on it, so there is nothing to split | not doing — parity for crews needs multi-assignee jobs |
| 5 | ServiceTitan: "unattributed adjustment invoices" column | Two named rows — "No one on the job" and "Not on a job (office sales)" — and the rows add to the total (tested against the Reports page) | matches; the second bucket is ours |
| 6 | Jobber: salesperson on a quote (one per quote), with sent / converted counts, values and a conversion rate | Per person who wrote the quote: quotes, won, lost, waiting, won value, win rate | matches, with a difference: **ours is whoever created the quote**; there is no separate "salesperson" field to choose |
| 7 | Jobber: quotes made before attribution existed are left out | They stay in, as "Written before we kept track", so totals still add up | beats |
| 8 | ServiceTitan: close rate per technician | Win rate per tech = the tech on the job each quote became. A quote that never became a job has no tech and is its own row | matches in spirit; ServiceTitan's close rate counts opportunities by job completion date, ours counts quotes by the day made |
| 9 | Jobber's conversion rate: converted ÷ sent (it can exceed 100%) | Won ÷ decided (won, turned down, expired); quotes still waiting are not losses. Never above 100%. The Reports page's definition | differs, on purpose |
| 10 | Jobber: date filter by drafted / sent / approved / converted | One: the day the quote was made | not doing — parity needs a choice of date |
| 11 | Both: date presets and a custom range | Five presets in the page (this month, last 30 days, quarter, year, all). The API takes any start/end day; the page has no custom-range box | partly — page needs a custom range |
| 12 | Jobber Quotes report: filter by client or salesperson; choose columns; CSV | None of the three | not doing |
| 13 | ServiceTitan: drill into the jobs and invoices behind a number | None | not doing |
| 14 | Jobber: revenue ÷ hours (productivity); ServiceTitan: billable hours, revenue per hour | None | not doing — outside this item; needs time tracked per job |

**Parity verdict:** the two reports the brief names exist and agree with the Reports page. Rows 4, 10–14 are what a full match
would still need; none is started.
