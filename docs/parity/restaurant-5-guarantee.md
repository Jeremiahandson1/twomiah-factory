# Restaurant (private events) 5 - Guaranteed-count cutoff

Feature id: `event_guarantee` (hidden, not ready). Test: `restaurant-event-depth.test.ts` ("#5 the guarantee cutoff").

Leader: Tripleseat guarantee / final count - https://tripleseat.com/features/proposals-contracts-beo/ ; https://support.tripleseat.com

| Leader capability | Ours | Mark |
|---|---|---|
| Venue sets days before the event the count is final | Setting, 0 = none, owner/settings right only | matches |
| Client reminded to confirm | One reminder, only in the window before the cutoff, never after | matches |
| Count locked after cutoff | Count and per-head lines locked; floor seats refused | matches |
| Manager override | Manager (invoices:update) with a reason of 3+ characters, kept on the event and in the audit log | matches |
| Billing at the guarantee, not the actual, if lower | Per-head lines cannot go down after cutoff without a reason | matches |
