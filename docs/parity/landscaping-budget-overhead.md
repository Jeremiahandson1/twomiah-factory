# Landscaping — company budget → overhead recovery → markup (LMN style): NOT BUILT, and what it would take

Branch `cloud/landscaping-depth`. The owner said not now. This page records what the leader does and what building it would involve,
so the next session does not start from nothing. Sources read 2026-10-30:
[how LMN calculates overhead, labor burden and profit](https://support.golmn.com/hc/en-us/articles/47875213217691),
[build your operating budget](https://support.golmn.com/hc/en-us/articles/42333658905115).

## What LMN does

1. **An operating budget per year**: sales by division (design/build, maintenance, irrigation, snow & ice); field labor roles with
   hours, wages, overtime multiplier and a labor-burden %; equipment lines (owned / leased / group); materials and subcontracting
   lines; **overhead** expenses, overhead salaries (including the owner's), overhead equipment and a separate burden for overhead
   wages; a profit target; % unbillable hours; average chargeout rate.
2. **An overhead-recovery method** — MORS (markups for labor, equipment, materials and subs), FLH (an overhead adder in dollars per
   labor hour) or SORS (one markup % on job cost). Overhead ratio = overhead ÷ sales; overhead markup = overhead ÷ the method's cost
   base.
3. **Estimates read the budget**: labor unit cost = wage × overtime factor, plus unbillable % and burden; overhead markup is layered on,
   then profit margin separately; sell price = direct cost (burden included) + overhead + profit. Revenue per man-hour tells the owner
   the price per billable hour needed to hit the sales goal.

## What building it here would take

- **Data** (new additive tables, one migration): `company_budget` (year, status, profit target, recovery method, unbillable %, owner
  salary), budget lines by section (sales, labor, equipment, materials, subs, overhead) with previous-year and forecast dollars. No
  money moves; it is the owner's own planning data, readable only with `reports:read`/owner rights and never shown to crew seats.
- **A calculation module** in `server/data/` (pure, unit-tested against LMN's own worked example: $25/h wage + 29% burden =
  $32.25; 205% overhead markup → about $98.04; 10% profit → about $107.84) producing the rates for the chosen method.
- **A budget screen** in the web app (sections as tabs, totals, the P&L and the resulting rates), with the approval step LMN has
  (a locked, active budget per year).
- **Estimating hooks**: the quote line costs (labor, materials, equipment, subs) must carry a cost, and the shared quote form needs
  to price from cost + markup. That is the contractor session's estimating work (`cloud/contractor-depth`: sections, markup,
  allowances), so it must land first or be built with that session — otherwise two markup models fight.
- **Job costing link**: the existing job costing (every job) can then compare actual cost to the budgeted rates.
- **Tests**: the worked example above, each of the three methods, a crew seat refused, a quote priced from the budget.

Until the contractor session's markup model exists, a landscaping budget would produce rates nothing reads — a half feature — so it
is left unbuilt.
