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
| 4 | Photos in the proposal (Roofr: photos, markup from a phone or CompanyCam) | Up to six photos per option, picked from the job's own photos or pasted as web addresses; the homeowner sees them on the option. 10/31 (row 8): a photo can be drawn on (arrows, circles, text) on the web and the phone; the marked copy is a photo of its own beside the original, and is picked here like any job photo (marked ones are labelled) | **Matches** (drawing: tested through the server and as plain phone functions; not seen in a browser or on a phone) |
| 5 | Brand: product names customised, manufacturer brochures attached (Roofr) | A brand line per option (e.g. GAF Timberline HDZ). 10/31 (row 7): files attached to an option (a manufacturer's brochure, uploaded from the editor), linked on the option for the homeowner and, for a PDF, its pages follow the proposal in the quote PDF | **Matches** |
| 6 | Warranty — Roofr's articles show it only as an upgrade type; Leap's pages do not state it | A warranty line on each option, shown to the homeowner | **Beats** (on what the pages state) |
| 7 | The homeowner picks an option on the proposal and the price changes (Roofr multi-option page; its help article does not say how) | On the quote's own `/d/<token>` page (no sign-in) or in the portal: "Choose this option"; the total follows; Sign is held until one is chosen | **Matches** |
| 8 | Signing: type or draw, saved signed document (Roofr); Leap signs on an iPad, remote or in person | The existing e-signature (drawn, consent, fingerprint, audit row) — now naming the chosen option in the audit entry and the fingerprint; works on a tablet browser (not tested on a device) | **Matches** |
| 9 | After the homeowner signs the options cannot change (Roofr, on insurance quotes) | A signed proposal refuses another pick or an edit of its options, from the homeowner and the office | **Matches** |
| 10 | The chosen package's price flows into the contract (Leap states "price from each package populated into the contract"; whether it reaches the job is not stated) | The chosen option is the quote's total, the roof job's value (`estimated_value` and the job list's quoted figure), the invoice, the deposit and progress billing. An option nobody chose is on none of them | **Beats** (on what the pages state) |
| 11 | Options from the catalogue (Roofr catalogue items; Leap packages) | "Build options" turns a pricebook item's Good / Better / Best tiers into the options in one step | **Matches** |
| 12 | The office can build it live in the house or on the phone (Roofr) | The office edits options on the quote; "Choose for the customer" records a yes given by phone, then Mark approved | **Matches** |
| 13 | Upgrades (add-ons) inside an option; the customer chooses the option first (Roofr) | Upgrades (`quote_line_item.option_role = 'upgrade'`) belong to one option: not ticked by choosing it, offered after it is chosen (`/choose-upgrade`, the office's `/proposal/upgrade`), cleared when another option is chosen, refused for an option not chosen or once signed. The quote's plain optional lines still belong to the quote | **Matches** 10/31 (row 6): an option carries upgrades; the customer chooses the option first, then ticks its upgrades |
| 14 | A discount per option (Roofr, one per option) | One discount on the quote (the office's), plus ONE discount per option (a dollar amount or a percent of the option before its upgrades) taken off while that option is chosen; the two together are the quote's discount | **Matches** 10/31 (row 6) |
| 15 | Initials on terms; in-line sections; a cosigner for the insurance carrier (Roofr) | 10/31 (row 7): the terms are split into clauses the customer INITIALS before they can sign (refused with the terms named; each initial a record); sections of the roofer's own words placed in line (top, before the options, after, before the terms); a COSIGNER (the carrier, a spouse) is emailed their own link when the customer signs, and the quote is approved only when the cosigner has signed too | **Matches** |
| 16 | Cover page, About Us, attached PDFs, option order flipped (Roofr) | 10/31 (row 7): a cover page (title, subtitle, photo) and About Us, printed first in the PDF and shown at the top of the page; files for the whole proposal (PDF pages appended to the quote PDF); the options' order flipped with up/down on the editor and `PUT /:id/proposal/order` (the customer's choice stays) | **Matches** |
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
Row 17 is the owner's. Built 10/31: the photo markup in row 4 (row 8 of the brief; see "Drawing on photos" below). Built 10/31: a photo upload from the options editor itself (row 7).

## One switch, both sides (owner follow-up 10/30)
With `quote_proposals` off, a quote behaves exactly as it did before options existed: the homeowner's page and `/d/<token>` link show no options, the pick is refused (404, like a path that is not there), the quote email lists the quote's own lines, signing asks for no pick, and the office cannot pick for the customer. A quote whose option was already chosen keeps that option's lines on the page (they are in its total). Building options still needs the switch. The office and the customer sides ask one rule (`proposalsLive` in `quoteOptions.ts`). Tested off and on in `tests/roof-gbb-proposals.test.ts` (last section).

## Upgrades and a discount per option (row 6, 10/31)
- Migration `0061_proposal_upgrades_discount`: `quote_line_item.option_role`, `quote_proposal_option.discount_cents` / `discount_percent`, `quote.option_discount` (no new table).
- `quote.discount` stays the whole discount taken off (so the invoice, the page, the PDF and the signature fingerprint agree with the total); `quote.option_discount` is the part that is the chosen option's, and the office reads `discount` as the one it typed, with `optionDiscount` and `discountTotal` beside it (`withProposal`).
- A percent discount is a percent of the option's price before its upgrades (the shared lines plus the option's own); upgrades are full price. It is worked out again whenever the shared lines change.
- Tested in `tests/roof-gbb-upgrades.test.ts` (upgrades, discount, rules, the invoice, the PDF, the office route, feature off, a plain quote unchanged).

## Proposal pages: initials, sections, cosigner, cover, About Us, files, order (row 7, 10/31)
- Migration `0062_proposal_document`: `quote_proposal_document` (one row per quote: cover, About Us, sections, terms clauses, proposal files, cosigner and the cosigner's private token), `quote_proposal_mark` (each initial, the customer's signature while the cosigner is still to sign, the cosigner's signature), `quote_proposal_option.attachments`. Table count 464 -> 466.
- Rules and PDF extras in `packages/tenant-backend/src/invoicing/quoteDocument.ts`; office routes `PUT /api/quotes/:id/proposal/document`, `POST .../proposal/file` (a picture or PDF, kind read from its bytes, 10 MB), `PUT .../proposal/order`, `POST .../proposal/cosigner/send`; the homeowner's `POST /d/:token/quotes/:id/approve` takes `initials`; the cosigner's `GET/POST /api/portal/c/:token` (`/pdf`, `/sign`) with the page `/c/<token>` (`PortalCosign.tsx`). One switch: `quote_proposals`.
- The customer signs first. With a cosigner the quote is NOT approved at that point (no approval, no deposit, no job value): the customer's signature is kept as a record, the cosigner is emailed, nothing can be changed, and the cosigner's signature finishes the approval. If the office changes the quote after the customer signed, the cosigner is refused (409) until the customer signs again. The office's own "Mark approved" (a yes on the phone, a paper copy) is not held for initials or a cosigner.
- Tested in `tests/roof-proposal-document.test.ts`.

## Drawing on photos (row 8, 10/31; also roof-inspection-report.md #13)
- Migration `0063_photo_markup`: `job_photo.source_photo_id` and `job_photo.markup` (no new table; table count stays 466). One original has at most one marked copy (unique index).
- A drawing is a list of shapes (arrow, circle, text; five named colours; up to 40) in fractions of the picture, so the web, the phone and the server place them alike. `PUT /api/photo-markup/:photoId` (feature `photo_markup`, hidden; `jobs:update`; a seat reaches only its own jobs' photos) lays them on the picture with sharp and keeps the result as a photo of its own beside the original (same type, caption, time and place), which is never changed. Saving again redraws the same copy; saving no shapes removes it; deleting a photo takes its copy with it.
- Web: Photos > Captions, drawing and details > Draw on this photo (`PhotoMarkupEditor.tsx`). Phone: the photo viewer's Draw button (`apps/mobile/src/photos/PhotoMarkup.tsx`), saved through the offline queue, so it is kept on the phone and sent when there is signal.
- Using the copy: it is in the job's photos, so a proposal option picks it (labelled Marked) and an inspection report built from the job takes it in place of the plain photo (which stays on the job and can be put back).
- Tested in `tests/roof-photo-markup.test.ts` and `tests/mobile/photo-markup.test.ts`.
- Not verified: drawing in a real browser or on a real phone (touch drawing is built from plain Views, so no native library or new phone build is needed). The marked copy's lettering needs a font on the server (the image the app runs in).
- Limits: the phone can mark only a photo already on the server (a photo is uploaded as it is taken; photos are not yet queued offline); the drawing tools have no keyboard-only way to place an arrow or circle.
