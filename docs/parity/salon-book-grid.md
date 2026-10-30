# Salon #3 — The Book as a time grid, and blocked time

## Sources (help-centre pages actually read)

- Fresha — Reschedule appointments: https://www.fresha.com/help-center/knowledge-base/calendar/263-reschedule-appointments
- Fresha — Manage your calendar display settings: https://www.fresha.com/help-center/knowledge-base/calendar/16-manage-your-calendar-display-settings-
- Fresha — Set up and manage blocked time (blocked time types): https://www.fresha.com/help-center/knowledge-base/calendar/18-set-up-and-manage-blocked-time
- Fresha — Add extra time to services and appointments (how processing time is drawn): https://www.fresha.com/help-center/knowledge-base/catalog/101630-add-extra-time-to-services-and-appointments-1
- Square Appointments — Create a personal event on your calendar: https://squareup.com/help/us/en/article/5533-create-a-personal-event-on-your-square-appointments-calendar
- Square Appointments — Create and schedule appointments: https://squareup.com/help/us/en/article/5349-schedule-and-accept-appointments

Not reached: Fresha's "Create and manage blocked time in your calendar" (576) returned only its summary line, and its colour-coding article was not opened; Vagaro, Boulevard, GlossGenius, Mindbody — no help-centre page read. Nothing below claims a match on those points.

## What they do, and where this stands

| Capability | Here | Status |
|---|---|---|
| Day view and week view (Fresha: Day, 3 days, Week, Month) | Day, Week (unchanged cards) and a new **Grid** view | **Matches day and week; no 3-day or month** |
| A column per team member (Fresha) | Grid, no stylist picked: one column per stylist for the day, plus "Unassigned" when there are such bookings | **Matches** |
| One stylist's week (the brief's "week per stylist") | Grid with a stylist picked: seven day columns for that stylist | **Matches** |
| Drag a card to a new time slot or team member on the Day view (Fresha) | Drag in the grid: to a new time (15-minute steps) or, in the day grid, another stylist's column. The same PUT as the Reschedule button, so the server's clash, own-chair and blocked-time checks decide; a clash is refused in words | **Matches** |
| Drag the bottom edge to change the length (Fresha) | Same, for a one-service appointment | **Matches** |
| Confirmation window showing conflicts, and overriding them (Fresha) | A clash is refused (a stylist is never double-booked); blocked time asks first and can be booked over with "Book it anyway" | **Different — stricter for clashes, same for blocked time** |
| Move an appointment to another day by drag | In a stylist's week, drag to another day's column; in the day grid use Reschedule | **Matches in the week** |
| Click a free time slot to start an appointment (Square) | Click an empty part of a column: New Appointment opens at that time and stylist | **Matches** |
| Processing time drawn as a faded segment (Fresha) | Hatched stretch inside the card, in the service's colour | **Matches** |
| Colour-coding appointments (Fresha) | Card tint by status, left stripe by service (a steady colour per service name) | **Matches in spirit** — the Fresha colour page was not read |
| Zoom / time-slot interval (Fresha) | Fixed scale, 15-minute steps; hours stretch to hold early or late bookings | **Not built** — no zoom control |
| Team order dragged by the user (Fresha) | Alphabetical | **Not built** |
| Blocked time for a team member, recurring (Square personal events: assigned to a staff member, "Set repetition") | Blocked time per stylist or for the whole salon, with a reason; repeat for up to 26 more weeks on the same weekday | **Matches; weekly repeat only** (no daily or custom rules) |
| Blocking is what removes booking availability; clients never see the event (Square) | Online booking never offers or takes a blocked time, and shows no reason | **Matches** |
| Blocked time types with a preset reason and a paid/unpaid mark (Fresha) | A free-text reason | **Not built** — no preset types, no pay mark |
| Deleting a type does not remove blocks already made (Fresha) | Not applicable (no types) | — |
| What happens to appointments already inside new blocked time (neither page says) | They stay; saving the block says how many are inside | **Decision, noted** |
| Who can create them: owner and team members with appointments permission (Square) | Needs the same permission as booking (`schedule:create`) to make, `schedule:update` to change or remove. A stylist narrowed to their own chair blocks only their own; the whole-salon block is for those who see the whole book | **Matches** |
| Time off for the team, business closed periods (Fresha) | Not built (a long block can stand in for a holiday, up to 14 days) | **Not built** |

## Decisions and limits to know

- **Off by default.** `book_grid` is registered not-ready (hidden). Until a salon is given it the Grid tab and "Block time" button do not exist, `/api/book-blocks` is closed, and the desk books exactly as before.
- Blocks cover only a stylist's **hands-on** time: a gap inside a colour may sit over a break.
- A visit with several services draws each service in its own stylist's column; dragging moves the whole visit.
- Cancelled and no-show appointments are not drawn (they free their time).
- Online booking: a block already stops the stylist's time being taken at the moment of booking (`booked`) and removes it from offered times (`busy`), so a block made after clients booked never cancels them.
- Proving tests: `apps/unified/tests/salon-book-blocks.test.ts` (fails without the change: no routes, no BOOK_BLOCKED, online time still offered) and `salon-book-grid.test.ts` (the grid's arithmetic). The drag-and-drop itself is not covered by an automated test — see "unverified" in the pull request.
