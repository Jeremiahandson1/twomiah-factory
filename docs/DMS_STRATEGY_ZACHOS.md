# Becoming the DMS — Zacho Sports Center (crm-rv → Twomiah Roam DMS)

**Goal:** replace Zacho's software stack by making `crm-rv` their **system of record** (the DMS), not a CRM layer alongside Lightspeed. Once we own the hub, the satellites (website, CRM, texting, video) become things we absorb or feed.

**Positioning / wedge:** Lightspeed's most-hated trait is that its API/3PA is **gated, per-store, per-data-set, and PAID** — dealers literally pay to access their own data. Our wedge = an **open, no-integration-tax DMS at a fraction of $450–$3,000+/mo.** (Research + sources: see memory `project_zachos_powersports_dms.md`.)

---

## 1. The stack we're displacing (all web-verified 2026-07-07)

| Tool | Role | Feeds off Lightspeed | Plan |
|---|---|---|---|
| **Lightspeed EVO** | THE DMS: Sales/F&I, Service/RO, Parts counter, **Accounting/GL**, CRM, Rental, POS, multi-store | it IS the source | **Replace** — the target |
| **DealerSpike** | Website + digital retail + syndication (LeadVenture) | nightly, one-way via CMF# | Absorb (factory site) or keep feeding |
| **DP360** | Sales/marketing CRM (independent) | reads inventory + web leads | Absorb — `sales_lead` + sequences exist |
| **Kenect** | Texting / reviews / text-to-pay (~$4k/yr) | contact sync + event triggers | Absorb — `sms*` + `review*` + `service_status_texts` exist |
| **Mosaic** | F&I regulatory compliance (Mosaic Compliance Services) | beside stack | **Leave it** — regulatory content is a real moat |
| **"SONM" video** | Inventory walkaround/360° video (name unconfirmed) | reads inventory | Absorb (basic) — get exact name off their bill |

**Data spine today:** `Lightspeed (source) → DealerSpike (site) → DP360 (CRM leads) → Kenect (texts off RO status)`. Replace Lightspeed and the spine is ours.

---

## 2. What already exists in crm-rv (the 70%)

- **Units/inventory:** `unit` table (full RV + powersports + marine spec fields), VIN decode, recall lookup, syndication feed.
- **Sales:** `salesLead` Kanban (new→…→closed_won/lost), desking/F&I pages, `financing.ts`/`valuation.ts` adapters (Octane/JDPower/BlackBook — credential-drop ready).
- **Service:** `repairOrder` (RO#, status, advisor, tech, status texts), labor guide, warranty claims, recalls.
- **Parts CATALOG:** `catalogPart` (partNumber/oem/price/cost/msrp/fitment) + flexible-header CSV importer (`oemParts.ts`) — eats Lightspeed parts exports & OEM price files.
- **Perpetual-inventory MACHINERY (from field-service lineage, currently orphaned from the powersports parts world):**
  `inventoryItem` (cost/price/min-stock/reorder), `stockLevel` (on-hand/location), `inventoryTransaction` (**ledger**: prev/new qty + cost), `inventoryUsage`, `inventoryTransfer`, `purchaseOrder` + `purchaseOrderItem` (**receiving** via `receivedQuantity`), `inventoryLocation`.
- **Rental** (`rentals.ts`), **accounting/QuickBooks hooks** (`accounting.ts`, `quickbooks.ts`).
- **Migration framework** (`migration.ts`) — but wrong vertical (Jobber/ServiceTitan/HCP; contacts/jobs/invoices).

## 3. The three cut wires (the actual DMS gap)

1. **Catalog ↔ stock are two worlds.** `catalogPart` is a price list explicitly "distinct from inventory_item." No on-hand qty on the parts a dealer sells.
2. **ROs don't decrement inventory.** `repairOrder.services` is a JSON blob of free-text part costs — no link to `inventoryItem`, no ledger write.
3. **No counter POS, no GL.** No parts-counter sale flow; no `glAccount`/`glEntry` tables — books are a QuickBooks passthrough.

**"Becoming the DMS" = closing these three.** Everything else is polish.

---

## 4. The build (sequenced)

### Phase 0 — Migration on-ramp (get Zacho's data in)
Lightspeed self-exports CSV: **parts (qty + cost via Inventory Valuation), customers, major units, vendors, customer-owned units.** RO/service history is the known gap (not in standard migration lists — accept imperfect history).
- Extend `oemParts.ts /import` so it seeds **both** `catalogPart` **and** `inventoryItem` + `stockLevel` (on-hand + cost) in one pass.
- Add RV migration entities to `migration.ts` (or a new `rvMigration`): customers→`contact`, units→`unit`, vendors→vendor list, parts→above. Provider preset: **Lightspeed** (columns from its CSV export).

### Phase 1 — Unify catalog with the stock ledger + make sales decrement it  ← the crux
- **Unify identity** on `(partNumber, oem)`: when a `catalogPart` is stocked, create/link an `inventoryItem` (partNumber→sku, oem→vendor, carry cost/price) with a `stockLevel` row. One part = one stocked identity.
- **Real RO part lines:** replace the `services` parts JSON with proper RO part lines referencing `inventoryItem`; posting a part to an RO writes an `inventoryTransaction` (type=`sale`, decrement) — reuse `inventoryUsage` but add `repairOrderId` (today it's `jobId`-only).
- **Counter POS / parts ticket:** new `counterSale` + `counterSaleLine` (or reuse `invoice`/`invoiceLineItem` with an `inventoryItemId` link) — walk-in parts sale decrements stock + records revenue/cost.
- Result: on-hand is live; selling a part anywhere moves the ledger. **This is the DMS.**

### Phase 2 — Books (real-time posting)
- Decision: **lean on QuickBooks** first (the `quickbooks.ts` hook exists; matches how many small dealers already run). Every parts sale / RO close / PO receipt posts a journal entry to QB. Native `glAccount`/`glEntry` tables are a later upgrade if Zacho wants the books fully in-app.

### Phase 3 — Distributor parts feeds (parts/pricing "going forward")
- Reuse the **scheduled-feed pattern** (units importer, every 3h) to ingest distributor **price/stock files** into `catalogPart` + `inventoryItem.unitCost`. Start with the distributor Zacho actually buys from (BRP nightly push / Polaris Master Price List / Parts Unlimited portal / Turn 14). These are **negotiated per-vendor relationships**, not just code.
- Wire **PO submission → distributor** and **receiving** into the existing `purchaseOrder`/`purchaseOrderItem` tables (receiving already increments via `receivedQuantity` → write `inventoryTransaction` type=`receipt`).

### Phase 4 — Absorb the satellites
- **DP360:** already have `salesLead` pipeline + `dripSequence`/`sequenceEnrollment` + lead inbox. Gap: parity on lead-source breadth + AI reply.
- **Kenect:** already have `sms*`, `review_request`/`review`, and `service_status_texts` firing off RO status. Add the event-trigger parity (sales-finalized / service-cashier) + PCI text-to-pay link. Saves Zacho ~$4k/yr.
- **DealerSpike:** generate Zacho's public site from the factory (`website-rv` template) fed by our own `unit` data; `syndication.ts` covers marketplace export.
- **Video:** basic auto inventory video from `unit.photos` + specs; identify exact incumbent first.

### Phase 5 — DMS polish
- OEM **warranty claim submission** + recall feeds (`warrantyClaim`, `recalls.ts` exist), **rental** hardening, multi-store.

## 5. What we deliberately do NOT build
- **Mosaic compliance** (regulatory training/audit content — specialized liability moat; leave Zacho on it).
- Full AI voice receptionist (Kenect's newest layer) — later.
- Native GL (use QuickBooks first).

## 6. Scope contradiction to resolve
`docs/test-e2e-rv.md` line 5 states crm-rv is "a **CRM layer, not a DMS**." This plan is a deliberate re-scope. Update that doc + the feature set when Phase 1 lands.

## 7. Open questions for Zacho (decide the build, not answerable from code)
1. **Which distributors/OEMs do they buy parts from?** (BRP? Polaris? Parts Unlimited? Tucker/Turn 14? WPS?) — sets the Phase 3 feed.
2. **Exact name of the video tool** ("SONM eVideo" unconfirmed).
3. Do they want the **books fully in-app** or is QuickBooks fine? (decides native-GL effort).
