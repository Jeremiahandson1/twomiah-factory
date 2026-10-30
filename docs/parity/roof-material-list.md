# Roofing parity — the material list from the measurement (gap 4)

Leaders: Roofr (material ordering), AccuLynx (material orders). Read from their own pages on 2026-10-30; where a page said
nothing about a point it is marked "not stated" and nothing is assumed. One page the lead search found — Roofr's
"Measurement Reports › add material calculations" — redirected to the help-centre home and was **not read**, so what it
says about calculated materials is unknown here.

Sources
- Roofr: [Material ordering](https://roofr.com/material-ordering), [How to create a material order](https://help.roofr.com/en/articles/15634349-how-to-create-a-material-order), [How to calculate roof waste factor](https://roofr.com/blog/how-to-calculate-roof-waste-factor), [Material and Work Orders (collection)](https://help.roofr.com/en/collections/19672985-material-and-work-orders)
- AccuLynx: [New ways to make scheduling and ordering easy for roofers](https://acculynx.com/new-ways-to-make-scheduling-and-ordering-for-easy-for-roofers/)

## The list, each marked

| # | What the leaders do | Twomiah (roofing) | Mark |
|---|---|---|---|
| 1 | Turn the measurement into a material order — Roofr ("Convert measurements and proposals into ready-to-send, accurate material orders"); the page says the list comes from the signed proposal. AccuLynx: generating an order from a measurement is **not stated** | Squares entered on the job, else the job's measurement-report squares, × waste → a list of eight kinds of material, then "Create material order" (`server/crm/roof/materialList.ts`, `field/materialListRoutes.ts`) | **Matches** (from squares); the proposal-driven list is **Not doing** (row 12) |
| 2 | Waste factor — Roofr's ordering page: **not stated**; its blog: "about 10% to 15%", more for complex roofs, no figures for shingles, starter or ridge. AccuLynx: not stated | A waste % on every list (default 10), shown in the box, applied to every line; the screen says 10 plain gable, 15 hip, 20 cut-up | **Beats**, on what the pages state |
| 3 | Review, and edit items and quantities, before ordering — Roofr | Every line is editable (words, quantity, unit), lines can be removed or added; nothing is ordered until Create | **Matches** |
| 4 | The materials a roof needs: bundles, starter, ridge cap, underlayment, ice and water, drip edge, nails, vents (the gap's list). Neither leader page read names these | All eight, each with real coverage (3 bundles a square; starter ~120 ft a bundle; ridge cap ~25 ft; underlayment 10 squares a roll; ice and water 3 ft band, 200 sq ft a roll; drip edge 10 ft pieces; ~320 nails a square, 7,200 a box; vents by the 1-in-300 rule) and the arithmetic written beside each line | **Matches** the gap; leaders **not stated** |
| 5 | Assumptions the roofer can change | Every number above is an assumption, changeable for the list at hand (waste, bundles per square, coverage per roll, vent type…); out-of-range input is ignored, not stored | **Beats** (leaders: not stated) |
| 6 | Lengths of eave, rake, ridge and valley from the measurement | The roofer can type them. Left blank they are **estimated from the squares** (a plain rectangular house) and the list says which were estimated. Our measurement reports carry squares and per-facet areas, **not** edge lengths, so they cannot fill these in | **Partly.** Parity needs the report's linear lengths (EagleView / Hover / GAF reports carry them — ordering those is outside this change) |
| 7 | Supplier required at creation — Roofr | Supplier name required (a list of the usual supply houses is offered as they type; anything typed is kept) | **Matches** |
| 8 | Delivery address, delivery date, point of contact, PO number — Roofr (delivery date and contact "mentioned") | The order takes the job's address (or one typed), the API takes a delivery date; the list screen does not ask for date, contact or PO number — the existing Materials order form and the order's fields do | **Partly** |
| 9 | Statuses: draft, ready to send, sent, rejected, delivered — Roofr | not ordered, ordered, partial, delivered, cancelled (the existing material-order status) | **Different, by design** — the roofer tracks the order, we do not send it |
| 10 | Prices from the supplier locked into the order ("created locked to that supplier"; "Change supplier" clears pricing) — Roofr | No price is stored on a list-made order; the supplier's quote is the price. Prices can be typed on the order afterwards (existing) | **Not doing** (needs supplier pricing) |
| 11 | Order placed with the supplier from inside the software — Roofr ("direct ordering integrations to suppliers like ABC Supply, QXO (formerly Beacon), and SRS"; "Select your supplier and click submit"); email send with recipients, subject and message; bulk ordering — AccuLynx | The order is created and tracked here; it is **not transmitted**. Supplier APIs need partner agreements — explicitly not in this change | **Not doing** (owner's / partners') |
| 12 | A material list from the won proposal's own lines; from a saved template — Roofr (separate "from a template" article, **only its summary read**) | Not built. Parity needs (a) a "from the signed quote" source that carries the quote's material lines across, (b) saved assumption sets / templates | **Not doing** |
| 13 | Download the order — Roofr | Not built (the order is read on the Materials screen; delete exists). Parity needs a printable / PDF order | **Not doing** |
| 14 | An order dashboard: sortable columns for status, number, job address, supplier, amount, delivery — Roofr | The existing Materials screen lists orders with filters; whether it matches those columns was **not verified** here | **Not claimed** |
| 15 | Linked labour ticket and material order — AccuLynx | A work order carries a copy of a material order's lines (gap 5, `docs/parity/roof-work-orders.md`) | **Matches**, once gap 5 lands |

## What this change builds
- `server/crm/roof/materialList.ts` — the arithmetic, pure, with every assumption named and overridable.
- `server/crm/roof/field/materialListRoutes.ts` — `/api/material-list` (assumptions, calculate, a job's list, create order), behind the not-ready feature `roof_material_list`; reads ask `jobs:read` and the seat's own jobs, the order asks `inventory:create` and the Materials feature.
- A "Material list" button on a job's Materials card (`web/src/crm/pages/roof/field/MaterialListBuilder.tsx`), shown to a seat that may order, when the feature is on.
- Proof: `tests/roof-material-list.test.ts`.

## Still needed for full parity (not in this change)
Rows 6 (real edge lengths from a measurement report), 8 (date / contact / PO on the screen), 10, 11, 12 and 13. Row 14 to be checked.
