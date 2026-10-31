# Bar 10 - Shift swaps and availability

Feature ids: `bar_availability`, `bar_shift_swaps` (hidden, not ready). Tests: `apps/unified/tests/bar-shift-swaps.test.ts` (8), `bar-swap-depth.test.ts` (7); phone: `tests/mobile/bar-shift-requests.test.ts`.

Leader: 7shifts availability - https://kb.7shifts.com/hc/en-us/articles/33383119814163 ; shift trading - https://kb.7shifts.com/hc/en-us/articles/4417514302995

| Leader capability | Ours | Mark |
|---|---|---|
| Staff set weekly availability, manager approves | Yes: mine, list, per-person decision | matches |
| Warning when a shift is outside availability | Flag on the schedule and a warning on the shift | matches |
| Swap / drop / pick-up with manager approval | Request, claim, accept/decline, cancel; manager approves | matches |
| Notifications | Email through the venue's mail | matches |
| One-time (dated) availability | One day on its own (cannot work, free any time, or only between two times), asked by staff and approved by a manager, or set by a manager; it replaces the weekly pattern for that date and drives the same schedule warning | matches |
| Setting to skip manager approval | A manager setting for swaps and for pick-ups separately; with approval off the move happens as soon as the last person says yes, still checked for clashes, days off and lapse (refused, not half done) | matches |
| Swap expires before its shift | Hourly job ends open requests whose shift is inside the manager's window (0 to 72 hours before the start; 0 = when it starts); a request also cannot be made or claimed inside it | matches |
| Swap cancels itself when the schedule is republished with that shift changed | Publishing re-checks every live request against the shift's day, times and person; a changed one becomes "Cancelled: the schedule changed" and the people are told | matches |
| Phone screens | Shifts > My availability (change a day of the week, free any time), One-day changes, Swaps and pick-ups (take, say yes or no, take back), give away or swap from a shift, and for managers Swaps to decide, Availability to approve, One-day changes to approve. All through the offline queue to the same routes as the web | partly - the swap RULES (the approval switches and the lapse hours) are set on the website only; not seen on a real phone |
