# Salon #1 — Card on file, no-show and late-cancel fees

Leaders compared: Square Appointments and Fresha (their help-centre pages were read). Vagaro, GlossGenius, Boulevard and
Mindbody: only marketing-level pages were found, not help-centre pages, so nothing below claims a match against them.

## Sources (help-centre pages actually read)

- Square — Manage booking cancellations and prepayment policies: https://squareup.com/help/us/en/article/5493-manage-booking-cancellations-and-prepayment-policies
- Fresha — Set up payment policies: https://www.fresha.com/help-center/knowledge-base/payments/101660-set-up-payment-policies

## What the leaders do, and where this stands

| Capability (leader) | Here | Status |
|---|---|---|
| Keep a client's card on file for no-show / late-cancel protection (both) | Card typed on Stripe's own page, kept on the salon's own Stripe account; brand, last four and expiry shown on the client's chart | **Matches** |
| Cancellation window the salon sets (both) | "A cancellation is late when it comes less than 2 hours … 7 days before" | **Matches** |
| No-show fee and late-cancel fee as a set amount or a percent of the service (both) | Each fee is a set amount or a percent of the service price | **Matches** |
| Policy shown to the client and agreed to before the card is kept (both) | Policy words in the salon's own text or a standard sentence; the person at the desk ticks that the client agreed; the policy words and who agreed are kept with the card | **Matches** — at the desk (the person ticks) and online (see below) |
| Charge from the appointment, with a reason (Square) | "Charge a fee" on a no-show or cancelled appointment: shows the amount and the card, asks why, one confirm | **Matches** |
| Receipt to the client (both) | Emailed when the charge goes through | **Matches** |
| Record of what was charged (both) | Every attempt is kept with its result and who pressed the button | **Matches** |
| Fee amount differs per service (Fresha, Square) | Service Menu › a service's own no-show and late-cancel fee, a set amount or a percent of that service; blank = the salon's fee. Set by the owner or an admin. A visit of several services is judged service by service: a service with its own fee pays it, the salon's flat fee counts once for the rest, the salon's percent is taken of their prices together | **Matches** (10/31, parity row 4). Neither page says how several services add up; this is our decision |
| Different rules for new and returning clients (Fresha) | Who is asked for a card online (never / new clients only / every client without one), and a separate no-show and late-cancel fee for a new client (a client with no completed visit before this appointment). A service's own fee is the same for both | **Matches** (10/31, parity row 4) |
| Client leaves a card while booking online, policy shown first (both) | Settings › Card on file › "When a client books online, ask for a card". Off by default. The time is held, like a deposit's, on the booking's own page which shows the policy and a tick; then Stripe's own card page on the salon's account; the card's arrival confirms the booking and sends the confirmation. Nothing is charged. A hold that runs out is released | **Matches** (proved in tests) |
| Fee only above a booking value (Fresha) | Settings › Card on file › "Charge a fee only when the booking is worth at least": a booking under it owes no fee, and the dialog and the server say so in words | **Matches** (10/31, parity row 4) |
| A service with a deposit also keeps the card (Fresha, Square) | One Stripe page, not two: the booking's page shows the policy and a tick beside "Pay the $X deposit and keep my card"; the server opens the page only with the tick. The paying card is saved on the client (policy words and "client online" kept) and the deposit confirms the booking | **Matches** (10/31, parity row 5; simulated Stripe) |
| Prepayment / full payment at booking (both) | Service Menu › "Take the full price when booking online" (a fixed price only; refused on a "from" price). The whole price is asked on Stripe's page into the salon's own account; when the visit is closed its sale already carries the payment (so the chair never asks again). A deposit is credited to the sale the same way | **Matches** (10/31, parity row 5; simulated Stripe). Tax on the sale is still owed at the chair, as the price paid ahead is before tax |
| A card or payment that arrives after the hold ran out (the brief) | Restores the booking, and its place on the Book, when the time is still free and ahead; otherwise the card stays kept (or the payment is refunded), and the booking's page says so in words with the next openings and a link to choose a new time | **Matches** (10/31, parity row 5) |
| Fee charged automatically when marked a no-show (Square brief) | Opt-in, off by default (Settings › Card on file). When on, marking a no-show charges the no-show fee to the card on file once, with the same emailed receipt and ledger row (marked automatic); the desk is told by a message if there was no card or the booking was under the minimum, and the no-show is still marked. The confirm dialog says a fee will be charged. A late-cancel fee stays a person's confirmed action. Both leaders' pages read (Fresha 617, Square 5493) say fees are charged manually, so this goes beyond them at the owner's request | **Matches the brief** (10/31, parity row 4) |
| Reverse a charged fee | "Reverse" on the charge in the Charge a fee dialog (the seat that charges): the whole charge goes back to the card on the salon's own Stripe account once, with who and why kept; the ledger row stays. A reversed fee can be charged again. Fresha's page says a no-show fee cannot be reversed once charged; Square's says refunds are at the salon's discretion | **Built, goes beyond Fresha** (10/31, parity row 4). The client is not emailed about a reversal |
| Cards kept on the salon's own Stripe account only | Yes; nothing on Twomiah's account; nothing typed or charged from the phone app | **By rule** |

## What is NOT at parity yet

- **Not built here**: an email to the client when a fee is reversed (only the charge has a receipt).
- **Not seen in a real browser**: the combined deposit-and-card button, the late-card message and the Service Menu tick were exercised through the server and a simulated Stripe, not on a live salon account or a phone.
- **Physical check for the owner**: the card page was proved against a simulated Stripe, not a live salon account.

## Needs to be true on the salon's side

The salon's own Stripe account must be connected (Settings › Integrations). Without it the Add a card button explains this and nothing is created.
