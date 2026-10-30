# Roofing parity — commissions and job costing (gap 2)

Leaders: AccuLynx (Commissions is an Elite add-on) and JobNimbus (Profit Tracker). Read from their own pages on 2026-10-30;
where a page said nothing about a point it is marked "not stated", never assumed.

Sources
- AccuLynx, Commissions setup guide (states it needs Elite): [support.acculynx.com article attachment](https://support.acculynx.com/hc/en-us/article_attachments/24835038205453)
- AccuLynx, [Using AccuLynx to manage your roofing sales commissions](https://acculynx.com/using-acculynx-to-manage-your-commissions-structure/), [Roofing finance features](https://acculynx.com/features/roofing-finance/), [Guide to Financial Worksheets](https://acculynx.com/guide-to-financial-worksheets-in-acculynx/)
- JobNimbus, [How can I track commissions with the Profit Tracker](https://support.jobnimbus.com/how-can-i-track-commissions-with-the-profit-tracker), [What is the Profit Tracker](https://support.jobnimbus.com/what-is-the-profit-tracker)

## Commissions

| # | What the leaders do | Twomiah (roofing) | Mark |
|---|---|---|---|
| 1 | Commission on the total sale amount, the signed contract — AccuLynx. On planned revenue — JobNimbus | A plan "% of the contract (before tax)" pays on everything invoiced on the job before sales tax, worked out once, when the job is Collected (`server/crm/roof/commissions.ts`). It is on what was actually billed, not a planned figure | **Matches** |
| 2 | Commission on gross profit (profit after material and labour are paid) — AccuLynx. On planned profit — JobNimbus | A plan "% of gross profit" pays on the contract less what the job cost: material orders placed, the crew's pay, hours clocked, expenses and vendor bills — the same figures the Job Costing screen shows. Before this change a margin plan could never pay by itself because no cost basis was known | **Matches** (actual profit at Collected; JobNimbus's is planned) |
| 3 | Flat fee — JobNimbus; a fixed dollar amount per job (pre-commission) — AccuLynx | "Flat amount per job" plan, paid when the job is Collected | **Matches** |
| 4 | A rate per salesperson — AccuLynx. Default commissions assigned to the job's salesperson — JobNimbus | A plan can name the people it pays; it pays the job's **sales rep** (`assignedSalesRepId`), not the crew's slot or whoever typed the lead in. A plan naming nobody pays any rep who has no plan of their own | **Matches** |
| 5 | Different rates by job-profit threshold — AccuLynx | Tiered plans exist but measure the contract amount, not profit | **Not doing** — parity needs tiered brackets measured on the job's gross profit |
| 6 | A company minimum profit, in percent or dollars — AccuLynx | Not built. A job that made nothing pays nothing on a profit plan; there is no floor below which the contract plan stops paying | **Not doing** |
| 7 | More than one commission on a job — JobNimbus; additional (office, estimator, canvasser) and management (production, sales manager) commissions on gross profit, net profit or total sales — AccuLynx | Several plans can each pay the rep (the test pays two on one job). A manager's or canvasser's override cannot be paid automatically — only the rep is; one can be recorded by hand on the Commissions page | **Partly** — parity needs a plan that pays a job's other people (office, estimator, manager) |
| 8 | A commission is ready to request on a job status (Approved, Completed or Invoiced), optionally only with a $0 balance — AccuLynx | Only when the job is **Collected**: every invoice that went out is paid in full. Stricter and simpler; a rep is not owed on a job that collapses after a deposit | **Different by design** — parity needs a choice of earlier triggers |
| 9 | Pre-commissions: a draw when the job is turned in — AccuLynx | Not built; a one-off amount can be recorded by hand | **Not doing** |
| 10 | Earned, approved and paid states; payouts with a date — AccuLynx, JobNimbus | pending → approved → paid, disputed, void and reassign, a second person approves (nobody below an admin signs off their own pay), an audit trail, statements | **Matches** (existing) |
| 11 | A rep sees what they earn on each job and their earnings by year — AccuLynx | The rep sees their own commissions (each record carries its job) and a statement over any dates; never anyone else's. Whether the screen prints the job number on each line was not checked | **Matches** on the server; the screen's job column **not verified** |
| 12 | Which roles see commissions, set per company — AccuLynx | Fixed by permission: commissions:read (owner, admin, manager); a seat without it sees only its own earnings; per-person grants exist | **Different by design** |
| 13 | A commission disclaimer for people who collect commissions — AccuLynx | Not built | **Not doing** |
| 14 | A full refund takes the commission back | The commission hangs on the job's last-paid invoice; refunding that invoice in full cancels it (or, if already paid out, adds a negative line). A refund of an earlier invoice does not. The leaders' pages say nothing | **Not compared** |

## Job P&L

| # | What the leaders do | Twomiah (roofing) | Mark |
|---|---|---|---|
| 15 | Material orders feed the job's costs — JobNimbus Profit Tracker imports Material Orders | Every order placed for the job (ordered, partly or fully delivered) counts at its total; a list still "not ordered" and a cancelled order do not (`server/crm/roof/jobCosts.ts`). Nothing to import | **Matches** |
| 16 | Labour: Work Orders imported — JobNimbus; expenses on the financial worksheet — AccuLynx | The crew assigned to the job is paid *pay per square × the job's squares* (a new field on the Crew, shown only to a seat with margin:read); hours clocked on the job are costed as before, and then the crew's pay is not counted beside them. A crew with no rate, or a job with no squares, shows "not known" instead of $0 | **Matches** for pay by the square. A lump-sum crew price per job needs the work orders of gap 5 |
| 17 | Subcontractor cost | Subcontractor expenses and vendor bills against the job are costed (existing). The JobNimbus page does not mention subcontractors | **Not compared** |
| 18 | Supplements as part of the job's money — AccuLynx adds them to the worksheet as an amendment | The job's supplements are on its costing screen: approved, waiting, and each one's number and reason. **Approved supplements raise the estimated revenue**; revenue actually earned is what is invoiced, so a supplement counts once it is billed — never twice | **Matches in effect; different in method** — an approved supplement is not put on an invoice by itself |
| 19 | Planned against actual — JobNimbus; change against the original signed contract — AccuLynx | Estimated against actual with a variance on cost, labour, material and hours (existing screen), now with the roof's figures in both | **Matches** |
| 20 | Commission payouts change the job's profit — JobNimbus (paid payouts affect Actual Profit) | The Job Costing screen's profit is before commissions | **Not doing** — parity needs commissions counted as a job cost, taking care that a profit-based commission is not worked out on a profit it has already reduced |
| 21 | A job-profitability report across jobs — AccuLynx | The roll-up of every job's invoiced, cost, profit and margin, by month, filterable by stage and date | **Matches** |
| 22 | Job profit fed from QuickBooks or Sage Intacct — AccuLynx | Reads this CRM's own ledgers; QuickBooks is a separate sync | **Different by design** |
| 23 | Worksheet approval before it counts — AccuLynx; access levels No access / View / Create & Edit / Delete — JobNimbus | Job Costing needs reports:read (owner, admin, manager); a crew's pay needs margin:read. No approval step | **Matches** on access; approval **Not doing** |

## What this change builds
- Commission Tracking and Job Costing are offered to roofing (`packages/tenant-backend/src/featureRegistry.ts`); both are existing ids, so nothing is newly registered. A business sees the menu rows only with the feature on and the permission (the shared menu's own gates: commissions:read, reports:read).
- A plan can pay the job's sales rep when the whole job is paid (`job_sales_rep`): `server/crm/roof/commissions.ts`, run after money lands on an invoice (`server/crm/roof/index.ts`) and when the office moves a job to Collected by hand (`server/crm/roof/jobs.ts`). Behind a switch only roofing turns on (`salesRepAutoEarn` in `packages/tenant-backend/src/commissions/commissions.ts`; the other trades are refused the choice).
- Job Costing reads a roof job's material orders, its crew's pay and its supplements (`server/crm/roof/jobCosts.ts`, `server/crm/field/jobCostingService.ts`); the screen shows them (`packages/tenant-ui` JobCostingPage).
- Crew: pay per square (migration `0046_roof_crew_pay`, `crew.pay_per_square`), withheld without margin:read.

## Still needed for full parity (not in this change)
Rows 5, 6, 7 (people other than the rep), 8 (earlier triggers), 9, 13, 20; 16 (a crew's lump-sum price, with gap 5's work orders); 23 (approval).
