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
| Tiers by total value sold (Square) | Brackets are found from the stylist's sales this calendar month, this sale included, and the rate applies to this sale only (no back-pay on earlier sales) | **Matches in part**: monthly only |
| Tiers by volume — number of services or items (Square) | — | **Not built** |
| Tier cadence you choose (Square) | Month only | **Not built** |
| A rate for each type of sale: services, products… (Prospyr: one row per item type) | One plan is paid on services, retail, or both; make one plan for each to pay different rates | **Matches** for services and retail; **not built** for packages, gift cards and memberships |
| More specific rule wins: one item, category or person (Prospyr) | A person named on a plan beats the general plan | **Matches in part**: no per-item or per-category overrides |
| Commission goes to the provider on the sale (Square: attribution at the time of sale; Prospyr: the provider on the line, or the appointment) | The stylist of the visit; in a visit with several services, each stylist is paid on their own service(s). Changing an unpaid commission's person is the shared Reassign | **Matches** |
| Earned automatically, with a statement per person (Square: reports) | Earned when the visit's bill is paid in full, from the date the plan was switched on (never old sales); one line per bill per plan per stylist, however often the bill is looked at; approve, mark paid, dispute, void and a per-person statement are the shared ones | **Matches** |
| Discounts (Square: not stated generally) | A discount on the bill lowers each line in proportion; tax is never commission | **Beats** (stated, tested) |
| Refunds reverse commission (Prospyr: in proportion to the refund) | A bill refunded in full cancels an unpaid commission and takes back a paid-out one with a new negative line; a partial refund leaves it standing | **Matches in part**: no proportional reversal |
| Tips go to the attributed team member (Square) | Tips are not commission. Checkout at the chair (#7) records the tip for the visit's stylist and the Client reports › Tips by stylist report lists them; no tip is added to a commission | **Differs** |
| Import into payroll (Square Payroll) | — | **Not doing** (the salon exports a statement; no payroll product here) |
| A commission report across the salon | Per-person statements and totals by person exist (Commissions). Client reports (#11) does not add a salon-wide commission report; it links here | **Not built** |

## Decisions and limits to know

- **Off by default.** `salon_commissions` is registered not-ready (hidden). Until a salon is given it the commission routes are closed (the Commissions screen is not in the menu) and nothing is earned. The trades' Commission Tracking is untouched.
- **Retail** is read from a bill line marked `retail`. Nothing in the salon raises those lines yet — checkout at the chair (#7) will. Until then retail commission is only proven by the test adding a line.
- **A stylist needs a login** to be paid through the CRM. A chair-only stylist on the Team page (no login) earns nothing; give them a login.
- Two plans naming the same stylist for the same kind of sale would both pay them. The screen does not stop it; name a stylist once per kind.
- The shared package changes are additive and behind a flag the salon turns on: `commission_plan.sales_kind` (default `all`), the plan routes accept `salesKind` and `visit_stylist` only where `salesKinds` is passed, and the page shows the extra controls only where its config says so. No other vertical's plans change.
- Proving test: `apps/unified/tests/salon-commissions.test.ts` — fails without the change (nothing is earned).
