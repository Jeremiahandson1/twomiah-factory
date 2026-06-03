# CRM Feature Re-Test — WRENCH (Valley HVAC Pro QA)

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

OTHER:
- Leads — loads
- Reports — loads
- Ads — loads
- AI Receptionist — loads
- Tasks — loads
- Messages — loads
- Support — loads

PORTAL:
- Portal — open /portal with a valid token, verify all 6 nav tabs work (no /portal/undefined/)

Report: feature x PASS/FAIL matrix. Screenshot any failures.
