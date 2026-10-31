# Restaurant (private events) 4 - Event calendar by room

Feature ids: `event_calendar` (hidden, not ready) and `event_hold_expiry` (hidden, not ready; hold end days, reminders and release). Tests: `restaurant-event-depth.test.ts` ("#4 the room calendar") and `restaurant-event-holds.test.ts`.

Leader: Tripleseat calendar and Perfect Venue calendar - https://help.perfectvenue.com/knowledge ; https://tripleseat.com/features/

| Leader capability | Ours | Mark |
|---|---|---|
| Calendar by room, month and week | Grid by room for a range, readable by any seat that can read events; month/week screens | matches |
| Holds on a date | Holds by hour: lunch and dinner can share a room, overlapping hours cannot; off, the day is one booking as before | matches |
| Waitlist for a held date | A guest can wait on a held hour; an open hour is refused; releasing offers it once, in order | matches |
| Calendar feed per room | Secret ICS link per room: no client details, no money; a new link kills the old | matches |
| Drag to move an event | The calendar has day, week and month views. An event is dragged to another day, room or (day view) hour, or moved with its Move button (keyboard and phone). A read-only check (`POST /api/event-calendar/move-check`) says before anything changes whether the move is refused (room held by another event on those hours, room missing, nothing changed, event cancelled) and warns (past day, room too small, waitlist, guarantee cutoff, a proposal already sent). The page shows it in an in-page dialog; "Move it" then makes the SAME edit the event screen makes (`PUT /api/events/:id`), so the overlap, hold and guarantee rules are one set of rules. Needs the right to change events | matches |
| Hold expiry on a timer with auto-release | A hold (a tentative event) can carry an end day: the venue's default (setting "A new hold is kept for", days) or its own on the event. A reminder goes to staff N days before it ends (setting), and optionally to the client. After the end day the hourly job releases it: it goes back to an enquiry, the room is free, the waitlist is offered the slot in order, and staff are told. A hold with a paid invoice is not released; it just loses its end day. Runs on the existing hourly job mechanism, on the venue's clock | matches |

Unverified: the original room calendar screens had never run in a browser. This time, headless Chrome 153 on the build server was driven (over its debugging port, by script) against the real app in-process on a test database (restaurant vertical, the web build served by the app). Done and seen: signed in as the owner; opened Room Calendar; went to the next week; the week grid showed The Cellar and The Loft with "11:00-14:00 Lunch" and "18:00-22:00 Dinner" and a Move button on each; pressed Move on Dinner and the in-page dialog opened with the live check ("That is where it already is" before a change); dispatched drag events (not a real mouse drag) from Dinner onto The Cellar's cell, the dialog opened with the warning "20 guests is more than The Cellar holds (12 at most)"; "Move it" moved Dinner into The Cellar's row (the grid refreshed itself). The console showed no errors. NOT seen: a real mouse drag, dragging in the day view by hour, the month view, the hold dialogs and the hold-expiry settings on screen, any touch device or phone, Safari or Firefox. The release and reminder jobs were run only by calling the passes in tests, never by the real hourly timer.

## Owner's check in a browser (calendar drag and holds)

Use a test venue, not a live one, with the features `event_bookings`, `event_spaces`, `event_calendar`, `event_guarantee` and `event_hold_expiry` on, two rooms (say The Loft and The Cellar, the Cellar smaller), and a test client.

1. Settings: Events > Event insights > Event settings. Set "A new hold is kept for" to 3 days and the reminder to 1 day. Save, reload, confirm both stay.
2. Make a confirmed lunch (11:00 to 14:00) and a confirmed dinner (18:00 to 22:00) in The Loft on a day next week, 20 guests each. Open Room Calendar, go to that week, and confirm both show in The Loft's row with a Move button.
3. Drag the dinner to another day in The Loft. A dialog asks "Move Dinner?" and shows the new day and "Move it". Cancel: nothing moved. Drag again and confirm: it moves.
4. Drag the dinner to The Cellar. The dialog warns the head count is more than the room holds. Confirm it moves anyway (the same as editing it) or cancel.
5. Open the Move button on the dinner, set its times to overlap the lunch in The Loft. The dialog says the room is already held by the lunch and "Move it" is disabled.
6. Switch to Day view; drag the dinner to a different hour row and confirm. Switch to Month view and confirm both events show.
7. Make a tentative event (a hold) in The Loft for a day next week. Its event page shows an amber box: "This hold is kept through" the day three days from now (the venue default), with a "Keep it through" date and Save. Change the date, save, reload and confirm it stuck; "Never lapse" clears it.
8. Join the waitlist for that room and hour from the calendar ("+ waitlist"), then keep the hold through today. The reminder email to staff goes the day before the end day (or at once if it is already inside the reminder window). On the first hourly pass after the end day has passed on the venue's clock (the day after), the hold goes back to an enquiry, the event page says the hold lapsed and the room was released, the first guest on the waitlist is offered the slot, and staff get a notice. A hold with a payment recorded is not released.
9. Sign in as a seat that cannot change events (a bartender): confirm events do not drag and there is no Move button.
