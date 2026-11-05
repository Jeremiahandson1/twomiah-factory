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
| A card has an expiry set in settings, extendable (Fresha) | **Owner decision 10/31: the paid value never expires, so there is no expiry setting for it.** Only a free promotional bonus ("pay $100, get $20") may have a last day (days from the sale, per offer), printed on the card page, the balance page and the email. After that day the bonus comes off by a logged line and the paid part stays spendable. An owner/admin can extend a live bonus's last day with a reason (logged). Fresha's whole-card expiry is deliberately not built | **Differs by decision** (bonus expiry and extension built) |
| Customer checks their own balance on a page the seller links to (Square) | Public page `/api/gift-balance` (and a JSON check): enter the number, see what can be spent, the paid part and the free bonus with its last day; nothing about the buyer; unknown numbers get one answer; ten tries an address then it stops | Built (Square's page itself not read) |
| Reload a card with more money (Square) | A reload is a paid sale of its own (cash, card, cheque or other), listed on the card's history, kept out of revenue like the first sale. Needs the selling right | Built |
| Sell at the desk | A paid sale (one untaxed "Gift card" line) — cash, cheque, card taken on a machine at the desk, or other — and the card is issued in the payment's own transaction. The recipient is emailed the number when the desk gives an address | Built (no vendor page read to compare) |
| Spend at checkout | A payment by "gift card" on any open sale, part or all of the balance, alongside other payments. The card is debited in the same transaction as the payment, under locks: two tills cannot spend the same dollar | Built |
| Refund | A refund by gift card goes back onto the card, no more than was paid that way; a voided card cannot take money back (refused) | Built |
| Sell to clients online / from the website | Public page `/api/gift-shop` (the owner switches it on): amounts or the salon's offers, who it is for, a day to send it, paid on Stripe's own page on the salon's connected account. The card holds nothing until Stripe's event (or the buyer's return) confirms the payment, once; the recipient and the buyer are emailed; unpaid pending cards are cleared after 3 days | Built (no real Stripe account; fake of Stripe's documented behaviour) |
| Send on a chosen day | A date on the desk sale or online page; the card is emailed once on that day by the timed pass | Built |
| Sell on a card reader | "Sell on the card reader" starts a pending card on an open sale the chair-checkout reader then charges; live when the reader takes payment | Built (simulated reader only) |
| Card reader / terminal for the sale | Built with checkout at the chair (#7, salon-chair-checkout.md): a card reader on the salon's own Stripe account, and a split with a gift card. "Card" when selling a gift card still means taken on a separate machine and recorded here | **Matches** (via #7) |

## Decisions and limits to know

- **Off by default.** The feature id `salon_gift_cards` is registered not-ready (hidden), mounted at `/api/salon-gift-cards`. The bar's `gift_cards` feature and tables are untouched.
- **Who can do what (server-enforced):** selling asks `invoices:create` and `invoices:update`; spending and lookup ask `invoices:update`; listing and history ask `invoices:read`; correcting or voiding asks `payments:delete` (the refund right). **The Front Desk seat (owner's decision, follow-up 10/30)** holds a narrow right of its own, `giftcards:sell`, which opens selling, lookup and taking a card as payment — and nothing else: it still cannot edit a sale, record a payment by hand, refund, void, or correct a card. A stylist holds none of it. Proof: `apps/unified/tests/salon-front-desk-till.test.ts`.
- **A card's number is never written on an invoice, a payment or the audit log** — only "ending 1234". It is shown to seats that may take payments, and emailed to the recipient when the desk types an address.
- **Revenue — counted once (owner's decision, follow-up 10/30).** Selling a card is a liability (money owed to the holder), not income; the income is counted when the card is **spent**, as a payment by gift card on the service or product it paid for. ONE definition — "the invoice that sold a gift card is not revenue" (`notGiftCardSale`, `server/data/salon.ts`, read from the card's own row, so editing the sale's lines cannot turn it back into revenue) — is used by every place that adds invoices up: the shared Reports (revenue overview and the Reports page's opener, monthly trend, top customers, revenue by branch), the invoice list's money totals (`/api/invoices/stats`: total billed, collected, refunded) and a client's lifetime spend. A $50 card sold and then spent on a $50 service reads **$50 once**; a card sold and not yet spent reads $0; a service refunded back onto the card takes its $50 back off (the liability returns — the Gift cards page's "owed" total). Proof: `apps/unified/tests/salon-gift-card-revenue.test.ts`. The shared packages gained one optional condition (`revenueOnly`) that the salon vertical turns on; every other vertical's figures are unchanged. **Not changed:** balances owing (outstanding / overdue) are not revenue and are not filtered; the invoice list still lists the card's sale as an invoice (so its row counts stay), only its money is left out of the totals; the cash a card's sale took is not shown as a separate "gift cards sold" line in Reports (the Gift cards page shows what is still owed on cards).
- - **Limits:** a refund of a reload sale does not take money off the card; a refund by gift card goes back as paid value; the desk applies only configured offers (no free-form bonus); a paid online page whose card was voided meanwhile needs a manual Stripe refund; the 4-digit bank/Stripe test was run against a fake, not a real account.
- Proof: `apps/unified/tests/salon-gift-cards-depth.test.ts` (14) — fails without the change (run both ways). Screens are type-checked, built and **not seen in a real browser**.
- A card whose own sale was later refunded cannot be spent (refused with a reason); an owner can void it.
- Stylist commission is earned when a visit is paid with a gift card, like any payment (the sale line is a service/retail line, not the card).
- Amount limits: $5 to $1,000 a card.
- Shared packages, additive only: `InvoiceOptions.refundTender` (a refund by that method runs a doer inside the refund transaction; absent = unchanged) and an optional `reload` callback passed to the invoice page's side panel.
- Proving test: `apps/unified/tests/salon-gift-cards.test.ts` (7) — closed until the feature; seat rights; sell (paid sale, card, email, code not on the sale); spend (partial, remainder, masked reference, refusals); two tills at once; refund back onto the card (and not more than was paid that way, not onto a voided card); adjust/void with history and no code in the audit log; a refunded sale's card can't be spent. It fails without the change (no routes, no tables).
- Screens (Gift cards page, "Pay with a gift card" beside a sale) are type-checked and built but **not click-tested in a browser**.
