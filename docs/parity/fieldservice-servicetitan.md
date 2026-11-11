# Field service against ServiceTitan's feature list (11/10)

The owner's ServiceTitan feature list (from its public features, Pro-product and nav pages, 11/10), checked against **our code**
the same day — the feature registry (`packages/tenant-backend/src/featureRegistry.ts`, what `crm-fieldservice` is offered) and a
search of the code for each item. Marks: **built** · **partly** (what is missing is named) · **not built** · **built elsewhere**
(another trade has it; field service is not offered it) · **parked** (paid per use, or the owner's later call) · **outside party**.
Shared ones are also in `shared-backlog.md`.

## Built for field service

| ServiceTitan | Ours |
|---|---|
| Trackable phone numbers per campaign | `call_tracking` |
| Web scheduler | `online_booking` (with deposits, and payment at booking where the shop takes it) |
| Drag-and-drop dispatch board, route optimiser | `dispatch_board` (its RouteOptimiser) |
| Technician shifts, time off, breaks | `tech_availability`; the clock's breaks (`crm/field/clockExtras.ts`) |
| Automated job confirmations and reminders | `job_reminders` |
| Good-Better-Best proposals | `quote_proposals` |
| Memberships / service agreements: renewals, auto-scheduled visits, signatures, plan costing | `service_agreements`, `maintenance_contracts`, `plan_reports` |
| Two-way SMS | `two_way_texting` |
| Customer portal: payments, proposal approvals, service requests | `client_portal` |
| Integrated financing | `consumer_financing` (Wisetack — the partner's agreement is the owner's step) |
| On-site payments | `tap_to_pay`, `online_payments` |
| Digital forms and photos on the job; timekeeping | `job_checklists`, `photo_capture`, `time_tracking`, `tech_mobile_view` |
| Live pricebook in the field; flat rate | `pricebook`, `flat_rate_pricebook` |
| Inventory: truck and warehouse locations, transfers, replenishment, purchase orders | `inventory`, `parts_tracking` (shared inventory: `inventory_location`, transfers, low stock) |
| Job costing, work in progress, aging, materials | `job_costing`, `wip_report`, `ar_aging`, `parts_tracking` |
| Commission tracking; team revenue | `commission_tracking`, `team_revenue_reports` |
| GPS, geofencing, fleet | `gps_tracking`, `fleet` |
| QuickBooks Online | `quickbooks` |
| Reputation management, replying to reviews | `google_reviews`, `google_business` (reply: `tenant-backend/src/gbp.ts` POST /reviews/reply) |
| Automated email | `email_marketing` |
| Multi-location | `multi_location` |
| AI receptionist / call answering | `ai_receptionist`, `ai_call_answering` — **parked** (paid per use) |

## Built for another trade — open to field service (cheapest wins)

| ServiceTitan | Ours | Mark |
|---|---|---|
| Estimate templates | `quote_templates` — offered to the contractor only | opened 11/10 (tier 1), hidden until tried — field service, landscaping, basic |
| Automatic quote follow-up | `quote_followup` — contractor only | opened 11/10 (tier 1), hidden until tried — field service, landscaping, basic |
| Change orders | **built 11/10 (tier 2 #4), hidden** — `job_change_orders` (field service, landscaping): a job's change orders on its page, sent to the customer to sign in their portal (named by the job), approved, and billed as their own lines on the job's invoice, once (migration 0108: change_order.job_id, invoice_id). Raised by the office; techs raising them on site and basic (which bills from quotes) are follow-ups | built |
| CRM pipeline, quotes awaiting a reply | `lead_pipeline` — contractor only | opened 11/10 (tier 1), hidden until tried — field service, landscaping, basic |
| Owner / technician dashboards | `owner_dashboard`, `crew_dashboard` — contractor only | opened 11/10 (tier 1), hidden until tried — field service, landscaping, basic |
| Customer self-scheduling in the portal | **built 11/10 (tier 2 #5), hidden** — `portal_booking` (with online booking; field service, basic, landscaping): the portal's Book a Visit opens the business's booking pages with the customer's details filled in, and lists their bookings still to come with the page that moves or cancels each. The salon keeps its own (`portal_appointments`) | built |
| A `route_optimization` switch | in the registry, offered to **no** trade; the dispatch board's optimiser works without it — find what it was for before opening it | to check |

Each is opened by adding the trade to the feature's `templates` and trying it — shared first: landscaping and basic with field
service where they fit (`shared-backlog.md`).

## Not built (code checked 11/10)

| ServiceTitan | Ours | Mark |
|---|---|---|
| Skill matching when dispatching | built 11/10, hidden (`skill_matching`): each person's skills and each job type's needs on Settings › Skills; a job given to people who together lack a needed skill asks "check before you book"; Find a time offers only people with every needed skill (`server/data/skills.ts`, `tests/parity-skill-matching.test.ts`). Added 11/11: while a job is moved on the Dispatch Board, each lane says whether that person has the skills its kind needs, and the best fits are named first | yes (hidden) |
| Caller ID with the customer's record (screen pop) | none | not built |
| Live "where's my tech" map for the customer | built 11/10, hidden (`tech_tracking`): the "on my way" text carries a private link (`/on-the-way/<token>`, signed, 4 hours) to a map of the tech's newest position (from their phone, when they share location; 15 minutes at most old), refreshed every 30 seconds; "arrived" once they start, no position after (`server/crm/field/techTrack.ts`, `tests/parity-tech-tracking.test.ts`). Added 11/11: "About N minutes away" — the schedule's own travel estimate (straight line at 30 mph) from the tech's position to the job; no paid map call | yes (hidden) |
| Chat-to-text website widget | none | not built |
| Barcode / equipment scanning on the phone | built 11/10, hidden (`barcode_scanning`): scan a part's barcode on the phone's Stock list (search by name, SKU, barcode or supplier part #; read only), and a product's on the store's Stock (`apps/mobile/src/scan/`, `tests/mobile/barcode-scan.test.ts`, `tests/parity-barcode-search.test.ts`). Added 11/11: the phone's Equipment list, found by scanning the serial number on the data plate (whose unit, warranty, service history); a technician puts a part from the van on the job under way (Stock › Use on a job — inventory:use; the office keeps receiving and counting). Needs a check on a real phone (camera) | yes (hidden) |
| Spanish in the app | none (roofing's work orders only) | not built |
| Service zones | built 11/10, hidden (`service_zones`): Settings › Service zones — areas by ZIP (a ZIP in one zone); each job's zone by its ZIP on the Dispatch Board, and a zone filter (`crm/field/serviceZones.ts`, `tests/parity-service-zones.test.ts`). Added 11/11: each zone names its techs and a daily job limit — a job past it asks "check before you book"; Find a time offers the zone's techs and no time on a full day; the Dispatch Board's zone view shows their lanes | yes (hidden) |
| Marketing ROI scorecard, revenue heat map | built 11/10, hidden (`marketing_roi`): per lead source — leads, customers, jobs, payments, against spend per source per month (the shared spend ledger): cost per lead, money back per dollar (`crm/field/marketingRoi.ts`, `tests/parity-marketing-roi.test.ts`). Added 11/11: tracking numbers are sources (their calls; a first-time caller is that source's lead and customer) and the heat map — the period's customers by ZIP, sized by what they paid, every source or one | yes (hidden) |
| Call tracking numbers built in (no CallRail account) | built 11/11, hidden (`call_tracking_numbers`): a local number per ad source bought through Twomiah's Twilio, each call ringing the business's line (caller shown) and logged with its source; $3 a month a number on its own subscription, each call at Twilio's cost from the wallet (`apps/api/src/services/callTrackingNumbers.ts`, `crm/comms/trackingLines.ts`). CallRail stays as the other way in. Needs the Factory SQL `apps/api/migrations/2026-11-11_call_tracking_numbers.sql` run once. Not built: recording (with its consent message), swapping the number on the website per visitor | partly |
| Technician and CSR scorecards | built 11/10, behind team revenue (`team_revenue_reports`, hidden): Tech scorecard — jobs completed, revenue, average ticket, quote win rate, on-time starts (within 15 min of the booked time), call-backs (another job for the customer within 30 days); Office scorecard — jobs booked per person, completed and cancelled (`data/scorecards.ts`, `tests/parity-scorecards.test.ts`). Saved and scheduled like the report's other tabs | yes (hidden) |
| Internal general ledger, accounting periods, three-way matching | none — the books are QuickBooks (synced) | not built |
| Direct mail | none | not built |
| Progress billing, multi-party billing | progress billing is the contractor's (`drawSchedules`, AIA); no bill-to-a-third-party for a job | built elsewhere / not built |
| Daily logs, RFIs, cost-code time on the phone | the contractor's (`contractor_phone`) | built elsewhere |

## Not chased

ServiceTitan's paid AI (Dispatch Pro's machine-learning assignment, Field Pro, the review-response and email generators, AI
virtual agents, OCR bill capture — **parked** with the other paid AI features); hardware and data (dash cams, Convex prospecting
data, Price Insights, a phone system — **outside party**); sibling products (FieldRoutes, Aspire, Conduit).

## What is left (11/10), cheapest first
1. Open `quote_templates`, `quote_followup`, `change_orders`, `lead_pipeline`, `owner_dashboard`, `crew_dashboard` and
   `portal_appointments` to field service (and landscaping / basic where they fit); find what `route_optimization` was for.
2. Skill matching on the dispatch board and the schedule (skills are already stored).
3. A "where's my tech" link in the on-my-way text (the GPS is already there).
4. Barcode scanning on the field service phone (the store's scanner).
5. Technician scorecards on the reports.
6. Then: caller ID screen pop (with call tracking), chat-to-text widget, service zones, marketing ROI, Spanish.
