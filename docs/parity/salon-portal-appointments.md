# Salon #12 — Upcoming appointments in the client portal

## Sources (help-centre pages actually read)

- Fresha — Manage appointments from the client portal / online booking links: https://www.fresha.com/help-center (no single page on a client portal reached; the product's client profile and booking-link pages were read)
- Boulevard, Vagaro and GlossGenius: help-centre pages on a client portal were not reached; **nothing below claims a match against them.**

(Searched in this session before any code was written; the parity claims below are to what the brief names — "upcoming appointments, reschedule/cancel through the booking's private link" — and what the code now does.)

## Where this stands

| Capability | Here | Status |
|---|---|---|
| A client sees their upcoming appointments after signing in to their private portal link | Portal › Appointments: service, day and time, and the stylist's first name, soonest first (up to 50) | **Matches** |
| Home page shows how many are coming and when the next is | "Upcoming Appointments" and "Next Appointment" tiles | **Matches** |
| Move or cancel from the portal | A booking made **online** shows "Move or cancel", which opens its own booking page — where the salon's own notice rules decide whether it can still be changed. A desk booking says "please call us" | **Matches for online bookings; desk bookings are call-only** |
| Prices, notes, formulas, other clients | Never in the payload (proved in the test) | **By rule** |
| Past, cancelled, no-show and completed appointments | Not shown | — |
| Book a new appointment from the portal | Not built (the booking page is the way) | **Not doing** |
| A chair-only stylist (a Team member with no login) | Their name is not shown ("with" is empty) | **Not built** |

## Switches

- New feature id **`portal_appointments`** — registered **hidden / not ready**. A salon sees nothing until the owner turns it on. An empty or unreadable feature list is NOT a yes for this section (the other sections fall back to on; this one never does).
- The section exists only where a vertical asks for it (`PortalOptions.appointments`, set by the salon vertical). No other vertical's portal changes; the shared-package change is additive and tests in other verticals' portal suites still pass.
