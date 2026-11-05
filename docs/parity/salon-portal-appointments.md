# Salon #12 — Upcoming appointments in the client portal

## Sources (help-centre pages actually read)

- Altegio — Personal account in the online booking widget: https://alteg.io/en/support/knowledge-base/4903552434461-personal-account-in-online-booking-widget/ (My bookings: Upcoming tab with reschedule/cancel, Past tab with repeat, plus memberships, gift cards, loyalty)
- Slick — Client: manage, cancel or modify appointments: https://help.getslick.com/en/articles/15343687-client-manage-cancel-or-modify-appointments (view and cancel in the portal subject to the salon's timing and policy; reschedule is by contacting the salon)

Searches for Fresha, Vagaro, Boulevard and GlossGenius pages on a client account/portal returned no help-centre page I could read, so **nothing below claims a match against those four.** The two pages above are other salon products, used only to say what a client portal commonly offers.

## Where this stands (row 21 built)

| Capability | Here | Status |
|---|---|---|
| Upcoming appointments after signing in to the private link | Portal › Appointments › Upcoming: service, day and time, the stylist's first name, soonest first (up to 50) | **Matches** |
| Home page shows how many are coming and when the next is | "Upcoming Appointments" and "Next Appointment" tiles | **Matches** |
| Move or cancel, online bookings (Altegio: reschedule or cancel; Slick: cancel, subject to the salon's policy) | "Move or cancel" opens the booking's own page, where the salon's notice rules decide | **Matches** |
| Move or cancel, bookings the desk made | The same page is made for the appointment when the client asks (`POST /p/:token/appointments/:id/manage`), so the notice cutoff, availability, late-cancel note and calendar sync are the booking engine's own | **Matches, with limits below** |
| Past appointments tab with "Book again" (Altegio "repeat") | Past tab: completed visits, newest first; "Book again" opens the Book tab on that service when it can be booked online | **Matches** |
| Memberships (credits left), gift-card balances and loyalty points in the portal (Altegio) | My Account: plan, credits left of total, renewal day, a paused-for-payment note; gift cards by last four digits with what can be spent now (a lapsed bonus is left out); loyalty points, tier, next tier, punch card | **Matches** |
| A chair-only stylist's first name | Shown (a Team member with no login), upcoming and past | **Matches** |
| Book a new appointment from inside the portal | Book tab: the booking page's own services, people, days and times; the client's name, email and phone are the portal client's, never typed | **Matches, with limits below** |
| Prices, notes, formulas, other clients | Never in the payload (proved in the tests) | **By rule** |

### Row 21 limits (stated, not hidden)

- A desk booking can be moved or cancelled in the portal only when the booking engine can move it faithfully. Otherwise the client is told in words to call: the visit has several services, the stylist is chair-only, the service is not bookable online, the client has no email on file, or it is inside the salon's notice window.
- Moving a desk booking adopts it into the booking engine, which then applies its own rules (length of the one service, its own availability).
- A booking made in the portal that needs a deposit, a card on file or intake forms is held and the client is sent to the booking page link for that step; the portal does not take those itself.
- If the client has no phone on file the booking page's rule asks for one, and the portal asks for it in words; if there is no email the client is told to call.
- Services with custom booking questions are not asked in the portal.
- "Completed" is not carried from the desk appointment to the adopted booking.
- Not seen in a real browser or on a real phone: the portal pages are typechecked and built, and the API behind them is tested.
- Tests: `apps/unified/tests/salon-portal-depth.test.ts` (9; 7 of the first 8 fail without the change) and `salon-portal-appointments.test.ts` (4).

## Switches

- New feature id **`portal_appointments`** — registered **hidden / not ready**. A salon sees nothing until the owner turns it on. An empty or unreadable feature list is NOT a yes for this section (the other sections fall back to on; this one never does).
- The section exists only where a vertical asks for it (`PortalOptions.appointments`, set by the salon vertical). No other vertical's portal changes; the shared-package change is additive and tests in other verticals' portal suites still pass.
