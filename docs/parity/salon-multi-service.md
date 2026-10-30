# Salon #5 — Several services in one visit

## Sources (help-centre pages actually read)

- Fresha — Create single appointments: https://www.fresha.com/help-center/knowledge-base/calendar/260-create-appointments-1
- Square Appointments — Schedule appointments with multiple staff members: https://squareup.com/help/us/en/article/7238-multi-staff-appointment-staff-scheduling

Vagaro, Boulevard, GlossGenius and Mindbody: no help-centre page on multi-service visits was reached; nothing below claims a match against them. Neither page says whether services can have their own start times or overlap; those rows rest on this build's own tests.

## What they do, and where this stands

| Capability | Here | Status |
|---|---|---|
| Add more services to one appointment with an "Add service" button (Fresha) | "+ Add another service to this visit" on New Appointment (up to 8 services) | **Matches** |
| Each service has its own team member (Fresha, Square) | Each service has its own stylist, defaulting to the visit's | **Matches** |
| Assigned services show on that staff member's calendar (Square) | Each stylist is held only for their own service(s): the colourist is busy for the colour, the stylist doing the cut for the cut; the Book lists the visit with every service and stylist; a stylist narrowed to their own book sees any visit they have a service in | **Matches** |
| One appointment, one date and time (Square) | Services run one after another from the visit's start; a service can be given its own start (minutes into the visit) through the API, so two stylists can work at once | **Matches, and goes further** (the screen offers the sequential case) |
| Service gaps carry over (Fresha: processing per service) | Each service keeps its menu gap (#4) and holds its stylist only outside it | **Matches** |
| One checkout for the visit (Square) | Completing the visit raises ONE bill with a line per service and the sum as the total; a total typed over the parts becomes a single line | **Matches** |
| Tips split by each staff member's share (Square) | Tips arrive with checkout at the chair (#7): the **whole** tip goes to the visit's stylist; a split between the stylists of a multi-stylist visit is not built | **Not built** |
| A client's request for a team member marked on the service (Fresha's heart) | A client's stylist choice is part of online booking (#6); marking it per service on a multi-service visit is not built | **Not built** |
| Edit one service of a booked visit | Move, check in, complete and cancel work on the whole visit; adding, removing, re-timing or re-assigning a service is refused in words (409 VISIT_HAS_SERVICES) — cancel and rebook | **Not built** |
| Online booking of several services at once | Online booking still takes one service | **Not built** |
| One visit record per service (each stylist's own formula) | One visit record per visit, under the first service | **Not built** |

## Decisions and limits to know

- **Off by default.** `multi_service_visits` is registered not-ready (hidden). Until a salon is given it the server refuses a list of services (409 FEATURE_OFF) and the screen shows no "add another service" link.
- The visit's own row carries the first service and stylist, and the whole span and price, so every existing report and screen still reads it.
- Loyalty is awarded once on the visit total.
- Proving test: `apps/unified/tests/salon-multi-service.test.ts` — fails without the change (the list is ignored and a plain appointment is booked).
