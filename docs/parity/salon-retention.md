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
| Discounts in birthday / win-back messages (Fresha, Square) | **Not built.** Wording only; an offer would need a code or gift card — see #10 | **Not built** |
| Milestone / anniversary messages (Fresha) | No | **Not built** |
| Loyalty-tier updates (Fresha) | No (loyalty is its own screen) | **Not built** |

## Decisions and limits to know

- **Off by default.** The feature id `retention_sends` is registered not-ready (hidden). Until a salon is given it, the settings page is not in the menu and `/api/retention` refuses (feature off). Even with the feature, every message type is off until the owner switches it on, and **nothing from before that moment is ever sent** (a start date is stamped when a part is first switched on; old history is ignored).
- **One message a week at most** per client across rebook, birthday and win-back, and each thing once (a unique ledger row is claimed before sending, so a second pass or a restart cannot double-send).
- **Consent.** Texts need recorded consent and honour STOP; emails carry the unsubscribe link and skip unsubscribed contacts. **Decision for the owner:** clients booked by the desk have no text consent recorded unless they gave it, so they get email only until they agree to text.
- Sending runs on a 15-minute pass; quiet hours defer by sending nothing and writing nothing.
- Proving test: `apps/unified/tests/salon-retention.test.ts` (6) — off-by-default, permissions, quiet hours and preview, due-date rebook with consent/STOP/unsubscribed/old-history/idempotency, birthday + win-back + next-visit with cooldown, drips enrolling once. It fails without the change (no routes, no ledger).
- Screens (settings page, sequence "Starts" choice) are type-checked and built but **not click-tested in a browser**.
