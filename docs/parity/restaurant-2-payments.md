# Restaurant (private events) 2 - Deposit and balance reminders, pay link, card on file

Feature id: `event_payment_automation` (hidden, not ready). Test: `restaurant-event-depth.test.ts` ("#2 reminders, a pay link per instalment, a card on file").

Leader: Perfect Venue scheduled payments / autopay - https://help.perfectvenue.com/knowledge/how-to-schedule-payments ; accept payments - https://help.perfectvenue.com/knowledge/how-to-accept-payments ; Tripleseat payments - https://tripleseat.com/features/

| Leader capability | Ours | Mark |
|---|---|---|
| Payment schedule of deposit and balance instalments | Existing instalments on the event | matches |
| Reminder before, on, and after the due date | Before (days set by venue), on the day, once after; each sent once; not to a client who unsubscribed | matches |
| A pay link per instalment | One link per instalment charges what is still owed on that instalment | matches |
| Card on file charged automatically on due date | Client leaves a card with consent; Stripe stores it, not us; charged on the due date, once a day | matches |
| Failed payment handling | Decline recorded, client told with a way to pay, not retried the same day, stopping removes the card | matches |
| The venue's own Stripe | Every call carries the venue's connected account; a test proves the platform account is never used | matches |
| ACH / bank transfer, check recording | Cards only here; checks and cash are recorded by hand as before | not doing - card is what the venue's Stripe is connected for |

Unverified: only against a fake Stripe. No live call has been made.
