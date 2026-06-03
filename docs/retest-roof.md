# CRM Feature Re-Test — ROOF (Badger Storm Roofing QA)

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

OTHER:
- Ads — loads
- Settings — loads
- Support — loads
- Tasks — loads

PORTAL:
- Customer Portal — loads

WEBSITE:
- /estimate — estimator widget loads with address input
- /blog — posts render as HTML (not raw markdown)
- /gallery — shows projects (not "No projects found")
- Contact form → lead captured

Report: feature x PASS/FAIL matrix. Flag if storm radar overlay shows real weather data or just event map.
