# Restaurant (private events) 1 - Proposal, e-signature, online acceptance

Feature ids: `event_proposals` (hidden, not ready) and `event_contracts` (hidden, not ready: contract templates and several signers). Tests: `apps/unified/tests/restaurant-event-depth.test.ts` ("#1 proposal, choices, e-signature, booked") and `apps/unified/tests/restaurant-event-contracts.test.ts` (16 tests: templates, merge fields, signers and their order, the PDF, booking on the last signature).

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
| Contract templates with merge fields | Per-venue templates (page "Event sources and settings" > Contract templates) with merge fields for the client, date, room, head count, menu, totals, deposit schedule and the guarantee and minimum terms; one template is chosen per event on the proposal. The contract is frozen into the proposal when it is sent, so what the client signs is what was sent | matches for the fields and flow described (not compared field by field with Tripleseat's or Perfect Venue's editor, which was not re-read for this change) |
| Several signers, in an order | The proposal lists its signers in a send order (client, a second client signer, the venue's countersignature); each signs with a drawn signature, typed name and consent tick, and the time, address and a fingerprint are kept. Each signer is emailed when it is their turn and cannot sign before the one ahead of them; the client's choices lock after the first signature; the event books only when the LAST signer signs | matches |
| PDF copy with every signature | The PDF carries the contract and a signatures page with each signer's drawn signature, name, time and consent | partly - proven by reading the PDF's text and counting its embedded images in a test; the pages have not been looked at by a person |
| Deposit taken at signing on the same screen | After the signature the same proposal page takes the deposit (see restaurant-2-payments.md, "Deposit at signing") | matches |

Not built: reminders to a signer who has not signed (each signer is emailed once, when it is their turn), and a venue-wide default signer list (the list is set on each proposal). Both a drawn signature and a typed name are required; neither alone signs.

Unverified: nothing here has been seen in a real browser or on a real phone; the signature pad, the contract page and the signers editor are exercised through the API only.

Parity: reached for the core flow and for contract templates, several signers and the deposit at signing; the "not built" line above is a named gap, not hidden.
