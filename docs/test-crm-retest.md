# CRM Feature Re-Test — All 4 Verts

Run these after "Update Code" + redeploy on each tenant. Skip signup/GitHub/deploy — just login and verify every feature works.

---

## 1. BUILD (Andson Construction QA)

```
Go to https://andson-construction-qa-api.onrender.com/crm/login
Login: test-build-construction@twomiah.com / TestBuildConst2026!

After login, verify the sidebar shows ALL Construction tier features (not just basics). If the sidebar only shows Dashboard/Contacts/Jobs/Quotes/Invoices/Schedule/Time/Expenses/Documents/Team/Fleet/Inventory/Help/Settings — the feature sync failed. Report which items ARE visible.

Test every sidebar item by clicking it and confirming the page loads without errors. For each, try creating ONE record:

CORE:
- Dashboard — loads with stats
- Contacts — click into a contact detail, verify it loads (site table fix)
- Jobs — create a job, verify job number auto-generates
- Quotes — click a quote row, verify it navigates to /crm/quotes/:id (not /)
- Invoices — open an invoice, verify Balance Due shows $0.00 (not $NaN)
- Schedule — calendar loads with events
- Time — log an entry
- Expenses — open Add Expense modal, verify labels are visible (not invisible on dark bg)
- Documents — page loads
- Team — list shows

PRO/BUSINESS (should be in sidebar if features synced):
- Pricebook — loads, create a category
- Equipment — loads
- Fleet — loads
- Inventory — loads, verify Total Value shows $0.00 (not $--)
- Warranties — loads
- Marketing — loads
- Call Tracking — loads
- Reviews — loads
- Agreements — loads
- Recurring — loads
- Leads — loads
- Reports — loads
- Ads — loads (may show "not configured" if no API key — that's OK)
- AI Receptionist — loads

CONSTRUCTION (should be in sidebar if features synced):
- RFIs — loads, create one
- Submittals — loads, create one (verify POST returns 201, not 500)
- Daily Logs — loads
- Punch Lists — loads
- Inspections — loads
- Bids — loads
- Gantt — loads with projects on timeline
- Selections — loads, create one (verify POST returns 201, not 500)
- Takeoffs — loads, create a sheet (verify POST returns 201)
- Lien Waivers — loads
- Draw Schedules — loads, create one (verify POST returns 201)
- AIA Forms — loads, create a G702 (verify POST returns 201, auto-calc works)
- Tasks — create a task (verify POST returns 201)
- Change Orders — loads

PORTAL:
- Customer Portal — enable for a contact, open portal link, verify nav tabs work

Report: feature x PASS/FAIL matrix. Screenshot any failures.
```

---

## 2. WRENCH (Valley HVAC Pro QA)

```
Go to https://valley-hvac-pro-qa-wrench-api.onrender.com/crm/login
Login: test-wrench-fleet@twomiah.com / TestWrenchFleet2026!

Verify sidebar shows ALL Fleet tier features. Test every item:

CORE:
- Dashboard — loads with stats
- Contacts — click into contact detail (verify site table fix — no 500)
- Jobs — create a service call
- Quotes — click quote row, navigates to /crm/quotes/:id (not /)
- Invoices — open invoice, Balance Due shows correct number (not $NaN)
- Schedule — calendar loads
- Time — log entry
- Expenses — modal labels visible on dark bg
- Documents — loads
- Team — loads

PRO:
- Pricebook — loads, verify Good-Better-Best save works (PUT returns 200)
- Geofences — /crm/geofences loads (not 404)
- Agreements — loads
- Reviews — loads
- Recurring — loads

BUSINESS:
- Equipment — loads, click into detail
- Fleet — loads
- Inventory — Total Value shows $0.00 (not $--)
- Warranties — loads

FLEET EXCLUSIVE:
- Locations — loads, create a branch
- Commissions — loads, create a plan
- Call Tracking — loads
- Dispatch — loads

PORTAL:
- Portal — open /portal with a valid token, verify all 6 nav tabs work (no /portal/undefined/)

Report: feature x PASS/FAIL matrix.
```

---

## 3. CARE (Chippewa Home Care Agency QA)

```
Go to https://chippewa-home-care-agency-qa-care-api.onrender.com
Login: test-care-agency@twomiah.com / TestCareAgency2026!

The Care CRM uses AdminDashboard with a sidebar menu (not React Router). Test every section:

OPERATIONS:
- Dashboard — loads with metrics
- Clients — list shows client names (not blank). Create a client with first/last name, verify name displays after save.
- Onboarding — shows client name (not "- City")
- Referral Sources — loads
- Care Plans — create one (verify empty endDate doesn't crash — should accept null)
- Lead Inbox — loads
- Lead Sources — loads

CAREGIVERS:
- Caregivers — list shows names. Create a caregiver (verify POST to /api/caregivers returns 201, not 404). Verify default pay rate shows $15.00/hr (not $0.00).
- Performance — loads
- Job Applications — loads

SCHEDULING:
- Schedule Hub — calendar loads
- Emergency Coverage — loads
- No-Show Alerts — loads
- Route Optimizer — loads, verify /api/route-optimizer/stats returns 200
- Company Optimizer — loads

CLINICAL:
- ADL Tracking — loads
- Medications — loads
- Incidents — report form loads, client dropdown shows names (not blank)
- Form Builder — loads

COMPLIANCE:
- Compliance — caregiver dropdown shows caregivers (not empty)
- EVV Dashboard — loads
- Background Checks — loads
- Documents — loads
- Audit Logs — loads
- Login Activity — loads, verify data appears (not 0 records from wrong API path)

FINANCIAL:
- Billing — loads, verify /api/billing/referral-source-rates returns 200
- Claims — loads
- Payers & Codes — loads
- Authorizations — loads
- Payroll — loads
- Expenses — loads
- Reports — loads
- Revenue Forecast — loads

COMMUNICATION:
- Communication Log — loads
- SMS — loads
- Family Portal — loads
- Alerts — loads
- Messages — loads
- Integrations — loads
- Notifications — loads

AGENCY EXCLUSIVE:
- AI Receptionist — loads with STYLED toggle switch, greeting textarea, save button (not raw unstyled HTML)
- Forecast — loads
- Performance Reviews — loads
- No-Show — loads
- PTO — loads

WEBSITE:
- Contact form submits → lead appears in CRM Lead Inbox (not just CMS)
- "Request Care" button works from /blog page (navigates to /#contact)

Report: feature x PASS/FAIL matrix.
```

---

## 4. ROOF (Badger Storm Roofing QA)

```
Go to https://badger-storm-roofing-qa-roof-api.onrender.com/crm/login
Login: test-roof-storm@twomiah.com / TestRoofStorm2026!

Verify sidebar shows ALL Storm tier features. Test every item:

CORE:
- Pipeline Board — Kanban loads with 11 stages, drag-drop works
- Contacts — loads
- Jobs — create a job on pipeline
- Quotes — loads
- Invoices — loads
- Schedule — loads

LEADS:
- Lead Inbox — loads
- Lead Sources — loads

ROOFING SPECIFIC:
- Crews — loads, create a crew
- Measurements — loads, verify credit balance shows
- Roof Reports — loads
- Pricebook — loads, verify Good-Better-Best UI works
- Reviews — loads

INSURANCE:
- Insurance Claims — create a claim with adjuster
- Adjuster Directory — loads

BUSINESS:
- Estimator Settings — loads, $350-$550/sq configured
- Financing — loads (verify POST returns 201)
- Materials — loads

STORM EXCLUSIVE:
- Storm Leads — loads
- Storm Radar — loads (event map, not live radar)
- Canvassing — loads
- AI Receptionist — loads
- Multi-Crew Dispatch — loads
- Call Tracking — loads

PORTAL:
- Customer Portal — loads

WEBSITE:
- /estimate — estimator widget loads with address input
- /blog — posts render as HTML (not raw markdown)
- /gallery — shows projects (not "No projects found")
- Contact form → lead captured

Report: feature x PASS/FAIL matrix. Flag if storm radar overlay shows real weather data or just event map.
```

---

## Shared Instructions

- Take screenshots of every FAIL
- If sidebar is missing features, screenshot it and report which items are visible
- If a POST returns 500, include the error message
- If a page redirects to / instead of the expected URL, note the broken navigation
- Test in order: sidebar check first, then core features, then tier-specific
- After completing each vert, report the matrix before moving to the next
