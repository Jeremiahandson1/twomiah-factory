# Restaurant (private events) 3 - Website form into the event enquiry

Feature ids: `event_web_enquiries` (hidden, not ready) and `event_form_campaigns` (hidden, not ready; the room picker and the per-campaign forms). Tests: `restaurant-event-depth.test.ts` ("#3 the catering form goes into the event book"), `restaurant-event-form.test.ts` (restaurant) and `bar-event-form.test.ts` (bar).

Leader: Tripleseat lead form on your website - https://support.tripleseat.com/hc/en-us/sections/200821717-Setting-up-the-Lead-Form-on-your-Website ; lead forms - https://support.tripleseat.com/hc/en-us/sections/115002902667-Leads-Lead-Forms

| Leader capability | Ours | Mark |
|---|---|---|
| Website form creates a lead tied to a guest | Form with a real date opens an enquiry for that guest with head count and note | matches |
| Date, guest count, room preference captured | Date, head count, note, and with `event_form_campaigns` on a room picker on the website's catering and parties forms: each room with its capacity, and once a date and times are typed whether it looks free (no hold on those hours; it holds nothing) and whether the head count fits. The guest's choice is stored as the event's room and times on the ENQUIRY, which holds nothing; staff still confirm the hold | matches |
| Never lose a lead | No date or an impossible date still becomes an ordinary lead; with the feature off it is a lead too | beats - nothing is dropped |
| Enquiry does not block the room | Enquiry holds no room | matches |
| Embeddable form code per campaign | Settings > Event insights > "Enquiry form for each campaign": a named campaign with a lead source gets a link (`/api/event-form/<token>`) and a one-line embed snippet (`embed.js`, which frames the same page; any https page may frame it). Every enquiry that comes through it is stamped with the campaign and its lead source, so the source report counts it; a new link can be made, a campaign deleted (enquiries keep their source). Same for a bar's party form | matches |

Parity: reached. The form shows a room as "looks free" from the book as it is at that moment; two guests can both see it free and both enquire, because an enquiry holds nothing (that is the rule, not a gap).

Unverified: the form page and the embed were exercised only through the app's own HTTP layer in tests. The embed was not placed on a real third-party page and the website's picker script was not run in a real browser.
