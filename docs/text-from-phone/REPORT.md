# Free "Text" from your own phone (2026-10-28)

Branch `cloud/text-from-phone`, from `engine`. Pushed only there. The brief I received ended at item 2 of its "Do" list; I built items 1–2 and the QR / "Open on this computer" behaviour from the goal paragraph. **Not built, because it was not asked for as a task: recording a text in the contact's Activity.** There is no way to know a text was actually sent (we only open the user's app), so that needs your decision.

## What it is

One shared component, `TextButton` (`packages/tenant-ui/src/text/`), used everywhere — no copies (a test fails if any screen builds its own `sms:` link; the old inline "Text" link in the Lead Inbox was replaced by it).

- **On a phone or tablet:** pick a message → the `sms:` link opens Messages / the default texting app, number and message ready.
- **On a computer:** pick a message → a dialog with a **QR code** (scan with any phone camera: opens the same pre-filled text), the message, **Copy message**, and **Open on this computer**, with the plain note: "Works on a Mac signed in to the same Apple ID as an iPhone. On Windows it depends on Phone Link being set up — if nothing happens, use the code instead." Nothing is promised for Windows. It also says it is sent from the user's own phone and number — not through Twomiah.
- Paid automatic texting (Settings › Texting, Twilio, the contact's SMS thread, the Messages inbox) is **not touched**.

## The sms: link (researched, then run)

| device | link |
|---|---|
| Android and the standard (RFC 5724) | `sms:+1555…?body=<percent-encoded>` |
| iPhone / iPad (iOS 8+; the old `;` form no longer works) | `sms:+1555…&body=<percent-encoded>` |
| the QR code (the owner's phone is unknown) | `sms:+1555…?&body=…` — the form vendors recommend for "both" |

Sources: RFC 5724 (grammar), the West Wind write-up and its comments (iOS 7 `;`, iOS 8 `&`, Android `?`), and several vendor guides for the combined form. Body is always percent-encoded UTF-8, and `! ' ( ) *` are encoded too (iOS is the stricter reader). A blank text is just `sms:<number>`. iPadOS in desktop mode (reports itself as a Mac with a touch screen) is treated as an iPad.
**Not verified on a real device by me** — I have no phone here. Proved: in an iPhone 13 and a Pixel 7 emulation the app navigates to exactly the iOS / Android form above; the QR, read back by a decoder from a real browser screenshot, equals the expected link (short message and the long invoice message). The combined `?&body=` form is the one I could only take from the vendors' word: **please try one scan on an iPhone and one on an Android.** The dialog tells the user what to do if the message arrives empty (copy it from the dialog).

## The messages (small menu)

- **A blank text** — always.
- **Your invoice / Your quote** — only where the record has its real customer link (`/d/<token>`, the one every quote and invoice email carries; the token exists once it has been sent, and a quote's is withheld from seats that do not administer quotes). "Hi Sam, Acme here. Here is your invoice #INV-1042: https://…/d/…". On the admin's own address (`app.<domain>`) the app redirects a `/d/` link to the business's domain.
- **A trade "ready" message**, from a new `readyText` in each vertical's own vocabulary (it states no fact — no time, price or number; a test holds that): contractor, field service, landscaping, roofing, basic "We're on our way"; home care "We're on our way for your visit"; vet "Your pet is ready for pickup"; salon and restaurant "We're ready for you"; bar "Your table is ready"; store "Your order is ready for pickup"; RV "Your unit is ready for pickup". **These are my wording for you to approve** — only the RV/store and field-trade examples were yours.
- Greeting: "Hi Sam, Business here. …" (first word of the name; the business name from the signed-in company; left out when unknown).

## Where it appears (each decided, and why)

Added — a customer / client / lead number: Contact detail (phone and mobile), Lead Inbox, Tech view (the job's customer), Invoice and Quote detail (next to the client; this is where the document messages show), Booking detail, roof Job detail (the job's contact), home care Clients (list and table) and the caregiver's client card (the client's own number).
Not added, and why: crews' foreman, adjusters (roof), caregivers, caregiver applicants and their references, referral sources, emergency contacts, EVV/office numbers — not a customer's number; the client portal's caregiver and company numbers (the customer is the viewer); the Messages inbox (that is the paid texting page). A test pins both lists.

## Proof

- Real server + browser (desktop light/dark, iPhone 13, Pixel 7): the menu, the dialog, the invoice and quote menus; no page errors; every text in the menu and dialog ≥ 4.5:1 in light and dark. The menu on a phone is a bottom sheet (an earlier drop-down ran off the screen edge — seen, fixed).
- Tests (no live API): `apps/unified/tests/text-sms.test.ts` (22: links per platform, encoding, device detection, messages and links, every vertical's words, one button everywhere) and `text-qr.test.ts` (4: every QR version 1–20 read back by `jsqr`, too-long refused, SVG scannable in dark mode).
- `check-unified-*.ts` all pass (types: 0 / 203 / 0 baseline); `check-shared-deps`; the templates' own frontend types (5 templates) pass; `bun run build:web` builds.

## Decisions to know

- **No QR library.** `packages/tenant-ui` is vendored into every CRM template, which installs only what its own manifest declares, so a dependency here would break every template. `qr.ts` is a small encoder (byte mode, level M, versions 1–20, up to 666 bytes; longer is refused, never cut). `jsqr` is a dev-only dependency of `apps/unified` for the test.
- The number is sent as typed (digits and a leading `+`); it does not add a country code (not guessed).
- Screenshots in this folder: desktop menu light/dark, QR dialog light, invoice QR dark, invoice menu, iPhone and Android menus. Not rendered: Tech view, Lead Inbox, Booking, roof Job, home care screens (same component; compiled and type-checked).
