# Twomiah Factory Live Test — Roofing (Twomiah Roof)

You are QA testing Twomiah Factory, a SaaS platform that generates and deploys CRM + Website software for service businesses. This is a LIVE production test. You will sign up as a roofing contractor, wait for deployment, then systematically test every feature in the deployed CRM and website.

The roofing CRM has specialized features: Kanban pipeline board, insurance claim workflow, satellite roof reports, canvassing tools, storm lead generation, and a public instant estimator. Test everything.

Take screenshots at every major step. Report pass/fail for each feature.

---

## PHASE 1: SIGNUP

1. Navigate to: **https://twomiah.com/signup/roof/**
2. Complete the signup wizard:

**Step 0 — Company Info:**
- Company Name: "Badger Roofing QA"
- Industry: Roofing
- Phone: 715-555-0404
- Address: 400 Lake Street
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
- Select the mid-tier plan (e.g., "Starter" $129/mo or "Pro" $299/mo)
- Hosting: SaaS
- Features/Add-ons: Check ALL available (Pipeline Board, Mobile Estimating, Photo Documentation, Crew Scheduling, Equipment Tracking, Warranty Management, etc.)
- Migration Source: "No migration needed"

**Step 4 — Deploy Service:**
- Select "Basic" ($299)

**Step 5 — Admin Account:**
- First Name: Test
- Last Name: Roof
- Email: test-roof@twomiah.com
- Password: TestRoof2026!

**Step 6 — Review & Submit:**
- Verify, check terms, submit

3. **After submission:** Screenshot, note slug ("badger-roofing-qa"), note Stripe redirect if any

---

## PHASE 2: VERIFY DEPLOYMENT

Wait 5-10 minutes, then:

1. Visit **https://badger-roofing-qa.onrender.com** — CRM loads?
2. Visit **https://badger-roofing-qa-site.onrender.com** — Website loads with amber branding?

---

## PHASE 3: CRM LOGIN

1. Login with: test-roof@twomiah.com / TestRoof2026!
2. Complete onboarding if shown
3. Screenshot the dashboard/pipeline board

---

## PHASE 4: TEST PIPELINE BOARD (The Primary View)

### 4.1 Pipeline Board
- [ ] Navigate to Pipeline Board (this should be the default view at /crm or /crm/pipeline)
- [ ] Verify it shows a Kanban board with columns for each pipeline stage
- [ ] Expected stages (11): Lead, Contact Made, Appointment Set, Inspection Scheduled, Inspected, Estimate Sent, Approved, Material Ordered, Scheduled, In Progress, Collected
- [ ] Verify drag-and-drop works between stages

### 4.2 Create Jobs on Pipeline
- [ ] Create a new job:
  - Name/Contact: "Tom Henderson" (create contact inline or separately)
  - Address: 500 Pine St, Eau Claire, WI 54701
  - Job Type: Insurance
  - Priority: High
  - Stage: Lead
- [ ] Verify job card appears in "Lead" column
- [ ] Drag it to "Contact Made" — verify it moves
- [ ] Create second job:
  - Name/Contact: "Susan Parker"
  - Address: 600 Maple Dr, Eau Claire, WI 54701
  - Job Type: Retail
  - Stage: Lead
- [ ] Create third job:
  - Name/Contact: "Downtown Office LLC"
  - Address: 100 Broadway, Eau Claire, WI 54701
  - Job Type: Commercial
  - Stage: Appointment Set

### 4.3 Pipeline Filters
- [ ] Filter by Job Type: Insurance — only Tom shows
- [ ] Filter by Job Type: Retail — only Susan shows
- [ ] Clear filters — all 3 show
- [ ] Filter by sales rep (if assigned)

---

## PHASE 5: TEST CONTACTS

### 5.1 Contacts CRUD
- [ ] Navigate to Contacts page
- [ ] Verify Tom Henderson, Susan Parker, Downtown Office LLC exist
- [ ] Open Tom Henderson detail — all fields?
- [ ] Edit Tom — add phone: 715-555-8001, email: tom@example.com
- [ ] Add a new contact:
  - Name: "Adjuster Mike"
  - Type: Vendor (or Other)
  - Company: "State Farm"
  - Phone: 715-555-8002
- [ ] Search for "Henderson" — found?

---

## PHASE 6: TEST CREWS

### 6.1 Crews Management
- [ ] Navigate to Crews page
- [ ] Create a crew:
  - Name: "Alpha Crew"
  - Foreman: "Carlos Ramirez"
  - Phone: 715-555-9001
  - Crew Size: 4
  - Subcontractor: No
- [ ] Create second crew:
  - Name: "Beta Crew (Sub)"
  - Foreman: "Dave's Roofing"
  - Phone: 715-555-9002
  - Crew Size: 3
  - Subcontractor: Yes
  - Company: "Dave's Roofing LLC"
- [ ] Verify both appear in crew list
- [ ] Assign Alpha Crew to Tom Henderson's job

---

## PHASE 7: TEST JOB DETAIL & PHOTOS

### 7.1 Job Detail Page
- [ ] Open Tom Henderson's job detail
- [ ] Verify all fields display correctly
- [ ] Auto-generated job number (ROOF-0001 format)?
- [ ] Advance status through stages using the advance button:
  - Lead → Contact Made → Appointment Set → Inspection Scheduled
- [ ] Verify each status change is reflected

### 7.2 Photo Documentation
- [ ] Upload a photo to the job:
  - Type: Damage
  - Caption: "Hail damage on north slope"
- [ ] Upload a second photo:
  - Type: Before
  - Caption: "Pre-work condition"
- [ ] Verify photos appear in the gallery
- [ ] Verify photos appear in the timeline

### 7.3 Job Notes & Timeline
- [ ] Add a job note:
  - Type: Internal
  - Text: "Customer reported leak after last storm. Neighbor also has damage."
- [ ] Add an external note:
  - Text: "Scheduled inspection for Friday at 2 PM"
- [ ] Verify the timeline shows notes, photos, and any SMS messages merged together
- [ ] Check that internal notes are marked differently from external

---

## PHASE 8: TEST MEASUREMENTS & ROOF REPORTS

### 8.1 Measurements
- [ ] Navigate to Measurements page
- [ ] Check credit balance
- [ ] Order a measurement (if credits available):
  - Address: 500 Pine St, Eau Claire, WI 54701
  - Job: Tom Henderson
- [ ] If no credits, try purchasing credits (will go to Stripe)
- [ ] Try manual entry:
  - Total Squares: 28
  - Notes: "Manually measured, simple hip roof"
- [ ] Verify measurement appears and links to job

### 8.2 Roof Reports (AI Satellite Analysis)
- [ ] Navigate to Roof Reports page
- [ ] Order a roof report:
  - Address: 500 Pine St, Eau Claire, WI 54701
  - Contact: Tom Henderson
- [ ] This costs $9.99 — if Stripe checkout appears, note it
- [ ] If a report is generated/available:
  - [ ] Verify aerial imagery loads
  - [ ] Check AI-detected data: condition score, material type, tree overhang %
  - [ ] View roof segments with measurements
  - [ ] Open the edge editor — can you see the roof outline on the map?
  - [ ] Try editing a roof edge
  - [ ] Finalize the report
  - [ ] Export/download PDF if available

---

## PHASE 9: TEST INSURANCE WORKFLOW

### 9.1 Insurance Claim
- [ ] Open Tom Henderson's job
- [ ] Navigate to the Insurance section (may be a tab or sub-page)
- [ ] Create an insurance claim:
  - Insurance Company: State Farm
  - Policy Number: SF-2024-123456
  - Claim Number: CLM-789012
  - Deductible: $1,000
  - Date of Loss: (2 weeks ago)
  - Type of Damage: Hail
- [ ] Verify claim appears with status: Filed

### 9.2 Adjuster Management
- [ ] Add an adjuster to the claim:
  - Name: Adjuster Mike
  - Company: State Farm
  - Phone: 715-555-8002
  - Email: mike@statefarm.example.com
  - Territory: Western Wisconsin
- [ ] Advance claim: Filed → Adjuster Assigned → Inspection Scheduled

### 9.3 Claim Progression
- [ ] Update claim: Inspection Scheduled → Inspected
- [ ] Add inspection notes: "Adjuster confirmed hail damage. 28 squares affected."
- [ ] Update financial values:
  - RCV: $14,500
  - ACV: $11,200
- [ ] Advance: Inspected → Approved
- [ ] Verify all status changes are tracked

### 9.4 Supplements
- [ ] Create a supplement:
  - Reason: "Additional damage found during tear-off — decking replacement needed"
  - Amount: $3,200
  - Status: Draft
- [ ] Submit the supplement (Draft → Submitted)
- [ ] Approve the supplement
- [ ] Verify total claim value updates

### 9.5 Xactimate Integration
- [ ] Try exporting Xactimate scope document
- [ ] Verify line item codes are generated (RFG, WTR, GUT, etc.)

### 9.6 Claim Activity Log
- [ ] Add activities to the claim:
  - Note: "Called adjuster, left voicemail"
  - Call: "Spoke with adjuster, inspection scheduled for Friday"
  - Email: "Sent supplement documentation to adjuster"
- [ ] Verify activity timeline shows all entries chronologically

### 9.7 Adjusters Directory
- [ ] Navigate to Adjusters page
- [ ] Verify Adjuster Mike appears
- [ ] Add another adjuster:
  - Name: "Sarah Adjuster"
  - Company: "American Family"
  - Territory: "Eau Claire County"
- [ ] Search by carrier

---

## PHASE 10: TEST CANVASSING

### 10.1 Canvassing Dashboard
- [ ] Navigate to Canvassing Dashboard
- [ ] Verify page loads with session overview
- [ ] Check stats display (stops by outcome)

### 10.2 Canvassing Session
- [ ] Create a canvassing session:
  - Area: "Pine Street neighborhood"
  - Weather Event: Hail (if applicable)
- [ ] Navigate to the mobile canvassing view (/canvass)
- [ ] Log stops:
  - Stop 1: 502 Pine St — Outcome: Interested, Damage: Hail, Missing Shingles
  - Stop 2: 504 Pine St — Outcome: Not Interested
  - Stop 3: 506 Pine St — Outcome: No Answer
  - Stop 4: 508 Pine St — Outcome: Appointment Set
- [ ] Verify map shows pins color-coded by outcome
- [ ] Check canvassing scripts page (talking points)

---

## PHASE 11: TEST STORM LEADS

### 11.1 Storm Lead Generation
- [ ] Navigate to Storm Leads page
- [ ] Create a storm event:
  - Type: Hail
  - Date: last week
  - Area: Eau Claire, WI 54701
  - Hail Size: 1.5 inches
  - Wind Speed: 60 mph
- [ ] Generate leads from the storm event
- [ ] Verify leads appear with affected addresses
- [ ] Convert a storm lead to a job/contact
- [ ] Check map view of affected area

---

## PHASE 12: TEST QUOTES & INVOICES

### 12.1 Quotes
- [ ] Create a quote for Tom Henderson:
  - Line items:
    1. "Tear-off existing shingles (28 sq)", Qty: 28, Price: $85/sq = $2,380
    2. "Install Owens Corning Duration (28 sq)", Qty: 28, Price: $195/sq = $5,460
    3. "Ice & Water Shield", Qty: 1, Price: $850
    4. "Drip Edge & Flashing", Qty: 1, Price: $650
    5. "Ridge Vent", Qty: 1, Price: $425
    6. "Cleanup & Haul Away", Qty: 1, Price: $500
  - Tax: 5.5%
- [ ] Verify total calculates correctly (~$10,829.78)
- [ ] Send the quote
- [ ] Approve the quote
- [ ] Download PDF

### 12.2 Invoices
- [ ] Create an invoice (or convert quote):
  - Same line items as quote
  - Due Date: 30 days
- [ ] Send invoice
- [ ] Record insurance payment: $9,829.78 (total minus deductible)
- [ ] Record homeowner payment: $1,000 (deductible)
- [ ] Verify status = Paid
- [ ] Download PDF
- [ ] Check QuickBooks sync status if available

---

## PHASE 13: TEST MATERIALS & SCHEDULING

### 13.1 Materials / Material Orders
- [ ] Navigate to Materials page
- [ ] Create a material order:
  - Supplier: "ABC Supply"
  - Job: Tom Henderson
  - Items: "28 sq Owens Corning Duration, Ice & Water, Drip Edge"
  - Status: Ordered
  - Delivery Date: (3 days from now)
- [ ] Update status: Ordered → Shipped → Delivered
- [ ] Verify delivery tracking works

### 13.2 Advance Job Through Final Stages
- [ ] On pipeline board, advance Tom's job:
  - Approved → Material Ordered → Scheduled → In Progress → Collected
- [ ] Verify the board reflects each move
- [ ] Check if SMS auto-triggers on certain transitions

---

## PHASE 14: TEST LEADS & MARKETING

### 14.1 Lead Inbox
- [ ] Navigate to Lead Inbox
- [ ] Check for any leads
- [ ] Create a lead if possible:
  - Name: "New Lead Test"
  - Source: Website
  - Phone: 715-555-7001

### 14.2 Lead Sources
- [ ] Navigate to Lead Sources page
- [ ] Configure a test lead source if possible

### 14.3 AI Receptionist (if available)
- [ ] Navigate to AI Receptionist page
- [ ] Check configuration options
- [ ] Verify page loads

### 14.4 Ads Manager (if available)
- [ ] Navigate to Ads page
- [ ] Check campaign management options

### 14.5 Call Tracking (if available)
- [ ] Check call tracking page
- [ ] Verify call log displays

---

## PHASE 15: TEST ESTIMATOR (Public-Facing Tool)

### 15.1 Estimator Settings
- [ ] Navigate to Settings > Estimator
- [ ] Configure the instant estimator:
  - Price per square (low): $350
  - Price per square (high): $550
  - Headline: "Get Your Free Roof Estimate"
  - Disclaimer: "Estimates are approximate. Contact us for exact pricing."
- [ ] Enable the estimator
- [ ] Note the public URL

### 15.2 Public Estimator Page
- [ ] Visit the public estimator URL (/crm/estimator or public-facing URL)
- [ ] Enter an address: 500 Pine St, Eau Claire, WI 54701
- [ ] Verify it calculates an estimate based on satellite data
- [ ] Check the price range displays correctly
- [ ] Fill in the lead capture form:
  - Name: "Estimator Test Lead"
  - Email: estimator@example.com
  - Phone: 715-555-6666
- [ ] Submit — verify lead is captured
- [ ] Back in CRM, check if the estimator lead appeared in Lead Inbox

---

## PHASE 16: TEST CUSTOMER PORTAL

### 16.1 Portal Setup
- [ ] Enable portal for Tom Henderson (from Contacts)
- [ ] Get portal login info

### 16.2 Portal Features
- [ ] Login to portal
- [ ] Dashboard loads — shows job status
- [ ] View job detail — customer-friendly status language
- [ ] View photos & documents
- [ ] View invoices — can pay online?
- [ ] Submit a service request (e.g., warranty claim)
- [ ] Company contact info displayed

---

## PHASE 17: TEST REPORTING & SETTINGS

### 17.1 Reports
- [ ] Navigate to Reports page
- [ ] Run reports: revenue, pipeline value, conversion rates, average deal size
- [ ] Export if available

### 17.2 Import
- [ ] Navigate to Import page
- [ ] Download CSV template
- [ ] Verify import functionality exists

### 17.3 Settings
- [ ] Company settings — verify name, branding
- [ ] User management — list users
- [ ] Integration settings — QuickBooks, Twilio
- [ ] Feature toggles — verify all enabled features show correctly
- [ ] Billing/subscription info

---

## PHASE 18: TEST THE DEPLOYED WEBSITE

### 18.1 Public Pages
- [ ] Homepage loads — "Badger Roofing QA" with amber branding
- [ ] Services page — roofing services (shingle, metal, flat, repairs, inspections)
- [ ] Gallery/Portfolio page
- [ ] Blog page
- [ ] Contact form page
- [ ] Submit contact form:
  - Name: "Storm Damage Homeowner"
  - Email: storm@example.com
  - Phone: 715-555-5555
  - Message: "We had hail damage last week, need an inspection"
- [ ] Verify submission succeeds
- [ ] Mobile responsive

### 18.2 CMS Admin
- [ ] Login at /admin
- [ ] Create a blog post about storm damage
- [ ] Edit services
- [ ] Add testimonial
- [ ] Check leads

### 18.3 Website-to-CRM Flow
- [ ] Check CRM for website lead

---

## PHASE 19: FINAL SUMMARY

| Feature | Status | Notes |
|---------|--------|-------|
| Signup Flow | Pass/Fail | |
| Deployment | Pass/Fail | |
| CRM Login | Pass/Fail | |
| **Pipeline Board (Kanban)** | Pass/Fail | |
| **Drag-Drop Between Stages** | Pass/Fail | |
| **Pipeline Filters** | Pass/Fail | |
| Contacts CRUD | Pass/Fail | |
| **Crews Management** | Pass/Fail | |
| **Job Detail & Status Advances** | Pass/Fail | |
| **Photo Documentation** | Pass/Fail | |
| **Job Notes & Timeline** | Pass/Fail | |
| **Measurements / Credits** | Pass/Fail | |
| **Roof Reports (AI Satellite)** | Pass/Fail | |
| **Roof Edge Editor** | Pass/Fail | |
| **Insurance Claim Workflow** | Pass/Fail | |
| **Adjuster Management** | Pass/Fail | |
| **Supplements** | Pass/Fail | |
| **Xactimate Export** | Pass/Fail | |
| **Claim Activity Log** | Pass/Fail | |
| **Canvassing Dashboard** | Pass/Fail | |
| **Canvassing Mobile View** | Pass/Fail | |
| **Storm Lead Generation** | Pass/Fail | |
| Quotes + PDF | Pass/Fail | |
| Invoices + Payments | Pass/Fail | |
| **Material Orders** | Pass/Fail | |
| Lead Inbox | Pass/Fail | |
| **Instant Estimator (Public)** | Pass/Fail | |
| **Estimator Lead Capture** | Pass/Fail | |
| AI Receptionist | Pass/Fail | |
| Ads Manager | Pass/Fail | |
| SMS / Two-Way Texting | Pass/Fail | |
| Customer Portal | Pass/Fail | |
| Reports | Pass/Fail | |
| Import | Pass/Fail | |
| Settings & Integrations | Pass/Fail | |
| Website Homepage | Pass/Fail | |
| Website Services | Pass/Fail | |
| Website Contact Form | Pass/Fail | |
| CMS Admin | Pass/Fail | |
| Website-to-CRM Flow | Pass/Fail | |

For each failure: describe the error, screenshot it.
