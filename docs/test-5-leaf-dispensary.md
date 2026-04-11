# Twomiah Factory Live Test — Cannabis Dispensary (Twomiah Leaf)

You are QA testing Twomiah Factory, a SaaS platform that generates and deploys CRM + Website software for service businesses. This is a LIVE production test. You will sign up as a cannabis dispensary, wait for deployment, then systematically test every feature in the deployed CRM and website.

The dispensary CRM is based on the general contractor CRM but adapted for retail cannabis operations — expect inventory management, product catalog, compliance tracking, and customer management. Some features may be more limited than other verticals since this is a newer template.

Take screenshots at every major step. Report pass/fail for each feature.

---

## PHASE 1: SIGNUP

1. Navigate to: **https://twomiah.com/signup/leaf/**
2. Complete the signup wizard:

**Step 0 — Company Info:**
- Company Name: "Green Valley Dispensary QA"
- Industry: Dispensary (or Cannabis)
- Phone: 715-555-0505
- Address: 500 Broadway
- City: Eau Claire
- State: Wisconsin
- ZIP: 54701
- Domain: (leave blank)
- Timezone: America/Chicago

**Step 1 — Branding:**
- Skip logo upload
- Primary Color: #16A34A (green)

**Step 2 — Website Template:**
- Select the dispensary template if available, otherwise the first/general template

**Step 3 — Plan & Billing:**
- Select "Growth" plan ($249/mo) or the mid-tier option
- Hosting: SaaS
- Add-ons: Check ALL available
- Migration Source: "No migration needed"

**Step 4 — Deploy Service:**
- Select "Basic" ($299)

**Step 5 — Admin Account:**
- First Name: Test
- Last Name: Leaf
- Email: test-leaf@twomiah.com
- Password: TestLeaf2026!

**Step 6 — Review & Submit:**
- Verify, check terms, submit

3. **After submission:** Screenshot, note slug ("green-valley-dispensary-qa"), note Stripe redirect

---

## PHASE 2: VERIFY GITHUB REPO

1. Visit **https://github.com/Jeremiahandson1/green-valley-dispensary-qa**
2. Verify the repo contains actual application code:
   - [ ] `crm-dispensary/` directory exists with `backend/` and `frontend/`
   - [ ] `crm-dispensary/backend/src/index.ts` exists
   - [ ] `website/` directory exists with `views/` and `admin/`
   - [ ] `render.yaml` exists at repo root
3. If repo only has README.md and deploy.sh — **stop and report P0 bug**
4. Verify `website/data/services.json` contains dispensary services, NOT contractor services

## PHASE 3: VERIFY DEPLOYMENT

Wait 5-10 minutes, then:

1. Visit **https://green-valley-dispensary-qa-leaf-api.onrender.com** — CRM loads? (note: dispensary uses `-leaf-api` suffix)
2. Visit **https://green-valley-dispensary-qa-site.onrender.com** — Website loads with green branding?

---

## PHASE 3: CRM LOGIN

1. Login with: test-leaf@twomiah.com / TestLeaf2026!
2. Complete onboarding if shown
3. Screenshot the dashboard

---

## PHASE 4: TEST CORE CRM FEATURES

### 4.1 Dashboard
- [ ] Dashboard loads with relevant stats
- [ ] Shows: Total Contacts, Active Projects, Open Invoices, etc.
- [ ] Note which dashboard widgets are dispensary-specific vs generic

### 4.2 Contacts / Customers
- [ ] Navigate to Contacts page
- [ ] Create a contact:
  - Name: "Alex Customer"
  - Type: Client
  - Email: alex@example.com
  - Phone: 715-555-7001
  - Address: 700 First Ave, Eau Claire, WI 54701
- [ ] Verify contact appears
- [ ] Open detail page
- [ ] Create second contact:
  - Name: "Vendor Supply Co"
  - Type: Vendor
  - Company: "Great Lakes Cannabis Supply"
  - Email: orders@greatlakes.example.com
  - Phone: 715-555-7002
- [ ] Search and filter contacts

### 4.3 Projects (if applicable to dispensary)
- [ ] Navigate to Projects page
- [ ] Create a project if the page exists:
  - Name: "Store Launch Campaign"
  - Status: Active
- [ ] If Projects doesn't apply to dispensary model, note that

### 4.4 Jobs / Tasks
- [ ] Navigate to Jobs page
- [ ] Create a job:
  - Title: "Restock Flower Inventory"
  - Priority: High
  - Scheduled Date: tomorrow
  - Contact: Vendor Supply Co
- [ ] Verify job appears with auto-generated number
- [ ] Start and complete the job

### 4.5 Quotes
- [ ] Create a quote:
  - Name: "Wholesale Order Q1"
  - Contact: Vendor Supply Co
  - Line items:
    1. "Blue Dream (1 lb)", Qty: 5, Price: $2,200
    2. "OG Kush (1 lb)", Qty: 3, Price: $2,400
    3. "Pre-Roll 100 Pack", Qty: 10, Price: $350
- [ ] Verify totals calculate
- [ ] Send the quote
- [ ] Approve and convert to invoice

### 4.6 Invoices
- [ ] Verify converted invoice
- [ ] Send invoice
- [ ] Record payment
- [ ] Download PDF

### 4.7 Schedule / Calendar
- [ ] Calendar loads
- [ ] Scheduled jobs appear

### 4.8 Team Management
- [ ] Create team member:
  - Name: "Sam Budtender"
  - Email: sam@greenvalley.com
  - Role: Budtender
  - Hourly Rate: $18
- [ ] Create second member:
  - Name: "Pat Manager"
  - Role: Store Manager
  - Hourly Rate: $25

### 4.9 Time Tracking
- [ ] Create time entry:
  - 8 hours, today, "Opening shift"
- [ ] Test clock in/out

---

## PHASE 5: TEST DISPENSARY-SPECIFIC FEATURES

### 5.1 Inventory Management
- [ ] Navigate to Inventory page (if available)
- [ ] Create inventory categories:
  - "Flower"
  - "Edibles"
  - "Concentrates"
  - "Pre-Rolls"
  - "Accessories"
- [ ] Add inventory items:
  - Item 1:
    - Name: "Blue Dream"
    - Category: Flower
    - Quantity: 500 (grams)
    - Reorder Point: 100
    - Cost: $8/gram
    - Retail Price: $15/gram
  - Item 2:
    - Name: "Gummy Bears 10mg (10pk)"
    - Category: Edibles
    - Quantity: 200
    - Reorder Point: 50
    - Cost: $12/pack
    - Retail Price: $25/pack
  - Item 3:
    - Name: "Live Rosin 1g"
    - Category: Concentrates
    - Quantity: 75
    - Reorder Point: 20
    - Cost: $25/gram
    - Retail Price: $55/gram
- [ ] Verify items appear in inventory list
- [ ] Check low stock alerts
- [ ] Adjust quantity (simulate a sale — reduce Blue Dream by 7g)
- [ ] Check inventory value report

### 5.2 Product Catalog / Variants (if available)
- [ ] Check if there's a separate product catalog
- [ ] Look for product variant support (different strains, sizes, THC/CBD content)
- [ ] Note compliance-related fields (THC %, CBD %, source, batch #, test date)

### 5.3 Compliance Tracking (if available)
- [ ] Check for compliance-related pages
- [ ] Look for:
  - Batch/lot tracking
  - Lab test result tracking
  - Seed-to-sale integration
  - State reporting features
  - Age verification settings
- [ ] Note what compliance features exist vs. what's missing

### 5.4 Pricebook (if enabled)
- [ ] Navigate to Pricebook
- [ ] Create categories and items for dispensary products
- [ ] Set pricing tiers if available

### 5.5 Equipment Tracking (if enabled)
- [ ] Track dispensary equipment:
  - Name: "Display Case #1"
  - Location: Sales Floor
- [ ] Track POS equipment if applicable

### 5.6 Expenses
- [ ] Create an expense:
  - Category: Inventory
  - Vendor: "Great Lakes Cannabis Supply"
  - Description: "Weekly flower restock"
  - Amount: $15,000
  - Billable: No
- [ ] Create second expense:
  - Category: Compliance
  - Description: "Lab testing - Q1 batch"
  - Amount: $2,500

### 5.7 Lead Inbox (if enabled)
- [ ] Check Lead Inbox page
- [ ] Verify it loads

### 5.8 Messages / SMS (if enabled)
- [ ] Check Messages page
- [ ] Note: SMS marketing for cannabis may have legal restrictions — verify the feature handles this

### 5.9 Reports
- [ ] Navigate to Reports
- [ ] Run available reports
- [ ] Look for dispensary-specific reports (inventory turnover, top sellers, compliance)

### 5.10 Documents
- [ ] Upload a test document (e.g., a license or compliance doc)
- [ ] Attach to the dispensary company profile

### 5.11 Client Portal (if enabled)
- [ ] Enable portal for Alex Customer
- [ ] Open portal
- [ ] Check what's visible to customers (product catalog? Order history? Invoices?)

### 5.12 Settings
- [ ] Company settings — verify info
- [ ] Check for dispensary-specific settings:
  - Compliance settings
  - POS integration settings
  - State/jurisdiction settings
  - Age verification requirements
- [ ] User management
- [ ] Integrations

---

## PHASE 6: TEST THE DEPLOYED WEBSITE

### 6.1 Public Pages
- [ ] Homepage loads — "Green Valley Dispensary QA" with green branding
- [ ] **Age verification gate** — does the site require age verification before showing content?
- [ ] Services/Products page — shows dispensary offerings
- [ ] Gallery page
- [ ] Blog page
- [ ] Contact page with form
- [ ] Submit contact form:
  - Name: "Curious Customer"
  - Email: curious@example.com
  - Phone: 715-555-4444
  - Message: "What strains do you carry?"
- [ ] Verify submission
- [ ] Mobile responsive check
- [ ] Check for compliance notices (license numbers, legal disclaimers, etc.)

### 6.2 Product Catalog on Website (if available)
- [ ] Check if the website has a public product menu/catalog
- [ ] Verify products show:
  - Name, category, description
  - THC/CBD content (if tracked)
  - Price
  - In-stock/out-of-stock status
- [ ] Check that compliance info is displayed properly

### 6.3 CMS Admin
- [ ] Login at /admin
- [ ] Create a blog post: "New Strains Available This Week"
- [ ] Edit services/product descriptions
- [ ] Add a testimonial
- [ ] Upload product images
- [ ] Check leads — contact form submission appear?
- [ ] Edit site settings — verify dispensary branding

### 6.4 Website-to-CRM Flow
- [ ] In CRM, check if website lead appeared

---

## PHASE 7: FINAL SUMMARY

| Feature | Status | Notes |
|---------|--------|-------|
| Signup Flow | Pass/Fail | |
| Deployment | Pass/Fail | |
| CRM Login | Pass/Fail | |
| Dashboard | Pass/Fail | |
| Contacts CRUD | Pass/Fail | |
| Jobs/Tasks | Pass/Fail | |
| Quotes + PDF | Pass/Fail | |
| Invoices + Payments | Pass/Fail | |
| Schedule/Calendar | Pass/Fail | |
| Team Management | Pass/Fail | |
| Time Tracking | Pass/Fail | |
| **Inventory Management** | Pass/Fail | |
| **Product Catalog** | Pass/Fail | |
| **Compliance Tracking** | Pass/Fail | |
| Pricebook | Pass/Fail | |
| Expenses | Pass/Fail | |
| Documents | Pass/Fail | |
| Lead Inbox | Pass/Fail | |
| Messages/SMS | Pass/Fail | |
| Reports | Pass/Fail | |
| Client Portal | Pass/Fail | |
| Settings | Pass/Fail | |
| **Website Age Gate** | Pass/Fail | |
| Website Homepage | Pass/Fail | |
| **Website Product Menu** | Pass/Fail | |
| Website Services | Pass/Fail | |
| Website Blog | Pass/Fail | |
| Website Contact Form | Pass/Fail | |
| **Website Compliance Notices** | Pass/Fail | |
| CMS Admin | Pass/Fail | |
| Website-to-CRM Flow | Pass/Fail | |

**Special Notes for Dispensary:**
- Document which features feel specifically tailored to cannabis vs. generic CRM
- Note any compliance gaps (missing state reporting, no seed-to-sale, no batch tracking)
- Note if age verification is missing from the website
- Flag any features that reference non-dispensary terminology (e.g., "projects", "subcontractors")
- These gaps are valuable feedback for improving the dispensary template

For each failure: describe the error, screenshot it.
