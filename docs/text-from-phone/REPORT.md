# Free "Text" from your own phone (2026-10-28)

Branch `cloud/text-from-phone`, rebased onto the current `engine` (b486abce2 at the time) and pushed only there. Items 1–2 (the button, the messages, the QR / "Open on this computer") were reported first; items 3–5 (the record, permissions, the remaining renders) were sent afterwards and are below.

## The record: "Text opened on your phone — not confirmed sent" (item 3)

When a message is chosen in the Text menu — the texting app opened on a phone, **or the QR dialog shown on a computer** — an `activity` row is written: `entityType` contact or lead, `entityId`, `action` `text_started`, `description` the exact words above, the chosen message in `metadata` (`{ message: 'ready', label: "We're on our way" }`), the person who pressed it as `userId`. Twomiah cannot know whether the text was sent, so the row says only what is known.
- **Server:** `apps/unified/server/crm/textActivity.ts`, mounted at `/api/text-activity` (feature `contacts`): `POST /contact/:id`, `POST /lead/:id`, `GET /contact/:id`.
- **The contact's Activity card** (`ContactDetailPage.tsx`) now shows the real activity rows — newest first, each with its time on the company's clock and who — above the existing Created / Updated lines, and reloads when a Text button on the page records a press. A system without the route (a template) keeps Created / Updated only.
- **What is kept of the message is its id and label, not its words.** An invoice or quote message carries the document's private `/d/<token>` link, which the quote routes deliberately keep from seats that do not administer quotes; the card is read by everyone who reads the contact. (A test checks no `/d/` reaches the table.) If you want the words kept anyway, say so.
- **Where it records:** contacts (the contact page, Tech view's customer, invoice and quote detail, roof job detail, and a booking that has a contact) and leads (the Lead Inbox). **Not recorded: home care Clients, and a booking with no contact** — a home care client is not a contact or a lead (its own table), and you asked for contact or lead. The button works there; it simply writes nothing. A template's button (no api registered) also writes nothing.
- The Lead Inbox still marks a `new` lead as contacted when a text is opened (as its old inline link did).

## Permissions on both sides (item 4)

- **Server:** the contact routes ask `contacts:read` — and the contact's own scope: a seat without `contacts:read-all` (a field seat) reads only the customers on its own jobs, and the contact answers 404 for the rest. The activity routes ask exactly that, through the **same function** (`ownContactScope`, extracted in `packages/tenant-backend/src/contacts/contacts.ts` and now used by both — one rule, no copy). The lead route asks `leads:read` (the Lead Inbox's own, `ownPermission`). Write and read both.
- **Screen:** `TextButton` is not drawn for a seat without `contacts:read` (a contact) or `leads:read` (a lead), when it records.
- **Tests** (`apps/unified/tests/text-activity.test.ts`, 10): the exact words; a row written with the message and the user; read back with its time; a lead recorded on the lead only; message words never stored; made-up message / no body / missing record refused, nothing written; **a field seat is refused the lead (403, nothing written); home care's caregiver seat (contacts:read withheld) is refused both the write and the read; a field seat refused a contact outside its jobs (404, read and write) and allowed it once the customer is on its job**; no sign-in 401; feature off: no route. `text-button.test.ts` (7, real DOM): hidden without the permission (contact and lead), the QR dialog records, a phone's sms: link records, a press with nothing to record on still works, a failing record never stops the text.

## Rendered (item 5) — all opened

Real server + browser, three tenants (contractor, roofing, home care), each seeded; phone = iPhone 13 emulation, desktop 1440; light and dark; one session per view. 63 images: page, menu open, and (desktop) the QR dialog, for Tech view, Lead Inbox, Booking detail, roof Job detail, a home care client, and the contact page with its Activity card (and a press recorded live: 14 → 15 rows). Text in the menu and dialog ≥ 4.5:1 in every view (measured in the browser). The folder keeps the key ones: `tech-view`, `lead-inbox`, `booking-detail`, `roof-job`, `homecare-client` (each a four-up: desktop light, desktop dark, phone light, phone dark, menu open), `homecare-client-desktop-menu`, `qr-dialog-tech`, `qr-dialog-lead`, and the two Activity cards.
Found and fixed in these renders: in home care's Clients **table** the menu opened inside the table cell and was **clipped** (seen only on the desktop table); the menu now opens fixed under the button, on every screen, and closes on scroll or resize. The phone's menu stays a bottom sheet.
Looked at and left: the Lead Inbox's phone layout squeezes the lead's name into a narrow column (the card's own layout, untouched); a few controls look dim in the dark booking page for a moment while it loads.

## Also changed, because a guard asked

- `check-unified-write-controls` flagged `main.tsx` for writing (`api.post`) with no permission question. The write now lives in the shared button's recorder (which asks `can(...)` where it is drawn); `main.tsx` only registers the api client (`registerTextApi`). Nothing in the guard was edited.

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

- Real server + browser (desktop light/dark, iPhone 13, Pixel 7): the menu, the dialog, the invoice and quote menus; no page errors; every text in the menu and dialog ≥ 4.5:1 in light and dark. The menu on a phone is a bottom sheet (an earlier drop-down ran off the screen edge — seen, fixed); on a desktop it is fixed under the button so a clipping table cannot cut it.
- Tests (no live API): `apps/unified/tests/text-sms.test.ts` (22: links per platform, encoding, device detection, messages and links, every vertical's words, one button everywhere) and `text-qr.test.ts` (4: every QR version 1–20 read back by `jsqr`, too-long refused, SVG scannable in dark mode).
- `check-unified-*.ts` all pass (types: 0 / 203 / 0 baseline); `check-shared-deps`; the templates' own frontend types (5 templates) pass; `bun run build:web` builds.

## Decisions to know

- **No QR library.** `packages/tenant-ui` is vendored into every CRM template, which installs only what its own manifest declares, so a dependency here would break every template. `qr.ts` is a small encoder (byte mode, level M, versions 1–20, up to 666 bytes; longer is refused, never cut). `jsqr` is a dev-only dependency of `apps/unified` for the test.
- The number is sent as typed (digits and a leading `+`); it does not add a country code (not guessed).
- Screenshots in this folder: desktop menu light/dark, QR dialog light, invoice QR dark, invoice menu, iPhone and Android menus. Rendered since: Tech view, Lead Inbox, Booking, roof Job, a home care client (see above).
