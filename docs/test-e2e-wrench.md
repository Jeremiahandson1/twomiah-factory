# Twomiah Factory E2E Test — Wrench Field Service / HVAC (FLEET Tier $599/mo)

You are QA testing Twomiah Factory, a SaaS platform that generates and deploys CRM + Website software for service businesses. This is a LIVE production test of the **FLEET tier** ($599/mo) — the most expensive Wrench tier. You will sign up as a real HVAC/field service company, wait for deployment, then systematically test every feature in the deployed CRM and website.

FLEET tier includes ALL features from Starter ($49), Pro ($149), and Business ($299), PLUS: Multi-location dispatch, Advanced scheduling, Call tracking with recording, Commission tracking, and Service area pages.

Take screenshots at every major step. Report pass/fail for each feature. If something fails, describe the error, screenshot it, and move on.

---

## PHASE 1: SIGNUP

1. Navigate to: **https://twomiah.com/signup/wrench/**
2. Complete the signup wizard:

**Step 0 — Company Info:**
- Company Name: "Valley HVAC Pro QA"
- Industry: HVAC (or whichever field service option is available)
- Phone: 715-555-0599
- Address: 500 Grand Avenue
- City: Eau Claire
- State: Wisconsin
- ZIP: 54701
- Domain: (leave blank)
- Timezone: America/Chicago

**Step 1 — Branding:**
- Skip logo upload
- Primary Color: #DC2626 (red)

**Step 2 — Website Template:**
- Select the "field service" template

**Step 3 — Plan & Billing:**
- Select **Fleet** tier ($599/mo) — the highest tier
- Hosting: SaaS
- Add-ons: Check ALL available (SMS, GPS, Inventory, Fleet, Equipment, Marketing, Payments, Client Portal)
- Migration Source: "No migration needed"

**Step 4 — Deploy Service:**
- Select "Basic" ($299)

**Step 5 — Admin Account:**
- First Name: Test
- Last Name: WrenchFleet
- Email: test-wrench-fleet@twomiah.com
- Password: TestWrenchFleet2026!

**Step 6 — Review & Submit:**
- Verify all details show Fleet tier at $599/mo
- Check terms, submit
- If Stripe checkout appears, use test card: **4242 4242 4242 4242**, exp 12/28, CVC 123

3. **After submission:**
   - Screenshot the confirmation page
   - Note the slug (probably "valley-hvac-pro-qa")
   - If Stripe checkout appears, screenshot and report URL

---

## PHASE 2: VERIFY GITHUB REPO

1. Visit **https://github.com/Jeremiahandson1/valley-hvac-pro-qa**
2. Verify the repo contains actual application code:
   - [ ] `crm-fieldservice/` directory exists with `backend/` and `frontend/`
   - [ ] `crm-fieldservice/backend/src/index.ts` exists
   - [ ] `crm-fieldservice/backend/src/routes/` contains route files (contacts, jobs, quotes, invoices, equipment, fleet, inventory, commissions, locations, calltracking)
   - [ ] `crm-fieldservice/frontend/package.json` exists
   - [ ] `crm-fieldservice/frontend/src/pages/` contains page components (ContactsPage, JobsPage, EquipmentPage, FleetPage, LocationsPage, CommissionsPage, CallTrackingPage)
   - [ ] `website/` directory exists with `views/` (EJS templates) and `admin/` (CMS)
   - [ ] `render.yaml` exists at repo root
   - [ ] Migration files exist including `0005_add_fleet_tier_features.sql` (creates `location`, `commission_plan`, `commission` tables; extends `call_tracking`)
3. If repo only has README.md and deploy.sh — **stop and report P0 bug** (code generation failed)

---

## PHASE 3: VERIFY DEPLOYMENT

Wait 5-10 minutes, then:

1. Visit **https://valley-hvac-pro-qa.onrender.com** — CRM login page loads?
2. Visit **https://valley-hvac-pro-qa-site.onrender.com** — Website loads with red branding?

If URLs don't work, try: `valley-hvac-pro-qa-wrench-api.onrender.com`, or check the Factory platform at https://twomiah-factory-platform.onrender.com

- [ ] CRM login page loads
- [ ] Website homepage loads with red (#DC2626) branding
- [ ] Website shows "Valley HVAC Pro QA" company name

---

## PHASE 4: CRM LOGIN

1. Login with: **test-wrench-fleet@twomiah.com** / **TestWrenchFleet2026!**
2. Complete onboarding wizard if shown
3. Screenshot the dashboard

- [ ] Login succeeds
- [ ] Dashboard loads without errors

---

## PHASE 5: TEST CORE CRM FEATURES (Starter Tier)

### 5.1 Dashboard
- [ ] Dashboard loads with stats widgets
- [ ] Shows: Total Contacts, Active Jobs, Jobs Today, Pending Quotes, Open Invoices
- [ ] Revenue chart or summary visible
- [ ] Quick action buttons work

### 5.2 Contacts
- [ ] Navigate to Contacts page
- [ ] Create contact:
  - Name: "Bob Homeowner"
  - Type: Client
  - Email: bob@example.com
  - Phone: 715-555-3001
  - Address: 300 Elm St, Eau Claire, WI 54701
- [ ] Verify contact appears in list
- [ ] Open detail page — all fields correct
- [ ] Edit contact — add note: "Priority customer, annual maintenance agreement"
- [ ] Search for "Bob" — found?
- [ ] Create second contact:
  - Name: "Lisa Commercial"
  - Type: Client
  - Company: "Downtown Office Building"
  - Email: lisa@downtown.com
  - Phone: 715-555-3002
  - Address: 450 Main St, Eau Claire, WI 54701
- [ ] Create third contact:
  - Name: "Mike Property Manager"
  - Type: Client
  - Company: "Lakeside Apartments"
  - Email: mike@lakeside.com
  - Phone: 715-555-3003
  - Address: 800 Lake St, Eau Claire, WI 54701

### 5.3 Jobs / Service Calls
- [ ] Create a job:
  - Title: "AC Not Cooling - Homeowner"
  - Priority: High
  - Type: Service Call
  - Scheduled Date: tomorrow
  - Scheduled Time: 9:00 AM
  - Estimated Hours: 2
  - Estimated Value: $350
  - Contact: Bob Homeowner
  - Address: 300 Elm St, Eau Claire, WI 54701
- [ ] Verify auto-generated job number
- [ ] Open job detail — all fields correct
- [ ] Change status: Dispatch the job
- [ ] Change status: Start the job (In Progress)
- [ ] Change status: Complete the job
- [ ] Create second job:
  - Title: "Furnace Annual Maintenance"
  - Priority: Normal
  - Scheduled Date: day after tomorrow
  - Scheduled Time: 10:00 AM
  - Estimated Hours: 1.5
  - Estimated Value: $199
  - Contact: Bob Homeowner
  - Address: 300 Elm St, Eau Claire, WI 54701
- [ ] Create third job:
  - Title: "Commercial HVAC Inspection"
  - Priority: Normal
  - Scheduled Date: day after tomorrow
  - Scheduled Time: 2:00 PM
  - Estimated Hours: 3
  - Estimated Value: $450
  - Contact: Lisa Commercial
  - Address: 450 Main St, Eau Claire, WI 54701

### 5.4 Quotes
- [ ] Create a quote:
  - Name: "AC Repair Quote - Homeowner"
  - Contact: Bob Homeowner
  - Line items:
    1. "Diagnostic Fee", Qty: 1, Price: $89.00
    2. "Capacitor Replacement", Qty: 1, Price: $185.00
    3. "Refrigerant Recharge (2 lbs)", Qty: 2, Price: $75.00
  - Tax Rate: 5.5%
- [ ] Verify subtotal = $424.00 ($89 + $185 + $150)
- [ ] Verify tax = $23.32 (5.5% of $424)
- [ ] Verify total = $447.32
- [ ] Send the quote
- [ ] Approve the quote
- [ ] Download PDF — verify line items and totals on PDF
- [ ] Convert to invoice

### 5.5 Invoices
- [ ] Verify converted invoice exists with correct line items
- [ ] Invoice total matches quote total ($447.32)
- [ ] Send the invoice
- [ ] Record full payment ($447.32)
- [ ] Verify status = Paid
- [ ] Download PDF

### 5.6 Schedule / Calendar
- [ ] Calendar loads in week view
- [ ] Scheduled jobs appear on correct days
- [ ] "AC Not Cooling" appears on tomorrow at 9:00 AM
- [ ] "Furnace Annual Maintenance" appears on day after tomorrow at 10:00 AM
- [ ] Navigate forward/back through weeks
- [ ] Today highlighted

### 5.7 Customer Portal (Starter feature)
- [ ] Navigate to Customer Portal settings
- [ ] Enable portal access for Bob Homeowner
- [ ] Open portal URL
- [ ] Verify portal dashboard loads
- [ ] Check: customer sees their jobs
- [ ] Check: customer sees their invoices

### 5.8 Tech View / Mobile
- [ ] Navigate to /tech (Tech View page)
- [ ] See assigned jobs for the day
- [ ] View job details (address, customer info, equipment info)
- [ ] Check if HVAC checklist system works
- [ ] Accept a job from tech view
- [ ] Mark job steps as complete
- [ ] Complete the job from tech view

---

## PHASE 6: TEST PRO TIER FEATURES

### 6.1 Team Management
- [ ] Navigate to Team page
- [ ] Create team member:
  - Name: "Tom Technician"
  - Email: tom@valleyhvac.com
  - Role: Technician
  - Hourly Rate: $28.00
  - Phone: 715-555-4001
- [ ] Create second member:
  - Name: "Dave Lead Tech"
  - Email: dave@valleyhvac.com
  - Role: Lead Technician
  - Hourly Rate: $35.00
  - Phone: 715-555-4002
- [ ] Verify both appear in team list
- [ ] Edit Tom — add certification note: "EPA 608 Universal"

### 6.2 Time Tracking
- [ ] Create manual time entry:
  - Team Member: Tom Technician
  - Hours: 2
  - Date: today
  - Billable: Yes
  - Description: "AC repair at Homeowner residence"
- [ ] Create second entry:
  - Team Member: Dave Lead Tech
  - Hours: 1.5
  - Date: today
  - Billable: Yes
  - Description: "Diagnostic and supervision at Homeowner"
- [ ] Test clock in/out if available
- [ ] Verify weekly summary shows 3.5 total hours
- [ ] Check billable vs non-billable breakdown

### 6.3 GPS Tracking & Geofencing
- [ ] Navigate to Settings > Geofences
- [ ] Create a geofence:
  - Name: "Bob Homeowner Job Site"
  - Address: 300 Elm St, Eau Claire, WI 54701
  - Radius: 100 meters
- [ ] Verify geofence appears in list
- [ ] Edit the geofence — change radius to 150 meters
- [ ] Create second geofence:
  - Name: "Lisa Commercial Site"
  - Address: 450 Main St, Eau Claire, WI 54701
  - Radius: 200 meters
- [ ] Check location history page (may be empty)
- [ ] Verify auto clock in/out setting is available

### 6.4 Route Optimization
- [ ] Navigate to Route Optimizer page (or within Dispatch Board)
- [ ] Select the 3 jobs created (AC Not Cooling, Furnace Maintenance, Commercial Inspection)
- [ ] Optimize route
- [ ] Verify it generates an optimized order
- [ ] Check if Google Maps navigation link is provided
- [ ] Check fuel cost calculation if available
- [ ] Verify total estimated drive time displayed

### 6.5 Flat-Rate Pricebook
- [ ] Navigate to Pricebook page
- [ ] Create a category: "HVAC Repair"
- [ ] Create items with good/better/best pricing:
  - Name: "Capacitor Replacement"
  - Good: $149.00
  - Better: $189.00
  - Best: $229.00
- [ ] Create second item:
  - Name: "Refrigerant Recharge (per lb)"
  - Good: $65.00
  - Better: $75.00
  - Best: $85.00
- [ ] Create third item:
  - Name: "Blower Motor Replacement"
  - Good: $399.00
  - Better: $499.00
  - Best: $599.00
- [ ] Search for "Capacitor" — found?
- [ ] Export pricebook if available

### 6.6 Service Agreements / Maintenance Contracts
- [ ] Navigate to Agreements page
- [ ] Create a service plan (if plan management exists):
  - Name: "Annual HVAC Maintenance"
  - Price: $199/year
  - Includes: 2 visits per year
  - Description: "Bi-annual tune-up: spring AC check + fall furnace check"
- [ ] Create an agreement:
  - Customer: Bob Homeowner
  - Plan: Annual HVAC Maintenance
  - Start Date: today
  - Renewal: Annual
- [ ] Verify agreement appears in list
- [ ] Schedule a maintenance visit from the agreement
- [ ] Check upcoming visits
- [ ] Check billing due list
- [ ] Try generating an invoice from the agreement ($199)
- [ ] Create second agreement:
  - Customer: Lisa Commercial
  - Plan: "Quarterly Commercial HVAC Service"
  - Price: $499/quarter
  - Start Date: today

### 6.7 Two-Way SMS
- [ ] Navigate to Messages/SMS page
- [ ] Attempt to send a test message to Bob Homeowner (715-555-3001)
- [ ] Note any Twilio configuration errors
- [ ] Check message thread view

### 6.8 Online Booking
- [ ] Navigate to Online Booking settings
- [ ] Verify booking widget/page exists
- [ ] Check available service types
- [ ] Test booking flow if possible

### 6.9 Review Requests (NEW 2026-04-13)
- [ ] Navigate to /crm/reviews (ReviewsPage)
- [ ] Page loads without errors
- [ ] Send a review request to Bob Homeowner
  - Select job: "AC Not Cooling - Homeowner"
  - Method: Email
- [ ] Verify request appears in list with pending status
- [ ] Check if review link is generated

### 6.10 QuickBooks Integration
- [ ] Navigate to Settings > Integrations
- [ ] Verify QuickBooks sync option is available
- [ ] Check configuration fields (no need to actually connect)

---

## PHASE 7: TEST BUSINESS TIER FEATURES

### 7.1 Equipment Tracking
- [ ] Navigate to Equipment page
- [ ] Create equipment for a customer:
  - Customer: Bob Homeowner
  - Type: HVAC
  - Manufacturer: Carrier
  - Model: 24ACC636A003
  - Serial: CA-2024-78901
  - Install Date: 2020-06-15
  - Warranty Expiry: 2030-06-15
  - Location: Basement
  - Description: "Central air conditioning unit, 3-ton"
- [ ] Verify equipment appears in list
- [ ] Open detail — all fields correct
- [ ] Add a service history entry:
  - Date: today
  - Type: Repair
  - Description: "Replaced run capacitor 35/5 MFD, recharged 2 lbs R-410A refrigerant"
  - Cost: $349.00
  - Technician: Tom Technician
- [ ] Create second equipment:
  - Customer: Bob Homeowner
  - Type: HVAC
  - Manufacturer: Trane
  - Model: XR15
  - Serial: TR-2019-45678
  - Install Date: 2019-11-01
  - Warranty Expiry: 2029-11-01
  - Location: Basement
  - Description: "Furnace, 80K BTU"
- [ ] Create third equipment:
  - Customer: Lisa Commercial
  - Type: HVAC
  - Manufacturer: Lennox
  - Model: XC25
  - Serial: LX-2021-99887
  - Install Date: 2021-03-20
  - Warranty Expiry: 2031-03-20
  - Location: Rooftop Unit #1
- [ ] Check warranty expiring alerts
- [ ] Check maintenance due alerts
- [ ] Mark Carrier unit as needs repair

### 7.2 Fleet Management
- [ ] Navigate to Fleet page
- [ ] Add a vehicle:
  - Name: "Service Van #1"
  - Make: Ford
  - Model: Transit 250
  - Year: 2024
  - VIN: 1FTBW2CM5RKA12345
  - License Plate: WI-HVAC-01
- [ ] Assign to Tom Technician
- [ ] Log a fuel purchase:
  - Gallons: 15
  - Cost: $52.50
  - Odometer: 12,500
  - Date: today
  - Station: "Kwik Trip Eau Claire"
- [ ] Check fuel stats (cost per gallon = $3.50)
- [ ] Add maintenance record:
  - Type: Oil Change
  - Cost: $75.00
  - Mileage: 12,500
  - Date: today
  - Vendor: "Quick Lube Eau Claire"
- [ ] Add second vehicle:
  - Name: "Service Van #2"
  - Make: Chevrolet
  - Model: Express 2500
  - Year: 2023
  - License Plate: WI-HVAC-02
- [ ] Assign to Dave Lead Tech
- [ ] Check maintenance due alerts

### 7.3 Inventory / Parts Management
- [ ] Navigate to Inventory page
- [ ] Create inventory location: "Warehouse"
- [ ] Create second location: "Van #1"
- [ ] Create third location: "Van #2"
- [ ] Add a part:
  - Name: "Run Capacitor 35/5 MFD"
  - SKU: CAP-355
  - Category: HVAC Parts
  - Quantity: 25
  - Location: Warehouse
  - Reorder Point: 5
  - Cost: $12.50
  - Sell Price: $45.00
- [ ] Add second part:
  - Name: "R-410A Refrigerant 25lb"
  - SKU: REF-410A-25
  - Category: Refrigerants
  - Quantity: 10
  - Location: Warehouse
  - Reorder Point: 3
  - Cost: $85.00
  - Sell Price: $150.00
- [ ] Add third part:
  - Name: "Contactor 2-Pole 40A"
  - SKU: CON-240
  - Category: HVAC Parts
  - Quantity: 15
  - Location: Warehouse
  - Reorder Point: 5
  - Cost: $8.75
  - Sell Price: $35.00
- [ ] Transfer 5 capacitors from Warehouse to Van #1
- [ ] Transfer 3 capacitors from Warehouse to Van #2
- [ ] Verify Warehouse qty = 17, Van #1 qty = 5, Van #2 qty = 3
- [ ] Use/consume 1 capacitor on job "AC Not Cooling - Homeowner"
- [ ] Verify Van #1 qty = 4 (or wherever consumed from)
- [ ] Check low stock alerts
- [ ] Check inventory value report:
  - Capacitors: 24 remaining x $12.50 = $300.00
  - Refrigerant: 10 x $85.00 = $850.00
  - Contactors: 15 x $8.75 = $131.25
  - Total: $1,281.25

### 7.4 Warranties
- [ ] Navigate to Warranties page
- [ ] Verify equipment warranties appear (Carrier to 2030-06-15, Trane to 2029-11-01, Lennox to 2031-03-20)
- [ ] Check expiring warranty alerts

---

## PHASE 8: TEST FLEET TIER FEATURES ($599/mo EXCLUSIVE)

These features are ONLY available on Fleet tier. Test them thoroughly.

### 8.1 Multi-Location Dispatch (LocationsPage)
- [ ] Navigate to /crm/locations
- [ ] Page loads without errors
- [ ] Create branch location:
  - Name: "Chicago Branch"
  - Code: CHI
  - Address: 1200 W Madison St, Chicago, IL 60607
  - Phone: 312-555-0100
  - Manager: Dave Lead Tech
- [ ] Verify Chicago branch appears in card grid
- [ ] Create second branch:
  - Name: "Milwaukee Branch"
  - Code: MKE
  - Address: 750 N Water St, Milwaukee, WI 53202
  - Phone: 414-555-0200
  - Manager: (leave unassigned or assign Tom)
- [ ] Verify Milwaukee branch appears in card grid
- [ ] Edit Chicago branch — update phone to 312-555-0101
- [ ] Verify both locations show on the locations overview
- [ ] Check that existing Eau Claire HQ is listed as primary/default location

### 8.2 Commission Tracking (CommissionsPage)
- [ ] Navigate to /crm/commissions
- [ ] Page loads without errors

**Plans Tab:**
- [ ] Switch to Plans tab
- [ ] Create a commission plan:
  - Name: "Technician Standard Commission"
  - Type: percent_of_invoice
  - Rate: 10%
  - Applies to role: Technician
  - Description: "10% commission on all completed invoices"
- [ ] Verify plan appears in list
- [ ] Create second plan:
  - Name: "Lead Tech Bonus Commission"
  - Type: percent_of_invoice
  - Rate: 12%
  - Applies to role: Lead Technician
- [ ] Verify both plans listed

**Earnings Tab:**
- [ ] Switch to Earnings tab
- [ ] Create a commission record:
  - User: Tom Technician
  - Plan: Technician Standard Commission
  - Base Amount: $447.32 (from the AC repair invoice)
  - Commission Amount: $44.73 (10% of $447.32)
  - Job/Invoice reference: AC Not Cooling invoice
- [ ] Verify record appears with status "Pending"
- [ ] Run workflow: Pending -> Approve
- [ ] Verify status changes to "Approved"
- [ ] Run workflow: Approved -> Mark Paid
- [ ] Verify status changes to "Paid"
- [ ] Create second commission record:
  - User: Dave Lead Tech
  - Plan: Lead Tech Bonus Commission
  - Base Amount: $447.32
  - Commission Amount: $53.68 (12%)
- [ ] Approve and mark paid
- [ ] Verify commission summary/totals are correct

### 8.3 Call Tracking with Recording
- [ ] Navigate to /crm/call-tracking (CallTrackingPage)
- [ ] Page loads without errors
- [ ] Create/log a call record:
  - Contact: Bob Homeowner
  - Direction: Inbound
  - Duration: 4 minutes 30 seconds
  - Date/Time: today, 8:30 AM
  - Notes: "Customer called about AC not cooling, scheduled service call"
- [ ] Verify the following Fleet-tier fields exist on the call record:
  - [ ] `recording_url` field — enter a test URL: https://recordings.example.com/call-001.mp3
  - [ ] `transcription` field — enter: "Customer reports AC unit blowing warm air, unit is a Carrier 24ACC636A003 in basement. Scheduled for tomorrow 9 AM."
  - [ ] `transcription_status` field — verify options (pending, processing, completed, failed)
  - [ ] `recording_consent` field — set to true/yes
- [ ] Save the call record
- [ ] Verify all fields persist on reload
- [ ] Create second call:
  - Contact: Lisa Commercial
  - Direction: Outbound
  - Duration: 2 minutes 15 seconds
  - Notes: "Confirmed commercial inspection appointment"
  - recording_consent: true
- [ ] Search/filter calls by contact
- [ ] Check call analytics/summary if available

### 8.4 Dispatch Board — Multi-Location Filter
- [ ] Navigate to Dispatch Board
- [ ] Verify all jobs visible by default
- [ ] Filter by location: CHI (Chicago)
  - [ ] Only Chicago-assigned jobs should appear
- [ ] Filter by location: MKE (Milwaukee)
  - [ ] Only Milwaukee-assigned jobs should appear
- [ ] Clear filter — all jobs visible again
- [ ] Assign Tom Technician to "AC Not Cooling" job via dispatch board
- [ ] Track status flow on dispatch board:
  - [ ] Scheduled -> En Route
  - [ ] En Route -> On Site
  - [ ] On Site -> Completed
- [ ] Verify resource conflicts — try to double-book Tom at same time
  - [ ] System should warn about scheduling conflict
- [ ] Check technician availability view shows both Tom and Dave

### 8.5 Advanced Scheduling
- [ ] Navigate to Schedule page
- [ ] Verify multi-technician calendar view
- [ ] Drag-and-drop job reassignment (if supported)
- [ ] Check schedule across locations
- [ ] Verify schedule respects technician assignments per location

### 8.6 Service Area Pages (Website Feature)
- [ ] Visit the deployed website
- [ ] Check for service area pages (e.g., /areas or /service-areas)
- [ ] Verify per-area pages exist (Eau Claire, Chicago, Milwaukee)
- [ ] Each area page shows relevant services
- [ ] Area pages have proper SEO content (H1, meta description)

---

## PHASE 9: TEST REMAINING FEATURES

### 9.1 Recurring Jobs
- [ ] Navigate to Recurring Jobs page
- [ ] Create a recurring job:
  - Title: "Quarterly Filter Change - Homeowner"
  - Frequency: Every 3 months
  - Contact: Bob Homeowner
  - Address: 300 Elm St, Eau Claire, WI 54701
  - Estimated Hours: 0.5
  - Estimated Value: $89
- [ ] Verify it appears in list
- [ ] Generate next job from the recurring schedule
- [ ] Verify generated job appears in Jobs list with correct date (3 months from now)

### 9.2 Expenses
- [ ] Create an expense:
  - Category: Materials
  - Vendor: "HVAC Supply Co"
  - Description: "Capacitors and refrigerant restock"
  - Amount: $450.00
  - Date: today
  - Billable: No
- [ ] Create second expense:
  - Category: Vehicle
  - Vendor: "Quick Lube Eau Claire"
  - Description: "Oil change Service Van #1"
  - Amount: $75.00
  - Billable: No

### 9.3 Documents & Photos
- [ ] Upload a test document (e.g., equipment manual PDF)
- [ ] Attach it to Bob Homeowner contact
- [ ] Upload a photo and attach to "AC Not Cooling" job

### 9.4 Lead Inbox
- [ ] Navigate to Lead Inbox
- [ ] Check Lead Sources page
- [ ] Verify pages load
- [ ] Create a test lead source: "Google Ads"

### 9.5 Reports
- [ ] Navigate to Reports page
- [ ] Run revenue report — verify invoice data appears
- [ ] Run job costing report — verify job and labor data
- [ ] Run technician productivity report — verify Tom and Dave appear
- [ ] Check commission report (Fleet feature)
- [ ] Check fleet/vehicle expense report

### 9.6 Settings & Integrations
- [ ] Company settings — verify info shows "Valley HVAC Pro QA", Eau Claire, WI
- [ ] Check integrations page (QuickBooks, Twilio, Stripe options)
- [ ] Check geofence settings accessible from settings
- [ ] Verify feature flags show ALL Fleet tier features enabled
- [ ] Verify user limit matches Fleet tier (check expected user count)

---

## PHASE 10: CUSTOMER PORTAL (Full Test)

- [ ] Ensure portal access is enabled for Bob Homeowner
- [ ] Open portal URL
- [ ] Verify portal dashboard loads

### Portal Features:
- [ ] Customer sees their equipment (Carrier 24ACC636A003, Trane XR15)
- [ ] Equipment detail shows service history (capacitor replacement)
- [ ] Customer sees service agreements (Annual HVAC Maintenance, $199/year)
- [ ] Customer sees invoices (AC Repair, $447.32, Paid)
- [ ] Customer can submit a service request:
  - Type: "Furnace not heating"
  - Description: "Furnace makes clicking sound but doesn't ignite"
  - Preferred Date: next week
- [ ] Verify service request appears in CRM as new job/lead
- [ ] Customer can make online payment (if Stripe configured)
- [ ] Portal shows upcoming scheduled maintenance visits

---

## PHASE 11: TEST THE DEPLOYED WEBSITE

1. Visit the website URL: **https://valley-hvac-pro-qa-site.onrender.com**

### 11.1 Public Pages
- [ ] Homepage loads — "Valley HVAC Pro QA" with red (#DC2626) branding
- [ ] Services page — shows HVAC/plumbing/electrical services
- [ ] Gallery page loads
- [ ] Blog page loads
- [ ] Contact page loads with form
- [ ] Service area pages load (Fleet tier feature)
- [ ] Mobile responsive — check on narrow viewport

### 11.2 Contact Form
- [ ] Submit a contact form:
  - Name: "Website Lead"
  - Email: web-lead@example.com
  - Phone: 715-555-8888
  - Message: "My AC stopped working, need emergency repair"
  - Service: HVAC Repair (or similar)
- [ ] Verify submission succeeds (confirmation message shown)

### 11.3 CMS Admin
- [ ] Navigate to /admin on the website
- [ ] Login with admin credentials
- [ ] Create a blog post:
  - Title: "5 Signs Your AC Needs Repair This Summer"
  - Content: Test content about HVAC maintenance tips
- [ ] Add a testimonial:
  - Name: "Bob H."
  - Text: "Valley HVAC Pro QA fixed our AC same day. Great service!"
  - Rating: 5 stars
- [ ] Edit a service description
- [ ] Upload media (test image)
- [ ] Check leads — does the contact form submission from "Website Lead" appear?

### 11.4 Service Area Pages (Fleet Tier)
- [ ] Navigate to service area pages on website
- [ ] Verify Eau Claire area page exists with local content
- [ ] Check for Chicago and Milwaukee area pages (if auto-generated from locations)
- [ ] Each area page has: H1 with city name, service list, contact info, CTA
- [ ] Area pages are linked from main navigation or footer

---

## PHASE 12: WEBSITE-TO-CRM FLOW

- [ ] Back in CRM, navigate to Lead Inbox or Contacts
- [ ] Verify the "Website Lead" contact form submission created a lead/contact
- [ ] Lead shows: name "Website Lead", email web-lead@example.com, message "My AC stopped working"
- [ ] Lead source tagged as "Website" or "Contact Form"
- [ ] Convert lead to contact and create a job from it

---

## PHASE 13: FINAL SUMMARY

Fill in pass/fail for every feature tested:

| Feature | Status | Notes |
|---------|--------|-------|
| **SIGNUP & DEPLOY** | | |
| Signup Flow (Fleet $599) | Pass/Fail | |
| GitHub Repo Generation | Pass/Fail | |
| CRM Deployment | Pass/Fail | |
| Website Deployment | Pass/Fail | |
| CRM Login | Pass/Fail | |
| **STARTER TIER** | | |
| Dashboard | Pass/Fail | |
| Contacts CRUD | Pass/Fail | |
| Jobs / Service Calls | Pass/Fail | |
| Quotes + Tax Calc + PDF | Pass/Fail | |
| Invoices + Payments | Pass/Fail | |
| Schedule / Calendar | Pass/Fail | |
| Customer Portal (basic) | Pass/Fail | |
| Tech View /tech | Pass/Fail | |
| **PRO TIER** | | |
| Team Management | Pass/Fail | |
| Time Tracking | Pass/Fail | |
| GPS & Geofencing | Pass/Fail | |
| Route Optimization | Pass/Fail | |
| Flat-Rate Pricebook (GBB) | Pass/Fail | |
| Service Agreements | Pass/Fail | |
| Two-Way SMS | Pass/Fail | |
| Online Booking | Pass/Fail | |
| Review Requests (2026-04-13) | Pass/Fail | |
| QuickBooks Integration | Pass/Fail | |
| **BUSINESS TIER** | | |
| Equipment Tracking | Pass/Fail | |
| Fleet Management | Pass/Fail | |
| Inventory / Parts | Pass/Fail | |
| Parts Transfer (Warehouse->Van) | Pass/Fail | |
| Parts Consume on Job | Pass/Fail | |
| Warranties | Pass/Fail | |
| **FLEET TIER ($599 EXCLUSIVE)** | | |
| **Multi-Location Dispatch (LocationsPage)** | Pass/Fail | |
| **Location: Chicago (CHI)** | Pass/Fail | |
| **Location: Milwaukee (MKE)** | Pass/Fail | |
| **Commission Plans (percent_of_invoice)** | Pass/Fail | |
| **Commission Earnings Workflow** | Pass/Fail | |
| **Commission: Pending->Approve->Paid** | Pass/Fail | |
| **Call Tracking with Recording** | Pass/Fail | |
| **Call: recording_url field** | Pass/Fail | |
| **Call: transcription field** | Pass/Fail | |
| **Call: transcription_status field** | Pass/Fail | |
| **Call: recording_consent field** | Pass/Fail | |
| **Dispatch Board Multi-Location Filter** | Pass/Fail | |
| **Advanced Scheduling** | Pass/Fail | |
| **Service Area Pages (Website)** | Pass/Fail | |
| **OTHER FEATURES** | | |
| Recurring Jobs | Pass/Fail | |
| Expenses | Pass/Fail | |
| Documents & Photos | Pass/Fail | |
| Lead Inbox | Pass/Fail | |
| Reports (Revenue, Job Costing) | Pass/Fail | |
| Settings & Feature Flags | Pass/Fail | |
| **CUSTOMER PORTAL (FULL)** | | |
| Portal: View Equipment | Pass/Fail | |
| Portal: View Agreements | Pass/Fail | |
| Portal: View Invoices | Pass/Fail | |
| Portal: Submit Service Request | Pass/Fail | |
| Portal: Online Payment | Pass/Fail | |
| **WEBSITE** | | |
| Website Homepage | Pass/Fail | |
| Website Services Page | Pass/Fail | |
| Website Contact Form | Pass/Fail | |
| Website Blog | Pass/Fail | |
| Website Mobile Responsive | Pass/Fail | |
| CMS Admin | Pass/Fail | |
| Website-to-CRM Lead Flow | Pass/Fail | |

**Total Features Tested:** ___
**Passed:** ___
**Failed:** ___
**Blocked:** ___

### Fleet-Tier Specific Verdict

| Fleet Feature | Working? | Details |
|---------------|----------|---------|
| **LocationsPage** | Yes/No | CHI + MKE created, card grid renders |
| **CommissionsPage — Plans** | Yes/No | percent_of_invoice plan at 10% |
| **CommissionsPage — Earnings** | Yes/No | Workflow: pending -> approve -> paid |
| **CallTrackingPage — Recording** | Yes/No | recording_url, transcription, transcription_status, recording_consent |
| **DispatchBoard — Multi-Location** | Yes/No | Filter by CHI/MKE, resource conflicts |
| **Service Area Pages** | Yes/No | Per-city pages on website |

**Fleet tier delivers what's marketed?** YES / NO

For each failure: describe the error, include screenshot, note severity (P0 critical / P1 major / P2 minor).
