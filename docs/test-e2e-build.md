# Twomiah Factory E2E Test — Build CRM, Construction Tier ($599/mo)

You are QA testing Twomiah Factory, a SaaS platform that generates and deploys CRM + Website software for service businesses. This is a LIVE production test of the **Construction tier** ($599/mo, 20 users) on the **Build** vertical (general contractor CRM). This is the MOST EXPENSIVE tier and includes ALL features from Starter, Pro, and Business tiers PLUS construction-specific features.

Take screenshots at every major step. Report pass/fail for each feature. If something fails, describe the error, screenshot it, and move on to the next test.

---

## PHASE 1: SIGNUP

1. Navigate to the marketing page: **https://twomiah.com/build.html**
   - [ ] Verify the page loads
   - [ ] Verify "Construction" tier is listed at **$599/mo** with **20 users**
   - [ ] Verify Construction tier advertises: Projects, RFIs & Submittals, Draw Schedules & Lien Waivers, AIA G702/G703 Forms, Takeoffs & Selections, Portfolio Website with Gallery
   - [ ] Screenshot the pricing section

2. Navigate to: **https://twomiah.com/signup/build/**

3. Complete the 7-step wizard:

**Step 0 -- Company Info:**
- Company Name: `Andson Construction QA`
- Industry: General Contractor
- Phone: `715-555-0199`
- Address: `400 Galloway Street`
- City: `Eau Claire`
- State: `Wisconsin`
- ZIP: `54703`
- Domain: (leave blank)
- Timezone: `America/Chicago`

**Step 1 -- Branding:**
- Skip logo upload (use default)
- Primary Color: `#1E3A5F` (dark navy)

**Step 2 -- Website Template:**
- Select the first "contractor" template shown

**Step 3 -- Plan & Billing:**
- Select **"Construction"** plan ($599/mo)
- Hosting: SaaS (Hosted by Twomiah)
- Add-ons: Check ALL available add-ons (SMS, GPS, Inventory, Fleet, Equipment, Marketing, Payments, Client Portal)
- Migration Source: "No migration needed"
- [ ] Verify the monthly total shows $599/mo
- [ ] Verify "20 users included" is shown
- [ ] Screenshot the plan selection

**Step 4 -- Deploy Service:**
- Select "Basic" ($299)

**Step 5 -- Admin Account:**
- First Name: `Test`
- Last Name: `BuildConst`
- Email: `test-build-construction@twomiah.com`
- Password: `TestBuildConst2026!`

**Step 6 -- Review & Submit:**
- [ ] Verify all details look correct:
  - Company: Andson Construction QA
  - Plan: Construction ($599/mo)
  - Deploy: Basic ($299)
  - Admin: test-build-construction@twomiah.com
- [ ] Check terms box if present
- [ ] Screenshot the review page

4. **Payment:**
   - When redirected to Stripe checkout, enter:
     - Card: `4242 4242 4242 4242`
     - Exp: `12/28`
     - CVC: `123`
     - ZIP: `54703`
   - [ ] Submit payment
   - [ ] Screenshot the confirmation/success page

5. **After submission:**
   - Note the tenant slug (expected: `andson-construction-qa`)
   - Note any tenant ID returned
   - [ ] Screenshot the response/confirmation page

---

## PHASE 2: VERIFY GITHUB REPO

Each tenant gets their own private GitHub repo. Verify the code was pushed correctly:

1. Visit **https://github.com/Jeremiahandson1/andson-construction-qa** (or whatever the slug is)
2. Verify the repo contains these directories and files -- NOT just README.md and deploy.sh:
   - [ ] `crm/` directory exists
   - [ ] `crm/backend/` exists with `src/index.ts`, `db/`, `package.json`
   - [ ] `crm/backend/src/routes/` contains route files for construction features: `submittals.ts`, `rfis.ts`, `dailyLogs.ts`, `punchLists.ts`, `inspections.ts`, `bids.ts`, `ganttCharts.ts`, `selections.ts`, `takeoffs.ts`, `lienWaivers.ts`, `drawSchedules.ts`, `aiaForms.ts`
   - [ ] `crm/backend/src/config/pricing.ts` exists and Construction tier features array includes all construction features
   - [ ] `crm/frontend/` exists with `src/`, `package.json`, `vite.config.js`
   - [ ] `crm/frontend/src/pages/` contains Construction-tier page directories: `submittals/`, `rfis/`, `daily-logs/`, `punch-lists/`, `inspections/`, `bids/`, `gantt/`, `selections/`, `takeoffs/`, `lien-waivers/`, `draw-schedules/`, `aia-forms/`
   - [ ] `website/` directory exists
   - [ ] `website/views/` exists with EJS templates (home.ejs, blog.ejs, contact.ejs, about.ejs, gallery.ejs)
   - [ ] `website/admin/` exists (CMS dashboard source)
   - [ ] `render.yaml` exists at repo root (Render Blueprint config)
   - [ ] `README.md` exists
   - [ ] `deploy.sh` exists
3. If the repo only has README.md and deploy.sh (no crm/ or website/ directories), the code generation failed -- **stop testing and report this as a P0 bug**
4. Check the most recent commit message -- should say "Initial Twomiah Factory deployment" or "Code update from Twomiah Factory"
5. Check the DB migration files:
   - [ ] `crm/backend/db/` contains migration `0010_add_construction_compliance.sql` (creates `draw_schedule`, `draw_request`, `aia_form` tables)
   - [ ] Verify `submittal` and `lien_waiver` tables are referenced in earlier migrations

---

## PHASE 3: VERIFY DEPLOYMENT

Wait 5-10 minutes after signup/payment for Render to deploy, then:

1. Visit **https://andson-construction-qa.onrender.com** (CRM)
   - [ ] Does the CRM login page load? Screenshot it.
   - [ ] Does the page title/branding show "Andson Construction QA"?
2. Visit **https://andson-construction-qa-site.onrender.com** (Portfolio Website)
   - [ ] Does the website load? Screenshot it.
   - [ ] Is the branding navy (#1E3A5F)?
   - [ ] Does the company name show "Andson Construction QA"?
   - [ ] Does the website include a gallery/portfolio section? (Construction tier includes portfolio website)

If URLs don't work, try these alternate patterns:
- https://andson-construction-qa-api.onrender.com
- Check the Factory platform at https://twomiah-factory-platform.onrender.com for the actual deployed URLs

---

## PHASE 4: CRM LOGIN & ONBOARDING

1. Go to the CRM login page
2. Login with: `test-build-construction@twomiah.com` / `TestBuildConst2026!`
3. If an onboarding wizard appears, complete it:
   - Fill in company details
   - Set up team basics
   - Enable all suggested features
4. [ ] Screenshot the dashboard after login
5. [ ] Verify the sidebar shows Construction-tier navigation items (Projects, RFIs, Submittals, Daily Logs, Punch Lists, Inspections, Bids, Gantt, Selections, Takeoffs, Lien Waivers, Draw Schedules, AIA Forms)

---

## PHASE 5: TEST STARTER TIER FEATURES (carry-forward)

### 5.1 Dashboard
- [ ] Dashboard loads with widgets (Total Contacts, Active Projects, Jobs Today, Pending Quotes, Open Invoices, Outstanding Receivables)
- [ ] Recent Jobs list shows (even if empty)
- [ ] Recent Quotes list shows
- [ ] Recent Invoices list shows
- [ ] Screenshot the dashboard

### 5.2 Contacts
- [ ] Navigate to Contacts page (`/crm/contacts`)
- [ ] Create a new contact:
  - Name: `John Smith`
  - Type: Client
  - Company: `Smith Homes LLC`
  - Email: `john@smithhomes.com`
  - Phone: `715-555-1001`
  - Address: `200 Oak Ave, Eau Claire, WI 54701`
- [ ] Verify the contact appears in the list
- [ ] Click into the contact detail page -- does it load?
- [ ] Edit the contact -- change phone to `715-555-1002`, save
- [ ] Search for "Smith" -- does the contact appear?
- [ ] Filter by type "Client" -- does it filter correctly?
- [ ] Create a second contact:
  - Name: `Jane Architect`
  - Type: Lead
  - Company: `Chippewa Valley Design`
  - Email: `jane@cvdesign.com`
  - Phone: `715-555-1003`
  - Address: `350 Water Street, Eau Claire, WI 54703`
- [ ] Create a third contact:
  - Name: `Bob Subcontractor`
  - Type: Vendor
  - Company: `EC Electrical Services`
  - Email: `bob@ecelectrical.com`
  - Phone: `715-555-1004`
- [ ] Verify all three contacts show in the list
- [ ] Verify contact count on dashboard updated

### 5.3 Projects
- [ ] Navigate to Projects page (`/crm/projects`)
- [ ] Create a new project:
  - Name: `Kitchen Renovation - Smith`
  - Type: Renovation
  - Status: Planning
  - Contact: John Smith
  - Address: `200 Oak Ave, Eau Claire, WI 54701`
  - Estimated Value: `$45,000`
  - Start Date: (next Monday)
  - End Date: (8 weeks from start)
- [ ] Verify the project appears in the list
- [ ] Open project detail -- does it show all fields?
- [ ] Update status to "Active"
- [ ] Update progress to 25%
- [ ] Create a second project:
  - Name: `New Build - Architect Spec Home`
  - Type: New Construction
  - Status: Bidding
  - Contact: Jane Architect
  - Address: `1200 Lakeview Dr, Eau Claire, WI 54701`
  - Estimated Value: `$385,000`
  - Start Date: (next month)
  - End Date: (6 months from start)
- [ ] Verify project count on dashboard updated

### 5.4 Jobs
- [ ] Navigate to Jobs page (`/crm/jobs`)
- [ ] Create a new job:
  - Title: `Demo and Prep Work`
  - Priority: High
  - Scheduled Date: (tomorrow)
  - Estimated Hours: `8`
  - Estimated Value: `$2,500`
  - Contact: John Smith
  - Project: Kitchen Renovation - Smith
  - Address: `200 Oak Ave, Eau Claire, WI 54701`
- [ ] Verify the job appears in the list with auto-generated job number
- [ ] Open job detail -- verify all fields
- [ ] Click "Start" -- status should change to In Progress
- [ ] Click "Complete" -- status should change to Completed
- [ ] Create a second job:
  - Title: `Electrical Rough-In`
  - Priority: Normal
  - Scheduled Date: (day after tomorrow)
  - Estimated Hours: `12`
  - Estimated Value: `$5,000`
  - Contact: John Smith
  - Project: Kitchen Renovation - Smith
- [ ] Create a third job:
  - Title: `Plumbing Rough-In`
  - Priority: Normal
  - Scheduled Date: (3 days from now)
  - Estimated Hours: `10`
  - Estimated Value: `$4,000`
  - Contact: John Smith
  - Project: Kitchen Renovation - Smith
- [ ] Verify Jobs Today count on dashboard updated

### 5.5 Quotes
- [ ] Navigate to Quotes page (`/crm/quotes`)
- [ ] Create a new quote:
  - Name: `Kitchen Renovation Quote - Smith`
  - Contact: John Smith
  - Project: Kitchen Renovation - Smith
  - Add line items:
    1. Description: `Demo & Prep`, Quantity: `1`, Unit Price: `$2,500.00`
    2. Description: `Electrical Rough-In`, Quantity: `1`, Unit Price: `$5,000.00`
    3. Description: `Plumbing Rough-In`, Quantity: `1`, Unit Price: `$4,000.00`
    4. Description: `Cabinets & Countertops (material + install)`, Quantity: `1`, Unit Price: `$18,000.00`
    5. Description: `Flooring (LVP, 350 sqft)`, Quantity: `1`, Unit Price: `$6,000.00`
    6. Description: `Painting & Finish Work`, Quantity: `1`, Unit Price: `$3,500.00`
    7. Description: `Permit & Inspection Fees`, Quantity: `1`, Unit Price: `$1,200.00`
  - Tax Rate: `5.5%`
  - Notes: `Price valid for 30 days. Includes materials and labor.`
  - Expiry Date: (30 days from now)
- [ ] **MATH CHECK -- Verify subtotal:** $2,500 + $5,000 + $4,000 + $18,000 + $6,000 + $3,500 + $1,200 = **$40,200.00**
- [ ] **MATH CHECK -- Verify tax:** $40,200.00 x 5.5% = **$2,211.00**
- [ ] **MATH CHECK -- Verify total:** $40,200.00 + $2,211.00 = **$42,411.00**
- [ ] Click "Send" -- status should change to Sent
- [ ] Click "Approve" -- status should change to Approved
- [ ] Download PDF -- does it generate with correct line items and totals?
- [ ] Convert to Invoice -- does it create an invoice with same line items?
- [ ] Verify Pending Quotes count on dashboard

### 5.6 Invoices
- [ ] Navigate to Invoices page (`/crm/invoices`)
- [ ] Verify the converted invoice from the quote is there
- [ ] Open the invoice -- verify line items match the quote ($42,411.00 total)
- [ ] Click "Send" -- status changes to Sent
- [ ] Record a partial payment:
  - Amount: `$20,000.00`
  - Method: Check
  - Reference: `Check #4501`
- [ ] Verify status changes to Partial
- [ ] **MATH CHECK -- Verify balance:** $42,411.00 - $20,000.00 = **$22,411.00**
- [ ] Record a second partial payment:
  - Amount: `$15,000.00`
  - Method: ACH Transfer
  - Reference: `ACH-2026-0415`
- [ ] **MATH CHECK -- Verify balance:** $22,411.00 - $15,000.00 = **$7,411.00**
- [ ] Record final payment for the remaining balance ($7,411.00)
- [ ] Verify status changes to Paid
- [ ] Download PDF -- does it generate with payment history?
- [ ] Create a standalone invoice (not from quote):
  - Contact: John Smith
  - Line item: `Change Order - Additional Outlets`, Qty: `4`, Price: `$250.00`
  - **MATH CHECK:** 4 x $250 = **$1,000.00** (before tax)
  - Tax Rate: `5.5%`
  - **MATH CHECK -- Total:** $1,000 + $55 = **$1,055.00**
  - Due Date: (2 weeks from now)
- [ ] Verify Open Invoices count on dashboard

### 5.7 Schedule / Calendar
- [ ] Navigate to Schedule page (`/crm/scheduling`)
- [ ] Verify the calendar loads (week view)
- [ ] Verify scheduled jobs (Demo and Prep, Electrical Rough-In, Plumbing Rough-In) appear on the correct days
- [ ] Navigate forward/backward through weeks
- [ ] Verify today's date is highlighted
- [ ] If drag-drop calendar is enabled, try dragging a job to a different day

### 5.8 Time Tracking
- [ ] Navigate to Time Tracking page (`/crm/time`)
- [ ] Create a manual time entry:
  - Date: today
  - Hours: `8`
  - Description: `Demo work at Smith kitchen - removed cabinets and flooring`
  - Billable: Yes
  - Project: Kitchen Renovation - Smith
  - Job: Demo and Prep Work
- [ ] Verify the entry appears
- [ ] Create a second entry:
  - Date: today
  - Hours: `2`
  - Description: `Drove to supply house for materials`
  - Billable: No
- [ ] Test clock in/out if available
- [ ] Verify billable hours (8) vs non-billable (2) display correctly

### 5.9 Documents
- [ ] Navigate to Documents page (`/crm/documents`)
- [ ] Upload a test document (any PDF or image)
- [ ] Tag it to Project: Kitchen Renovation - Smith
- [ ] Verify it appears in the list
- [ ] Verify you can download/view it

### 5.10 Expenses
- [ ] Navigate to Expenses page (`/crm/expenses`)
- [ ] Create an expense:
  - Date: today
  - Category: Materials
  - Vendor: `Menards`
  - Description: `Lumber and fasteners for Smith kitchen framing`
  - Amount: `$1,847.63`
  - Billable: Yes
  - Project: Kitchen Renovation - Smith
- [ ] Verify it appears in the list
- [ ] Create a second expense:
  - Date: today
  - Category: Permits
  - Vendor: `City of Eau Claire`
  - Description: `Building permit - 200 Oak Ave renovation`
  - Amount: `$450.00`
  - Billable: Yes
  - Project: Kitchen Renovation - Smith
- [ ] Filter by category "Materials" -- does it filter correctly?

---

## PHASE 6: TEST PRO TIER FEATURES (carry-forward)

### 6.1 Team Management
- [ ] Navigate to Team page (`/crm/team`)
- [ ] Create a new team member:
  - First Name: `Mike`
  - Last Name: `Foreman`
  - Email: `mike@andsonconstruction.com`
  - Phone: `715-555-2001`
  - Role: Foreman
  - Hourly Rate: `$38.00`
- [ ] Verify the team member appears in the list
- [ ] Edit the team member -- change hourly rate to `$40.00`
- [ ] Create a second team member:
  - First Name: `Sarah`
  - Last Name: `Office`
  - Email: `sarah@andsonconstruction.com`
  - Role: Office Manager
  - Hourly Rate: `$28.00`
- [ ] Create a third team member:
  - First Name: `Carlos`
  - Last Name: `Framer`
  - Email: `carlos@andsonconstruction.com`
  - Phone: `715-555-2003`
  - Role: Carpenter
  - Hourly Rate: `$35.00`
- [ ] Verify team count shows 3 (plus admin = 4 total, well within 20-user limit)

### 6.2 Two-Way SMS
- [ ] Navigate to Messages / SMS page (`/crm/sms`)
- [ ] Verify page loads
- [ ] Attempt to send a test message to John Smith (715-555-1002)
  - Message: `Hi John, confirming demo work starts tomorrow at 8am.`
- [ ] Note: may fail without Twilio configured -- note the error but do not block

### 6.3 Geofencing
- [ ] Navigate to Geofences page (`/crm/geofencing`)
- [ ] Create a geofence:
  - Name: `Smith Kitchen Jobsite`
  - Address: `200 Oak Ave, Eau Claire, WI 54701`
  - Radius: `150 feet`
  - Action: Auto clock-in/out
- [ ] Verify the geofence appears on the map
- [ ] Verify the geofence appears in the list
- [ ] Create a second geofence:
  - Name: `Andson Construction Office`
  - Address: `400 Galloway Street, Eau Claire, WI 54703`
  - Radius: `200 feet`

### 6.4 Route Optimization
- [ ] Navigate to Schedule page and look for route optimization feature
- [ ] Verify route optimization UI is accessible (may be in dispatch or scheduling view)
- [ ] If available, run optimization with the 3 scheduled jobs

### 6.5 Online Booking
- [ ] Navigate to Online Booking settings (`/crm/booking`)
- [ ] Verify the booking widget/page is configurable
- [ ] Check the public booking URL loads

### 6.6 Reviews
- [ ] Navigate to Reviews page (`/crm/reviews`)
- [ ] Verify page loads
- [ ] Create a review request for John Smith
- [ ] Verify the request appears in the list

### 6.7 Service Agreements
- [ ] Navigate to Agreements page (`/crm/agreements`)
- [ ] Create a service agreement:
  - Contact: John Smith
  - Title: `Annual Maintenance Agreement - Smith`
  - Start Date: today
  - End Date: (1 year from now)
  - Value: `$2,400.00` ($200/mo)
  - Terms: `Quarterly inspections of all completed renovation work`
- [ ] Verify it appears in the list

### 6.8 Pricebook
- [ ] Navigate to Pricebook page (`/crm/pricebook`)
- [ ] Create a category: `Kitchen Services`
- [ ] Create items in that category:
  1. Name: `Cabinet Installation`, Price: `$150.00/linear foot`
  2. Name: `Countertop Installation (Granite)`, Price: `$85.00/sqft`
  3. Name: `Countertop Installation (Quartz)`, Price: `$75.00/sqft`
  4. Name: `Tile Backsplash`, Price: `$25.00/sqft`
- [ ] Verify all items appear under the category
- [ ] Create a second category: `General Labor`
- [ ] Create an item: `General Carpentry`, Price: `$65.00/hour`
- [ ] Edit `Cabinet Installation` -- change price to `$160.00/linear foot`
- [ ] Search for "Granite" -- does the item appear?

### 6.9 QuickBooks Integration
- [ ] Navigate to Integrations page (`/crm/integrations` or Settings > Integrations)
- [ ] Verify QuickBooks sync option is listed
- [ ] Note: actual sync requires QB credentials -- just verify the option exists

### 6.10 Recurring Jobs
- [ ] Navigate to Recurring Jobs (`/crm/recurring`)
- [ ] Create a recurring job:
  - Title: `Monthly Site Inspection - Smith`
  - Frequency: Monthly
  - Contact: John Smith
  - Project: Kitchen Renovation - Smith
  - Estimated Hours: `2`
- [ ] Verify the recurring job appears in the list

---

## PHASE 7: TEST BUSINESS TIER FEATURES (carry-forward)

### 7.1 Inventory
- [ ] Navigate to Inventory page (`/crm/inventory`)
- [ ] Add an item:
  - Name: `2x4 Lumber 8ft`
  - SKU: `LBR-2x4-8`
  - Category: Materials
  - Quantity on Hand: `200`
  - Unit Cost: `$4.29`
  - Reorder Point: `50`
- [ ] Verify it appears in the list
- [ ] Add a second item:
  - Name: `3/4" Plywood Sheet 4x8`
  - SKU: `PLY-34-4x8`
  - Category: Materials
  - Quantity on Hand: `40`
  - Unit Cost: `$52.00`
  - Reorder Point: `10`
- [ ] Add a third item:
  - Name: `Box of 3" Deck Screws (1lb)`
  - SKU: `HW-SCRW-3`
  - Category: Hardware
  - Quantity on Hand: `25`
  - Unit Cost: `$8.99`
  - Reorder Point: `10`
- [ ] Adjust quantity of `2x4 Lumber 8ft` -- reduce by 24 (used on Smith job)
- [ ] **MATH CHECK:** 200 - 24 = **176** remaining
- [ ] Verify updated quantity shows 176
- [ ] Filter by category "Materials" -- should show 2 items

### 7.2 Equipment Tracking
- [ ] Navigate to Equipment page (`/crm/equipment`)
- [ ] Add equipment:
  - Name: `DeWalt Table Saw`
  - Model: `DWE7491RS`
  - Serial: `DW-12345`
  - Purchase Date: `2025-01-15`
  - Purchase Price: `$649.00`
  - Status: Active
  - Assigned To: Mike Foreman
- [ ] Verify it appears in the list
- [ ] Add a second item:
  - Name: `Hilti Rotary Hammer`
  - Model: `TE 30-A36`
  - Serial: `HI-67890`
  - Purchase Date: `2025-06-01`
  - Purchase Price: `$1,299.00`
  - Status: Active
- [ ] Edit `DeWalt Table Saw` -- change status to "In Repair"
- [ ] Verify status update saved

### 7.3 Fleet Management
- [ ] Navigate to Fleet page (`/crm/fleet`)
- [ ] Add a vehicle:
  - Name: `Work Truck #1`
  - Make: `Ford`
  - Model: `F-250 Super Duty`
  - Year: `2024`
  - VIN: `1FTBF2B64REA00001`
  - License Plate: `WI-ABC-1234`
  - Mileage: `12,450`
  - Assigned To: Mike Foreman
- [ ] Verify it appears in the list
- [ ] Add a second vehicle:
  - Name: `Dump Trailer`
  - Make: `Big Tex`
  - Model: `14LX`
  - Year: `2023`
- [ ] Edit `Work Truck #1` -- update mileage to `12,580`

### 7.4 Warranties
- [ ] Navigate to Warranties page (`/crm/warranties`)
- [ ] Create a warranty:
  - Title: `Kitchen Renovation Workmanship Warranty`
  - Contact: John Smith
  - Project: Kitchen Renovation - Smith
  - Start Date: (today)
  - End Date: (2 years from now)
  - Coverage: `All labor and workmanship for kitchen renovation project`
- [ ] Verify it appears in the list

### 7.5 Marketing / Email Campaigns
- [ ] Navigate to Marketing page (`/crm/marketing`)
- [ ] Verify page loads
- [ ] Create a campaign:
  - Name: `Spring Renovation Special`
  - Type: Email
  - Subject: `Spring Kitchen & Bath Specials from Andson Construction`
- [ ] Verify it appears in the list

### 7.6 Call Tracking
- [ ] Navigate to Call Tracking page (`/crm/calltracking`)
- [ ] Verify page loads
- [ ] Note: actual call tracking requires phone integration -- verify the UI exists

### 7.7 Consumer Financing (Wisetack)
- [ ] Navigate to Financing options (in Quotes page or `/crm/financing`)
- [ ] Verify Wisetack / financing option is available
- [ ] Note: actual financing requires Wisetack API credentials -- verify the option exists

### 7.8 Advanced Reporting
- [ ] Navigate to Reports page (`/crm/reporting`)
- [ ] Verify report dashboard loads
- [ ] Run a revenue report if available
- [ ] Run a job costing report if available
- [ ] Check for project profitability report
- [ ] Screenshot the reports page

### 7.9 Change Orders
- [ ] Navigate to Change Orders page (`/crm/change-orders`)
- [ ] Create a change order:
  - Project: Kitchen Renovation - Smith
  - Title: `Add under-cabinet lighting`
  - Description: `Customer requested LED under-cabinet lighting in all kitchen base cabinets (12 linear feet)`
  - Add line items:
    1. `LED Strip Lighting (12ft)`, Qty: `1`, Price: `$180.00`
    2. `Electrical Labor - Wiring`, Qty: `3` hrs, Price: `$85.00/hr`
    3. `Dimmer Switch + Install`, Qty: `1`, Price: `$120.00`
  - **MATH CHECK:** $180 + (3 x $85) + $120 = $180 + $255 + $120 = **$555.00**
- [ ] Verify total is $555.00
- [ ] Submit the change order
- [ ] Approve the change order
- [ ] Verify status changes to Approved

---

## PHASE 8: TEST CONSTRUCTION TIER FEATURES

These are the features unique to the Construction tier ($599/mo). Test each thoroughly with exact data and full workflows.

### 8.1 RFIs (Requests for Information)
- [ ] Navigate to RFIs page (`/crm/rfis`)
- [ ] Create an RFI:
  - Project: Kitchen Renovation - Smith
  - Subject: `Existing load-bearing wall clarification`
  - Description: `Plans show removal of wall between kitchen and dining room. Need structural engineer confirmation on whether existing wall at grid line B-3 is load-bearing. If yes, need beam sizing for header.`
  - Priority: High
  - Assigned To: Jane Architect
  - Response Needed By: (5 business days from now)
- [ ] Verify the RFI appears in the list with auto-generated RFI number
- [ ] Open the RFI detail page -- verify all fields
- [ ] Add a response:
  - Response: `Wall is load-bearing. Recommend LVL beam 3.5x11.875 spanning 12ft. See attached calc sheet.`
  - Responded By: Jane Architect
- [ ] Change status to Closed
- [ ] Create a second RFI:
  - Project: Kitchen Renovation - Smith
  - Subject: `Countertop material lead time`
  - Description: `Customer selected Calacatta Gold quartz. What is current lead time from supplier?`
  - Priority: Normal
  - Response Needed By: (3 business days from now)
- [ ] Verify both RFIs appear in the list
- [ ] Filter by project -- should show 2 RFIs for Kitchen Renovation
- [ ] Filter by status -- Open should show 1, Closed should show 1

### 8.2 Submittals
- [ ] Navigate to Submittals page (`/crm/submittals`)
- [ ] Create a submittal:
  - Project: Kitchen Renovation - Smith
  - Title: `Kitchen Cabinet Shop Drawings`
  - Type: Product Data
  - Spec Section: `06 4100 - Architectural Wood Casework`
  - Description: `Shop drawings for custom maple shaker cabinets. 12 base, 14 wall, 2 tall pantry units.`
  - Submitted By: Bob Subcontractor
  - Due Date: (10 business days from now)
- [ ] Verify the submittal appears in the list with auto-generated number
- [ ] **RUN FULL WORKFLOW:**
  - [ ] Status should start as Draft
  - [ ] Click "Submit" -- status changes to **Submitted**
  - [ ] Click "Approve" -- status changes to **Approved**
  - [ ] Screenshot the approved submittal
- [ ] Create a second submittal to test rejection flow:
  - Project: Kitchen Renovation - Smith
  - Title: `Plumbing Fixture Cut Sheets`
  - Type: Product Data
  - Spec Section: `22 4000 - Plumbing Fixtures`
  - Description: `Cut sheets for kitchen sink (Kohler Whitehaven K-6489) and faucet (Delta Trinsic 9159T).`
- [ ] **RUN REJECTION WORKFLOW:**
  - [ ] Submit the submittal -- status: **Submitted**
  - [ ] Click "Revise" -- status changes to **Revise & Resubmit**
  - [ ] Add revision note: `Faucet model discontinued. Resubmit with Delta Essa 9113T.`
  - [ ] Resubmit -- status changes back to **Submitted**
  - [ ] Approve -- status: **Approved**
- [ ] Create a third submittal to test outright rejection:
  - Title: `Flooring Sample`
  - Type: Sample
  - Description: `LVP sample - Shaw Floorte Pro Paragon 7" Plus`
  - [ ] Submit, then click "Reject" -- status: **Rejected**
  - [ ] Add rejection note: `Color does not match design spec. Reselect.`
- [ ] Verify all 3 submittals show with correct statuses (Approved, Approved, Rejected)

### 8.3 Daily Logs
- [ ] Navigate to Daily Logs page (`/crm/daily-logs`)
- [ ] Create a daily log:
  - Project: Kitchen Renovation - Smith
  - Date: today
  - Weather: `Partly Cloudy, 62F, Wind SW 8mph`
  - Crew Count: `4`
  - Work Performed:
    ```
    - Completed demo of existing cabinets, countertops, and backsplash
    - Removed flooring in kitchen area (350 sqft)
    - Disconnected and capped plumbing at sink location
    - Framed new header opening per structural engineer specs (LVL 3.5x11.875)
    - Hauled 2 loads of debris to dumpster
    ```
  - Materials Received: `LVL beam delivered from Menards, 24 sheets drywall`
  - Visitors: `City building inspector - passed framing rough-in`
  - Safety Incidents: `None`
  - Hours Worked: `8`
  - Notes: `Ahead of schedule. Electrical rough-in can start tomorrow.`
- [ ] Verify the log appears in the list
- [ ] Open the log detail -- verify all fields saved correctly
- [ ] Create a second log for the next day:
  - Date: tomorrow
  - Weather: `Rain, 55F`
  - Crew Count: `3`
  - Work Performed: `Electrical rough-in started. Ran circuits for under-cabinet lighting, dishwasher, microwave, and disposal.`
  - Notes: `Rain delayed exterior work. Focused on interior.`
- [ ] Verify both logs appear chronologically

### 8.4 Punch Lists
- [ ] Navigate to Punch Lists page (`/crm/punch-lists`)
- [ ] Create a punch list:
  - Project: Kitchen Renovation - Smith
  - Title: `Final Walkthrough Punch List`
- [ ] Add punch list items:
  1. Description: `Touch up paint on north wall near window`, Priority: Low, Assigned To: Carlos Framer
  2. Description: `Cabinet door alignment - upper right of sink`, Priority: Medium, Assigned To: Bob Subcontractor
  3. Description: `Grout gap at backsplash corner behind stove`, Priority: Medium, Assigned To: Carlos Framer
  4. Description: `Caulk gap between countertop and wall (east side)`, Priority: Low, Assigned To: Carlos Framer
  5. Description: `Outlet cover plate missing at island`, Priority: High, Assigned To: Bob Subcontractor
- [ ] Verify all 5 items appear in the punch list
- [ ] Mark item 5 (`Outlet cover plate missing`) as **Complete**
- [ ] Mark item 1 (`Touch up paint`) as **Complete**
- [ ] **MATH CHECK:** 2 of 5 completed = **40% complete**
- [ ] Verify the punch list shows 2/5 completed or 40% progress
- [ ] Mark remaining items complete one by one
- [ ] Verify punch list shows **100% complete** / all items closed

### 8.5 Inspections
- [ ] Navigate to Inspections page (`/crm/inspections`)
- [ ] Schedule an inspection:
  - Project: Kitchen Renovation - Smith
  - Type: `Framing Rough-In`
  - Inspector: `City of Eau Claire Building Dept`
  - Date: (2 days from now)
  - Time: `9:00 AM`
  - Notes: `Inspector needs access through garage. Homeowner notified.`
- [ ] Verify the inspection appears in the list
- [ ] Update status to **Passed**
- [ ] Schedule a second inspection:
  - Type: `Electrical Rough-In`
  - Inspector: `City of Eau Claire Building Dept`
  - Date: (4 days from now)
  - Time: `10:00 AM`
- [ ] Schedule a third inspection:
  - Type: `Plumbing Rough-In`
  - Inspector: `City of Eau Claire Building Dept`
  - Date: (4 days from now)
  - Time: `1:00 PM`
- [ ] Verify all inspections appear, with Framing showing Passed status

### 8.6 Bids
- [ ] Navigate to Bids page (`/crm/bids`)
- [ ] Create a bid:
  - Project: New Build - Architect Spec Home
  - Contact: Jane Architect
  - Title: `Spec Home Construction Bid`
  - Due Date: (2 weeks from now)
  - Add line items:
    1. `Site Work & Excavation`, Qty: `1`, Price: `$28,000.00`
    2. `Foundation (poured concrete, 1,800 sqft)`, Qty: `1`, Price: `$42,000.00`
    3. `Framing (2-story, 3,200 sqft)`, Qty: `1`, Price: `$68,000.00`
    4. `Roofing (architectural shingle, 40 sq)`, Qty: `1`, Price: `$18,500.00`
    5. `Windows & Doors (22 windows, 3 ext doors)`, Qty: `1`, Price: `$31,000.00`
    6. `Electrical (200A service, 42 circuits)`, Qty: `1`, Price: `$24,000.00`
    7. `Plumbing (3 full bath, 1 half, kitchen, laundry)`, Qty: `1`, Price: `$22,000.00`
    8. `HVAC (2-zone forced air + ERV)`, Qty: `1`, Price: `$19,500.00`
    9. `Insulation & Drywall`, Qty: `1`, Price: `$26,000.00`
    10. `Finish Carpentry & Trim`, Qty: `1`, Price: `$18,000.00`
    11. `Painting (interior + exterior)`, Qty: `1`, Price: `$14,000.00`
    12. `Flooring (hardwood + tile + LVP)`, Qty: `1`, Price: `$21,000.00`
    13. `Cabinets & Countertops`, Qty: `1`, Price: `$35,000.00`
    14. `Landscaping & Final Grade`, Qty: `1`, Price: `$12,000.00`
    15. `General Conditions & Overhead (8%)`, Qty: `1`, Price: `$27,120.00`
  - **MATH CHECK -- Subtotal (items 1-14):** $28,000 + $42,000 + $68,000 + $18,500 + $31,000 + $24,000 + $22,000 + $19,500 + $26,000 + $18,000 + $14,000 + $21,000 + $35,000 + $12,000 = **$379,000.00**
  - **MATH CHECK -- GC Overhead (item 15):** should be close to $379,000 x 8% = $30,320 (bid shows $27,120 -- acceptable, this is the contractor's discretionary markup)
  - **MATH CHECK -- Grand Total:** $379,000 + $27,120 = **$406,120.00**
- [ ] Verify total matches $406,120.00
- [ ] Submit the bid
- [ ] Screenshot the bid detail

### 8.7 Gantt Charts
- [ ] Navigate to Gantt Charts page (`/crm/gantt`)
- [ ] Verify both projects render on the timeline:
  - `Kitchen Renovation - Smith` -- should show start/end dates, status color for "Active", progress bar at 25%
  - `New Build - Architect Spec Home` -- should show start/end dates, status color for "Bidding"
- [ ] **VERIFY VISUAL ELEMENTS:**
  - [ ] Date ranges display correctly on the horizontal axis
  - [ ] Status colors differentiate Active vs Bidding projects
  - [ ] Percent-complete bars show correctly (25% filled for Kitchen Renovation)
  - [ ] Projects are clickable (navigate to detail)
- [ ] If the Gantt supports task-level breakdown, verify jobs appear as sub-bars under their project
- [ ] Try zooming in/out on the timeline (week vs month view)
- [ ] Screenshot the Gantt chart

### 8.8 Selections
- [ ] Navigate to Selections page (`/crm/selections`)
- [ ] Create a selection:
  - Project: Kitchen Renovation - Smith
  - Category: `Countertops`
  - Title: `Kitchen Countertop Material`
  - Options:
    1. **Option A:** `Calacatta Gold Quartz` -- Price: `$4,250.00` -- Description: `Engineered quartz, 45 sqft at $75/sqft installed. Low maintenance, non-porous.`
    2. **Option B:** `Absolute Black Granite` -- Price: `$5,100.00` -- Description: `Natural granite, 45 sqft at $85/sqft installed. Requires annual sealing.`
    3. **Option C:** `Butcher Block (Maple)` -- Price: `$2,700.00` -- Description: `Solid maple, 45 sqft at $60/sqft installed. Warm aesthetic, requires regular oiling.`
  - Deadline: (1 week from now)
  - Status: Pending Customer
- [ ] Verify the selection appears in the list
- [ ] Create a second selection:
  - Category: `Flooring`
  - Title: `Kitchen Floor Material`
  - Options:
    1. `Shaw Floorte Pro LVP - Carbonado`, Price: `$5,250.00` (350 sqft x $15/sqft)
    2. `Daltile Porcelain Tile - Marble Falls`, Price: `$6,650.00` (350 sqft x $19/sqft)
  - Status: Pending Customer
- [ ] Verify both selections show in the list
- [ ] **TEST CUSTOMER-SIDE SELECTION** (see Phase 9 -- Customer Portal)

### 8.9 Takeoffs
- [ ] Navigate to Takeoffs page (`/crm/takeoffs`)
- [ ] Create a takeoff:
  - Project: Kitchen Renovation - Smith
  - Title: `Kitchen Drywall Takeoff`
  - Add measurements:
    1. Area: `North Wall`, Length: `14 ft`, Height: `9 ft`, Qty: `1`, **Sqft: 126**
    2. Area: `South Wall`, Length: `14 ft`, Height: `9 ft`, Qty: `1`, **Sqft: 126**
    3. Area: `East Wall`, Length: `12 ft`, Height: `9 ft`, Qty: `1`, **Sqft: 108**
    4. Area: `West Wall (partial - window)`, Length: `12 ft`, Height: `9 ft`, Minus openings: `15 sqft`, Qty: `1`, **Sqft: 93**
    5. Area: `Ceiling`, Length: `14 ft`, Width: `12 ft`, Qty: `1`, **Sqft: 168**
  - **MATH CHECK -- Total Sqft:** 126 + 126 + 108 + 93 + 168 = **621 sqft**
  - **MATH CHECK -- Sheets of 4x8 drywall needed:** 621 / 32 = 19.4 --> **20 sheets** (round up)
  - Notes: `Add 10% waste factor = 22 sheets total`
- [ ] Verify the takeoff appears in the list with correct total
- [ ] Open detail -- verify all measurements saved

### 8.10 Lien Waivers
- [ ] Navigate to Lien Waivers page (`/crm/lien-waivers`)
- [ ] Create a lien waiver:
  - Project: Kitchen Renovation - Smith
  - Type: **Conditional Progress**
  - Waiver For: Bob Subcontractor (EC Electrical Services)
  - Through Date: (end of current month)
  - Amount: `$5,000.00`
  - Description: `Electrical rough-in labor and materials`
- [ ] Verify the waiver appears in the list
- [ ] **RUN FULL WORKFLOW:**
  - [ ] Status should start as **Draft**
  - [ ] Click "Request" -- status changes to **Requested** (sent to subcontractor for signature)
  - [ ] Click "Receive" -- status changes to **Received** (subcontractor signed and returned)
  - [ ] Click "Approve" -- status changes to **Approved**
  - [ ] Screenshot the approved lien waiver
- [ ] Create a second lien waiver:
  - Type: **Unconditional Final**
  - Waiver For: Bob Subcontractor
  - Amount: `$5,000.00`
  - Description: `Final payment for electrical scope - all work complete`
- [ ] Run through Draft --> Request --> Receive --> Approve workflow
- [ ] Verify both waivers appear with correct statuses

### 8.11 Draw Schedules
- [ ] Navigate to Draw Schedules page (`/crm/draw-schedules`)
- [ ] Create a construction loan draw schedule:
  - Project: New Build - Architect Spec Home
  - Lender: `Peoples State Bank`
  - Total Loan Amount: `$385,000.00`
  - Add draw milestones:
    1. `Foundation Complete`, Amount: `$57,750.00` (15%)
    2. `Framing & Roof Dry-In`, Amount: `$96,250.00` (25%)
    3. `Mechanical Rough-In`, Amount: `$77,000.00` (20%)
    4. `Drywall & Interior Finishes`, Amount: `$77,000.00` (20%)
    5. `Final Completion & CO`, Amount: `$77,000.00` (20%)
  - **MATH CHECK -- Total draws:** $57,750 + $96,250 + $77,000 + $77,000 + $77,000 = **$385,000.00** (should equal loan amount)
- [ ] Verify the schedule appears in the list
- [ ] **CREATE A DRAW REQUEST on milestone 1 (Foundation Complete):**
  - Draw #: 1
  - Milestone: Foundation Complete
  - Amount Requested: `$57,750.00`
  - Supporting docs: (upload any test PDF)
  - Notes: `Foundation poured 4/10, 28-day cure in progress. Inspector passed footings.`
- [ ] **RUN DRAW REQUEST WORKFLOW:**
  - [ ] Status should start as **Pending**
  - [ ] Click "Submit" -- status changes to **Submitted** (to lender)
  - [ ] Click "Approve" -- status changes to **Approved** (lender approved)
  - [ ] Click "Mark Paid" -- status changes to **Paid** (funds received)
  - [ ] Screenshot the paid draw request
- [ ] **MATH CHECK:** After Draw 1 paid, remaining balance should be $385,000 - $57,750 = **$327,250.00**
- [ ] Verify the schedule shows $57,750 drawn and $327,250 remaining

### 8.12 AIA G702/G703 Forms
- [ ] Navigate to AIA Forms page (`/crm/aia-forms`)
- [ ] Create a G702 Application for Payment:
  - Project: New Build - Architect Spec Home
  - Application #: `1`
  - Period To: (end of current month)
  - Architect: Jane Architect
  - Owner: Jane Architect (owner-builder)
  - Contractor: Andson Construction QA
  - Contract Sum: `$406,120.00`
  - Retainage: `10%`
- [ ] **ADD G703 CONTINUATION SHEET LINE ITEMS:**

  | # | Description of Work | Scheduled Value | Previous | This Period | Materials Stored |
  |---|---|---|---|---|---|
  | 1 | Site Work & Excavation | $28,000.00 | $0.00 | $28,000.00 | $0.00 |
  | 2 | Foundation | $42,000.00 | $0.00 | $42,000.00 | $0.00 |
  | 3 | Framing | $68,000.00 | $0.00 | $34,000.00 | $0.00 |
  | 4 | Roofing | $18,500.00 | $0.00 | $0.00 | $0.00 |
  | 5 | Windows & Doors | $31,000.00 | $0.00 | $0.00 | $8,500.00 |
  | 6 | Electrical | $24,000.00 | $0.00 | $0.00 | $0.00 |
  | 7 | Plumbing | $22,000.00 | $0.00 | $0.00 | $0.00 |
  | 8 | HVAC | $19,500.00 | $0.00 | $0.00 | $0.00 |
  | 9 | Insulation & Drywall | $26,000.00 | $0.00 | $0.00 | $0.00 |
  | 10 | Finish Carpentry | $18,000.00 | $0.00 | $0.00 | $0.00 |
  | 11 | Painting | $14,000.00 | $0.00 | $0.00 | $0.00 |
  | 12 | Flooring | $21,000.00 | $0.00 | $0.00 | $0.00 |
  | 13 | Cabinets & Countertops | $35,000.00 | $0.00 | $0.00 | $0.00 |
  | 14 | Landscaping | $12,000.00 | $0.00 | $0.00 | $0.00 |
  | 15 | GC Overhead | $27,120.00 | $0.00 | $5,424.00 | $0.00 |

- [ ] **VERIFY AUTO-CALCULATED TOTALS (G702 Summary):**
  - **Total Scheduled Value:** $28,000 + $42,000 + $68,000 + $18,500 + $31,000 + $24,000 + $22,000 + $19,500 + $26,000 + $18,000 + $14,000 + $21,000 + $35,000 + $12,000 + $27,120 = **$406,120.00**
  - **Work Completed This Period:** $28,000 + $42,000 + $34,000 + $5,424 = **$109,424.00**
  - **Materials Presently Stored:** **$8,500.00**
  - **Total Completed & Stored (work + materials):** $109,424.00 + $8,500.00 = **$117,924.00**
  - **Retainage (10% of Completed & Stored):** $117,924.00 x 10% = **$11,792.40**
  - **Less Previous Certificates for Payment:** **$0.00** (first application)
  - **Current Payment Due:** $117,924.00 - $11,792.40 - $0.00 = **$106,131.60**
  - **Balance to Finish (including retainage):** $406,120.00 - $117,924.00 + $11,792.40 = **$299,988.40**
  - Alternatively: $406,120.00 - $106,131.60 = **$299,988.40**
- [ ] **VERIFY each calculated field matches the expected values above**
- [ ] Screenshot the G702 summary with all calculated fields visible
- [ ] Screenshot the G703 continuation sheet
- [ ] Download/generate PDF if available -- verify formatting matches AIA standard layout
- [ ] Verify % Complete column auto-calculates per line item:
  - Site Work: ($28,000 + $0) / $28,000 = **100%**
  - Foundation: ($42,000 + $0) / $42,000 = **100%**
  - Framing: ($34,000 + $0) / $68,000 = **50%**
  - Windows & Doors: ($0 + $8,500) / $31,000 = **27.4%**
  - GC Overhead: ($5,424 + $0) / $27,120 = **20%**
  - All others: **0%**

---

## PHASE 9: CUSTOMER PORTAL

### 9.1 Enable Portal Access
- [ ] Navigate to Contacts, open John Smith
- [ ] Enable portal access (toggle on)
- [ ] Copy the portal link/token
- [ ] Note the portal URL (e.g., `https://andson-construction-qa.onrender.com/portal/...`)

### 9.2 Test Portal as Customer
- [ ] Open the portal URL in a new tab (or incognito)
- [ ] Verify the portal dashboard loads
- [ ] **Project View:**
  - [ ] Can the customer see "Kitchen Renovation - Smith"?
  - [ ] Does it show project status (Active) and progress (25%)?
- [ ] **Quotes:**
  - [ ] Can they see the Kitchen Renovation Quote?
  - [ ] Can they approve a quote from the portal?
- [ ] **Invoices:**
  - [ ] Can they see their invoices?
  - [ ] Can they see payment history?
  - [ ] Can they make a payment? (may need Stripe configured)
- [ ] **Selections (Construction Tier Feature):**
  - [ ] Navigate to `/portal/selections`
  - [ ] Can the customer see the "Kitchen Countertop Material" selection?
  - [ ] Can the customer see all 3 options (Quartz $4,250, Granite $5,100, Butcher Block $2,700)?
  - [ ] Select **Option A: Calacatta Gold Quartz ($4,250.00)**
  - [ ] Verify the selection is saved
  - [ ] Go back to the CRM Selections page -- verify the customer's choice shows as selected
  - [ ] Can the customer see the "Kitchen Floor Material" selection?
- [ ] **Messages:**
  - [ ] Can the customer send a message?
- [ ] **Documents:**
  - [ ] Can the customer see shared documents?

---

## PHASE 10: TEST THE DEPLOYED WEBSITE

### 10.1 Public Pages
- [ ] Visit **https://andson-construction-qa-site.onrender.com**
- [ ] Homepage loads with company name "Andson Construction QA"
- [ ] Branding color is navy (#1E3A5F)
- [ ] **Portfolio/Gallery page** loads (Construction tier includes portfolio website)
  - [ ] Verify gallery grid or carousel renders
  - [ ] Verify images can be viewed/enlarged
- [ ] Services page loads and shows contractor services
- [ ] Blog page loads
- [ ] About page loads
- [ ] Contact page loads with form
- [ ] Submit a test contact form:
  - Name: `Potential Lead`
  - Email: `lead-test@example.com`
  - Phone: `715-555-9999`
  - Message: `We're planning a home addition (approx 800 sqft) and would like to discuss pricing and timeline.`
  - Service: (select any)
- [ ] Verify submission succeeds (success message or redirect)
- [ ] Navigation works between all pages
- [ ] Footer shows correct company info
- [ ] Mobile responsive -- resize browser to mobile width, verify layout adapts

### 10.2 CMS Admin Dashboard
- [ ] Navigate to `/admin` on the website
- [ ] Login with admin credentials (`test-build-construction@twomiah.com` / `TestBuildConst2026!`)
- [ ] **Dashboard:** Loads with overview stats
- [ ] **Pages:** List pages, create a test page titled "Test Construction Page"
- [ ] **Services:** View and edit a service description
- [ ] **Blog:** Create a test blog post:
  - Title: `QA Test Post - Construction Tier`
  - Content: `This is a test blog post for the Construction tier QA test.`
  - Publish it
- [ ] Verify the blog post appears on the public blog page
- [ ] **Gallery:** Upload a test image to the gallery
  - [ ] Verify it appears on the public gallery/portfolio page
- [ ] **Testimonials:** Add a testimonial:
  - Name: `John Smith`
  - Text: `Andson Construction did an amazing job on our kitchen renovation. Professional, on time, and on budget.`
  - Rating: `5`
- [ ] Verify the testimonial appears on the homepage
- [ ] **Leads:** Check if the contact form submission from 10.1 appears
- [ ] **Site Settings:** Verify company info is correct
- [ ] **Menus:** Verify navigation items match the public site
- [ ] **Analytics:** Check if page view tracking is working
- [ ] **Media:** Upload a test image, verify it appears

### 10.3 Contact Form to CRM Flow
- [ ] Go back to the CRM
- [ ] Navigate to Contacts or Lead Inbox
- [ ] Check if the website contact form submission ("Potential Lead") created a lead/contact in the CRM
- [ ] Verify the message content matches what was submitted
- [ ] This confirms the website-to-CRM data flow works

---

## PHASE 11: SETTINGS & ADMIN

### 11.1 Settings
- [ ] Navigate to Settings
- [ ] **Company tab:** Verify company name "Andson Construction QA", email, address are correct
- [ ] **Profile tab:** Verify admin user details (Test BuildConst)
- [ ] **Security tab:** Test change password (change and change back)
- [ ] **Users tab:** Verify team members are listed (Mike Foreman, Sarah Office, Carlos Framer + admin)
- [ ] **Billing tab:** Check subscription status shows Construction tier ($599/mo)
- [ ] **Integrations tab:** Verify integration options are listed (QuickBooks, Stripe, Twilio, Wisetack)
- [ ] **Feature Flags / Plan:** Verify all Construction-tier features are enabled:
  - [ ] Projects, RFIs, Submittals, Daily Logs, Punch Lists, Inspections, Bids
  - [ ] Gantt Charts, Selections, Takeoffs, Lien Waivers, Draw Schedules, AIA Forms
  - [ ] Plus all Starter/Pro/Business features

---

## PHASE 12: FINAL SUMMARY

Report a summary table. **Bold** items are Construction-tier-specific features.

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | Signup Flow (Construction $599) | Pass/Fail | |
| 2 | GitHub Repo Verification | Pass/Fail | |
| 3 | Deployment (CRM) | Pass/Fail | |
| 4 | Deployment (Portfolio Website) | Pass/Fail | |
| 5 | CRM Login | Pass/Fail | |
| 6 | Dashboard | Pass/Fail | |
| 7 | Contacts CRUD | Pass/Fail | |
| 8 | Projects CRUD | Pass/Fail | |
| 9 | Jobs CRUD + Status Workflow | Pass/Fail | |
| 10 | Quotes + 7 Line Items + Math + PDF | Pass/Fail | |
| 11 | Invoices + Partial Payments + Balance + PDF | Pass/Fail | |
| 12 | Schedule / Calendar | Pass/Fail | |
| 13 | Time Tracking | Pass/Fail | |
| 14 | Documents | Pass/Fail | |
| 15 | Expenses | Pass/Fail | |
| 16 | Team Management (3 members) | Pass/Fail | |
| 17 | Two-Way SMS | Pass/Fail | |
| 18 | Geofencing (2 fences) | Pass/Fail | |
| 19 | Route Optimization | Pass/Fail | |
| 20 | Online Booking | Pass/Fail | |
| 21 | Reviews | Pass/Fail | |
| 22 | Service Agreements | Pass/Fail | |
| 23 | Pricebook (2 categories, 5 items) | Pass/Fail | |
| 24 | QuickBooks Integration | Pass/Fail | |
| 25 | Recurring Jobs | Pass/Fail | |
| 26 | Inventory (3 items + adjustment) | Pass/Fail | |
| 27 | Equipment Tracking (2 items) | Pass/Fail | |
| 28 | Fleet Management (2 vehicles) | Pass/Fail | |
| 29 | Warranties | Pass/Fail | |
| 30 | Marketing / Email Campaigns | Pass/Fail | |
| 31 | Call Tracking | Pass/Fail | |
| 32 | Consumer Financing (Wisetack) | Pass/Fail | |
| 33 | Advanced Reporting | Pass/Fail | |
| 34 | Change Orders + Line Items + Math | Pass/Fail | |
| 35 | **RFIs (2 created, response workflow)** | Pass/Fail | |
| 36 | **Submittals (3 created, full approve/revise/reject workflow)** | Pass/Fail | |
| 37 | **Daily Logs (2 days, weather/crew/work)** | Pass/Fail | |
| 38 | **Punch Lists (5 items, close workflow, % tracking)** | Pass/Fail | |
| 39 | **Inspections (3 scheduled, pass workflow)** | Pass/Fail | |
| 40 | **Bids (15 line items, $406,120 math check)** | Pass/Fail | |
| 41 | **Gantt Charts (2 projects, status colors, % bars)** | Pass/Fail | |
| 42 | **Selections (2 created, 3+ options each)** | Pass/Fail | |
| 43 | **Takeoffs (5 measurements, 621 sqft math check)** | Pass/Fail | |
| 44 | **Lien Waivers (2 created, full draft-to-approve workflow)** | Pass/Fail | |
| 45 | **Draw Schedules (5 milestones, draw request workflow)** | Pass/Fail | |
| 46 | **AIA G702/G703 (15 line items, ALL auto-calc fields verified)** | Pass/Fail | |
| 47 | **Portal: Selections (customer selects option)** | Pass/Fail | |
| 48 | Customer Portal (dashboard, projects, invoices, messages) | Pass/Fail | |
| 49 | Website: Homepage | Pass/Fail | |
| 50 | Website: Portfolio / Gallery | Pass/Fail | |
| 51 | Website: Services | Pass/Fail | |
| 52 | Website: Blog | Pass/Fail | |
| 53 | Website: Contact Form | Pass/Fail | |
| 54 | Website: Mobile Responsive | Pass/Fail | |
| 55 | CMS Admin Dashboard | Pass/Fail | |
| 56 | CMS Content Editing (blog, gallery, testimonials) | Pass/Fail | |
| 57 | Website-to-CRM Lead Flow | Pass/Fail | |
| 58 | Settings & Billing (Construction tier confirmed) | Pass/Fail | |

**Total: 58 test areas**

For each failure, describe: what broke, the error message, and include a screenshot.

---

## TEST DATA SUMMARY

| Data Point | Value |
|---|---|
| Company | Andson Construction QA |
| Tier | Construction ($599/mo, 20 users) |
| Admin Email | test-build-construction@twomiah.com |
| Admin Password | TestBuildConst2026! |
| Test Card | 4242 4242 4242 4242, Exp 12/28, CVC 123 |
| Tenant Slug | andson-construction-qa |
| CRM URL | https://andson-construction-qa.onrender.com |
| Website URL | https://andson-construction-qa-site.onrender.com |
| Primary Color | #1E3A5F (dark navy) |
| Contact 1 | John Smith, Smith Homes LLC, 715-555-1002 |
| Contact 2 | Jane Architect, Chippewa Valley Design, 715-555-1003 |
| Contact 3 | Bob Subcontractor, EC Electrical Services, 715-555-1004 |
| Project 1 | Kitchen Renovation - Smith, $45,000 |
| Project 2 | New Build - Architect Spec Home, $385,000 |
| Quote Total | $42,411.00 (7 items + 5.5% tax) |
| Bid Total | $406,120.00 (15 items) |
| AIA G702 Payment Due | $106,131.60 |
| Draw Schedule Loan | $385,000.00 (5 milestones) |
| Team Members | Mike Foreman, Sarah Office, Carlos Framer |
