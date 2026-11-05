# Salon #9 — Automatic retention messages

## Sources (help-centre pages actually read)

- Fresha — Automated messages overview: https://www.fresha.com/help-center/knowledge-base/marketing/101299-automated-messages-overview
- Square Marketing — automations (product page): https://squareup.com/us/en/marketing
- Square Community — Winback lapsed customers (a community reply, **not** official documentation): https://community.squareup.com/t5/Customer-Engagement/Winback-lapsed-customers/m-p/807680

What those pages say, so the table below claims nothing more:

- Fresha lists a rebook reminder "after their appointment", a win-back for clients who "haven't visited for a while" (no day count given), birthday and milestone messages, and a thank-you after each visit. The page gives no channel, no quiet hours and no opt-out wording; it links to "Enable automated messages" / "Update automated messages" pages that were **not** read.
- Square says its automations go by email or text, can "reengage customers who haven't shopped with you after a set period of time", and can wish clients a happy birthday. Its opt-in list is built automatically. The community reply describes win-back as a window the owner sets (example: 60 days) and says that automation sends email.
- Vagaro, Boulevard and GlossGenius: searches returned reviews and third-party blogs, no help-centre page. Nothing below is claimed against them.

## What they do, and where this stands

| Capability | Here | Status |
|---|---|---|
| Rebook reminder (Fresha: "after their appointment") | Sent **on the day the client is due back** for the service (the rebook rhythm already on the Service Menu), with the booking link. Not sent to anyone who already has an appointment booked | **Matches** (due-date timing is stricter than "after") |
| Win-back after a lapse; owner sets the window (Square: 60-day example) | Owner sets the number of days (30–730). Sent once when a client crosses that line; not to a client with a future booking | **Matches** |
| Birthday message (Fresha, Square) | On the day, once a year, for clients with a birthday on their chart | **Matches** |
| Thank-you / post-visit message (Fresha) | The existing review request already does this. New here: a "book your next visit" prompt, sent a little after a visit is completed | **Matches** |
| Owner can edit the wording (Fresha links to an "update" page, not read) | Optional own words per message, with `{firstName}`, `{salon}`, `{service}`, `{link}`; empty uses the standard message | **Matches** |
| Text and email (Square) | A text goes only to a client who agreed to be texted and never to one who replied STOP; otherwise an email with the unsubscribe link; no channel means a logged skip | **Matches** |
| Quiet hours | Owner-set window by the salon's clock. Nothing goes in it; it goes out when it ends | Beyond what the pages show |
| Follow-up sequences started by a visit or a lapse | A completed visit, or a lapse, can start the salon's own follow-up sequences (new "Starts" choice on a sequence); enrolled once | **Matches** the idea of Square's automations |
| Preview before switching on | "Who would be messaged now?" lists names and channel and sends nothing | Beyond what the pages show |
| Discounts in birthday / win-back messages (Fresha, Square) | Birthday, win-back, milestone, anniversary and tier messages can each carry a **single-use code of the client's own**: a dollar or percent amount off, good for the number of days the owner sets (counted on the salon's calendar), put into the message ahead of the booking link (or where the owner writes `{offer}`). The desk types it beside the sale (web invoice side panel, and the phone's invoice screen); the server checks it is that client's, unspent and in date, shows what it takes off, and spends it in the same statement that checks it is unspent. One code per sale; a message that did not go out voids its code. The Automatic messages screen reports codes sent, used, still open, ran out, what they took off and the sales they were on | **Matches** |
| Milestone / anniversary messages (Fresha) | **Milestone:** after the visit that makes a client's Nth completed visit, N from the owner's list (default 5, 10, 25), once per N. **Anniversary:** on the day each year a client first came in (first completed visit), from the first year on | **Matches** |
| Loyalty-tier updates (Fresha) | When a client moves up a tier (earned by a visit, or lifted by a hand correction) they are sent a message naming the tier, once per tier; needs the loyalty program on | **Matches** |

## Decisions and limits to know

- **Off by default.** The feature id `retention_sends` is registered not-ready (hidden). Until a salon is given it, the settings page is not in the menu and `/api/retention` refuses (feature off). Even with the feature, every message type is off until the owner switches it on, and **nothing from before that moment is ever sent** (a start date is stamped when a part is first switched on; old history is ignored).
- **One message a week at most** per client across rebook, birthday, win-back, milestone, anniversary and tier messages (the next-visit prompt is outside the cap, as before), and each thing once (a unique ledger row is claimed before sending, so a second pass or a restart cannot double-send).
- **Consent.** Texts need recorded consent and honour STOP; emails carry the unsubscribe link and skip unsubscribed contacts. **Decision for the owner:** clients booked by the desk have no text consent recorded unless they gave it, so they get email only until they agree to text.
- Sending runs on a 15-minute pass; quiet hours defer by sending nothing and writing nothing.
- Proving test: `apps/unified/tests/salon-retention.test.ts` (6) — off-by-default, permissions, quiet hours and preview, due-date rebook with consent/STOP/unsubscribed/old-history/idempotency, birthday + win-back + next-visit with cooldown, drips enrolling once. It fails without the change (no routes, no ledger).
- Screens (settings page, sequence "Starts" choice) are type-checked and built but **not click-tested in a browser**.

## Row 20 (offers and more automatic messages): limits to know

- **Where a code can be typed:** the web invoice screen and the phone's invoice screen (salon, `retention_sends` on). A code is for the client it was sent to; a sale with no client on it is refused until the client is put on it. The discount is taken off the whole sale (services and retail); it is not limited to a service. An amount code larger than what is left on the sale takes what is left and says so.
- **A code cannot be taken back off a sale** once applied, the same as a loyalty reward today; the code stays spent.
- **One code per sale.** Codes do not combine with each other (they do with a loyalty reward or a gift card).
- **A tier message needs a move seen after this was built:** tier moves are recorded when a visit is completed or a balance is corrected by hand, so a client already in Gold before then is not messaged. The welcome-bonus points a new member gets can cross a tier without a message.
- **The milestone counts completed appointments.** A visit with several services booked as several appointments counts each.
- **Anniversary dates** run from the first completed appointment on the book, not from the day the contact was created.
- **Consent, quiet hours, weekly cap and the ledger** are the existing ones; the new messages join the cap and the ledger is unique per client, kind and event (milestone: the N; anniversary: the year; tier: the tier).
- Proving tests: `apps/unified/tests/salon-offers.test.ts` (20; 14 fail with the retention and loyalty changes taken out, the other 6 are pure rules in the new file) and `tests/mobile/offer-code.test.ts` (13). Neither screen was seen in a real browser or on a real phone.

