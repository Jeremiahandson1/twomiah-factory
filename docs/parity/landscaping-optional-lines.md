# Landscaping parity — gap 8: optional lines on quotes

Branch `cloud/landscaping-depth`. Researched 2026-10-30 from Jobber's help ([optional line items](https://help.getjobber.com/es/articles/optional-line-items-on-quotes/),
[quoting on Grow](https://help.getjobber.com/en/articles/quoting-on-the-grow-plan/), [Quote Options beta](https://help.getjobber.com/hc/en-us/articles/33970469537047-Quotes-Options-Beta)).

**Finding: the shared quote form already has optional lines for landscaping — `quoteOptions: true` is on for every vertical
(web/src/crm/screens.tsx), and the server side is the same module. Nothing was turned on. Nothing here was changed except one
test that proves it on a landscaping tenant.**

| # | Jobber capability | Ours |
|---|---|---|
| 1 | "Mark as optional" on any line; any number | **matches** |
| 2 | Pre-select an optional line; the client can untick | **matches** ("Included" box on an optional line) |
| 3 | Required items plus add-ons, or only optional items (packages) | **partly**: add-ons yes; a quote of only optional lines is refused ("Add at least one line that is not optional") — tiered packages need Quote Options, below |
| 4 | Client ticks/unticks on the quote's link; the total follows | **matches** (portal link; proven on landscaping) |
| 5 | Selected = counted; unselected = excluded from the total | **matches** |
| 6 | Percentage deposit recalculates from the selected lines | **matches** (deposit is worked out on approval from the included total — `quote-billing.test.ts`) |
| 7 | After approval, the selected options fix; convert to job carries only the selected | **matches** (job and invoice carry only included lines; proven on landscaping) |
| 8 | PDF shows selected and unselected options, labelled | **matches** (10/31 parity round, row 5; owner's yes 10/31). Both quote PDFs — the office's and the one on the customer's link — print the unticked optional lines apart under "Optional — not included", each with its quantity and price and marked *Not included*, never in a total; a ticked one prints with the bought lines. Live for every quoting trade (not behind a switch). Test: `quote-not-included-preview.test.ts`. |
| 9 | Preview as client | **matches** (10/31 parity round, row 6; feature `quote_preview`, hidden): the quote's **Preview as client** button opens, in a new tab, the customer's own page for the quote — options, ticks, deposit, the sign button, the PDF — read only, with a Preview banner. Nothing is sent, the customer's link is not minted, a draft stays a draft and a sent quote is not marked viewed. The link is signed, names one quote and lasts 30 minutes; its server door has no write routes at all. Test: `quote-not-included-preview.test.ts`. |
| 10 | Line images; "Add text" lines | **NOT BUILT** (Grow-plan features). |
| 11 | Quote Options (beta): up to 3 option sets, pick one per set | **NOT BUILT** — a different mechanism (exclusive choice) from tick-boxes. |

## Proof

`apps/unified/tests/landscaping-optional-lines.test.ts` boots a landscaping tenant: a lawn-care quote with two add-ons; the
office ticks one, the customer unticks it on the link, approves; only the ticked add-on reaches the invoice; a mowing line
cannot be unticked; a field seat cannot tick for the customer. It passes without any change because none was needed — the
existing proof (`quote-billing.test.ts`) boots the contractor vertical.

Also added in gap 4: "Add to quote" on Area Pricing can add a priced service **as an option** (the "upsell" use).
