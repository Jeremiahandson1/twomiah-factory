# Salon #7 — Checkout at the chair (card reader, tips to the stylist, retail with stock, split tender)

## Sources (pages actually read)

- Fresha — Collect payments using a card terminal: https://www.fresha.com/help-center/knowledge-base/payments/385-collect-payments-using-a-card-terminal-1
- Fresha — Collect payments using multiple methods: https://www.fresha.com/help-center/knowledge-base/sales/101288-collect-payments-using-multiple-methods
- Fresha — Set up and manage tips: https://www.fresha.com/help-center/knowledge-base/sales/101304-set-up-and-manage-tips
- Fresha — Low stock notifications (a blog post, not a help page): https://www.fresha.com/blog/introducing-our-low-stock-notification-feature
- Stripe — Collect tips (overview): https://docs.stripe.com/terminal/features/collecting-tips/overview
- Stripe — Collect on-reader tips: https://docs.stripe.com/terminal/features/collecting-tips/on-reader
- Stripe — Test Stripe Terminal (simulated reader): https://docs.stripe.com/terminal/references/testing

**Not read, so nothing below is claimed against them:** Vagaro, Boulevard and GlossGenius (searches returned marketing pages and blogs, no help-centre article on checkout, tips, a reader or retail stock); Fresha's other copies of the tips and split-payment pages (ids 352 and 378 returned only a title — the 101304 and 101288 pages above are the same topics and were read in full).

What the pages say:

- Fresha, card terminal: choose Card terminal → Pay now; the amount shows on the terminal and the client inserts, taps or uses a wallet. "If a payment fails or a terminal payment is cancelled during checkout, the sale will automatically be saved as Draft"; you can reopen it and pick another method. Clients can tip on the terminal "as long as tipping is enabled in your settings". The page does not mention refunds.
- Fresha, multiple methods: "Split payments let you take payment for a single sale using multiple payment methods, such as a card terminal and cash"; you enter an amount per method until the balance is paid.
- Fresha, tips: tips can be added on the point-of-sale tip screen, on a card terminal, on a self-checkout page, or later online. "Tips are split proportionally based on the value of the services each team member provided during the sale", editable at checkout or after. Preset percentages are set in settings ("no more than three values"). Tips are reviewed in the Finance summary report. The page does not say whether tips count toward commission.
- Fresha, low stock: a low-stock limit and a reorder quantity per product; an alert when the limit is reached and a Monday 9am summary to the account holder; purchase orders can be filled in and sent to suppliers.
- Stripe: tips are either on-reader (the reader shows three suggestions before the card is presented; the confirmed PaymentIntent's `amount` includes the tip and `amount_details.tip.amount` carries it) or on-receipt. A tip the business decides itself goes into the PaymentIntent amount. On-reader tipping is a Terminal Configuration set on the account or a location; `process_config[skip_tipping]` hides the screen for one payment. Stripe also lets a `tip-eligible amount` limit percentage tips to the services on a sale — its own example is a salon selling haircuts and shampoo. The simulated reader comes with the server-driven integration; `present_payment_method` simulates the card being tapped; 4242424242424242 approves and 4000000000000002 is declined with `card_declined`.

## What they do, and where this stands

| Capability | Here | Status |
|---|---|---|
| Pay on a card reader from the sale (Fresha) | "Card reader" panel beside the sale: pick the reader, the amount, the tip → Send to the reader. The sale is paid once Stripe confirms the PaymentIntent, not before | **Matches** |
| Decline / cancel leaves the sale open for another method (Fresha: saved as Draft) | A decline, a cancel at the desk and a 3-minute timeout each record nothing and leave the sale open; the PaymentIntent is cancelled. A card that went through in the same instant as the cancel is recorded, not lost | **Matches** (the sale stays open instead of becoming a draft) |
| Split payment, an amount per method until paid (Fresha) | Cash, a gift card and the reader each take part of the balance, in any order; the reader's amount box defaults to what is still owing | **Matches** |
| Several cards on one sale (Fresha, separate article — not read) | The reader can be sent less than the balance, again and again | Built; not compared |
| Tip on the terminal if tipping is on (Fresha) | Two ways: typed at the desk (15 / 18 / 20 % shortcuts, or any amount) **or** chosen by the client on the reader's own screen (15 / 18 / 20 %, Stripe's on-reader tipping). The desk tip is added to the PaymentIntent and recorded beside the payment as the tip | **Matches** |
| Tip presets editable in settings (Fresha) | Fixed at 15 / 18 / 20 | **Not built** |
| Tips go to the team members who worked on the sale, split by service value (Fresha) | The **whole** tip goes to the stylist of the visit the sale closed. A visit with several stylists (#5) credits the visit's stylist only; a walk-in sale with no visit is "No stylist recorded" | **Differs** |
| Tip added after the visit, online (Fresha) | Not built | **Not built** |
| Tips reviewed in a report (Fresha) | Client reports › Tips by stylist, for any period | **Matches** |
| Tip limited to the services on a sale (Stripe's tip-eligible amount) | Percentages are worked on the whole amount. Not built | **Not built** |
| Refund a reader payment | "Refund to card" on the sale: the sale amount goes back through Stripe on the salon's own account, then is recorded (Fresha's page does not mention refunds) | Built |
| Test without hardware (Stripe) | Settings › Card readers › type `simulated-wpe`; a "Tap test card" pair of buttons shows for an owner on a simulated reader | **Matches** |
| Retail products with a count, a low-stock level (Fresha) | Retail page: price, cost (managers only), count on hand, "flag as low at"; a banner lists what is running low | **Matches** (flag on screen only) |
| Low-stock email, reorder quantity, purchase orders to suppliers (Fresha) | Not built | **Not built** |
| Sell retail at checkout | A product goes on the client's sale (or a walk-in sale) as a "retail" line; the stylist of the visit earns retail commission on it (#8) and it appears in the retail-sold report (#11) | Built |
| Stock never oversold | The count is taken under a row lock inside the sale's own transaction: two desks selling the last bottle are served one after the other | Built |
| Barcode scanning, supplier records, stock transfers between locations | Not built | **Not built** |

## Money: whose account

Every call to Stripe carries the salon's own connected account (the one Settings › Integrations connects). The reader, its Location, its PaymentIntents and its refunds are all on that account; Twomiah holds nothing. The phone app takes no cards and has no new screen: the card is tapped on the reader.

## Decisions and limits to know

- **Off by default.** Two new not-ready (hidden) feature ids: `chair_checkout` (readers, card payments, refunds to card) and `salon_retail` (products, stock, retail lines). Mounted at `/api/chair-checkout` and `/api/salon-retail`. The new tips report rides on the existing hidden `salon_reports`.
- **Who can do what (server-enforced):** taking a card, cancelling one, listing readers: `invoices:update`. Pairing or removing a reader and tapping a test card: `company:update` (owner/admin). Refunding to the card: `payments:delete`. Selling retail onto a sale: `invoices:update` (a new walk-in sale also `invoices:create`); retail list for the till: `invoices:read`; the full catalogue with cost, products, stock received/corrected: `inventory:read/create/update` (a manager holds these). A stylist holds none of them. **Decision for the owner:** the Front Desk seat holds none of the invoice rights today, so it cannot take a card or sell retail until the owner grants them.
- **A tip is not refunded with the sale.** "Refund to card" sends back the sale amount; the tip belongs to the stylist and is refunded in Stripe's dashboard if it must be. **Decision for the owner.**
- **A card taken on a sale that was voided meanwhile** is marked "needs review" with a sentence telling a person to refund it in Stripe; it is never recorded on a void sale. A card taken after the sale was paid some other way is recorded (the sale shows more paid than owed) rather than lost.
- **Editing a sale's lines in the general invoice form rewrites them** (that form keeps no product link), which puts the units back on the shelf and leaves a plain line; retail is added and removed from the Sell retail panel. A refund does not put units back (the bottle may not come back): a manager corrects the count.
- **Retail on a walk-in sale has no stylist**, so no retail commission is earned on it; put the product on the visit's own sale to credit the stylist.
- **A mistyped pairing code** still costs a spare (empty) Location on the salon's Stripe account. Harmless.
- **US only, dollars only** (Stripe's WisePOS E / S700 server-driven readers; the salon's address is sent to Stripe once to create the Location).
- **Not verified against real Stripe:** everything above was proved against Stripe's API as documented, answered by a fake in `tests/foodKit.ts` (nothing leaves the machine). The test helper's `amount_tip` parameter (used by the tests to simulate an on-reader tip) is the bar's usage and is **not on the Stripe testing page I read**. **A physical reader has not been tried.** Owner's check before switching `chair_checkout` on for a real salon, with the reader and the salon's Stripe account in test mode: (1) pair the reader in Settings › Card readers with the code the reader shows; (2) take a $1.00 card payment with a $0.25 desk tip and confirm one payment with a 0.25 tip appears on the sale and in Stripe; (3) take another and choose the tip on the reader's screen; (4) press cancel on the reader mid-payment; (5) decline (a test card ending 0002); (6) refund to card and see it in Stripe; (7) unplug the reader and confirm the desk is told it did not answer.
- Proving tests: `apps/unified/tests/salon-chair-checkout.test.ts` (12) — seat rights; pairing on the salon's own account, one Location; approve with a tip, recorded once, tip on the report; on-reader tip; six polls at once; decline / cancel / timeout; cancel racing an approval; offline reader and bad amounts refused before money moves; split cash + gift card + card; paid-meanwhile and voided-meanwhile; refund to card through Stripe; wrong Stripe account, no Stripe key, a busy reader. `apps/unified/tests/salon-retail.test.ts` (9) — seat rights; product rules; retail line, tax and stock; the last bottle sold once; removal and void return stock; walk-in sale; stock received/corrected with who and why; retail commission and the retail report; the general form's rewrite. Both fail without the change (no routes, no tables).
- Screens (Retail page, Card reader panel, Sell retail panel, Settings › Card readers, Tips in Client reports) are type-checked and built but **not click-tested in a browser**.
- Shared packages: only the feature registry gained two hidden entries. Nothing else outside `apps/unified`.
