# CRM Feature Re-Test — CARE (Chippewa Home Care Agency QA)

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

Report: feature x PASS/FAIL matrix. Screenshot any failures.
