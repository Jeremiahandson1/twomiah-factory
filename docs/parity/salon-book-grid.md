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
| Day view and week view (Fresha: Day, 3 days, Week, Month) | Day, **3 days**, Week, **Month** and the **Grid**. 3 days and the week are day cards; the month is the month's whole weeks with each day's count and first appointments, a day opening in the day view; the arrows step 3 days, a week or a month; each fetches the company's own days (`bookViews.ts`). The Grid with a stylist picked shows her week or three days | **Matches** (10/31, parity row 1) |
| A column per team member (Fresha) | Grid, no stylist picked: one column per stylist for the day, plus "Unassigned" when there are such bookings | **Matches** |
| One stylist's week (the brief's "week per stylist") | Grid with a stylist picked: seven day columns for that stylist | **Matches** |
| Drag a card to a new time slot or team member on the Day view (Fresha) | Drag in the grid: to a new time (15-minute steps) or, in the day grid, another stylist's column. The same PUT as the Reschedule button, so the server's clash, own-chair and blocked-time checks decide; a clash is refused in words | **Matches** |
| Drag the bottom edge to change the length (Fresha) | Same, for a one-service appointment | **Matches** |
| Confirmation window showing conflicts, and overriding them (Fresha) | A stylist clash is refused for everyone except a manager, who can book or move over it with "Book it anyway" and a typed reason (3+ characters) that is kept on the appointment note and in the audit log; a station clash is still refused; blocked time asks first and can be booked over | **Matches — manager only, with a reason** |
| Move an appointment to another day by drag | In a stylist's week, drag to another day's column; in the day grid use Reschedule | **Matches in the week** |
| Click a free time slot to start an appointment (Square) | Click an empty part of a column: New Appointment opens at that time and stylist | **Matches** |
| Processing time drawn as a faded segment (Fresha) | Hatched stretch inside the card, in the service's colour | **Matches** |
| Colour-coding appointments (Fresha) | Card tint by status, left stripe by service (a steady colour per service name) | **Matches in spirit** — the Fresha colour page was not read |
| Zoom / time-slot interval (Fresha) | Grid › Time slots: 5, 10, 15 or 30 minutes. The grid is drawn taller for finer slots, a faint line marks every slot, drags and resizes and a click on a free time step by the slot; kept per login on the server (`book_preference`), so it follows a person to another screen. Hours still stretch to hold early or late bookings | **Matches** (10/31, parity row 1) |
| Team order dragged by the user (Fresha) | Settings › The Book › Team order: drag the names (or use the arrows), saved once for the salon. The Book's columns, the stylist pickers (`/api/team/assignable`) and the stylists a client may choose online follow it; someone added later sits after those named; "Back to name order" clears it. A manager (owner, admin, manager) changes it; everyone else reads it | **Matches** (10/31, parity row 1) |
| Blocked time for a team member, recurring (Square personal events: assigned to a staff member, "Set repetition") | Blocked time per stylist or for the whole salon, with a reason. Repeat: daily or every N weeks, on chosen weekdays, until a date or for N times (`bookRepeat.ts`, on the company's clock so 12:00 stays 12:00 across daylight saving); a series can be removed from one block on ("this and later") | **Matches** (10/31, parity row 2) |
| Blocking is what removes booking availability; clients never see the event (Square) | Online booking never offers or takes a blocked time, and shows no reason | **Matches** |
| Blocked time types with a preset reason and a paid/unpaid mark (Fresha) | Settings › The Book › Blocked time types: name, colour, usual length, paid/unpaid. A block picks a type (its length fills in) or a free reason; the Book draws the type's colour | **Matches** (10/31, parity row 2) |
| Deleting a type does not remove blocks already made (Fresha) | A block keeps the type's name, colour and paid mark it was made with; deleting or renaming the type changes none of them | **Matches** (10/31, parity row 2) |
| What happens to appointments already inside new blocked time (neither page says) | They stay; saving the block says how many are inside | **Decision, noted** |
| Who can create them: owner and team members with appointments permission (Square) | Needs the same permission as booking (`schedule:create`) to make, `schedule:update` to change or remove. A stylist narrowed to their own chair blocks only their own; the whole-salon block is for those who see the whole book | **Matches** |
| Time off for the team, business closed periods (Fresha) | Time off menu: a stylist asks for her own, a manager approves or denies (a manager entering it for someone approves it), any length up to a year (a block stops at 14 days). Closed dates (a name, first and last day) shut every chair and online booking. Both are drawn on the Book (read-only), warn the desk before it books over them (it may book anyway), are refused online, and list the appointments already booked inside them when made or approved. Paid/unpaid carries to an hours report (`/api/book-blocks/hours`, shown on the Time off screen) | **Matches** (10/31, parity row 3). The online refusal of a *stylist's* time off shares its code with closed days; the test proves it for a closed day and for the desk, not for a stylist picked online |

## Decisions and limits to know

- **Time off and closed dates** need a manager: a seat that sees the whole Book and holds `schedule:update` (managers, admins, the owner). A stylist holds update but not read-all, so cannot approve her own; the front desk holds read-all but not update.
- **Off by default.** `book_grid` is registered not-ready (hidden). Until a salon is given it the Grid tab and "Block time" button do not exist, `/api/book-blocks` is closed, and the desk books exactly as before.
- Blocks cover only a stylist's **hands-on** time: a gap inside a colour may sit over a break.
- A visit with several services draws each service in its own stylist's column; dragging moves the whole visit.
- Cancelled and no-show appointments are not drawn (they free their time).
- Online booking: a block already stops the stylist's time being taken at the moment of booking (`booked`) and removes it from offered times (`busy`), so a block made after clients booked never cancels them.
- Proving tests (10/31): `salon-book-repeat.test.ts` (repeat arithmetic), `salon-book-block-types.test.ts` (types and repeat over the API — 5 of 6 fail on the old routes), `salon-block-type-form.test.ts`, `salon-time-off.test.ts` (its closed-day-online case fails without the online change).
- Proving tests: `apps/unified/tests/salon-book-blocks.test.ts` (fails without the change: no routes, no BOOK_BLOCKED, online time still offered) and `salon-book-grid.test.ts` (the grid's arithmetic). The drag-and-drop itself is not covered by an automated test — see "unverified" in the pull request.
