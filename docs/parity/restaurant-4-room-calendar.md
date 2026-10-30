# Restaurant (private events) 4 - Event calendar by room

Feature id: `event_calendar` (hidden, not ready). Test: `restaurant-event-depth.test.ts` ("#4 the room calendar").

Leader: Tripleseat calendar and Perfect Venue calendar - https://help.perfectvenue.com/knowledge ; https://tripleseat.com/features/

| Leader capability | Ours | Mark |
|---|---|---|
| Calendar by room, month and week | Grid by room for a range, readable by any seat that can read events; month/week screens | matches |
| Holds on a date | Holds by hour: lunch and dinner can share a room, overlapping hours cannot; off, the day is one booking as before | matches |
| Waitlist for a held date | A guest can wait on a held hour; an open hour is refused; releasing offers it once, in order | matches |
| Calendar feed per room | Secret ICS link per room: no client details, no money; a new link kills the old | matches |
| Drag to move an event | Not built | not doing - move by editing the event; dragging needs an overlap check UI we have not written |
| Hold expiry on a timer with auto-release | A hold is released by staff; no new timer was added by this work | not doing - not built here |

Unverified: the screens build; no browser run against real data.
