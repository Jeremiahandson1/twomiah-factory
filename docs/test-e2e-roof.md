# Twomiah Roof — End-to-End Test Spec (Chrome / Computer Use)

**You are Claude in a Chrome browser. Verify every feature that SHOULD exist on each tier of Twomiah Roof. Report MISSING for anything in the MUST EXIST lists you cannot reach. Do not skip rows.**

Results: **PRESENT** / **MISSING** / **BROKEN** / **BLOCKED**. Screenshot failures. Finish every row.

---

## PHASE 1 — Sign up on the Storm tier

1. Navigate to: **https://twomiah.com/signup/roof/**
2. Wizard:
   - Company Name: `E2E Roof Test {timestamp}`
   - Industry: Roofing
   - Phone: 715-555-0401
   - Address: 400 Main Street, Eau Claire, WI 54701
   - Primary Color: #dc2626
   - **Plan: Storm ($599/mo)**
   - Add-ons: check ALL
   - Deploy: Basic ($299)
   - Admin: `e2e-roof@twomiah.com` / `E2ERoof2026!`
3. Screenshot. Record slug.

## PHASE 2 — Verify deploy

Wait 10 min. Visit CRM + website URLs. Log in.

---

## PHASE 3 — Starter tier features (MUST EXIST)

| # | URL | Expected | Result |
|---|---|---|---|
| S1 | `/crm/dashboard` | Leads, Jobs, Pending Quotes, Open Invoices | |
| S2 | `/crm/leads` | Lead inbox | |
| S3 | `/crm/contacts` | Contacts list | |
| S4 | `/crm/jobs` | Jobs list | |
| S5 | `/crm/quotes` | Quotes list | |
| S6 | `/crm/invoices` | Invoices list | |
| S7 | `/crm/documents` | Document library | |
| S8 | Customer portal per contact | Portal link generates and loads | |

**Workflow:** Lead → convert to contact → create job → quote → approve → invoice → payment.

---

## PHASE 4 — Pro tier features (MUST EXIST)

| # | URL | Expected | Result |
|---|---|---|---|
| P1 | `/crm/pricebook` | Pricebook. Good-Better-Best tier toggle on items | |
| P2 | `/crm/measurements` or `/crm/roof-reports` | Measurement reports list. Order a report button | |
| P3 | `/crm/reviews` | **Review requests dashboard + Settings tab. ⚠ Built 2026-04-13 — verify loads** | |
| P4 | `/crm/team` | Team members list | |
| P5 | Settings → integrations → QuickBooks | QB sync button | |
| P6 | Jobs → photos | Before/after photo galleries per job | |
| P7 | Settings → SMS templates | SMS template config | |

---

## PHASE 5 — Business tier features (MUST EXIST)

| # | URL | Expected | Result |
|---|---|---|---|
| B1 | `/crm/estimator` or `/crm/instant-estimator` | Instant estimator configuration | |
| B2 | Public website → estimator | Estimator widget on public site works | |
| B3 | `/crm/insurance` | Insurance claims list | |
| B4 | `/crm/insurance/adjusters` or Adjuster Directory page | Adjuster directory | |
| B5 | `/crm/financing` | **Consumer financing page. ⚠ Built 2026-04-13 — verify Wisetack/GreenSky workflow renders** | |
| B6 | `/crm/materials` | Materials management list | |
| B7 | `/crm/crews` | Crews list. Assign crew to job | |
| B8 | `/crm/call-tracking` | Call tracking page | |
| B9 | `/crm/marketing` | Email campaigns | |
| B10 | `/crm/reports` | Advanced reporting | |

---

## PHASE 6 — Storm tier features (MUST EXIST — the tier we signed up on)

| # | URL | Expected | Result |
|---|---|---|---|
| ST1 | `/crm/storms` | Storms dashboard + storm leads list | |
| ST2 | Storms page → map | **Storm radar overlay — live weather layer on map. ⚠ UNVERIFIED — if no radar overlay, record MISSING even though the storms page loads** | |
| ST3 | `/crm/canvassing` | Canvassing dashboard | |
| ST4 | Canvassing → routes | Door-knock route planner | |
| ST5 | `/crm/insurance/:id` | Insurance claim detail page. **Supplements** section visible with "Add Supplement" modal. **Depreciation Held** field editable | |
| ST6 | Insurance claim → supplement workflow | Create supplement → submit → approve | |
| ST7 | `/crm/ai-receptionist` | AI receptionist page | |
| ST8 | `/crm/crews` | Multi-crew dispatch | |
| ST9 | Measurement reports | Unlimited — create > 10 reports without hitting a limit | |

**Storm workflow smoke test:**
1. Create a storm event in Storms dashboard
2. Import / create 5 storm leads
3. Plan a canvassing route for a neighborhood
4. Create an insurance claim with a $10,000 estimate, $3,000 depreciation held
5. Add a $2,500 supplement, submit, approve — verify supplement total on claim updates to $2,500
6. Mark claim as completed — verify depreciation recovery flow (depreciation held → released)

---

## PHASE 7 — Bundled website (since Storm tier)

`https://{slug}-site.onrender.com`

| # | Page | Expected | Result |
|---|---|---|---|
| W1 | Home | #dc2626 branding | |
| W2 | **Instant estimator** | Estimator widget on home or services page | |
| W3 | **Service area pages** | Per-city landing pages | |
| W4 | Gallery | Before/after project gallery | |
| W5 | Contact | Form → CRM lead | |
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
ROOF E2E TEST — {date}
Tenant: {slug}
Tier: Storm

STARTER:   {n} PRESENT / {n} MISSING / {n} BROKEN
PRO:       {n} PRESENT / {n} MISSING / {n} BROKEN
BUSINESS:  {n} PRESENT / {n} MISSING / {n} BROKEN
STORM:     {n} PRESENT / {n} MISSING / {n} BROKEN
WEBSITE:   {n} PRESENT / {n} MISSING / {n} BROKEN
ENTERPRISE GATING: {PASS/FAIL}

KNOWN SOFT SPOT RESULTS:
- Storm radar overlay (ST2): PRESENT / MISSING — if missing, marketing claim should be removed
- Reviews page (P3, built today): PRESENT / BROKEN
- Financing page (B5, built today): PRESENT / BROKEN
- Supplements + depreciation (ST5, ST6): PRESENT / BROKEN

MISSING FEATURES:
- {row}: {URL} — {notes}

BROKEN FEATURES:
- {row}: {URL} — {error}

WORKFLOW:
- Starter: PASS / FAIL
- Storm: PASS / FAIL

CRITICAL FINDINGS:
```
