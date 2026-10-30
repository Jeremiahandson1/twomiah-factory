# Roofing parity — storms and canvass territories (gap 9)

Leaders: AccuLynx (hail map / storm tools), SalesRabbit and Spotio (territories). Read on 2026-10-30. Where a page said
nothing about a point it is marked "not stated"; nothing is claimed that was not read or verified in the code.

What could and could not be read, said plainly
- **Spotio** — three help pages read in full (below). This is the list the territory rows are built from.
- **AccuLynx** — no help-centre page on a hail map could be found. The one AccuLynx page read is a blog post
  ([acculynx.com/?p=1631](https://acculynx.com/?p=1631)); it says a hail map can be overlaid in AccuLynx and that hail apps
  connect through AppConnections and the API, and names Lead Intelligence (lead scoring). It does **not** say the overlay shows
  past customers; "a hail map over past customers" is the gap's wording, not something the page states. Treated here as: hail
  data from a provider, shown on a map.
- **SalesRabbit** — a help article on area management was found by search
  ([Area Management – Web App](https://help.srplus.salesrabbit.com/hc/en-us/articles/33338136524055-Area-Management-Web-App))
  but the page could not be fetched, so **nothing is claimed from it**. The territory list below is Spotio's; SalesRabbit parity
  is unverified until that page is read.

Sources
- Spotio: [Territories](https://support.spotio.com/hc/en-us/articles/8267726135319-territories),
  [Territory Management – Creating and Managing Territories](https://support.spotio.com/hc/en-us/articles/360005805374-Territory-Management-Creating-and-Managing-Territories),
  [HailTrace integration](https://support.spotio.com/hc/en-us/articles/9780974346647-SPOTIO-Native-Integrations-HailTrace)
- AccuLynx: [blog page above](https://acculynx.com/?p=1631)

## How a customer is placed on a storm, with no paid geocoder

A storm (or a territory) is a shape drawn on the map — a polygon of corners or a circle (centre and radius in miles).
A customer is tested against it from coordinates the business **already holds**: the pin of their newest job that has one (the
roof is at the job's address, which may differ from the billing address), else the contact's own pin. Doors a rep knocked
with the phone's GPS carry a pin of their own. The test is plain geometry (ray casting for a polygon, great-circle distance for
a circle) in `server/crm/roof/field/geo.ts`. **No geocoder is called, ever.**

A customer with **no pin** cannot be put on a map. It is matched by its five-digit zip against the zips the storm names, and the
screen marks it "By zip only — no pin". A customer in the storm's zip whose pin is **outside** the drawn path is not hit.

What parity would need if addresses lack coordinates: a **geocoding provider** to turn each address into a pin. The server
already has Google's Geocoding behind `GOOGLE_MAPS_API_KEY` (`/api/maps/batch-geocode` fills job pins for an admin); with a key
set and that run done, past customers get pins and the by-zip-only group shrinks. Without a key, those customers stay by-zip.
Ray casting on flat latitude/longitude is accurate for tens of miles; it is not meant for a shape across the antimeridian.

## The list, each marked

| # | What the leaders do | Twomiah (roofing) | Mark |
|---|---|---|---|
| 1 | Draw a territory by dropping points and closing the loop — Spotio "Draw Territory" | Click the corners on the map; save. Also a circle (centre and radius) | **Matches** |
| 2 | Territory by ZIP, several stacked into one — Spotio "ZIP or Postal Code Territory" | A list of five-digit zips on the territory, alone or with a drawn area (a point is in it if it is inside the shape or in a listed zip). The map does not outline a zip; Spotio's does | **Matches the list**, not the outline |
| 3 | "Select Territory": click the map to take a State, ZIP, City or County boundary — Spotio | Needs boundary data for those areas (none held) | **Not doing** |
| 4 | Every territory has a name and a colour — Spotio | Name (120 characters), colour (six swatches), notes | **Matches** |
| 5 | Assign one or more reps, optional — Spotio | Any number of reps, or none; change them any time (`PUT /api/territories/:id/reps`) | **Matches** |
| 6 | A territory does not block a rep from working outside it — Spotio | No door is ever refused for being outside; the stop route is untouched | **Matches** |
| 7 | The rep is warned when working outside their territory — Spotio | The server answers `GET /api/territories/locate?lat&lng` ("inside which, and is it mine"). **The phone does not call it yet**, so no rep sees a warning | **Server only** — phone notice not built |
| 8 | Who may create: admins; managers only if an admin grants it; reps cannot — Spotio | `canvassing:manage` (owner, admin, manager) creates, changes, deletes and assigns; a field rep and the read-only seat are refused by the server. A manager has it by default (Spotio's is opt-in) | **Matches**, manager default differs |
| 9 | A rep with "Limited" territory access sees their own — Spotio | A rep sees only the territories they are on; another answers 404. The read-only seat and the office see all | **Matches** |
| 10 | Edit a territory, adjust or reset its boundary — Spotio | Name, colour, zips, notes, reps and boundary can be changed through the server; the screen edits reps and deletes, but **redrawing a boundary on the screen is not built** (delete and redraw) | **Partly** — screen gap |
| 11 | Delete a territory; its records and users are untouched — Spotio | Delete leaves the doors knocked and the people as they were (tested) | **Matches** |
| 12 | Nested territories ("Belongs To": a child inside a parent) — Spotio | Not built | **Not doing** |
| 13 | Create a territory around a storm swath and assign the team to it — Spotio with HailTrace | "Make a territory from this path" on the Storm Map takes the saved storm path as a territory (it keeps the storm), then the office assigns reps. The swath itself is drawn by hand — see 15 | **Matches** the flow, not the data |
| 14 | Territory totals — not stated on the Spotio pages read | Doors knocked, leads, doors by outcome, and (office only) past customers inside, counted from the stops logged inside it | **Built** (no leader page to compare) |
| 15 | Storm swaths from a hail-data account overlaid on the map; each storm's location, date, severity, wind, hail, rainfall — Spotio+HailTrace; a hail-map overlay through integrations — AccuLynx | Storm paths are drawn by hand (or typed as a circle); a storm carries date, type, hail size and wind. No provider swath is imported, and no rainfall. Parity needs a hail-swath data provider (HailTrace or similar: a paid account and its API) to fill `storm_event.path` | **Not doing** (needs a paid data provider) |
| 16 | Past customers on the hail map — the gap's idea of AccuLynx; not stated on the AccuLynx page read | The Storm Map lists past customers (work done: final inspection, invoiced or collected) inside the drawn path, with job, roof age and whether they were placed by their pin or by zip only; "Everyone" widens it to every contact | **Built** |
| 17 | Storm leads from the customers hit | The storm board's "generate leads" now reads the same path: customers inside it, plus unpinned ones in its zips; a customer in the zip but outside the path is **not** made a lead (tested) | **Built** |
| 18 | Lead scoring for storm leads — AccuLynx "Lead Intelligence" | Not built | **Not doing** |
| 19 | Import territories — a Spotio help article exists (title seen, not read) | Not built | **Not doing** (unread) |
| 20 | The NOAA storm feed | Written long ago, never scheduled. Now a **"Check NOAA now"** button for the owner and admin (`integrations:update`; a manager, crew and read-only seat are refused by the server). It reads the feed once, for this business, and adds the storms to the board — no leads are made. **Nothing schedules it** (tested: no request before the button, no timer or job in the code). Owner's decision on scheduling is pending | **Built** on demand |

## What this change builds
- Geometry: `server/crm/roof/field/geo.ts` (shapes, validation, point-in-shape, zip fallback) and `customerGeo.ts` (who is inside).
- Storm paths: `storm_event.path` (migration `0041_roof_storm_territories`); `PUT /api/storm-map/events/:id/path`;
  `GET /api/storm-map/events/:id/customers`; the storm board's `generate-leads` reads the path.
- Check NOAA now: `POST /api/storm-map/noaa-check` → `stormData.runStormCheck(companyId)`.
- Territories: tables `canvass_territory` and `canvass_territory_rep`; `/api/territories` (list, one with stats, create, edit,
  reps, delete, `/reps` for the picker, `/locate`).
- Screens: Storm Map (`/crm/storm-map`), Territories (`/crm/territories`).
- Switches, both **not ready (hidden)**: `storm_customer_map`, `canvass_territories`.

## Still needed for full parity (not in this change)
Rows 3, 7 (the phone), 10 (the screen), 12, 15 (a data provider), 18, 19. SalesRabbit's own page must be read before
claiming parity with it. The NOAA feed's real CSV shape is **not verified** — the parser reads `type, magnitude, location`
per line, and the sample in `tests/fixtures/roof-noaa-sample.csv` is hand-written in that shape, not recorded from NOAA; an
event from the feed names the whole service area as affected until its path is drawn.
