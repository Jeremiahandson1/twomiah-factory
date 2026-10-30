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
| 8 | PDF shows selected and unselected options, labelled | **NOT BUILT, deliberately.** Our PDF lists only the included lines. Showing unticked ones as "Not included" changes a document live customers receive, so it is the owner's call. Parity needs: pass all lines to `generateQuotePDF` (tenant-backend `quotes.ts` `/:id/pdf`) and label optional ones in `server/crm/pdf.ts`. Tried in this branch, reverted. |
| 9 | Preview as client | **NOT BUILT.** The quote's own link is the preview today (send it to yourself). |
| 10 | Line images; "Add text" lines | **NOT BUILT** (Grow-plan features). |
| 11 | Quote Options (beta): up to 3 option sets, pick one per set | **NOT BUILT** — a different mechanism (exclusive choice) from tick-boxes. |

## Proof

`apps/unified/tests/landscaping-optional-lines.test.ts` boots a landscaping tenant: a lawn-care quote with two add-ons; the
office ticks one, the customer unticks it on the link, approves; only the ticked add-on reaches the invoice; a mowing line
cannot be unticked; a field seat cannot tick for the customer. It passes without any change because none was needed — the
existing proof (`quote-billing.test.ts`) boots the contractor vertical.

Also added in gap 4: "Add to quote" on Area Pricing can add a priced service **as an option** (the "upsell" use).
