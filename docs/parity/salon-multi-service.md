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
| One appointment, one date and time (Square) | Services run one after another from the visit's start; each service may have its own start, so two stylists work at once — on New Appointment ("At the same time as the first service") and in Edit services (row 8, `visit_editing`) | **Matches, and goes further** |
| Service gaps carry over (Fresha: processing per service) | Each service keeps its menu gap (#4) and holds its stylist only outside it | **Matches** |
| One checkout for the visit (Square) | Completing the visit raises ONE bill with a line per service and the sum as the total; a total typed over the parts becomes a single line | **Matches** |
| Tips split by each staff member's share (Square) | Built with row 10 (10/31): split by the value of each stylist's services, editable on the sale; see salon-chair-checkout.md. Proof: `tests/salon-tip-split.test.ts` | Built |
| A client's request for a team member marked on the service (Fresha's heart) | Row 8 (11/06, `visit_editing`): a heart per service (`appointment_item.requested_stylist`), on New Appointment and in Edit services. Proof: `tests/salon-visit-editing*.test.ts` | Built |
| Edit one service of a booked visit | Row 8 (11/06, `visit_editing`): "Edit services" on a booked visit — add, remove, re-time, re-assign — `PUT /api/appointments/:id/services`, with a new visit's clash (its own time ignored), blocked-time and own-chair checks; refused once the visit is done (VISIT_CLOSED). Off, the old 409 VISIT_HAS_SERVICES stands | Built |
| Online booking of several services at once (Fresha, Vagaro, Square) | Row 9 (11/07, `online_multi_service` with `multi_service_visits`): "+ Add another service" on the booking page, up to 4 services, each after the one before, each with its own stylist or whoever is free. Only times where every service fits are offered; the booking is one visit on the Book with a line per service, each stylist held only for their own; deposits are summed, a card or forms asked for any service are asked for the booking; the price is the sum. Moving it online is refused in words (call us); the desk moves it. A desk edit of its services carries to the booking. Proof: `tests/salon-online-several*.test.ts` | Built |
| One visit record per service (each stylist's own formula) | Row 8 (11/06, `visit_editing`): closing the visit writes one record per service with its own stylist (`service_record.appointment_item_id`; unique per appointment + service). Visit counts (lapsed clients, visit spans, chair takings, the month's visits) count a visit once | Built |

## Decisions and limits to know

- **Off by default.** `multi_service_visits` is registered not-ready (hidden). Until a salon is given it the server refuses a list of services (409 FEATURE_OFF) and the screen shows no "add another service" link.
- The visit's own row carries the first service and stylist, and the whole span and price, so every existing report and screen still reads it.
- Loyalty is awarded once on the visit total.
- **Row 9 is off by default** (`online_multi_service`, not ready) and needs `multi_service_visits`. Online the services run one after another; two at the same time is a desk booking.
- **Row 8 is off by default** (`visit_editing`, not ready). Two services may start at the same minute only with different stylists; the same stylist twice at once is refused in words.
- Proving test: `apps/unified/tests/salon-multi-service.test.ts` — fails without the change (the list is ignored and a plain appointment is booked).
