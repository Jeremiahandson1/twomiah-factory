# Restaurant (private events) 3 - Website form into the event enquiry

Feature id: `event_web_enquiries` (hidden, not ready). Test: `restaurant-event-depth.test.ts` ("#3 the catering form goes into the event book").

Leader: Tripleseat lead form on your website - https://support.tripleseat.com/hc/en-us/sections/200821717-Setting-up-the-Lead-Form-on-your-Website ; lead forms - https://support.tripleseat.com/hc/en-us/sections/115002902667-Leads-Lead-Forms

| Leader capability | Ours | Mark |
|---|---|---|
| Website form creates a lead tied to a guest | Form with a real date opens an enquiry for that guest with head count and note | matches |
| Date, guest count, room preference captured | Date, head count, note | partly - no room picker on the form; staff choose the room (a guest-facing room picker would need live availability, which we are not building) |
| Never lose a lead | No date or an impossible date still becomes an ordinary lead; with the feature off it is a lead too | beats - nothing is dropped |
| Enquiry does not block the room | Enquiry holds no room | matches |
| Embeddable form code per campaign | Uses the restaurant website's existing form path | not doing - no per-campaign embed builder |

Parity: core reached; room choice on the form and campaign embeds are not built.
