# Twomiah Factory Live Test — Home Care (Twomiah Care)

You are QA testing Twomiah Factory, a SaaS platform that generates and deploys CRM + Website software for service businesses. This is a LIVE production test. You will sign up as a home care agency, wait for deployment, then systematically test every feature in the deployed CRM and website.

This is the most specialized vertical — it has a completely different data model from the base CRM (Clients instead of Contacts, Caregivers instead of Team, Care Plans, ADLs, EVV, Claims, etc.). Test thoroughly.

Take screenshots at every major step. Report pass/fail for each feature.

---

## PHASE 1: SIGNUP

1. Navigate to: **https://twomiah.com/signup/care/**
2. Complete the signup wizard:

**Step 0 — Company Info:**
- Company Name: "Chippewa Home Care QA"
- Industry: Home Care / Healthcare
- Phone: 715-555-0303
- Address: 300 Water Street
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
- Select "Pro" plan ($149/mo)
- Hosting: SaaS
- Add-ons: Check ALL available (SMS, EVV, Payroll, HIPAA Compliance Tools, etc.)
- Migration Source: "No migration needed"

**Step 4 — Deploy Service:**
- Select "Basic" ($299)

**Step 5 — Admin Account:**
- First Name: Test
- Last Name: Care
- Email: test-care@twomiah.com
- Password: TestCare2026!

**Step 6 — Review & Submit:**
- Verify all details, check terms, submit

3. **After submission:** Screenshot, note slug ("chippewa-home-care-qa"), note any Stripe checkout redirect

---

## PHASE 2: VERIFY DEPLOYMENT

Wait 5-10 minutes, then:

1. Visit **https://chippewa-home-care-qa.onrender.com** — CRM loads?
2. Visit **https://chippewa-home-care-qa-site.onrender.com** — Website loads with green branding?

---

## PHASE 3: CRM LOGIN

1. Login with: test-care@twomiah.com / TestCare2026!
2. Complete onboarding wizard if shown
3. Screenshot the dashboard

---

## PHASE 4: TEST OPERATIONS & CLIENT MANAGEMENT

### 4.1 Dashboard
- [ ] Dashboard loads with home care specific metrics
- [ ] Shows relevant stats (clients, caregivers, scheduled visits, etc.)

### 4.2 Clients (NOT "Contacts" — home care uses Clients)
- [ ] Navigate to Clients page
- [ ] Create a client:
  - Name: "Dorothy Williams"
  - Email: dorothy@example.com
  - Phone: 715-555-4001
  - Address: 400 River Rd, Chippewa Falls, WI 54729
  - Service Type: (select if available, e.g., Personal Care)
  - Status: Active
- [ ] Verify client appears in list
- [ ] Open client detail page — all fields display?
- [ ] Add emergency contact:
  - Name: "Robert Williams" (son)
  - Phone: 715-555-4002
  - Relationship: Son
- [ ] Check client onboarding checklist (emergency contacts, medical history, insurance, care preferences, etc.)
- [ ] Create second client:
  - Name: "Harold Johnson"
  - Phone: 715-555-4003
  - Address: 500 Main Ave, Chippewa Falls, WI 54729

### 4.3 Referral Sources
- [ ] Navigate to Referral Sources page
- [ ] Create a referral source:
  - Name: "St. Joseph's Hospital"
  - Type: Healthcare Provider
  - Contact: "Dr. Sarah Chen"
  - Phone: 715-555-5001
  - Email: referrals@stjosephs.example.com
- [ ] Verify it appears in list

### 4.4 Care Plans
- [ ] Navigate to Care Plans page
- [ ] Create a care plan for Dorothy Williams:
  - Service Type: Personal Care
  - Frequency: 3x per week, 4 hours each
  - Goals: "Maintain independence with daily activities"
  - Special Instructions: "Client prefers morning visits. Allergic to latex."
  - Precautions: "Fall risk — use gait belt for transfers"
  - Start Date: today
  - Status: Active
- [ ] Verify care plan appears
- [ ] Open detail — all fields correct?
- [ ] Edit the care plan — add a goal

---

## PHASE 5: TEST CAREGIVERS & RECRUITMENT

### 5.1 Caregivers
- [ ] Navigate to Caregivers page
- [ ] Create a caregiver:
  - Name: "Maria Garcia"
  - Email: maria@chippewahomecare.com
  - Phone: 715-555-6001
  - Role: CNA
  - Hourly Rate: $18
  - Status: Active
- [ ] Verify caregiver appears in list
- [ ] Open caregiver detail — all fields?
- [ ] Create second caregiver:
  - Name: "James Wilson"
  - Email: james@chippewahomecare.com
  - Phone: 715-555-6002
  - Role: HHA (Home Health Aide)
  - Hourly Rate: $16
- [ ] Filter caregivers by status (Active)
- [ ] Search for "Maria" — found?

### 5.2 Certifications
- [ ] Add a certification for Maria Garcia:
  - Type: CNA
  - Issue Date: 2024-01-15
  - Expiry Date: 2026-01-15
  - Issuing Body: "Wisconsin DHS"
- [ ] Add a second certification:
  - Type: CPR/First Aid
  - Issue Date: 2025-06-01
  - Expiry Date: 2027-06-01
- [ ] Verify certifications appear on caregiver profile

### 5.3 Background Checks
- [ ] Navigate to Background Checks page
- [ ] Initiate a background check for Maria Garcia:
  - Type: Criminal
  - Provider: (enter test or select if dropdown)
  - Status: Pending
- [ ] Update the status to "Cleared"
- [ ] Set expiration date: 1 year from now
- [ ] Verify it appears on compliance dashboard

### 5.4 Job Applications (if available)
- [ ] Navigate to Job Applications page
- [ ] Verify page loads (may be empty)
- [ ] Create a test application if possible

### 5.5 Performance Ratings
- [ ] Navigate to Performance page
- [ ] Check if any rating options are available
- [ ] Submit a test rating for Maria Garcia if possible

---

## PHASE 6: TEST SCHEDULING & TIME TRACKING

### 6.1 Schedule Hub
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
- [ ] Drag-drop a shift to reschedule (if drag-drop enabled)
- [ ] Cancel a shift and recreate it

### 6.2 Caregiver Availability
- [ ] Set availability for Maria Garcia:
  - Monday-Friday: 7:00 AM - 5:00 PM
  - Saturday: 8:00 AM - 12:00 PM
  - Sunday: Off
  - Max weekly hours: 40
- [ ] Verify availability is saved and displays correctly

### 6.3 Open Shifts
- [ ] Create an open shift (unassigned):
  - Client: Dorothy Williams
  - Date: 3 days from now
  - Time: 8:00 AM - 12:00 PM
- [ ] Verify open shift appears in list
- [ ] Claim the open shift as Maria Garcia
- [ ] Verify it moves to the regular schedule

### 6.4 Time Tracking / Clock In-Out
- [ ] Create a manual time entry:
  - Caregiver: Maria Garcia
  - Client: Dorothy Williams
  - Date: today
  - Clock In: 8:00 AM
  - Clock Out: 12:00 PM
  - Hours: 4
- [ ] Verify entry appears in time tracking list
- [ ] Test clock in/out functionality if available
- [ ] Add visit notes to the time entry

### 6.5 Emergency Coverage (if available)
- [ ] Navigate to Emergency Coverage page
- [ ] Verify page loads

### 6.6 No-Show Alerts (if available)
- [ ] Navigate to No-Show Alerts page
- [ ] Verify page loads

### 6.7 Route Optimizer (if available)
- [ ] Navigate to Route Optimizer
- [ ] Try optimizing routes for caregivers with multiple visits

---

## PHASE 7: TEST CLINICAL & CARE TRACKING

### 7.1 ADL Tracking (Activities of Daily Living)
- [ ] Navigate to ADL Tracking page
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
  - Bathing: Completed
  - Dressing: Completed
  - Toileting: Completed
  - Mobility: Completed with notes "Used walker, no issues"
- [ ] Verify ADL logs appear with timestamps

### 7.2 Medications
- [ ] Navigate to Medications page (for Dorothy Williams)
- [ ] Add a medication:
  - Name: "Metformin"
  - Dosage: 500mg
  - Frequency: Twice daily
  - Pharmacy: "Walgreens Chippewa Falls"
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
- [ ] Verify medication log appears

### 7.3 Incidents
- [ ] Navigate to Incidents page
- [ ] Create an incident report:
  - Client: Dorothy Williams
  - Caregiver: Maria Garcia
  - Date: today
  - Type: Near-fall
  - Severity: Low
  - Description: "Client was unsteady getting out of shower. Caregiver assisted. No injury."
  - Resolution: "Reminded client to use grab bars. Added non-slip mat."
- [ ] Verify incident appears in list
- [ ] Update the incident status to Resolved

### 7.4 Form Builder (if available)
- [ ] Navigate to Form Builder page
- [ ] Create a custom form template:
  - Name: "Daily Visit Checklist"
  - Fields: Checkboxes for ADLs, text area for notes, signature
- [ ] Submit a test form

---

## PHASE 8: TEST COMPLIANCE

### 8.1 Compliance Dashboard
- [ ] Navigate to Compliance Dashboard
- [ ] Verify it shows:
  - Caregivers with expiring certifications
  - Background checks needing renewal
  - Missing documentation alerts
- [ ] Screenshot the dashboard

### 8.2 Documents
- [ ] Upload a test document (e.g., test policy PDF)
- [ ] Attach to a caregiver or client
- [ ] Verify it appears in the documents list

### 8.3 Audit Logs
- [ ] Navigate to Audit Logs page
- [ ] Verify actions from this testing session are logged
- [ ] Search/filter the audit log

### 8.4 Login Activity
- [ ] Navigate to Login Activity page
- [ ] Verify your login is recorded

---

## PHASE 9: TEST FINANCIAL MANAGEMENT

### 9.1 Billing / Invoices
- [ ] Navigate to Billing page
- [ ] Create an invoice for Dorothy Williams:
  - Service: Personal Care
  - Hours: 12 (3 visits x 4 hours)
  - Rate: $28/hour
  - Total: $336
  - Due Date: 2 weeks from now
- [ ] Send the invoice
- [ ] Record a payment
- [ ] Download/print the invoice

### 9.2 Claims & EDI (if EVV/Sandata enabled)
- [ ] Navigate to Claims page
- [ ] Create a claim:
  - Payer: (select or create a test payer like "Wisconsin Medicaid")
  - Client: Dorothy Williams
  - Service dates: this week
  - Service code: (select available)
  - Units: 12
- [ ] Submit the claim
- [ ] Check claim status
- [ ] Generate EDI 837 file if available

### 9.3 Payers & Service Codes
- [ ] Navigate to Payers page (or within billing)
- [ ] Create a payer:
  - Name: "Wisconsin Medicaid"
  - Type: Medicaid
  - Contact: "Claims Dept"
  - Phone: 800-555-0000
- [ ] Navigate to Service Codes
- [ ] Create a service code:
  - Code: "T1019"
  - Description: "Personal Care Services"
  - Rate: $28/hour

### 9.4 Authorizations
- [ ] Create an authorization:
  - Client: Dorothy Williams
  - Payer: Wisconsin Medicaid
  - Service Code: T1019
  - Authorized Units: 120 hours
  - Start Date: first of this month
  - End Date: end of this month
- [ ] Verify units used tracking works

### 9.5 Payroll (if enabled)
- [ ] Navigate to Payroll page
- [ ] Calculate payroll for this week
- [ ] Verify Maria Garcia's hours show correctly
- [ ] Export payroll if available

### 9.6 Expenses
- [ ] Create an expense:
  - Category: Supplies
  - Description: "Gloves and sanitizer"
  - Amount: $45
  - Reimbursable: Yes

### 9.7 Reports
- [ ] Navigate to Reports page
- [ ] Run available reports (revenue by payer, caregiver hours, client activity)

### 9.8 Revenue Forecast (if available)
- [ ] Navigate to Revenue Forecast page
- [ ] Verify it loads with projections

---

## PHASE 10: TEST EVV (Electronic Visit Verification)

### 10.1 EVV Dashboard (if enabled)
- [ ] Navigate to EVV Dashboard
- [ ] Verify it shows visit verification status
- [ ] Check GPS verification map
- [ ] Verify time entries link to EVV records

### 10.2 Sandata Integration (if configured)
- [ ] Check Sandata submission status
- [ ] Try submitting a test visit to Sandata (will likely fail without real credentials — note the error)

---

## PHASE 11: TEST COMMUNICATION

### 11.1 Message Board
- [ ] Navigate to Messages / Communication
- [ ] Create a message thread:
  - To: Maria Garcia
  - Subject: "Schedule Update"
  - Message: "Your Monday shift has been moved to 9 AM"
- [ ] Verify message appears

### 11.2 Communication Log
- [ ] Navigate to Communication Log
- [ ] Log a communication:
  - Type: Phone Call
  - Contact: Dorothy Williams (or family)
  - Notes: "Called son Robert to discuss care plan updates"
- [ ] Verify it appears in the log

### 11.3 SMS (if enabled)
- [ ] Try sending an SMS
- [ ] Note any Twilio configuration errors

### 11.4 Alerts
- [ ] Navigate to Alerts page
- [ ] Create an alert if possible
- [ ] Check notification settings

---

## PHASE 12: TEST FAMILY PORTAL

### 12.1 Portal Setup
- [ ] Enable portal access for Dorothy Williams
- [ ] Get the portal login link/credentials
- [ ] Open the portal in a new tab

### 12.2 Portal Features
- [ ] Dashboard loads — shows client status
- [ ] **My Schedule**: View upcoming visits
- [ ] **Visit History**: View past visits with caregiver names and times
- [ ] **My Caregivers**: See Maria Garcia assigned
- [ ] **Care Plan**: View Dorothy's care plan details
- [ ] **Billing**: View invoices
- [ ] **Messages**: Send a message to the agency
- [ ] **Notifications**: Check for alerts

---

## PHASE 13: TEST THE DEPLOYED WEBSITE

Visit the website URL.

### 13.1 Public Pages
- [ ] Homepage loads — "Chippewa Home Care QA" with green branding
- [ ] Services page — shows home care services (personal care, respite, companionship, etc.)
- [ ] Gallery page loads (may show caregiver/client images)
- [ ] Blog page loads
- [ ] Contact page with form
- [ ] Submit a contact form:
  - Name: "Family Member"
  - Email: family@example.com
  - Phone: 715-555-7777
  - Message: "Looking for home care for my mother"
- [ ] Verify submission succeeds
- [ ] Mobile responsive check

### 13.2 CMS Admin
- [ ] Navigate to /admin
- [ ] Login
- [ ] Create a blog post about home care tips
- [ ] Edit service descriptions
- [ ] Add a testimonial from a family
- [ ] Check leads for the contact form submission

### 13.3 Website-to-CRM Flow
- [ ] In CRM, check if website lead appeared

---

## PHASE 14: FINAL SUMMARY

| Feature | Status | Notes |
|---------|--------|-------|
| Signup Flow | Pass/Fail | |
| Deployment | Pass/Fail | |
| CRM Login | Pass/Fail | |
| Dashboard | Pass/Fail | |
| **Clients CRUD** | Pass/Fail | |
| **Referral Sources** | Pass/Fail | |
| **Care Plans** | Pass/Fail | |
| **Caregivers CRUD** | Pass/Fail | |
| **Certifications** | Pass/Fail | |
| **Background Checks** | Pass/Fail | |
| **Schedule Hub** | Pass/Fail | |
| **Caregiver Availability** | Pass/Fail | |
| **Open Shifts** | Pass/Fail | |
| **Time Tracking / Clock** | Pass/Fail | |
| **ADL Tracking** | Pass/Fail | |
| **Medications** | Pass/Fail | |
| **Incidents** | Pass/Fail | |
| **Form Builder** | Pass/Fail | |
| **Compliance Dashboard** | Pass/Fail | |
| **Audit Logs** | Pass/Fail | |
| **Billing / Invoices** | Pass/Fail | |
| **Claims & EDI** | Pass/Fail | |
| **Payers & Service Codes** | Pass/Fail | |
| **Authorizations** | Pass/Fail | |
| **Payroll** | Pass/Fail | |
| **EVV** | Pass/Fail | |
| **Communication / Messages** | Pass/Fail | |
| **SMS** | Pass/Fail | |
| **Family Portal** | Pass/Fail | |
| Reports | Pass/Fail | |
| Settings | Pass/Fail | |
| Website Homepage | Pass/Fail | |
| Website Services | Pass/Fail | |
| Website Contact Form | Pass/Fail | |
| CMS Admin | Pass/Fail | |
| Website-to-CRM Flow | Pass/Fail | |

For each failure: describe the error, screenshot it.
