# Landscaping — company budget → overhead recovery → markup (LMN style): BUILT (11/06 parity round, row 27; `company_budget`, hidden)

Sources read 2026-10-30:
[how LMN calculates overhead, labor burden and profit](https://support.golmn.com/hc/en-us/articles/47875213217691),
[build your operating budget](https://support.golmn.com/hc/en-us/articles/42333658905115). LMN's help pages refused a fetch on 11/06
(403); the method definitions below agree with the trade press (Lawn & Landscape's overhead ÷ labour-with-burden markup; the
labour-hour overhead adder in Landscape Management).

## What is built

- **Budget screen** (Landscaping › Budget; `margin:read` to read, `company:update` to change): a budget per year — sales by division,
  field labour roles (people × hours × wage) with burden, overtime share and multiplier and unbillable %, equipment, materials, subs,
  overhead and overhead wages (the owner's salary) with their own burden, a profit %, and the recovery method.
- **The three methods** (`server/data/companyBudget.ts`, pure): MORS (fixed materials/equipment/subs markups, the rest on labour),
  FLH (overhead ÷ billable hours, a dollar adder per hour), SORS (overhead ÷ direct cost on everything). Profit is a markup on cost
  plus overhead. LMN's worked example passes: $25 + 29% = $32.25 → $98.04 at 204% → $107.84 at 10%.
- **Locked active budget**: a draft until made active; the active one for a year is locked and the year's previous active one
  archived (one active budget per year, a unique index); change it by copying to a new draft.
- **Quotes priced from it**: "Use for quotes" writes the active budget's markups into the quote form's **markup defaults** (the
  existing model, now offered to landscaping) — labour lines labour's, material and part lines materials', service lines subs',
  other lines equipment's, each with profit. One markup model, not two. Test: `landscaping-budget-parity.test.ts`.
- Not built: a comparison of the year's actual job costs against the budget (job costing already shows each job's actual cost).

## What LMN does (as recorded on 10/30)

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
