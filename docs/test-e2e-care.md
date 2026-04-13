# Twomiah Care — End-to-End Test Spec (Chrome / Computer Use)

**You are Claude in a Chrome browser. Verify every feature that SHOULD exist on each tier of Twomiah Care. MISSING is a valid — and important — result. Do not skip rows.**

Results: **PRESENT** / **MISSING** / **BROKEN** / **BLOCKED**. Screenshot failures. Finish every row.

---

## PHASE 1 — Sign up on the Agency tier

1. Navigate to: **https://twomiah.com/signup/care/** (or `/signup/homecare/`)
2. Wizard:
   - Company Name: `E2E Care Test {timestamp}`
   - Industry: Home Care / Home Health
   - Phone: 715-555-0301
   - Address: 300 Main Street, Eau Claire, WI 54701
   - Primary Color: #7c3aed
   - **Plan: Agency ($599/mo)**
   - Add-ons: check ALL available
   - Deploy: Basic ($299)
   - Admin: `e2e-care@twomiah.com` / `E2ECare2026!`
3. Screenshot confirmation. Record slug.

## PHASE 2 — Verify deploy

Wait 10 min. Visit CRM URL and log in.

---

## PHASE 3 — Starter tier features (MUST EXIST)

| # | URL | Expected | Result |
|---|---|---|---|
| S1 | `/crm/dashboard` | Clients, Active Caregivers, Visits Today, Hours This Week | |
| S2 | `/crm/clients` | Clients list. New Client button | |
| S3 | `/crm/caregivers` | Caregivers list | |
| S4 | `/crm/scheduling` | Visit scheduling calendar | |
| S5 | `/crm/time-tracking` or `/crm/time` | Time tracking page | |
| S6 | `/crm/evv` | **Electronic Visit Verification page — critical compliance feature** | |
| S7 | `/crm/documents` | Document library | |
| S8 | `/crm/billing` | Basic invoicing page | |
| S9 | Caregiver mobile app link | Mobile app URL reachable | |

**Workflow:** Create client → create caregiver → schedule a visit → caregiver clocks in/out → generate invoice.

---

## PHASE 4 — Pro tier features (MUST EXIST)

| # | URL | Expected | Result |
|---|---|---|---|
| P1 | `/crm/care-types` or Settings → Care Types | Care types & rate configuration | |
| P2 | `/crm/referral-sources` | Referral source tracking | |
| P3 | `/crm/family-portal` or portal-enable on client | Family portal access per client | |
| P4 | `/crm/caregiver-availability` | Availability calendar per caregiver | |
| P5 | `/crm/open-shifts` | Open shifts board | |
| P6 | `/crm/incidents` | Incident reports | |
| P7 | `/crm/care-plans` | Care plans per client | |
| P8 | `/crm/communication` or `/crm/messages` | Two-way SMS inbox | |
| P9 | Caregiver detail → Bio | Caregiver bio page with photo + description | |
| P10 | Public website → caregivers | Public bio pages rendered on Showcase website ⚠ **unverified — flag if missing** | |

**❌ DO NOT EXPECT:** `/crm/geofences` or `/crm/gps-tracking` — these were de-scoped on 2026-04-13. If they appear, flag it. If missing, that's correct.

---

## PHASE 5 — Business tier features (MUST EXIST)

| # | URL | Expected | Result |
|---|---|---|---|
| B1 | `/crm/claims` | Medicare/Medicaid claims list | |
| B2 | `/crm/payers` | Payers configuration | |
| B3 | `/crm/service-codes` | Service codes list | |
| B4 | `/crm/authorizations` or client → Authorizations tab | Authorized units tracking | |
| B5 | Claims → Generate EDI | EDI 837 claim generation works | |
| B6 | Claims → Remittance | ERA 835 remittance processing | |
| B7 | `/crm/payroll` | Payroll page with shift reviews | |
| B8 | Caregiver → Training | Training records tab/page | |
| B9 | Caregiver → Background checks | Background check status visible | |
| B10 | Caregiver → Certifications | Certifications list | |
| B11 | `/crm/compliance` | Compliance tracking page | |
| B12 | Client → Medications | Medications list | |
| B13 | Client → ADL | ADL (Activities of Daily Living) tracking | |

---

## PHASE 6 — Agency tier features (MUST EXIST — the tier we signed up on)

| # | URL | Expected | Result |
|---|---|---|---|
| A1 | `/crm/claims` | Full claims processing with batch actions | |
| A2 | `/crm/payments` or billing → check scanning | Check scanning / reconciliation UI | |
| A3 | `/crm/audit` | HIPAA audit log page | |
| A4 | `/crm/sandata` or Settings → Integrations → Sandata | Sandata integration configuration | |
| A5 | `/crm/caregiver-portal` or portal URL | Caregiver-facing portal loads | |
| A6 | `/crm/scheduling` → optimizer | Schedule / roster optimizer button visible | |
| A7 | `/crm/forecast` | **ForecastPage — exists per checklist, verify renders** | |
| A8 | `/crm/ai-receptionist` | **AiReceptionistPage — exists, verify** | |
| A9 | `/crm/performance-reviews` | **PerformanceReviewsPage — exists, verify** | |
| A10 | `/crm/no-show` | **NoShowPage — exists, verify** | |
| A11 | `/crm/pto` | **PtoPage — exists, verify** | |
| A12 | Settings → Integrations → Gusto | Gusto integration toggle | |

**❌ DO NOT EXPECT "Multi-branch operations":** de-scoped from marketing on 2026-04-13. If a multi-branch page exists, that's a surprise — report it as an unexpected find.

**Agency workflow smoke test:**
1. Create a client with Medicare payer
2. Create a service authorization for 40 hours
3. Schedule a visit, clock in via EVV, clock out
4. Generate a claim from that visit
5. Export EDI 837 — verify file downloads
6. Open `/crm/audit` — verify the above actions appear in the HIPAA log

---

## PHASE 7 — Bundled website (Caregiver portal website, since Agency tier)

`https://{slug}-site.onrender.com`

| # | Page | Expected | Result |
|---|---|---|---|
| W1 | Home | Company name, #7c3aed branding | |
| W2 | Services | Home care service cards | |
| W3 | **Caregivers** | **Public caregiver bio pages. Agency tier MUST include this** | |
| W4 | Careers / Apply | Caregiver application form | |
| W5 | Contact | Form submits → lead in CRM | |
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
CARE E2E TEST — {date}
Tenant: {slug}
Tier: Agency

STARTER:   {n} PRESENT / {n} MISSING / {n} BROKEN
PRO:       {n} PRESENT / {n} MISSING / {n} BROKEN
BUSINESS:  {n} PRESENT / {n} MISSING / {n} BROKEN
AGENCY:    {n} PRESENT / {n} MISSING / {n} BROKEN
WEBSITE:   {n} PRESENT / {n} MISSING / {n} BROKEN
ENTERPRISE GATING: {PASS/FAIL}

DE-SCOPED FEATURES (should NOT appear):
- GPS / Geofencing: {not found = CORRECT / found = UNEXPECTED}
- Multi-branch operations: {not found = CORRECT / found = UNEXPECTED}

MISSING FEATURES:
- {row}: {URL} — {notes}

BROKEN FEATURES:
- {row}: {URL} — {error}

WORKFLOW:
- Starter: PASS / FAIL
- Agency: PASS / FAIL

CRITICAL FINDINGS:
```
