# Salon #4 — Processing / gap time

## Sources (help-centre pages actually read)

- Fresha — Add extra time to services and appointments: https://www.fresha.com/help-center/knowledge-base/catalog/101630-add-extra-time-to-services-and-appointments-1
- Square Appointments — Add gap times to your services: https://squareup.com/help/us/en/article/6756-add-gap-times-to-your-square-appointments-services
- Timely — How to add processing time to your services: https://help.gettimely.com/hc/en-gb/articles/38519721156759-How-to-add-processing-time-to-your-services

Vagaro, Boulevard and GlossGenius: no help-centre page on processing time was reached (searches returned only reviews), so nothing below claims a match against them. Square's and Timely's pages say nothing on whether staff can be booked in the gap or on online booking; those rows rest on Fresha's page and on this build's own tests.

## What they do, and where this stands

| Capability | Here | Status |
|---|---|---|
| A service has a processing stretch; the client stays, the stylist is free to take another client (Fresha, Square, Timely) | Per service: "hands-on work first" minutes, then "processing" minutes; the rest of the duration is finishing work. The stylist is held for the first and last stretch only | **Matches** |
| Set per service, applied to every appointment for it (Fresha) | Set on the Service Menu item; every new booking of it carries the gap | **Matches** |
| Changes to a service apply to new appointments only (Timely) | The gap is copied onto the appointment when booked; later changes to the menu item do not move existing appointments | **Matches** |
| Adjust or remove the gap on one appointment (Fresha, Square) | The desk can set or clear the gap on one appointment (create or edit) | **Matches** |
| Another client can be booked into the gap (Fresha) | At the desk and online. A cut at 13:00 fits inside a colour that processes 13:00–14:00 for the same stylist; a cut that would touch the hands-on stretches is refused (409 APPOINTMENT_CONFLICT) | **Matches** |
| Online booking respects the gap | Online times offered for a stylist account for other clients' gaps | **Matches** |
| Shown on the calendar as a faded/partial segment (Fresha, Square) | Not yet — the Book's time grid (#3) draws it | **Waits on #3** |
| Several gap kinds per service: processing, blocked, extra servicing; reorderable (Fresha) | One gap per service | **Not built** |
| A service can carry more than one gap in a sequence | No | **Not built** |

## Decisions and limits to know

- **Off by default.** The feature id `processing_time` is registered not-ready (hidden). Until a salon is given it, the service form shows no gap fields and the server refuses them (409 FEATURE_OFF); everything books as the whole span, as today.
- A booking that itself has a gap holds its **whole span** when taken online (conservative: two gap bookings cannot interleave online); the desk can double-book into gaps.
- Cancelled and no-show appointments free their time.
- Proving test: `apps/unified/tests/salon-processing-time.test.ts` — fails without the change (the 13:00 cut is a clash on the whole span).
