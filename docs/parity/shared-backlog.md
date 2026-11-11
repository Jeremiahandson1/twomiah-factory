# Shared backlog — built once, switched on per trade

Features more than one trade needs. Each is built once in the shared packages (`packages/tenant-backend`, `packages/tenant-ui`)
and switched on per trade through the feature registry, as warranties and equipment are — never inside one trade first and copied
later. Before building one, extend what is named in "Builds on"; never add a second version of it.

Started 11/10 from the Buildertrend inventory (`contractor.md`, "Buildertrend inventory"), checked against the code that day.

| Feature | Trades | Builds on (already in the code) | Where |
|---|---|---|---|
| **Credit memos** on invoices | every trade that invoices (`invoices`: contractor, field service, basic, landscaping, roofing, vet, salon, restaurant, bar, RV) | the shared invoices | `packages/tenant-backend/src/invoicing` |
| **Workday exceptions** — holidays and days off the schedule skips | **built 11/10, hidden (`days_off`)** — contractor, field service, landscaping, basic, roofing | booking_blackout (no person, whole day) — online booking's own rows | `apps/unified/server/data/daysOff.ts`; the job check, Find a time, the Dispatch Board, plan visits; Settings › Days off |
| **Photo folders per job** — photos grouped by kind (before, progress, damage, after…) | contractor, roofing, field service, landscaping, basic | `job_photo.photo_type` (shared table; only roofing's screens use it); the core `photo` table's unused `tags` (contractor project photos) | the shared job page groups by `photo_type`, kinds per trade in its settings; project photos use the same kinds |
| **Lead map** | contractor, roofing, field service, landscaping, basic (`lead_inbox` is on 13 CRMs) | roofing's `PinMap` (`apps/unified/web/src/crm/pages/roof/field/PinMap.tsx`) on `tenant-ui/src/maps` | move `PinMap` into `tenant-ui/src/maps`; the lead inbox's leads on it; canvassing keeps using it |
| **Weekly client update** — a digest of what was shared that week, read / liked | contractor, roofing; landscaping installs | the portal's per-item sharing (contractor row 10a) and roofing's "tell them when something new is shared" (`portal_tools`) | `packages/tenant-backend/src/portal` |
| **In-person payments** — a customer's credit or debit card taken at the counter (tap to pay on a phone, or a card reader); not gift cards | store (and any trade selling at a counter) | `tap_to_pay` (shared; not yet offered to the store) | open the feature to the store; a counter screen that sells from the catalogue (`store.md`, Shopify chart) |
| **Texting** — SMS campaigns and two-way chat | store | `two_way_texting` (shared, on 12 CRMs) | open the feature to the store |
| **Stock in more than one place** — locations, a count per location, transfers | store; the salon has its own (`salon_stock_location`) | the shared inventory (`packages/tenant-backend/src/inventory`: `inventory_location`, `stock_level`, transfers) | store variants counted on it; later the salon's moved onto it — one version, not three |
| **Built for one trade, wanted by more** — estimate templates, quote follow-up, change orders, sales pipeline, owner / crew dashboards | field service, landscaping, basic (ServiceTitan list, 11/10 — `fieldservice-servicetitan.md`) | `quote_templates`, `quote_followup`, `change_orders`, `lead_pipeline`, `owner_dashboard`, `crew_dashboard` (contractor only today) | add the trades to each feature's `templates`, then try each |
| **Booking from the customer portal** | field service, landscaping, basic | `portal_appointments` (the salon only) | open it to the trades with online booking |
| **Skill matching** — the right person for the job | field service, landscaping, basic, roofing | `skills` already on team members (`tenant-backend/src/team/team.ts`); home care's matching (row 14) | one rule the dispatch board and the schedule both use |
| **"Where's my tech" link** in the on-my-way text | field service, landscaping, basic, roofing | GPS (`gps_tracking`) and the on-my-way text (`tech/tech.ts`) | a live link in the text |
| **Barcode scanning on the phone** | field service (equipment, parts), store | the store's scanner (`apps/mobile/src/trades/store.ts`) | one scanner the trades share |

Contractor-only for now (they ride on things only the contractor has): bid packages to subs (on `vendor_portal` and
`purchase_orders` — opens to roofing and landscaping with the vendor portal, not as a second build), the schedule baseline
(finish `project_baseline`, with projects), builder's risk and cost per sq ft.
