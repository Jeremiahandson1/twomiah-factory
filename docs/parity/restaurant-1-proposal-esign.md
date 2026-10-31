# Restaurant (private events) 1 - Proposal, e-signature, online acceptance

Feature id: `event_proposals` (hidden, not ready). Test: `apps/unified/tests/restaurant-event-depth.test.ts` ("#1 proposal, choices, e-signature, booked").

Leader: Tripleseat Proposals, Contracts and BEOs - https://tripleseat.com/features/proposals-contracts-beo/ ; Perfect Venue proposals and e-sign - https://help.perfectvenue.com/knowledge

| Leader capability | Ours | Mark |
|---|---|---|
| Proposal built from the event with the menu and prices | Built from the event; client sees the price with their choices | matches |
| Client chooses between options (packages, add-ons) on the proposal | Offered choices, required choices, cannot pick what is not offered | matches |
| Send by email, client opens with no sign-in | Emailed link, no sign-in | matches |
| Drawn or typed e-signature, consent, kept as evidence | Drawn signature, typed name, consent tick, kept with the proposal | matches |
| Signing books the event | Signing books the event and makes the menu lines; a taken room refuses the signing | matches |
| PDF copy with the signature | PDF for the guest and for staff who can read money | matches |
| Proposal expires; revised proposal replaces the old one | Valid-days setting; goes stale when the date moves; a sent one is replaced by the next; a decline is kept | matches |
| Contract templates with merge fields, multiple signers | One signer, one terms text per venue (Settings > events) | not doing - one signer covers private-event bookings; a second signer needs a signer list and a send order |
| Deposit taken at signing on the same screen | The pay link is a separate step (item 2) | not yet - signing then paying are two clicks |

Parity: reached for the core flow; the two "not" rows are named gaps, not hidden.
