# Salon #6 — Clients choose their stylist online; intake and consent forms

## Sources (help-centre pages actually read)

- Timely — Staff booking preferences (the Online Bookings staff-selection setting): https://help.gettimely.com/hc/en-gb/articles/33524872532887-Staff-booking-preferences
- Square Appointments — Add and manage bookable team members: https://squareup.com/help/us/en/article/5350 (the same article also answered at /5968)
- Square Community — "Intake Forms" feature request (what Square's own sellers say exists today): https://community.squareup.com/t5/Feature-Requests/Intake-Forms/idi-p/351963
- Vagaro — Client forms & waivers (product page): https://www.vagaro.com/pro/forms

Fresha's "Learn how clients book appointments online" and "Manage online bookings settings" help pages were requested but came back as page titles only, with no article text; nothing below claims a match against Fresha on either point. Boulevard and GlossGenius: no page reached. The Square community thread is sellers talking, not Square documentation; it is cited only for the workarounds sellers name, not as a statement of Square's roadmap. Vagaro's page is a marketing page, not a help article, so its wording is the only detail available.

## What they do, and where this stands

| Capability | Here | Status |
|---|---|---|
| Client can pick a staff member, or choose no preference (Timely "optional choice") | "Let clients choose their stylist when they book online" (Settings › The Book). On: the client picks a stylist or "anyone" and sees only that person's open times | **Matches** |
| Staff must be made bookable online first (Square: "if you make team members bookable online, customers can book that team member") | Only stylists with their own online booking hours can be picked; a name not offered is refused (400) | **Matches** |
| Staff choice required before booking (Timely "required choice") | Settings › The Book: "Clients must choose a named stylist" (needs the pick on; turning it on turns the pick on). "Anyone" is not offered, no day or time shows until a stylist is chosen, a booking that names none is refused (400, in words). With nobody offered (no stylist has online hours) it does nothing, so a salon is never left unbookable | **Matches** (10/31, parity row 17; `salon-stylist-required.test.ts` — 3 of 4 fail on the old code) |
| Staff chosen automatically, no client choice (Timely "no choice") | This is the default (switch off): the booking goes to whoever is free | **Matches** |
| The chosen stylist is really held, and a clash is refused | The booking lands in that stylist's chair; if someone else has taken the time first the client is told (409) | **Matches** (own test) |
| Forms tied to service type (Vagaro: "based on service type or membership") | Each form can be limited to chosen services, or asked of every online booking | **Matches** for services; **not built** for memberships |
| Answers saved to the client's account (Vagaro) | Answers show on the client's chart, as asked, and a later change to a form does not rewrite them; deleting a form keeps the answers | **Matches** |
| Collect information automatically during booking (Vagaro) | After booking, the booking's page lists the forms that apply and have not yet been answered; each client answers each form once | **Matches in part**: the forms follow the booking, they do not block it |
| Waivers / consent (Vagaro) | Consent form: the client ticks an agreement and types their full name to sign; the name and time are kept | **Matches in part**: a typed name, not a drawn signature |
| Expiry dates on forms (Vagaro: "set expiration dates") | A form is answered once | **Not built** |
| Square: no native intake form (sellers use contracts sent afterwards, a link to Typeform, paper) | Built in | **Beats** (per the sellers' own thread; not checked against Square's current product) |
| Sending a form to existing clients in bulk, file uploads, photo questions, drawn signatures, forms inside the phone app | — | **Not built** |

## Decisions and limits to know

- **Off by default.** `client_stylist_pick` and `intake_forms` are registered not-ready (hidden). With neither on, online booking is exactly as before: no stylist list, no forms. A stylist choice sent to a salon with the switch off is refused (400).
- Turning the choice on is the owner's (company:update); so is building forms. Anyone who reads clients can read forms and answers.
- Forms are shown on the booking's page after the booking exists, so a client who skips them still has a booking. A salon that needs the form first has to ask at the desk.
- Nothing here takes a card or a payment.
- Proving test: `apps/unified/tests/salon-stylist-intake.test.ts` — fails without the change (no stylists listed, `who` ignored, no forms routes).
