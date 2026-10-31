# Salon depth — what was NOT built on `cloud/salon-depth`

All 13 gaps in the brief now have a built, tested, switched-off implementation on this branch, each with its own parity file in this folder
(`salon-card-on-file`, `salon-membership-autocharge`, `salon-book-grid`, `salon-processing-time`, `salon-multi-service`, `salon-online-stylist-intake`,
`salon-chair-checkout`, `salon-commissions`, `salon-retention`, `salon-gift-cards`, `salon-reports`, `salon-portal-appointments`, `salon-patch-test`).
Every new behaviour is behind a not-ready feature id and off for every live salon. What follows is what was deliberately **not** built — the brief's own
exclusions, and the edges each parity file lists as "Not built" — so nothing reads as finished that is not.

## Not doing (as the brief says)

- **Reserve with Google** — needs Google's partner onboarding (an approved aggregator/partner agreement and a bookings feed in their format). Not something the app can do alone.
- **A branded client app** and **a marketplace** — Twomiah takes no commission on a salon's own clients.
- ~~**Booth-rent collection**~~ — built on `cloud/salon-parity` (row 24): see `salon-booth-rent.md`.

## Built, but with edges left out (the full lists are in each file)

| # | Left out | Where it is written |
|---|---|---|
| 1 | A fee that differs per service or only above a booking value; prepayment at booking (deposits already exist in online booking) | salon-card-on-file |
| 2 | Staff "Retry now"; a backup card | salon-membership-autocharge |
| 3 | Zoom control; dragging the team order; preset blocked-time types and a paid mark; business-wide closed periods and team time off | salon-book-grid |
| 4 | More than one gap per service, or several kinds of gap | salon-processing-time |
| 5 | Editing one service of a booked visit; booking several services online at once; one visit record per service | salon-multi-service |
| 6 | "Choice required" for a stylist online; forms for memberships, with expiry dates, sent in bulk, with files or drawn signatures, or in the phone app | salon-online-stylist-intake |
| 7 | Editable tip presets (fixed 15 / 18 / 20); a tip split between several stylists; a tip left after the visit online; tips limited to the services on a sale; a low-stock email, reorder quantity and supplier purchase orders; barcode scanning; **a physical reader has not been tried** (the owner's checklist is in the file) | salon-chair-checkout |
| 8 | Volume tiers by item count; a tier cadence other than a month; payroll import | salon-commissions |
| 9 | Discounts inside birthday / win-back messages; milestone and loyalty-tier messages | salon-retention |
| 10 | Selling gift cards online; an expiry; a client-facing balance page; reloading a card as a sale | salon-gift-cards |
| 11 | Retail reports by brand, category, supplier or margin; stock value | salon-reports |
| 12 | Past appointments and "repeat"; memberships, gift cards and loyalty in the same account; booking from the portal; a chair-only stylist's name | salon-portal-appointments |
| 13 | Several patch tests in a client's history; who ran a test; the appointment message telling the client they need one | salon-patch-test |

## Checked by a person, not by the tests

- Every new screen is type-checked and builds, but **none has been click-tested in a browser**; the Book's drag-to-move and resize especially.
- Nothing has been tried against a **live** Stripe account or a physical card reader; Stripe was answered by a fake that follows its documentation.
- Vagaro, Boulevard and GlossGenius help-centre pages could not be read from this workspace; where a file compares against a vendor it says which page was read.
