# Roofing parity — a Good / Better / Best proposal the homeowner chooses (gap 3)

Leaders: Roofr proposals, Leap's in-home sales tools. Read from their own pages on 2026-10-30; where a page said nothing about a
point it is marked "not stated", never assumed. Roofr's multi-option page and two help articles were read in full. For Leap, the
searches found no help-centre article on its price guide or good/better/best; the pages read are Leap's own product and blog
pages, which say little about options, so Leap rows below are only what those pages state.

Sources
- Roofr: [Multi-Option Proposals](https://roofr.com/masterclass/multi-option-proposals), [How to customize your Roofr proposal](https://intercom.help/roofr-a34d9a26ccc1/en/articles/15589052-how-to-customize-your-roofr-proposal), [Sending and Signing Proposals](https://academy.roofr.com/lesson-videos/sending-proposals)
- Leap: [Good-better-best pricing](https://leaptodigital.com/good-better-best-pricing/), [Inspect and sell](https://leaptodigital.com/solutions/inspect-and-sell), [How to present good-better-best pricing](https://leaptodigital.com/2022/11/18/how-to-present-good-better-best-pricing)

## What already existed (read in the code, not assumed)
There are NO "option groups" in the shared code (the lead's grep terms found nothing). What exists is **optional lines**
(`packages/tenant-backend/src/invoicing/quoteOptions.ts`, migration 0034): a line marked optional is ticked by the office or the
customer, the total counts only ticked lines, and only ticked lines reach the job, the invoice and the billing. They are
independent tick boxes, not "pick one", and they have no photos, brand or warranty. Pricebook items have Good / Better / Best tiers
(`pricebook_good_better_best`), shown on a tablet page (`pricebookPresent.ts`), but "Build Your Quote" puts ONE tier on the quote as
one line. The roof job list already says "options on one job are not added together: the newest stands" — the old workaround was a
separate quote per option.

So this is built **on** optional lines, additively (nothing forked): an option's lines are optional lines that are ticked together
when the option is chosen. Totals, job, invoice, deposit, progress billing and the customer's signature therefore follow the chosen
option with no change of their own.

## The list, each marked

| # | What the leaders do | Twomiah (roofing) | Mark |
|---|---|---|---|
| 1 | Several priced options in one proposal; the page shows no maximum (Roofr: four shown) | Two to six options on one quote; each is the whole job (the lines every option shares, plus its own) | **Matches** (cap of six) |
| 2 | Each option has a name, a description and its materials by line (Roofr) | Name, a level (Good / Better / Best), a description and its own lines | **Matches** |
| 3 | A price for each option; the summary updates as the homeowner clicks (Roofr) | Each option shows the whole job's price (tax and discount as the quote has them); choosing one makes the quote's total that price | **Matches** |
| 4 | Photos in the proposal (Roofr: photos, markup from a phone or CompanyCam) | Up to six photos per option, picked from the job's own photos or pasted as web addresses; the homeowner sees them on the option | **Matches** on photos; **not doing** markup / annotation |
| 5 | Brand: product names customised, manufacturer brochures attached (Roofr) | A brand line per option (e.g. GAF Timberline HDZ). Brochure attachments are not built | **Matches** on brand; **not doing** brochures |
| 6 | Warranty — Roofr's articles show it only as an upgrade type; Leap's pages do not state it | A warranty line on each option, shown to the homeowner | **Beats** (on what the pages state) |
| 7 | The homeowner picks an option on the proposal and the price changes (Roofr multi-option page; its help article does not say how) | On the quote's own `/d/<token>` page (no sign-in) or in the portal: "Choose this option"; the total follows; Sign is held until one is chosen | **Matches** |
| 8 | Signing: type or draw, saved signed document (Roofr); Leap signs on an iPad, remote or in person | The existing e-signature (drawn, consent, fingerprint, audit row) — now naming the chosen option in the audit entry and the fingerprint; works on a tablet browser (not tested on a device) | **Matches** |
| 9 | After the homeowner signs the options cannot change (Roofr, on insurance quotes) | A signed proposal refuses another pick or an edit of its options, from the homeowner and the office | **Matches** |
| 10 | The chosen package's price flows into the contract (Leap states "price from each package populated into the contract"; whether it reaches the job is not stated) | The chosen option is the quote's total, the roof job's value (`estimated_value` and the job list's quoted figure), the invoice, the deposit and progress billing. An option nobody chose is on none of them | **Beats** (on what the pages state) |
| 11 | Options from the catalogue (Roofr catalogue items; Leap packages) | "Build options" turns a pricebook item's Good / Better / Best tiers into the options in one step | **Matches** |
| 12 | The office can build it live in the house or on the phone (Roofr) | The office edits options on the quote; "Choose for the customer" records a yes given by phone, then Mark approved | **Matches** |
| 13 | Upgrades (add-ons) inside an option; the customer chooses the option first (Roofr) | The quote's optional lines still exist, but they belong to the quote, not to one option, and the customer is not made to choose an option first | **Not doing** — parity needs optional lines that belong to an option |
| 14 | A discount per option (Roofr, one per option) | One discount on the quote, applied to every option | **Not doing** |
| 15 | Initials on terms; in-line sections; a cosigner for the insurance carrier (Roofr) | Not built | **Not doing** |
| 16 | Cover page, About Us, attached PDFs, option order flipped (Roofr) | Options show in the order the office sets; no cover page or About Us | **Not doing** |
| 17 | Financing shown beside the quote (Roofr, Leap) | Consumer Financing is a separate, not-ready feature | **Not doing** (owner's) |
| 18 | An expiry date; the link then says the proposal expired (Roofr) | The quote's existing valid-until date: an expired quote cannot be chosen from or signed | **Matches** (existing) |
| 19 | Send by email or text; reminders; "viewed" time stamp (Roofr) | The existing Send. The email now lists the options, each at its whole price, with the total "from" the lowest. Reminders and view tracking were not checked here | **Matches** (existing) |

## What this change builds
- `quote_proposal_option` table and `quote_line_item.proposal_option_id` (migration `0045_quote_proposal_options`).
- Rules in `packages/tenant-backend/src/invoicing/quoteOptions.ts` (`proposalView`, `chooseProposalOption`, `proposalNeedsChoice`); routes in `quotes.ts` (`PUT /api/quotes/:id/proposal`, `POST /:id/proposal/choose`, `POST /:id/proposal/from-pricebook`; approve is refused until an option is chosen; editing the shared lines keeps the options) and `portal.ts` (`POST /d/:token/quotes/:id/choose-option` and the `/p/` twin, the options in the customer's quote, signing refused before a pick).
- The roof job's value follows the chosen option (`apps/unified/server/crm/roof/proposalValue.ts`, called when a quote is approved).
- Screens: the options on the customer's quote page (`packages/tenant-ui/src/portal/PortalQuotes.tsx`, the page both the portal and `/d/<token>` show) and the office panel and editor beside a quote (`apps/unified/web/src/crm/proposalOptions.tsx`).
- Feature `quote_proposals` ("Proposal Options"), registered **not ready** and offered to `crm-roof`; the server refuses building options without it.

## Still needed for full parity (not in this change)
Rows 13 (upgrades inside an option), 14 (a discount per option), 15, 16 (brochures and cover page), the photo markup in row 4.
Row 17 is the owner's. Also not done: a photo upload from the options editor itself (photos come from the job's photos or an
address), and the quote's PDF, which shows only the chosen option once one is chosen and the shared lines before.

## One switch, both sides (owner follow-up 10/30)
With `quote_proposals` off, a quote behaves exactly as it did before options existed: the homeowner's page and `/d/<token>` link show no options, the pick is refused (404, like a path that is not there), the quote email lists the quote's own lines, signing asks for no pick, and the office cannot pick for the customer. A quote whose option was already chosen keeps that option's lines on the page (they are in its total). Building options still needs the switch. The office and the customer sides ask one rule (`proposalsLive` in `quoteOptions.ts`). Tested off and on in `tests/roof-gbb-proposals.test.ts` (last section).
