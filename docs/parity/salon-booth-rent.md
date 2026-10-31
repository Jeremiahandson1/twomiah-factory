# Salon row 24 — Booth-rent collection

## Sources (help pages actually read)

- Vagaro press release, "Vagaro adds new feature making rent and fees payments easy": https://www.vagaro.com/news/press-release/vagaro-adds-new-feature-making-rent-and-fees-payments-easy (recurring rent on a chosen date, an amount per renter, ACH or credit card with a primary and a backup, commission on product sales taken out of rent)
- Vagaro, "Detangling rent and fees collection": https://www.vagaro.com/en-au/learn/detangling-rent-fees-collection (weekly or monthly deductions, withdrawn once the renter adds their payment details, reports of when and how each payment was made, a digital renter's agreement, a backup card)

I could not read a GlossGenius help page on booth rent (searches returned nothing from GlossGenius itself), so **nothing below claims a match against GlossGenius.**

## What was built (hidden feature `booth_rent`, off for every salon until the owner turns it on)

| Capability asked for in the brief | Here | Status |
|---|---|---|
| Renters (a chair renter on the Team) | A renter is a Team member (an existing one, or a new one made with the role "Chair renter"). The renter is billed through a contact of type "other", so they never appear among the salon's clients, in retention messages or in client reports | **Built** |
| A rent schedule, weekly or monthly, an amount | Rent per period; weekly on a chosen weekday, monthly on a chosen day (a short month is billed on its last day: the 31st → Nov 30 → Dec 31); a start day; notes. A rent change applies to rent not yet invoiced; a moved day starts after the last period billed so nothing is billed twice or silently skipped | **Built** |
| Invoices raised on schedule | One invoice on each due day (line type `booth_rent`, no tax, due that day), claimed per renter per period so any number of runs, a double click or a restart gives one invoice. Runs every 6 hours, when the list is opened, and from "Run billing". A paused renter is still invoiced (they still have the chair). A renter who pays by hand is emailed that rent is due | **Built** |
| Autopay from the renter's card on the salon's own Stripe | Needs the renter's agreement (ticked by a person, or ticked by the renter on their own page), Card on file on, and a card on the salon's connected account. One charge per invoice per try, claimed before Stripe is asked, the same Stripe key on a resumed try, a backup card tried when the main one is declined | **Built** |
| The same retry/decline handling as memberships | The salon's own tries and wait (Memberships › When a card is declined — one setting for both); staff who can see payments emailed on every decline; the renter emailed each time; after the last try autopay is **paused**, the renter is emailed a private link to give a new card, the salon is told; Retry now; Resume (charges every unpaid rent, oldest first); a new card given on the renter's page resumes by itself | **Built** |
| A renter ledger | Every rent charge, waiver and payment in order with a running balance (what the renter owes); matches the owing on the renter's row | **Built** |
| A statement | For any days: owed at the start, every line, owed at the end; on screen, printed, as a spreadsheet file, and emailed to the renter | **Built** |
| Waiving rent | A future rent day or an unpaid invoice (voided); never one that has been paid, in whole or part; a reason is required and shown on the ledger | **Built** (beyond the brief) |

## Where it is

- Screen: **Booth rent** in the salon menu (`/crm/booth-rent`), for seats that read invoices; changes need what invoices need (`invoices:create` / `invoices:update`), so a stylist's seat sees no colleague's rent.
- Server: `server/crm/salon/boothRent.ts` (billing, charging), `boothRentRoutes.ts` (`/api/booth-rent`, and the renter's page `/api/renter-card/:token`), `boothRentRules.ts` (the pure rules). Tables `booth_renter`, `booth_rent_period`, `booth_rent_charge` (migration 0068). Emails: `boothRentInvoice`, `boothRentCharged`, `boothRentPaymentFailed`, `boothRentPaused`, `boothRentPausedSalon`, `boothRentDeclinedStaff`, `boothRentCardLink`, `boothRentStatement`.
- Rent invoices get no sale receipt and no tip link (they are not a sale to a client).

## Limits (stated, not hidden)

- **Card only.** Vagaro offers a bank account (ACH) as the primary method with a card as backup; this takes cards. A bank-account debit needs the salon's own Stripe account to be enabled for it, so it is not built.
- **Vagaro also takes commission on a renter's product sales out of the rent, and generates a digital renter's agreement.** Neither is built. Both are recorded for row 28.
- A renter ends **today** only (no future end date, no notice period). What is due up to today is invoiced first; unpaid invoices stay open; adding them again keeps the history.
- No late fee of its own: rent invoices use the salon's ordinary invoice reminders and late fees, which already apply to every invoice.
- A refund of rent is not shown as a line on the ledger (an invoice keeps the gross paid, so a refund does not reopen a balance).
- Rent carries no tax. Whether rent is taxable is the salon's decision with its accountant.
- A paused renter is still invoiced; autopay resumes only with a card that works or by hand.
- **No renter screen on the phone**; the page is on the web only. **Not seen in a real browser**, and **no real Stripe was charged**: the tests use a fake Stripe.
- Rent is billed by the salon's calendar day; a renter changed to a different timezone is not a case this handles.

## Tests

- `tests/salon-booth-rent-rules.test.ts` (9, pure rules: due days, month ends, the form, ledger, statement, the spreadsheet file).
- `tests/salon-booth-rent.test.ts` (13, through the real server and logins with a fake Stripe). Run both ways: with the mount and services reverted all 13 fail; with only the receipt exclusion reverted the invoicing test fails.
