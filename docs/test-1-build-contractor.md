# Twomiah Factory Live Test — General Contractor (Twomiah Build)

You are QA testing Twomiah Factory, a SaaS platform that generates and deploys CRM + Website software for service businesses. This is a LIVE production test. You will sign up as a real general contractor customer, wait for deployment, then systematically test every feature in the deployed CRM and website.

Take screenshots at every major step. Report pass/fail for each feature. If something fails, describe the error, screenshot it, and move on to the next test.

---

## PHASE 1: SIGNUP

1. Navigate to: **https://twomiah.com/signup/build/**
2. Complete the 7-step wizard:

**Step 0 — Company Info:**
- Company Name: "Andson Builders QA"
- Industry: General Contractor
- Phone: 715-555-0101
- Address: 100 Main Street
- City: Eau Claire
- State: Wisconsin
- ZIP: 54701
- Domain: (leave blank)
- Timezone: America/Chicago

**Step 1 — Branding:**
- Skip logo upload (use default)
- Primary Color: #2563EB (blue)

**Step 2 — Website Template:**
- Select the first "contractor" template shown

**Step 3 — Plan & Billing:**
- Select "Pro" plan ($149/mo)
- Hosting: SaaS (Hosted by Twomiah)
- Add-ons: Check ALL available add-ons (SMS, GPS, Inventory, Fleet, Equipment, Marketing, Payments, Client Portal)
- Migration Source: "No migration needed"

**Step 4 — Deploy Service:**
- Select "Basic" ($299)

**Step 5 — Admin Account:**
- First Name: Test
- Last Name: Build
- Email: test-build@twomiah.com
- Password: TestBuild2026!

**Step 6 — Review & Submit:**
- Verify all details look correct
- Check terms box if present
- Click submit

3. **After submission:**
   - Screenshot the response/confirmation page
   - If redirected to Stripe checkout, screenshot it and report the URL — do NOT enter payment info unless instructed
   - Note the tenant slug (probably "andson-builders-qa")
   - Note any tenant ID returned

---

## PHASE 2: VERIFY GITHUB REPO

Each tenant gets their own private GitHub repo. Verify the code was pushed correctly:

1. Visit **https://github.com/Jeremiahandson1/andson-builders-qa** (or whatever the slug is)
2. Verify the repo contains these directories and files — NOT just README.md and deploy.sh:
   - [ ] `crm/` directory exists (or `crm-fieldservice/`, `crm-homecare/`, `crm-roof/`, `crm-dispensary/` depending on vertical)
   - [ ] `crm/backend/` exists with `src/index.ts`, `db/`, `package.json`
   - [ ] `crm/frontend/` exists with `src/`, `package.json`, `vite.config.js`
   - [ ] `website/` directory exists (if website product selected)
   - [ ] `website/views/` exists with EJS templates (home.ejs, blog.ejs, contact.ejs, about.ejs)
   - [ ] `website/admin/` exists (CMS dashboard source)
   - [ ] `render.yaml` exists at repo root (Render Blueprint config)
   - [ ] `README.md` exists
   - [ ] `deploy.sh` exists
3. If the repo only has README.md and deploy.sh (no crm/ or website/ directories), the code generation failed — **stop testing and report this as a P0 bug**
4. Check the most recent commit message — should say "Initial Twomiah Factory deployment" or "Code update from Twomiah Factory"

## PHASE 3: VERIFY DEPLOYMENT

Wait 5-10 minutes after signup/payment for Render to deploy, then:

1. Visit **https://andson-builders-qa.onrender.com** (or whatever the slug-based URL is)
   - Does the CRM login page load? Screenshot it.
2. Visit **https://andson-builders-qa-site.onrender.com**
   - Does the website load? Screenshot it.
   - Is the branding blue (#2563EB)?
   - Does the company name show "Andson Builders QA"?

If URLs don't work, try these alternate patterns:
- https://andson-builders-qa-api.onrender.com
- Check the Factory platform at https://twomiah-factory-platform.onrender.com for the actual deployed URLs

---

## PHASE 3: CRM LOGIN & ONBOARDING

1. Go to the CRM login page
2. Login with: test-build@twomiah.com / TestBuild2026!
3. If an onboarding wizard appears, complete it:
   - Fill in company details
   - Set up team basics
   - Enable suggested features
4. Screenshot the dashboard after login

---

## PHASE 4: TEST EVERY CRM FEATURE

Test each feature below. For each one: navigate to the page, perform the listed actions, verify the result, screenshot, and report pass/fail.

### 4.1 Dashboard
- [ ] Dashboard loads with widgets (Total Contacts, Active Projects, Jobs Today, Pending Quotes, Open Invoices, Outstanding Receivables)
- [ ] Recent Jobs list shows (even if empty)
- [ ] Recent Quotes list shows
- [ ] Recent Invoices list shows

### 4.2 Contacts
- [ ] Navigate to Contacts page
- [ ] Create a new contact:
  - Name: "John Smith"
  - Type: Client
  - Company: "Smith Construction"
  - Email: john@smithconstruction.com
  - Phone: 715-555-1001
  - Address: 200 Oak Ave, Eau Claire, WI 54701
- [ ] Verify the contact appears in the list
- [ ] Click into the contact detail page — does it load?
- [ ] Edit the contact — change phone to 715-555-1002, save
- [ ] Search for "Smith" — does the contact appear?
- [ ] Filter by type "Client" — does it filter correctly?
- [ ] Create a second contact:
  - Name: "Jane Lead"
  - Type: Lead
  - Email: jane@example.com
  - Phone: 715-555-1003
- [ ] Verify both contacts show in the list
- [ ] Verify contact count on dashboard updated

### 4.3 Projects
- [ ] Navigate to Projects page
- [ ] Create a new project:
  - Name: "Kitchen Renovation - Smith"
  - Type: Renovation
  - Status: Planning
  - Contact: John Smith
  - Address: 200 Oak Ave, Eau Claire, WI 54701
  - Estimated Value: $45,000
  - Start Date: (next Monday)
- [ ] Verify the project appears in the list
- [ ] Open project detail — does it show all fields?
- [ ] Update status to "Active"
- [ ] Update progress to 25%
- [ ] Verify the project count on dashboard updated

### 4.4 Jobs
- [ ] Navigate to Jobs page
- [ ] Create a new job:
  - Title: "Demo and Prep Work"
  - Priority: High
  - Scheduled Date: (tomorrow)
  - Estimated Hours: 8
  - Estimated Value: $2,500
  - Contact: John Smith
  - Project: Kitchen Renovation - Smith
  - Address: 200 Oak Ave, Eau Claire, WI 54701
- [ ] Verify the job appears in the list with auto-generated job number
- [ ] Open job detail — verify all fields
- [ ] Click "Start" — status should change to In Progress
- [ ] Click "Complete" — status should change to Completed
- [ ] Create a second job:
  - Title: "Electrical Rough-In"
  - Priority: Normal
  - Scheduled Date: (day after tomorrow)
  - Contact: John Smith
  - Project: Kitchen Renovation - Smith
- [ ] Verify Jobs Today count on dashboard updated

### 4.5 Quotes
- [ ] Navigate to Quotes page
- [ ] Create a new quote:
  - Name: "Kitchen Renovation Quote"
  - Contact: John Smith
  - Project: Kitchen Renovation - Smith
  - Add line items:
    1. Description: "Demo & Prep", Quantity: 1, Unit Price: $2,500
    2. Description: "Electrical Rough-In", Quantity: 1, Unit Price: $5,000
    3. Description: "Plumbing", Quantity: 1, Unit Price: $4,000
    4. Description: "Cabinets & Countertops", Quantity: 1, Unit Price: $18,000
    5. Description: "Flooring", Quantity: 1, Unit Price: $6,000
  - Tax Rate: 5.5%
  - Notes: "Price valid for 30 days"
  - Expiry Date: (30 days from now)
- [ ] Verify subtotal calculates correctly ($35,500)
- [ ] Verify tax calculates correctly ($1,952.50)
- [ ] Verify total is correct ($37,452.50)
- [ ] Click "Send" — status should change to Sent
- [ ] Click "Approve" — status should change to Approved
- [ ] Download PDF — does it generate?
- [ ] Convert to Invoice — does it create an invoice with same line items?
- [ ] Verify Pending Quotes count on dashboard

### 4.6 Invoices
- [ ] Navigate to Invoices page
- [ ] Verify the converted invoice from the quote is there
- [ ] Open the invoice — verify line items match the quote
- [ ] Click "Send" — status changes to Sent
- [ ] Record a partial payment:
  - Amount: $18,000
  - Method: Check
  - Reference: "Check #1234"
- [ ] Verify status changes to Partial
- [ ] Verify balance shows $19,452.50
- [ ] Record final payment for the remaining balance
- [ ] Verify status changes to Paid
- [ ] Download PDF — does it generate?
- [ ] Create a standalone invoice (not from quote):
  - Contact: John Smith
  - Line item: "Change Order - Additional Outlets", Qty: 4, Price: $250
  - Due Date: (2 weeks from now)
- [ ] Verify Open Invoices count on dashboard

### 4.7 Schedule / Calendar
- [ ] Navigate to Schedule page
- [ ] Verify the calendar loads (week view)
- [ ] Verify scheduled jobs appear on the correct days
- [ ] Navigate forward/backward through weeks
- [ ] Verify today's date is highlighted
- [ ] If drag-drop calendar is enabled, try dragging a job to a different day

### 4.8 Team Management
- [ ] Navigate to Team page
- [ ] Create a new team member:
  - First Name: Mike
  - Last Name: Foreman
  - Email: mike@andsonbuilders.com
  - Phone: 715-555-2001
  - Role: Foreman
  - Hourly Rate: $35
- [ ] Verify the team member appears in the list
- [ ] Edit the team member — change hourly rate to $38
- [ ] Create a second team member:
  - First Name: Sarah
  - Last Name: Office
  - Email: sarah@andsonbuilders.com
  - Role: Office Manager

### 4.9 Time Tracking
- [ ] Navigate to Time Tracking page
- [ ] Create a manual time entry:
  - Date: today
  - Hours: 8
  - Description: "Demo work at Smith kitchen"
  - Billable: Yes
  - Project: Kitchen Renovation - Smith
  - Job: Demo and Prep Work
- [ ] Verify the entry appears
- [ ] Test clock in/out if available
- [ ] Verify billable hours vs non-billable display

### 4.10 Documents
- [ ] Navigate to Documents page
- [ ] Upload a test document (any PDF or image)
- [ ] Verify it appears in the list
- [ ] Verify you can download/view it

### 4.11 Expenses
- [ ] Navigate to Expenses page (if enabled)
- [ ] Create an expense:
  - Date: today
  - Category: Materials
  - Vendor: "Home Depot"
  - Description: "Lumber for Smith kitchen"
  - Amount: $1,250.00
  - Billable: Yes
  - Project: Kitchen Renovation - Smith
- [ ] Verify it appears in the list
- [ ] Filter by category "Materials"

### 4.12 Equipment Tracking (if enabled)
- [ ] Navigate to Equipment page
- [ ] Add equipment:
  - Name: "DeWalt Table Saw"
  - Serial: DW-12345
  - Purchase Date: 2025-01-15
- [ ] Verify it appears in the list

### 4.13 Fleet Management (if enabled)
- [ ] Navigate to Fleet page
- [ ] Add a vehicle:
  - Name: "Work Truck #1"
  - Make/Model: Ford F-250
  - Year: 2024
- [ ] Verify it appears

### 4.14 Inventory (if enabled)
- [ ] Navigate to Inventory page
- [ ] Add an item:
  - Name: "2x4 Lumber 8ft"
  - Category: Materials
  - Quantity: 200
  - Reorder Point: 50
- [ ] Verify it appears

### 4.15 Pricebook (if enabled)
- [ ] Navigate to Pricebook page
- [ ] Create a category: "Kitchen Services"
- [ ] Create an item:
  - Name: "Cabinet Installation"
  - Price: $150/linear foot
- [ ] Verify it appears

### 4.16 Lead Inbox (if enabled)
- [ ] Navigate to Lead Inbox
- [ ] Verify page loads (may be empty)
- [ ] Check Lead Sources page

### 4.17 Messages / Two-Way Texting (if enabled)
- [ ] Navigate to Messages page
- [ ] Verify page loads
- [ ] Attempt to send a test message (may fail without Twilio configured — note the error)

### 4.18 Reports
- [ ] Navigate to Reports page (if enabled)
- [ ] Verify report options load
- [ ] Run a revenue report if available

### 4.19 Settings
- [ ] Navigate to Settings
- [ ] **Company tab**: Verify company name, email, address are correct
- [ ] **Profile tab**: Verify admin user details
- [ ] **Security tab**: Test change password (change it and change back)
- [ ] **Users tab**: Verify team members are listed
- [ ] **Billing tab**: Check subscription status (if available)
- [ ] **Integrations tab**: Verify integration options are listed

### 4.20 Client Portal
- [ ] From the Contacts page, find John Smith
- [ ] Enable portal access for John Smith (toggle it on)
- [ ] Copy the portal link/token
- [ ] Open the portal URL in a new tab
- [ ] Verify the portal dashboard loads
- [ ] Check: Can the customer see their projects?
- [ ] Check: Can they see their quotes and approve them?
- [ ] Check: Can they see their invoices?
- [ ] Check: Can they make a payment? (may need Stripe configured)
- [ ] Check: Can they send messages?

---

## PHASE 5: TEST THE DEPLOYED WEBSITE

1. Visit the website URL (https://andson-builders-qa-site.onrender.com)

### 5.1 Public Pages
- [ ] Homepage loads with company name "Andson Builders QA"
- [ ] Branding color is blue (#2563EB)
- [ ] Services page loads and shows contractor services
- [ ] Gallery/Portfolio page loads
- [ ] Blog page loads
- [ ] Contact page loads with form
- [ ] Submit a test contact form:
  - Name: "Test Lead"
  - Email: test-lead@example.com
  - Phone: 715-555-9999
  - Message: "Interested in a kitchen remodel"
  - Service: (select any)
- [ ] Verify submission succeeds (success message or redirect)
- [ ] Navigation works between all pages
- [ ] Footer shows correct company info
- [ ] Mobile responsive — resize browser to mobile width, verify layout adapts

### 5.2 CMS Admin Dashboard
- [ ] Navigate to /admin on the website
- [ ] Login with admin credentials
- [ ] **Dashboard**: Loads with overview stats
- [ ] **Pages**: List pages, create a test page titled "Test Page"
- [ ] **Services**: View and edit a service description
- [ ] **Blog**: Create a test blog post:
  - Title: "QA Test Post"
  - Content: "This is a test blog post for QA."
  - Publish it
- [ ] Verify the blog post appears on the public blog page
- [ ] **Gallery**: Upload a test image to the gallery
- [ ] **Testimonials**: Add a testimonial:
  - Name: "Happy Customer"
  - Text: "Great work on our kitchen!"
  - Rating: 5
- [ ] Verify the testimonial appears on the homepage
- [ ] **Leads**: Check if the contact form submission from 5.1 appears
- [ ] **Site Settings**: Verify company info is correct
- [ ] **Menus**: Verify navigation items match the public site
- [ ] **Analytics**: Check if page view tracking is working
- [ ] **Media**: Upload a test image, verify it appears

### 5.3 Contact Form to CRM Flow
- [ ] Go back to the CRM
- [ ] Check if the website contact form submission created a lead/contact in the CRM
- [ ] This verifies the website-to-CRM data flow works

---

## PHASE 6: FINAL SUMMARY

Report a summary table:

| Feature | Status | Notes |
|---------|--------|-------|
| Signup Flow | Pass/Fail | |
| Deployment | Pass/Fail | |
| CRM Login | Pass/Fail | |
| Dashboard | Pass/Fail | |
| Contacts CRUD | Pass/Fail | |
| Projects CRUD | Pass/Fail | |
| Jobs CRUD + Status | Pass/Fail | |
| Quotes + Line Items + PDF | Pass/Fail | |
| Invoices + Payments + PDF | Pass/Fail | |
| Schedule/Calendar | Pass/Fail | |
| Team Management | Pass/Fail | |
| Time Tracking | Pass/Fail | |
| Documents | Pass/Fail | |
| Expenses | Pass/Fail | |
| Equipment | Pass/Fail | |
| Fleet | Pass/Fail | |
| Inventory | Pass/Fail | |
| Pricebook | Pass/Fail | |
| Lead Inbox | Pass/Fail | |
| Messages/SMS | Pass/Fail | |
| Reports | Pass/Fail | |
| Settings | Pass/Fail | |
| Client Portal | Pass/Fail | |
| Website Homepage | Pass/Fail | |
| Website Services | Pass/Fail | |
| Website Blog | Pass/Fail | |
| Website Gallery | Pass/Fail | |
| Website Contact Form | Pass/Fail | |
| CMS Admin | Pass/Fail | |
| CMS Content Editing | Pass/Fail | |
| Website-to-CRM Flow | Pass/Fail | |

For each failure, describe: what broke, the error message, and a screenshot.
