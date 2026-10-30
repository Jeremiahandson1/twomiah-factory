# Parity: good / better / best on a sent quote, the customer picks one and signs, the deposit follows (field service and basic)

Branch `cloud/fieldservice-depth`, item 5. Feature id `quote_options` (NOT READY, `hidden` in `featureRegistry.ts`; templates
`crm-fieldservice`, `crm-basic`). Server: `packages/tenant-backend/src/invoicing/quoteOptions.ts` (the rules),
`quotes.ts` (office: write the options, `POST /api/quotes/:id/choose-option`, approve refused until chosen) and `portal/portal.ts`
(`POST /api/portal/(p|d)/…/quotes/:id/choose-option`, approve refused until chosen). Column: `quote_line_item.option_group`
(migration 0044). Screens: shared `LineItemsEditor` ("Option" box per line), `QuoteDetailPage` ("Options for the customer"),
`PortalQuotes` (option cards, Choose, Sign & Approve). Test: `tests/quote-options.test.ts` (both verticals).

**How it works.** A quote line may carry an option name (Good, Better, Best — any word). Lines with no name are shared by every
option. Lines with the same name are one option (a furnace and its warranty). Two to five options. On a quote that has been
sent, the customer opens their link, sees each option's full price (tax in) and its deposit, picks one, and signs. Picking turns
that option's lines on and the others off and the total is worked out again; the signed fingerprint covers the picked option's
lines and total. The deposit (percent or fixed) is worked out on the picked option's total. The invoice and the job made from the
quote carry only the picked option. The office can pick for a customer who says it by phone (`quotes:update`). Neither the
customer nor the office can approve before a pick is made; after approval the pick is fixed.

**Leaders reviewed (read 2026-10-30, their own help pages):**
Housecall Pro — [Sales proposal tool](https://help.housecallpro.com/en/articles/7216553-sales-proposal-tool).
Jobber — [Quotes Options (beta)](https://help.getjobber.com/hc/en-us/articles/33970469537047-Quotes-Options-Beta).
ServiceTitan — [Estimates and proposals in ServiceTitan Max](https://help.servicetitan.com/docs/estimates-and-proposals-in-servicetitan-max).

| # | Leader (from its page) | Ours | Mark |
|---|---|---|---|
| 1 | All three: options shown side by side (HCP "side-by-side comparison", Jobber "side by side with descriptions, prices and photos", ServiceTitan tiers) | Option cards side by side on the customer's link, each with price (tax in) and deposit | matches (no photos or descriptions per option) |
| 2 | Jobber: client picks one option per set; only the chosen one carries into job and invoice, the others stay on the quote. ServiceTitan: customer picks one | One pick; invoice and job carry only it; the other options stay on the quote record | matches |
| 3 | ServiceTitan: the customer signs a Customer Authorization after choosing | The customer signs for the option they picked: typed name, drawn signature, agreement; time, address, browser and fingerprint of what they saw | matches (beats: the signing evidence) |
| 4 | Deposits: none of the three pages says how a deposit relates to the chosen option (HCP, Jobber, ServiceTitan pages are silent) | The deposit follows the picked option; a fixed deposit must fit the cheapest option | no claim of parity either way — what the brief asks for; leaders' pages say nothing |
| 5 | Jobber: 2–5 choices per set, up to 3 sets per quote | 2–5 options, one set | partly — one set only |
| 6 | HCP: the customer can be allowed to approve more than one option. ServiceTitan "additive" type: options independent, any combination | One option only | not doing — a customer who wants two uses Optional lines (already built) |
| 7 | ServiceTitan: the tech marks an option Recommended | Not built | not doing |
| 8 | ServiceTitan and HCP: the tech presents it on site, on the phone | The customer link opens on any phone, so a tech can hand it over; **the phone app has no option picker** — its quote screen lists the lines and total only; its quote form creates quotes without options | gap — stated: parity needs a phone "Options" view that calls the same `choose-option` route |
| 9 | Jobber: options only on the web, not the app; quote PDF shows only the selected option | The portal hides Download PDF until an option is picked; the office PDF prints the lines currently ticked, so **before a pick it prints the shared lines only** | partly — office PDF before a pick is not an options sheet |
| 10 | Jobber: Lab / beta | Registered NOT READY, off for every business until the owner decides | — |

**Parity verdict:** side-by-side options, one pick, signature, only the pick carries forward: matches. Rows 5, 6, 7, 8 and 9
are what a full match would still need. Item 5 as the brief words it (good/better/best on a sent quote, pick in portal with
signature, deposit follows) is built and proven; leaving it hidden is the owner's call.

**Decisions for the owner:** (1) A fixed deposit larger than the cheapest option is refused when the quote is saved. (2) Option
names are free words; "Good, Better, Best" are only suggestions in the box. (3) Turning `quote_options` off later does not
hide options already on a sent quote (the customer can still pick); it stops new option quotes and the office pick.
