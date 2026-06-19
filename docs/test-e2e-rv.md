# Twomiah Factory E2E Test — RV / Powersports Dealership (Twomiah Roam)

You are QA testing Twomiah Factory's newest vertical: the **RV / Powersports dealership CRM** (brand: **Twomiah Roam**, template `crm-rv`, industry value `rv`, service suffix `-rv`). This is a LIVE production test — the CRM is generated from the `crm-rv` template and deployed through the Factory pipeline (GitHub → Render → Render Postgres), exactly like the roof/wrench/care verticals.

The RV CRM is positioned as a **CRM layer, not a DMS**. Specialized features: category-conditional **unit inventory** (RV + powersports), a **sales pipeline** Kanban, a **service department** with automated status texts, **NHTSA recall lookup**, **marketplace syndication**, **seasonal/YoY reporting**, a **two-way SMS unified inbox**, and **automated follow-up sequences**.

Take screenshots at every major step. Report pass/fail for each feature.

---

## PHASE 0: PROVISION / DEPLOY

Deploy `crm-rv` for a test tenant the same way the other verticals are deployed (admin "Deploy" / `POST /api/factory/customers/:id/deploy`, or the provisioning flow). The tenant's `industry` MUST resolve to the `rv` vertical (any of: `rv`, `rv_dealer`, `rv_dealership`, `rv_sales`, `motorhome`, `powersports`, `motorcycle_dealer`, `atv_dealer`, `utv_dealer`, `boat_dealer`, …).

- Company Name: "Northwoods RV & Powersports QA"
- Industry: **RV / Powersports Dealership** (stored as `rv`)
- Primary Color: #2563EB
- Admin: test-rv@twomiah.com / TestRoam2026!

- [ ] Deploy started without error
- [ ] Tenant industry resolved to vertical `rv` → template `crm-rv`

---

## PHASE 1: VERIFY GITHUB REPO

Critical check — confirm the RV code (not contractor/automotive) was pushed.

1. Visit the tenant repo under https://github.com/Jeremiahandson1/<slug>
2. Verify:
   - [ ] `crm-rv/` directory with `backend/` and `frontend/`
   - [ ] `crm-rv/backend/src/index.ts` exists
   - [ ] RV-specific backend routes exist:
     - [ ] `units.ts` (NOT `vehicles.ts`)
     - [ ] `salesLeads.ts`, `repairOrders.ts`, `alerts.ts`, `leads.ts`
     - [ ] `recalls.ts`, `reporting.ts`, `syndication.ts`
     - [ ] `sms.ts`, `sequences.ts`
   - [ ] `crm-rv/backend/src/services/sms.ts` and `sequenceRunner.ts` exist
   - [ ] `crm-rv/frontend/src/pages/` has `MessagesPage.tsx`, `SequencesPage.tsx`, `ReportingPage.tsx`, and `automotive/InventoryPage.tsx`
   - [ ] `render.yaml` at repo root with `rootDir: crm-rv/backend`
3. If the repo only has README.md / deploy.sh — **STOP, report P0**.
4. GitHub shows **TypeScript** as primary language, not Shell.

- [ ] Repo contains real `crm-rv` application code

---

## PHASE 2: VERIFY DEPLOYMENT

Wait 5–10 min, then:

1. Visit `https://<slug>-rv-api.onrender.com/health` — returns `{ status: 'ok' }`?
2. Visit `https://<slug>-rv-api.onrender.com` — CRM SPA loads (Twomiah Roam branding, blue #2563EB)?

- [ ] CRM API reachable, `/health` OK
- [ ] SPA loads, no 502/503
- [ ] Branding is "Roam", NOT "Drive"/"Build"

---

## PHASE 3: LOGIN

1. Log in: **test-rv@twomiah.com** / **TestRoam2026!**
2. Complete onboarding if shown.

- [ ] Login succeeds (this is the auth path that was broken by `useAuth().token` — verify pages actually load data, not blank)
- [ ] Dashboard loads with RV KPIs (units by status/category, open leads, close rate, open repair orders, service revenue)

---

## PHASE 4: UNIT INVENTORY (category-conditional)

Navigate to **Inventory**.

### 4.1 Add a motorhome
- [ ] Add Unit → Category: **Motorhome** → verify the form reveals: rvClass, lengthFt, sleeps, slideOuts, chassis, fuelType, mileage, generatorHours, GVWR, dryWeight, awnings, fresh/grey/black tanks (and NOT powersports cc/hours)
  - Make: Winnebago, Model: View, Year: 2024, rvClass: C, lengthFt: 25.5, sleeps: 4, Internet Price: 142000, Condition: new, Status: available
- [ ] Saves; list card shows category, year/make/model, condition, price, and key spec (length + sleeps)

### 4.2 Add a towable
- [ ] Category: **Towable** → form shows towableType, lengthFt, sleeps, slideOuts, dryWeight, GVWR, hitchWeight, tanks (no engine/mileage)
  - Make: Forest River, Model: Rockwood, towableType: travel_trailer, lengthFt: 27, sleeps: 6, Condition: used

### 4.3 Add a powersports unit
- [ ] Category: **UTV** → form shows engineCc, hours, fuelType, drivetrain (no RV tank/slideout fields)
  - Make: Polaris, Model: RANGER, engineCc: 999, hours: 12, Condition: new
- [ ] List card key spec shows cc + hours

### 4.4 VIN decode
- [ ] On a motorized unit, use VIN decode (POST `/api/units/vin-decode`) with a 17-char VIN → year/make/model populate

### 4.5 Recall lookup
- [ ] On a unit detail, click **Check Recalls** (feature `recall_lookup`) → calls `/api/recalls/unit/:id`
- [ ] Motorhome/towable: shows NHTSA recalls or "No open recalls"
- [ ] Powersports (atv/utv/pwc/snowmobile): shows the CPSC-coverage note (NHTSA doesn't cover off-road)

### 4.6 Syndication export
- [ ] Header **Export Feed** (feature `inventory_syndication`) downloads a CSV from `/api/syndication/feed?format=csv`
- [ ] CSV opens cleanly; a unit description starting with `=`/`+`/`-`/`@` is NOT executed as a formula (injection guard)

---

## PHASE 5: SALES PIPELINE

Navigate to **Sales Pipeline**.

- [ ] Kanban with 6 columns: **New, Contacted, Demo, Desking, Closed Won, Closed Lost** (display labels; stored as new/contacted/demo/desking/closed_won/closed_lost)
- [ ] Create a lead: Contact (create inline), Unit of Interest (one from inventory), Source: RV Trader, assign salesperson, Trade-In: "2018 Keystone Cougar 27ft"
- [ ] Card appears in **New** with the unit year/make/model and salesperson name shown
- [ ] Use the **Move** dropdown / expanded stage buttons → move card New → Contacted → it relocates and the column counts update
- [ ] Move to **Closed Won** → verify it lands in Closed Won (and `closedAt` is set — the close-date drives reporting)
- [ ] ADF/XML import: paste a sample ADF → lead imported

---

## PHASE 6: SERVICE DEPARTMENT + STATUS TEXTS

Navigate to **Service**.

- [ ] Create a repair order: Customer (a contact), Unit (or manual walk-in unit info), services, advisor, estimated total
- [ ] RO appears with an RO number; "Mileage / Hours" framing present
- [ ] Update status **open → in_progress → waiting_parts → ready** → each customer-facing change fires an automated SMS to the customer (feature `service_status_texts`); verify a message row is logged (see Phase 8). With no Twilio config, the message is logged as `failed` with a clear reason — NOT a crash.
- [ ] Service-to-sales alert fires when a known sales contact checks a unit into service (Alerts page)

---

## PHASE 7: LEADS (marketplace inbox)

- [ ] **Lead Inbox** loads; platforms are RV/powersports marketplaces (RV Trader, RVUSA, RVT, Cycle Trader, ATV Trader, Boat Trader, ADF Email) — NOT Angi/Thumbtack/cars.com
- [ ] **Lead Sources** page lists those marketplaces with connection instructions
- [ ] Lead fields show customer name + unit interest (not "homeowner"/"job type")

---

## PHASE 8: TWO-WAY SMS INBOX

Navigate to **Messages** (feature `two_way_texting`).

- [ ] Two-pane inbox: conversation list + thread + composer
- [ ] Send a text to a contact (`POST /api/sms/send`). With Twilio configured: delivered + logged outbound. Without: returns 502 with a clear "Twilio not configured" warning, message still logged as `failed`.
- [ ] Service status texts from Phase 6 appear here, attributed to the dealership
- [ ] (If a real Twilio number is wired) text the dealership number → inbound message appears in the thread; unread badge clears on open

---

## PHASE 9: FOLLOW-UP SEQUENCES

Navigate to **Sequences** (feature `follow_up_sequences`).

- [ ] Create a sequence "New Lead Nurture": trigger manual, with steps:
  - Step 1: SMS, delay 0h, "Hi {{firstName}}, thanks for your interest!"
  - Step 2: SMS, delay 24h, "Still thinking it over? Happy to answer questions."
  - Step 3: Email, delay 72h, subject "Your RV options", body with {{firstName}}
- [ ] Save → list shows step count
- [ ] **Edit** the sequence → verify the steps reload (regression: editing must NOT show 0 steps / wipe them)
- [ ] Enroll a contact → an enrollment is created; the background runner sends Step 1 (delay 0) within ~1 min
- [ ] View enrollments; cancel one

---

## PHASE 10: REPORTING

Navigate to **Reports** (feature `reports`).

- [ ] Three YoY cards: Leads / Units Sold / Repair Orders — current vs same-month-last-year with green-up/red-down delta
- [ ] 24-month bar series renders
- [ ] Lead-sources table: Source / Leads / Won / Close Rate%
- [ ] "Open repair orders" count excludes `ready`/`closed` (does not double-count with booked revenue)

---

## PHASE 11: SETTINGS & FEATURES

- [ ] Company settings: name, branding (#2563EB)
- [ ] Team: list users (Test RV owner); add/role/deactivate works; last-owner cannot be removed
- [ ] Feature toggles reflect the RV feature set (unit_inventory, deal_pipeline, service_dept, deal_desk, trade_in, recall_lookup, inventory_syndication, service_status_texts, parts_counter, warranty_claims, follow_up_sequences, esign, seasonal_trends, two_way_texting, lead_inbox, google_reviews, online_payments, consumer_financing, quickbooks, reports)
- [ ] NO contractor/construction features present (no projects/RFIs/draw schedules)

---

## PHASE 12: FINAL SUMMARY

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | Deploy (crm-rv, -rv-api) | Pass/Fail | |
| 2 | GitHub repo has crm-rv code | Pass/Fail | units/sms/sequences/recalls present |
| 3 | CRM /health + SPA loads | Pass/Fail | Roam branding |
| 4 | Login + data loads (auth token) | Pass/Fail | not blank |
| 5 | Dashboard RV KPIs | Pass/Fail | |
| 6 | Unit inventory — motorhome form | Pass/Fail | category-conditional |
| 7 | Unit inventory — towable form | Pass/Fail | |
| 8 | Unit inventory — powersports form | Pass/Fail | cc/hours |
| 9 | VIN decode | Pass/Fail | |
| 10 | Recall lookup (NHTSA + CPSC note) | Pass/Fail | |
| 11 | Syndication CSV export (+injection guard) | Pass/Fail | |
| 12 | Sales pipeline Kanban (6 stages) | Pass/Fail | enum values, not labels |
| 13 | Pipeline move sets closedAt | Pass/Fail | |
| 14 | ADF import | Pass/Fail | |
| 15 | Service ROs | Pass/Fail | |
| 16 | Service status texts | Pass/Fail | logged; failed-not-crash w/o Twilio |
| 17 | Service-to-sales alert | Pass/Fail | |
| 18 | Lead inbox (RV marketplaces) | Pass/Fail | |
| 19 | Lead sources | Pass/Fail | |
| 20 | SMS unified inbox | Pass/Fail | |
| 21 | Sequences create | Pass/Fail | |
| 22 | Sequences edit (steps reload) | Pass/Fail | regression check |
| 23 | Sequence runner sends step | Pass/Fail | |
| 24 | Reporting YoY + lead sources | Pass/Fail | |
| 25 | Open-RO excludes ready/closed | Pass/Fail | |
| 26 | Team / last-owner guard | Pass/Fail | |
| 27 | Feature toggles = RV set | Pass/Fail | no contractor cruft |

### Critical Findings
> (List P0/P1 issues, blank pages, 404s, anything that doesn't match this checklist.)

For each failure: describe the error and include a screenshot.
