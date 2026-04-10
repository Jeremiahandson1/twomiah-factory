# Twomiah Factory Live Test — Field Service / HVAC (Twomiah Wrench)

You are QA testing Twomiah Factory, a SaaS platform that generates and deploys CRM + Website software for service businesses. This is a LIVE production test. You will sign up as a real HVAC/field service company, wait for deployment, then systematically test every feature in the deployed CRM and website.

Take screenshots at every major step. Report pass/fail for each feature. If something fails, describe the error, screenshot it, and move on.

---

## PHASE 1: SIGNUP

1. Navigate to: **https://twomiah.com/signup/wrench/**
2. Complete the signup wizard:

**Step 0 — Company Info:**
- Company Name: "Valley HVAC QA"
- Industry: HVAC (or whichever field service option is available)
- Phone: 715-555-0202
- Address: 200 State Street
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
- Select the mid-tier plan (e.g., "Small Shop" $149/mo or equivalent)
- Hosting: SaaS
- Add-ons: Check ALL available (SMS, GPS, Inventory, Fleet, Equipment, Marketing, Payments, Client Portal)
- Migration Source: "No migration needed"

**Step 4 — Deploy Service:**
- Select "Basic" ($299)

**Step 5 — Admin Account:**
- First Name: Test
- Last Name: Wrench
- Email: test-wrench@twomiah.com
- Password: TestWrench2026!

**Step 6 — Review & Submit:**
- Verify all details, check terms, submit

3. **After submission:**
   - Screenshot the confirmation
   - Note the slug (probably "valley-hvac-qa")
   - If Stripe checkout appears, screenshot and report URL

---

## PHASE 2: VERIFY DEPLOYMENT

Wait 5-10 minutes, then:

1. Visit **https://valley-hvac-qa.onrender.com** — CRM login page loads?
2. Visit **https://valley-hvac-qa-site.onrender.com** — Website loads with red branding?

If URLs don't work, try: `valley-hvac-qa-api.onrender.com`, or check the Factory platform at https://twomiah-factory-platform.onrender.com

---

## PHASE 3: CRM LOGIN

1. Login with: test-wrench@twomiah.com / TestWrench2026!
2. Complete onboarding wizard if shown
3. Screenshot the dashboard

---

## PHASE 4: TEST CORE CRM FEATURES

### 4.1 Dashboard
- [ ] Dashboard loads with stats widgets
- [ ] Shows: Total Contacts, Active Projects, Jobs Today, Pending Quotes, Open Invoices

### 4.2 Contacts
- [ ] Create contact:
  - Name: "Bob Homeowner"
  - Type: Client
  - Email: bob@example.com
  - Phone: 715-555-3001
  - Address: 300 Elm St, Eau Claire, WI 54701
- [ ] Verify contact appears in list
- [ ] Open detail page
- [ ] Edit contact — add a note
- [ ] Search for "Bob" — found?
- [ ] Create second contact:
  - Name: "Lisa Commercial"
  - Type: Client
  - Company: "Downtown Office Building"
  - Email: lisa@downtown.com

### 4.3 Jobs / Service Calls
- [ ] Create a job:
  - Title: "AC Not Cooling - Homeowner"
  - Priority: High
  - Type: Service Call (or equivalent)
  - Scheduled Date: tomorrow
  - Scheduled Time: 9:00 AM
  - Estimated Hours: 2
  - Estimated Value: $350
  - Contact: Bob Homeowner
  - Address: 300 Elm St, Eau Claire, WI 54701
- [ ] Verify auto-generated job number
- [ ] Open job detail — all fields correct?
- [ ] Change status: Dispatch the job
- [ ] Change status: Start the job (In Progress)
- [ ] Change status: Complete the job
- [ ] Create second job:
  - Title: "Furnace Annual Maintenance"
  - Priority: Normal
  - Scheduled Date: day after tomorrow
  - Contact: Bob Homeowner
- [ ] Create third job:
  - Title: "Commercial HVAC Inspection"
  - Priority: Normal
  - Contact: Lisa Commercial

### 4.4 Quotes
- [ ] Create a quote:
  - Name: "AC Repair Quote - Homeowner"
  - Contact: Bob Homeowner
  - Line items:
    1. "Diagnostic Fee", Qty: 1, Price: $89
    2. "Capacitor Replacement", Qty: 1, Price: $185
    3. "Refrigerant Recharge (2 lbs)", Qty: 2, Price: $75
  - Tax Rate: 5.5%
- [ ] Verify totals calculate correctly
- [ ] Send the quote
- [ ] Approve the quote
- [ ] Download PDF
- [ ] Convert to invoice

### 4.5 Invoices
- [ ] Verify converted invoice exists with correct line items
- [ ] Send the invoice
- [ ] Record full payment ($465.85 or whatever the total is)
- [ ] Verify status = Paid
- [ ] Download PDF

### 4.6 Schedule / Calendar
- [ ] Calendar loads in week view
- [ ] Scheduled jobs appear on correct days
- [ ] Navigate forward/back through weeks
- [ ] Today highlighted

### 4.7 Team Management
- [ ] Create team member:
  - Name: "Tom Technician"
  - Email: tom@valleyhvac.com
  - Role: Technician
  - Hourly Rate: $28
- [ ] Create second member:
  - Name: "Dave Lead Tech"
  - Role: Lead Technician
  - Hourly Rate: $35

### 4.8 Time Tracking
- [ ] Create manual time entry:
  - 2 hours, today, billable, "AC repair at Homeowner"
- [ ] Test clock in/out if available
- [ ] Verify weekly summary

---

## PHASE 5: TEST FIELD SERVICE SPECIFIC FEATURES

These are the features that make crm-fieldservice different from the base CRM.

### 5.1 GPS Tracking & Geofencing
- [ ] Navigate to Settings > Geofences
- [ ] Create a geofence:
  - Name: "Bob Homeowner Job Site"
  - Address: 300 Elm St, Eau Claire, WI 54701
  - Radius: 100 meters
- [ ] Verify geofence appears in list
- [ ] Check location history page (may be empty)
- [ ] Edit the geofence — change radius to 150m
- [ ] Delete and recreate if needed

### 5.2 Route Optimization
- [ ] If a Route Optimizer page exists, navigate to it
- [ ] Try to optimize a route with the 2-3 jobs created
- [ ] Does it generate an optimized order?
- [ ] Does it provide a Google Maps navigation link?
- [ ] Check fuel cost calculation if available

### 5.3 Equipment Tracking
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
- [ ] Verify equipment appears in list
- [ ] Open detail — all fields correct?
- [ ] Add a service history entry:
  - Date: today
  - Type: Repair
  - Description: "Replaced capacitor, recharged refrigerant"
  - Cost: $349
- [ ] Create second equipment:
  - Customer: Bob Homeowner
  - Type: HVAC
  - Manufacturer: Trane
  - Model: XR15
  - Description: "Furnace"
  - Location: Basement
- [ ] Check warranty expiring alerts
- [ ] Check maintenance due alerts
- [ ] Mark equipment as needs repair

### 5.4 Service Agreements / Maintenance Contracts
- [ ] Navigate to Agreements page
- [ ] Create a service plan (if plan management exists):
  - Name: "Annual HVAC Maintenance"
  - Price: $199/year
  - Includes: 2 visits per year
- [ ] Create an agreement:
  - Customer: Bob Homeowner
  - Plan: Annual HVAC Maintenance
  - Start Date: today
  - Renewal: Annual
- [ ] Verify agreement appears in list
- [ ] Schedule a maintenance visit from the agreement
- [ ] Check upcoming visits
- [ ] Check billing due list
- [ ] Try generating an invoice from the agreement

### 5.5 Fleet Management
- [ ] Navigate to Fleet page
- [ ] Add a vehicle:
  - Name: "Service Van #1"
  - Make: Ford
  - Model: Transit 250
  - Year: 2024
  - VIN: (leave blank or enter test)
- [ ] Assign to Tom Technician
- [ ] Log a fuel purchase:
  - Gallons: 15
  - Cost: $52.50
  - Odometer: 12,500
- [ ] Check fuel stats
- [ ] Add maintenance record:
  - Type: Oil Change
  - Cost: $75
  - Mileage: 12,500
- [ ] Check maintenance due alerts

### 5.6 Inventory / Parts Management
- [ ] Navigate to Inventory page
- [ ] Create inventory location: "Warehouse"
- [ ] Create second location: "Van #1"
- [ ] Add a part:
  - Name: "Run Capacitor 35/5 MFD"
  - Category: HVAC Parts
  - Quantity: 25
  - Location: Warehouse
  - Reorder Point: 5
  - Cost: $12.50
- [ ] Add second part:
  - Name: "R-410A Refrigerant (25 lb)"
  - Quantity: 10
  - Location: Warehouse
  - Reorder Point: 3
  - Cost: $85
- [ ] Transfer 5 capacitors from Warehouse to Van #1
- [ ] Use 1 capacitor on a job (Bob Homeowner AC repair)
- [ ] Check low stock alerts
- [ ] Check inventory value report

### 5.7 Pricebook / Flat Rate Pricing
- [ ] Navigate to Pricebook page
- [ ] Create a category: "HVAC Repair"
- [ ] Create items with good/better/best pricing:
  - Name: "Capacitor Replacement"
  - Good: $149, Better: $189, Best: $229
- [ ] Create second item:
  - Name: "Refrigerant Recharge (per lb)"
  - Good: $65, Better: $75, Best: $85
- [ ] Search for items
- [ ] Export pricebook if available

### 5.8 Dispatch Board (if available)
- [ ] Navigate to Dispatch page
- [ ] View unassigned jobs
- [ ] Assign a technician to a job
- [ ] Check technician availability view
- [ ] Track job status changes (scheduled → en-route → on-site → completed)

### 5.9 Tech View / Mobile (if available)
- [ ] Navigate to Tech View page
- [ ] See assigned jobs for the day
- [ ] View job details (address, customer, equipment info)
- [ ] Check if checklist system works (e.g., HVAC checklist items)

### 5.10 Recurring Jobs
- [ ] Navigate to Recurring Jobs page (if available)
- [ ] Create a recurring job:
  - Title: "Quarterly Filter Change - Homeowner"
  - Frequency: Every 3 months
  - Contact: Bob Homeowner
- [ ] Verify it appears in list
- [ ] Generate next job from the recurring schedule

### 5.11 Expenses
- [ ] Create an expense:
  - Category: Materials
  - Vendor: "HVAC Supply Co"
  - Description: "Capacitors and refrigerant restock"
  - Amount: $450
  - Billable: No

### 5.12 Documents & Photos
- [ ] Upload a test document
- [ ] Attach it to a job or contact

### 5.13 Lead Inbox (if enabled)
- [ ] Navigate to Lead Inbox
- [ ] Check Lead Sources page
- [ ] Verify pages load

### 5.14 Messages / SMS (if enabled)
- [ ] Navigate to Messages
- [ ] Attempt to send a test message
- [ ] Note any Twilio configuration errors

### 5.15 Reports
- [ ] Navigate to Reports page
- [ ] Run available reports (revenue, job costing, technician productivity)

### 5.16 Customer Portal
- [ ] Enable portal access for Bob Homeowner
- [ ] Open portal URL
- [ ] Verify portal dashboard loads
- [ ] Check: customer sees their equipment
- [ ] Check: customer sees service agreements
- [ ] Check: customer sees invoices
- [ ] Check: customer can submit a service request
- [ ] Check: customer can make online payment (if Stripe configured)

### 5.17 Settings
- [ ] Company settings — verify info correct
- [ ] Check integrations page (QuickBooks, Twilio, Stripe options)
- [ ] Check geofence settings accessible from settings
- [ ] Verify feature flags show all enabled add-ons

---

## PHASE 6: TEST THE DEPLOYED WEBSITE

1. Visit the website URL

### 6.1 Public Pages
- [ ] Homepage loads — "Valley HVAC QA" with red branding
- [ ] Services page — shows HVAC/plumbing/electrical services
- [ ] Gallery page loads
- [ ] Blog page loads
- [ ] Contact page loads with form
- [ ] Submit a contact form:
  - Name: "Website Lead"
  - Email: web-lead@example.com
  - Phone: 715-555-8888
  - Message: "My AC stopped working"
  - Service: HVAC Repair (or similar)
- [ ] Verify submission succeeds
- [ ] Mobile responsive check

### 6.2 CMS Admin
- [ ] Navigate to /admin on the website
- [ ] Login
- [ ] Create a blog post about HVAC maintenance tips
- [ ] Add a testimonial
- [ ] Edit a service description
- [ ] Upload media
- [ ] Check leads — does the contact form submission appear?

### 6.3 Website-to-CRM Flow
- [ ] Back in CRM, check if website contact form created a lead

---

## PHASE 7: FINAL SUMMARY

| Feature | Status | Notes |
|---------|--------|-------|
| Signup Flow | Pass/Fail | |
| Deployment | Pass/Fail | |
| CRM Login | Pass/Fail | |
| Dashboard | Pass/Fail | |
| Contacts CRUD | Pass/Fail | |
| Jobs / Service Calls | Pass/Fail | |
| Quotes + PDF | Pass/Fail | |
| Invoices + Payments | Pass/Fail | |
| Schedule/Calendar | Pass/Fail | |
| Team Management | Pass/Fail | |
| Time Tracking | Pass/Fail | |
| **GPS & Geofencing** | Pass/Fail | |
| **Route Optimization** | Pass/Fail | |
| **Equipment Tracking** | Pass/Fail | |
| **Service Agreements** | Pass/Fail | |
| **Fleet Management** | Pass/Fail | |
| **Inventory / Parts** | Pass/Fail | |
| **Pricebook (Flat Rate)** | Pass/Fail | |
| **Dispatch Board** | Pass/Fail | |
| **Tech View** | Pass/Fail | |
| **Recurring Jobs** | Pass/Fail | |
| Expenses | Pass/Fail | |
| Documents | Pass/Fail | |
| Lead Inbox | Pass/Fail | |
| Messages/SMS | Pass/Fail | |
| Reports | Pass/Fail | |
| Customer Portal | Pass/Fail | |
| Settings & Integrations | Pass/Fail | |
| Website Homepage | Pass/Fail | |
| Website Services | Pass/Fail | |
| Website Contact Form | Pass/Fail | |
| CMS Admin | Pass/Fail | |
| Website-to-CRM Flow | Pass/Fail | |

For each failure: describe the error, screenshot it.
