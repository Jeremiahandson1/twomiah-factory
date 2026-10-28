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

Salons, restaurants, bars, stores and vets keep the "use the website" screen. Their desktops are as large as the trades above and
none of the phone's phase A screens (jobs, quotes, time) exist for them; each would need its own design round. Recommendation: keep.
The parked `crm-automotive` template is untouched.
