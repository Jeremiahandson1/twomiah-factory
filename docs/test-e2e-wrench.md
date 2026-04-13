# Twomiah Wrench — End-to-End Test Spec (Chrome / Computer Use)

**You are Claude running in a Chrome browser. Verify every feature that SHOULD exist on each tier of Twomiah Wrench. If a feature is in the MUST EXIST list and you cannot reach it, report MISSING — do not skip it.**

Result values: **PRESENT** / **MISSING** / **BROKEN** / **BLOCKED**. Screenshot every MISSING and BROKEN. Continue after failures — finish every row.

---

## PHASE 1 — Sign up on the Fleet tier

Test the highest tier so all lower-tier features are covered on one tenant.

1. Navigate to: **https://twomiah.com/signup/wrench/**
2. Wizard inputs:
   - Company Name: `E2E Wrench Test {timestamp}`
   - Industry: HVAC / Plumbing / Electrical
   - Phone: 715-555-0201
   - Address: 200 Main Street, Eau Claire, WI 54701
   - Primary Color: #059669
   - Website Template: first field-service template
   - **Plan: Fleet ($599/mo)** — do NOT pick a lower tier
   - Add-ons: check ALL
   - Deploy: Basic ($299)
   - Admin: `e2e-wrench@twomiah.com` / `E2EWrench2026!`
3. Screenshot confirmation. Record slug.

## PHASE 2 — Verify deploy

Wait 10 min. Visit `https://{slug}.onrender.com`, then `https://{slug}-site.onrender.com`. Log in.

---

## PHASE 3 — Starter tier features (MUST EXIST)

| # | URL | Expected | Result |
|---|---|---|---|
| S1 | `/crm/dashboard` | Jobs Today, Pending Quotes, Open Invoices, Outstanding Receivables | |
| S2 | `/crm/contacts` | Contacts list | |
| S3 | `/crm/jobs` | Jobs list + "New Job" | |
| S4 | `/crm/schedule` | Dispatch / calendar view | |
| S5 | `/crm/quotes` | Quotes list | |
| S6 | `/crm/invoices` | Invoices list | |
| S7 | `/crm/documents` | Document library | |
| S8 | Customer portal link | Portal is reachable per contact | |
| S9 | Mobile tech app route | `/crm/tech` or similar — technician view loads | |

**Workflow:** Create contact → job → quote → approve → invoice → record payment. Any step fails = record.

---

## PHASE 4 — Pro tier features (MUST EXIST)

| # | URL | Expected | Result |
|---|---|---|---|
| P1 | `/crm/routing` or `/crm/dispatch` | Route optimization UI with a map and "Optimize" button | |
| P2 | `/crm/geofences` | Geofence list. Create geofence button | |
| P3 | `/crm/pricebook` | Flat-rate pricebook with categories | |
| P4 | `/crm/agreements` | Service agreements list | |
| P5 | `/crm/reviews` | **Review requests dashboard + Settings tab. ⚠ Built 2026-04-13 — verify it actually loads on Wrench** | |
| P6 | `/crm/booking` | Online booking settings | |
| P7 | `/crm/team` | Team members list | |
| P8 | `/crm/settings/integrations` | QuickBooks sync button | |
| P9 | `/crm/time` | Auto clock in/out with GPS-based clock-in | |
| P10 | `/crm/recurring` | Recurring jobs list | |

---

## PHASE 5 — Business tier features (MUST EXIST)

| # | URL | Expected | Result |
|---|---|---|---|
| B1 | `/crm/equipment` | Customer equipment tracking list. Link equipment to contact | |
| B2 | `/crm/inventory` | Parts inventory list. Stock levels visible | |
| B3 | `/crm/fleet` | Fleet vehicles list | |
| B4 | `/crm/agreements` or `/crm/maintenance-contracts` | Maintenance contracts tab / page | |
| B5 | `/crm/warranties` | Warranties page | |
| B6 | `/crm/marketing` | Email campaigns dashboard | |
| B7 | `/crm/call-tracking` | Call tracking page | |
| B8 | Quote → financing | Wisetack consumer financing on quotes | |
| B9 | `/crm/reports` | Advanced reporting dashboard | |

---

## PHASE 6 — Fleet tier features (MUST EXIST — the tier we signed up on)

**⚠ CRITICAL:** All shipped in commit `afd4a32` on 2026-04-13, never tested on live tenant. Migration `0005_add_fleet_tier_features.sql` must have applied or Locations/Commissions 404.

| # | URL | Expected | Result |
|---|---|---|---|
| F1 | `/crm/locations` | Branch locations grid. Create branch (code + manager) | |
| F2 | `/crm/commissions` | Commissions page with **Plans** tab and **Earnings** tab | |
| F3 | Commissions → Plans | Create plan: percent_of_invoice, 10%, applies to Technician role | |
| F4 | Commissions → Earnings | Create commission record. Workflow: pending → approve → mark paid | |
| F5 | `/crm/call-tracking` | Call recording: recording_url, transcription, consent columns visible on a call detail | |
| F6 | `/crm/dispatch` or `/crm/schedule` | Multi-location dispatch filter (filter by branch) | |
| F7 | Reports | "Revenue by location" and "Revenue by technician" reports available | |

**Fleet workflow smoke test:**
1. Create two branches: Chicago (CHI), Milwaukee (MKE)
2. Create a commission plan at 10% for Technician role
3. Assign a test job to a technician, mark it paid, verify a commission record appears in Earnings
4. Approve the commission, mark it paid — verify status updates

---

## PHASE 7 — Bundled website (Service area pages, since Fleet tier)

`https://{slug}-site.onrender.com`

| # | Page | Expected | Result |
|---|---|---|---|
| W1 | Home | Company name, #059669 branding | |
| W2 | Services | Field-service cards | |
| W3 | **Service areas** | **Per-city landing pages (Eau Claire, Chippewa Falls, etc.). Fleet tier MUST include this** | |
| W4 | Book now | Public booking widget loads | |
| W5 | Contact | Form submits → lead appears in CRM | |
| W6 | `/admin` | CMS loads | |

---

## PHASE 8 — Enterprise gating (expected MISSING)

| # | URL | Expected | Result |
|---|---|---|---|
| E1 | Settings → White-label | Upgrade prompt | |
| E2 | Settings → SSO | Upgrade prompt | |
| E3 | Settings → API tokens | Upgrade prompt | |

---

## PHASE 9 — Report

```
WRENCH E2E TEST — {date}
Tenant: {slug}
Tier: Fleet

STARTER:   {n} PRESENT / {n} MISSING / {n} BROKEN
PRO:       {n} PRESENT / {n} MISSING / {n} BROKEN
BUSINESS:  {n} PRESENT / {n} MISSING / {n} BROKEN
FLEET:     {n} PRESENT / {n} MISSING / {n} BROKEN
WEBSITE:   {n} PRESENT / {n} MISSING / {n} BROKEN
ENTERPRISE GATING: {PASS/FAIL}

MISSING FEATURES:
- {row ID}: {URL} — {notes}

BROKEN FEATURES:
- {row ID}: {URL} — {error}

WORKFLOW:
- Starter: PASS / FAIL ({step})
- Fleet: PASS / FAIL ({step})

CRITICAL FINDINGS:
- {anything blocking}
```
