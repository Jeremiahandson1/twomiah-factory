# Phone app design — round 1

Status: **for the owner's approval.** Nothing here changes the store app: the mock-ups live in a development-only route and a test
proves a store build cannot reach them. Screenshots are in the review pack (not in the repo). The map this plan is built on is
[PARITY.md](PARITY.md), generated from the desktop's own menus, permissions and dashboards (`bun apps/unified/scripts/mobile-parity.ts`).

## What the map found

The desktop menu is built per business type and per seat. For the seven types the phone serves, a new business is offered:
contractor 67 menu items, basic 48, field service 52, landscaping 55, roofing 32, home care 67 (plus a separate caregiver view of
10 pages), RV dealership 45. The phone has a screen for about 6–9 of each. A field tech on a contractor account is shown 32 of the
67 on the desktop, so More has to be a real menu, not a short list.

Desktop dashboards are not one shape: contractor, basic, field service and landscaping share one tile set (up to 6 tiles; a tile is
dropped when the seat cannot open the page it counts); roofing's home is the pipeline board; home care has an office overview
(8 stat tiles plus alert panels) and a separate caregiver day view; the dealership has its own.
**The desktop gives owner, admin and manager the same tile set** (6 on a contractor), viewer 5, staff 2. "Each staff level has its
own tile count" is true on the desktop only for staff and viewer, so the phone's homes for owner and manager differ in what they
offer to *do* (quick actions) rather than in tile count. If the owner wants manager to see fewer tiles, that is a desktop change
first, because the phone follows the desktop.

## Decisions, in plain words

**Home layout.** One screen, always in this order: who and where (greeting, business, seat), what needs me (tiles), what can I start
(four quick actions), what is next (today's work), what changed (recent quotes and invoices, only for seats allowed to see money).
Tiles are two across, big numbers, full-phrase labels that wrap instead of being cut off.

**A tile is a button, and looks like one.** Every tile has a chevron badge in its corner, sinks and darkens while pressed, and is
read aloud as "Jobs today: 6. Opens the 6 jobs scheduled today." A tile opens exactly the list it counts, with a banner saying
which tile it came from and the same number in the list header (see the Jobs and Invoices mock-ups). A last odd tile spans the full
width so nothing looks missing.

**Per-seat homes.** Built from the same rule as the desktop dashboard: a tile appears only if the seat could open what it counts.
Owner/manager (contractor) get 6 tiles, money panels and quick actions to sell and collect; field staff get a clock-in card on top,
2 tiles, quick actions for photos and notes, and "Your day". Roofing shows the pipeline stage by stage, with dollar values only for
seats that may see money. Home care office seats get a "needs attention" list (coverage gaps, no-shows, incidents due) above the
tiles; a caregiver gets their next visit, clock in, and today's visits. Home care wording and icons never imply medical care
(visits, tasks, clients; no pulse or heart icons — the current app's "Active Visits" pulse icon should go in the rebuild).

**Bottom bar.** Five slots, "More" last, the active one marked by colour *and* a filled icon *and* a bar above it. Alerts moved
to a bell in the header so a tab is not spent on them. No Leads tab (owner's rule): leads are reached from the New leads tile,
the quick action, and More › Sell.

**More menu.** The same menu the desktop shows that seat (same permissions, same switches), but grouped by what the person is
doing — Sell, Work, Projects, Money & reports, Customers, Equipment & records, Business & website, Help — instead of the
desktop's 36-item "Business" list. A search box finds any page. A row with a chevron is a phone screen; a row marked "Web page"
opens the real desktop page inside the app, already signed in, until that page is built natively. Counts show how many pages are in
each group. A field tech sees only their 32.

**Look.** Built on the existing theme (one theme, not two): the same light and dark grounds, the business colour for fills,
bars and the active tab, and a lightened/darkened shade of it only where it is used as *text*. Added roles the theme lacked: a quiet
text colour that really reads (the old muted grey is 2.6:1 on white), status colours that work as text and as fills, and soft tints
for badges and icon discs. Status is never colour alone (badges carry words and, where it matters, an icon). A mid-tone business
colour that cannot carry white or dark text at 4.5:1 (olive is the example the test found) gets a darker shade of the same hue on
buttons only.

**Accessibility floors (tested).** Every button, chip, tab and row is at least 44 points; all text is at least 4.5:1 and control
edges 3:1 in light and dark, for 14 different business colours; text scales to 130% and stops (checked on every mock-up: nothing
clipped, the bottom bar grows); every control has a spoken label; animations stop when the phone's setting says so; the sheet
traps screen-reader focus.

## Phase plan

Until a page is native, More opens the real desktop page inside the app (signed in), so on day one of the rebuild **every** menu item
is reachable.

| Phase | Screens | Notes |
|---|---|---|
| **A** — daily work | Home per seat · Leads list and detail · Jobs list (with tile filters) and detail · Schedule (day) · Contacts · Quotes · Invoices list/detail with **Record payment** and **Send invoice** · Time clock · Photos on a job · Messages · Home care visits and shifts | Roughly 10–12 menu items per trade (PARITY.md). The mock-ups show these. |
| **B** — projects and estimating | Projects · Bids · Change orders · Daily logs · Punch lists · Inspections · Price book · Reports and job costing | 1–9 items per trade. |
| **C** — the rest that works on a phone | Expenses, documents, equipment, fleet, inventory, tasks, agreements, warranties, reviews, bookings, support, team, home care office pages (care plans, compliance, hiring) | Largest group; built in order of use. |
| **D** — desktop only (with reasons) | Website builder pages and domain, audit log, geofence set-up, email-inbox and integration set-up, Gantt, takeoffs, AIA forms, bulk billing/payroll runs, the Exterior Visualizer | The phone links to the web page; set-up and wide-canvas work stays on a computer. |

Counts per trade are in the PARITY.md summary table and change when the desktop does.

## Not changed on purpose

Salons, restaurants, bars, stores and vets still open the "use the website" screen (`verticals.ts`, `store/listing.md` and their
tests are unchanged). Round 2 below is a design only: the mock-ups are dev-only (`/design-preview`), and nothing reaches a store build.
The parked `crm-automotive` template is untouched.

# Round 2 — salon, restaurant, bar, store and vet (design only)

What every one of these trades has in common, in plain words:

- **The phone is never a till.** No card is taken, no sale is rung, no money moves. Register, Kiosk, card readers, refunds, gift cards
  and payment and carrier keys are phase D — left out of More altogether, not even opened in the in-app browser — and Record payment is not offered anywhere in these five (restaurant: only a manager's "money
  already received", if the owner agrees — see its questions).
- **Each trade has its own dashboard**, and PARITY.md now reads it (it used to show the jobs dashboard for them, which was wrong).
  A tile shows when the seat's permission allows it; a money figure the server left out is **not drawn** — never "$0".
- **The tile opens exactly what it counts**, with the server's own statuses, and a short banner ("To fulfill · 7") says so. Where
  the server cannot list what a tile counts yet, this document says "needs a server change", and the tile waits for it.
- **Each trade's front-line seat** has its own home and bar. Owner, admin and manager share one home and one bar (as in round 1).
- Everything is in the business's colour with the ink rules; copy uses they/them for people; More is grouped and searchable, and any
  page that is not native opens in the private in-app browser.

## Salon, barber and spa

**What the desktop does.** 36 menu items: A 5, B 5, C 10, D 16. A = Dashboard, The Book, Rebooking, Clients, Messages. B = Invoices,
Time, Lead Inbox, Memberships, Loyalty. The salon's own dashboard has a *Due to rebook* banner and four tiles (Clients, Appointments
today, Services this month, Members); it is not the jobs dashboard.

**What makes the phone different.** The chair is the unit of work: the book for the day, the client's chart (allergies, patch test,
the last formula), and a rebooking list that is the salon's money engine. The stylist logs the service and the formula from the chair.

| Seat | Home | Bottom bar |
|---|---|---|
| owner · admin · manager | Due-to-rebook banner; Appointments today (63 in the next 7 days); Clients; Members; a "Services this month" *line* (the desktop has no list behind it, so it is not a tile) | Home · Book · Clients · Rebook · More |
| **Stylist** (staff) | Appointments today (their own); Due to rebook; Clients; quick actions Check in · Log a service · Text a client; "My day". No money. | Home · My day · Clients · Messages · More |
| Front Desk (viewer) | Same tiles; reads only — cannot check in or text (the desktop withholds those) | Home · Book · Clients · Sales · More |

**Phase A screens:** The Book (day; check in, move, complete, no-show, cancel — each asks first) · Client chart · Log a service ·
Rebooking (pick clients, confirm "Text 3 clients") · Clients · Messages · Members (read).

**Careful:** allergy and patch-test notes are the salon's own words, shown at the top; nothing says "safe" or "cleared". Cancel after
complete, Complete, and a bulk Send Text all ask first. No card taking.

**Needs a server change before the tiles are honest:** the appointments list cannot ask for "live" (not cancelled or no-show) so
the tile and list can differ; "Services this month" has no list; the Members call runs a billing pass when read; the money keys
(`services` price lines, recent-services price) reach the stylist; with "stylists see their own book" on, the tiles count the whole
chair but the list is narrower; the rebooking list ignores a future appointment's status and uses a UTC date.

**Questions for the owner**
1. May the Stylist see dollar amounts (a service's price)? *Recommend no:* the desktop leaks them today; the phone hides them and the server should too.
2. May the Front Desk check clients in from the phone? *Recommend yes*, which needs the desktop to give that seat `schedule:update` first; the phone follows the desktop.
3. Should "stylists see their own book only" be on? *Recommend leave it a per-salon choice*; the phone just follows it.
4. Is the time clock (Time) wanted on the phone for stylists? *Recommend yes, later (phase B).*
5. Do Memberships and Loyalty show at checkout on the phone? *Recommend not yet* — they stay on the website until the checkout is designed.

## Restaurant, caterer and event venue

**What the desktop does.** 36 items: A 7, B 5, C 6, D 18. A = Dashboard, Events, Invoices, Messages, Lead Inbox, Tonight, Menu (the 86
switch). This is **private events** (inquiry → tentative → confirmed, with deposits and the banquet event order), not a POS. Its home is
the bar's Tonight strip over the events dashboard.

**What makes the phone different.** The product is the **banquet event order in a pocket**: allergy alert first, the guaranteed guest
count, the run of show filtered to a department, and a tap to call the client. The floor reads; the office decides. The floor copy has
no prices for anyone.

| Seat | Home | Bottom bar |
|---|---|---|
| owner · admin · manager | Payments overdue banner (money); Today's events\*; Open inquiries; Next 30 days; Confirmed; New leads\*; a "Menu value ahead" money line; Coming up; Payments due | Home · Events · Messages · Invoices · More |
| **Staff** (captain) | Today's events\*; Next 30 days; the Tonight strip (when switched on); Coming up. No money, no inquiries. | Home · Events · Tonight · 86 board · More |
| Viewer | Payments overdue, Open inquiries, Next 30 days, Confirmed; read-only | Home · Events · Invoices · Spaces · More |

\* new on the phone (the desktop dashboard lacks them); they need one shared condition on the server.

**Phase A screens:** Events list (Today · Next 30 days · Inquiries · Confirmed) · Event file · **Banquet event order** (from the event's
data, not the printable page, which carries prices) · Invoices (overdue list) · Lead Inbox · Messages · Tonight and 86 (when switched on).

**Careful:** never default a missing money figure to $0; keep Lost, Cancelled and delete on the website (they can refuse after a
deposit was collected); the word "Lead" (Lead Inbox) is kept apart from "Inquiry" (an event); nothing takes a card.

**Needs a server change:** the events list takes one status, so "Next 30 days" and "Today" cannot be listed exactly; the phone cannot
learn the venue's date from the stats; the overdue-invoices count and list use different conditions; Catering Menus shows per-head
prices to Staff; "Confirmed" counts finished events (nothing sets Completed).

**Questions for the owner**
1. May the captain change the final guest count and tick off run-of-show steps? *Recommend read-only in round 1*; it needs a narrow desktop permission and a "done" mark first.
2. Never show prices on the floor copy of the event order, even to a manager? *Recommend yes.*
3. May managers record a deposit already received (cash, cheque, transfer) from the phone? *Recommend yes, behind a confirm, never "Charge".*
4. Add a "Today's events" tile to the desktop and the phone? *Recommend yes, one shared condition.*
5. Tonight and 86 on the phone in round 1 for restaurants that use them? *Recommend yes; no Register, Kiosk or Orders.*

## Bar and tavern

**What the desktop does.** 44 items: A 8, B 8, C 7, D 21. A = Dashboard, Tonight, Menu (86), Taps, Stock, Schedule, Time, Parties.
The home is the Tonight strip plus the private-party book; "Today on the register" is a sales figure and stays off the phone.

**What makes the phone different.** The live board and the back room: set tonight (open, how busy, a note), 86 an item, flag a tap
(pouring, just tapped, last keg, blown), do a **blind count** and receive a delivery, and see "my shift". The phone is not a register: no
open tabs, no close-out, no card reader.

| Seat | Home | Bottom bar |
|---|---|---|
| owner · admin · manager | Tonight banner; Open inquiries; Next 30 days; Payments overdue (money); Stock to count; "Needs you" (time-off requests, deliveries); Coming up | Home · Tonight · Parties · Stock · More |
| **Staff** (bartender) | Tonight banner (they can change it); On the 86 board; Taps low or blown; My next shift; parties tonight. No money. | Home · Tonight · Shifts · Count · More |
| Viewer | Tonight (read), Open inquiries, Next 30 days, Payments overdue | Home · Tonight · Parties · Guests · More |

**Phase A screens:** Tonight console · 86 board and taps · Blind stock count (and receive delivery for a manager) · My shifts, time off and
the clock · Parties.

**Careful:** the count is blind (the system's number is hidden until submit); every Tonight change says it resets at 4 AM; the staff
seat must not see the drawer total (the server sends it today).

**Needs a server change:** the events list takes one status ("Next 30 days" counts two); "Confirmed" counts all time; Payments Overdue
comes from the reporting service, not the invoice list; there is no team-wide pending time-off list; "orders on the way" and
"out tonight" have no list; the drawer figure leaks to staff.

**Questions for the owner**
1. May bartenders see their own sales on the phone? *Recommend no* (the desktop hides money from that seat).
2. Should "Waiting on you" count only future-dated inquiries? *Recommend yes.*
3. May managers close the night from the phone? *Recommend no* — it is money.
4. Specials and games from the bartender's phone? *Recommend yes, later* (phase C).
5. Build Orders (website pickup) behind its switch? *Recommend later* (phase B).

## Online store

**What the desktop does.** 28 items: A 4, B 2, C 3, D 19. A = Dashboard, Orders, Products, Reviews. The store's own dashboard has six
tiles (Revenue, Refunded, Net sales; Orders, To fulfill, At supplier). Every figure is all-time; there is no date window.

**What makes the phone different.** The **packer** is the star: "what do I box up next" (orders to pack), with the SKU, photo and quantity
per line, ending in one tap ("Mark packed", then the carrier and tracking number and "Mark shipped"). Stock is a first-class phone job:
find a product, correct a count from the shelf, and the server refuses if a sale landed mid-count. Pickup orders have their own next steps.

| Seat | Home | Bottom bar |
|---|---|---|
| owner · admin · manager | To pack; At supplier (only when above 0); Reviews to approve\*; a money block (revenue, refunded, net — read-only lines, not tiles); latest orders | Home · Orders · Stock · Reviews · More |
| **Staff** (packer) | To pack (biggest); At supplier; Reviews to approve\*; latest orders. No money. No totals on the packer's order screen. | Home · Orders · Stock · Reviews · More |
| Viewer | none — a shop hands out only manager and staff seats; a viewer holds no store permission | — |

\* new on the phone (not on the desktop dashboard).

**Phase A screens:** Orders (filter chips; "To pack" is the default) · Pack and ship · Stock (look up, count) · Reviews queue (approve/reject).

**Careful:** the phone never cancels or refunds (a counted order's cancel is a real refund); the only status moves it offers are the
floor's (packed, shipped, delivered, ready for pickup, picked up). "Shipped" emails the buyer and cannot be undone, so it asks. A label
bought from the carrier spends the shop's money, so if it is offered it shows the cost first. Unfinished checkouts are never shown as
sales. The full address appears on the order detail only, never in a list.

**Needs a server change:** the orders list has no `supplierStatus` filter, no multi-status filter, no search and no paging, so "At
supplier" and "Orders" cannot open an equal list; gift-card-only orders can stay "Paid" forever, so "To fulfill" counts orders nobody can
pack; there is no barcode or SKU look-up and no low-stock idea; the products list returns the whole catalogue with pictures.

**Questions for the owner**
1. Say "Packed" for the server's `fulfilled` status? *Recommend yes (wording only; the data stays the server's).*
2. May staff buy carrier labels on the phone? *Recommend yes, with a confirm showing the cost.*
3. Hide order totals and prices from the packer? *Recommend yes* (the server does not hide them; no server change needed).
4. A Reviews tile and queue for staff and managers? *Recommend yes* — a small phase A; drop to B for a leaner first release.
5. Scan-to-find stock? *Recommend not in the first release*: add a server look-up first; typed name or SKU search comes first.

## Veterinary practice

**Closed for sign-ups until its live test, and off in the store app.** This design stays a design.

**What the desktop does.** 34 items: A 6, B 4, C 9, D 15. A = Dashboard, Owners, Messages, Patients, Appointments, Reminders. The
practice dashboard has five tiles (Reminders due, Active patients, Appointments today, Visits this month, Wellness enrollments); it is
not the jobs dashboard. The product is a **records and recall tool, not a clinical system**.

**What makes the phone different.** The exam-room tool: look up a pet in seconds, read the **alert and allergy banner before touching it**,
check it in, record a vaccine given, and text the owner ("ready for pickup", or a recall). Recall is the practice's money engine and
the tech's phone job. The phone shows what the practice typed, with the author and date, and edits only **facts**.

| Seat | Home | Bottom bar |
|---|---|---|
| owner · admin · manager | Appointments today; Vaccines overdue; Due in 30 days; Active patients; a money block only when the server sent it (billed, not yet invoiced, still to come) | Home · Today · Patients · Messages · More |
| **Staff** (clinical; there is no separate front-desk seat) | The same four tiles, no money (and no visit totals anywhere) | Home · Today · Patients · Recall · More |
| Viewer | The four tiles; money allowed (the desktop gives it); no write buttons | Home · Today · Patients · Recall · More |

**Phase A screens:** Today (the day sheet; check in, start, done) · Patient card (alert, allergy, vaccines, owner, last visit) · Record a
vaccine · Recall (overdue and due in 30 days; "Text 4 owners" shows the message first) · Owners · Messages.

**Careful (a vet screen never implies more than the business does):** no medical icons; no "recommended", "safe", "normal" or "up to
date" wording — "Overdue" and "Due soon" describe a date the practice typed, and a pet with no vaccine rows says "No vaccines
recorded". The phone **asks** for the next due date and never fills in the desktop's silent one-year default. SOAP notes,
prescriptions, lab results and billing stay on the desktop. No delete of a patient, visit or vaccine. Cancel and bulk text both ask first.
Wellness enrollments are not loaded for browsing (reading them runs a billing pass).

**Needs a server change:** the Appointments-today tile uses the server's midnight while the list uses the clinic's day, and cannot
hide cancelled/no-show; the "due soon" tile is "before 30 days" while the list is "up to 30 days"; there is no deceased filter for
Active patients; visits and enrollments have no date/status filter; the activity feed sends visit totals to every seat.

**Questions for the owner**
1. May techs write on the phone beyond vaccine, weight, appointment status and texts? *Recommend no.*
2. Invoices on the phone? *Recommend read-only for owner/admin/manager, later; never record-payment.*
3. May the viewer read full charts on the phone? *Recommend only the card, vaccines and appointments.*
4. Insurance and the owner's address on the card? *Recommend no for the clinical seat.*
5. Tab 4 for the clinical seat: Recall or Messages? *Recommend Recall* (Messages stays one tap away from every card).

## How round 2 is held

`scripts/mobile-parity.ts` builds each trade's menu with the desktop's own code and reads each dashboard's tiles from its page; it
**fails** when a tile's anchor text leaves the source. `tests/mobile/parity-map.test.ts` checks every menu item, each trade's phases
and tiles, and (since build round 1) that the phone serves salon, restaurant, bar and store and keeps the vet's screens behind their switch. `tests/mobile/design-preview.test.ts` checks each mock-up exists, uses the
five-slot bars, and says nothing the trade must not imply.

## Build round 1 (salon, restaurant, bar, store; vet built and kept OFF)

Owner's answers of 2026-10-29 are applied as written (salon stylist sees no prices on phone and desktop; front desk may check in;
restaurant captains read-only and a manager may record a deposit already received; bar closes the night on the desktop; store "Packed"
is the phone's word for `fulfilled`; vet stays closed for signups and off in the store app). Everything else took this document's
recommendation.

**What differs from the mock-ups, on purpose**
- "Services this month" (salon) and "Stock to count" (bar) are not tiles: the server has no list or no such idea, and a tile must open
  exactly what it counts. The bar's count is a tab instead.
- The salon bar has Rebook where the design had Messages; Messages, the restaurant Lead Inbox tile and the bar clock are not built.
- Bar "Open inquiries" stays all-dates (the future-only question is still open for the owner).
- Screens are drawn from data (`apps/mobile/src/trades/*.ts`), not one hand-built file each, so one test (`tests/mobile/trade-screens.test.ts`)
  holds every screen to the standing rules.
- Left alone: `GET /api/register/day` still sends `drawerInCents` to a bartender seat. The phone never calls it and the desktop's close-out
  reads it; it needs an owner decision.

**Buying a shipping label (store)** — the server's purchase flow is tested end to end with the carrier stubbed (`labels` in
`apps/unified/tests/store-orders.test.ts`): rates, buy at the chosen rate, label and tracking stored, one label per order even from two
screens, a cancelled order refused. NOT covered: the live carrier, the carrier failing, no carrier account, a seat without
`shipping:label`. The button ships ON behind `LABEL_BUY_ON` in `apps/mobile/src/trades/store.ts`, shows the price before it buys, and
should be tried once with a real carrier account before it is relied on. Set the switch to `false` and the button is absent.
