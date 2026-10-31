# Salon #8 — Stylist commissions

## Sources (help-centre pages actually read)

- Square — Set up and manage commissions (Support Center, US): https://squareup.com/help/us/en/article/7145
- Square — "New: Fixed Rate and Tiered Commissions with Square Appointments" (product announcement): https://sellercommunity.com/t5/Product-Updates/New-Fixed-Rate-and-Tiered-Commissions-with-Square-Appointments/ba-p/276688
- Prospyr (a med-spa platform) — How to set up commission plans: https://help.prospyrmed.com/en/articles/16766735-how-to-set-up-commission-plans

Vagaro's and GlossGenius's commission help pages were searched for and not reached (only job ads, review sites and marketing pages came back), so nothing below claims a match against Vagaro or GlossGenius. The Square help article is written for several Square products and has no Appointments-only section; it names Appointments Premium among the plans it covers.

## What they do, and where this stands

| Capability | Here | Status |
|---|---|---|
| Commission per team member, as a flat rate or tiers (Square) | A plan is a flat amount per visit, a percentage, or brackets; a plan names the stylists it pays, and a general plan pays any stylist not named on another plan for the same kind of sale | **Matches** |
| Tiers by total value sold (Square) | Brackets are found from the stylist's sales over the plan's period, this sale included, and the rate applies to this sale only (no back-pay on earlier sales) | **Matches** (row 15) |
| Tiers by volume — number of services or items (Square) | A tiered plan can count services or items sold instead of money (brackets are whole numbers), with the same period and the same no-back-pay rule | **Built** (row 15) — `tests/salon-commission-depth.test.ts` |
| Tier cadence you choose (Square) | Each week (Monday to Sunday), every two weeks (fortnights counted from Monday 1 Jan 2024), each calendar month or each quarter, on the salon's own days | **Built** (row 15) |
| A rate for each type of sale: services, products… (Prospyr: one row per item type) | One plan is paid on services, retail, prepaid packages, gift cards, memberships, or services and retail together ("all"); make one plan for each to pay different rates. A package, gift card or membership is paid to whoever sold it (a "Sold by" choice when selling it); one with nobody named earns nobody | **Built** (row 15) |
| More specific rule wins: one item, category or person (Prospyr) | A plan can be limited to chosen services or products, or to service / product categories. The most specific plan that pays a stylist for a line pays: the item, then its category, then a plan for everything; at the same level a plan naming the stylist beats one naming nobody | **Built** (row 15) |
| Commission goes to the provider on the sale (Square: attribution at the time of sale; Prospyr: the provider on the line, or the appointment) | The stylist of the visit; in a visit with several services, each stylist is paid on their own service(s). Changing an unpaid commission's person is the shared Reassign | **Matches** |
| Earned automatically, with a statement per person (Square: reports) | Earned when the visit's bill is paid in full, from the date the plan was switched on (never old sales); one line per bill per plan per stylist, however often the bill is looked at; approve, mark paid, dispute, void and a per-person statement are the shared ones | **Matches** |
| Discounts (Square: not stated generally) | A discount on the bill lowers each line in proportion; tax is never commission | **Beats** (stated, tested) |
| Refunds reverse commission (Prospyr: in proportion to the refund) | A bill refunded in part reduces an unpaid commission to the share that stayed sold (always from its original figures); a paid-out one is taken back by the share newly refunded, with a new negative line for each refund. Refunded in full: cancelled, or the rest taken back | **Built** (row 15) |
| Tips go to the attributed team member (Square) | Tips are not commission. Checkout at the chair (#7) records the tip for the visit's stylist and the Client reports › Tips by stylist report lists them; no tip is added to a commission | **Differs** |
| Import into payroll (Square Payroll; Gusto and ADP uploads) | Client reports › Commissions › Payroll file (row 16): a CSV of what each stylist is owed for the period — approved commissions by default, net of any taken back — as Gusto's CSV upload (First Name, Last Name, Email, Commission) or ADP's pay-data import (Co Code, Batch Id, File #, Batch Description, Earning 3 Code, Earning 3 Amount; the salon keeps each stylist's ADP File #). A name cannot run as a spreadsheet formula. Only whoever approves payouts (`commissions:update`) can take it, and it is recorded in the audit log. It does not mark anything paid | **Built** — `tests/salon-commission-reports.test.ts`. Gusto's page says its upload matches columns by itself and names no commission column; ADP's layout is the pay-data import layout as documented by a third party (Equusoft); **neither file has been uploaded to the real product** |
| A commission report across the salon (Boulevard "Commission summary" and "Commission line items") | Client reports › Commissions earned in this period: one line per stylist (commissions, sales, money waiting / approved / disputed / paid, total; cancelled and voided shown apart and never added) and a line-by-line list (date, bill, client, stylist, plan, kind, sales, rate, amount, status). Needs `commissions:read` and the `salon_commissions` feature | **Built** — same test |

## Decisions and limits to know

- **Off by default.** `salon_commissions` is registered not-ready (hidden). Until a salon is given it the commission routes are closed (the Commissions screen is not in the menu) and nothing is earned. The trades' Commission Tracking is untouched.
- **Retail** is read from a bill line marked `retail`. The Sell retail panel (#7, `salon_retail`) raises those lines; a salon without that feature has none, so no retail commission is earned there. Retail on a walk-in sale has no stylist, so it earns none.
- **A chair-only stylist is paid** (row 15): a team member with no login can be named on a plan, is paid for the visits and walk-in retail sales they are named on, and appears by name on the list, the statement, the line-item report and the payroll file (no email unless the team page has one). They cannot see a statement themselves, having no login.
- **Duplicate plans are refused** (row 15): a plan that would pay the same people for the same sales over the same dates as another current plan is turned down with the other plan's name. An item beside "everything", or a named person beside "nobody named", is not a duplicate.
- The shared package changes are additive and behind a flag the salon turns on: `commission_plan.sales_kind` (default `all`), the plan routes accept `salesKind` and `visit_stylist` only where `salesKinds` is passed, and the page shows the extra controls only where its config says so. No other vertical's plans change.
- Proving test: `apps/unified/tests/salon-commissions.test.ts` — fails without the change (nothing is earned).

## Row 15 — what was built, and its limits
- Built: volume tiers; tier period (week / fortnight / month / quarter); packages, gift cards and memberships; per-item and per-category plans; proportional refund reversal; chair-only stylists; duplicate plans refused. Proving test: `apps/unified/tests/salon-commission-depth.test.ts` (11) — the pure rules (period starts, the winning plan, clashes) and, through the app, every behaviour above with hand-worked figures. The 8 through-the-app tests fail without the change (run both ways); the 3 pure-rule tests live in a new file and so cannot fail without it.
- Limits:
  - **"All" still means services and retail.** Packages, gift cards and memberships are paid only by a plan that names them, so a plan for "all" never starts paying on them by surprise.
  - **Per-item overrides are for services and products.** A package or membership plan cannot be limited to one membership plan (no category exists for them).
  - **A membership is paid on every period's bill** while it was sold by someone, not on the first period only. Memberships enrolled before this change have no seller and earn nothing. Gift cards sold online, and card reloads, have no seller and earn nothing.
  - **A refund after a commission was paid out does not move the bracket** of later sales; a partial refund is shared by the sale's lines in proportion (the refund form does not say which line came back).
  - **Fortnights** are counted from Monday 1 January 2024 for every salon, so two salons' fortnights line up.
  - The Commissions screen and the Sold by choices were **not seen in a real browser**; the phone app has no commission screens.
