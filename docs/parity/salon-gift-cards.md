# Salon #10 — Gift cards

## Sources (help-centre pages actually read)

- Fresha — Manage gift cards: https://www.fresha.com/help-center/knowledge-base/memberships-packages-and-gift-cards/82-manage-gift-cards
- Square — Check gift card balances: https://squareup.com/help/us/en/article/8405

Fresha's "Sell gift cards" and "Share gift cards" pages, and Square's "Accept gift cards" page, could not be read (the first two returned only a title; the third is not reachable from this workspace). **Nothing below claims a match against how either sells, delivers or accepts a card.** Vagaro, Boulevard and GlossGenius: no help-centre page reached.

What the two pages that were read say:

- Fresha: a sold card's Details view shows the original and redeemed amounts; the expiry is a setting counted from the purchase date, and a card can be extended (logged in activity). Disabling gift cards only stops sales.
- Square: staff with the items permission check a balance by entering the card number (or scanning); customers can check their own balance on a page the seller links to; a card can be reloaded; staff can clear a remaining balance, entering the current balance to confirm.

## What they do, and where this stands

| Capability | Here | Status |
|---|---|---|
| Staff look up a card's balance by its number (Square) | Type the number any way (case, spaces, look-alike letters) on the Gift cards page or beside a sale; needs the right to take payments | **Matches** |
| Original and redeemed amounts on the card (Fresha) | Every card has its own history: sold, each spend, each refund put back, each correction, void — who and when | **Matches** |
| Clear a remaining balance, with a confirmation (Square) | An owner/admin can void a card (reason required, confirmed) — balance goes to nothing. Or correct it up/down with a reason | **Matches** |
| A card has an expiry set in settings, extendable (Fresha) | **None, by design**: no expiry and no fees (the same rule as the bar's cards). Not built | **Differs** |
| Customer checks their own balance on a page the seller links to (Square) | Staff only | **Not built** |
| Reload a card with more money (Square) | Not as a sale. An owner can add to a balance as a correction, with a reason | **Not built** |
| Sell at the desk | A paid sale (one untaxed "Gift card" line) — cash, cheque, card taken on a machine at the desk, or other — and the card is issued in the payment's own transaction. The recipient is emailed the number when the desk gives an address | Built (no vendor page read to compare) |
| Spend at checkout | A payment by "gift card" on any open sale, part or all of the balance, alongside other payments. The card is debited in the same transaction as the payment, under locks: two tills cannot spend the same dollar | Built |
| Refund | A refund by gift card goes back onto the card, no more than was paid that way; a voided card cannot take money back (refused) | Built |
| Sell to clients online / from the website | **Not built.** Needs a public purchase page and a charge on the salon's own Stripe account (the rest of the money machinery for this is in #1/#2). Left out rather than half-built | **Not built** |
| Card reader / terminal for the sale | Built with checkout at the chair (#7, salon-chair-checkout.md): a card reader on the salon's own Stripe account, and a split with a gift card. "Card" when selling a gift card still means taken on a separate machine and recorded here | **Matches** (via #7) |

## Decisions and limits to know

- **Off by default.** The feature id `salon_gift_cards` is registered not-ready (hidden), mounted at `/api/salon-gift-cards`. The bar's `gift_cards` feature and tables are untouched.
- **Who can do what (server-enforced):** selling asks `invoices:create` and `invoices:update`; spending and lookup ask `invoices:update`; listing and history ask `invoices:read`; correcting or voiding asks `payments:delete` (the refund right). **Decision for the owner:** the Front Desk seat holds none of the invoice rights today, so it cannot sell or take a gift card until the owner grants it — the usual desk job.
- **A card's number is never written on an invoice, a payment or the audit log** — only "ending 1234". It is shown to seats that may take payments, and emailed to the recipient when the desk types an address.
- **Revenue.** A card's sale is a paid invoice, and a service paid with the card is also a paid invoice, so the invoice-based totals (invoice stats, dashboards that add up paid invoices) count the money twice — when sold and when spent. Accountants treat a card as money owed, not income, until it is spent. **Decision for the owner:** this is left as is for now; the new reports (#11) will separate gift-card tender from money kept.
- A card whose own sale was later refunded cannot be spent (refused with a reason); an owner can void it.
- Stylist commission is earned when a visit is paid with a gift card, like any payment (the sale line is a service/retail line, not the card).
- Amount limits: $5 to $1,000 a card.
- Shared packages, additive only: `InvoiceOptions.refundTender` (a refund by that method runs a doer inside the refund transaction; absent = unchanged) and an optional `reload` callback passed to the invoice page's side panel.
- Proving test: `apps/unified/tests/salon-gift-cards.test.ts` (7) — closed until the feature; seat rights; sell (paid sale, card, email, code not on the sale); spend (partial, remainder, masked reference, refusals); two tills at once; refund back onto the card (and not more than was paid that way, not onto a voided card); adjust/void with history and no code in the audit log; a refunded sale's card can't be spent. It fails without the change (no routes, no tables).
- Screens (Gift cards page, "Pay with a gift card" beside a sale) are type-checked and built but **not click-tested in a browser**.
