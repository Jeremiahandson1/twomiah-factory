# Twomiah Factory End-to-End Test — Care AGENCY Tier ($599/mo)

You are QA testing Twomiah Factory, a SaaS platform that generates and deploys CRM + Website software for service businesses. This is a LIVE production test. You will sign up as a home care agency on the **Agency tier** (the most expensive Care tier at $599/mo), wait for deployment, then systematically test every feature in the deployed CRM and website.

This is the most specialized vertical — it has a completely different data model from the base CRM (Clients instead of Contacts, Caregivers instead of Team, Care Plans, ADLs, EVV, Claims, etc.). The Agency tier includes ALL lower-tier features (Starter, Pro, Business) PLUS Agency-exclusive features: full claims processing, check scanning & reconciliation, HIPAA audit logs, Sandata integration, Caregiver portal website, route/roster/schedule optimizer, forecast, AI receptionist, Gusto integration, performance reviews, no-show tracking, and PTO management.

Take screenshots at every major step. Report pass/fail for each feature.

**DE-SCOPED FEATURES (do NOT test — removed 2026-04-13):**
- Multi-branch operations
- GPS tracking / geofencing

---

## PHASE 1: SIGNUP

1. Navigate to: **https://twomiah.com/signup/care/**
2. Complete the signup wizard:

**Step 0 — Company Info:**
- Company Name: "Chippewa Home Care Agency QA"
- Industry: Home Care / Healthcare
- Phone: 715-555-0399
- Address: 399 Water Street
- City: Chippewa Falls
- State: Wisconsin
- ZIP: 54729
- Domain: (leave blank)
- Timezone: America/Chicago

**Step 1 — Branding:**
- Skip logo upload
- Primary Color: #059669 (green)

**Step 2 — Website Template:**
- Select the homecare template

**Step 3 — Plan & Billing:**
- Select **"Agency"** plan ($599/mo)
- Hosting: SaaS
- Add-ons: Check ALL available (SMS, EVV, Payroll, HIPAA Compliance Tools, etc.)
- Migration Source: "No migration needed"
- Payment: Test card **4242 4242 4242 4242**, any future expiry, any CVC

**Step 4 — Deploy Service:**
- Select "Basic" ($299)

**Step 5 — Admin Account:**
- First Name: Test
- Last Name: CareAgency
- Email: test-care-agency@twomiah.com
- Password: TestCareAgency2026!

**Step 6 — Review & Submit:**
- Verify all details show Agency tier at $599/mo
- Check terms, submit

3. **After submission:** Screenshot, note slug ("chippewa-home-care-agency-qa"), note any Stripe checkout redirect

---

## PHASE 2: VERIFY GITHUB REPO

1. Visit **https://github.com/Jeremiahandson1/chippewa-home-care-agency-qa**
2. Verify the repo contains actual application code:
   - [ ] `crm-homecare/` directory exists with `backend/` and `frontend/`
   - [ ] `crm-homecare/backend/src/index.ts` exists
   - [ ] `crm-homecare/frontend/src/capacitor-stub.js` exists (required for web builds)
   - [ ] `website/` directory exists with `views/` (home care EJS templates) and `admin/` (CMS)
   - [ ] `render.yaml` exists at repo root
3. If repo only has README.md and deploy.sh — **stop and report P0 bug**
4. Verify the website template is home care specific:
   - [ ] `website/data/services.json` contains care services (Personal Care, Companion Care, Respite Care), NOT contractor services (Roofing, Siding)

---

## PHASE 3: VERIFY DEPLOYMENT

Wait 5-10 minutes, then:

1. Visit **https://chippewa-home-care-agency-qa-care-api.onrender.com** — CRM loads? (note: home care uses `-care-api` suffix)
2. Visit **https://chippewa-home-care-agency-qa-site.onrender.com** — Website loads with green branding?
3. Verify the Caregiver Portal website also deploys (Agency tier includes portal website):
   - [ ] CRM API URL responds
   - [ ] Website URL responds with green branding
   - [ ] Caregiver Portal accessible (check for portal route on website)

---

## PHASE 4: CRM LOGIN

1. Login with: test-care-agency@twomiah.com / TestCareAgency2026!
2. Complete onboarding wizard if shown
3. Screenshot the dashboard
4. Verify you are on the **Agency** tier:
   - [ ] Login succeeds
   - [ ] Dashboard loads
   - [ ] Agency-tier features visible in navigation (Forecast, AI Receptionist, Performance Reviews, etc.)

---

## PHASE 5: TEST DASHBOARD

### 5.1 Dashboard
- [ ] Dashboard loads with home care specific metrics
- [ ] Shows relevant stats: active clients, active caregivers, scheduled visits today, hours this week
- [ ] No contractor/roofing/field-service terminology (no "Jobs", no "Leads", no "Estimates")
- [ ] Screenshot the dashboard

---

## PHASE 6: TEST CLIENT MANAGEMENT

### 6.1 Clients (NOT "Contacts" — home care uses Clients)
- [ ] Navigate to Clients page
- [ ] Create a client:
  - Name: "Dorothy Williams"
  - Email: dorothy@example.com
  - Phone: 715-555-4001
  - Address: 400 River Rd, Chippewa Falls, WI 54729
  - Date of Birth: 1941-03-15
  - Service Type: Personal Care
  - Status: Active
- [ ] Verify client appears in list
- [ ] Open client detail page — all fields display correctly
- [ ] Add emergency contact:
  - Name: "Robert Williams"
  - Phone: 715-555-4002
  - Relationship: Son
  - Email: robert.williams@example.com
- [ ] Check client onboarding checklist (emergency contacts, medical history, insurance, care preferences)
- [ ] Create second client:
  - Name: "Harold Johnson"
  - Email: harold@example.com
  - Phone: 715-555-4003
  - Address: 500 Main Ave, Chippewa Falls, WI 54729
  - Date of Birth: 1938-07-22
  - Service Type: Companion Care
  - Status: Active
- [ ] Verify both clients appear in list
- [ ] Search for "Dorothy" — found?
- [ ] Filter by status (Active) — both show?

### 6.2 Referral Sources
- [ ] Navigate to Referral Sources page
- [ ] Create a referral source:
  - Name: "St. Joseph's Hospital"
  - Type: Healthcare Provider
  - Contact: "Dr. Sarah Chen"
  - Phone: 715-555-5001
  - Email: referrals@stjosephs.example.com
- [ ] Verify it appears in list
- [ ] Open detail — all fields correct?

### 6.3 Care Plans
- [ ] Navigate to Care Plans page
- [ ] Create a care plan for Dorothy Williams:
  - Service Type: Personal Care
  - Frequency: 3x per week, 4 hours each
  - Goals: "Maintain independence with daily activities"
  - Special Instructions: "Client prefers morning visits. Allergic to latex."
  - Precautions: "Fall risk — use gait belt for transfers"
  - Start Date: today
  - Status: Active
- [ ] Verify care plan appears in list
- [ ] Open detail — all fields correct?
- [ ] Edit the care plan — add a second goal: "Improve mobility and balance with daily exercises"
- [ ] Verify edit saved

---

## PHASE 7: TEST CAREGIVERS & RECRUITMENT

### 7.1 Caregivers
- [ ] Navigate to Caregivers page
- [ ] Create a caregiver:
  - Name: "Maria Garcia"
  - Email: maria@chippewahomecare.com
  - Phone: 715-555-6001
  - Role: CNA (Certified Nursing Assistant)
  - Hourly Rate: $18
  - Status: Active
- [ ] Verify caregiver appears in list
- [ ] Open caregiver detail — all fields display?
- [ ] Create second caregiver:
  - Name: "James Wilson"
  - Email: james@chippewahomecare.com
  - Phone: 715-555-6002
  - Role: HHA (Home Health Aide)
  - Hourly Rate: $16
  - Status: Active
- [ ] Filter caregivers by status (Active) — both show?
- [ ] Search for "Maria" — found?

### 7.2 Certifications
- [ ] Navigate to Maria Garcia's profile > Certifications
- [ ] Add a certification:
  - Type: CNA
  - Issue Date: 2024-01-15
  - Expiry Date: 2026-01-15
  - Issuing Body: "Wisconsin DHS"
- [ ] Add a second certification:
  - Type: CPR/First Aid
  - Issue Date: 2025-06-01
  - Expiry Date: 2027-06-01
  - Issuing Body: "American Red Cross"
- [ ] Verify both certifications appear on caregiver profile
- [ ] Note: CNA cert is EXPIRED (expiry 2026-01-15) — verify compliance dashboard flags this

### 7.3 Background Checks
- [ ] Navigate to Background Checks page (or via caregiver profile)
- [ ] Initiate a background check for Maria Garcia:
  - Type: Criminal
  - Provider: "National Background Check Inc."
  - Status: Pending
- [ ] Update the status to "Cleared"
- [ ] Set expiration date: 1 year from now
- [ ] Verify it appears on compliance dashboard

### 7.4 Care Types & Rates
- [ ] Navigate to Care Types & Rates (Settings or dedicated page)
- [ ] Verify care types exist (Personal Care, Companion Care, Respite Care, etc.)
- [ ] Verify rate configuration per care type
- [ ] Add or edit a rate if possible

### 7.5 Caregiver Bio Pages
- [ ] Navigate to Maria Garcia's profile
- [ ] Verify bio section exists
- [ ] Add a bio: "Maria has been a CNA for 5 years with experience in elderly care and dementia support."
- [ ] Check if bio is visible on public-facing Caregiver Portal website

---

## PHASE 8: TEST SCHEDULING & TIME TRACKING

### 8.1 Schedule Hub
- [ ] Navigate to Schedule Hub
- [ ] Create a shift/visit:
  - Client: Dorothy Williams
  - Caregiver: Maria Garcia
  - Date: tomorrow
  - Start Time: 8:00 AM
  - End Time: 12:00 PM
  - Service Type: Personal Care
- [ ] Verify the shift appears on the calendar
- [ ] Create second shift:
  - Client: Harold Johnson
  - Caregiver: James Wilson
  - Date: tomorrow
  - Start Time: 1:00 PM
  - End Time: 5:00 PM
  - Service Type: Companion Care
- [ ] Drag-drop a shift to reschedule (if drag-drop enabled)
- [ ] Cancel a shift and recreate it
- [ ] Screenshot the schedule view

### 8.2 Caregiver Availability
- [ ] Navigate to Caregiver Availability (for Maria Garcia)
- [ ] Set availability:
  - Monday: 7:00 AM - 5:00 PM
  - Tuesday: 7:00 AM - 5:00 PM
  - Wednesday: 7:00 AM - 5:00 PM
  - Thursday: 7:00 AM - 5:00 PM
  - Friday: 7:00 AM - 5:00 PM
  - Saturday: 8:00 AM - 12:00 PM
  - Sunday: Off
  - Max weekly hours: 40
- [ ] Verify availability is saved and displays correctly
- [ ] Create a shift that conflicts with availability — verify warning

### 8.3 Open Shifts
- [ ] Create an open shift (unassigned):
  - Client: Dorothy Williams
  - Date: 3 days from now
  - Time: 8:00 AM - 12:00 PM
  - Service Type: Personal Care
- [ ] Verify open shift appears in Open Shifts list
- [ ] Claim the open shift as Maria Garcia
- [ ] Verify it moves to the regular schedule with Maria assigned

### 8.4 Time Tracking / Clock In-Out
- [ ] Create a manual time entry:
  - Caregiver: Maria Garcia
  - Client: Dorothy Williams
  - Date: today
  - Clock In: 8:00 AM
  - Clock Out: 12:00 PM
  - Hours: 4
- [ ] Verify entry appears in time tracking list
- [ ] Add visit notes to the time entry: "Assisted with bathing and dressing. Client in good spirits."
- [ ] Test clock in/out buttons if available

### 8.5 EVV (Electronic Visit Verification)
- [ ] Navigate to EVV Dashboard
- [ ] Run EVV check-in:
  - Select the time entry for Maria Garcia / Dorothy Williams
  - Verify check-in time is recorded
- [ ] Run EVV check-out:
  - Verify check-out time is recorded
- [ ] Verify EVV record shows visit verification status
- [ ] Verify time entries link to EVV records
- [ ] Screenshot EVV dashboard

---

## PHASE 9: TEST CLINICAL & CARE TRACKING

### 9.1 ADL Tracking (Activities of Daily Living)
- [ ] Navigate to ADL Tracking page (or via Dorothy Williams's profile)
- [ ] Create ADL requirements for Dorothy Williams:
  - Bathing: Needs Assistance
  - Dressing: Needs Assistance
  - Eating: Independent
  - Toileting: Needs Assistance
  - Mobility: Needs Assistance (walker)
  - Medication Reminders: Yes
- [ ] Log ADL completion:
  - Caregiver: Maria Garcia
  - Date: today
  - Bathing: Completed — notes: "Assisted with shower, used grab bars"
  - Dressing: Completed — notes: "Helped with buttons and shoes"
  - Toileting: Completed
  - Mobility: Completed — notes: "Used walker, no issues"
- [ ] Verify ADL logs appear with timestamps and caregiver name

### 9.2 Medications
- [ ] Navigate to Medications page (for Dorothy Williams)
- [ ] Add a medication:
  - Name: "Metformin"
  - Dosage: 500mg
  - Frequency: Twice daily
  - Pharmacy: "Walgreens Chippewa Falls"
  - Prescribing Physician: "Dr. Sarah Chen"
  - Instructions: "Take with meals"
- [ ] Add second medication:
  - Name: "Lisinopril"
  - Dosage: 10mg
  - Frequency: Once daily
  - Instructions: "Take in the morning"
- [ ] Log medication administration:
  - Medication: Metformin
  - Status: Administered
  - Time: 8:30 AM
  - Caregiver: Maria Garcia
  - Notes: "Taken with breakfast"
- [ ] Verify medication log appears with timestamp

### 9.3 Incidents
- [ ] Navigate to Incidents page
- [ ] Create an incident report:
  - Client: Dorothy Williams
  - Caregiver: Maria Garcia
  - Date: today
  - Type: Near-fall
  - Severity: Low
  - Description: "Client was unsteady getting out of shower. Caregiver assisted immediately. No injury occurred."
  - Resolution: "Reminded client to use grab bars. Added non-slip mat to bathroom floor. Updated care plan precautions."
- [ ] Verify incident appears in list
- [ ] Update the incident status to Resolved
- [ ] Verify incident is logged in audit trail (HIPAA compliance)

---

## PHASE 10: TEST COMMUNICATION

### 10.1 Communication / Messages
- [ ] Navigate to Messages / Communication page
- [ ] Create a message thread:
  - To: Maria Garcia
  - Subject: "Schedule Update"
  - Message: "Your Monday shift for Dorothy Williams has been moved to 9 AM start time."
- [ ] Verify message appears in thread

### 10.2 SMS
- [ ] Try sending an SMS from Communication page
- [ ] Note any Twilio configuration errors (expected without real credentials)

### 10.3 Communication Log
- [ ] Log a communication:
  - Type: Phone Call
  - Contact: Dorothy Williams (family)
  - Notes: "Called son Robert Williams to discuss care plan updates. He agreed to add a second weekly visit."
- [ ] Verify it appears in the log

### 10.4 Alerts
- [ ] Navigate to Alerts page
- [ ] Check notification settings
- [ ] Verify certification expiry alerts are present (Maria's CNA is expired)

---

## PHASE 11: TEST FAMILY PORTAL

### 11.1 Portal Setup
- [ ] Enable portal access for Dorothy Williams
- [ ] Get the portal login link/credentials
- [ ] Open the portal in a new tab

### 11.2 Portal Features
- [ ] Dashboard loads — shows client status
- [ ] **My Schedule**: View upcoming visits (Dorothy + Maria tomorrow 8AM-12PM)
- [ ] **Visit History**: View past visits with caregiver names and times
- [ ] **My Caregivers**: See Maria Garcia assigned
- [ ] **Care Plan**: View Dorothy's care plan details (Personal Care, 3x/week, goals, precautions)
- [ ] **Billing**: View invoices
- [ ] **Messages**: Send a message to the agency: "Can we add a Saturday visit?"
- [ ] **Notifications**: Check for alerts

---

## PHASE 12: TEST FINANCIAL MANAGEMENT

### 12.1 Payers
- [ ] Navigate to Payers page
- [ ] Create a payer:
  - Name: "Wisconsin Medicaid"
  - Type: Medicaid
  - Payer ID: "WIMCD"
  - Contact: "Claims Department"
  - Phone: 800-555-0000
  - Address: "1 West Wilson St, Madison, WI 53703"
- [ ] Verify it appears in list

### 12.2 Service Codes
- [ ] Navigate to Service Codes page
- [ ] Create a service code:
  - Code: "T1019"
  - Description: "Personal Care Services"
  - Rate: $28/hour
  - Unit Type: Hour
- [ ] Create a second service code:
  - Code: "T1020"
  - Description: "Companion/Sitter Services"
  - Rate: $22/hour
  - Unit Type: Hour
- [ ] Verify both appear in list

### 12.3 Authorizations
- [ ] Navigate to Authorizations page
- [ ] Create an authorization:
  - Client: Dorothy Williams
  - Payer: Wisconsin Medicaid
  - Service Code: T1019 — Personal Care Services
  - Authorized Units: 120 hours
  - Start Date: first of this month
  - End Date: last of this month
- [ ] Verify authorization appears
- [ ] Verify units used tracking works (should show 4 hours used from Maria's time entry)

### 12.4 Billing / Invoices
- [ ] Navigate to Billing page
- [ ] Create an invoice for Dorothy Williams:
  - Service: Personal Care (T1019)
  - Hours: 12 (3 visits x 4 hours)
  - Rate: $28/hour
  - Total: $336
  - Payer: Wisconsin Medicaid
  - Due Date: 2 weeks from now
- [ ] Verify invoice total calculates correctly
- [ ] Send the invoice
- [ ] Record a payment
- [ ] Download/print the invoice

### 12.5 Claims (Business + Agency tier)
- [ ] Navigate to Claims page
- [ ] Generate a claim from visits:
  - Payer: Wisconsin Medicaid
  - Client: Dorothy Williams
  - Service dates: this week
  - Service code: T1019
  - Units: 4 (from Maria's visit)
  - Rate: $28/hour
- [ ] Submit the claim
- [ ] Check claim status (Submitted/Pending)
- [ ] Screenshot the claims list

### 12.6 EDI 837 Export
- [ ] From the Claims page, select the submitted claim
- [ ] Generate EDI 837 file
- [ ] Verify file downloads (or preview renders)
- [ ] Verify the 837 contains correct payer ID, service code, units

### 12.7 ERA 835 Import
- [ ] Navigate to Remittance / ERA 835 section
- [ ] Verify import functionality exists (upload area or button)
- [ ] Note: without a real 835 file, verify the page loads and upload UI is present

### 12.8 Payroll
- [ ] Navigate to Payroll page
- [ ] Calculate payroll for this week
- [ ] Verify Maria Garcia's hours show correctly (4 hours x $18/hr = $72)
- [ ] Verify James Wilson appears (if time entries exist)
- [ ] Export payroll if available

### 12.9 Expenses
- [ ] Create an expense:
  - Category: Supplies
  - Description: "Latex-free gloves, hand sanitizer, non-slip bath mats"
  - Amount: $67.50
  - Reimbursable: Yes
- [ ] Verify it appears in expense list

### 12.10 Reports
- [ ] Navigate to Reports page
- [ ] Run available reports:
  - Revenue by payer
  - Caregiver hours summary
  - Client activity report
  - Authorization utilization
- [ ] Verify reports render with data

---

## PHASE 13: TEST AGENCY-TIER EXCLUSIVE FEATURES

**These features are ONLY available on the Agency tier ($599/mo). Test each thoroughly.**

### 13.1 Check Scanning & Reconciliation
- [ ] Navigate to Check Scanning page (in Payments or Billing section)
- [ ] Scan/upload a check image (use a test image or screenshot)
- [ ] Verify check details are captured (amount, check number, payer)
- [ ] Navigate to Reconciliation
- [ ] Reconcile the scanned check against an existing invoice
- [ ] Verify reconciliation status updates
- [ ] Screenshot the reconciliation view

### 13.2 Sandata Integration
- [ ] Navigate to Integrations page
- [ ] Find Sandata integration section
- [ ] Verify configuration fields are present (Sandata credentials, agency ID, etc.)
- [ ] Try submitting a test visit to Sandata (will fail without real credentials — note the error message)
- [ ] Verify Sandata submission status page exists
- [ ] Screenshot the Sandata integration page

### 13.3 Caregiver Portal Website
- [ ] Navigate to the Caregiver Portal website URL
- [ ] Login as a caregiver (use Maria Garcia's credentials or a portal login)
- [ ] Verify portal dashboard shows:
  - Upcoming schedule / assigned shifts
  - Client information (limited to assigned clients)
  - Open shifts available to claim
- [ ] Accept an open shift from the portal
- [ ] Verify the shift appears on the caregiver's schedule
- [ ] Verify caregiver CANNOT see other caregivers' data (privacy check)
- [ ] Screenshot the caregiver portal

### 13.4 Route / Roster / Schedule Optimizer
- [ ] Navigate to Route Optimizer (or Roster Optimizer / Schedule Optimizer)
- [ ] Run an optimization:
  - Select date range: this week
  - Include all active caregivers (Maria, James)
  - Include all active clients (Dorothy, Harold)
- [ ] Verify optimizer produces results (optimized schedule, reduced travel time, etc.)
- [ ] Verify optimized schedule can be applied/accepted
- [ ] Screenshot the optimization results

### 13.5 Forecast
- [ ] Navigate to Forecast page
- [ ] Verify projections render:
  - Revenue forecast (based on scheduled visits and rates)
  - Staffing needs forecast
  - Authorization utilization projection
- [ ] Verify chart/graph renders with data
- [ ] Screenshot the forecast page

### 13.6 AI Receptionist
- [ ] Navigate to AI Receptionist page
- [ ] Verify the page loads with configuration options
- [ ] Test inbound call simulation if available:
  - Verify call routing options
  - Verify greeting message configuration
  - Verify after-hours handling
- [ ] Note: without real telephony credentials, verify UI is functional
- [ ] Screenshot the AI Receptionist page

### 13.7 Gusto Integration
- [ ] Navigate to Integrations page
- [ ] Find Gusto integration section
- [ ] Verify read-only integration view:
  - Connection status
  - Sync configuration fields (API key, company ID)
  - Employee mapping (Caregivers to Gusto employees)
- [ ] Note: this is read-only — verify no write actions are exposed
- [ ] Screenshot the Gusto integration page

### 13.8 Performance Reviews
- [ ] Navigate to Performance Reviews page
- [ ] Create a performance review for Maria Garcia:
  - Review Period: Last quarter
  - Reviewer: Test CareAgency (admin)
  - Punctuality: 5/5
  - Client Satisfaction: 4/5
  - Documentation Quality: 4/5
  - Clinical Skills: 5/5
  - Overall Rating: 4.5/5
  - Comments: "Maria is an excellent caregiver. Clients consistently report high satisfaction. Documentation could be slightly more detailed."
  - Goals: "Complete advanced dementia care training by end of quarter."
- [ ] Verify review appears in Maria's profile
- [ ] Verify review is saved and can be edited
- [ ] Screenshot the performance review

### 13.9 No-Show Tracking
- [ ] Navigate to No-Show Tracking page
- [ ] Mark a visit as no-show:
  - Select the James Wilson / Harold Johnson shift (tomorrow 1PM-5PM)
  - Reason: "Caregiver called in sick"
  - Action Taken: "Contacted backup caregiver, rescheduled for next day"
- [ ] Verify no-show record appears in tracking list
- [ ] Verify no-show is linked to the original shift
- [ ] Verify no-show triggers an alert/notification
- [ ] Screenshot the no-show tracking page

### 13.10 PTO Management
- [ ] Navigate to PTO Management page
- [ ] Submit a PTO request as a caregiver:
  - Caregiver: Maria Garcia
  - Type: Vacation
  - Start Date: 2 weeks from now
  - End Date: 2 weeks + 3 days from now
  - Reason: "Family vacation"
- [ ] Verify PTO request appears with "Pending" status
- [ ] Approve the PTO request as admin
- [ ] Verify status changes to "Approved"
- [ ] Verify Maria's availability reflects the PTO dates (blocked out)
- [ ] Screenshot the PTO management page

---

## PHASE 14: TEST COMPLIANCE & AUDIT

### 14.1 Compliance Dashboard
- [ ] Navigate to Compliance Dashboard
- [ ] Verify it shows:
  - Caregivers with expiring certifications (Maria's CNA expired 2026-01-15)
  - Background checks needing renewal
  - Missing documentation alerts
  - Training compliance status
- [ ] Screenshot the compliance dashboard

### 14.2 Documents
- [ ] Upload a test document (e.g., test policy PDF)
- [ ] Attach to Maria Garcia's profile
- [ ] Verify it appears in the documents list
- [ ] Attach a document to Dorothy Williams's profile
- [ ] Verify client documents are separate from caregiver documents

### 14.3 Training Records
- [ ] Navigate to Training Records (via caregiver profile or dedicated page)
- [ ] Add a training record for Maria Garcia:
  - Training: "Dementia Care Certification"
  - Completed Date: 2025-09-15
  - Hours: 16
  - Provider: "Wisconsin Alzheimer's Association"
- [ ] Verify training record appears on profile

### 14.4 HIPAA Audit Logs — CRITICAL
- [ ] Navigate to Audit Logs page
- [ ] Verify actions from this testing session are logged:
  - [ ] Client record creation (Dorothy Williams, Harold Johnson)
  - [ ] Client record access/view
  - [ ] Care plan creation and edits
  - [ ] Medication additions
  - [ ] Caregiver record creation
  - [ ] Incident report creation
  - [ ] Claims generation
  - [ ] Login/logout events
- [ ] Search/filter the audit log by:
  - User
  - Action type
  - Date range
  - Entity type (Client, Caregiver, Care Plan)
- [ ] Verify each log entry includes: timestamp, user, action, entity, IP address
- [ ] **FLAG AS CRITICAL if any of the following are missing from audit logs:**
  - Client PHI access (viewing client medical data)
  - Medication record changes
  - Care plan modifications
  - User login/logout events
  - Failed login attempts
- [ ] Screenshot the audit logs page

### 14.5 Login Activity
- [ ] Navigate to Login Activity page
- [ ] Verify your login is recorded with:
  - Timestamp
  - IP address
  - User agent / device info
  - Success/failure status

---

## PHASE 15: TEST THE DEPLOYED WEBSITE (Caregiver Portal Website)

Visit the website URL: **https://chippewa-home-care-agency-qa-site.onrender.com**

### 15.1 Public Pages
- [ ] Homepage loads — "Chippewa Home Care Agency QA" with green (#059669) branding
- [ ] Services page — shows HOME CARE services:
  - Personal Care
  - Companion Care
  - Respite Care
  - Medication Management
  - (NOT contractor services like Roofing, Siding, HVAC)
- [ ] About page loads
- [ ] Blog page loads
- [ ] Contact page with form
- [ ] Submit a contact form:
  - Name: "Family Member"
  - Email: family@example.com
  - Phone: 715-555-7777
  - Message: "Looking for home care services for my mother. She needs help with bathing and meal preparation."
- [ ] Verify submission succeeds
- [ ] Mobile responsive check — resize browser to 375px width
- [ ] Check green branding throughout (header, buttons, accents)

### 15.2 CMS Admin
- [ ] Navigate to /admin on the website
- [ ] Login with admin credentials
- [ ] Create a blog post:
  - Title: "5 Signs Your Loved One May Need Home Care"
  - Content: test content about home care indicators
- [ ] Edit service descriptions
- [ ] Add a testimonial:
  - Name: "Robert Williams"
  - Quote: "The caregivers from Chippewa Home Care have been wonderful with my mother. She looks forward to their visits."
  - Rating: 5 stars
- [ ] Check leads page for the contact form submission from step 15.1

---

## PHASE 16: WEBSITE-TO-CRM FLOW

- [ ] In CRM, navigate to a leads/referrals/inquiries section
- [ ] Verify the website contact form submission ("Family Member" / family@example.com) appeared as a new lead or inquiry
- [ ] If not found, check Communication Log or a general inbox
- [ ] Screenshot the lead in CRM

---

## PHASE 17: FINAL SUMMARY

Complete this table with Pass/Fail for every feature. **Bold** items are Agency-tier exclusive features that must be tested thoroughly.

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | Signup Flow (Agency $599) | Pass/Fail | |
| 2 | GitHub Repo Verification | Pass/Fail | |
| 3 | CRM Deployment | Pass/Fail | |
| 4 | Website Deployment | Pass/Fail | |
| 5 | CRM Login | Pass/Fail | |
| 6 | Dashboard (home care metrics) | Pass/Fail | |
| 7 | Clients CRUD | Pass/Fail | |
| 8 | Emergency Contacts | Pass/Fail | |
| 9 | Referral Sources | Pass/Fail | |
| 10 | Care Plans | Pass/Fail | |
| 11 | Caregivers CRUD | Pass/Fail | |
| 12 | Certifications | Pass/Fail | |
| 13 | Background Checks | Pass/Fail | |
| 14 | Care Types & Rates | Pass/Fail | |
| 15 | Caregiver Bio Pages | Pass/Fail | |
| 16 | Schedule Hub | Pass/Fail | |
| 17 | Caregiver Availability | Pass/Fail | |
| 18 | Open Shifts | Pass/Fail | |
| 19 | Time Tracking / Clock In-Out | Pass/Fail | |
| 20 | EVV (Electronic Visit Verification) | Pass/Fail | |
| 21 | ADL Tracking | Pass/Fail | |
| 22 | Medications | Pass/Fail | |
| 23 | Incidents | Pass/Fail | |
| 24 | Communication / Messages | Pass/Fail | |
| 25 | SMS | Pass/Fail | |
| 26 | Family Portal | Pass/Fail | |
| 27 | Payers | Pass/Fail | |
| 28 | Service Codes | Pass/Fail | |
| 29 | Authorizations | Pass/Fail | |
| 30 | Billing / Invoices | Pass/Fail | |
| 31 | Claims | Pass/Fail | |
| 32 | EDI 837 Export | Pass/Fail | |
| 33 | ERA 835 Import | Pass/Fail | |
| 34 | Payroll | Pass/Fail | |
| 35 | Expenses | Pass/Fail | |
| 36 | Reports | Pass/Fail | |
| 37 | **Check Scanning & Reconciliation** | Pass/Fail | Agency exclusive |
| 38 | **Sandata Integration** | Pass/Fail | Agency exclusive |
| 39 | **Caregiver Portal Website** | Pass/Fail | Agency exclusive |
| 40 | **Route/Roster/Schedule Optimizer** | Pass/Fail | Agency exclusive |
| 41 | **Forecast** | Pass/Fail | Agency exclusive |
| 42 | **AI Receptionist** | Pass/Fail | Agency exclusive |
| 43 | **Gusto Integration** | Pass/Fail | Agency exclusive |
| 44 | **Performance Reviews** | Pass/Fail | Agency exclusive |
| 45 | **No-Show Tracking** | Pass/Fail | Agency exclusive |
| 46 | **PTO Management** | Pass/Fail | Agency exclusive |
| 47 | Compliance Dashboard | Pass/Fail | |
| 48 | Documents | Pass/Fail | |
| 49 | Training Records | Pass/Fail | |
| 50 | **HIPAA Audit Logs** | Pass/Fail | **FLAG GAPS AS CRITICAL** |
| 51 | Login Activity | Pass/Fail | |
| 52 | Website Homepage | Pass/Fail | |
| 53 | Website Services (home care) | Pass/Fail | |
| 54 | Website Blog | Pass/Fail | |
| 55 | Website Contact Form | Pass/Fail | |
| 56 | CMS Admin | Pass/Fail | |
| 57 | Website-to-CRM Flow | Pass/Fail | |

**For each failure:** Describe the error, include the URL, and take a screenshot.

**CRITICAL FLAG RULE:** If HIPAA Audit Logs are missing entries for client PHI access, medication changes, care plan modifications, or login events — mark as **CRITICAL FAIL** and escalate immediately. HIPAA compliance gaps in the Agency tier are a regulatory liability.

**Agency-tier value check:** The 10 bolded Agency-exclusive features (rows 37-46) justify the $599/mo price point. If more than 2 of these fail or are non-functional, flag for product review.
