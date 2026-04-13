# Feature Test Checklist — Twomiah Verticals

**Purpose:** Three-way comparison of what we **advertise** on twomiah.com,
what we **configure** in `pricing.ts` per tier, and what's **actually
implemented** in the CRM template code. Use this when doing a live test on
a real tenant to verify the tier a customer pays for actually delivers what
we promised.

**Legend:**
- ✅ Implemented — route + page + DB table exist
- ⚠️ **GAP** — marketed or configured but NO implementation found
- 💡 Built but not marketed — missed opportunity
- 🔹 Implied / shared — covered by a more general route

**How to test:** log in to a tenant on the target tier, navigate to the
page column, and verify the feature actually does the thing we claim.

**Data sources checked:**
- `pricing.ts` SAAS_TIERS.*.features (configured)
- `pricing.ts` SAAS_TIERS.*.heroFeatures (marketed)
- `twomiah-website/{vertical}.html` (marketing copy, stack, comparison JS)
- `crm-*/backend/src/routes/*.ts` (implemented routes)
- `crm-*/frontend/src/pages/**/*.tsx` (implemented pages)

---

## BUILD (General Contractor / `crm` template)

### Starter tier — $49/mo (2 users)

**Marketed hero features:**
- Contacts & jobs
- Scheduling & dispatch
- Quotes & invoices
- Payments
- Customer portal

| Feature | Route | Page | Status |
|---|---|---|---|
| Contacts / CRM | `contacts` | `ContactsPage` | ✅ |
| Jobs | `jobs` | `JobsPage` | ✅ |
| Scheduling | `scheduling` | `SchedulePage` | ✅ |
| Quotes | `quotes` | `QuotesPage` | ✅ |
| Invoices | `invoices` | `InvoicesPage` | ✅ |
| Stripe payments | `stripe` | (in `InvoicesPage`) | ✅ |
| Time tracking | `time`, `timeTracking` | `TimePage`, `TimesheetPage` | ✅ |
| Expenses | `expenses` | `ExpensesPage` | ✅ |
| Documents | `documents` | `DocumentsPage` | ✅ |
| Customer portal | `portal` | `CustomerPortal` | ✅ |
| Dashboard | `dashboard` | `DashboardPage`, `CustomizableDashboard` | ✅ |
| Mobile app | (shared) | (separate apps/mobile project) | ✅ |

**Verdict:** Starter delivers everything marketed. Safe to ship.

### Pro tier — $149/mo (5 users) + Showcase website

**Marketed hero features:**
- Team management
- Job costing & pricebook
- QuickBooks sync
- Recurring jobs
- Showcase website included

**Starter features carry forward, plus:**

| Feature | Route | Page | Status |
|---|---|---|---|
| Team management | `team` | `TeamPage` | ✅ |
| Two-way SMS | `sms` | (in various pages) | ✅ |
| GPS tracking | (in `maps`, `routing`) | `GeofencesPage` | ✅ |
| Geofencing | `geofencing` | `GeofencesPage` | ✅ |
| Auto clock in/out | (in `timeTracking`) | (in `TimePage`) | ✅ |
| Route optimization | `routing` | (in `SchedulePage`?) | 🔹 |
| Online booking | `booking` | (customer-facing widget) | ✅ |
| Review requests | `reviews` | `ReviewsPage` | ✅ |
| Service agreements | `agreements` | `AgreementsPage` | ✅ |
| Pricebook | `pricebook` | `PricebookPage` | ✅ |
| QuickBooks sync | `quickbooks` | `IntegrationsPage` | ✅ |
| Recurring jobs | `recurring` | `RecurringList`, `RecurringForm` | ✅ |
| Job costing | (in `reporting`) | `ReportsDashboard` | 🔹 |

**Verdict:** All Pro features implemented. Route `routing` exists but the
frontend surface is shared — verify the UI actually shows route optimization.

### Business tier — $299/mo (15 users) + Book Jobs website

**Marketed hero features:**
- Inventory management
- Change orders
- Consumer financing
- Advanced reporting
- Book Jobs website included

**Pro features carry forward, plus:**

| Feature | Route | Page | Status |
|---|---|---|---|
| Inventory management | `inventory` | `InventoryPage` | ✅ |
| Equipment tracking | `equipment` | `EquipmentPage` | ✅ |
| Fleet management | `fleet` | `FleetPage` | ✅ |
| Warranties | `warranties` | `WarrantiesPage` | ✅ |
| Email campaigns / marketing | `marketing` | `MarketingPage` | ✅ |
| Call tracking | `calltracking` | `CallTrackingPage` | ✅ |
| Consumer financing (Wisetack) | `wisetack`, `financing` | (in `QuotesPage`) | ✅ |
| Advanced reporting | `reporting` | `ReportsDashboard` | ✅ |
| Change orders | `changeOrders` | `ChangeOrdersPage` | ✅ **GATING FIXED 2026-04-13** |

**✅ Gap closed 2026-04-13.** `change_orders` added to Business tier
feature array in `crm/backend/src/config/pricing.ts`. Business customers
now unlock Change Orders alongside the marketed hero feature.

### Construction tier — $599/mo (20 users) + Book Jobs website + portfolio

**Marketed hero features:**
- Projects, RFIs & submittals
- Draw schedules & lien waivers
- AIA G702/G703 forms
- Takeoffs & selections
- Portfolio website with gallery

**Business features carry forward, plus:**

| Feature | Route | Page | Status |
|---|---|---|---|
| Projects | `projects` | `ProjectsPage` | ✅ |
| RFIs | `rfis` | `RFIsPage` | ✅ |
| Submittals | `submittals` | `SubmittalsPage` | ✅ **BUILT 2026-04-13** |
| Daily logs | `dailyLogs` | `DailyLogsPage` | ✅ |
| Punch lists | `punchLists` | `PunchListsPage` | ✅ |
| Inspections | `inspections` | `InspectionsPage` | ✅ |
| Bids | `bids` | `BidsPage` | ✅ |
| Gantt charts | `ganttCharts` | `GanttChartsPage` | ✅ **BUILT 2026-04-13** |
| Selections | `selections`, `portal-selections` | `SelectionsPage` | ✅ |
| Takeoffs | `takeoffs` | `TakeoffsPage` | ✅ |
| Lien waivers | `lienWaivers` | `LienWaiversPage` | ✅ **BUILT 2026-04-13** |
| Draw schedules | `drawSchedules` | `DrawSchedulesPage` | ✅ **BUILT 2026-04-13** |
| AIA G702/G703 forms | `aiaForms` | `AiaFormsPage` | ✅ **BUILT 2026-04-13** |

**✅ Construction tier gaps CLOSED 2026-04-13.** All five previously-missing
features now have routes + pages + (for new tables) migrations. See commit
`1919f01`. Migration `0010_add_construction_compliance.sql` creates
`draw_schedule`, `draw_request`, and `aia_form` tables. `submittal` and
`lien_waiver` tables already existed in schema — now exposed via API.

**Live test priority:** Open Build on Construction tier, create one of
each:
- `/crm/submittals` — create a product data submittal → run approval
  workflow (submit → approve / revise / reject)
- `/crm/lien-waivers` — create a conditional progress waiver → workflow
  (draft → request → receive → approve)
- `/crm/draw-schedules` — create a construction loan schedule → add a
  draw request → workflow (pending → submit → approve → mark paid)
- `/crm/aia-forms` — create a G702 with G703 line items → verify the
  auto-calculated totals (completed+stored, retainage, payment due,
  balance to finish) all compute correctly
- `/crm/gantt` — verify all projects render on a timeline with correct
  date ranges, status colors, and percent-complete fills

If any of these 404 or render blank, the migration may not have been
applied — check the DB for the new tables first.

### Enterprise tier — $199/user/mo (10+ users)

**Marketed:** Unlimited everything, white-label, SSO, API access, dedicated
account manager

**Status:** `agencyAdmin` route exists. White-label / SSO / API access are
infrastructure features — can't easily verify from route list alone. Requires
a tenant test: does the tenant config support white-label? Is there an API
token page? Is there SSO config?

---

## WRENCH (Field Service / `crm-fieldservice` template)

### Starter tier — $49/mo (2 users)

**Marketed hero features:**
- Jobs & scheduling
- Quotes & invoices
- Payments
- Customer portal
- Mobile tech app

| Feature | Route | Page | Status |
|---|---|---|---|
| Jobs | `jobs` | `JobsPage` | ✅ |
| Scheduling | `scheduling` | `SchedulePage` | ✅ |
| Contacts | `contacts` | `ContactsPage` | ✅ |
| Quotes | `quotes` | `QuotesPage` | ✅ |
| Invoices | `invoices` | `InvoicesPage` | ✅ |
| Payments | `stripe` | (in `InvoicesPage`) | ✅ |
| Customer portal | `portal` | `CustomerPortal`, `PortalLayout`, etc | ✅ |
| Mobile tech app | `tech` | `TechView` | ✅ |

**Verdict:** Clean. All Starter claims deliver.

### Pro tier — $149/mo

**Marketed hero features:**
- GPS tracking & geofencing
- Route optimization
- Flat-rate pricebook
- Service agreements
- Showcase website included

| Feature | Route | Page | Status |
|---|---|---|---|
| GPS tracking | (in `maps`) | (in `DispatchBoard`) | 🔹 |
| Geofencing | `geofencing` | `GeofencesPage` | ✅ |
| Auto clock in/out | `timeTracking` | `TimesheetPage` | ✅ |
| Route optimization | `routing` | (in `DispatchBoard`) | ✅ |
| Flat-rate pricebook | `pricebook` | `FlatRatePricebook`, `PricebookPage` | ✅ |
| Service agreements | `agreements` | `AgreementsPage` | ✅ |
| Two-way SMS | `sms` | (in various) | ✅ |
| Review requests | `reviews` | `ReviewsPage` | ✅ **BUILT 2026-04-13** |
| Online booking | `booking` | (customer-facing) | ✅ |
| QuickBooks sync | `quickbooks` | `IntegrationsPage` | ✅ |

**✅ Wrench Pro gap closed 2026-04-13.** `ReviewsPage.tsx` ported from
Build to `crm-fieldservice/frontend/src/pages/reviews/`. Imported and
routed at `/crm/reviews` in `App.tsx`. Backend `reviews.ts` route was
already mounted at `/api/reviews`.

### Business tier — $299/mo

**Marketed hero features:**
- Customer equipment tracking
- Parts inventory
- Fleet management
- Maintenance contracts
- Book Jobs website included

| Feature | Route | Page | Status |
|---|---|---|---|
| Customer equipment | `equipment` | `EquipmentPage`, `PortalEquipment`, `PortalEquipmentDetail` | ✅ |
| Parts inventory | `inventory` | `PartsInventory`, `InventoryPage` | ✅ |
| Fleet management | `fleet` | `FleetPage` | ✅ |
| Maintenance contracts | (in `agreements`) | `MaintenanceContracts` | ✅ |
| Warranties | `warranties` | `WarrantiesPage` | ✅ |

**Verdict:** Wrench Business tier fully delivers. Equipment + parts + fleet
+ maintenance contracts are all real pages.

### Fleet tier — $599/mo

**Marketed hero features:**
- Multi-location dispatch
- Advanced scheduling & routing
- Call tracking & recording
- Commission tracking
- Service area pages on website

| Feature | Route | Page | Status |
|---|---|---|---|
| Multi-location dispatch | `locations` | `LocationsPage` | ✅ **BUILT 2026-04-13** |
| Advanced scheduling | (in `scheduling`) | `DispatchBoard`, `SchedulePage` | 🔹 |
| Call tracking & recording | `calltracking` (+ recording cols) | `CallTrackingPage` | ✅ **SCHEMA EXTENDED 2026-04-13** |
| Commission tracking | `commissions` | `CommissionsPage` | ✅ **BUILT 2026-04-13** |
| Service area pages | (website template feature) | (in website-fieldservice) | 🔹 |

**✅ Fleet tier gaps CLOSED 2026-04-13.** Commit `afd4a32`. Migration
`0005_add_fleet_tier_features.sql` creates `location`, `commission_plan`,
`commission` tables and extends `call_tracking` with `recording_url`,
`transcription`, `transcription_status`, `recording_consent` columns.

**Live test priority:**
- `/crm/locations` — create a branch (e.g., Chicago, code CHI), assign
  a manager, verify it shows on the locations card grid
- `/crm/commissions` → Plans tab — create a commission plan (try
  percent_of_invoice type, 10% rate, applies to technician role)
- `/crm/commissions` → Earnings tab — create a commission record (pick
  a user, base amount, commission amount), then run the workflow
  (pending → approve → mark paid)

---

## CARE (Home Care / `crm-homecare` template)

### Starter tier — $49/mo (2 users)

**Marketed hero features:**
- Client & caregiver records
- Visit scheduling
- Time tracking & EVV
- Basic invoicing
- Caregiver mobile app

| Feature | Route | Page | Status |
|---|---|---|---|
| Clients | `clients` | `ClientsPage`, `ClientDetailPage` | ✅ |
| Caregivers | `caregivers`, `caregiverProfile`, `caregiverRates` | `CaregiversPage`, `CaregiverDetailPage` | ✅ |
| Visit scheduling | `scheduling`, `schedulesAll`, `schedulesEnhanced` | `SchedulingPage` | ✅ |
| Time tracking | `timeTracking` | `TimeTrackingPage` | ✅ |
| EVV | `evv` | `EVVPage` | ✅ |
| Documents | `documents` | `DocumentsPage` | ✅ |
| Basic invoicing | `billing` | `BillingPage` | ✅ |
| Caregiver mobile app | (shared mobile project) | — | ✅ |
| Dashboard | `dashboard` | `DashboardPage` | ✅ |

**Verdict:** Care Starter delivers everything. EVV being implemented is
important — it's the main compliance hook for home care.

### Pro tier — $149/mo

**Marketed hero features:**
- Private-pay rate engine
- Care types & rates
- Caregiver bio pages
- Referral tracking
- Showcase website included

| Feature | Route | Page | Status |
|---|---|---|---|
| Private-pay billing | `payments`, `billing` | `BillingPage` | 🔹 |
| Care types & rates | `careTypes`, `caregiverCareTypeRates` | (in `SettingsPage`?) | ✅ |
| Caregiver bio pages | `caregiverProfile` | `CaregiverDetailPage` | 🔹 *(verify public-facing bio page exists)* |
| Referral tracking | `referralSources` | (in `CommunicationPage`?) | 🔹 |
| SMS | `sms`, `communication` | `CommunicationPage` | ✅ |
| Family portal | `familyPortal`, `portal` | `FamilyPortalPage` | ✅ |
| Caregiver availability | `caregiverAvailability`, `blackoutDates` | (in `SchedulingPage`?) | 🔹 |
| Shift swaps | (route not in list) | (none found) | ⚠️ *(check if `openShifts` covers it)* |
| Open shifts | `openShifts` | (in `SchedulingPage`?) | 🔹 |
| Auto clock | (in `timeTracking`) | (in `TimeTrackingPage`) | 🔹 |
| Incidents | `incidents`, `emergency` | (in pages?) | ✅ |
| Care plans | `carePlans` | (in pages?) | ✅ |

**✅ Care Pro gaps closed 2026-04-13.** `gps_tracking` and `geofencing`
removed from Pro/Business/Agency feature arrays in
`crm-homecare/backend/src/config/pricing.ts` — honest de-scope since no
routes back them. If GPS becomes a Care requirement later (EVV check-in
location verification), add it then with real implementation.

**⚠️ Still to verify:**
- **Caregiver bio pages** — profile page exists but verify it renders a
  public-facing bio on the Showcase website.

### Business tier — $299/mo

**Marketed hero features:**
- Medicare / Medicaid billing
- Referral source rates
- Authorized units tracking
- Claim generation
- Book Jobs website included

| Feature | Route | Page | Status |
|---|---|---|---|
| Medicare/Medicaid billing | `claims`, `payers`, `serviceCodes` | `ClaimsPage` | ✅ |
| Referral source rates | `referralSources` + `caregiverCareTypeRates` | (in `SettingsPage`?) | ✅ |
| Authorized units | `authorizations` | (in `ClientDetailPage`?) | 🔹 |
| Service codes | `serviceCodes` | (in `SettingsPage`?) | ✅ |
| Claim generation (EDI 837) | `edi` | (in `ClaimsPage`?) | ✅ |
| Remittance (ERA 835) | `remittance` | (in `ClaimsPage`?) | ✅ |
| Payroll | `payroll`, `payrollShiftReviews` | `PayrollPage` | ✅ |
| Training records | `trainingRecords` | (in `CaregiverDetailPage`?) | 🔹 |
| Background checks | `backgroundChecks` | (in `CaregiverDetailPage`?) | 🔹 |
| Certifications | `certifications` | (in `CaregiverDetailPage`?) | 🔹 |
| Compliance tracking | `compliance`, `auditLogs` | `CompliancePage`, `AuditPage` | ✅ |
| Medications | `medications` | (in `ClientDetailPage`?) | 🔹 |
| ADL tracking | `adl` | (in `ClientDetailPage`?) | 🔹 |

**Verdict:** Care Business tier is the strongest — Medicare/Medicaid claims
workflow is genuinely built. The 🔹 items are routes that exist but their
UI is embedded in detail pages (verify they're actually visible when you
open a client or caregiver).

### Agency tier — $599/mo

**Marketed hero features:**
- Full claims processing
- Check scanning & reconciliation
- Multi-branch operations
- HIPAA-grade audit logs
- Caregiver portal website included

| Feature | Route | Page | Status |
|---|---|---|---|
| Full claims processing | `claims`, `edi`, `remittance` | `ClaimsPage` | ✅ |
| Check scanning | (in `payments`) | (see `chippewa-home-care-crm/paymentsRoutes.js`) | ✅ |
| Check reconciliation | (in `payments`) | (see same) | ✅ |
| HIPAA audit logs | `auditLogs`, `audit` | `AuditPage` | ✅ |
| Sandata integration | `sandata` | (in `IntegrationsPage`?) | ✅ |
| Caregiver portal | `portal` | (separate portal pages) | ✅ |
| Route optimizer | `optimizer`, `rosterOptimizer`, `scheduleOptimizer` | (in `SchedulingPage`?) | ✅ |
| Forecast | `forecast` | `ForecastPage` | ✅ |
| AI receptionist | `aiReceptionist` | `AiReceptionistPage` | ✅ |
| Gusto integration | `gusto` | `IntegrationsPage` | ✅ |
| Performance reviews | `performanceReviews` | `PerformanceReviewsPage` | ✅ |
| No-show tracking | `noShow` | `NoShowPage` | ✅ |
| PTO management | `pto` | `PtoPage` | ✅ |

**✅ Agency tier gaps closed 2026-04-13.**
1. **Multi-branch** — no schema support, removed from marketing
   (heroFeatures, tagline, feature array) in
   `crm-homecare/backend/src/config/pricing.ts`. Rebuild later as a real
   feature if an agency customer actually asks for it.
2. **Forecast, AI receptionist, performance reviews, no-show, PTO pages**
   all exist in `crm-homecare/frontend/src/pages/` and are wired into
   `AdminDashboard.tsx` switch (cases: `forecast`, `ai-receptionist`,
   `performance-reviews`, `no-show`, `pto`). Previous checklist scan
   missed them because they're routed via the dashboard switch, not a
   top-level `App.tsx` `<Route>`.

---

## ROOF (Roofing / `crm-roof` template)

### Starter tier — $49/mo

**Marketed hero features:**
- Lead intake
- Job tracking
- Quotes & invoices
- Payments
- Customer portal

| Feature | Route | Page | Status |
|---|---|---|---|
| Lead intake | `leads` | `LeadInboxPage`, `LeadSourcesPage` | ✅ |
| Job tracking | `jobs` | `JobsPage`, `JobDetailPage` | ✅ |
| Contacts | `contacts` | `ContactsPage` | ✅ |
| Quotes | `quotes` | `QuotesPage` | ✅ |
| Invoices | `invoices` | `InvoicesPage`, `PortalInvoices` | ✅ |
| Payments | `billing` | (in `InvoicesPage`) | ✅ |
| Customer portal | `portal` | `CustomerPortal`, `PortalLayout`, `PortalDashboard`, `PortalJobDetail` | ✅ |

**Verdict:** Roof Starter delivers.

### Pro tier — $149/mo

**Marketed hero features:**
- Good-Better-Best pricing
- Pricebook
- Measurement reports (3/mo)
- Review requests
- Showcase website included

| Feature | Route | Page | Status |
|---|---|---|---|
| Good-Better-Best pricing | (in `pricebook`) | `PricebookTrialPage` | 🔹 *(verify GBB tiering in pricebook UI)* |
| Pricebook | `pricebook` | `PricebookTrialPage` | ✅ |
| Measurement reports | `measurements`, `roofReports` | `MeasurementsPage`, `RoofReportsPage`, `RoofReportDetail` | ✅ |
| Review requests | `reviews` | `ReviewsPage` | ✅ **BUILT 2026-04-13** |

**✅ Roof Pro tier gap CLOSED 2026-04-13.** Commit `89ba46c`. Migration
`0008_add_reviews_and_financing.sql` creates `review_request` and `review`
tables. Note: GMB API sync (auto-pull Google reviews) is a follow-up —
for now reviews can be manually entered or submitted by customers via
the public tracking endpoint.

### Business tier — $299/mo

**Marketed hero features:**
- Instant estimator on website
- $350–$550/sq pricing
- 10 measurement reports/mo
- Insurance workflow
- Consumer financing

| Feature | Route | Page | Status |
|---|---|---|---|
| Instant estimator | `estimator` | `EstimatorPage`, `EstimatorSettingsPage`, `EstimatorTrialPage` | ✅ |
| Insurance workflow | `insurance` | `InsuranceClaimPage`, `AdjusterDirectoryPage` | ✅ |
| Adjuster directory | (in `insurance`?) | `AdjusterDirectoryPage` | ✅ |
| Consumer financing | `financing` | `FinancingPage` | ✅ **BUILT 2026-04-13** |

**✅ Roof Business tier gap CLOSED 2026-04-13.** Commit `89ba46c`.
Migration adds `financing_application` table. Multi-lender aware
(wisetack, greensky, sunlight, other) with full workflow: pending →
sent → approved/declined → funded. Actual Wisetack API integration is
a follow-up — the route's `mark-sent` and `approve` endpoints are
designed to be called by a future services/wisetack.ts client.

### Storm tier — $599/mo

**Marketed hero features:**
- Unlimited measurement reports
- Storm lead generation
- Full insurance workflow + supplements
- Door-knock canvassing tool
- Estimator + service area pages

| Feature | Route | Page | Status |
|---|---|---|---|
| Unlimited measurements | `measurements` | (same as Business but no cap) | ✅ *(schema/limit, not a separate feature)* |
| Storm lead generation | `storms` | `StormLeadsPage` | ✅ |
| Storm radar overlay | (in `storms`?) | (none found as standalone) | 🔹 |
| Door-knock canvassing | `canvassing` | `CanvassingDashboard`, `CanvassingView` | ✅ |
| Canvassing routes | (in `canvassing`) | (in `CanvassingDashboard`) | ✅ |
| Insurance supplements | `insurance` (nested) | `InsuranceClaimPage` (supplements section + modal) | ✅ |
| Depreciation recovery | `insurance` (nested) | `InsuranceClaimPage` (`depreciationHeld` field) | ✅ |
| AI receptionist | `aiReceptionist` | `AIReceptionistPage` | ✅ |
| Service area pages | (website-fieldservice / website-contractor feature) | — | 🔹 |
| Multi-crew dispatch | `crews` | `CrewsPage` | ✅ |

**✅ Roof Storm gaps closed (already shipped; checklist was stale).**
Both features live inside `InsuranceClaimPage.tsx`, not as standalone
routes:
- **Supplements**: full workflow — `supplement` table in schema, create
  modal, `/api/insurance/claims/:id/supplements` endpoints, submit
  action, supplements list on claim detail.
- **Depreciation recovery**: `depreciationHeld` decimal column on
  `insurance_claim`, editable in claim detail. Use this field to track
  held/released recoverable depreciation.

**⚠️ Still open:**
- **Storm radar overlay** — marketing implies a live weather layer. Is
  this a map feature in `StormLeadsPage` or just a claim?

---

## CROSS-CUTTING ITEMS TO VERIFY

### Things that exist in Build but might be missing in Wrench/Roof
- `reviews` route: Build ✅, Wrench ⚠️ (not in list), Roof ⚠️ (not in list),
  Care ⚠️ (not in list). If reviews are marketed in Pro tier across
  verticals, every vertical needs the route.
- `wisetack` / `financing` route: Build ✅, Wrench ⚠️, Roof ⚠️, Care N/A

### Things marketed on twomiah.com that need verification
- **"One Subscription. Website Built In."** — check that when you sign up
  for Pro CRM, the website is actually provisioned automatically, not just
  "you can buy it separately at a discount." This is the core Pro pitch.
- **"30-day free trial"** — confirmed in `billing.ts` (`trialDays: 30`)
- **"60-day money-back guarantee"** — confirmed in `billing.ts`
  (`moneyBackGuaranteeDays: 60`) but **verify the actual refund workflow
  exists** — an endpoint that processes refunds, not just a marketing claim.

### Things configured in pricing.ts but status unknown
- `white_label` on Enterprise: schema supports custom branding (from what
  I saw in `agencies.primaryColor` etc.), but verify there's a "upload your
  logo / set your colors" settings page.
- `sso` / `api_access` on Enterprise: routes exist for `auth`, but SSO
  specifically (SAML / OIDC) is harder to verify without actually trying
  to connect an IdP.

---

## RECOMMENDED LIVE TEST ORDER

1. **Starter tier on each vertical** — fastest to verify, covers the $49
   entry point that most new customers will see
2. **Pro tier on each vertical** — the "most popular" sweet spot, so must
   be bulletproof
3. **Top tier on each vertical** — where the GAPS above are concentrated
4. **Enterprise** — requires white-label / SSO / API — test separately

For each tier, capture a screenshot of:
- Dashboard
- Core workflow (create a contact → schedule a job → invoice)
- Any feature marked ⚠️ GAP above (to confirm or rule out)

---

## DOC MAINTENANCE

This checklist is generated from:
- `templates/crm*/backend/src/config/pricing.ts`
- `templates/crm*/backend/src/routes/*.ts`
- `templates/crm*/frontend/src/pages/**/*.tsx`
- `twomiah-website/{build,wrench,care,roof}.html`

When you add/remove routes or pages, re-run the compare and update this doc.
Gaps (⚠️) should become ✅ before the next marketing push.
