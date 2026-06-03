# CRM Feature Re-Test — BUILD (Andson Construction QA)

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
