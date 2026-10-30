# Restaurant (private events) 6 - F&B minimums by day and season, shortfall as invoice line

Feature id: `event_minimums` (hidden, not ready). Test: `restaurant-event-depth.test.ts` ("#6 food and beverage minimums").

Leader: Tripleseat dynamic minimums - https://tripleseat.com/blog/embrace-the-power-of-dynamic-minimums-for-events/

| Leader capability | Ours | Mark |
|---|---|---|
| Minimums by day of week | Rules by day; a weeknight falls to the any-night rule | matches |
| Minimums by season / date range | Season rules; the most specific rule that fits applies | matches |
| Per-room minimums | Rules belong to the room (each room has its own rules, with the room's single minimum as the fallback) | matches |
| Shortfall charged | Own invoice line; removed when spending reaches the minimum | matches |
| Tax on shortfall | Taxed or not by a venue setting (state rules differ) | matches |
| Staff without money rights cannot see the figure | Refused in a test | matches |
