# Twomiah Factory E2E Test — Roofing STORM Tier (Twomiah Roof)

You are QA testing Twomiah Factory, a SaaS platform that generates and deploys CRM + Website software for service businesses. This is a LIVE production test of the **STORM tier ($599/mo)** — the most expensive Roof tier, which includes ALL features from Starter ($49), Pro ($149), and Business ($299) PLUS Storm-exclusive features: unlimited measurement reports, storm lead generation, full insurance workflow with supplements, door-knock canvassing, AI receptionist, and multi-crew dispatch.

The roofing CRM has specialized features: Kanban pipeline board, insurance claim workflow, satellite roof reports, canvassing tools, storm lead generation, and a public instant estimator. Test everything.

Take screenshots at every major step. Report pass/fail for each feature.

---

## PHASE 1: SIGNUP

1. Navigate to: **https://twomiah.com/signup/roof/**
2. Complete the signup wizard:

**Step 0 — Company Info:**
- Company Name: "Badger Storm Roofing QA"
- Industry: Roofing
- Phone: 715-555-0599
- Address: 500 Storm Chase Lane
- City: Eau Claire
- State: Wisconsin
- ZIP: 54701
- Domain: (leave blank)
- Timezone: America/Chicago

**Step 1 — Branding:**
- Skip logo upload
- Primary Color: #D97706 (amber/orange)

**Step 2 — Website Template:**
- Select the roofing or contractor template

**Step 3 — Plan & Billing:**
- Select **Storm** tier ($599/mo) — THIS IS THE TOP TIER, verify it is offered and selectable
- Hosting: SaaS
- Features/Add-ons: Check ALL available (Pipeline Board, Mobile Estimating, Photo Documentation, Crew Scheduling, Insurance Workflow, Canvassing, Storm Leads, AI Receptionist, etc.)
- Migration Source: "No migration needed"
- Test Card: **4242 4242 4242 4242**, Exp: 12/28, CVC: 123, ZIP: 54701

**Step 4 — Deploy Service:**
- Select "Basic" ($299)

**Step 5 — Admin Account:**
- First Name: Test
- Last Name: RoofStorm
- Email: test-roof-storm@twomiah.com
- Password: TestRoofStorm2026!

**Step 6 — Review & Submit:**
- Verify all details: Storm tier $599/mo, company name, admin email
- Check terms, submit

3. **After submission:** Screenshot, note slug ("badger-storm-roofing-qa"), note Stripe redirect if any

- [ ] Signup wizard loaded correctly
- [ ] Storm tier ($599/mo) was selectable
- [ ] Payment processed with test card
- [ ] Confirmation page displayed with slug and deployment status

---

## PHASE 2: VERIFY GITHUB REPO

This is a critical check — previous roofing deploys failed because code wasn't pushed to GitHub.

1. Visit **https://github.com/Jeremiahandson1/badger-storm-roofing-qa**
2. Verify the repo contains actual application code:
   - [ ] `crm-roof/` directory exists with `backend/`, `frontend/`, and `landing/`
   - [ ] `crm-roof/backend/src/index.ts` exists
   - [ ] `crm-roof/backend/src/routes/` contains roofing-specific routes:
     - [ ] `insurance.ts` — insurance claim workflow
     - [ ] `canvassing.ts` — door-knock canvassing
     - [ ] `storms.ts` — storm lead generation
     - [ ] `roofReports.ts` — satellite roof reports
   - [ ] `crm-roof/frontend/src/` contains roofing pages:
     - [ ] `PipelineBoard.tsx` — Kanban board
     - [ ] `InsuranceClaimPage.tsx` — insurance workflow + supplements
     - [ ] `CanvassingDashboard.tsx` — canvassing tool
     - [ ] `StormLeadsPage.tsx` — storm lead generation
     - [ ] `AIReceptionistPage.tsx` — AI receptionist (Storm tier)
   - [ ] `website/` directory exists with `views/` and `admin/`
   - [ ] `render.yaml` exists at repo root with `rootDir: crm-roof/backend`
3. If repo only has README.md and deploy.sh — **STOP and report P0 bug** (the product name normalization fix may not have deployed)
4. Check GitHub shows **"TypeScript"** as the primary language, NOT "Shell"

- [ ] Repo exists and contains real application code
- [ ] TypeScript is primary language

---

## PHASE 3: VERIFY DEPLOYMENT

Wait 5-10 minutes after signup, then:

1. Visit **https://badger-storm-roofing-qa-roof-api.onrender.com** — CRM loads? (note: roofing uses `-roof-api` suffix)
2. Visit **https://badger-storm-roofing-qa-site.onrender.com** — Website loads with amber (#D97706) branding?

- [ ] CRM API is reachable and responding
- [ ] Website loads with correct amber branding
- [ ] No 502/503 errors from Render

---

## PHASE 4: CRM LOGIN

1. Login with: **test-roof-storm@twomiah.com** / **TestRoofStorm2026!**
2. Complete onboarding if shown
3. Screenshot the dashboard/pipeline board

- [ ] Login succeeds
- [ ] Pipeline board is the default view (at `/crm` or `/crm/pipeline`)
- [ ] Onboarding completed without errors

---

## PHASE 5: TEST PIPELINE BOARD (The Primary View)

### 5.1 Pipeline Board
- [ ] Navigate to Pipeline Board (this should be the default view at /crm or /crm/pipeline)
- [ ] Verify it shows a Kanban board with columns for each pipeline stage
- [ ] Expected stages (11): **Lead, Contact Made, Appointment Set, Inspection Scheduled, Inspected, Estimate Sent, Approved, Material Ordered, Scheduled, In Progress, Collected**
- [ ] Verify drag-and-drop works between stages
- [ ] Board is empty initially (no dummy data)

### 5.2 Create Jobs on Pipeline
- [ ] Create a new job:
  - Name/Contact: **"Tom Henderson"** (create contact inline or separately)
  - Address: 500 Pine St, Eau Claire, WI 54701
  - Job Type: **Insurance**
  - Priority: **High**
  - Stage: Lead
- [ ] Verify job card appears in "Lead" column
- [ ] Drag it to "Contact Made" — verify it moves
- [ ] Create second job:
  - Name/Contact: **"Susan Parker"**
  - Address: 600 Maple Dr, Eau Claire, WI 54701
  - Job Type: **Retail**
  - Stage: Lead
- [ ] Create third job:
  - Name/Contact: **"Downtown Office LLC"**
  - Address: 100 Broadway, Eau Claire, WI 54701
  - Job Type: **Commercial**
  - Stage: Appointment Set

### 5.3 Pipeline Filters
- [ ] Filter by Job Type: Insurance — only Tom shows
- [ ] Filter by Job Type: Retail — only Susan shows
- [ ] Filter by Job Type: Commercial — only Downtown Office shows
- [ ] Clear filters — all 3 show
- [ ] Filter by sales rep (if assigned)

---

## PHASE 6: TEST CONTACTS

### 6.1 Contacts CRUD
- [ ] Navigate to Contacts page
- [ ] Verify Tom Henderson, Susan Parker, Downtown Office LLC exist (created from pipeline)
- [ ] Open Tom Henderson detail — all fields populated?
- [ ] Edit Tom — add phone: 715-555-8001, email: tom@example.com
- [ ] Add a new contact:
  - Name: **"Adjuster Mike"**
  - Type: Vendor (or Other)
  - Company: **"State Farm"**
  - Phone: 715-555-8002
  - Email: mike@statefarm.example.com
- [ ] Search for "Henderson" — found?
- [ ] Search for "Adjuster" — found?

---

## PHASE 7: TEST LEADS

### 7.1 Lead Inbox
- [ ] Navigate to Lead Inbox (`LeadInboxPage`)
- [ ] Check for any leads (should be empty initially)
- [ ] Create a lead if possible:
  - Name: "New Lead Test"
  - Source: Website
  - Phone: 715-555-7001

### 7.2 Lead Sources
- [ ] Navigate to Lead Sources page (`LeadSourcesPage`)
- [ ] Configure a test lead source if possible
- [ ] Verify page loads without errors

---

## PHASE 8: TEST CREWS

### 8.1 Crews Management
- [ ] Navigate to Crews page (`CrewsPage`)
- [ ] Create a crew:
  - Name: **"Alpha Crew"**
  - Foreman: **"Carlos Ramirez"**
  - Phone: 715-555-9001
  - Crew Size: **4**
  - Subcontractor: **No**
- [ ] Create second crew:
  - Name: **"Beta Crew (Sub)"**
  - Foreman: **"Dave's Roofing"**
  - Phone: 715-555-9002
  - Crew Size: **3**
  - Subcontractor: **Yes**
  - Company: "Dave's Roofing LLC"
- [ ] Verify both appear in crew list
- [ ] Assign Alpha Crew to Tom Henderson's job

---

## PHASE 9: TEST JOB DETAIL & PHOTOS

### 9.1 Job Detail Page
- [ ] Open Tom Henderson's job detail
- [ ] Verify all fields display correctly
- [ ] Auto-generated job number (ROOF-0001 format)?
- [ ] Advance status through stages using the advance button:
  - Lead -> Contact Made -> Appointment Set -> Inspection Scheduled
- [ ] Verify each status change is reflected on the detail page and the pipeline board

### 9.2 Photo Documentation
- [ ] Upload a photo to the job:
  - Type: **Damage**
  - Caption: **"Hail damage on north slope"**
- [ ] Upload a second photo:
  - Type: **Before**
  - Caption: **"Pre-work condition"**
- [ ] Verify photos appear in the gallery
- [ ] Verify photos appear in the timeline

### 9.3 Job Notes & Timeline
- [ ] Add a job note:
  - Type: **Internal**
  - Text: "Customer reported leak after last storm. Neighbor also has damage."
- [ ] Add an external note:
  - Text: "Scheduled inspection for Friday at 2 PM"
- [ ] Verify the timeline shows notes, photos, and any SMS messages merged together
- [ ] Check that internal notes are marked differently from external notes

---

## PHASE 10: TEST MEASUREMENTS & ROOF REPORTS

### 10.1 Measurements
- [ ] Navigate to Measurements page (`MeasurementsPage`)
- [ ] Check credit balance
- [ ] **VERIFY STORM TIER HAS UNLIMITED MEASUREMENTS** — Storm ($599) should have NO monthly cap (Starter: none, Pro: 3/mo, Business: 10/mo, Storm: unlimited)
- [ ] Order a measurement (if credits available):
  - Address: 500 Pine St, Eau Claire, WI 54701
  - Job: Tom Henderson
- [ ] If no credits, try purchasing credits (will go to Stripe)
- [ ] Try manual entry:
  - Total Squares: **28**
  - Notes: "Manually measured, simple hip roof"
- [ ] Verify measurement appears and links to job

### 10.2 Roof Reports (AI Satellite Analysis)
- [ ] Navigate to Roof Reports page (`RoofReportsPage`)
- [ ] Order a roof report:
  - Address: 500 Pine St, Eau Claire, WI 54701
  - Contact: Tom Henderson
  - Cost: **$9.99** — if Stripe checkout appears, note it
- [ ] If a report is generated/available:
  - [ ] Verify aerial imagery loads
  - [ ] Check AI-detected data: **condition score**, **material type**, **tree overhang %**
  - [ ] View roof segments with measurements
  - [ ] Open the **edge editor** — can you see the roof outline on the map?
  - [ ] Try editing a roof edge
  - [ ] **Finalize** the report
  - [ ] **Export/download PDF** if available

---

## PHASE 11: TEST PRICEBOOK (Good-Better-Best)

### 11.1 Pricebook with GBB Tiering
- [ ] Navigate to Pricebook page (`PricebookTrialPage`)
- [ ] Create a roof line item with **3 price tiers** (Good-Better-Best):
  - Item: "Architectural Shingles (per sq)"
  - Good: $175/sq (3-tab)
  - Better: $195/sq (Owens Corning Duration)
  - Best: $245/sq (Owens Corning Duration Designer)
- [ ] Verify all three tiers display and can be selected when building quotes
- [ ] Add additional items: Ice & Water Shield, Drip Edge, Ridge Vent

---

## PHASE 12: TEST REVIEWS (NEW 2026-04-13)

### 12.1 Review Requests
- [ ] Navigate to Reviews page (`ReviewsPage`)
- [ ] Send a review request:
  - Contact: Tom Henderson
  - Method: SMS or Email
- [ ] Verify request is sent/logged
- [ ] Check the public review submission endpoint works

---

## PHASE 13: TEST INSURANCE WORKFLOW

### 13.1 Insurance Claim
- [ ] Open Tom Henderson's job
- [ ] Navigate to the Insurance section (may be a tab or sub-page on `InsuranceClaimPage`)
- [ ] Create an insurance claim:
  - Insurance Company: **State Farm**
  - Policy Number: **SF-2024-123456**
  - Claim Number: **CLM-789012**
  - Deductible: **$1,000**
  - Date of Loss: (2 weeks ago)
  - Type of Damage: **Hail**
- [ ] Verify claim appears with status: **Filed**

### 13.2 Adjuster Management
- [ ] Add an adjuster to the claim:
  - Name: Adjuster Mike
  - Company: State Farm
  - Phone: 715-555-8002
  - Email: mike@statefarm.example.com
  - Territory: Western Wisconsin
- [ ] Advance claim: **Filed -> Adjuster Assigned -> Inspection Scheduled**

### 13.3 Claim Progression
- [ ] Update claim: **Inspection Scheduled -> Inspected**
- [ ] Add inspection notes: "Adjuster confirmed hail damage. 28 squares affected."
- [ ] Update financial values:
  - **RCV (Replacement Cost Value): $14,500**
  - **ACV (Actual Cash Value): $11,200**
- [ ] Advance: **Inspected -> Approved**
- [ ] Verify all status changes are tracked in claim timeline

### 13.4 SUPPLEMENTS (Storm Tier Feature)
Supplements live inside `InsuranceClaimPage` — not a standalone route.
- [ ] Create a supplement:
  - Reason: **"Additional damage found during tear-off — decking replacement needed"**
  - Amount: **$3,200**
  - Status: **Draft**
- [ ] Submit the supplement: **Draft -> Submitted**
- [ ] Approve the supplement: **Submitted -> Approved**
- [ ] Verify total claim value updates (should now include the $3,200 supplement)
- [ ] Verify supplement appears in the supplements list on the claim detail

### 13.5 DEPRECIATION RECOVERY (Storm Tier Feature)
The `depreciationHeld` decimal field lives on the `insurance_claim` table.
- [ ] Set depreciation held amount on the claim (e.g., $3,300 — the difference between RCV $14,500 and ACV $11,200)
- [ ] Verify the field saves correctly
- [ ] Verify it displays on the claim detail page
- [ ] Check that the depreciation recovery amount is reflected in financial summary

### 13.6 Xactimate Export
- [ ] Try exporting Xactimate scope document
- [ ] Verify line item codes are generated (RFG, WTR, GUT, etc.)

### 13.7 Claim Activity Log
- [ ] Add activities to the claim:
  - Note: "Called adjuster, left voicemail"
  - Call: "Spoke with adjuster, inspection scheduled for Friday"
  - Email: "Sent supplement documentation to adjuster"
- [ ] Verify activity timeline shows all entries chronologically

### 13.8 Adjusters Directory
- [ ] Navigate to Adjusters page (`AdjusterDirectoryPage`)
- [ ] Verify Adjuster Mike appears
- [ ] Add another adjuster:
  - Name: "Sarah Adjuster"
  - Company: "American Family"
  - Territory: "Eau Claire County"
- [ ] Search by carrier

---

## PHASE 14: TEST QUOTES & INVOICES

### 14.1 Quotes
- [ ] Create a quote for Tom Henderson:
  - Line items:
    1. "Tear-off existing shingles (28 sq)", Qty: 28, Price: **$85/sq = $2,380**
    2. "Install Owens Corning Duration (28 sq)", Qty: 28, Price: **$195/sq = $5,460**
    3. "Ice & Water Shield", Qty: 1, Price: **$850**
    4. "Drip Edge & Flashing", Qty: 1, Price: **$650**
    5. "Ridge Vent", Qty: 1, Price: **$425**
    6. "Cleanup & Haul Away", Qty: 1, Price: **$500**
  - Tax: **5.5%**
- [ ] Verify subtotal: $10,265.00
- [ ] Verify tax: $564.58
- [ ] Verify total calculates correctly: **~$10,829.58**
- [ ] Send the quote
- [ ] Approve the quote
- [ ] Download PDF

### 14.2 Invoices
- [ ] Create an invoice (or convert quote):
  - Same line items as quote
  - Due Date: 30 days
- [ ] Send invoice
- [ ] Record insurance payment: **$9,829.58** (total minus deductible)
- [ ] Record homeowner payment: **$1,000** (deductible)
- [ ] Verify status = **Paid**
- [ ] Download PDF
- [ ] Check QuickBooks sync status if available

---

## PHASE 15: TEST MATERIALS & SCHEDULING

### 15.1 Materials / Material Orders
- [ ] Navigate to Materials page
- [ ] Create a material order:
  - Supplier: **"ABC Supply"**
  - Job: Tom Henderson
  - Items: "28 sq Owens Corning Duration, Ice & Water Shield, Drip Edge, Ridge Vent"
  - Status: Ordered
  - Delivery Date: (3 days from now)
- [ ] Update status: **Ordered -> Shipped -> Delivered**
- [ ] Verify delivery tracking works

### 15.2 Advance Job Through Final Stages
- [ ] On pipeline board, advance Tom's job:
  - Approved -> Material Ordered -> Scheduled -> In Progress -> Collected
- [ ] Verify the board reflects each move
- [ ] Check if SMS auto-triggers on certain stage transitions

---

## PHASE 16: TEST ESTIMATOR (Public-Facing Tool)

### 16.1 Estimator Settings
- [ ] Navigate to Settings > Estimator (`EstimatorSettingsPage`)
- [ ] Configure the instant estimator:
  - Price per square (low): **$350**
  - Price per square (high): **$550**
  - Headline: "Get Your Free Roof Estimate"
  - Disclaimer: "Estimates are approximate. Contact us for exact pricing."
- [ ] Enable the estimator
- [ ] Note the public URL

### 16.2 Public Estimator Page
- [ ] Visit the public estimator URL
- [ ] Enter an address: **500 Pine St, Eau Claire, WI 54701**
- [ ] Verify it calculates an estimate based on satellite data
- [ ] Check the price range displays correctly (28 sq x $350 = $9,800 to 28 sq x $550 = $15,400)
- [ ] Fill in the lead capture form:
  - Name: "Estimator Test Lead"
  - Email: estimator@example.com
  - Phone: 715-555-6666
- [ ] Submit — verify lead is captured
- [ ] Back in CRM, check if the estimator lead appeared in Lead Inbox

---

## PHASE 17: TEST FINANCING (NEW 2026-04-13)

### 17.1 Financing Application
- [ ] Navigate to Financing page (`FinancingPage`)
- [ ] Submit a financing application:
  - Contact: Susan Parker
  - Amount: $10,829.58
  - Lender: **wisetack** (also test greensky/sunlight/other options are available)
- [ ] Verify workflow: **pending -> sent -> approved -> funded**
- [ ] Check that all four lender options are available: wisetack, greensky, sunlight, other
- [ ] Note: actual Wisetack API integration is a follow-up — verify the UI workflow functions

---

## PHASE 18: TEST CANVASSING (Storm Tier Feature)

### 18.1 Canvassing Dashboard
- [ ] Navigate to Canvassing Dashboard (`CanvassingDashboard`)
- [ ] Verify page loads with session overview
- [ ] Check stats display (stops by outcome)

### 18.2 Canvassing Session
- [ ] Create a canvassing session:
  - Area: **"Pine Street neighborhood"**
  - Weather Event: **Hail** (after recent hail storm)
- [ ] Navigate to the mobile canvassing view (`CanvassingView` at /canvass)
- [ ] Log stops:
  - Stop 1: **502 Pine St** — Outcome: **Interested**, Damage: **Hail, Missing Shingles**
  - Stop 2: **504 Pine St** — Outcome: **Not Interested**
  - Stop 3: **506 Pine St** — Outcome: **No Answer**
  - Stop 4: **508 Pine St** — Outcome: **Appointment Set**
- [ ] Verify map shows pins **color-coded by outcome** (e.g., green=Interested, red=Not Interested, gray=No Answer, blue=Appointment Set)
- [ ] Check canvassing scripts page (talking points for door-knock reps)

---

## PHASE 19: TEST STORM LEADS (Storm Tier Feature)

### 19.1 Storm Lead Generation
- [ ] Navigate to Storm Leads page (`StormLeadsPage`)
- [ ] Create a storm event:
  - Type: **Hail**
  - Date: last week
  - Area: **Eau Claire, WI 54701**
  - Hail Size: **1.5 inches**
  - Wind Speed: **60 mph**
- [ ] Generate leads from the storm event
- [ ] Verify leads appear with affected addresses
- [ ] Convert a storm lead to a job/contact
- [ ] Check map view of affected area

### 19.2 STORM RADAR OVERLAY — FLAG THIS
**IMPORTANT:** The feature checklist notes storm radar overlay as unclear (status unknown). Marketing implies a live weather radar layer on the storm leads map.
- [ ] Check if `StormLeadsPage` has a radar/weather overlay on the map
- [ ] If YES: describe what data source it uses (NWS? commercial radar API?)
- [ ] If NO: **FLAG as "Storm radar overlay is marketing-only — no live radar layer exists in the product."**
- [ ] This is a key finding for the final report

---

## PHASE 20: TEST AI RECEPTIONIST (Storm Tier Feature)

### 20.1 AI Receptionist
- [ ] Navigate to AI Receptionist page (`AIReceptionistPage`)
- [ ] Verify page loads
- [ ] Check configuration options:
  - [ ] Business name/greeting
  - [ ] Routing rules
  - [ ] After-hours behavior
  - [ ] FAQ/knowledge base settings
- [ ] Note whether this is a real integration or a placeholder page

---

## PHASE 21: TEST MULTI-CREW DISPATCH (Storm Tier Feature)

### 21.1 Multi-Crew Dispatch
- [ ] Navigate to Crews page (`CrewsPage`)
- [ ] Dispatch Tom Henderson's job to **Alpha Crew**
- [ ] Dispatch Susan Parker's job to **Beta Crew (Sub)**
- [ ] Verify crew assignments display correctly on both the crew page and job detail
- [ ] Check if dispatch notifications are sent (SMS/push)

---

## PHASE 22: TEST CALL TRACKING

### 22.1 Call Tracking
- [ ] Navigate to Call Tracking page
- [ ] Verify call log displays
- [ ] Check if tracking numbers are configured
- [ ] Note any integration with Twilio/call tracking provider

---

## PHASE 23: TEST CUSTOMER PORTAL

### 23.1 Portal Setup
- [ ] Enable portal for Tom Henderson (from Contacts or Job Detail)
- [ ] Get portal login info / magic link

### 23.2 Portal Features
- [ ] Login to portal
- [ ] Dashboard loads — shows job status
- [ ] View job detail — customer-friendly status language (not internal stage names)
- [ ] View photos & documents (damage photos from Phase 9)
- [ ] View invoices — can pay online?
- [ ] Submit a service request (e.g., warranty claim)
- [ ] Company contact info displayed ("Badger Storm Roofing QA")

---

## PHASE 24: TEST THE DEPLOYED WEBSITE (Estimator Website)

### 24.1 Public Pages
- [ ] Homepage loads — **"Badger Storm Roofing QA"** with **amber (#D97706) branding**
- [ ] Services page — roofing services (shingle, metal, flat, repairs, inspections)
- [ ] Gallery/Portfolio page
- [ ] Blog page
- [ ] Service area pages (Storm tier includes service area pages)
- [ ] Contact form page
- [ ] **Public estimator tool** embedded or linked
- [ ] Submit contact form:
  - Name: "Storm Damage Homeowner"
  - Email: storm@example.com
  - Phone: 715-555-5555
  - Message: "We had hail damage last week, need an inspection"
- [ ] Verify submission succeeds
- [ ] Mobile responsive — check on mobile viewport

### 24.2 CMS Admin
- [ ] Login at /admin
- [ ] Create a blog post:
  - Title: "What to Do After Storm Damage Hits Your Roof"
  - Content: Test content about storm damage inspection and insurance claims
- [ ] Edit services
- [ ] Add a testimonial:
  - Name: "Tom Henderson"
  - Text: "Badger Storm Roofing helped us through the entire insurance process after the hail storm."
  - Rating: 5 stars
- [ ] Check leads from contact form submission

---

## PHASE 25: WEBSITE-TO-CRM FLOW

### 25.1 Verify Lead Flow
- [ ] Check CRM Lead Inbox for the website contact form submission ("Storm Damage Homeowner")
- [ ] Check CRM Lead Inbox for the estimator lead ("Estimator Test Lead")
- [ ] Verify both leads have source attribution (Website, Estimator)
- [ ] Convert one to a contact/job — verify it works

---

## PHASE 26: TEST REPORTING & SETTINGS

### 26.1 Reports
- [ ] Navigate to Reports page
- [ ] Run reports: revenue, pipeline value, conversion rates, average deal size
- [ ] Export if available

### 26.2 Import
- [ ] Navigate to Import page
- [ ] Download CSV template
- [ ] Verify import functionality exists

### 26.3 Settings
- [ ] Company settings — verify name ("Badger Storm Roofing QA"), branding (#D97706)
- [ ] User management — list users (should show Test RoofStorm)
- [ ] Integration settings — QuickBooks, Twilio
- [ ] Feature toggles — verify ALL Storm tier features are enabled:
  - [ ] Pipeline Board
  - [ ] Insurance Workflow
  - [ ] Supplements
  - [ ] Canvassing
  - [ ] Storm Leads
  - [ ] Unlimited Measurements
  - [ ] AI Receptionist
  - [ ] Multi-Crew Dispatch
  - [ ] Estimator
  - [ ] Financing
  - [ ] Reviews
- [ ] Billing/subscription info — verify Storm tier $599/mo

---

## PHASE 27: FINAL SUMMARY

Complete this table with pass/fail for EVERY feature. **Bold** indicates Storm-tier-specific or roofing-specific features.

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | Signup Flow (Storm $599/mo) | Pass/Fail | |
| 2 | GitHub Repo Structure | Pass/Fail | |
| 3 | TypeScript Primary Language | Pass/Fail | |
| 4 | CRM Deployment | Pass/Fail | |
| 5 | Website Deployment | Pass/Fail | |
| 6 | CRM Login | Pass/Fail | |
| 7 | **Pipeline Board (Kanban, 11 stages)** | Pass/Fail | |
| 8 | **Drag-Drop Between Stages** | Pass/Fail | |
| 9 | **Pipeline Filters (by job type)** | Pass/Fail | |
| 10 | **Create Jobs (Insurance/Retail/Commercial)** | Pass/Fail | |
| 11 | Contacts CRUD | Pass/Fail | |
| 12 | Lead Inbox | Pass/Fail | |
| 13 | Lead Sources | Pass/Fail | |
| 14 | **Crews Management** | Pass/Fail | |
| 15 | **Job Detail & Status Advances** | Pass/Fail | |
| 16 | **Photo Documentation** | Pass/Fail | |
| 17 | **Job Notes & Timeline** | Pass/Fail | |
| 18 | **Measurements / Credits** | Pass/Fail | |
| 19 | **UNLIMITED MEASUREMENTS (Storm)** | Pass/Fail | Verify no monthly cap |
| 20 | **Roof Reports (AI Satellite)** | Pass/Fail | |
| 21 | **Roof Edge Editor** | Pass/Fail | |
| 22 | **Roof Report PDF Export** | Pass/Fail | |
| 23 | **Pricebook (Good-Better-Best)** | Pass/Fail | |
| 24 | Reviews (NEW 2026-04-13) | Pass/Fail | |
| 25 | **Insurance Claim Workflow** | Pass/Fail | Filed->Assigned->Scheduled->Inspected->Approved |
| 26 | **Adjuster Management** | Pass/Fail | |
| 27 | **Adjuster Directory** | Pass/Fail | |
| 28 | **RCV / ACV Financial Values** | Pass/Fail | |
| 29 | **SUPPLEMENTS (Storm)** | Pass/Fail | Draft->Submitted->Approved, $3,200 |
| 30 | **DEPRECIATION RECOVERY (Storm)** | Pass/Fail | depreciationHeld field |
| 31 | **Xactimate Export** | Pass/Fail | |
| 32 | **Claim Activity Log** | Pass/Fail | |
| 33 | Quotes + Tax Calc + PDF | Pass/Fail | ~$10,829.58 total |
| 34 | Invoices + Payments | Pass/Fail | Insurance $9,829.58 + Deductible $1,000 |
| 35 | **Material Orders** | Pass/Fail | ABC Supply, 28sq OC Duration |
| 36 | **Instant Estimator Settings** | Pass/Fail | $350-$550/sq |
| 37 | **Public Estimator Tool** | Pass/Fail | |
| 38 | **Estimator Lead Capture** | Pass/Fail | |
| 39 | Financing (NEW 2026-04-13) | Pass/Fail | wisetack/greensky/sunlight/other |
| 40 | **CANVASSING Dashboard (Storm)** | Pass/Fail | |
| 41 | **CANVASSING Mobile View (Storm)** | Pass/Fail | |
| 42 | **CANVASSING Map Pins (Storm)** | Pass/Fail | Color-coded by outcome |
| 43 | **CANVASSING Scripts (Storm)** | Pass/Fail | |
| 44 | **STORM LEAD Generation (Storm)** | Pass/Fail | |
| 45 | **STORM LEAD Map View (Storm)** | Pass/Fail | |
| 46 | **STORM RADAR OVERLAY** | Pass/Fail | **FLAG: Is this real or marketing-only?** |
| 47 | **AI Receptionist (Storm)** | Pass/Fail | |
| 48 | **Multi-Crew Dispatch (Storm)** | Pass/Fail | |
| 49 | Call Tracking | Pass/Fail | |
| 50 | SMS / Two-Way Texting | Pass/Fail | |
| 51 | Customer Portal — Job Status | Pass/Fail | |
| 52 | Customer Portal — Photos | Pass/Fail | |
| 53 | Customer Portal — Invoices/Pay | Pass/Fail | |
| 54 | Customer Portal — Warranty Claim | Pass/Fail | |
| 55 | Website Homepage + Amber Branding | Pass/Fail | |
| 56 | Website Services Page | Pass/Fail | |
| 57 | Website Service Area Pages | Pass/Fail | |
| 58 | Website Public Estimator | Pass/Fail | |
| 59 | Website Contact Form | Pass/Fail | |
| 60 | Website Blog | Pass/Fail | |
| 61 | Website Testimonials | Pass/Fail | |
| 62 | CMS Admin | Pass/Fail | |
| 63 | Website-to-CRM Lead Flow | Pass/Fail | |
| 64 | Reports | Pass/Fail | |
| 65 | Import | Pass/Fail | |
| 66 | Settings & Feature Toggles | Pass/Fail | |
| 67 | Mobile Responsive | Pass/Fail | |

### Storm Tier Value Assessment
- [ ] Total features tested: 67
- [ ] Total Storm-exclusive features tested (bold): ___
- [ ] All Storm features functional: Yes/No
- [ ] Storm tier justifies $599/mo price point: Yes/No

### Critical Findings

**STORM RADAR OVERLAY VERDICT:**
> [ ] REAL — Live radar data integrated from [source]
> [ ] MARKETING-ONLY — No live radar layer exists; the map shows storm events but no actual radar imagery
> [ ] PARTIAL — Static radar snapshots or historical data, not real-time

**Other P0/P1 Issues:**
> (List any blocking bugs, broken features, or features that 404/render blank)

**Recommendations:**
> (List any gaps between marketing claims and actual functionality)

For each failure: describe the error and include a screenshot.
