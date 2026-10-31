# Salon #12 — Upcoming appointments in the client portal

## Sources (help-centre pages actually read)

- Altegio — Personal account in the online booking widget: https://alteg.io/en/support/knowledge-base/4903552434461-personal-account-in-online-booking-widget/ (My bookings: Upcoming tab with reschedule/cancel, Past tab with repeat, plus memberships, gift cards, loyalty)
- Slick — Client: manage, cancel or modify appointments: https://help.getslick.com/en/articles/15343687-client-manage-cancel-or-modify-appointments (view and cancel in the portal subject to the salon's timing and policy; reschedule is by contacting the salon)

Searches for Fresha, Vagaro, Boulevard and GlossGenius pages on a client account/portal returned no help-centre page I could read, so **nothing below claims a match against those four.** The two pages above are other salon products, used only to say what a client portal commonly offers.

## Where this stands

| Capability | Here | Status |
|---|---|---|
| A client sees their upcoming appointments after signing in to their private portal link | Portal › Appointments: service, day and time, and the stylist's first name, soonest first (up to 50) | **Matches** |
| Home page shows how many are coming and when the next is | "Upcoming Appointments" and "Next Appointment" tiles | **Matches** |
| Move or cancel from the portal (Altegio: reschedule or cancel; Slick: cancel only, subject to the salon's policy) | A booking made **online** shows "Move or cancel", which opens its own booking page — where the salon's own notice rules decide whether it can still be changed. A desk booking says "please call us" | **Matches for online bookings; desk bookings are call-only** |
| Prices, notes, formulas, other clients | Never in the payload (proved in the test) | **By rule** |
| Past appointments tab with "repeat" (Altegio) | Not shown | **Not built** |
| Memberships, gift cards and loyalty balances in the same account (Altegio) | Not in the portal | **Not built** |
| Cancelled, no-show and completed appointments | Not shown | — |
| Book a new appointment from the portal | Not built (the booking page is the way) | **Not doing** |
| A chair-only stylist (a Team member with no login) | Their name is not shown ("with" is empty) | **Not built** |

## Switches

- New feature id **`portal_appointments`** — registered **hidden / not ready**. A salon sees nothing until the owner turns it on. An empty or unreadable feature list is NOT a yes for this section (the other sections fall back to on; this one never does).
- The section exists only where a vertical asks for it (`PortalOptions.appointments`, set by the salon vertical). No other vertical's portal changes; the shared-package change is additive and tests in other verticals' portal suites still pass.
