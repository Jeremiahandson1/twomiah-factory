# Salon depth — what was NOT built on `cloud/salon-depth`, and what parity would need

Built and tested on this branch so far: **#1 (desk and online)**, **#2** (with the pause on a third decline), **#13** (with the patch-test offer), **#12** — each has its own parity file in this folder. Everything
below was **not started**. None of it was judged impossible; it was not reached. Nothing here is half-built or switched on.

| # | Gap | What parity needs (from the brief and the code read so far) |
|---|---|---|
| 3 | The Book as a time grid | A day grid with a column per stylist and a week view per stylist; drag to move and resize using the existing double-booking and chair checks; colour by status/service; **blocked time** (lunch, training) stored in a new table, drawn in the Book and respected by online booking (`BookingAddOn.busy`). Mostly front-end work in `AppointmentsPage.tsx` plus the blocked-time table. |
| 4 | Processing / gap time | Three durations on a Service Menu item (active, processing, finishing) and a clash check that lets another client into the processing gap; shown on the grid (so after #3). Touches `appointments.ts` `findConflict`, `onlineBooking.ts` `booked`/`busy`, and the engine's slot maths. |
| 5 | Several services in one visit | An ordered list of services per visit, each with its own stylist and time, priced and checked out together: a new child table under `appointment`, `visit.ts`/`checkout.ts` changes, and the booking input. Touches the vet's shared `appointment` table only additively. |
| 6 | Client picks a stylist online; intake forms | A stylist field ("any" or a named person) on the booking input and `BookingAddOn`; the salon builds intake/consent forms whose answers land on the client chart (`questions: []` for salon today). |
| 7 | Checkout at the chair: card reader, tips to the stylist, retail with stock, split tender | Offer the bar's `card_reader` (a counter reader on the salon's own Stripe) to the salon template — **needs a physical reader and a Stripe Terminal location to test, which this environment cannot do**; tips tied to the visit's stylist; retail products with stock on the bill; split tender. The phone app takes no cards. |
| 8 | Commissions | `commission_tracking` excludes `crm-salon`; the engine is invoice/job-based. Needs earn-from-completed-visits and retail by stylist, service vs retail rates and tiers, and a report. Depends on #7 for retail. |
| 9 | Automatic retention sends | Timed sends (rebook on the due date, birthday, win-back after N days, owner sets N, quiet hours, opt-out), a "book their next visit" prompt on visit completion, and visit-completed / lapsed triggers for the marketing drips. Needs the texting/email consent and quiet-hours rules checked first. |
| 10 | Gift cards for salons | `gift_cards` is the bar's register feature; needs sell/redeem/balance on the salon's checkout (`checkout.ts`) as a tender, offered to `crm-salon`. |
| 11 | Reports | Retention / visit frequency; rebook rate per stylist; retail and commission reports (the last two wait for #7/#8). |

## Not doing (as the brief says)

- **Reserve with Google** — needs Google's partner onboarding (an approved aggregator/partner agreement and a bookings feed in their format). Not something the app can do alone.
- **A branded client app** and **a marketplace** — Twomiah takes no commission on a salon's own clients.
- **Booth-rent collection** — moves money per renter.
