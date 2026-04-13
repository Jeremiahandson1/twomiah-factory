# Twomiah Build — End-to-End Test Spec (Chrome / Computer Use)

**You are Claude running in a Chrome browser. Your job is to verify every feature that SHOULD exist on each tier of Twomiah Build is actually present, loads, and works. You are NOT allowed to skip features that aren't obviously visible — if a feature is in the "MUST EXIST" list below and you can't reach it, report it as MISSING.**

For every URL listed in the "must exist" tables: navigate there, wait for the page to finish loading, and record the result as exactly one of:

- **PRESENT** — page loads, renders content (not blank, not a spinner stuck forever, not an error banner)
- **MISSING** — 404, redirect back to dashboard, "upgrade to unlock" message, or blank white page
- **BROKEN** — page loads but throws a console error, shows a red error banner, or the primary CTA fails when clicked
- **BLOCKED** — you cannot test it yet because a prerequisite failed

Take a screenshot every time you record MISSING or BROKEN. Continue testing even after failures — do not stop until every row in every tier table has a result.

---

## PHASE 1 — Sign up on the Construction tier

We test the highest tier because it must contain all lower-tier features plus its own. If Construction tier tests pass, Business/Pro/Starter are implicitly covered for the same tenant.

1. Navigate to: **https://twomiah.com/signup/build/**
2. Complete the 7-step wizard:
   - Company Name: `E2E Build Test {timestamp}`
   - Industry: General Contractor
   - Phone: 715-555-0101
   - Address: 100 Main Street, Eau Claire, WI 54701
   - Timezone: America/Chicago
   - Primary Color: #2563EB
   - Website Template: first "contractor" template shown
   - **Plan: Construction ($599/mo)** — this is critical, do NOT pick a lower tier
   - Add-ons: check ALL (SMS, GPS, Inventory, Fleet, Equipment, Marketing, Payments, Client Portal)
   - Deploy Service: Basic ($299)
   - Admin: `e2e-build@twomiah.com` / `E2EBuild2026!`
3. Submit. Screenshot the confirmation page. Record the tenant slug.
4. If redirected to Stripe checkout, screenshot and report the URL. **Do not** enter payment info unless instructed.

---

## PHASE 2 — Verify the deploy exists

Wait 10 minutes after signup, then:

1. Visit **https://{slug}.onrender.com** — CRM login page should load
2. Visit **https://{slug}-site.onrender.com** — public website should load with company name and #2563EB branding
3. If either URL 404s, try `https://{slug}-api.onrender.com` and check the Factory platform at https://twomiah-factory-platform.onrender.com for the actual URLs
4. Log in to the CRM with `e2e-build@twomiah.com` / `E2EBuild2026!`

---

## PHASE 3 — Starter tier features (MUST EXIST at Construction)

For each URL: navigate, verify the page renders, record the result.

| # | URL | Expected page content | Result |
|---|---|---|---|
| S1 | `/crm/dashboard` | Dashboard with widgets: Total Contacts, Active Projects, Jobs Today, Pending Quotes, Open Invoices | |
| S2 | `/crm/contacts` | Contacts list (may be empty). "New Contact" button must be visible | |
| S3 | `/crm/jobs` | Jobs list. "New Job" button | |
| S4 | `/crm/schedule` | Calendar view (week/month toggle) | |
| S5 | `/crm/quotes` | Quotes list. "New Quote" button | |
| S6 | `/crm/invoices` | Invoices list. "New Invoice" button | |
| S7 | `/crm/time` | Time tracking page with entries list | |
| S8 | `/crm/expenses` | Expenses list. "New Expense" button | |
| S9 | `/crm/documents` | Document library. Upload button | |
| S10 | (invite flow) | Settings → Users → you can invite another user | |

**Workflow smoke test (Starter):**
- Create a contact `John E2E` → contact appears in list
- Create a project `Kitchen Remodel` linked to that contact
- Create a job `Demo & Prep` under the project, mark Start → In Progress, mark Complete → Completed
- Create a quote with 3 line items → verify subtotal, tax, total calculate → mark Sent → Approved → Convert to Invoice → record a payment → verify Paid

If any step above fails, record which one and continue.

---

## PHASE 4 — Pro tier features (MUST EXIST at Construction)

| # | URL | Expected | Result |
|---|---|---|---|
| P1 | `/crm/team` | Team members list. Invite button. Roles visible | |
| P2 | `/crm/pricebook` | Pricebook items list with categories | |
| P3 | `/crm/recurring` | Recurring jobs list. "New Recurring Job" button | |
| P4 | `/crm/agreements` | Service agreements list | |
| P5 | `/crm/reviews` | Review requests dashboard with stats (Sent, Click Rate, Est. Reviews, This Month) + Settings tab | |
| P6 | `/crm/booking` or `/crm/online-booking` | Online booking widget settings | |
| P7 | `/crm/settings/integrations` | QuickBooks connect button visible | |
| P8 | `/crm/schedule` | Route optimization / GPS visible somewhere on this page or a `/crm/routing` page | |
| P9 | Settings → SMS | Two-way SMS page or inbox exists | |
| P10 | `/crm/geofences` or Settings → GPS | Geofence config page exists | |

**⚠ Known soft spot:** Route optimization UI is shared with Schedule page. Look for a "Optimize route" button or a visible map layer. If neither exists, record P8 as MISSING — the route is wired but the UI never surfaced.

---

## PHASE 5 — Business tier features (MUST EXIST at Construction)

| # | URL | Expected | Result |
|---|---|---|---|
| B1 | `/crm/inventory` | Inventory items list. Add Item button | |
| B2 | `/crm/equipment` | Equipment list. Add Equipment button | |
| B3 | `/crm/fleet` | Vehicles list. Add Vehicle button | |
| B4 | `/crm/warranties` | Warranties page | |
| B5 | `/crm/marketing` | Email campaigns / marketing dashboard | |
| B6 | `/crm/call-tracking` | Call tracking page | |
| B7 | `/crm/change-orders` | **Change Orders list. New Change Order button.** ⚠ gating fixed 2026-04-13 — must be reachable on Construction (and Business) tier | |
| B8 | Quotes → any quote → "Add financing" / "Offer financing" | Wisetack consumer financing option visible | |
| B9 | `/crm/reports` | Advanced reporting dashboard | |
| B10 | Settings → custom forms | Custom forms builder page | |

---

## PHASE 6 — Construction tier features (MUST EXIST — this is the tier we signed up on)

**⚠ CRITICAL:** All of these shipped in commit `1919f01` on 2026-04-13 and have never been tested on a live tenant. If the migration `0010_add_construction_compliance.sql` did not apply, every page below will 404 or blank. If you see multiple MISSING in a row, check the backend DB for `submittal`, `lien_waiver`, `draw_schedule`, `draw_request`, `aia_form` tables before continuing.

| # | URL | Expected | Result |
|---|---|---|---|
| C1 | `/crm/projects` | Projects list. New Project button | |
| C2 | `/crm/projects/:id` | Project detail page with phases, budget, progress | |
| C3 | `/crm/rfis` | RFIs list. New RFI button | |
| C4 | `/crm/submittals` | Submittals list. Create submittal → approval workflow (submit → approve / revise / reject) | |
| C5 | `/crm/daily-logs` | Daily logs list. Create log with weather, notes, photos | |
| C6 | `/crm/punch-lists` | Punch lists. Add item, assign, sign off | |
| C7 | `/crm/inspections` | Inspections list | |
| C8 | `/crm/bids` | Bids list. New Bid to subcontractor. Compare bids view | |
| C9 | `/crm/gantt` or `/crm/gantt-charts` | Gantt timeline view of all projects with date ranges, status colors, % complete | |
| C10 | `/crm/selections` | Selections list. Create selection with options and client approval | |
| C11 | `/crm/takeoffs` | Takeoffs list. Create takeoff from drawing | |
| C12 | `/crm/lien-waivers` | Lien waivers list. Create conditional progress waiver → workflow (draft → request → receive → approve) | |
| C13 | `/crm/draw-schedules` | Draw schedules list. Create a construction loan schedule. Add a draw request → workflow (pending → submit → approve → mark paid) | |
| C14 | `/crm/aia-forms` | AIA forms list. Create a G702 with G703 line items. Verify auto-calculated totals (completed+stored, retainage, payment due, balance to finish) all compute correctly | |

**Construction tier workflow smoke test:**
1. On the project you created in Phase 3, create one RFI
2. Create one change order — verify it appears in `/crm/change-orders`
3. Create one submittal and run it through submit → approve
4. Create one draw schedule with 5 draws, request draw #1, approve, mark paid
5. Create one AIA G702 with 3 G703 line items at different % complete. Verify the totals on the form match hand calculation.

If any of the above fail, record the step and the error.

---

## PHASE 7 — Bundled website (Portfolio website, since Construction tier)

Visit **https://{slug}-site.onrender.com** and verify:

| # | Page | Expected | Result |
|---|---|---|---|
| W1 | Home | Company name, #2563EB branding, hero CTA | |
| W2 | Services | Contractor service cards | |
| W3 | **Portfolio / Gallery** | **Portfolio page with project gallery. Construction tier MUST include this** | |
| W4 | Blog | Blog list page | |
| W5 | Contact | Contact form. Submit test lead → appears in CRM `/crm/leads` or `/crm/contacts` | |
| W6 | `/admin` | CMS admin dashboard loads, can edit pages, create blog post, upload gallery image | |

---

## PHASE 8 — Enterprise-only items (expected MISSING on Construction)

These are gated to Enterprise. They SHOULD be inaccessible on Construction tier. If you CAN access them, that's a gating bug.

| # | URL | Expected on Construction | Result |
|---|---|---|---|
| E1 | Settings → White-label branding | Not available / upgrade prompt | |
| E2 | Settings → SSO config | Not available / upgrade prompt | |
| E3 | Settings → API tokens | Not available / upgrade prompt | |

---

## PHASE 9 — Final report

Return a summary in this exact format:

```
BUILD E2E TEST — {date}
Tenant: {slug}
Tier: Construction

STARTER:   {n} PRESENT / {n} MISSING / {n} BROKEN
PRO:       {n} PRESENT / {n} MISSING / {n} BROKEN
BUSINESS:  {n} PRESENT / {n} MISSING / {n} BROKEN
CONSTRUCTION: {n} PRESENT / {n} MISSING / {n} BROKEN
WEBSITE:   {n} PRESENT / {n} MISSING / {n} BROKEN
ENTERPRISE GATING: {PASS/FAIL}

MISSING FEATURES:
- {row ID}: {URL} — {notes}

BROKEN FEATURES:
- {row ID}: {URL} — {error / console message}

WORKFLOW SMOKE TESTS:
- Starter: PASS / FAIL ({which step})
- Construction: PASS / FAIL ({which step})

CRITICAL FINDINGS:
- {anything that blocks shipping}
```

Attach every screenshot you took for MISSING and BROKEN rows. Do not omit any row from the tables above — every row gets a result, even if the result is MISSING.
